import { describe, expect, it } from "vitest";
import { computeTruckTimings } from "./truck-timing";

const T0 = new Date("2026-05-19T08:00:00.000Z");
const T1 = new Date("2026-05-19T08:10:00.000Z");
const T2 = new Date("2026-05-19T08:20:00.000Z");
const T3 = new Date("2026-05-19T08:30:00.000Z");
const T4 = new Date("2026-05-19T08:45:00.000Z");
const NOW = new Date("2026-05-19T09:00:00.000Z");

const base = {
  createdAt: T0,
  tareTime: T1,
  status: "OnScale",
  sessions: [] as { createdAt: Date }[],
  now: NOW,
};

describe("computeTruckTimings", () => {
  it("returns null internal duration when there are no sessions", () => {
    const timings = computeTruckTimings(base);
    expect(timings.internalLoadingMs).toBeNull();
    expect(timings.internalLoadingInProgress).toBe(false);
    expect(timings.firstSessionAt).toBeNull();
  });

  it("computes internal duration from first session to loader confirmation", () => {
    const timings = computeTruckTimings({
      ...base,
      status: "LoadingComplete",
      sessions: [{ createdAt: T2 }],
      loadingConfirmedAt: T3,
      loader: { fullName: "أحمد" },
    });
    expect(timings.internalLoadingMs).toBe(T3.getTime() - T2.getTime());
    expect(timings.internalLoadingInProgress).toBe(false);
    expect(timings.loaderName).toBe("أحمد");
    expect(timings.loadingConfirmedAt).toBe(T3.toISOString());
  });

  it("uses earliest session when multiple sessions exist", () => {
    const timings = computeTruckTimings({
      ...base,
      status: "Completed",
      grossTime: T4,
      closedAt: T4,
      sessions: [{ createdAt: T3 }, { createdAt: T2 }],
      loadingConfirmedAt: T3,
    });
    expect(timings.firstSessionAt).toBe(T2.toISOString());
    expect(timings.internalLoadingMs).toBe(T3.getTime() - T2.getTime());
  });

  it("marks internal loading in progress on OnScale with sessions and no confirm", () => {
    const timings = computeTruckTimings({
      ...base,
      sessions: [{ createdAt: T2 }],
    });
    expect(timings.internalLoadingInProgress).toBe(true);
    expect(timings.internalLoadingMs).toBe(NOW.getTime() - T2.getTime());
  });

  it("computes scale duration in progress from tare until now", () => {
    const timings = computeTruckTimings({
      ...base,
      sessions: [{ createdAt: T2 }],
    });
    expect(timings.scaleInProgress).toBe(true);
    expect(timings.scaleMs).toBe(NOW.getTime() - T1.getTime());
  });

  it("computes completed scale duration from tare to gross", () => {
    const timings = computeTruckTimings({
      ...base,
      status: "Completed",
      grossTime: T4,
      closedAt: T4,
      sessions: [{ createdAt: T2 }],
      loadingConfirmedAt: T3,
    });
    expect(timings.scaleInProgress).toBe(false);
    expect(timings.scaleMs).toBe(T4.getTime() - T1.getTime());
  });

  it("returns null internal duration for cancelled trucks", () => {
    const timings = computeTruckTimings({
      ...base,
      status: "Cancelled",
      closedAt: T3,
      sessions: [{ createdAt: T2 }],
    });
    expect(timings.internalLoadingMs).toBeNull();
    expect(timings.internalLoadingInProgress).toBe(false);
  });

  it("starts internal duration from lastReopenedAt after reopen", () => {
    const reopenAt = new Date("2026-05-19T08:35:00.000Z");
    const secondConfirm = new Date("2026-05-19T08:50:00.000Z");
    const timings = computeTruckTimings({
      ...base,
      status: "LoadingComplete",
      sessions: [{ createdAt: T2 }],
      lastReopenedAt: reopenAt,
      loadingConfirmedAt: secondConfirm,
    });
    expect(timings.internalStartAt).toBe(reopenAt.toISOString());
    expect(timings.internalLoadingMs).toBe(secondConfirm.getTime() - reopenAt.getTime());
  });

  it("marks internal in progress from lastReopenedAt after reopen on OnScale", () => {
    const reopenAt = new Date("2026-05-19T08:35:00.000Z");
    const timings = computeTruckTimings({
      ...base,
      sessions: [{ createdAt: T2 }],
      lastReopenedAt: reopenAt,
    });
    expect(timings.internalLoadingInProgress).toBe(true);
    expect(timings.internalLoadingMs).toBe(NOW.getTime() - reopenAt.getTime());
  });

  it("computes wait and total durations", () => {
    const timings = computeTruckTimings({
      ...base,
      status: "Completed",
      grossTime: T4,
      closedAt: T4,
      sessions: [{ createdAt: T2 }],
      loadingConfirmedAt: T3,
    });
    expect(timings.waitMs).toBe(T1.getTime() - T0.getTime());
    expect(timings.totalMs).toBe(T4.getTime() - T0.getTime());
  });
});
