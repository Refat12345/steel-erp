import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import {
  Prisma,
  type StockLocationSegment,
  type StockMovementType,
  type SalesOrderGrade,
} from "@prisma/client";
import Decimal from "decimal.js";
import type {
  ProductionInInput,
  TransferInput,
  AdjustmentInput,
} from "@/lib/validators/stock-movement";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { withRetry } from "./tx-retry";
import { logger } from "@/lib/logger";
import { isStockModuleEnabled } from "@/config/feature-flags";
import { clampEventWindow } from "./settings.service";

// ── Unit model (segment → tracked counting units) ───────────────────────────

export type StockUnit = "BUNDLE" | "TON";

/**
 * Which counting units a location tracks, derived from its segment:
 *  - Rebar (GENERAL / GOVERNORATES / ISOLATION) = المبروم → BOTH bundles
 *    (primary) AND tons. The two are parallel balances of the SAME physical
 *    stock: production-in adds each unit separately (two roles), load-out
 *    deducts both, and the map shows «40 ربطة / 82 طن».
 *  - Short-bar (SHORTBAR) = القصائر → tons only.
 * The location's `unit` column stays the PRIMARY unit (BUNDLE for rebar,
 * TON for short-bar) so all existing single-unit consumers keep working.
 */
export function trackedUnits(segment: StockLocationSegment): StockUnit[] {
  return segment === "SHORTBAR" ? ["TON"] : ["BUNDLE", "TON"];
}

/** Rebar sites track two units in parallel; short-bar tracks one. */
export function isDualUnit(segment: StockLocationSegment): boolean {
  return segment !== "SHORTBAR";
}

/**
 * For a TON movement, is a size required? Yes for rebar (the tonnage mirrors
 * the same size as the bundles), no for short-bar (the site is the material).
 */
function tonNeedsSize(segment: StockLocationSegment): boolean {
  return isDualUnit(segment);
}

/**
 * Whether a location enforces the one-size-per-location rule. First-grade sites
 * (GENERAL / GOVERNORATES) are physically single-size zones, so mixing sizes is
 * blocked. The second-grade ISOLATION area is a multi-row zone that physically
 * holds many sizes at once, so the rule is lifted (the ledger already tracks a
 * separate per-size balance within the location). SHORTBAR has no size concept.
 */
function enforcesOneSize(segment: StockLocationSegment): boolean {
  return segment === "GENERAL" || segment === "GOVERNORATES";
}

// ── Operational day & work shifts (08:00 → 08:00 next day) ──────────────────

export type ShiftValue = "MORNING" | "EVENING";

/** The operational day starts at 08:00, not midnight. */
export const DAY_START_HOUR = 8;
/** MORNING = 08:00–20:00, EVENING = 20:00–08:00. */
export const SHIFT_BOUNDARY_HOURS = [8, 20] as const;
/**
 * Minutes after a shift boundary during which a clerk may assign the entry to
 * the shift that just ended (late recording of the previous shift's output).
 */
export const SHIFT_GRACE_MINUTES = 30;

/** Shift a timestamp naturally falls in, by wall-clock (server) time. */
export function naturalShift(d: Date): ShiftValue {
  const h = d.getHours();
  return h >= 8 && h < 20 ? "MORNING" : "EVENING";
}

/** Is `d` inside the grace window right after a boundary (08:00 / 20:00)? */
export function inShiftGraceWindow(d: Date): boolean {
  const h = d.getHours();
  return (h === 8 || h === 20) && d.getMinutes() < SHIFT_GRACE_MINUTES;
}

/** Start of the operational day (the most recent 08:00) containing `d`. */
export function operationalDayStart(d: Date): Date {
  const start = new Date(d);
  start.setHours(DAY_START_HOUR, 0, 0, 0);
  if (d < start) start.setDate(start.getDate() - 1);
  return start;
}

/**
 * Does a movement recorded at `createdAt` with (possibly overridden) `shift`
 * belong to the operational day BEFORE the one its timestamp falls in?
 * Only one override case crosses the day boundary: an entry recorded in the
 * morning grace window (08:00–08:30) assigned to EVENING — that evening is
 * the previous operational day's. The 20:00 override (EVENING slot assigned
 * to MORNING) stays within the same operational day.
 */
export function belongsToPreviousOperationalDay(
  createdAt: Date,
  shift: ShiftValue | null,
): boolean {
  return shift === "EVENING" && naturalShift(createdAt) === "MORNING";
}

// ── Balances (always computed from movements, never stored) ─────────────────

export interface BalanceLine {
  sizeId: number | null;
  sizeName: string | null;
  grade: SalesOrderGrade | null;
  unit: StockUnit;
  quantity: number;
}

export interface LocationBalance {
  locationId: number;
  code: string;
  nameAr: string;
  yardId: number;
  yardNameAr: string;
  segment: StockLocationSegment;
  unit: "BUNDLE" | "TON";
  /** True for rebar sites that carry a parallel tonnage balance. */
  isDualUnit: boolean;
  expectedSize: { id: number; displayName: string } | null;
  isActive: boolean;
  gridRow: number;
  gridCol: number;
  gridSpan: number;
  lines: BalanceLine[];
  /** Total in the PRIMARY unit (bundles for rebar, tons for short-bar). */
  totalQuantity: number;
  /** Parallel tonnage total for dual (rebar) sites; null for short-bar. */
  totalTons: number | null;
}

