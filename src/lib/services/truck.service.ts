import { prisma } from "@/lib/db";
import { logAudit } from "./audit.service";
import { ServiceError, toServiceError } from "./errors";
import { withRetry } from "./tx-retry";
import { logger } from "@/lib/logger";
import { Prisma, type TruckStatus, type SalesOrderGrade } from "@prisma/client";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import Decimal from "decimal.js";
import {
  validateTareWeight,
  validateGrossWeight,
  validateWeightRange,
} from "@/lib/weight-bounds";
import { buildWeighbridgeDiscrepancyAuditFields } from "@/lib/weighbridge-discrepancy";
import {
  aggregateWeighSessionsBySize,
  type WeighSessionSizeAggregate,
} from "@/lib/weigh-session-aggregate";
import { requestSizeCodesExemptFromInternalWeighing } from "@/lib/material-kind";
import { applyLoadOutForClose } from "./stock.service";
import { clampEventWindow } from "./settings.service";
import type { Locale } from "@/i18n/config";
import {
  localizedDestinationName,
  localizedSize,
} from "@/lib/localized-name";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Whether a truck whose request items reference these sizes should skip
 * internal weighing (every distinct size is a bulk-exempt kind — scrap,
 * billet tying wire, …). Resolves the size codes from the catalog inside the
 * same transaction.
 */
async function deriveSkipInternalWeighing(
  tx: TxClient,
  requestItems?: { sizeId: number }[],
): Promise<boolean> {
  if (!requestItems?.length) return false;
  const sizeIds = [...new Set(requestItems.map((i) => i.sizeId))];
  const sizes = await tx.sizeLookup.findMany({
    where: { id: { in: sizeIds } },
    select: { code: true },
  });
  return requestSizeCodesExemptFromInternalWeighing(sizes.map((s) => s.code));
}

/** Internal tons for one bridge round (sum of its weigh sessions). */
async function loadRoundInternalTons(tx: TxClient, roundId: number): Promise<number> {
  const sessions = await tx.weighSession.findMany({
    where: { bridgeRoundId: roundId },
    select: { weightTons: true },
  });
  return sessions
    .reduce((sum, s) => sum.plus(s.weightTons), new Decimal(0))
    .toNumber();
}

/**
 * The currently open bridge round (endWeightKg = null). At most one exists
 * per operation (partial unique index bridge_rounds_open_round_uniq).
 */
async function getOpenRound(tx: TxClient, truckId: number) {
  return tx.bridgeRound.findFirst({
    where: { truckOperationId: truckId, endWeightKg: null },
  });
}

