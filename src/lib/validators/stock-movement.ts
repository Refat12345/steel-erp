import { z } from "zod";

/**
 * Manual production-in: material coming off the production line into a stock
 * location. Grade and counting unit are NOT sent by the client — they are
 * derived server-side from the location (segment → grade, unit). The client
 * sends the location, the size (for bundle sites), and the quantity.
 */
export const productionInSchema = z.object({
  locationId: z
    .number({ message: "locationRequired" })
    .int()
    .positive("locationRequired"),
  // The counting unit being entered. Rebar sites accept BOTH (bundles by one
  // role, tons by another); short-bar accepts TON only. The service validates
  // the unit against the location's segment.
  unit: z.enum(["BUNDLE", "TON"], { message: "entryUnitRequired" }),
  // Required for bundle movements and for rebar tonnage; omitted/null for
  // short-bar (tons). The service enforces the exact rule.
  sizeId: z.number().int().positive().nullable().optional(),
  quantity: z
    .number({ message: "quantityRequired" })
    .positive("quantityMustBePositive"),
  // Work shift the entry belongs to (production only). Normally omitted — the
  // server derives it from its own clock. Sent explicitly only during the
  // grace window right after a shift boundary, when the clerk may assign the
  // entry to the shift that just ended. The service rejects a non-natural
  // shift outside the grace window.
  shift: z.enum(["MORNING", "EVENING"]).nullable().optional(),
  reason: z.string().trim().max(500, "noteTooLong").optional().or(z.literal("")),
});

export type ProductionInInput = z.infer<typeof productionInSchema>;

/**
 * Transfer between two stock locations. Records a paired TRANSFER_OUT (source)
 * and TRANSFER_IN (destination) in one transaction. Grade/unit are derived
 * server-side from each location. Size is required for bundle sites and must
 * be omitted for short-bar (ton) sites — the service enforces this.
 */
export const transferSchema = z
  .object({
    fromLocationId: z
      .number({ message: "sourceLocationRequired" })
      .int()
      .positive("sourceLocationRequired"),
    toLocationId: z
      .number({ message: "destinationLocationRequired" })
      .int()
      .positive("destinationLocationRequired"),
    sizeId: z.number().int().positive().nullable().optional(),
    // Primary-unit amount: bundles for rebar, tons for short-bar.
    quantity: z
      .number({ message: "quantityRequired" })
      .positive("quantityMustBePositive"),
    // Actual weight moved (tons) — required for rebar (dual-unit) sites, where
    // the load's real weight is known at transfer time. Ignored for short-bar.
    quantityTons: z
      .number()
      .positive("weightMustBePositive")
      .nullable()
      .optional(),
    reason: z.string().trim().max(500, "noteTooLong").optional().or(z.literal("")),
  })
  .refine((d) => d.fromLocationId !== d.toLocationId, {
    message: "cannotTransferToSameLocation",
    path: ["toLocationId"],
  });

export type TransferInput = z.infer<typeof transferSchema>;

/**
 * Physical-count adjustment. The client sends the ACTUAL counted quantity
 * (not the delta) — the service computes the signed difference against the
 * current computed balance and records it as an ADJUSTMENT movement. The
 * reason is mandatory: every correction must say why.
 */
export const adjustmentSchema = z.object({
  locationId: z
    .number({ message: "locationRequired" })
    .int()
    .positive("locationRequired"),
  // Which balance is being corrected. Rebar sites can adjust bundles OR tons
  // independently; short-bar adjusts TON only. Enforced by the service.
  unit: z.enum(["BUNDLE", "TON"], { message: "correctionUnitRequired" }),
  // Required for bundle movements and rebar tonnage, null for short-bar — enforced by the service.
  sizeId: z.number().int().positive().nullable().optional(),
  actualQuantity: z
    .number({ message: "actualQuantityRequired" })
    .min(0, "actualQuantityCannotBeNegative"),
  reason: z
    .string({ message: "correctionReasonRequired" })
    .trim()
    .min(5, "correctionReasonMinLength")
    .max(500, "reasonTooLong"),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