export interface BalanceFilters {
  yardId?: number;
  segment?: StockLocationSegment;
  sizeId?: number;
  grade?: SalesOrderGrade;
  includeInactive?: boolean;
}

/**
 * Per-location current balances, derived as SUM(quantity) grouped by
 * (location, size, grade). Locations with no movements come back with an
 * empty `lines` array and a zero total, so the map/report can still show
 * every configured site.
 */
export async function getLocationBalances(
  filters: BalanceFilters = {},
): Promise<LocationBalance[]> {
  // The virtual cross-dock location is a ledger-only pass-through — never a real
  // yard site — so it must not appear on the map or in the scale source picker.
  const locationWhere: Prisma.StockLocationWhereInput = { isVirtual: false };
  if (!filters.includeInactive) locationWhere.isActive = true;
  if (filters.yardId) locationWhere.yardId = filters.yardId;
  if (filters.segment) locationWhere.segment = filters.segment;

  const locations = await prisma.stockLocation.findMany({
    where: locationWhere,
    orderBy: [{ yardId: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    include: {
      yard: { select: { nameAr: true } },
      expectedSize: { select: { id: true, displayName: true } },
    },
  });
  if (locations.length === 0) return [];

  const locationIds = locations.map((l) => l.id);

  const movementWhere: Prisma.StockMovementWhereInput = {
    locationId: { in: locationIds },
  };
  if (filters.sizeId) movementWhere.sizeId = filters.sizeId;
  if (filters.grade) movementWhere.grade = filters.grade;

  // Group by unit as well: a rebar site holds parallel BUNDLE and TON balances
  // (often for the same size), so summing across units would be meaningless.
  const grouped = await prisma.stockMovement.groupBy({
    by: ["locationId", "sizeId", "grade", "unit"],
    where: movementWhere,
    _sum: { quantity: true },
  });

  // Size display names for the grouped lines.
  const sizeIds = [...new Set(grouped.map((g) => g.sizeId).filter((s): s is number => s != null))];
  const sizes = sizeIds.length
    ? await prisma.sizeLookup.findMany({
        where: { id: { in: sizeIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const sizeNameById = new Map(sizes.map((s) => [s.id, s.displayName]));

  const linesByLocation = new Map<number, BalanceLine[]>();
  // Per-location totals split by unit so we can expose the primary total and
  // the parallel tonnage independently.
  const primaryTotalByLocation = new Map<number, Decimal>();
  const tonTotalByLocation = new Map<number, Decimal>();
  const primaryUnitByLocation = new Map(locations.map((l) => [l.id, l.unit]));
  for (const row of grouped) {
    const qty = new Decimal(row._sum.quantity ?? 0);
    if (qty.isZero()) continue;
    const line: BalanceLine = {
      sizeId: row.sizeId,
      sizeName: row.sizeId != null ? sizeNameById.get(row.sizeId) ?? null : null,
      grade: row.grade,
      unit: row.unit,
      quantity: qty.toNumber(),
    };
    const arr = linesByLocation.get(row.locationId) ?? [];
    arr.push(line);
    linesByLocation.set(row.locationId, arr);
    if (row.unit === primaryUnitByLocation.get(row.locationId)) {
      primaryTotalByLocation.set(
        row.locationId,
        (primaryTotalByLocation.get(row.locationId) ?? new Decimal(0)).plus(qty),
      );
    }
    if (row.unit === "TON") {
      tonTotalByLocation.set(
        row.locationId,
        (tonTotalByLocation.get(row.locationId) ?? new Decimal(0)).plus(qty),
      );
    }
  }

  return locations.map((l) => {
    const dual = isDualUnit(l.segment);
    return {
      locationId: l.id,
      code: l.code,
      nameAr: l.nameAr,
      yardId: l.yardId,
      yardNameAr: l.yard.nameAr,
      segment: l.segment,
      unit: l.unit,
      isDualUnit: dual,
      expectedSize: l.expectedSize
        ? { id: l.expectedSize.id, displayName: l.expectedSize.displayName }
        : null,
      isActive: l.isActive,
      gridRow: l.gridRow,
      gridCol: l.gridCol,
      gridSpan: l.gridSpan,
      lines: (linesByLocation.get(l.id) ?? []).sort((a, b) =>
        (a.sizeName ?? "").localeCompare(b.sizeName ?? ""),
      ),
      totalQuantity: (primaryTotalByLocation.get(l.id) ?? new Decimal(0)).toNumber(),
      totalTons: dual ? (tonTotalByLocation.get(l.id) ?? new Decimal(0)).toNumber() : null,
    };
  });
}

// ── Production-in (manual inbound from the line) ────────────────────────────

export interface RecordProductionResult {
  movementId: number;
  warning: string | null;
}

/**
 * Shared logic for a positive inbound movement (PRODUCTION_IN or
 * OPENING_BALANCE). Both validate the same way and differ only in the
 * movement type and audit event label. Kept private so the two public
 * entry points stay thin and permission-gated at the API layer.
 */
async function recordInbound(
  type: Extract<StockMovementType, "PRODUCTION_IN" | "OPENING_BALANCE">,
  data: ProductionInInput,
  userId: number,
): Promise<RecordProductionResult> {
  const quantity = new Decimal(data.quantity);
  const unit: StockUnit = data.unit;
  const auditEvent = type === "OPENING_BALANCE" ? "opening_balance" : "production_in";

  // Resolve the work shift for production entries. Defaults to the natural
  // shift of the server clock; the clerk may assign the PREVIOUS shift, but
  // only within the grace window right after a boundary. An 08:0x entry
  // assigned EVENING lands on the previous operational day by definition
  // (see belongsToPreviousOperationalDay).
  let shift: ShiftValue | null = null;
  if (type === "PRODUCTION_IN") {
    const now = new Date();
    const natural = naturalShift(now);
    if (data.shift != null && data.shift !== natural) {
      if (!inShiftGraceWindow(now)) {
        throw new ServiceError("previousShiftAttributionWindowExpired", "BAD_REQUEST", {
          graceMinutes: SHIFT_GRACE_MINUTES,
        });
      }
    }
    shift = data.shift ?? natural;
  }

  const result = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const location = await tx.stockLocation.findUnique({
          where: { id: data.locationId },
          include: { expectedSize: { select: { id: true, displayName: true } } },
        });
        if (!location) throw new ServiceError("locationNotFound", "NOT_FOUND");
        if (!location.isActive) throw new ServiceError("locationDisabled");
        if (!trackedUnits(location.segment).includes(unit)) {
          throw new ServiceError("inputUnitNotAllowedForLocation");
        }

        // A size is needed for bundle movements, and for tonnage on rebar sites
        // (where the ton balance mirrors the same size as the bundles).
        const needsSize = unit === "BUNDLE" || tonNeedsSize(location.segment);

        let sizeId: number | null = null;
        let grade: SalesOrderGrade | null = null;

        if (unit === "BUNDLE" && !quantity.isInteger()) {
          throw new ServiceError("bundleCountMustBeInteger");
        }

        if (needsSize) {
          if (data.sizeId == null) {
            throw new ServiceError("sizeRequiredForLocation");
          }
          const size = await tx.sizeLookup.findUnique({
            where: { id: data.sizeId },
            select: { id: true, displayName: true },
          });
          if (!size) throw new ServiceError("sizeNotFound", "BAD_REQUEST");
          sizeId = size.id;
          grade = location.allowedGrade;
          if (!grade) {
            throw new ServiceError("locationGradeUnset");
          }

          // Single-size zones (GENERAL / GOVERNORATES):
          //  1) If the bay already holds a positive BUNDLE balance, that size
          //     wins (physical stock on the ground) — expectedSize is only a
          //     hint for empty bays and can lag behind reassignments.
          //  2) If the bay is empty and expectedSize is configured, inbound
          //     must match it so the clerk cannot park the wrong diameter.
          if (enforcesOneSize(location.segment)) {
            const bundleBalances = await tx.stockMovement.groupBy({
              by: ["sizeId"],
              where: {
                locationId: location.id,
                unit: "BUNDLE",
                sizeId: { not: null },
              },
              _sum: { quantity: true },
            });
            const positive = bundleBalances.filter((row) =>
              new Decimal(row._sum.quantity ?? 0).greaterThan(0),
            );
            const occupyingSizeId = positive.find((row) => row.sizeId === sizeId)
              ? sizeId
              : positive[0]?.sizeId ?? null;

            if (occupyingSizeId != null && sizeId !== occupyingSizeId) {
              const existing = await tx.sizeLookup.findUnique({
                where: { id: occupyingSizeId },
                select: { displayName: true },
              });
              throw new ServiceError("locationHasOtherSizeEmptyFirst", "BAD_REQUEST", {
                locationName: location.nameAr,
                sizeName: existing?.displayName ?? "آخر",
              });
            }

            if (
              occupyingSizeId == null &&
              location.expectedSizeId != null &&
              sizeId !== location.expectedSizeId
            ) {
              throw new ServiceError("locationSizeMustMatchExpected", "BAD_REQUEST", {
                locationName: location.nameAr,
                sizeName: location.expectedSize?.displayName ?? "—",
              });
            }
          }
        }
        // For short-bar TON sites the location itself identifies the material;
        // movements carry no size or grade.

        const movement = await tx.stockMovement.create({
          data: {
            locationId: location.id,
            type,
            sizeId,
            grade,
            quantity: quantity.toFixed(3),
            unit,
            shift,
            reason: data.reason?.trim() || null,
            createdById: userId,
          },
        });

        await logAudit(tx, {
          userId,
          action: "create",
          entityType: "StockMovement",
          entityId: String(movement.id),
          details: {
            event: auditEvent,
            locationId: location.id,
            locationCode: location.code,
            sizeId,
            grade,
            quantity: quantity.toNumber(),
            unit,
            shift,
          },
        });

        // Imbalance guard: on a rebar site the two parallel balances (bundles
        // and tons) should both be present. If one is positive while the other
        // is still zero, the paired role likely forgot to record their unit or
        // used the wrong location — warn (do NOT block).
        let warning: string | null = null;
        if (isDualUnit(location.segment) && sizeId != null) {
          const byUnit = await tx.stockMovement.groupBy({
            by: ["unit"],
            where: { locationId: location.id, sizeId },
            _sum: { quantity: true },
          });
          const bundleSum = new Decimal(
            byUnit.find((u) => u.unit === "BUNDLE")?._sum.quantity ?? 0,
          );
          const tonSum = new Decimal(byUnit.find((u) => u.unit === "TON")?._sum.quantity ?? 0);
          if (bundleSum.greaterThan(0) && tonSum.lessThanOrEqualTo(0)) {
            warning =
              "تنبيه: هذا الموقع فيه ربطات بدون طن مسجّل — تأكد أن مسؤول الطن سجّل الوزن.";
          } else if (tonSum.greaterThan(0) && bundleSum.lessThanOrEqualTo(0)) {
            warning =
              "تنبيه: هذا الموقع فيه طن بدون ربطات مسجّلة — تأكد أن مسؤول الربطات سجّل العدد.";
          }
        }

        return { movementId: movement.id, warning };
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info(
    { locationId: data.locationId, movementId: result.movementId, type, unit },
    "stock inbound movement recorded",
  );
  return result;
}

export function recordProductionIn(
  data: ProductionInInput,
  userId: number,
): Promise<RecordProductionResult> {
  return recordInbound("PRODUCTION_IN", data, userId);
}

export function recordOpeningBalance(
  data: ProductionInInput,
  userId: number,
): Promise<RecordProductionResult> {
  return recordInbound("OPENING_BALANCE", data, userId);
}

// ── Transfer between locations ──────────────────────────────────────────────

export interface RecordTransferResult {
  outMovementId: number;
  inMovementId: number;
}

/**
 * Move stock from one location to another. Writes a paired TRANSFER_OUT
 * (negative on source) and TRANSFER_IN (positive on destination) atomically.
 * Enforces: same counting unit, sufficient source balance, and the
 * one-size-per-location rule on the destination. Grade is taken from each
 * location (a governorates ↔ general move is a legitimate reclassification).
 */
export async function recordTransfer(
  data: TransferInput,
  userId: number,
): Promise<RecordTransferResult> {
  const quantity = new Decimal(data.quantity);

  const result = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [from, to] = await Promise.all([
          tx.stockLocation.findUnique({ where: { id: data.fromLocationId } }),
          tx.stockLocation.findUnique({
            where: { id: data.toLocationId },
            include: { expectedSize: { select: { id: true, displayName: true } } },
          }),
        ]);
        if (!from) throw new ServiceError("sourceLocationNotFound", "NOT_FOUND");
        if (!to) throw new ServiceError("destLocationNotFound", "NOT_FOUND");
        if (!from.isActive) throw new ServiceError("sourceLocationDisabled");
        if (!to.isActive) throw new ServiceError("destLocationDisabled");
        if (from.id === to.id) throw new ServiceError("cannotTransferToSameLocation");
        if (from.unit !== to.unit) {
          throw new ServiceError("cannotTransferBetweenBundleAndTon");
        }

        const primaryUnit: StockUnit = from.unit;
        // For rebar (dual) sites the primary unit is BUNDLE and tonnage moves
        // proportionally alongside it. For short-bar the primary unit is TON.
        const dual = isDualUnit(from.segment);

        let sizeId: number | null = null;
        if (primaryUnit === "BUNDLE") {
          if (data.sizeId == null) throw new ServiceError("sizeRequiredForBundleLocations");
          if (!quantity.isInteger()) {
            throw new ServiceError("bundleCountMustBeInteger");
          }
          const size = await tx.sizeLookup.findUnique({
            where: { id: data.sizeId },
            select: { id: true },
          });
          if (!size) throw new ServiceError("sizeNotFound", "BAD_REQUEST");
          sizeId = size.id;

          // Destination single-size rule (same as production-in / adjust):
          //  1) Positive BUNDLE balance of another size blocks the transfer.
          //  2) Empty bay with expectedSize configured must match that size.
          // Lifted for the multi-size ISOLATION zone.
          if (enforcesOneSize(to.segment)) {
            const destBundles = await tx.stockMovement.groupBy({
              by: ["sizeId"],
              where: {
                locationId: to.id,
                unit: "BUNDLE",
                sizeId: { not: null },
              },
              _sum: { quantity: true },
            });
            const positive = destBundles.filter((row) =>
              new Decimal(row._sum.quantity ?? 0).greaterThan(0),
            );
            const occupyingSizeId = positive.find((row) => row.sizeId === sizeId)
              ? sizeId
              : positive[0]?.sizeId ?? null;

            if (occupyingSizeId != null && sizeId !== occupyingSizeId) {
              const existing = await tx.sizeLookup.findUnique({
                where: { id: occupyingSizeId },
                select: { displayName: true },
              });
              throw new ServiceError("destLocationHasOtherSizeEmptyFirst", "BAD_REQUEST", {
                locationName: to.nameAr,
                sizeName: existing?.displayName ?? "آخر",
              });
            }

            if (
              occupyingSizeId == null &&
              to.expectedSizeId != null &&
              sizeId !== to.expectedSizeId
            ) {
              throw new ServiceError("locationSizeMustMatchExpected", "BAD_REQUEST", {
                locationName: to.nameAr,
                sizeName: to.expectedSize?.displayName ?? "—",
              });
            }
          }
        }

        // Available balance at source in the PRIMARY unit for the size.
        const sourceAgg = await tx.stockMovement.aggregate({
          where: { locationId: from.id, sizeId, unit: primaryUnit },
          _sum: { quantity: true },
        });
        const available = new Decimal(sourceAgg._sum.quantity ?? 0);
        if (available.lessThan(quantity)) {
          throw new ServiceError("insufficientBundleBalance", "BAD_REQUEST", {
            locationName: from.nameAr,
            available: available.toString(),
          });
        }

        // For rebar, the actual weight moved is known at transfer time and is
        // sent explicitly — move exactly that (no estimation). It must not
        // exceed the tonnage currently at the source for this size.
        let tonsToMove = new Decimal(0);
        if (dual) {
          if (data.quantityTons == null || data.quantityTons <= 0) {
            throw new ServiceError("transferTonsRequiredForShortbar");
          }
          tonsToMove = new Decimal(data.quantityTons);
          const tonAgg = await tx.stockMovement.aggregate({
            where: { locationId: from.id, sizeId, unit: "TON" },
            _sum: { quantity: true },
          });
          const availableTons = new Decimal(tonAgg._sum.quantity ?? 0);
          if (tonsToMove.greaterThan(availableTons)) {
            throw new ServiceError("insufficientTonBalance", "BAD_REQUEST", {
              locationName: from.nameAr,
              availableTons: availableTons.toString(),
            });
          }
        }

        const transferGroupId = randomUUID();
        const reason = data.reason?.trim() || null;

        const makePair = async (
          unit: StockUnit,
          amount: Decimal,
        ): Promise<{ outId: number; inId: number } | null> => {
          if (amount.lessThanOrEqualTo(0)) return null;
          const [out, inn] = await Promise.all([
            tx.stockMovement.create({
              data: {
                locationId: from.id,
                type: "TRANSFER_OUT" satisfies StockMovementType,
                sizeId,
                grade: from.allowedGrade,
                quantity: amount.negated().toFixed(3),
                unit,
                transferGroupId,
                reason,
                createdById: userId,
              },
            }),
            tx.stockMovement.create({
              data: {
                locationId: to.id,
                type: "TRANSFER_IN" satisfies StockMovementType,
                sizeId,
                grade: to.allowedGrade,
                quantity: amount.toFixed(3),
                unit,
                transferGroupId,
                reason,
                createdById: userId,
              },
            }),
          ]);
          return { outId: out.id, inId: inn.id };
        };

        const primaryPair = await makePair(primaryUnit, quantity);
        if (!primaryPair) throw new ServiceError("quantityMustBePositive");
        const tonPair = dual ? await makePair("TON", tonsToMove) : null;

        await logAudit(tx, {
          userId,
          action: "create",
          entityType: "StockMovement",
          entityId: String(primaryPair.outId),
          details: {
            event: "transfer",
            fromLocationId: from.id,
            fromLocationCode: from.code,
            toLocationId: to.id,
            toLocationCode: to.code,
            sizeId,
            quantity: quantity.toNumber(),
            unit: primaryUnit,
            tonsMoved: dual ? tonsToMove.toNumber() : null,
            outMovementId: primaryPair.outId,
            inMovementId: primaryPair.inId,
            tonOutMovementId: tonPair?.outId ?? null,
            tonInMovementId: tonPair?.inId ?? null,
          },
        });

        return { outMovementId: primaryPair.outId, inMovementId: primaryPair.inId };
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info(
    {
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      ...result,
    },
    "stock transfer recorded",
  );
  return result;
}

// ── Physical-count adjustment ───────────────────────────────────────────────

export interface RecordAdjustmentResult {
  movementId: number;
  previousQuantity: number;
  actualQuantity: number;
  delta: number;
}

/**
 * Reconcile the system balance with a physical count. The caller sends the
 * ACTUAL counted quantity; we compute the signed delta against the current
 * balance for (location, size) and record it as an ADJUSTMENT movement.
 * History is never rewritten — the correction is itself a movement.
 *
 * One-size rule interplay: introducing a NEW size (balance goes from ≤0 to >0)
 * is blocked while another size still holds a positive balance. Corrections
 * to a size that is already positive are allowed in both directions so legacy
 * mixed-size locations can be counted and drained size by size.
 */
export async function recordAdjustment(
  data: AdjustmentInput,
  userId: number,
): Promise<RecordAdjustmentResult> {
  const actual = new Decimal(data.actualQuantity);

  const result = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const location = await tx.stockLocation.findUnique({
          where: { id: data.locationId },
        });
        if (!location) throw new ServiceError("locationNotFound", "NOT_FOUND");
        if (!location.isActive) throw new ServiceError("locationDisabled");

        const unit: StockUnit = data.unit;
        if (!trackedUnits(location.segment).includes(unit)) {
          throw new ServiceError("correctionUnitNotAllowedForLocation");
        }
        const needsSize = unit === "BUNDLE" || tonNeedsSize(location.segment);

        let sizeId: number | null = null;
        let grade: SalesOrderGrade | null = null;

        if (unit === "BUNDLE" && !actual.isInteger()) {
          throw new ServiceError("bundleCountMustBeInteger");
        }

        if (needsSize) {
          if (data.sizeId == null) throw new ServiceError("sizeRequiredForLocation");
          const size = await tx.sizeLookup.findUnique({
            where: { id: data.sizeId },
            select: { id: true },
          });
          if (!size) throw new ServiceError("sizeNotFound", "BAD_REQUEST");
          sizeId = size.id;
          grade = location.allowedGrade;
        }

        const agg = await tx.stockMovement.aggregate({
          where: { locationId: location.id, sizeId, unit },
          _sum: { quantity: true },
        });
        const current = new Decimal(agg._sum.quantity ?? 0);
        const delta = actual.minus(current);
        if (delta.isZero()) {
          throw new ServiceError("noStockDifference");
        }

        // Single-size zones: if the bay already holds a positive BUNDLE
        // balance of size X, BUNDLE and TON corrections for a different size
        // are blocked when they would create a new line (current ≤ 0). Legacy
        // wrong-size lines that are already positive may still be counted
        // down to zero. ISOLATION is multi-size and skips this rule.
        if (enforcesOneSize(location.segment) && sizeId != null && current.lessThanOrEqualTo(0)) {
          const bundleBalances = await tx.stockMovement.groupBy({
            by: ["sizeId"],
            where: {
              locationId: location.id,
              unit: "BUNDLE",
              sizeId: { not: null },
            },
            _sum: { quantity: true },
          });
          const occupyingSizeId = bundleBalances.find((row) =>
            new Decimal(row._sum.quantity ?? 0).greaterThan(0),
          )?.sizeId;
          if (occupyingSizeId != null && sizeId !== occupyingSizeId) {
            const existing = await tx.sizeLookup.findUnique({
              where: { id: occupyingSizeId },
              select: { displayName: true },
            });
            throw new ServiceError("locationHasOtherSizeCorrectFirst", "BAD_REQUEST", {
              locationName: location.nameAr,
              sizeName: existing?.displayName ?? "آخر",
            });
          }
          // Empty bay: if expected size is configured, new lines must match it.
          if (
            occupyingSizeId == null &&
            location.expectedSizeId != null &&
            sizeId !== location.expectedSizeId &&
            delta.greaterThan(0)
          ) {
            const expected = await tx.sizeLookup.findUnique({
              where: { id: location.expectedSizeId },
              select: { displayName: true },
            });
            throw new ServiceError("locationSizeMustMatchExpected", "BAD_REQUEST", {
              locationName: location.nameAr,
              sizeName: expected?.displayName ?? "—",
            });
          }
        }

        const movement = await tx.stockMovement.create({
          data: {
            locationId: location.id,
            type: "ADJUSTMENT" satisfies StockMovementType,
            sizeId,
            grade,
            quantity: delta.toFixed(3),
            unit,
            reason: data.reason.trim(),
            createdById: userId,
          },
        });

        await logAudit(tx, {
          userId,
          action: "create",
          entityType: "StockMovement",
          entityId: String(movement.id),
          details: {
            event: "adjustment",
            locationId: location.id,
            locationCode: location.code,
            sizeId,
            previousQuantity: current.toNumber(),
            actualQuantity: actual.toNumber(),
            delta: delta.toNumber(),
            unit,
            reason: data.reason.trim(),
          },
        });

        return {
          movementId: movement.id,
          previousQuantity: current.toNumber(),
          actualQuantity: actual.toNumber(),
          delta: delta.toNumber(),
        };
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info(
    { locationId: data.locationId, movementId: result.movementId, delta: result.delta },
    "stock adjustment recorded",
  );
  return result;
}

// ── Load-out on truck close ─────────────────────────────────────────────────

export interface LoadOutResult {
  deducted: number;
  skipped: number;
}

/**
 * Deduct stock for every internal weigh session of a truck that was loaded
 * from a stock location. Called from `closeOperation` INSIDE its transaction
 * so the deduction commits atomically with the close (a rollback undoes both).
 *
 * Rules:
 * - Only sessions with a `sourceLocationId` are deducted; exempt-truck mirror
 *   sessions and pre-stock-module rows (no source) are ignored.
 * - BUNDLE sites deduct `bundleCount` (skipped with a warning if it is missing).
 * - TON (short-bar) sites deduct `weightTons`.
 * - We do NOT block on insufficient stock: the truck physically left the yard,
 *   so the movement must be recorded even if it drives the balance negative —
 *   a negative balance is the signal that an opening balance was never entered.
 */
export async function applyLoadOutForClose(
  tx: Prisma.TransactionClient,
  truckId: number,
  userId: number,
): Promise<LoadOutResult> {
  // Dark-launch: while the stock module is disabled, stock deductions are inert
  // even if a weigh session somehow carries a source/production flag. This keeps
  // truck close working on production before the module is released (no yards,
  // no virtual location) and matches pre-stock behaviour exactly.
  if (!isStockModuleEnabled()) return { deducted: 0, skipped: 0 };

  const sessions = await tx.weighSession.findMany({
    // Two kinds of sessions produce ledger movements: those loaded from a real
    // yard location (deduction), and direct-from-production cross-docks (a
    // paired receipt + load-out on the virtual location).
    where: {
      truckOperationId: truckId,
      OR: [{ sourceLocationId: { not: null } }, { fromProduction: true }],
    },
    include: { sourceLocation: true },
  });
  if (sessions.length === 0) return { deducted: 0, skipped: 0 };

  // Fetch the virtual cross-dock location once, only if needed.
  let virtualLocation: Awaited<ReturnType<typeof tx.stockLocation.findFirst>> | null = null;
  if (sessions.some((s) => s.fromProduction && s.sourceLocationId == null)) {
    virtualLocation = await tx.stockLocation.findFirst({ where: { isVirtual: true } });
    if (!virtualLocation) {
      // Should never happen — the location is seeded by migration. Fail loudly
      // rather than silently dropping the cross-dock ledger trail.
      throw new ServiceError("defaultDirectDeliveryLocationNotFound", "NOT_FOUND");
    }
  }

  let deducted = 0;
  let skipped = 0;
  const movements: Array<{
    weighSessionId: number;
    locationId: number;
    locationCode: string;
    sizeId: number | null;
    quantity: number;
    unit: "BUNDLE" | "TON";
  }> = [];

  for (const s of sessions) {
    // Direct-from-production cross-dock: no yard stock to deduct. Record a
    // receipt (+) into the virtual location and an immediate load-out (−) from
    // it, so the material still has a complete in→out ledger trail (net zero).
    if (s.fromProduction && s.sourceLocationId == null) {
      const vloc = virtualLocation!;
      // Mirror whatever units the session carries: bundles (needs count+size)
      // and always tons. Size is preserved for reporting; may be null.
      const passes: Array<{ unit: StockUnit; quantity: Decimal; sizeId: number | null }> = [];
      if (s.bundleCount != null && s.bundleCount > 0 && s.sizeId != null) {
        passes.push({ unit: "BUNDLE", quantity: new Decimal(s.bundleCount), sizeId: s.sizeId });
      }
      const tons = new Decimal(s.weightTons);
      if (tons.greaterThan(0)) {
        passes.push({ unit: "TON", quantity: tons, sizeId: s.sizeId ?? null });
      }
      if (passes.length === 0) {
        skipped++;
        continue;
      }
      for (const p of passes) {
        // Receipt from the production line.
        await tx.stockMovement.create({
          data: {
            locationId: vloc.id,
            type: "PRODUCTION_IN" satisfies StockMovementType,
            sizeId: p.sizeId,
            grade: null,
            quantity: p.quantity.toFixed(3),
            unit: p.unit,
            weighSessionId: s.id,
            truckOperationId: truckId,
            reason: "تسليم مباشر من خط الإنتاج",
            createdById: userId,
          },
        });
        // Immediate load-out onto the truck.
        await tx.stockMovement.create({
          data: {
            locationId: vloc.id,
            type: "LOAD_OUT" satisfies StockMovementType,
            sizeId: p.sizeId,
            grade: null,
            quantity: p.quantity.negated().toFixed(3),
            unit: p.unit,
            weighSessionId: s.id,
            truckOperationId: truckId,
            reason: "تسليم مباشر من خط الإنتاج",
            createdById: userId,
          },
        });
        deducted++;
        movements.push({
          weighSessionId: s.id,
          locationId: vloc.id,
          locationCode: vloc.code,
          sizeId: p.sizeId,
          quantity: p.quantity.toNumber(),
          unit: p.unit,
        });
      }
      continue;
    }

    const loc = s.sourceLocation;
    if (!loc) continue;

    const units = trackedUnits(loc.segment);
    const dual = isDualUnit(loc.segment);
    // A session yields up to two deductions on a rebar site: bundles + tons.
    const toCreate: Array<{ unit: StockUnit; quantity: Decimal; sizeId: number | null }> = [];

    if (units.includes("BUNDLE")) {
      // Rebar bundle deduction needs both a count and a size; skip (warn) if
      // either is missing rather than corrupting per-size balances.
      if (s.bundleCount != null && s.bundleCount > 0 && s.sizeId != null) {
        toCreate.push({ unit: "BUNDLE", quantity: new Decimal(s.bundleCount), sizeId: s.sizeId });
      } else {
        logger.warn(
          { truckId, weighSessionId: s.id, locationId: loc.id },
          "load-out: bundle deduction skipped (missing bundleCount or size)",
        );
      }
    }
    if (units.includes("TON")) {
      const tons = new Decimal(s.weightTons);
      if (tons.greaterThan(0)) {
        // Rebar tonnage mirrors the bundle size; short-bar carries no size.
        toCreate.push({ unit: "TON", quantity: tons, sizeId: dual ? s.sizeId : null });
      }
    }

    if (toCreate.length === 0) {
      skipped++;
      continue;
    }

    for (const m of toCreate) {
      await tx.stockMovement.create({
        data: {
          locationId: loc.id,
          type: "LOAD_OUT" satisfies StockMovementType,
          sizeId: m.sizeId,
          grade: loc.allowedGrade,
          quantity: m.quantity.negated().toFixed(3),
          unit: m.unit,
          weighSessionId: s.id,
          truckOperationId: truckId,
          createdById: userId,
        },
      });
      deducted++;
      movements.push({
        weighSessionId: s.id,
        locationId: loc.id,
        locationCode: loc.code,
        sizeId: m.sizeId,
        quantity: m.quantity.toNumber(),
        unit: m.unit,
      });
    }
  }

  if (deducted > 0 || skipped > 0) {
    await logAudit(tx, {
      userId,
      action: "create",
      entityType: "TruckOperation",
      entityId: String(truckId),
      details: { event: "stock_load_out", truckId, deducted, skipped, movements },
    });
  }

  logger.info({ truckId, deducted, skipped }, "stock load-out applied on truck close");
  return { deducted, skipped };
}

// ── Movement log ────────────────────────────────────────────────────────────

export interface MovementListItem {
  id: number;
  createdAt: Date;
  type: StockMovementType;
  locationId: number;
  locationCode: string;
  locationNameAr: string;
  sizeName: string | null;
  grade: SalesOrderGrade | null;
  quantity: number;
  unit: "BUNDLE" | "TON";
  /** Work shift (production entries only) — stored, may differ from clock. */
  shift: ShiftValue | null;
  reason: string | null;
  createdBy: string;
}

export interface MovementFilters {
  locationId?: number;
  type?: StockMovementType;
  from?: Date;
  to?: Date;
}

export async function listMovements(
  filters: MovementFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<MovementListItem>> {
  const where: Prisma.StockMovementWhereInput = {};
  if (filters.locationId) where.locationId = filters.locationId;
  if (filters.type) where.type = filters.type;
  // Analytics-start floor — the ledger UI sends no date filter, so without
  // this the full pre-start history would leak into the list.
  const window = await clampEventWindow(filters.from, filters.to);
  if (window.from || window.to) {
    where.createdAt = {
      ...(window.from ? { gte: window.from } : {}),
      ...(window.to ? { lte: window.to } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        location: { select: { code: true, nameAr: true } },
        size: { select: { displayName: true } },
        creator: { select: { username: true, fullName: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);

  const data: MovementListItem[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    type: r.type,
    locationId: r.locationId,
    locationCode: r.location.code,
    locationNameAr: r.location.nameAr,
    sizeName: r.size?.displayName ?? null,
    grade: r.grade,
    quantity: new Decimal(r.quantity).toNumber(),
    unit: r.unit,
    shift: r.shift,
    reason: r.reason,
    createdBy: r.creator.fullName || r.creator.username,
  }));

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

/**
 * Production-in entries of the CURRENT operational day (08:00 → 08:00), all
 * users, newest first. Used by the production-entry screen so a clerk can see
 * what was already recorded — by themselves and by the paired role — and
 * avoid duplicate/conflicting entries. Accessible to production clerks who
 * lack the full movement-log permission.
 *
 * Entries recorded in the morning grace window but assigned to the previous
 * EVENING shift belong to the previous operational day and are excluded.
 */
/** Today's production feed — includes segment/sizeId so the UI can flag
 *  rebar sites that received only one of the two parallel units. */
export interface TodayProductionItem extends MovementListItem {
  sizeId: number | null;
  segment: StockLocationSegment;
}

export async function listTodayProduction(): Promise<TodayProductionItem[]> {
  const start = operationalDayStart(new Date());

  const rows = await prisma.stockMovement.findMany({
    // Exclude the virtual cross-dock receipts — those are dispatch trail, not
    // real production entries the clerks are reconciling.
    where: {
      type: "PRODUCTION_IN",
      createdAt: { gte: start },
      location: { isVirtual: false },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      location: { select: { code: true, nameAr: true, segment: true } },
      size: { select: { displayName: true } },
      creator: { select: { username: true, fullName: true } },
    },
  });

  return rows
    .filter((r) => !belongsToPreviousOperationalDay(r.createdAt, r.shift))
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      type: r.type,
      locationId: r.locationId,
      locationCode: r.location.code,
      locationNameAr: r.location.nameAr,
      sizeId: r.sizeId,
      sizeName: r.size?.displayName ?? null,
      segment: r.location.segment,
      grade: r.grade,
      quantity: new Decimal(r.quantity).toNumber(),
      unit: r.unit,
      // Effective shift: stored value for production rows (always set on new
      // rows); fall back to the natural shift for rows predating the column.
      shift: r.shift ?? naturalShift(r.createdAt),
      reason: r.reason,
      createdBy: r.creator.fullName || r.creator.username,
    }));
}

/** Active locations (id + code + name + unit + grade) for pickers. */
export async function listActiveLocationOptions() {
  return prisma.stockLocation.findMany({
    where: { isActive: true, isVirtual: false },
    orderBy: [{ yardId: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      nameAr: true,
      unit: true,
      allowedGrade: true,
      segment: true,
      yardId: true,
      expectedSizeId: true,
    },
  });
}