// `LoadingComplete → FirstWeigh` is the multi-round path: the truck was
// weighed on the external bridge and returned to load the next round.
const VALID_TRANSITIONS: Record<TruckStatus, TruckStatus[]> = {
  Queued: ["FirstWeigh", "Cancelled"],
  Approved: ["FirstWeigh", "Cancelled"],
  // FirstWeigh → LoadingComplete is the exempt path (scrap / billet wire): no
  // internal sessions are recorded, so the loader confirms directly from
  // FirstWeigh. confirmLoadingComplete still requires sessions for non-exempt
  // trucks, so the extra transition is safe for the normal flow.
  FirstWeigh: ["OnScale", "LoadingComplete", "Cancelled"],
  Loading: ["OnScale", "Cancelled"],
  OnScale: ["LoadingComplete", "Cancelled"],
  LoadingComplete: ["OnScale", "FirstWeigh", "SecondWeigh", "Cancelled"],
  SecondWeigh: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

function assertTransition(current: TruckStatus, next: TruckStatus) {
  if (!VALID_TRANSITIONS[current]?.includes(next)) {
    throw new ServiceError("invalidStatusTransition", "BAD_REQUEST", { current: current, next: next });
  }
}

// ─── Register ──────────────────────────────────────────────────────

export interface RequestItemInput {
  sizeId: number;
  /** Grade for this line — lets the same size appear once per grade. */
  grade?: SalesOrderGrade | null;
  bundleCount?: number | null;
  requestedTons?: number | null;
}

export interface RegisterTruckInput {
  customerId?: number | null;
  destinationId?: number | null;
  plateNumber: string;
  driverName: string;
  salesOrderNumber?: string | null;
  notes?: string | null;
  requestItems?: RequestItemInput[];
  operationalGrade?: SalesOrderGrade | null;
}

export interface UpdateTruckInput {
  customerId?: number | null;
  destinationId?: number | null;
  plateNumber?: string;
  driverName?: string;
  salesOrderNumber?: string | null;
  notes?: string | null;
  requestItems?: RequestItemInput[];
  operationalGrade?: SalesOrderGrade | null;
}

async function validateTruckReferences(
  tx: TxClient,
  data: {
    customerId?: number | null;
    destinationId?: number | null;
    salesOrderNumber?: string | null;
  },
) {
  if (data.customerId) {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new ServiceError("customerNotFound", "NOT_FOUND");
    if (!customer.isActive) throw new ServiceError("customerInactive");

    const activeContract = await tx.masterContract.findFirst({
      where: { customerId: data.customerId, status: "active" },
      select: { contractNumber: true },
    });
    if (!activeContract) {
      throw new ServiceError("cannotRegisterTruckWithoutActiveGeneralContract");
    }
  }

  if (data.salesOrderNumber) {
    const so = await tx.salesOrder.findUnique({
      where: { orderNumber: data.salesOrderNumber },
      include: { contract: { select: { status: true, customerId: true } } },
    });
    if (!so) throw new ServiceError("salesOrderNotFound", "NOT_FOUND");
    if (so.status !== "approved" && so.status !== "in_progress") {
      throw new ServiceError("salesOrderNotActive");
    }
    if (so.contract.status !== "active") {
      throw new ServiceError("salesOrderContractInactiveCannotRegisterTruck");
    }
    if (data.customerId != null && so.contract.customerId !== data.customerId) {
      throw new ServiceError("salesOrderCustomerMismatch");
    }
  }

  if (data.destinationId) {
    const destination = await tx.destination.findUnique({
      where: { id: data.destinationId },
    });
    if (!destination) throw new ServiceError("destinationNotFound", "NOT_FOUND");
    if (!destination.isActive) throw new ServiceError("destinationInactive");
  }
}

async function validateTruckRequestItems(tx: TxClient, requestItems?: RequestItemInput[]) {
  if (!requestItems?.length) return;

  // Uniqueness is per (size, grade): "12mm FIRST" and "12mm SECOND" may
  // coexist; "12mm" without grade may appear only once.
  const keys = requestItems.map((i) => `${i.sizeId}:${i.grade ?? ""}`);
  if (new Set(keys).size !== keys.length) {
    throw new ServiceError("duplicateSizeGradeInOrder");
  }
  const sizeIds = [...new Set(requestItems.map((i) => i.sizeId))];
  const sizes = await tx.sizeLookup.findMany({
    where: { id: { in: sizeIds }, isActive: true },
  });
  if (sizes.length !== sizeIds.length) {
    throw new ServiceError("sizeInvalidOrInactive");
  }
}

export async function registerTruck(data: RegisterTruckInput, userId: number) {
  const TERMINAL_STATUSES: TruckStatus[] = ["Completed", "Cancelled"];
  const normalizedPlate = data.plateNumber.trim();

  let truck;
  try {
    truck = await withRetry(() =>
      prisma.$transaction(
        async (tx: TxClient) => {
          await validateTruckReferences(tx, data);
          await validateTruckRequestItems(tx, data.requestItems);
          const skipInternalWeighing = await deriveSkipInternalWeighing(
            tx,
            data.requestItems,
          );

          const existingOpen = await tx.truckOperation.findFirst({
            where: {
              plateNumber: normalizedPlate,
              status: { notIn: TERMINAL_STATUSES },
            },
            select: { id: true, status: true },
          });
          if (existingOpen) {
            // 409 Conflict: a resource in the intended state already exists.
            // Not a client bug (400) — the client's input is well-formed.
            throw new ServiceError("openTruckForPlateById", "CONFLICT", {
              truckId: existingOpen.id,
            });
          }

          const created = await tx.truckOperation.create({
            data: {
              customerId: data.customerId || null,
              destinationId: data.destinationId || null,
              plateNumber: normalizedPlate,
              driverName: data.driverName.trim(),
              salesOrderNumber: data.salesOrderNumber || null,
              notes: data.notes?.trim() || null,
              operationalGrade: data.operationalGrade ?? null,
              skipInternalWeighing,
              status: "Queued",
              createdById: userId,
            },
          });

          if (data.requestItems?.length) {
            await tx.truckRequestItem.createMany({
              data: data.requestItems.map((item) => ({
                truckOperationId: created.id,
                sizeId: item.sizeId,
                grade: item.grade ?? null,
                bundleCount: item.bundleCount ?? null,
                requestedTons: item.requestedTons ?? null,
              })),
            });
          }

          await logAudit(tx, {
            userId,
            action: "create",
            entityType: "TruckOperation",
            entityId: String(created.id),
            details: {
              event: "truck_registered",
              previousValue: null,
              newValue: {
                customerId: data.customerId ?? null,
                destinationId: data.destinationId ?? null,
                plateNumber: created.plateNumber,
                driverName: created.driverName,
                salesOrderNumber: created.salesOrderNumber,
                operationalGrade: created.operationalGrade ?? null,
                requestItems: data.requestItems ?? null,
              },
            } as Prisma.InputJsonValue,
          });

          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  } catch (e) {
    // Backstop: partial unique index "truck_operations_plate_open_uniq"
    // catches a concurrent insert that slipped past the Serializable check.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const target = e.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
      if (targetStr.includes("plate_number")) {
        throw new ServiceError("openTruckForPlate", "CONFLICT", {
          plate: normalizedPlate,
        });
      }
    }
    throw e;
  }

  logger.info({ truckId: truck.id, plate: truck.plateNumber }, "truck registered");
  return truck;
}

// ─── Update Before Weigh ───────────────────────────────────────────

export async function updateTruckBeforeWeigh(
  truckId: number,
  data: UpdateTruckInput,
  expectedVersion: number,
  userId: number,
) {
  const TERMINAL_STATUSES: TruckStatus[] = ["Completed", "Cancelled"];

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          include: {
            requestItems: {
              orderBy: { sizeId: "asc" },
              select: { sizeId: true, grade: true, bundleCount: true, requestedTons: true },
            },
          },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        if (truck.version !== expectedVersion) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        const APPROVED_ONLY_REQUEST_ITEMS: (keyof UpdateTruckInput)[] = [
          "customerId",
          "destinationId",
          "plateNumber",
          "driverName",
          "salesOrderNumber",
          "notes",
          "operationalGrade",
        ];

        const FIRST_WEIGH_LOCKED_IDENTITY: (keyof UpdateTruckInput)[] = [
          "customerId",
          "salesOrderNumber",
          "plateNumber",
        ];

        if (truck.status === "FirstWeigh") {
          const sessionCount = await tx.weighSession.count({
            where: { truckOperationId: truckId },
          });
          if (sessionCount > 0) {
            throw new ServiceError("cannotEditTruckAfterInternalWeighs");
          }
          const attemptedIdentity = FIRST_WEIGH_LOCKED_IDENTITY.some(
            (field) => data[field] !== undefined,
          );
          if (attemptedIdentity) {
            throw new ServiceError("afterTareLimitedFieldsEditable");
          }
        } else if (truck.status !== "Queued" && truck.status !== "Approved") {
          throw new ServiceError("cannotEditTruckAfterInternalWeighs");
        } else if (truck.status === "Approved") {
          const attempted = APPROVED_ONLY_REQUEST_ITEMS.some((field) => data[field] !== undefined);
          if (attempted) {
            throw new ServiceError("afterApprovalOnlyRequestItemsEditable");
          }
        }

        const nextCustomerId = data.customerId !== undefined ? data.customerId : truck.customerId;
        const nextDestinationId = data.destinationId !== undefined ? data.destinationId : truck.destinationId;
        const nextSalesOrderNumber =
          data.salesOrderNumber !== undefined ? data.salesOrderNumber : truck.salesOrderNumber;
        const nextPlateNumber =
          data.plateNumber !== undefined ? data.plateNumber.trim() : truck.plateNumber;
        const nextDriverName =
          data.driverName !== undefined ? data.driverName.trim() : truck.driverName;
        const nextNotes = data.notes !== undefined ? data.notes?.trim() || null : truck.notes;

        if (truck.status === "Queued") {
          await validateTruckReferences(tx, {
            customerId: nextCustomerId,
            destinationId: nextDestinationId,
            salesOrderNumber: nextSalesOrderNumber,
          });

          if (nextPlateNumber !== truck.plateNumber) {
            const existingOpen = await tx.truckOperation.findFirst({
              where: {
                id: { not: truckId },
                plateNumber: nextPlateNumber,
                status: { notIn: TERMINAL_STATUSES },
              },
              select: { id: true, status: true },
            });
            if (existingOpen) {
              throw new ServiceError("openTruckForPlateById", "CONFLICT", {
                truckId: existingOpen.id,
              });
            }
          }
        } else if (truck.status === "FirstWeigh" && data.destinationId !== undefined) {
          await validateTruckReferences(tx, { destinationId: nextDestinationId });
        }

        // Request items drive the internal-weighing exemption (scrap / billet
        // wire). Recompute it whenever they change so the flag never drifts
        // from the actual load. Stays undefined when items aren't being edited.
        let nextSkipInternalWeighing: boolean | undefined;
        if (data.requestItems !== undefined) {
          await validateTruckRequestItems(tx, data.requestItems);
          nextSkipInternalWeighing = await deriveSkipInternalWeighing(
            tx,
            data.requestItems,
          );
          // Slice 4 pre-validation filters should be invoked here once the
          // shared validation service exists; until then Approved edits are
          // still gated by status, permission, and catalog constraints.
        }

        const previousValue = {
          status: truck.status,
          customerId: truck.customerId,
          destinationId: truck.destinationId,
          plateNumber: truck.plateNumber,
          driverName: truck.driverName,
          salesOrderNumber: truck.salesOrderNumber,
          notes: truck.notes,
          operationalGrade: truck.operationalGrade,
          requestItems: truck.requestItems.map((item) => ({
            sizeId: item.sizeId,
            grade: item.grade,
            bundleCount: item.bundleCount,
            requestedTons: item.requestedTons ? Number(item.requestedTons) : null,
          })),
        };

        const updateData: Prisma.TruckOperationUpdateInput = {
          version: { increment: 1 },
        };

        if (nextSkipInternalWeighing !== undefined) {
          updateData.skipInternalWeighing = nextSkipInternalWeighing;
        }

        if (truck.status === "Queued") {
          updateData.customer = nextCustomerId
            ? { connect: { id: nextCustomerId } }
            : { disconnect: true };
          updateData.destination = nextDestinationId
            ? { connect: { id: nextDestinationId } }
            : { disconnect: true };
          updateData.salesOrder = nextSalesOrderNumber
            ? { connect: { orderNumber: nextSalesOrderNumber } }
            : { disconnect: true };
          updateData.plateNumber = nextPlateNumber;
          updateData.driverName = nextDriverName;
          updateData.notes = nextNotes;
          updateData.operationalGrade =
            data.operationalGrade !== undefined ? data.operationalGrade : truck.operationalGrade;
        } else if (truck.status === "FirstWeigh") {
          if (data.destinationId !== undefined) {
            updateData.destination = nextDestinationId
              ? { connect: { id: nextDestinationId } }
              : { disconnect: true };
          }
          if (data.driverName !== undefined) updateData.driverName = nextDriverName;
          if (data.notes !== undefined) updateData.notes = nextNotes;
          if (data.operationalGrade !== undefined) {
            updateData.operationalGrade = data.operationalGrade;
          }
        }

        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: updateData,
        });

        // Keep the open (still unconfirmed) round's grade in sync with the
        // operation-level grade — round 1 inherits it at tare time, so an
        // edit before loading starts must propagate.
        if (truck.status === "FirstWeigh" && data.operationalGrade !== undefined) {
          await tx.bridgeRound.updateMany({
            where: {
              truckOperationId: truckId,
              endWeightKg: null,
              loadingConfirmedAt: null,
            },
            data: { grade: data.operationalGrade },
          });
        }

        if (data.requestItems !== undefined) {
          await tx.truckRequestItem.deleteMany({ where: { truckOperationId: truckId } });
          if (data.requestItems.length > 0) {
            await tx.truckRequestItem.createMany({
              data: data.requestItems.map((item) => ({
                truckOperationId: truckId,
                sizeId: item.sizeId,
                grade: item.grade ?? null,
                bundleCount: item.bundleCount ?? null,
                requestedTons: item.requestedTons ?? null,
              })),
            });
          }
        }

        const auditEvent =
          truck.status === "FirstWeigh"
            ? "truck_updated_after_tare"
            : "truck_updated_before_weigh";

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: auditEvent,
            editedAfterTare: truck.status === "FirstWeigh",
            previousValue,
            newValue: {
              status: updated.status,
              customerId: updated.customerId,
              destinationId: updated.destinationId,
              plateNumber: updated.plateNumber,
              driverName: updated.driverName,
              salesOrderNumber: updated.salesOrderNumber,
              notes: updated.notes,
              operationalGrade: updated.operationalGrade,
              requestItems: data.requestItems ?? previousValue.requestItems,
            },
          } as unknown as Prisma.InputJsonValue,
        });

        logger.info({ truckId, status: truck.status }, "truck updated before weigh");
        const reloaded = await tx.truckOperation.findUnique({
          where: { id: truckId },
          include: DETAIL_INCLUDE,
        });
        if (!reloaded) throw new ServiceError("operationNotFound", "NOT_FOUND");
        return reloaded;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Update Notes (mid-weighing) ───────────────────────────────────
//
// Once a truck is on the bridge the registration and order data is frozen,
// but operators still need to record operational notes (e.g. why a weighing
// was retried, a plate discrepancy, …). In these statuses `notes` is the ONLY
// mutable field — every other field stays locked exactly as before. Callers
// (the API layer) must reject any non-notes field before reaching here.
const NOTES_EDITABLE_STATUSES: TruckStatus[] = ["OnScale", "LoadingComplete", "SecondWeigh"];

export async function updateTruckNotes(
  truckId: number,
  notes: string | null,
  expectedVersion: number,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          select: { id: true, version: true, status: true, notes: true },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        if (truck.version !== expectedVersion) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        if (!NOTES_EDITABLE_STATUSES.includes(truck.status)) {
          throw new ServiceError("cannotEditNotesInCurrentStatus");
        }

        const nextNotes = notes?.trim() || null;

        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: { notes: nextNotes, version: { increment: 1 } },
        });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "truck_notes_updated",
            previousValue: { status: truck.status, notes: truck.notes },
            newValue: { status: updated.status, notes: updated.notes },
          } as unknown as Prisma.InputJsonValue,
        });

        logger.info({ truckId, status: truck.status }, "truck notes updated");

        const reloaded = await tx.truckOperation.findUnique({
          where: { id: truckId },
          include: DETAIL_INCLUDE,
        });
        if (!reloaded) throw new ServiceError("operationNotFound", "NOT_FOUND");
        return reloaded;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Enter Tare ────────────────────────────────────────────────────

