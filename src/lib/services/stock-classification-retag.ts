import { Prisma, SalesOrderGrade, type StockMovementType } from "@prisma/client";
import Decimal from "decimal.js";
import { isOfferedSteelClassificationCode } from "@/lib/steel-classification-default";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";

type TxClient = Prisma.TransactionClient;

const LOCATION_CLASS_INCLUDE = {
  expectedSize: { select: { id: true, displayName: true } },
  expectedClassification: { select: { id: true, code: true, displayName: true } },
} as const;

/**
 * Move every non-zero ledger line from one classification to another by
 * writing a paired ADJUSTMENT (history is never rewritten). Used when a
 * first-grade bay is later marked B500B — the bundles already on the ground
 * must follow the bay.
 */
export async function retagStockClassificationInTx(
  tx: TxClient,
  locationId: number,
  fromClassificationId: number | null,
  toClassificationId: number | null,
  userId: number,
): Promise<number> {
  if (fromClassificationId === toClassificationId) return 0;

  const rows = await tx.stockMovement.groupBy({
    by: ["sizeId", "grade", "unit"],
    where: { locationId, classificationId: fromClassificationId },
    _sum: { quantity: true },
  });

  let retagged = 0;
  for (const row of rows) {
    const qty = new Decimal(row._sum.quantity ?? 0);
    if (qty.isZero()) continue;

    const shared = {
      locationId,
      type: "ADJUSTMENT" as StockMovementType,
      sizeId: row.sizeId,
      grade: row.grade,
      unit: row.unit,
      reason: "تمييز صنف الموقع",
      createdById: userId,
    };

    await tx.stockMovement.create({
      data: {
        ...shared,
        classificationId: fromClassificationId,
        quantity: qty.negated().toFixed(3),
      },
    });
    await tx.stockMovement.create({
      data: {
        ...shared,
        classificationId: toClassificationId,
        quantity: qty.toFixed(3),
      },
    });
    retagged += 1;
  }

  if (retagged > 0) {
    await logAudit(tx, {
      userId,
      action: "update",
      entityType: "StockLocation",
      entityId: String(locationId),
      details: {
        event: "retag_classification",
        fromClassificationId,
        toClassificationId,
        lines: retagged,
      },
    });
  }

  return retagged;
}

export async function dedicateLocationToClassificationInTx(
  tx: TxClient,
  locationId: number,
  classificationId: number,
  userId: number,
) {
  const location = await tx.stockLocation.findUnique({
    where: { id: locationId },
    include: LOCATION_CLASS_INCLUDE,
  });
  if (!location) throw new ServiceError("locationNotFound", "NOT_FOUND");
  if (!location.isActive) throw new ServiceError("locationDisabled");
  if (location.allowedGrade !== SalesOrderGrade.FIRST) {
    throw new ServiceError("locationExpectedClassificationInvalid", "BAD_REQUEST");
  }

  const classification = await tx.steelClassification.findUnique({
    where: { id: classificationId },
    select: { id: true, code: true, grade: true, isActive: true, displayName: true },
  });
  if (
    !classification ||
    !classification.isActive ||
    classification.grade !== SalesOrderGrade.FIRST ||
    !isOfferedSteelClassificationCode(classification.code)
  ) {
    throw new ServiceError("locationExpectedClassificationInvalid", "BAD_REQUEST");
  }

  const current = location.expectedClassificationId ?? null;
  if (current != null && current !== classification.id) {
    throw new ServiceError("locationMustMatchExpectedClassification", "BAD_REQUEST", {
      locationName: location.nameAr,
      classification: location.expectedClassification?.displayName ?? classification.displayName,
    });
  }

  const retaggedLines = await retagStockClassificationInTx(
    tx,
    location.id,
    null,
    classification.id,
    userId,
  );

  const updated =
    current === classification.id
      ? location
      : await tx.stockLocation.update({
          where: { id: location.id },
          data: { expectedClassificationId: classification.id },
          include: LOCATION_CLASS_INCLUDE,
        });

  if (current !== classification.id) {
    await logAudit(tx, {
      userId,
      action: "update",
      entityType: "StockLocation",
      entityId: String(location.id),
      details: {
        event: "dedicate_classification",
        classificationId: classification.id,
        classificationCode: classification.code,
        retaggedLines,
      },
    });
  }

  return { location: updated, retaggedLines, classification };
}
