import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  masterContract: { findUnique: vi.fn() },
  salesOrder: { findFirst: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createSalesOrder } from "./sales-order.service";
import { ServiceError } from "./errors";
import type { SalesOrderCreateInput } from "@/lib/validators/sales-order";

const rebarFirst: SalesOrderCreateInput = {
  contractNumber: "26-01",
  kind: "REBAR",
  grade: "FIRST",
  settlementMode: "CREDIT",
  paymentDeadlineDays: 28,
  totalQtyTons: 100,
  toleranceType: "percentage",
  toleranceValue: 5,
  specialRatioPct: 10,
  orderDate: "2026-01-01",
  deliveryDate: "2026-02-01",
  notes: "",
};

const scrapOrder: SalesOrderCreateInput = {
  contractNumber: "26-01",
  kind: "SCRAP",
  grade: null,
  settlementMode: "CREDIT",
  paymentDeadlineDays: 28,
  totalQtyTons: 40,
  toleranceType: "percentage",
  toleranceValue: 0,
  specialRatioPct: null,
  orderDate: "2026-01-01",
  deliveryDate: "2026-02-01",
  notes: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  );
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.masterContract.findUnique.mockResolvedValue({
    contractNumber: "26-01",
    status: "active",
    customerId: 1,
  });
});

describe("createSalesOrder", () => {
  it("rejects duplicate REBAR + same grade on the same contract", async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      orderNumber: "26-01-001",
    });

    await expect(createSalesOrder(rebarFirst, 1)).rejects.toThrow(/26-01-001/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects duplicate non-REBAR kind on the same contract (no separate grade)", async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      orderNumber: "26-01-003",
    });

    await expect(createSalesOrder(scrapOrder, 1)).rejects.toThrow(ServiceError);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows a second REBAR order when the grade differs", async () => {
    mockPrisma.salesOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.salesOrder.create.mockResolvedValue({
      orderNumber: "26-01-001",
      contractNumber: "26-01",
      kind: "REBAR",
      grade: "SECOND",
      contract: {
        contractNumber: "26-01",
        customer: { id: 1, code: "C-1", fullName: "Test" },
      },
    });

    const secondGrade: SalesOrderCreateInput = {
      ...rebarFirst,
      grade: "SECOND",
    };

    const result = await createSalesOrder(secondGrade, 1);
    expect(result.orderNumber).toBe("26-01-001");
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("creates first order when no duplicate exists", async () => {
    mockPrisma.salesOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.salesOrder.create.mockResolvedValue({
      orderNumber: "26-01-001",
      contractNumber: "26-01",
      kind: "REBAR",
      grade: "FIRST",
      contract: {
        contractNumber: "26-01",
        customer: { id: 1, code: "C-1", fullName: "Test" },
      },
    });

    const result = await createSalesOrder(rebarFirst, 1);
    expect(result.orderNumber).toBe("26-01-001");
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });
});
