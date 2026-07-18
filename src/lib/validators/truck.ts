import { z } from "zod";
import { MIN_WEIGHT_KG, MAX_WEIGHT_KG } from "@/lib/weight-bounds";

const requestItemSchema = z.object({
  sizeId: z.number().int().positive("sizeRequired"),
  // Grade per request line: the same size may be requested once per grade
  // (e.g. 12mm FIRST + 12mm SECOND on one truck).
  grade: z.enum(["FIRST", "SECOND"]).optional().nullable(),
  bundleCount: z.number().int().min(1, "bundleCountMinOne").optional().nullable(),
  requestedTons: z
    .number()
    .positive("weightMustBePositive")
    .max(999_999, "tonsValueTooLarge")
    .optional()
    .nullable(),
});

export const truckRegisterSchema = z.object({
  customerId: z.number().int().positive("customerRequired").optional().nullable(),
  destinationId: z.number().int().positive("destinationInvalid").optional().nullable(),
  plateNumber: z
    .string()
    .min(1, "plateNumberRequired")
    .max(20, "plateNumberTooLong"),
  driverName: z
    .string()
    .min(1, "driverNameRequired")
    .max(100, "driverNameTooLong"),
  salesOrderNumber: z.string().max(20).optional().or(z.literal("")),
  // null = clear notes on PATCH; "" still accepted from registration forms
  notes: z.string().max(2000).optional().nullable(),
  requestItems: z.array(requestItemSchema).optional(),
  operationalGrade: z.enum(["FIRST", "SECOND"]).optional().nullable(),
});

export const truckUpdateSchema = truckRegisterSchema.partial().extend({
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

// Hard rails on weights come from `weight-bounds.ts` so validator, service,
// and UI error messages stay in lockstep. `.finite()` rejects `Infinity`
// and `NaN` before the positive/min/max checks fire.
const weightKgSchema = z
  .number()
  .finite("weightValueInvalid")
  .positive("weightMustBePositive")
  .min(MIN_WEIGHT_KG, "weightBelowMinHardRail")
  .max(MAX_WEIGHT_KG, "weightAboveMaxHardRail");

export const tareSchema = z.object({ weightKg: weightKgSchema });

// `exit` selects what happens after the external weighing:
//   "final"  — truck leaves; operation moves to SecondWeigh (default,
//              backward-compatible with clients that omit the field).
//   "return" — truck goes back inside to load the next round; a new bridge
//              round opens automatically at this weight.
export const grossSchema = z.object({
  weightKg: weightKgSchema,
  exit: z.enum(["final", "return"]).default("final"),
});

// Loader's confirmation of the current round; optionally declares the grade
// actually loaded in this round (one grade per round — management rule) and,
// for internal-weighing-exempt trucks carrying more than one material, the
// material (size) loaded in this round.
export const loadingCompleteSchema = z.object({
  grade: z.enum(["FIRST", "SECOND"]).optional().nullable(),
  sizeId: z.number().int().positive("roundMaterialInvalid").optional().nullable(),
});

// Corrections carry the version the client read, so concurrent edits are
// detected via optimistic locking. See correctTare/correctGross in
// truck.service.ts. (No `exit` here — corrections never change the round
// chain shape, only the recorded weight.)
export const correctTareSchema = tareSchema.extend({
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const correctGrossSchema = z.object({
  weightKg: weightKgSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

// One internal weigh-session is a single batch inside the truck — cap at
// MAX_WEIGHT_KG / 1000 tons so the absolute hard rail applies here too.
const weightTonsSchema = z
  .number()
  .finite("weightValueInvalid")
  .positive("weightMustBePositive")
  .max(MAX_WEIGHT_KG / 1000, "weightTooLarge");

export const weighSessionSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: weightTonsSchema,
  // Stock source location the material was loaded from. Optional at the schema
  // level for backward compatibility (exempt/mirror sessions), but required in
  // the loading UI and enforced with bundleCount by the service for bundle sites.
  sourceLocationId: z.number().int().positive().optional().nullable(),
  // Loaded straight off the production line (cross-dock): no yard stop, no
  // source location — the service records a paired receipt + load-out on the
  // virtual location at close.
  fromProduction: z.boolean().optional(),
});

export const weighSessionEditSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: weightTonsSchema.optional(),
  sourceLocationId: z.number().int().positive().optional().nullable(),
  fromProduction: z.boolean().optional(),
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const weighSessionDeleteSchema = z.object({
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

// Closing requires the weighbridge-card number issued by the finance-side
// legacy scale program for this same exit, so both systems share one number.
export const closeSchema = z.object({
  externalCardNumber: z
    .string()
    .trim()
    .min(1, "externalCardNumberRequired")
    .max(30, "externalCardNumberTooLong"),
});

export const cancelSchema = z.object({
  reason: z.string().min(1, "cancelReasonRequired").max(2000, "reasonTooLong"),
});

// ─── Admin post-close corrections ─────────────────────────────────
// Every administrative correction of a Completed truck requires a written
// reason (audited) and an expectedVersion for optimistic locking.
const correctionReasonSchema = z
  .string()
  .min(1, "correctionReasonRequired")
  .max(2000, "reasonTooLong");

export const completedGradeCorrectionSchema = z.object({
  roundId: z.number().int().positive("roundInvalid"),
  grade: z.enum(["FIRST", "SECOND"]).nullable(),
  reason: correctionReasonSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const completedTareCorrectionSchema = z.object({
  weightKg: weightKgSchema,
  reason: correctionReasonSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const completedExternalCardCorrectionSchema = z.object({
  externalCardNumber: z
    .string()
    .trim()
    .min(1, "externalCardNumberRequired")
    .max(30, "externalCardNumberTooLong"),
  reason: correctionReasonSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const completedExternalCorrectionSchema = z.object({
  roundId: z.number().int().positive("roundInvalid"),
  weightKg: weightKgSchema,
  reason: correctionReasonSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const completedSessionAddSchema = z.object({
  roundId: z.number().int().positive("roundInvalid"),
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: weightTonsSchema,
  reason: correctionReasonSchema,
});

export const completedSessionEditSchema = z.object({
  sizeId: z.number().int().positive().optional().nullable(),
  bundleCount: z.number().int().min(1).optional().nullable(),
  weightTons: weightTonsSchema.optional(),
  reason: correctionReasonSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});

export const completedSessionDeleteSchema = z.object({
  reason: correctionReasonSchema,
  expectedVersion: z.number().int().nonnegative("expectedVersionInvalid"),
});
