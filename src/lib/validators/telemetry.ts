import { z } from "zod";

export const plcTelemetrySchema = z.object({
  productSize: z.number().nonnegative("invalidData"),
  totalBillets: z.number().int().nonnegative("invalidData"),
  frontPackCount: z.number().int().nonnegative("invalidData"),
  backPackCount: z.number().int().nonnegative("invalidData"),
  hourlyBreakdown: z
    .array(z.number().int().nonnegative("invalidData"))
    .length(24, "invalidData"),
});

export type PlcTelemetryInput = z.infer<typeof plcTelemetrySchema>;