export async function enterTare(truckId: number, weightKg: number, userId: number) {
  // Hard-rail check first (catches 0, negative, NaN, Infinity, >100t).
  const rangeError = validateWeightRange(weightKg);
  if (rangeError) throw toServiceError(rangeError);
  const tareError = validateTareWeight(weightKg);
  if (tareError) throw toServiceError(tareError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Row lock prevents two operators from simultaneously recording tare
        // (same transition, both would pass assertTransition on stale reads).
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        // Explicit "no double tare" message — clearer than the generic
        // state-machine error for the most common misclick.
        if (truck.tareWeightKg != null) {
          throw new ServiceError("tareAlreadyEntered", "CONFLICT", {
            kg: Number(truck.tareWeightKg),
          });
        }

        assertTransition(truck.status, "FirstWeigh");

        const tareTime = new Date();
        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            tareWeightKg: weightKg,
            tareTime,
            status: "FirstWeigh",
          },
        });

        // Open bridge round 1: starts at the tare weight, inherits the
        // operation-level grade as a default (loader can override at
        // loading-complete time).
        const round = await tx.bridgeRound.create({
          data: {
            truckOperationId: truckId,
            roundNumber: 1,
            grade: truck.operationalGrade ?? null,
            startWeightKg: weightKg,
            startTime: tareTime,
          },
        });

        // Adopt photos uploaded before the tare (no round existed yet).
        await tx.truckPhoto.updateMany({
          where: { truckOperationId: truckId, bridgeRoundId: null },
          data: { bridgeRoundId: round.id },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "tare_recorded",
            previousValue: { status: truck.status, tareWeightKg: null },
            newValue: { status: "FirstWeigh", tareWeightKg: weightKg, roundNumber: 1 },
          },
        });

        logger.info({ truckId, weightKg }, "tare entered");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Correct Tare (before gross only) ─────────────────────────────

export async function correctTare(
  truckId: number,
  newWeightKg: number,
  expectedVersion: number,
  userId: number,
) {
  if (newWeightKg <= 0) throw new ServiceError("weightMustBePositive");
  const tareError = validateTareWeight(newWeightKg);
  if (tareError) throw toServiceError(tareError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        const allowed: TruckStatus[] = ["FirstWeigh", "OnScale", "LoadingComplete"];
        if (!allowed.includes(truck.status)) {
          throw new ServiceError("cannotCorrectTareAfterGross");
        }

        // Once any round is closed its end weight chains into the next
        // round's start — changing the tare then would break the chain.
        const closedRound = await tx.bridgeRound.findFirst({
          where: { truckOperationId: truckId, endWeightKg: { not: null } },
          select: { id: true },
        });
        if (closedRound) {
          throw new ServiceError("cannotCorrectTareAfterExternalWeigh");
        }

        const oldWeight = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;

        // Optimistic lock: update only if the version the client saw is still
        // the current version. Two operators correcting at the same time will
        // both target the same expectedVersion; only the first commits, the
        // second sees count=0 and is asked to reload.
        const correctedAt = new Date();
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: {
            tareWeightKg: newWeightKg,
            tareTime: correctedAt,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        // Round 1 starts at the tare — keep its start weight in sync.
        await tx.bridgeRound.updateMany({
          where: { truckOperationId: truckId, roundNumber: 1 },
          data: { startWeightKg: newWeightKg, startTime: correctedAt },
        });

        const updated = await tx.truckOperation.findUnique({ where: { id: truckId } });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            action: "tare_correction",
            oldTareWeightKg: oldWeight,
            newTareWeightKg: newWeightKg,
            expectedVersion,
          },
        });

        logger.info({ truckId, oldWeight, newWeightKg }, "tare corrected");
        return updated!;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Correct Gross (last external weighing, before close only) ────

export async function correctGross(
  truckId: number,
  newWeightKg: number,
  expectedVersion: number,
  userId: number,
) {
  if (newWeightKg <= 0) throw new ServiceError("weightMustBePositive");

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        const allowed: TruckStatus[] = [
          "FirstWeigh",
          "OnScale",
          "LoadingComplete",
          "SecondWeigh",
        ];
        if (!allowed.includes(truck.status)) {
          throw new ServiceError("cannotCorrectGrossAfterClose");
        }

        // Only the LAST closed round may be corrected: earlier rounds' end
        // weights are already chained into later rounds that may be closed.
        const round = await tx.bridgeRound.findFirst({
          where: { truckOperationId: truckId, endWeightKg: { not: null } },
          orderBy: { roundNumber: "desc" },
        });
        if (!round) {
          throw new ServiceError("noExternalWeighToCorrect");
        }

        const startKg = Number(round.startWeightKg);
        if (new Decimal(newWeightKg).lte(round.startWeightKg)) {
          throw new ServiceError("grossMustExceedRoundStart");
        }
        const grossError = validateGrossWeight(newWeightKg, startKg);
        if (grossError) throw toServiceError(grossError);

        // Exempt trucks (scrap / billet wire) mirror the round net as one
        // system-generated weigh session (see enterGross). When the external
        // weight is corrected the mirror must follow, otherwise by-size reports
        // and the discrepancy drift. Updated BEFORE the discrepancy is computed
        // so it stays zero.
        if (truck.skipInternalWeighing) {
          const correctedNetTons = new Decimal(newWeightKg)
            .minus(startKg)
            .dividedBy(1000)
            .toFixed(3);
          await tx.weighSession.updateMany({
            where: { bridgeRoundId: round.id },
            data: { weightTons: correctedNetTons, version: { increment: 1 } },
          });
        }

        const internalTotalTons = await loadRoundInternalTons(tx, round.id);
        const discrepancyFields = buildWeighbridgeDiscrepancyAuditFields({
          tareKg: startKg,
          grossKg: newWeightKg,
          internalTotalTons,
        });

        const oldWeight = Number(round.endWeightKg);
        const correctedAt = new Date();

        // Optimistic lock — see correctTare for the full rationale. The
        // operation-level version guards both the final-gross case and the
        // mid-visit case (every correction bumps it).
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: round.isFinal
            ? {
                grossWeightKg: newWeightKg,
                grossTime: correctedAt,
                version: { increment: 1 },
              }
            : { version: { increment: 1 } },
        });
        if (result.count === 0) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        await tx.bridgeRound.update({
          where: { id: round.id },
          data: {
            endWeightKg: newWeightKg,
            endTime: correctedAt,
            version: { increment: 1 },
          },
        });

        // Cascade: the corrected end weight is the start weight of the next
        // (open) round — keep the chain intact.
        const cascaded = await tx.bridgeRound.updateMany({
          where: { truckOperationId: truckId, roundNumber: round.roundNumber + 1 },
          data: { startWeightKg: newWeightKg },
        });

        const updated = await tx.truckOperation.findUnique({ where: { id: truckId } });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            action: "gross_correction",
            roundNumber: round.roundNumber,
            isFinalRound: round.isFinal,
            cascadedToNextRound: cascaded.count > 0,
            oldGrossWeightKg: oldWeight,
            newGrossWeightKg: newWeightKg,
            expectedVersion,
            ...discrepancyFields,
          },
        });

        logger.info(
          { truckId, roundNumber: round.roundNumber, oldWeight, newWeightKg },
          "gross corrected",
        );
        return updated!;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Enter Weigh Session (internal) ───────────────────────────────

export interface WeighSessionInput {
  sizeId?: number | null;
  bundleCount?: number | null;
  weightTons: number;
  sourceLocationId?: number | null;
  /** Loaded directly off the production line — no yard source. */
  fromProduction?: boolean;
}

/**
 * Validate a chosen stock source location for a weigh session and enforce the
 * bundle-count/size rules. Returns the resolved sourceLocationId to persist.
 * Shared by enter/edit so both paths behave identically.
 */
async function resolveWeighSource(
  tx: TxClient,
  sourceLocationId: number | null | undefined,
  bundleCount: number | null | undefined,
  sizeId: number | null | undefined,
): Promise<number | null> {
  if (sourceLocationId == null) return null;
  const loc = await tx.stockLocation.findUnique({
    where: { id: sourceLocationId },
    select: { id: true, isActive: true, unit: true },
  });
  if (!loc) throw new ServiceError("sourceStockLocationNotFound");
  if (!loc.isActive) throw new ServiceError("sourceStockLocationDisabled");
  // Bundle sites must carry a bundle count AND a size so the load-out
  // deduction at close knows how many bundles of which size left the yard.
  // Without the size the LOAD_OUT row would carry a null size at a bundle
  // location and corrupt the per-size balances.
  if (loc.unit === "BUNDLE") {
    if (bundleCount == null || bundleCount <= 0) {
      throw new ServiceError("bundleCountRequiredForBundleLocation");
    }
    if (sizeId == null) {
      throw new ServiceError("sizeRequiredForBundleLocation");
    }
  }
  return loc.id;
}

