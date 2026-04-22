import { prisma } from "@/lib/db";
import { logAudit } from "./audit.service";
import { ServiceError } from "./errors";
import { withRetry } from "./tx-retry";
import { logger } from "@/lib/logger";
import { Prisma, type TruckStatus } from "@prisma/client";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import Decimal from "decimal.js";
import {
  validateTareWeight,
  validateGrossWeight,
  validateWeightRange,
} from "@/lib/weight-bounds";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const VALID_TRANSITIONS: Record<TruckStatus, TruckStatus[]> = {
  Queued: ["FirstWeigh", "Cancelled"],
  Approved: ["FirstWeigh", "Cancelled"],
  FirstWeigh: ["OnScale", "Cancelled"],
  Loading: ["OnScale", "Cancelled"],
  OnScale: ["LoadingComplete", "Cancelled"],
  LoadingComplete: ["OnScale", "SecondWeigh", "Cancelled"],
  SecondWeigh: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

function assertTransition(current: TruckStatus, next: TruckStatus) {
  if (!VALID_TRANSITIONS[current]?.includes(next)) {
    throw new ServiceError(
      `لا يمكن الانتقال من الحالة "${current}" إلى "${next}"`,
    );
  }
}

// ─── Register ──────────────────────────────────────────────────────

export interface RequestItemInput {
  sizeId: number;
  bundleCount?: number | null;
  requestedTons?: number | null;
}

export interface RegisterTruckInput {
  customerId?: number | null;
  plateNumber: string;
  driverName: string;
  salesOrderNumber?: string | null;
  notes?: string | null;
  requestItems?: RequestItemInput[];
}

export async function registerTruck(data: RegisterTruckInput, userId: number) {
  if (data.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new ServiceError("الزبون غير موجود", "NOT_FOUND");
    if (!customer.isActive) throw new ServiceError("الزبون غير نشط");

    const activeContract = await prisma.masterContract.findFirst({
      where: { customerId: data.customerId, status: "active" },
      select: { contractNumber: true },
    });
    if (!activeContract) {
      throw new ServiceError(
        "لا يمكن تسجيل شاحنة لزبون ليس لديه عقد عام نشط (معلّق أو مغلق)",
      );
    }
  }

  if (data.salesOrderNumber) {
    const so = await prisma.salesOrder.findUnique({
      where: { orderNumber: data.salesOrderNumber },
      include: { contract: { select: { status: true, customerId: true } } },
    });
    if (!so) throw new ServiceError("أمر البيع غير موجود", "NOT_FOUND");
    if (so.status !== "approved" && so.status !== "in_progress") {
      throw new ServiceError("أمر البيع غير فعّال");
    }
    if (so.contract.status !== "active") {
      throw new ServiceError("العقد المرتبط بأمر البيع غير نشط — لا يمكن تسجيل الشاحنة");
    }
    if (data.customerId != null && so.contract.customerId !== data.customerId) {
      throw new ServiceError("أمر البيع لا يخص الزبون المحدد");
    }
  }

  if (data.requestItems?.length) {
    const sizeIds = data.requestItems.map((i) => i.sizeId);
    const uniqueIds = new Set(sizeIds);
    if (uniqueIds.size !== sizeIds.length) {
      throw new ServiceError("لا يمكن تكرار نفس القياس في الطلبية");
    }
    const sizes = await prisma.sizeLookup.findMany({
      where: { id: { in: sizeIds }, isActive: true },
    });
    if (sizes.length !== sizeIds.length) {
      throw new ServiceError("أحد القياسات غير صالح أو غير نشط");
    }
  }

  const TERMINAL_STATUSES: TruckStatus[] = ["Completed", "Cancelled"];
  const normalizedPlate = data.plateNumber.trim();

  let truck;
  try {
    truck = await withRetry(() =>
      prisma.$transaction(
        async (tx: TxClient) => {
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
            throw new ServiceError(
              `يوجد عملية مفتوحة لنفس رقم اللوحة (عملية #${existingOpen.id})`,
              "CONFLICT",
            );
          }

          const created = await tx.truckOperation.create({
            data: {
              customerId: data.customerId || null,
              plateNumber: normalizedPlate,
              driverName: data.driverName.trim(),
              salesOrderNumber: data.salesOrderNumber || null,
              notes: data.notes?.trim() || null,
              status: "Queued",
              createdById: userId,
            },
          });

          if (data.requestItems?.length) {
            await tx.truckRequestItem.createMany({
              data: data.requestItems.map((item) => ({
                truckOperationId: created.id,
                sizeId: item.sizeId,
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
                plateNumber: created.plateNumber,
                driverName: created.driverName,
                salesOrderNumber: created.salesOrderNumber,
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
        throw new ServiceError(
          `يوجد عملية مفتوحة لنفس رقم اللوحة (${normalizedPlate})`,
          "CONFLICT",
        );
      }
    }
    throw e;
  }

  logger.info({ truckId: truck.id, plate: truck.plateNumber }, "truck registered");
  return truck;
}

// ─── Enter Tare ────────────────────────────────────────────────────

export async function enterTare(truckId: number, weightKg: number, userId: number) {
  // Hard-rail check first (catches 0, negative, NaN, Infinity, >100t).
  const rangeError = validateWeightRange(weightKg);
  if (rangeError) throw new ServiceError(rangeError);
  const tareError = validateTareWeight(weightKg);
  if (tareError) throw new ServiceError(tareError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Row lock prevents two operators from simultaneously recording tare
        // (same transition, both would pass assertTransition on stale reads).
        const locked = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM truck_operations WHERE id = ${truckId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        // Explicit "no double tare" message — clearer than the generic
        // state-machine error for the most common misclick.
        if (truck.tareWeightKg != null) {
          throw new ServiceError(
            `تم إدخال وزن الفارغ مسبقاً (${Number(truck.tareWeightKg)} كغ). استخدم تصحيح الوزن إن كان خطأ.`,
            "CONFLICT",
          );
        }

        assertTransition(truck.status, "FirstWeigh");

        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            tareWeightKg: weightKg,
            tareTime: new Date(),
            status: "FirstWeigh",
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "tare_recorded",
            previousValue: { status: truck.status, tareWeightKg: null },
            newValue: { status: "FirstWeigh", tareWeightKg: weightKg },
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
  if (newWeightKg <= 0) throw new ServiceError("الوزن يجب أن يكون أكبر من صفر");
  const tareError = validateTareWeight(newWeightKg);
  if (tareError) throw new ServiceError(tareError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        const allowed: TruckStatus[] = ["FirstWeigh", "OnScale", "LoadingComplete"];
        if (!allowed.includes(truck.status)) {
          throw new ServiceError("لا يمكن تصحيح وزن الفارغ بعد إدخال وزن المحمّل");
        }

        const oldWeight = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;

        // Optimistic lock: update only if the version the client saw is still
        // the current version. Two operators correcting at the same time will
        // both target the same expectedVersion; only the first commits, the
        // second sees count=0 and is asked to reload.
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: {
            tareWeightKg: newWeightKg,
            tareTime: new Date(),
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ServiceError(
            "تم تعديل السجل من قِبل مستخدم آخر. يرجى تحديث الصفحة وإعادة المحاولة",
          );
        }

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

// ─── Correct Gross (before close only) ────────────────────────────

export async function correctGross(
  truckId: number,
  newWeightKg: number,
  expectedVersion: number,
  userId: number,
) {
  if (newWeightKg <= 0) throw new ServiceError("الوزن يجب أن يكون أكبر من صفر");

  return withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        if (truck.status !== "SecondWeigh") {
          throw new ServiceError("لا يمكن تصحيح وزن المحمّل إلا قبل الإغلاق النهائي");
        }

        if (!truck.tareWeightKg) {
          throw new ServiceError("يجب إدخال وزن الفارغ أولاً");
        }
        if (new Decimal(newWeightKg).lte(truck.tareWeightKg)) {
          throw new ServiceError("وزن المحمّل يجب أن يكون أكبر من وزن الفارغ");
        }
        const grossError = validateGrossWeight(newWeightKg, Number(truck.tareWeightKg));
        if (grossError) throw new ServiceError(grossError);

        const oldWeight = truck.grossWeightKg ? Number(truck.grossWeightKg) : null;

        // Optimistic lock — see correctTare for the full rationale.
        const result = await tx.truckOperation.updateMany({
          where: { id: truckId, version: expectedVersion },
          data: {
            grossWeightKg: newWeightKg,
            grossTime: new Date(),
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ServiceError(
            "تم تعديل السجل من قِبل مستخدم آخر. يرجى تحديث الصفحة وإعادة المحاولة",
          );
        }

        const updated = await tx.truckOperation.findUnique({ where: { id: truckId } });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            action: "gross_correction",
            oldGrossWeightKg: oldWeight,
            newGrossWeightKg: newWeightKg,
            expectedVersion,
          },
        });

        logger.info({ truckId, oldWeight, newWeightKg }, "gross corrected");
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
}

export async function enterWeighSession(
  truckId: number,
  data: WeighSessionInput,
  userId: number,
) {
  if (data.weightTons <= 0) throw new ServiceError("الوزن يجب أن يكون أكبر من صفر");

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
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        if (truck.status !== "FirstWeigh" && truck.status !== "OnScale") {
          throw new ServiceError("لا يمكن إضافة وزنة في الحالة الحالية");
        }

        if (data.sizeId) {
          const size = await tx.sizeLookup.findUnique({ where: { id: data.sizeId } });
          if (!size || !size.isActive) throw new ServiceError("القياس غير صالح");
        }

        const lastSession = await tx.weighSession.findFirst({
          where: { truckOperationId: truckId },
          orderBy: { sessionNumber: "desc" },
        });
        const nextNumber = (lastSession?.sessionNumber ?? 0) + 1;

        const session = await tx.weighSession.create({
          data: {
            truckOperationId: truckId,
            sessionNumber: nextNumber,
            sizeId: data.sizeId || null,
            bundleCount: data.bundleCount || null,
            weightTons: data.weightTons,
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
            sessionNumber: nextNumber,
            weightTons: data.weightTons,
            sizeId: data.sizeId,
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
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        if (truck.status !== "OnScale" && truck.status !== "FirstWeigh") {
          throw new ServiceError("لا يمكن تعديل الوزنات بعد تأكيد اكتمال التحميل");
        }

        const session = await tx.weighSession.findUnique({ where: { id: sessionId } });
        if (!session || session.truckOperationId !== truckId) {
          throw new ServiceError("الوزنة غير موجودة", "NOT_FOUND");
        }

        if (data.weightTons !== undefined && data.weightTons <= 0) {
          throw new ServiceError("الوزن يجب أن يكون أكبر من صفر");
        }

        // Optimistic lock against two concurrent edits of the same weigh
        // session. Use the "unchecked" variant so we can set the FK scalar
        // `sizeId` directly (updateMany cannot nest relation writes).
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
          throw new ServiceError(
            "تم تعديل الوزنة من قِبل مستخدم آخر. يرجى تحديث الصفحة وإعادة المحاولة",
          );
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

// ─── Upload Photo ─────────────────────────────────────────────────

export async function uploadPhoto(truckId: number, filePath: string, userId: number) {
  const photo = await withRetry(() =>
    prisma.$transaction(
      async (tx: TxClient) => {
        // Re-check truck inside the serializable tx so a concurrent cancel or
        // close cannot race a photo upload.
        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        if (truck.status === "Completed" || truck.status === "Cancelled") {
          throw new ServiceError("لا يمكن رفع صورة لعملية مغلقة أو ملغاة");
        }

        const created = await tx.truckPhoto.create({
          data: { truckOperationId: truckId, filePath },
        });

        await logAudit(tx, {
          userId,
          action: "upload",
          entityType: "TruckPhoto",
          entityId: String(created.id),
          details: { truckId, filePath },
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

export async function confirmLoadingComplete(truckId: number, userId: number) {
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
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
        });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        assertTransition(truck.status, "LoadingComplete");

        // Re-query after the lock so both collections are up-to-date.
        const [sessions, photoCount] = await Promise.all([
          tx.weighSession.findMany({
            where: { truckOperationId: truckId },
            select: { weightTons: true },
          }),
          tx.truckPhoto.count({ where: { truckOperationId: truckId } }),
        ]);

        if (sessions.length === 0) {
          throw new ServiceError("يجب إدخال وزنة واحدة على الأقل قبل تأكيد اكتمال التحميل");
        }
        if (photoCount === 0) {
          throw new ServiceError("يجب رفع صورة واحدة على الأقل قبل تأكيد اكتمال التحميل");
        }

        const totalInternalTons = sessions.reduce(
          (sum, s) => sum.plus(s.weightTons),
          new Decimal(0),
        );

        // Stamp loader identity + timestamp atomically with the transition.
        // `enterGross` will refuse to run while either is null — this is the
        // primary enforcement of the two-role workflow rule (Part 1).
        const confirmedAt = new Date();
        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            status: "LoadingComplete",
            loadingConfirmedAt: confirmedAt,
            loaderId: userId,
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
              sessionCount: sessions.length,
              totalInternalTons: totalInternalTons.toNumber(),
            },
          },
        });

        logger.info({ truckId, sessions: sessions.length, loaderId: userId }, "loading complete confirmed");
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
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        if (truck.status !== "LoadingComplete") {
          throw new ServiceError("لا يمكن إعادة الفتح إلا من حالة «اكتمال التحميل»");
        }

        // Reopen invalidates the prior loader confirmation — the loader must
        // re-confirm before gross can be recorded. Clearing both columns is
        // protected by the DB CHECK constraint
        // (truck_operations_loading_confirmation_pair_chk), which requires
        // them to be null-together or set-together.
        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            status: "OnScale",
            loadingConfirmedAt: null,
            loaderId: null,
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

// ─── Enter Gross ──────────────────────────────────────────────────

export async function enterGross(truckId: number, weightKg: number, userId: number) {
  // Hard-rail weight check before touching the DB.
  const rangeError = validateWeightRange(weightKg);
  if (rangeError) throw new ServiceError(rangeError);

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
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");

        // ── Two-role workflow rule (Part 1) ──────────────────────────
        // Gross weight CANNOT be recorded unless a loader has confirmed
        // loading completion. Checked BEFORE the state-machine transition
        // so the error message is user-friendly ("wait for the loader")
        // rather than the generic "invalid transition".
        if (!truck.loadingConfirmedAt) {
          throw new ServiceError(
            "Loading must be confirmed before recording gross weight / يجب تأكيد انتهاء التحميل من قبل عامل التحميل قبل تسجيل وزن المحمّل",
            "FORBIDDEN",
          );
        }

        // Explicit "no double gross" — friendlier than a state-machine error.
        if (truck.grossWeightKg != null) {
          throw new ServiceError(
            `تم إدخال وزن المحمّل مسبقاً (${Number(truck.grossWeightKg)} كغ). استخدم تصحيح الوزن إن كان خطأ.`,
            "CONFLICT",
          );
        }

        assertTransition(truck.status, "SecondWeigh");

        if (!truck.tareWeightKg) {
          throw new ServiceError("يجب إدخال وزن الفارغ أولاً");
        }
        if (new Decimal(weightKg).lte(truck.tareWeightKg)) {
          throw new ServiceError(
            "Gross weight must be greater than tare weight / وزن المحمّل يجب أن يكون أكبر من وزن الفارغ",
          );
        }
        const grossError = validateGrossWeight(weightKg, Number(truck.tareWeightKg));
        if (grossError) throw new ServiceError(grossError);

        const updated = await tx.truckOperation.update({
          where: { id: truckId },
          data: {
            grossWeightKg: weightKg,
            grossTime: new Date(),
            status: "SecondWeigh",
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "TruckOperation",
          entityId: String(truckId),
          details: {
            event: "gross_recorded",
            previousValue: {
              status: truck.status,
              grossWeightKg: null,
            },
            newValue: {
              status: "SecondWeigh",
              grossWeightKg: weightKg,
              tareWeightKg: Number(truck.tareWeightKg),
              netWeightKg: weightKg - Number(truck.tareWeightKg),
              loaderId: truck.loaderId,
              loadingConfirmedAt: truck.loadingConfirmedAt,
            },
          },
        });

        logger.info({ truckId, weightKg }, "gross entered");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Close Operation (Stage 2 — Final) ────────────────────────────

export async function closeOperation(truckId: number, userId: number) {
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
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({
          where: { id: truckId },
          include: { sessions: true },
        });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        assertTransition(truck.status, "Completed");

        if (!truck.tareWeightKg || !truck.grossWeightKg) {
          throw new ServiceError("يجب إدخال وزن الفارغ والمحمّل قبل الإغلاق");
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
            bridgeNetKg: bridgeNetKg.toNumber(),
            internalTotalTons: internalTotalTons.toNumber(),
            bridgeNetTons: bridgeNetTons.toNumber(),
            discrepancyTons: bridgeNetTons.minus(internalTotalTons).toNumber(),
          },
        });

        logger.info(
          { truckId, bridgeNetKg: bridgeNetKg.toNumber(), internalTotalTons: internalTotalTons.toNumber() },
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
  if (!reason.trim()) throw new ServiceError("يجب إدخال سبب الإلغاء");

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
          throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
        }

        const truck = await tx.truckOperation.findUnique({ where: { id: truckId } });
        if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
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
  requestItems: {
    orderBy: { size: { sortOrder: "asc" as const } },
    include: { size: { select: { id: true, code: true, displayName: true, isBundleType: true } } },
  },
  sessions: {
    orderBy: { sessionNumber: "asc" as const },
    include: { size: { select: { id: true, code: true, displayName: true } } },
  },
  photos: { orderBy: { capturedAt: "asc" as const } },
  creator: { select: { id: true, fullName: true, username: true } },
  closer: { select: { id: true, fullName: true, username: true } },
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
  if (!truck) throw new ServiceError("العملية غير موجودة", "NOT_FOUND");
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
    creator: { select: { id: true; fullName: true } };
    _count: { select: { sessions: true } };
  };
}>;

export async function listOperations(
  filters: TruckListFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<TruckListItem>> {
  const where: Prisma.TruckOperationWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.plateNumber) {
    where.plateNumber = { contains: filters.plateNumber, mode: "insensitive" };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
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
        creator: { select: { id: true, fullName: true } },
        _count: { select: { sessions: true } },
      },
    }),
    prisma.truckOperation.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}
