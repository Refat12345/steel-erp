import { NextRequest, NextResponse } from "next/server";
import { unauthorized, badRequest, handleServiceError } from "@/lib/api-utils";
import { recordPlcTelemetry } from "@/lib/services/telemetry.service";
import { plcTelemetrySchema } from "@/lib/validators/telemetry";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Machine-to-machine ingest for rolling-mill SCADA/PLC snapshots.
 * Auth is `x-api-key` only (middleware matcher excludes this path from JWT).
 */
export async function POST(req: NextRequest) {
  const expected = process.env.PLC_API_KEY ?? "";
  const presented = req.headers.get("x-api-key") ?? "";

  if (!expected || !presented || !timingSafeEqual(presented, expected)) {
    logger.warn("plc telemetry sync rejected: invalid or missing api key");
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = plcTelemetrySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const record = await recordPlcTelemetry(parsed.data);
    logger.info(
      {
        id: record.id,
        totalBillets: parsed.data.totalBillets,
        frontPackCount: parsed.data.frontPackCount,
        backPackCount: parsed.data.backPackCount,
      },
      "plc telemetry synced",
    );
    return NextResponse.json(
      { success: true, id: record.id },
      { status: 201 },
    );
  } catch (err) {
    return handleServiceError(err);
  }
}

/** Constant-time compare so timing leaks cannot fingerprint the API key. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
