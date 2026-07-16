import { describe, it, expect, vi, beforeEach } from "vitest";

const writeFile = vi.fn();
const bookNew = vi.fn(() => ({ SheetNames: [] as string[], Sheets: {} }));
const bookAppend = vi.fn();
const aoaToSheet = vi.fn((rows: unknown[][]) => ({ "!cols": [], rows }));

vi.mock("xlsx", () => ({
  utils: {
    book_new: () => bookNew(),
    book_append_sheet: (...args: unknown[]) => {
      bookAppend(...(args as [unknown, unknown, string]));
    },
    aoa_to_sheet: (rows: unknown[][]) => aoaToSheet(rows),
  },
  writeFile: (...args: unknown[]) => {
    writeFile(...(args as [unknown, string]));
  },
}));

import { exportDailyBilletExcel } from "./daily-billet-excel";
import type { DailyBilletReport } from "@/lib/services/report.service";

function baseReport(
  overrides: Partial<DailyBilletReport> = {},
): DailyBilletReport {
  return {
    operationalDate: "2026-06-06",
    windowFrom: "2026-06-06T05:00:00.000Z",
    windowTo: "2026-06-07T05:00:00.000Z",
    windowLabel: "2026-06-06 08:00 → 2026-06-07 08:00",
    cutoffHour: 8,
    generatedAt: "2026-06-06T12:00:00.000Z",
    analyticsStartDate: null,
    windowClamped: false,
    filters: {},
    summary: {
      registered: 1,
      completed: 1,
      cancelled: 0,
      open: 0,
      totalNetTons: 25,
      totalAcceptedPieces: 95,
      includedLoads: 1,
      totalRemainingTons: 0,
    },
    bySupplier: [
      {
        supplierName: "asda",
        loads: 1,
        tons: 25,
        sharePct: 100,
        remainingTons: 0,
        contractedTons: 0,
        receivedToDateTons: 0,
      },
    ],
    byContract: [
      {
        contractNumber: "P-26-001",
        supplierName: "asda",
        loads: 1,
        tons: 25,
        sharePct: 100,
        contractedTons: 0,
        receivedToDateTons: 0,
        remainingTons: 0,
      },
    ],
    lengthTotals: [
      {
        billetLengthM: 12,
        acceptedPieces: 95,
        receiptCount: 1,
        sharePct: 100,
      },
    ],
    lengthColumns: [12],
    rows: [],
    ...overrides,
  };
}

function sheetRows(callIndex: number): unknown[][] {
  const call = aoaToSheet.mock.calls[callIndex];
  if (!call) throw new Error(`Missing aoa_to_sheet call ${callIndex}`);
  return call[0] as unknown[][];
}

describe("exportDailyBilletExcel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes four sheets without remaining columns when unfiltered", () => {
    exportDailyBilletExcel(baseReport());

    expect(bookAppend).toHaveBeenCalledTimes(4);
    expect(bookAppend.mock.calls.map((c) => c[2])).toEqual([
      "Summary",
      "By supplier",
      "By contract",
      "By length",
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      expect.anything(),
      "billet-receiving-2026-06-06.xlsx",
    );

    expect(sheetRows(1)[0]).toEqual([
      "Supplier",
      "Loads",
      "Tons today",
      "Share",
    ]);
  });

  it("includes remaining columns when a supplier is filtered", () => {
    exportDailyBilletExcel(
      baseReport({
        filters: { supplierName: "asda" },
        summary: {
          registered: 1,
          completed: 1,
          cancelled: 0,
          open: 0,
          totalNetTons: 25,
          totalAcceptedPieces: 95,
          includedLoads: 1,
          totalRemainingTons: 75,
        },
        bySupplier: [
          {
            supplierName: "asda",
            loads: 1,
            tons: 25,
            sharePct: 100,
            remainingTons: 75,
            contractedTons: 100,
            receivedToDateTons: 25,
          },
        ],
        byContract: [
          {
            contractNumber: "P-26-001",
            supplierName: "asda",
            loads: 1,
            tons: 25,
            sharePct: 100,
            contractedTons: 100,
            receivedToDateTons: 25,
            remainingTons: 75,
          },
        ],
      }),
    );

    expect(sheetRows(1)[0]).toEqual([
      "Supplier",
      "Loads",
      "Tons today",
      "Share",
      "Remaining (t)",
    ]);
    expect(sheetRows(2)[0]).toEqual([
      "Contract",
      "Supplier",
      "Loads",
      "Tons today",
      "Share",
      "Contracted (t)",
      "Received to date (t)",
      "Remaining (t)",
    ]);
  });
});
