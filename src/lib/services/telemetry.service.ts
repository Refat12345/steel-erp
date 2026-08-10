import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PlcTelemetryInput } from "@/lib/validators/telemetry";

/**
 * Persist one append-only PLC/SCADA telemetry snapshot.
 * Caller (machine collector) is authenticated at the route via `x-api-key`.
 */
export async function recordPlcTelemetry(data: PlcTelemetryInput) {
  return prisma.plcTelemetry.create({
    data: {
      productSize: data.productSize,
      totalBillets: data.totalBillets,
      frontPackCount: data.frontPackCount,
      backPackCount: data.backPackCount,
      hourlyBreakdown: data.hourlyBreakdown as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });
}
