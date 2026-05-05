import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  customer: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createCustomer,
  updateCustomer,
  getCustomerById,
  listCustomers,
} from "./customer.service";
import { ServiceError } from "./errors";

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  type TxFn = (tx: typeof mockPrisma) => unknown | Promise<unknown>;
  mockPrisma.$transaction.mockImplementation(async (fn: TxFn) => fn(mockPrisma));
  mockPrisma.auditLog.create.mockResolvedValue({});
});

const validInput = {
  fullName: "أحمد محمد",
  fatherName: "محمد",
  nationalId: "N-001",
  phonePrimary: "0911111111",
  companyAddress: "دمشق",
};

// ─── createCustomer ────────────────────────────────────────────

describe("createCustomer", () => {
  it("creates customer with auto-generated code from id", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    mockPrisma.customer.create.mockResolvedValue({ id: 7 });
    mockPrisma.customer.update.mockResolvedValue({
      id: 7,
      code: "C-0007",
      fullName: "أحمد محمد",
    });

    const result = await createCustomer(validInput, 1);

    expect(result.customer.code).toBe("C-0007");
    expect(result.phoneWarning).toBeNull();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("throws on duplicate national ID", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 99 });

    await expect(createCustomer(validInput, 1)).rejects.toThrow(ServiceError);
    await expect(createCustomer(validInput, 1)).rejects.toThrow(
      "الرقم الوطني مسجّل مسبقاً",
    );
  });

  it("returns phone warning when phone is already in use", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue({
      fullName: "عميل آخر",
      code: "C-0001",
    });
    mockPrisma.customer.create.mockResolvedValue({ id: 8 });
    mockPrisma.customer.update.mockResolvedValue({
      id: 8,
      code: "C-0008",
    });

    const result = await createCustomer(validInput, 1);

    expect(result.phoneWarning).toContain("عميل آخر");
    expect(result.phoneWarning).toContain("C-0001");
  });
});

// ─── updateCustomer ────────────────────────────────────────────

describe("updateCustomer", () => {
  it("updates customer and writes audit log", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 1,
      code: "C-0001",
      nationalId: "OLD",
    });
    mockPrisma.customer.update.mockResolvedValue({ id: 1, fullName: "جديد" });

    const result = await updateCustomer(1, { fullName: "جديد" }, 2);

    expect(result.fullName).toBe("جديد");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND when customer does not exist", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      updateCustomer(999, { fullName: "test" }, 1),
    ).rejects.toThrow(ServiceError);
  });

  it("rejects duplicate national ID on update", async () => {
    mockPrisma.customer.findUnique
      .mockResolvedValueOnce({ id: 1, code: "C-0001", nationalId: "OLD" })
      .mockResolvedValueOnce({ id: 2 });

    await expect(
      updateCustomer(1, { nationalId: "TAKEN" }, 1),
    ).rejects.toThrow("الرقم الوطني مسجّل مسبقاً");
  });
});

// ─── getCustomerById ───────────────────────────────────────────

describe("getCustomerById", () => {
  it("returns customer with contracts", async () => {
    const customer = { id: 1, code: "C-0001", contracts: [] };
    mockPrisma.customer.findUnique.mockResolvedValue(customer);

    const result = await getCustomerById(1);
    expect(result.code).toBe("C-0001");
  });

  it("throws NOT_FOUND when not found", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(getCustomerById(999)).rejects.toThrow(ServiceError);
  });
});

// ─── listCustomers ─────────────────────────────────────────────

describe("listCustomers", () => {
  it("returns paginated result", async () => {
    const customers = [{ id: 1 }, { id: 2 }];
    mockPrisma.customer.findMany.mockResolvedValue(customers);
    mockPrisma.customer.count.mockResolvedValue(2);

    const result = await listCustomers("", true, { page: 1, pageSize: 25 });

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("applies search filter to findMany", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    await listCustomers("أحمد", false, { page: 1, pageSize: 10 });

    const call = mockPrisma.customer.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR).toHaveLength(4);
  });

  it("applies activeOnly filter", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    await listCustomers("", true, { page: 1, pageSize: 10 });

    const call = mockPrisma.customer.findMany.mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
  });
});
