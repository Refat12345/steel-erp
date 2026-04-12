import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  customer: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  payment: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  paymentAllocation: {
    create: vi.fn(),
  },
  masterContract: {
    findMany: vi.fn(),
  },
  salesOrder: {
    findMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createPayment,
  getPaymentById,
  listPayments,
  getCustomerBalance,
  listCustomersForPayment,
} from "./payment.service";
import { ServiceError } from "./errors";

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  mockPrisma.auditLog.create.mockResolvedValue({});
});

const validInput = {
  customerId: 1,
  amount: 10000,
  method: "CASH" as const,
  paymentDate: "2026-04-10",
  referenceNumber: "",
  notes: "",
};

// ─── createPayment ────────────────────────────────────────────

describe("createPayment", () => {
  it("creates payment and writes audit log", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 1, code: "C-0001" });
    mockPrisma.payment.create.mockResolvedValue({ id: 1, amount: 10000 });
    mockPrisma.masterContract.findMany.mockResolvedValue([
      { contractNumber: "26-90" },
    ]);
    mockPrisma.salesOrder.findMany.mockResolvedValue([]);

    const result = await createPayment(validInput, 1);

    expect(result.payment.id).toBe(1);
    expect(result.allocations).toHaveLength(0);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND when customer does not exist", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(createPayment(validInput, 1)).rejects.toThrow(ServiceError);
    await expect(createPayment(validInput, 1)).rejects.toThrow("العميل غير موجود");
  });

  it("does not allocate when no SOs have debt (pre-Phase E)", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 1, code: "C-0001" });
    mockPrisma.payment.create.mockResolvedValue({ id: 2, amount: 50000 });
    mockPrisma.masterContract.findMany.mockResolvedValue([
      { contractNumber: "26-90" },
    ]);
    mockPrisma.salesOrder.findMany.mockResolvedValue([
      {
        orderNumber: "26-90-001",
        items: [{ pricePerTon: 600 }],
        paymentAllocations: [],
      },
    ]);

    const result = await createPayment(validInput, 1);

    expect(result.allocations).toHaveLength(0);
    expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
  });
});

// ─── getPaymentById ───────────────────────────────────────────

describe("getPaymentById", () => {
  it("returns payment with allocations", async () => {
    const payment = {
      id: 1,
      amount: 10000,
      customer: { id: 1, code: "C-0001", fullName: "Test" },
      creator: { id: 1, fullName: "Admin" },
      allocations: [],
    };
    mockPrisma.payment.findUnique.mockResolvedValue(payment);

    const result = await getPaymentById(1);
    expect(result.id).toBe(1);
  });

  it("throws NOT_FOUND when payment does not exist", async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(null);

    await expect(getPaymentById(999)).rejects.toThrow(ServiceError);
    await expect(getPaymentById(999)).rejects.toThrow("الدفعة غير موجودة");
  });
});

// ─── listPayments ─────────────────────────────────────────────

describe("listPayments", () => {
  it("returns paginated result", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockPrisma.payment.count.mockResolvedValue(2);

    const result = await listPayments({}, { page: 1, pageSize: 25 });

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("applies method filter", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    await listPayments({ method: "CASH" }, { page: 1, pageSize: 10 });

    const call = mockPrisma.payment.findMany.mock.calls[0][0];
    expect(call.where.method).toBe("CASH");
  });

  it("applies date range filter", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const from = new Date("2026-01-01");
    const to = new Date("2026-12-31");
    await listPayments({ from, to }, { page: 1, pageSize: 10 });

    const call = mockPrisma.payment.findMany.mock.calls[0][0];
    expect(call.where.paymentDate.gte).toEqual(from);
    expect(call.where.paymentDate.lte).toEqual(to);
  });
});

// ─── getCustomerBalance ───────────────────────────────────────

describe("getCustomerBalance", () => {
  it("returns balance summary with order breakdown", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 1, code: "C-0001", fullName: "Test",
    });
    mockPrisma.payment.findMany.mockResolvedValue([
      { amount: { toString: () => "10000.00" } },
      { amount: { toString: () => "5000.00" } },
    ]);
    mockPrisma.masterContract.findMany.mockResolvedValue([
      { contractNumber: "26-90" },
    ]);
    mockPrisma.salesOrder.findMany.mockResolvedValue([
      {
        orderNumber: "26-90-001",
        kind: "REBAR",
        grade: "FIRST",
        status: "approved",
        paymentAllocations: [],
      },
    ]);

    const result = await getCustomerBalance(1);

    expect(result.totalPaid).toBe("15000.00");
    expect(result.unallocatedCredit).toBe("15000.00");
    expect(result.orderBalances).toHaveLength(1);
  });

  it("throws NOT_FOUND for non-existent customer", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(getCustomerBalance(999)).rejects.toThrow("العميل غير موجود");
  });
});

// ─── listCustomersForPayment ──────────────────────────────────

describe("listCustomersForPayment", () => {
  it("returns active customers", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 1, code: "C-0001", fullName: "Test" },
    ]);

    const result = await listCustomersForPayment();
    expect(result).toHaveLength(1);
  });
});
