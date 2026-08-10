import { prisma } from "@/lib/db";

/** Snapshots older than this are treated as delayed / not live. */
const STALE_AFTER_MS = 3 * 60 * 1000;

export type MillLiveSnapshot = {
  productSize: number;
  totalBillets: number;
  frontPackCount: number;
  backPackCount: number;
  hourlyBreakdown: number[];
  createdAt: string;
  isLive: boolean;
};

function asHourlyBreakdown(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 24) {
    return Array.from({ length: 24 }, () => 0);
  }
  return value.map((n) => {
    const num = typeof n === "number" ? n : Number(n);
    return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
  });
}

/**
 * Latest PLC/SCADA telemetry row for the live mill board.
 * Returns null when no snapshots have been ingested yet.
 */
export async function getLatestMillLiveSnapshot(): Promise<MillLiveSnapshot | null> {
  const row = await prisma.plcTelemetry.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      productSize: true,
      totalBillets: true,
      frontPackCount: true,
      backPackCount: true,
      hourlyBreakdown: true,
      createdAt: true,
    },
  });

  if (!row) return null;

  const ageMs = Date.now() - row.createdAt.getTime();
  return {
    productSize: row.productSize,
    totalBillets: row.totalBillets,
    frontPackCount: row.frontPackCount,
    backPackCount: row.backPackCount,
    hourlyBreakdown: asHourlyBreakdown(row.hourlyBreakdown),
    createdAt: row.createdAt.toISOString(),
    isLive: ageMs <= STALE_AFTER_MS,
  };
}
