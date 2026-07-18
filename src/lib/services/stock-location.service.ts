import { prisma } from "@/lib/db";
import { Prisma, type StockLocationSegment } from "@prisma/client";
import type {
  StockLocationCreateInput,
  StockLocationUpdateInput,
} from "@/lib/validators/stock-location";
import { deriveUnitAndGrade } from "@/lib/validators/stock-location";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { withRetry } from "./tx-retry";
import { logger } from "@/lib/logger";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const locationInclude = {
  expectedSize: { select: { id: true, code: true, displayName: true } },
  _count: { select: { movements: true } },
} satisfies Prisma.StockLocationInclude;

export type StockLocationItem = Prisma.StockLocationGetPayload<{
  include: typeof locationInclude;
}>;

export type YardWithLocations = Prisma.StockYardGetPayload<{
  include: { locations: true };
}> & { locations: StockLocationItem[] };

/**
 * All yards with their locations, ordered for the setup table and the
 * schematic map. Includes inactive locations (the setup screen shows them
 * greyed out); the map layer filters to active client-side.
 */
export async function listYardsWithLocations(): Promise<YardWithLocations[]> {
  const yards = await prisma.stockYard.findMany({
    orderBy: { id: "asc" },
    include: {
      locations: {
        // The virtual cross-dock location is not a manageable yard site.
        where: { isVirtual: false },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        include: locationInclude,
      },
    },
  });
  return yards as YardWithLocations[];
}

/** Active yards for the create-location form dropdown. */
export async function listYardOptions() {
  return prisma.stockYard.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, code: true, nameAr: true },
  });
}

async function assertExpectedSizeExists(
  tx: TxClient,
  expectedSizeId: number | null | undefined,
) {
  if (expectedSizeId == null) return;
  const size = await tx.sizeLookup.findUnique({
    where: { id: expectedSizeId },
    select: { id: true },
  });
  if (!size) throw new ServiceError("sizeNotFound", "BAD_REQUEST");
}

export async function createLocation(
  data: StockLocationCreateInput,
  userId: number,
): Promise<StockLocationItem> {
  const { unit, allowedGrade } = deriveUnitAndGrade(
    data.segment as StockLocationSegment,
  );
  const code = data.code.trim().toUpperCase();

  const created = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const yard = await tx.stockYard.findUnique({
          where: { id: data.yardId },
          select: { id: true, isActive: true },
        });
        if (!yard) throw new ServiceError("yardNotFound", "NOT_FOUND");
        if (!yard.isActive) throw new ServiceError("yardDisabled");

        await assertExpectedSizeExists(tx, data.expectedSizeId);

        const duplicate = await tx.stockLocation.findUnique({
          where: { yardId_code: { yardId: data.yardId, code } },
          select: { id: true },
        });
        if (duplicate) {
          throw new ServiceError("locationCodeAlreadyUsedInYard", "CONFLICT");
        }

        const location = await tx.stockLocation.create({
          data: {
            yardId: data.yardId,
            code,
            nameAr: data.nameAr.trim(),
            segment: data.segment as StockLocationSegment,
            unit,
            allowedGrade,
            expectedSizeId: data.expectedSizeId ?? null,
            notes: data.notes?.trim() || null,
            sortOrder: data.sortOrder ?? 0,
            gridRow: data.gridRow,
            gridCol: data.gridCol,
            gridSpan: data.gridSpan ?? 1,
          },
          include: locationInclude,
        });

        await logAudit(tx, {
          userId,
          action: "create",
          entityType: "StockLocation",
          entityId: String(location.id),
          details: {
            code: location.code,
            nameAr: location.nameAr,
            segment: location.segment,
            unit: location.unit,
            yardId: location.yardId,
          },
        });

        return location;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info(
    { locationId: created.id, code: created.code, segment: created.segment },
    "stock location created",
  );
  return created;
}