export async function enterWeighSession(
  truckId: number,
  data: WeighSessionInput,
  userId: number,
) {
  if (data.weightTons <= 0) throw new ServiceError("weightMustBePositive");

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Pessimistic row lock on the truck serializes concurrent
        // enterWeighSession calls for the same truck. Without this lock two
        // internal-loading workers can both compute the same next
        // sessionNumber and hit the unique (truck_operation_id, session_number)
        // constraint. Because the FOR UPDATE lock already serializes all
        // write paths for this truck, ReadCommitted is sufficient and avoids
        // the thundering P2034 herd that Serializable's SSI checker emits
        // under heavy contention (observed: 10 parallel workers → ~5 aborts
        // even with the row lock). Correctness of the `FirstWeigh → OnScale`
        // transition is preserved because only the lock holder ever reads
        // and writes at a given moment.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        if (truck.skipInternalWeighing) {
          throw new ServiceError("scrapTruckNoInternalWeighsScaleOnly");
        }

        if (truck.status !== "FirstWeigh" && truck.status !== "OnScale") {
          throw new ServiceError("cannotAddWeighInCurrentStatus");
        }

        const openRound = await getOpenRound(tx, truckId);
        if (!openRound) {
          // Defensive: FirstWeigh/OnScale always implies an open round.
          throw new ServiceError("noOpenScaleRound");
        }

        if (data.sizeId) {
          const size = await tx.sizeLookup.findUnique({ where: { id: data.sizeId } });
          if (!size || !size.isActive) throw new ServiceError("sizeInvalid");
        }

        // Direct-from-production cross-dock has no yard source; the two are
        // mutually exclusive.
        const fromProduction = data.fromProduction === true;
        const sourceLocationId = fromProduction
          ? null
          : await resolveWeighSource(tx, data.sourceLocationId, data.bundleCount, data.sizeId);

        const lastSession = await tx.weighSession.findFirst({
          where: { truckOperationId: truckId },
          orderBy: { sessionNumber: "desc" },
        });
        const nextNumber = (lastSession?.sessionNumber ?? 0) + 1;

        const session = await tx.weighSession.create({
          data: {
            truckOperationId: truckId,
            bridgeRoundId: openRound.id,
            sessionNumber: nextNumber,
            sizeId: data.sizeId || null,
            bundleCount: data.bundleCount || null,
            weightTons: data.weightTons,
            sourceLocationId,
            fromProduction,
          },
        });

        if (truck.status === "FirstWeigh") {
          await tx.truckOperation.update({
            where: { id: truckId },
            data: { status: "OnScale" },
          });
        }

        await logAudit(tx, {
          userId,
          action: "create",
          entityType: "WeighSession",
          entityId: String(session.id),
          details: {
            truckId,
            roundNumber: openRound.roundNumber,
            sessionNumber: nextNumber,
            weightTons: data.weightTons,
            sizeId: data.sizeId,
            sourceLocationId,
          },
        });

        logger.info({ truckId, sessionId: session.id, sessionNumber: nextNumber }, "weigh session added");
        return session;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Edit Weigh Session ───────────────────────────────────────────

export async function editWeighSession(
  truckId: number,
  sessionId: number,
  expectedVersion: number,
  data: Partial<WeighSessionInput>,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        if (truck.status !== "OnScale" && truck.status !== "FirstWeigh") {
          throw new ServiceError("cannotEditWeighsAfterLoadingComplete");
        }

        const session = await tx.weighSession.findUnique({ where: { id: sessionId } });
        if (!session || session.truckOperationId !== truckId) {
          throw new ServiceError("weighNotFound", "NOT_FOUND");
        }

        // Sessions of an already-weighed round are frozen — their round's
        // external net is recorded and must stay reconcilable.
        const openRound = await getOpenRound(tx, truckId);
        if (!openRound || session.bridgeRoundId !== openRound.id) {
          throw new ServiceError("cannotEditWeighOfPreviousRoundAfterExternal");
        }

        if (data.weightTons !== undefined && data.weightTons <= 0) {
          throw new ServiceError("weightMustBePositive");
        }

        // Post-edit cross-dock flag. When on, the source must be null and no
        // yard-source validation applies.
        const effectiveFromProduction =
          data.fromProduction !== undefined
            ? data.fromProduction
            : session.fromProduction;

        // Validate the source/bundle-count/size rules against the POST-edit
        // state so e.g. clearing the bundle count or size on a bundle source
        // is rejected.
        const effectiveSource = effectiveFromProduction
          ? null
          : data.sourceLocationId !== undefined
            ? data.sourceLocationId
            : session.sourceLocationId;
        const effectiveBundle =
          data.bundleCount !== undefined ? data.bundleCount : session.bundleCount;
        const effectiveSize = data.sizeId !== undefined ? data.sizeId : session.sizeId;
        const resolvedSource = await resolveWeighSource(
          tx,
          effectiveSource,
          effectiveBundle,
          effectiveSize,
        );

        // Optimistic lock against two concurrent edits of the same weigh
        // session. Use the "unchecked" variant so we can set the FK scalar
        // `sizeId` directly (updateMany cannot nest relation writes).
        const updateData: Prisma.WeighSessionUncheckedUpdateManyInput = {
          version: { increment: 1 },
        };
        if (data.weightTons !== undefined) updateData.weightTons = data.weightTons;
        if (data.sizeId !== undefined) updateData.sizeId = data.sizeId ?? null;
        if (data.bundleCount !== undefined) updateData.bundleCount = data.bundleCount;
        // Switching a session to/from production keeps source and flag in sync.
        if (data.fromProduction !== undefined) {
          updateData.fromProduction = effectiveFromProduction;
          updateData.sourceLocationId = effectiveFromProduction ? null : resolvedSource;
        } else if (data.sourceLocationId !== undefined) {
          updateData.sourceLocationId = resolvedSource;
        }

        const result = await tx.weighSession.updateMany({
          where: { id: sessionId, version: expectedVersion },
          data: updateData,
        });
        if (result.count === 0) {
          throw new ServiceError("weighModifiedByAnotherUser", "CONFLICT");
        }

        const updated = await tx.weighSession.findUnique({ where: { id: sessionId } });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "WeighSession",
          entityId: String(sessionId),
          details: { truckId, changes: data, expectedVersion },
        });

        logger.info({ truckId, sessionId }, "weigh session edited");
        return updated!;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Delete Weigh Session ─────────────────────────────────────────

export async function deleteWeighSession(
  truckId: number,
  sessionId: number,
  expectedVersion: number,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          select: { id: true, status: true },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        if (truck.status !== "OnScale" && truck.status !== "FirstWeigh") {
          throw new ServiceError("cannotDeleteWeighsAfterLoadingComplete");
        }

        const session = await tx.weighSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            truckOperationId: true,
            bridgeRoundId: true,
            sessionNumber: true,
            sizeId: true,
            bundleCount: true,
            weightTons: true,
            version: true,
          },
        });
        if (!session || session.truckOperationId !== truckId) {
          throw new ServiceError("weighNotFound", "NOT_FOUND");
        }

        // Same freeze rule as editWeighSession: only the open round's
        // sessions may be deleted.
        const openRoundForDelete = await getOpenRound(tx, truckId);
        if (!openRoundForDelete || session.bridgeRoundId !== openRoundForDelete.id) {
          throw new ServiceError("cannotDeleteWeighOfPreviousRoundAfterExternal");
        }

        const deletedSnapshot = {
          sessionNumber: session.sessionNumber,
          sizeId: session.sizeId,
          bundleCount: session.bundleCount,
          weightTons: Number(session.weightTons),
          version: session.version,
        };

        const result = await tx.weighSession.deleteMany({
          where: { id: sessionId, version: expectedVersion },
        });
        if (result.count === 0) {
          throw new ServiceError("weighModifiedByAnotherUser", "CONFLICT");
        }

        let newStatus = truck.status;
        if (truck.status === "OnScale") {
          // Only the open round's sessions matter: earlier rounds' sessions
          // never reset the status of the current round.
          const remaining = await tx.weighSession.count({
            where: { bridgeRoundId: openRoundForDelete.id },
          });
          if (remaining === 0) {
            await tx.truckOperation.update({
              where: { id: truckId },
              data: { status: "FirstWeigh" },
            });
            newStatus = "FirstWeigh";
          }
        }

        await logAudit(tx, {
          userId,
          action: "delete",
          entityType: "WeighSession",
          entityId: String(sessionId),
          details: {
            truckId,
            deleted: deletedSnapshot,
            expectedVersion,
            truckStatusAfter: newStatus,
          },
        });

        logger.info(
          { truckId, sessionId, sessionNumber: session.sessionNumber, newStatus },
          "weigh session deleted",
        );
        return { truckStatus: newStatus };
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Admin Post-Close Corrections ─────────────────────────────────
//
// A narrow administrative escape hatch (permission `scale.correct_completed`,
// admin only) to fix data-entry mistakes discovered AFTER a truck is closed
// (`Completed`). Unlike the operational correction paths above, these functions
// NEVER change `status` — the truck stays `Completed` — and operate on an
// explicit `roundId` rather than "the open round" (a completed truck has none).
// Every function requires a written `reason` and writes a full before/after
// audit entry. Scrap / billet-wire trucks (`skipInternalWeighing`) carry a
// single system-generated mirror session, so manual session edits are refused
// for them; weight corrections keep the mirror in sync instead.

function assertCompletedForCorrection(status: TruckStatus) {
  if (status !== "Completed") {
    throw new ServiceError("adminCorrectionOnlyForCompletedTrucks");
  }
}

