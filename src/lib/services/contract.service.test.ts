import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  customer: { findUnique: vi.fn() },
  masterContract: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  contractAttachment: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createContract,
  updateContract,
  getContractByNumber,
  addAttachment,
  listContracts,
} from "./contract.service";
import { ServiceError } from "./errors";

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks clears both call history *and* queued mockResolvedValueOnce
  // implementations. clearAllMocks does not clear the once-queue, which let
  // queued values bleed between tests and hide bugs.
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.contractAttachment.create.mockResolvedValue({ id: 1 });
  // Sensible defaults so individual tests only mock what they actually use.
  mockPrisma.masterContract.findFirst.mockResolvedValue(null);
  mockPrisma.masterContract.findMany.mockResolvedValue([]);
});

const yy = String(new Date().getFullYear()).slice(-2);

// ─── createContract ────────────────────────────────────────────

describe("createContract", () => {
  it("creates a contract with sequential number", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 1,
      isActive: true,
    });
    // No existing contract for this customer this year (findFirst) and no
    // contracts at all to compute the sequence from (findMany).
    mockPrisma.masterContract.findFirst.mockResolvedValueOnce(null);
    mockPrisma.masterContract.findMany.mockResolvedValueOnce([]);
    mockPrisma.masterContract.create.mockResolvedValue({
      contractNumber: `${yy}-01`,
      customerId: 1,
      customer: { id: 1, code: "C-0001", fullName: "Test" },
    });

    const result = await createContract(
      { customerId: 1 },
      { path: "uploads/f.pdf", name: "f.pdf", size: 100 },
      1,
    );

    expect(result.contractNumber).toBe(`${yy}-01`);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("increments sequence from last contract", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 2,
      isActive: true,
    });
    mockPrisma.masterContract.findFirst.mockResolvedValueOnce(null);
    // The service now scans all year-matching contracts and picks max(seq)+1.
    mockPrisma.masterContract.findMany.mockResolvedValueOnce([
      { contractNumber: `${yy}-02` },
      { contractNumber: `${yy}-05` },
      { contractNumber: `${yy}-03` },
    ]);
    mockPrisma.masterContract.create.mockResolvedValue({
      contractNumber: `${yy}-06`,
      customerId: 2,
      customer: { id: 2, code: "C-0002", fullName: "Test2" },
    });

    const result = await createContract(
      { customerId: 2 },
      { path: "uploads/f.pdf", name: "f.pdf", size: 0 },
      1,
    );

    expect(result.contractNumber).toBe(`${yy}-06`);
  });

  it("throws when customer is inactive", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 3,
      isActive: false,
    });

    await expect(
      createContract(
        { customerId: 3 },
        { path: "uploads/f.pdf", name: "f.pdf", size: 0 },
        1,
      ),
    ).rejects.toThrow("العميل غير موجود أو غير نشط");
  });

  it("throws when customer not found", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      createContract(
        { customerId: 999 },
        { path: "uploads/f.pdf", name: "f.pdf", size: 0 },
        1,
      ),
    ).rejects.toThrow(ServiceError);
  });

  it("throws when customer already has a contract this year", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 1,
      isActive: true,
    });
    mockPrisma.masterContract.findFirst.mockResolvedValueOnce({
      contractNumber: `${yy}-01`,
      status: "active",
    });

    await expect(
      createContract(
        { customerId: 1 },
        { path: "uploads/f.pdf", name: "f.pdf", size: 0 },
        1,
      ),
    ).rejects.toThrow("العميل لديه عقد لهذه السنة بالفعل");
  });
});

// ─── updateContract ────────────────────────────────────────────

describe("updateContract", () => {
  it("updates notes and writes audit log", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue({
      contractNumber: `${yy}-01`,
      status: "active",
    });
    mockPrisma.masterContract.update.mockResolvedValue({
      contractNumber: `${yy}-01`,
      notes: "ملاحظة",
      customer: { id: 1, code: "C-0001", fullName: "Test" },
    });

    const result = await updateContract(
      `${yy}-01`,
      { notes: "ملاحظة" },
      1,
    );

    expect(result.notes).toBe("ملاحظة");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("handles status change with reason", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue({
      contractNumber: `${yy}-01`,
      status: "active",
    });
    mockPrisma.masterContract.update.mockResolvedValue({
      contractNumber: `${yy}-01`,
      status: "suspended",
      customer: { id: 1, code: "C-0001", fullName: "Test" },
    });

    await updateContract(
      `${yy}-01`,
      { status: "suspended", statusReason: "تأخر" },
      1,
    );

    const auditCall = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("status_change");
  });

  it("throws when status change has no reason", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue({
      contractNumber: `${yy}-01`,
      status: "active",
    });

    await expect(
      updateContract(`${yy}-01`, { status: "suspended" }, 1),
    ).rejects.toThrow("سبب تغيير الحالة مطلوب");
  });

  it("throws NOT_FOUND when contract does not exist", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue(null);

    await expect(
      updateContract("99-99", { notes: "x" }, 1),
    ).rejects.toThrow(ServiceError);
  });
});

// ─── getContractByNumber ───────────────────────────────────────

describe("getContractByNumber", () => {
  it("returns contract with relations", async () => {
    const contract = {
      contractNumber: `${yy}-01`,
      customer: {},
      creator: {},
      attachments: [],
    };
    mockPrisma.masterContract.findUnique.mockResolvedValue(contract);

    const result = await getContractByNumber(`${yy}-01`);
    expect(result.contractNumber).toBe(`${yy}-01`);
  });

  it("throws NOT_FOUND when not found", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue(null);

    await expect(getContractByNumber("99-99")).rejects.toThrow(ServiceError);
  });
});

// ─── addAttachment ─────────────────────────────────────────────

describe("addAttachment", () => {
  it("creates attachment and writes audit log", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue({
      contractNumber: `${yy}-01`,
    });
    mockPrisma.contractAttachment.create.mockResolvedValue({
      id: 10,
      fileName: "doc.pdf",
    });

    const result = await addAttachment(
      `${yy}-01`,
      { filePath: "uploads/doc.pdf", fileName: "doc.pdf", fileSize: 500 },
      1,
    );

    expect(result.fileName).toBe("doc.pdf");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND when contract does not exist", async () => {
    mockPrisma.masterContract.findUnique.mockResolvedValue(null);

    await expect(
      addAttachment(
        "99-99",
        { filePath: "x", fileName: "x", fileSize: 0 },
        1,
      ),
    ).rejects.toThrow(ServiceError);
  });
});

// ─── listContracts ─────────────────────────────────────────────

describe("listContracts", () => {
  it("returns paginated result", async () => {
    mockPrisma.masterContract.findMany.mockResolvedValue([
      { contractNumber: `${yy}-01` },
    ]);
    mockPrisma.masterContract.count.mockResolvedValue(1);

    const result = await listContracts("", "", { page: 1, pageSize: 25 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("filters by status", async () => {
    mockPrisma.masterContract.findMany.mockResolvedValue([]);
    mockPrisma.masterContract.count.mockResolvedValue(0);

    await listContracts("", "active", { page: 1, pageSize: 10 });

    const call = mockPrisma.masterContract.findMany.mock.calls[0][0];
    expect(call.where.status).toBe("active");
  });

  it("applies search filter", async () => {
    mockPrisma.masterContract.findMany.mockResolvedValue([]);
    mockPrisma.masterContract.count.mockResolvedValue(0);

    await listContracts("أحمد", "", { page: 1, pageSize: 10 });

    const call = mockPrisma.masterContract.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });
});