export async function updateLocation(
  id: number,
  data: StockLocationUpdateInput,
  userId: number,
): Promise<StockLocationItem> {
  const updated = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.stockLocation.findUnique({
          where: { id },
          include: { _count: { select: { movements: true } } },
        });
        if (!existing) throw new ServiceError("locationNotFound", "NOT_FOUND");

        const hasMovements = existing._count.movements > 0;
        const newCode = data.code?.trim().toUpperCase();

        // Code is frozen once the location has any movement.
        if (newCode && newCode !== existing.code) {
          if (hasMovements) {
            throw new ServiceError("cannotEditLocationCodeWithMovements");
          }
          const duplicate = await tx.stockLocation.findUnique({
            where: { yardId_code: { yardId: existing.yardId, code: newCode } },
            select: { id: true },
          });
          if (duplicate && duplicate.id !== id) {
            throw new ServiceError("locationCodeAlreadyUsedInYard", "CONFLICT");
          }
        }

        await assertExpectedSizeExists(tx, data.expectedSizeId);

        // Segment change re-derives unit + grade. If the location already has
        // movements, only segment changes that PRESERVE unit and grade are
        // allowed (e.g. GENERAL ↔ GOVERNORATES) — otherwise the ledger unit
        // would contradict past rows.
        let nextSegment = existing.segment;
        let nextUnit = existing.unit;
        let nextGrade = existing.allowedGrade;
        if (data.segment && data.segment !== existing.segment) {
          const derived = deriveUnitAndGrade(data.segment as StockLocationSegment);
          if (
            hasMovements &&
            (derived.unit !== existing.unit ||
              derived.allowedGrade !== existing.allowedGrade)
          ) {
            throw new ServiceError("cannotChangeLocationClassificationWithMovements");
          }
          nextSegment = data.segment as StockLocationSegment;
          nextUnit = derived.unit;
          nextGrade = derived.allowedGrade;
        }

        const location = await tx.stockLocation.update({
          where: { id },
          data: {
            ...(newCode && !hasMovements ? { code: newCode } : {}),
            ...(data.nameAr !== undefined ? { nameAr: data.nameAr.trim() } : {}),
            ...(data.segment
              ? { segment: nextSegment, unit: nextUnit, allowedGrade: nextGrade }
              : {}),
            ...(data.expectedSizeId !== undefined
              ? { expectedSizeId: data.expectedSizeId }
              : {}),
            ...(data.notes !== undefined
              ? { notes: data.notes?.trim() || null }
              : {}),
            ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(data.gridRow !== undefined ? { gridRow: data.gridRow } : {}),
            ...(data.gridCol !== undefined ? { gridCol: data.gridCol } : {}),
            ...(data.gridSpan !== undefined ? { gridSpan: data.gridSpan } : {}),
          },
          include: locationInclude,
        });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "StockLocation",
          entityId: String(id),
          details: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
        });

        return location;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info({ locationId: id }, "stock location updated");
  return updated;
}

/**
 * Remove a location. Locations WITH movements are never hard-deleted — they
 * are deactivated (isActive=false) so historical ledger rows keep a valid FK.
 * Only empty locations are physically removed. Returns the action taken.
 */
export async function removeLocation(
  id: number,
  userId: number,
): Promise<{ deactivated: boolean }> {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.stockLocation.findUnique({
          where: { id },
          include: { _count: { select: { movements: true } } },
        });
        if (!existing) throw new ServiceError("locationNotFound", "NOT_FOUND");

        const hasMovements = existing._count.movements > 0;

        if (hasMovements) {
          if (!existing.isActive) {
            throw new ServiceError("locationAlreadyDisabled", "CONFLICT");
          }
          await tx.stockLocation.update({
            where: { id },
            data: { isActive: false },
          });
          await logAudit(tx, {
            userId,
            action: "update",
            entityType: "StockLocation",
            entityId: String(id),
            details: { event: "deactivated", code: existing.code },
          });
          logger.info({ locationId: id }, "stock location deactivated (has movements)");
          return { deactivated: true };
        }

        await tx.stockLocation.delete({ where: { id } });
        await logAudit(tx, {
          userId,
          action: "delete",
          entityType: "StockLocation",
          entityId: String(id),
          details: { code: existing.code, nameAr: existing.nameAr },
        });
        logger.info({ locationId: id }, "stock location deleted (no movements)");
        return { deactivated: false };
      },
      { isolationLevel: "Serializable" },
    ),
  );
}