export async function correctCompletedRoundGrade(
  truckId: number,
  roundId: number,
  grade: SalesOrderGrade | null,
  reason: string,
  expectedVersion: number,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          select: {
            id: true,
            status: true,
            operationalGrade: true,
            salesOrder: { select: { grade: true } },
          },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);

        const round = await tx.bridgeRound.findUnique({ where: { id: roundId } });
        if (!round || round.truckOperationId !== truckId) {
          throw new ServiceError("scaleRoundNotFound", "NOT_FOUND");
        }

        const oldGrade = round.grade;
        const result = await tx.bridgeRound.updateMany({
          where: { id: roundId, version: expectedVersion },
          data: { grade, version: { increment: 1 } },
        });
        if (result.count === 0) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        // Keep the operation-level DISPLAY grade (`operationalGrade`) in sync
        // so the header "النخب" card matches the corrected round. This is
        // display-only: reports key off per-round grade for completed trucks.
        // Skipped when a linked sales order drives the grade (contract-
        // authoritative). Applied only when every round shares one grade —
        // a mixed multi-round visit has no single representative grade, so the
        // per-round table stays the source of truth and operationalGrade is
        // left untouched.
        let operationalGradeAfter = truck.operationalGrade;
        if (truck.salesOrder?.grade == null) {
          const rounds = await tx.bridgeRound.findMany({
            where: { truckOperationId: truckId },
            select: { grade: true },
          });
          const distinct = [...new Set(rounds.map((r) => r.grade))];
          if (distinct.length === 1 && distinct[0] !== truck.operationalGrade) {
            operationalGradeAfter = distinct[0];
            await tx.truckOperation.update({
              where: { id: truckId },
              data: { operationalGrade: distinct[0] },
            });
          }
        }

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "BridgeRound",
          entityId: String(roundId),
          details: {
            event: "completed_grade_corrected",
            truckId,
            roundNumber: round.roundNumber,
            oldGrade,
            newGrade: grade,
            operationalGradeAfter,
            reason,
            expectedVersion,
          },
        });

        logger.info(
          { truckId, roundId, oldGrade, newGrade: grade },
          "completed round grade corrected",
        );
        return tx.truckOperation.findUnique({
          where: { id: truckId },
          include: DETAIL_INCLUDE,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function correctCompletedTare(
  truckId: number,
  newWeightKg: number,
  reason: string,
  expectedVersion: number,
  userId: number,
) {
  const tareError = validateTareWeight(newWeightKg);
  if (tareError) throw toServiceError(tareError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);

        // Tare is round 1's START weight. Changing it only shifts round 1's
        // net (end − start); later rounds chain off round 1's END (a fixed
        // bridge reading) and are unaffected — so no cascade is needed.
        const round1 = await tx.bridgeRound.findFirst({
          where: { truckOperationId: truckId, roundNumber: 1 },
        });
        if (!round1) {
          throw new ServiceError("noFirstScaleRound", "NOT_FOUND");
        }
        if (round1.endWeightKg != null && new Decimal(newWeightKg).gte(round1.endWeightKg)) {
          throw new ServiceError("tareMustBeLessThanFirstRoundEnd");
        }

        const oldWeight = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;
        const correctedAt = new Date();
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: {
            tareWeightKg: newWeightKg,
            tareTime: correctedAt,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        await tx.bridgeRound.update({
          where: { id: round1.id },
          data: { startWeightKg: newWeightKg, version: { increment: 1 } },
        });

        // Scrap / billet-wire: the single mirror session equals the round net.
        if (truck.skipInternalWeighing && round1.endWeightKg != null) {
          const correctedNetTons = new Decimal(round1.endWeightKg)
            .minus(newWeightKg)
            .dividedBy(1000)
            .toFixed(3);
          await tx.weighSession.updateMany({
            where: { bridgeRoundId: round1.id },
            data: { weightTons: correctedNetTons, version: { increment: 1 } },
          });
        }

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "completed_tare_corrected",
            roundNumber: 1,
            oldTareWeightKg: oldWeight,
            newTareWeightKg: newWeightKg,
            reason,
            expectedVersion,
          },
        });

        logger.info({ truckId, oldWeight, newWeightKg }, "completed tare corrected");
        return tx.truckOperation.findUnique({
          where: { id: truckId },
          include: DETAIL_INCLUDE,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function correctCompletedExternalCardNumber(
  truckId: number,
  externalCardNumber: string,
  reason: string,
  expectedVersion: number,
  userId: number,
) {
  const cardNumber = externalCardNumber.trim();
  if (!cardNumber) {
    throw new ServiceError("weighbridgeCardRequired");
  }

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          select: {
            id: true,
            status: true,
            externalCardNumber: true,
          },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);

        if (truck.externalCardNumber === cardNumber) {
          throw new ServiceError("weighbridgeCardUnchanged");
        }

        const duplicate = await tx.truckOperation.findUnique({
          where: { externalCardNumber: cardNumber },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== truckId) {
          throw new ServiceError("weighbridgeCardAlreadyUsed", "CONFLICT", {
            cardNumber,
            truckId: duplicate.id,
          });
        }

        const oldCardNumber = truck.externalCardNumber;
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: {
            externalCardNumber: cardNumber,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "completed_external_card_corrected",
            oldExternalCardNumber: oldCardNumber,
            newExternalCardNumber: cardNumber,
            reason,
            expectedVersion,
          },
        });

        logger.info(
          { truckId, oldCardNumber, newCardNumber: cardNumber },
          "completed external card number corrected",
        );
        return tx.truckOperation.findUnique({
          where: { id: truckId },
          include: DETAIL_INCLUDE,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function correctCompletedRoundExternal(
  truckId: number,
  roundId: number,
  newWeightKg: number,
  reason: string,
  expectedVersion: number,
  userId: number,
) {
  if (newWeightKg <= 0) throw new ServiceError("weightMustBePositive");

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);

        const round = await tx.bridgeRound.findUnique({ where: { id: roundId } });
        if (!round || round.truckOperationId !== truckId) {
          throw new ServiceError("scaleRoundNotFound", "NOT_FOUND");
        }
        if (round.endWeightKg == null) {
          throw new ServiceError("noExternalWeighForRoundToCorrect");
        }

        const startKg = Number(round.startWeightKg);
        if (new Decimal(newWeightKg).lte(round.startWeightKg)) {
          throw new ServiceError("grossMustExceedRoundStart");
        }
        const grossError = validateGrossWeight(newWeightKg, startKg);
        if (grossError) throw toServiceError(grossError);

        // Keep the scrap / billet-wire mirror session in sync BEFORE computing
        // the discrepancy so it stays zero for exempt trucks.
        if (truck.skipInternalWeighing) {
          const correctedNetTons = new Decimal(newWeightKg)
            .minus(startKg)
            .dividedBy(1000)
            .toFixed(3);
          await tx.weighSession.updateMany({
            where: { bridgeRoundId: round.id },
            data: { weightTons: correctedNetTons, version: { increment: 1 } },
          });
        }

        const internalTotalTons = await loadRoundInternalTons(tx, round.id);
        const discrepancyFields = buildWeighbridgeDiscrepancyAuditFields({
          tareKg: startKg,
          grossKg: newWeightKg,
          internalTotalTons,
        });

        const oldWeight = Number(round.endWeightKg);
        const correctedAt = new Date();
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: round.isFinal
            ? {
                grossWeightKg: newWeightKg,
                grossTime: correctedAt,
                version: { increment: 1 },
              }
            : { version: { increment: 1 } },
        });
        if (result.count === 0) {
          throw new ServiceError("recordModifiedByAnotherUser", "CONFLICT");
        }

        await tx.bridgeRound.update({
          where: { id: round.id },
          data: {
            endWeightKg: newWeightKg,
            endTime: correctedAt,
            version: { increment: 1 },
          },
        });

        // Cascade: this round's end weight is the next round's start weight.
        const cascaded = await tx.bridgeRound.updateMany({
          where: { truckOperationId: truckId, roundNumber: round.roundNumber + 1 },
          data: { startWeightKg: newWeightKg },
        });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "completed_external_corrected",
            roundNumber: round.roundNumber,
            isFinalRound: round.isFinal,
            cascadedToNextRound: cascaded.count > 0,
            oldEndWeightKg: oldWeight,
            newEndWeightKg: newWeightKg,
            reason,
            expectedVersion,
            ...discrepancyFields,
          },
        });

        logger.info(
          { truckId, roundId, oldWeight, newWeightKg, isFinal: round.isFinal },
          "completed external weighing corrected",
        );
        return tx.truckOperation.findUnique({
          where: { id: truckId },
          include: DETAIL_INCLUDE,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function addCompletedSession(
  truckId: number,
  roundId: number,
  data: WeighSessionInput,
  reason: string,
  userId: number,
) {
  if (data.weightTons <= 0) throw new ServiceError("weightMustBePositive");

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);
        if (truck.skipInternalWeighing) {
          throw new ServiceError("scrapTruckNoInternalWeighs");
        }

        const round = await tx.bridgeRound.findUnique({ where: { id: roundId } });
        if (!round || round.truckOperationId !== truckId) {
          throw new ServiceError("scaleRoundNotFound", "NOT_FOUND");
        }

        if (data.sizeId) {
          const size = await tx.sizeLookup.findUnique({ where: { id: data.sizeId } });
          if (!size || !size.isActive) throw new ServiceError("sizeInvalid");
        }

        const lastSession = await tx.weighSession.findFirst({
          where: { truckOperationId: truckId },
          orderBy: { sessionNumber: "desc" },
        });
        const nextNumber = (lastSession?.sessionNumber ?? 0) + 1;

        const session = await tx.weighSession.create({
          data: {
            truckOperationId: truckId,
            bridgeRoundId: round.id,
            sessionNumber: nextNumber,
            sizeId: data.sizeId || null,
            bundleCount: data.bundleCount || null,
            weightTons: data.weightTons,
          },
        });

        await logAudit(tx, {
          userId,
          action: "create",
          entityType: "WeighSession",
          entityId: String(session.id),
          details: {
            event: "completed_session_added",
            truckId,
            roundNumber: round.roundNumber,
            sessionNumber: nextNumber,
            weightTons: data.weightTons,
            sizeId: data.sizeId ?? null,
            bundleCount: data.bundleCount ?? null,
            reason,
          },
        });

        logger.info(
          { truckId, roundId, sessionId: session.id, sessionNumber: nextNumber },
          "completed session added",
        );
        return session;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

export async function editCompletedSession(
  truckId: number,
  sessionId: number,
  data: Partial<WeighSessionInput>,
  reason: string,
  expectedVersion: number,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);
        if (truck.skipInternalWeighing) {
          throw new ServiceError("scrapTruckNoInternalWeighs");
        }

        const session = await tx.weighSession.findUnique({ where: { id: sessionId } });
        if (!session || session.truckOperationId !== truckId) {
          throw new ServiceError("weighNotFound", "NOT_FOUND");
        }

        if (data.weightTons !== undefined && data.weightTons <= 0) {
          throw new ServiceError("weightMustBePositive");
        }
        if (data.sizeId) {
          const size = await tx.sizeLookup.findUnique({ where: { id: data.sizeId } });
          if (!size || !size.isActive) throw new ServiceError("sizeInvalid");
        }

        const updateData: Prisma.WeighSessionUncheckedUpdateManyInput = {
          version: { increment: 1 },
        };
        if (data.weightTons !== undefined) updateData.weightTons = data.weightTons;
        if (data.sizeId !== undefined) updateData.sizeId = data.sizeId ?? null;
        if (data.bundleCount !== undefined) updateData.bundleCount = data.bundleCount;

        const result = await tx.weighSession.updateMany({
          where: { id: sessionId, version: expectedVersion },
          data: updateData,
        });
        if (result.count === 0) {
          throw new ServiceError("weighModifiedByAnotherUser", "CONFLICT");
        }

        const updated = await tx.weighSession.findUnique({ where: { id: sessionId } });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "WeighSession",
          entityId: String(sessionId),
          details: {
            event: "completed_session_edited",
            truckId,
            changes: data,
            reason,
            expectedVersion,
          },
        });

        logger.info({ truckId, sessionId }, "completed session edited");
        return updated!;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function deleteCompletedSession(
  truckId: number,
  sessionId: number,
  reason: string,
  expectedVersion: number,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          select: { id: true, status: true, skipInternalWeighing: true },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertCompletedForCorrection(truck.status);
        if (truck.skipInternalWeighing) {
          throw new ServiceError("scrapTruckNoInternalWeighs");
        }

        const session = await tx.weighSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            truckOperationId: true,
            bridgeRoundId: true,
            sessionNumber: true,
            sizeId: true,
            bundleCount: true,
            weightTons: true,
            version: true,
          },
        });
        if (!session || session.truckOperationId !== truckId) {
          throw new ServiceError("weighNotFound", "NOT_FOUND");
        }

        const deletedSnapshot = {
          sessionNumber: session.sessionNumber,
          sizeId: session.sizeId,
          bundleCount: session.bundleCount,
          weightTons: Number(session.weightTons),
          version: session.version,
        };

        const result = await tx.weighSession.deleteMany({
          where: { id: sessionId, version: expectedVersion },
        });
        if (result.count === 0) {
          throw new ServiceError("weighModifiedByAnotherUser", "CONFLICT");
        }

        // Deliberately NO status change here — the truck stays `Completed`.
        await logAudit(tx, {
          userId,
          action: "delete",
          entityType: "WeighSession",
          entityId: String(sessionId),
          details: {
            event: "completed_session_deleted",
            truckId,
            deleted: deletedSnapshot,
            reason,
            expectedVersion,
          },
        });

        logger.info(
          { truckId, sessionId, sessionNumber: session.sessionNumber },
          "completed session deleted",
        );
        return { deleted: true };
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Upload Photo ─────────────────────────────────────────────────

