import { durationBetween } from "@/lib/format-duration";

export interface TruckTimingsInput {
  createdAt: string | Date;
  tareTime?: string | Date | null;
  grossTime?: string | Date | null;
  closedAt?: string | Date | null;
  status: string;
  loadingConfirmedAt?: string | Date | null;
  lastReopenedAt?: string | Date | null;
  sessions: { createdAt: string | Date }[];
  loader?: { fullName: string } | null;
  now?: Date;
}

export interface TruckTimings {
  waitMs: number | null;
  scaleMs: number | null;
  scaleInProgress: boolean;
  internalLoadingMs: number | null;
  internalLoadingInProgress: boolean;
  firstSessionAt: string | null;
  internalStartAt: string | null;
  loadingConfirmedAt: string | null;
  loaderName: string | null;
  totalMs: number | null;
}

function toEpochMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = typeof value === "string" ? new Date(value).getTime() : value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toIsoString(ms: number | null): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

function earliestSessionMs(sessions: { createdAt: string | Date }[]): number | null {
  if (sessions.length === 0) return null;
  let min = Infinity;
  for (const session of sessions) {
    const ms = toEpochMs(session.createdAt);
    if (ms != null && ms < min) min = ms;
  }
  return min === Infinity ? null : min;
}

/**
 * Single source of truth for truck operation duration metrics.
 *
 * - scaleMs: tare → gross (bridge weigh duration)
 * - internalLoadingMs: first session (or last reopen) → loader confirmation
 */
export function computeTruckTimings(input: TruckTimingsInput): TruckTimings {
  const now = input.now ?? new Date();
  const isCancelled = input.status === "Cancelled";
  const isActive = !["Completed", "Cancelled"].includes(input.status);

  const waitMs = durationBetween(input.createdAt, input.tareTime);

  const scaleEndTime =
    input.grossTime ?? (isCancelled ? input.closedAt : null);
  const scaleInProgress =
    input.tareTime != null && scaleEndTime == null && !isCancelled;
  const scaleMs = scaleInProgress
    ? durationBetween(input.tareTime, now)
    : durationBetween(input.tareTime, scaleEndTime);

  const firstSessionMs = earliestSessionMs(input.sessions);
  const reopenedMs = toEpochMs(input.lastReopenedAt);
  const internalStartMs = reopenedMs ?? firstSessionMs;
  const confirmMs = toEpochMs(input.loadingConfirmedAt);

  const internalLoadingInProgress =
    input.sessions.length > 0 &&
    confirmMs == null &&
    input.status === "OnScale";

  let internalLoadingMs: number | null = null;
  if (internalStartMs != null) {
    if (confirmMs != null && confirmMs >= internalStartMs) {
      internalLoadingMs = confirmMs - internalStartMs;
    } else if (internalLoadingInProgress) {
      internalLoadingMs = now.getTime() - internalStartMs;
    }
  }

  const totalMs = durationBetween(
    input.createdAt,
    input.closedAt ?? (isActive ? now : null),
  );

  return {
    waitMs,
    scaleMs,
    scaleInProgress,
    internalLoadingMs,
    internalLoadingInProgress,
    firstSessionAt: toIsoString(firstSessionMs),
    internalStartAt: toIsoString(internalStartMs),
    loadingConfirmedAt: toIsoString(confirmMs),
    loaderName: input.loader?.fullName ?? null,
    totalMs,
  };
}
