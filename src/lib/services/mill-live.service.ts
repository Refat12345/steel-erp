import { prisma } from "@/lib/db";
import {
  defaultOperationalDateInput,
  getOperationalDayWindow,
} from "@/lib/operational-day";

/** Snapshots older than this are treated as delayed / not live. */
const STALE_AFTER_MS = 3 * 60 * 1000;

const HOURS_PER_DAY = 24;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Longer than the collector's 2-minute heartbeat, so ordinary jitter is not
 * mistaken for missing data.
 */
const GAP_AFTER_MS = 6 * 60 * 1000;

export type MillLiveSnapshot = {
  productSize: number;
  totalBillets: number;
  frontPackCount: number;
  backPackCount: number;
  /** 24 counts for the current operational day; index 0 is the 08:00 hour. */
  hourlyBreakdown: number[];
  /** Slots whose count under-reports because telemetry was missing. */
  incompleteHours: number[];
  createdAt: string;
  isLive: boolean;
};

type Sample = { at: number; total: number };

/**
 * The PLC's own 24 hourly registers only track 08:00 through 00:00; the hours
 * after midnight stay at zero there. The running total in register 20 is
 * reliable around the clock, so we derive each hour from how much that total
 * grew, spreading a reading interval across the hours it actually covers.
 */
export function computeHourlyFromSamples(
  samples: Sample[],
  windowStartMs: number,
  nowMs: number,
): { hourlyBreakdown: number[]; incompleteHours: number[] } {
  const hourly = new Array<number>(HOURS_PER_DAY).fill(0);
  const incomplete = new Set<number>();

  const slotOf = (at: number) =>
    Math.min(
      HOURS_PER_DAY - 1,
      Math.max(0, Math.floor((at - windowStartMs) / HOUR_MS)),
    );

  /** Slots an interval touches. Its end is exclusive unless asked otherwise. */
  const slotsBetween = (fromMs: number, toMs: number, inclusiveEnd = false) => {
    const endMs = inclusiveEnd ? toMs : Math.max(fromMs, toMs - 1);
    return { first: slotOf(fromMs), last: slotOf(endMs) };
  };

  const markSlots = (fromMs: number, toMs: number, inclusiveEnd = false) => {
    const { first, last } = slotsBetween(fromMs, toMs, inclusiveEnd);
    for (let slot = first; slot <= last; slot++) {
      incomplete.add(slot);
    }
  };

  const distribute = (amount: number, fromMs: number, toMs: number) => {
    const spanMs = toMs - fromMs;
    if (spanMs <= 0 || amount <= 0) return;
    for (let slot = 0; slot < HOURS_PER_DAY; slot++) {
      const slotStart = windowStartMs + slot * HOUR_MS;
      const slotEnd = slotStart + HOUR_MS;
      const overlap = Math.min(toMs, slotEnd) - Math.max(fromMs, slotStart);
      if (overlap > 0) {
        hourly[slot] += (amount * overlap) / spanMs;
      }
    }
  };

  // The counter resets at the cutoff, so it is known to be zero there and the
  // first reading of the day already measures production since then.
  let previous: Sample = { at: windowStartMs, total: 0 };
  let sawSample = false;

  for (const sample of samples) {
    const spanMs = sample.at - previous.at;
    if (spanMs <= 0) {
      previous = sample;
      sawSample = true;
      continue;
    }

    // A long interval inside one hour still gives that hour an exact figure.
    // Only when it straddles hours does the split become guesswork.
    const { first, last } = slotsBetween(previous.at, sample.at);
    if (spanMs > GAP_AFTER_MS && last > first) {
      markSlots(previous.at, sample.at);
    }

    const delta = sample.total - previous.total;
    if (delta < 0) {
      // Someone pressed RESET COUNTER: whatever ran before the reset is lost,
      // and the new reading is production since it.
      markSlots(previous.at, sample.at);
      distribute(sample.total, previous.at, sample.at);
    } else {
      distribute(delta, previous.at, sample.at);
    }

    previous = sample;
    sawSample = true;
  }

  // With no closing reading we cannot know the current hour's real figure, so
  // flag right up to now - including the hour in progress.
  if (!sawSample) {
    markSlots(windowStartMs, nowMs, true);
  } else if (nowMs - previous.at > GAP_AFTER_MS) {
    markSlots(previous.at, nowMs, true);
  }

  return {
    hourlyBreakdown: hourly.map((value) => Math.round(value)),
    incompleteHours: [...incomplete].sort((a, b) => a - b),
  };
}

/**
 * Latest PLC/SCADA telemetry for the live mill board, with the hourly
 * breakdown derived from the running total over the current operational day.
 * Returns null when no snapshots have been ingested yet.
 */
export async function getLatestMillLiveSnapshot(): Promise<MillLiveSnapshot | null> {
  const now = new Date();
  const window = getOperationalDayWindow(defaultOperationalDateInput(now));

  const [latest, rows] = await Promise.all([
    prisma.plcTelemetry.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        productSize: true,
        totalBillets: true,
        frontPackCount: true,
        backPackCount: true,
        createdAt: true,
      },
    }),
    prisma.plcTelemetry.findMany({
      where: { createdAt: { gte: window.from, lt: window.to } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, totalBillets: true },
    }),
  ]);

  if (!latest) return null;

  const { hourlyBreakdown, incompleteHours } = computeHourlyFromSamples(
    rows.map((row) => ({
      at: row.createdAt.getTime(),
      total: row.totalBillets,
    })),
    window.from.getTime(),
    now.getTime(),
  );

  const ageMs = now.getTime() - latest.createdAt.getTime();
  return {
    productSize: latest.productSize,
    totalBillets: latest.totalBillets,
    frontPackCount: latest.frontPackCount,
    backPackCount: latest.backPackCount,
    hourlyBreakdown,
    incompleteHours,
    createdAt: latest.createdAt.toISOString(),
    isLive: ageMs <= STALE_AFTER_MS,
  };
}