export async function uploadPhoto(truckId: number, filePath: string, userId: number) {
  const photo = await withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Re-check truck inside the serializable tx so a concurrent cancel or
        // close cannot race a photo upload.
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        if (truck.status === "Completed" || truck.status === "Cancelled") {
          throw new ServiceError("cannotUploadPhotoForClosedOrCancelled");
        }

        // Attach to the open round when one exists; pre-tare photos stay
        // unassigned and are adopted by round 1 in enterTare.
        const openRound = await getOpenRound(tx, truckId);

        const created = await tx.truckPhoto.create({
          data: {
            truckOperationId: truckId,
            bridgeRoundId: openRound?.id ?? null,
            filePath,
          },
        });

        await logAudit(tx, {
          userId,
          action: "upload",
          entityType: "TruckPhoto",
          entityId: String(created.id),
          details: { truckId, roundNumber: openRound?.roundNumber ?? null, filePath },
        });

        return created;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info({ truckId, photoId: photo.id }, "photo uploaded");
  return photo;
}

// ─── Loading Complete (Stage 1) ───────────────────────────────────

export async function confirmLoadingComplete(
  truckId: number,
  userId: number,
  roundGrade?: SalesOrderGrade | null,
  roundSizeId?: number | null,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Row lock serializes this confirmation with any in-flight
        // enterWeighSession (which also takes FOR UPDATE). This guarantees
        // the session count / totalInternalTons we log below reflect every
        // session that exists at commit time, not an earlier snapshot.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertTransition(truck.status, "LoadingComplete");

        const openRound = await getOpenRound(tx, truckId);
        if (!openRound) {
          throw new ServiceError("noOpenScaleRound");
        }

        // Re-query after the lock so both collections are up-to-date.
        // Requirements are PER ROUND: the current round needs at least one
        // session and one photo before its external weighing.
        const [sessions, photoCount] = await Promise.all([
          tx.weighSession.findMany({
            where: { bridgeRoundId: openRound.id },
            select: { weightTons: true },
          }),
          tx.truckPhoto.count({ where: { bridgeRoundId: openRound.id } }),
        ]);

        // Exempt trucks (scrap / billet wire) carry no internal weigh sessions;
        // the round net is recorded once at gross. They still require a photo.
        if (!truck.skipInternalWeighing && sessions.length === 0) {
          throw new ServiceError("atLeastOneWeighBeforeLoadingComplete");
        }
        if (photoCount === 0) {
          throw new ServiceError("atLeastOnePhotoBeforeLoadingComplete");
        }

        // Exempt trucks: resolve which material this round carried, so the
        // mirror session created at gross is attributed to the right size.
        // Single-size trucks resolve automatically; multi-size trucks require
        // the loader's explicit choice (one material per round).
        let nextRoundSizeId: number | null | undefined;
        if (truck.skipInternalWeighing) {
          const requestItems = await tx.truckRequestItem.findMany({
            where: { truckOperationId: truckId },
            select: { sizeId: true },
          });
          const distinctSizeIds = [...new Set(requestItems.map((i) => i.sizeId))];
          if (roundSizeId != null) {
            if (!distinctSizeIds.includes(roundSizeId)) {
              throw new ServiceError("roundMaterialMustBeInRequestItems");
            }
            nextRoundSizeId = roundSizeId;
          } else if (distinctSizeIds.length === 1) {
            nextRoundSizeId = distinctSizeIds[0];
          } else if (openRound.sizeId != null) {
            // Re-confirm after reopen keeps the previously chosen material.
            nextRoundSizeId = openRound.sizeId;
          } else {
            throw new ServiceError("multiMaterialRoundMaterialRequired");
          }
        }

        const totalInternalTons = sessions.reduce(
          (sum, s) => sum.plus(s.weightTons),
          new Decimal(0),
        );

        // Stamp loader identity + timestamp atomically with the transition,
        // on both the operation (two-role rule enforcement for enterGross)
        // and the round (per-round audit/dispute traceability).
        const confirmedAt = new Date();
        const nextGrade = roundGrade !== undefined ? roundGrade : openRound.grade;
        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            status: "LoadingComplete",
            loadingConfirmedAt: confirmedAt,
            loaderId: userId,
          },
        });
        await tx.bridgeRound.update({
          where: { id: openRound.id },
          data: {
            loadingConfirmedAt: confirmedAt,
            loaderId: userId,
            grade: nextGrade,
            ...(nextRoundSizeId !== undefined ? { sizeId: nextRoundSizeId } : {}),
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "loading_confirmed",
            previousValue: {
              status: truck.status,
              loadingConfirmedAt: truck.loadingConfirmedAt,
              loaderId: truck.loaderId,
            },
            newValue: {
              status: "LoadingComplete",
              loadingConfirmedAt: confirmedAt.toISOString(),
              loaderId: userId,
              roundNumber: openRound.roundNumber,
              roundGrade: nextGrade ?? null,
              roundSizeId: nextRoundSizeId ?? null,
              sessionCount: sessions.length,
              totalInternalTons: totalInternalTons.toNumber(),
            },
          },
        });

        logger.info(
          { truckId, roundNumber: openRound.roundNumber, sessions: sessions.length, loaderId: userId },
          "loading complete confirmed",
        );
        return updated;
      },
      // The FOR UPDATE lock above already serialises every writer of this
      // truck. ReadCommitted avoids the Serializable SSI checker's thundering
      // P2034 herd under heavy contention (see enterWeighSession for the same
      // rationale).
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Reopen Before Gross ──────────────────────────────────────────

export async function reopenBeforeGross(truckId: number, userId: number) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Row lock keeps this reopen serialised with any concurrent
        // confirmLoadingComplete, enterGross, cancel, etc. Without it two
        // operators can both flip the status back to OnScale and emit two
        // audit rows for a single logical transition.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        if (truck.status !== "LoadingComplete") {
          throw new ServiceError("reopenOnlyFromLoadingComplete");
        }

        // Reopen invalidates the prior loader confirmation — the loader must
        // re-confirm before gross can be recorded. Clearing both columns is
        // protected by the DB CHECK constraint
        // (truck_operations_loading_confirmation_pair_chk), which requires
        // them to be null-together or set-together.
        const reopenedAt = new Date();
        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            status: "OnScale",
            loadingConfirmedAt: null,
            loaderId: null,
            lastReopenedAt: reopenedAt,
          },
        });

        // Mirror the reset on the open round (same null-together CHECK).
        await tx.bridgeRound.updateMany({
          where: { truckOperationId: truckId, endWeightKg: null },
          data: {
            loadingConfirmedAt: null,
            loaderId: null,
            lastReopenedAt: reopenedAt,
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "session_reopened",
            previousValue: {
              status: "LoadingComplete",
              loadingConfirmedAt: truck.loadingConfirmedAt,
              loaderId: truck.loaderId,
            },
            newValue: {
              status: "OnScale",
              loadingConfirmedAt: null,
              loaderId: null,
            },
          },
        });

        logger.info({ truckId }, "loading complete reopened");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Enter Gross (external weighing — final exit or return) ───────

export type GrossExitMode = "final" | "return";

/**
 * Records an external-bridge weighing for the currently open round.
 *
 * - `exit = "final"` (default, single-round behaviour unchanged): closes the
 *   round as final, writes the operation-level gross weight, and moves the
 *   operation to `SecondWeigh` awaiting close.
 * - `exit = "return"` (multi-round): closes the round, then immediately opens
 *   the next round whose start weight IS this weighing — the truck goes back
 *   inside to load the next batch (other size/grade). The operation returns
 *   to `FirstWeigh` and the loader must confirm again before the next
 *   weighing.
 */
export async function enterGross(
  truckId: number,
  weightKg: number,
  userId: number,
  exit: GrossExitMode = "final",
) {
  // Hard-rail weight check before touching the DB.
  const rangeError = validateWeightRange(weightKg);
  if (rangeError) throw toServiceError(rangeError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Row lock: prevents a race where two operators submit gross weight
        // for the same truck in overlapping transactions. Without it, both
        // requests could pass assertTransition on an OnScale snapshot and
        // both would write (last-writer-wins silently).
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");

        // ── Two-role workflow rule (Part 1) ──────────────────────────
        // Gross weight CANNOT be recorded unless a loader has confirmed
        // loading completion. Checked BEFORE the state-machine transition
        // so the error message is user-friendly ("wait for the loader")
        // rather than the generic "invalid transition".
        if (!truck.loadingConfirmedAt) {
          throw new ServiceError("loadingMustBeConfirmedBeforeGross", "FORBIDDEN");
        }

        // Explicit "no double gross" — friendlier than a state-machine error.
        if (truck.grossWeightKg != null) {
          throw new ServiceError("grossAlreadyEntered", "CONFLICT", {
            kg: Number(truck.grossWeightKg),
          });
        }

        assertTransition(truck.status, exit === "final" ? "SecondWeigh" : "FirstWeigh");

        const openRound = await getOpenRound(tx, truckId);
        if (!openRound) {
          throw new ServiceError("noOpenScaleRound");
        }

        if (!truck.tareWeightKg) {
          throw new ServiceError("tareWeightRequiredFirst");
        }

        // The weighing must exceed the ROUND's start weight (= previous
        // external weighing), not just the original tare.
        const roundStartKg = Number(openRound.startWeightKg);
        if (new Decimal(weightKg).lte(openRound.startWeightKg)) {
          throw new ServiceError("grossMustExceedRoundStart");
        }
        const grossError = validateGrossWeight(weightKg, roundStartKg);
        if (grossError) throw toServiceError(grossError);

        // Exempt trucks (scrap / billet wire) record no internal sessions. When
        // the round is closed we mirror its external net as ONE
        // system-generated weigh session attributed to the ROUND's material
        // (chosen by the loader at loading-complete; falls back to the first
        // request item for legacy rounds recorded before per-round materials).
        // Created BEFORE the discrepancy is computed so internal == external
        // (zero discrepancy), and so every by-size report, the scale card, and
        // the dashboard kind breakdown keep working without special-casing.
        if (truck.skipInternalWeighing) {
          const roundSessionCount = await tx.weighSession.count({
            where: { bridgeRoundId: openRound.id },
          });
          if (roundSessionCount === 0) {
            let mirrorSizeId: number | null = openRound.sizeId;
            if (mirrorSizeId == null) {
              const requestItem = await tx.truckRequestItem.findFirst({
                where: { truckOperationId: truckId },
                select: { sizeId: true },
              });
              mirrorSizeId = requestItem?.sizeId ?? null;
            }
            const lastSession = await tx.weighSession.findFirst({
              where: { truckOperationId: truckId },
              orderBy: { sessionNumber: "desc" },
              select: { sessionNumber: true },
            });
            const netTons = new Decimal(weightKg)
              .minus(roundStartKg)
              .dividedBy(1000)
              .toFixed(3);
            await tx.weighSession.create({
              data: {
                truckOperationId: truckId,
                bridgeRoundId: openRound.id,
                sessionNumber: (lastSession?.sessionNumber ?? 0) + 1,
                sizeId: mirrorSizeId,
                bundleCount: null,
                weightTons: netTons,
              },
            });
          }
        }

        // Per-round discrepancy: this round's external net vs the sum of
        // ITS internal weigh sessions.
        const internalTotalTons = await loadRoundInternalTons(tx, openRound.id);
        const discrepancyFields = buildWeighbridgeDiscrepancyAuditFields({
          tareKg: roundStartKg,
          grossKg: weightKg,
          internalTotalTons,
        });

        const weighedAt = new Date();

        // Close the current round.
        await tx.bridgeRound.update({
          where: { id: openRound.id },
          data: {
            endWeightKg: weightKg,
            endTime: weighedAt,
            isFinal: exit === "final",
            version: { increment: 1 },
          },
        });

        let updated;
        if (exit === "final") {
          updated = await tx.truckOperation.update({
            where: { id: truckId },
            data: {
              grossWeightKg: weightKg,
              grossTime: weighedAt,
              status: "SecondWeigh",
            },
          });
        } else {
          // Open the next round: its start weight is this weighing — copied
          // automatically, never typed by an operator. Loader confirmation
          // resets so the two-role rule applies to the new round as well
          // (operation columns are null-together per the CHECK constraint).
          await tx.bridgeRound.create({
            data: {
              truckOperationId: truckId,
              roundNumber: openRound.roundNumber + 1,
              grade: null,
              startWeightKg: weightKg,
              startTime: weighedAt,
            },
          });
          updated = await tx.truckOperation.update({
            where: { id: truckId },
            data: {
              status: "FirstWeigh",
              loadingConfirmedAt: null,
              loaderId: null,
            },
          });
        }

        const roundNetKg = weightKg - roundStartKg;
        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: exit === "final" ? "gross_recorded" : "round_weighed_return",
            previousValue: {
              status: truck.status,
              grossWeightKg: null,
            },
            newValue: {
              status: exit === "final" ? "SecondWeigh" : "FirstWeigh",
              roundNumber: openRound.roundNumber,
              roundGrade: openRound.grade ?? null,
              roundStartWeightKg: roundStartKg,
              roundEndWeightKg: weightKg,
              roundNetKg,
              ...(exit === "final"
                ? {
                    grossWeightKg: weightKg,
                    tareWeightKg: Number(truck.tareWeightKg),
                    netWeightKg: weightKg - Number(truck.tareWeightKg),
                  }
                : { nextRoundNumber: openRound.roundNumber + 1 }),
              loaderId: truck.loaderId,
              loadingConfirmedAt: truck.loadingConfirmedAt,
              ...discrepancyFields,
            },
          },
        });

        logger.info(
          { truckId, weightKg, exit, roundNumber: openRound.roundNumber, roundNetKg },
          "external weighing entered",
        );
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Close Operation (Stage 2 — Final) ────────────────────────────

export async function closeOperation(
  truckId: number,
  userId: number,
  externalCardNumber: string,
) {
  // The finance-side weighbridge program issues a card number for the same
  // exit; closing is refused until the operator types it so both systems
  // always share one card number.
  const cardNumber = externalCardNumber.trim();
  if (!cardNumber) {
    throw new ServiceError("weighbridgeCardRequiredToClose");
  }

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Serialise against any concurrent correctGross / correctTare / edit
        // that might be in flight. The lock also ensures the `sessions`
        // snapshot we read (and hash into the audit log) reflects post-commit
        // state rather than an earlier view.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          include: {
            sessions: true,
            rounds: { orderBy: { roundNumber: "asc" } },
          },
        });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertTransition(truck.status, "Completed");

        if (!truck.tareWeightKg || !truck.grossWeightKg) {
          throw new ServiceError("tareAndGrossRequiredBeforeClose");
        }

        // Friendly duplicate check before the unique index fires. Runs inside
        // the same transaction; a true race still hits the DB unique
        // constraint, which withRetry surfaces as a P2002 → generic error.
        const duplicate = await tx.truckOperation.findUnique({
          where: { externalCardNumber: cardNumber },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== truckId) {
          throw new ServiceError("weighbridgeCardAlreadyUsed", "CONFLICT", {
            cardNumber,
            truckId: duplicate.id,
          });
        }

        const bridgeNetKg = new Decimal(truck.grossWeightKg).minus(truck.tareWeightKg);
        const internalTotalTons = truck.sessions.reduce(
          (sum, s) => sum.plus(s.weightTons),
          new Decimal(0),
        );
        const bridgeNetTons = bridgeNetKg.dividedBy(1000);

        const now = new Date();
        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            status: "Completed",
            closedAt: now,
            closedById: userId,
            externalCardNumber: cardNumber,
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            from: truck.status,
            to: "Completed",
            externalCardNumber: cardNumber,
            bridgeNetKg: bridgeNetKg.toNumber(),
            internalTotalTons: internalTotalTons.toNumber(),
            bridgeNetTons: bridgeNetTons.toNumber(),
            discrepancyTons: bridgeNetTons.minus(internalTotalTons).toNumber(),
            rounds: truck.rounds.map((r) => ({
              roundNumber: r.roundNumber,
              grade: r.grade,
              sizeId: r.sizeId,
              startWeightKg: Number(r.startWeightKg),
              endWeightKg: r.endWeightKg != null ? Number(r.endWeightKg) : null,
              netKg:
                r.endWeightKg != null
                  ? new Decimal(r.endWeightKg).minus(r.startWeightKg).toNumber()
                  : null,
            })),
          },
        });

        // Deduct stock for every session loaded from a stock location. Runs in
        // this same transaction so a rollback undoes the close and the
        // deduction together. Does not block the close on insufficient stock.
        const loadOut = await applyLoadOutForClose(tx, truckId, userId);

        logger.info(
          {
            truckId,
            externalCardNumber: cardNumber,
            bridgeNetKg: bridgeNetKg.toNumber(),
            internalTotalTons: internalTotalTons.toNumber(),
            stockDeducted: loadOut.deducted,
            stockSkipped: loadOut.skipped,
          },
          "truck operation closed",
        );
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Cancel Operation ─────────────────────────────────────────────

export async function cancelOperation(truckId: number, reason: string, userId: number) {
  if (!reason.trim()) throw new ServiceError("cancelReasonRequired");

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Row lock makes the cancel wait for any in-flight weigh session
        // insert (which also takes FOR UPDATE). Avoids the race where a
        // session commits a fraction of a second before a cancel and leaves
        // semantically orphaned rows on a cancelled truck.
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("operationNotFound", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
        assertTransition(truck.status, "Cancelled");

        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            status: "Cancelled",
            cancelReason: reason.trim(),
            closedAt: new Date(),
            closedById: userId,
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "session_cancelled",
            previousValue: {
              status: truck.status,
              cancelReason: truck.cancelReason,
              closedAt: truck.closedAt,
              closedById: truck.closedById,
            },
            newValue: {
              status: "Cancelled",
              cancelReason: reason.trim(),
              closedAt: updated.closedAt,
              closedById: userId,
            },
          },
        });

        logger.info({ truckId, reason }, "truck operation cancelled");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Get Operation Detail ─────────────────────────────────────────

const DETAIL_INCLUDE = {
  customer: { select: { id: true, fullName: true, code: true } },
  destination: { select: { id: true, name: true, nameEn: true, details: true } },
  requestItems: {
    orderBy: { size: { sortOrder: "asc" as const } },
    include: {
      size: {
        select: {
          id: true,
          code: true,
          displayName: true,
          displayNameEn: true,
          isBundleType: true,
        },
      },
    },
  },
  sessions: {
    orderBy: { sessionNumber: "asc" as const },
    include: {
      size: {
        select: {
          id: true,
          code: true,
          displayName: true,
          displayNameEn: true,
          isBundleType: true,
        },
      },
      sourceLocation: {
        select: {
          id: true,
          code: true,
          nameAr: true,
          nameEn: true,
          yard: { select: { id: true, nameAr: true, nameEn: true } },
        },
      },
    },
  },
  rounds: {
    orderBy: { roundNumber: "asc" as const },
    include: {
      loader: { select: { id: true, fullName: true, username: true } },
      size: { select: { id: true, displayName: true, displayNameEn: true } },
    },
  },
  photos: { orderBy: { capturedAt: "asc" as const } },
  creator: { select: { id: true, fullName: true, username: true } },
  closer: { select: { id: true, fullName: true, username: true } },
  loader: { select: { id: true, fullName: true, username: true } },
  salesOrder: {
    select: {
      orderNumber: true,
      kind: true,
      grade: true,
      totalQtyTons: true,
      contract: { select: { customer: { select: { id: true, fullName: true, code: true } } } },
    },
  },
} as const;

export type TruckOperationDetail = Prisma.TruckOperationGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

export async function getOperationDetail(truckId: number): Promise<TruckOperationDetail> {
  const truck = await prisma.truckOperation.findUnique({
    where: { id: truckId },
    include: DETAIL_INCLUDE,
  });
  if (!truck) throw new ServiceError("operationNotFound", "NOT_FOUND");
  return truck;
}

// ─── List Operations ──────────────────────────────────────────────

export interface TruckListFilters {
  status?: TruckStatus;
  plateNumber?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export type TruckListItem = Prisma.TruckOperationGetPayload<{
  include: {
    customer: { select: { id: true; fullName: true; code: true } };
    destination: { select: { id: true; name: true; nameEn: true; details: true } };
    requestItems: {
      include: {
        size: {
          select: {
            id: true;
            code: true;
            displayName: true;
            displayNameEn: true;
            isBundleType: true;
          };
        };
      };
    };
    creator: { select: { id: true; fullName: true } };
    _count: { select: { sessions: true; rounds: true } };
  };
}>;

export async function listOperations(
  filters: TruckListFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<TruckListItem>> {
  const where: Prisma.TruckOperationWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.plateNumber) {
    // One search box on the list screen: matches the plate number OR the
    // finance-program weighbridge-card number recorded at close.
    where.OR = [
      { plateNumber: { contains: filters.plateNumber, mode: "insensitive" } },
      { externalCardNumber: { contains: filters.plateNumber, mode: "insensitive" } },
    ];
  }
  // Analytics-start floor: events before the configured start date are
  // invisible in lists even when the caller sends no date filter at all.
  const window = await clampEventWindow(filters.dateFrom, filters.dateTo);
  if (window.from || window.to) {
    where.createdAt = {
      ...(window.from ? { gte: window.from } : {}),
      ...(window.to ? { lt: window.to } : {}),
    };
  }

  const [data, total] = await Promise.all([
    prisma.truckOperation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        customer: { select: { id: true, fullName: true, code: true } },
        destination: { select: { id: true, name: true, nameEn: true, details: true } },
        requestItems: {
          orderBy: { size: { sortOrder: "asc" as const } },
          include: {
            size: {
              select: {
                id: true,
                code: true,
                displayName: true,
                displayNameEn: true,
                isBundleType: true,
              },
            },
          },
        },
        creator: { select: { id: true, fullName: true } },
        _count: { select: { sessions: true, rounds: true } },
      },
    }),
    prisma.truckOperation.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

// ─── List Loaded Trucks (owner read-only view) ────────────────────

export interface LoadedTruckFilters {
  customer?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface LoadedTruckListItem {
  id: number;
  status: TruckStatus;
  customerName: string | null;
  destinationName: string | null;
  tareWeightKg: string | null;
  grossWeightKg: string | null;
  createdAt: Date;
  loadedSizes: WeighSessionSizeAggregate[];
}

/**
 * Simplified, read-only listing for the factory owner. Returns only the
 * columns the owner cares about (customer, destination, bridge net, date)
 * plus the actually-loaded sizes aggregated per size from weigh sessions.
 * Cancelled operations are always excluded.
 */
export async function listLoadedTrucks(
  filters: LoadedTruckFilters,
  pagination: PaginationParams,
  locale: Locale = "ar",
): Promise<PaginatedResult<LoadedTruckListItem>> {
  const where: Prisma.TruckOperationWhereInput = {
    status: { not: "Cancelled" },
  };

  if (filters.customer) {
    where.customer = {
      fullName: { contains: filters.customer, mode: "insensitive" },
    };
  }
  const window = await clampEventWindow(filters.dateFrom, filters.dateTo);
  if (window.from || window.to) {
    where.createdAt = {
      ...(window.from ? { gte: window.from } : {}),
      ...(window.to ? { lt: window.to } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.truckOperation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        customer: { select: { fullName: true } },
        destination: { select: { name: true, nameEn: true } },
        sessions: {
          orderBy: { sessionNumber: "asc" as const },
          include: {
            size: { select: { displayName: true, displayNameEn: true } },
          },
        },
      },
    }),
    prisma.truckOperation.count({ where }),
  ]);

  const data: LoadedTruckListItem[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    customerName: row.customer?.fullName ?? null,
    destinationName: localizedDestinationName(row.destination, locale),
    tareWeightKg: row.tareWeightKg != null ? row.tareWeightKg.toString() : null,
    grossWeightKg: row.grossWeightKg != null ? row.grossWeightKg.toString() : null,
    createdAt: row.createdAt,
    loadedSizes: aggregateWeighSessionsBySize(
      row.sessions.map((s) => ({
        sizeId: s.sizeId,
        bundleCount: s.bundleCount,
        weightTons: s.weightTons.toString(),
        size: s.size
          ? { displayName: localizedSize(s.size, locale) }
          : null,
      })),
    ),
  }));

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}
