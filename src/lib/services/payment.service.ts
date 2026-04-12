import { prisma } from "@/lib/db";
import type { Prisma, PaymentMethod } from "@prisma/client";
import { Decimal } from "decimal.js";
import type { PaymentCreateInput } from "@/lib/validators/payment";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { logger } from "@/lib/logger";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_EVEN });

type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ─── Types ────────────────────────────────────────────────────────

export type PaymentListItem = Prisma.PaymentGetPayload<{
  include: {
    customer: { select: { id: true; code: true; fullName: true } };
    creator: { select: { id: true; fullName: true } };
    _count: { select: { allocations: true } };
  };
}>;

export type PaymentDetail = Prisma.PaymentGetPayload<{
  include: {
    customer: { select: { id: true; code: true; fullName: true } };
    creator: { select: { id: true; fullName: true } };
    allocations: {
      include: {
        salesOrder: {
          select: {
            orderNumber: true;
            kind: true;
            grade: true;
            status: true;
          };
        };
      };
    };
  };
}>;

export interface CustomerBalance {
  customerId: number;
  customerCode: string;
  customerName: string;
  totalPaid: string;
  totalAllocated: string;
  unallocatedCredit: string;
  orderBalances: OrderBalance[];
}

export interface OrderBalance {
  orderNumber: string;
  kind: string;
  grade: string | null;
  status: string;
  totalAllocated: string;
  loadedValue: string;
  balance: string;
}

export interface PaymentListFilters {
  customerId?: number;
  method?: PaymentMethod;
  from?: Date;
  to?: Date;
}

// ─── List Payments ────────────────────────────────────────────────

export async function listPayments(
  filters: PaymentListFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<PaymentListItem>> {
  const where: Prisma.PaymentWhereInput = {};
  if (filters.customerId != null) where.customerId = filters.customerId;
  if (filters.method != null) where.method = filters.method;
  if (filters.from || filters.to) {
    where.paymentDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        customer: { select: { id: true, code: true, fullName: true } },
        creator: { select: { id: true, fullName: true } },
        _count: { select: { allocations: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

// ─── Get Payment Detail ───────────────────────────────────────────

export async function getPaymentById(id: number): Promise<PaymentDetail> {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, code: true, fullName: true } },
      creator: { select: { id: true, fullName: true } },
      allocations: {
        include: {
          salesOrder: {
            select: {
              orderNumber: true,
              kind: true,
              grade: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!payment) throw new ServiceError("الدفعة غير موجودة", "NOT_FOUND");
  return payment;
}

// ─── Create Payment + FIFO Allocation ─────────────────────────────

export async function createPayment(
  data: PaymentCreateInput,
  createdById: number,
) {
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });
  if (!customer) throw new ServiceError("العميل غير موجود", "NOT_FOUND");

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        customerId: data.customerId,
        amount: data.amount,
        method: data.method,
        paymentDate: new Date(data.paymentDate),
        referenceNumber: data.referenceNumber || null,
        notes: data.notes || null,
        createdById,
      },
    });

    const allocations = await applyFifoAllocations(tx, payment.id, data.customerId, new Decimal(data.amount));

    await logAudit(tx, {
      userId: createdById,
      action: "create",
      entityType: "Payment",
      entityId: String(payment.id),
      details: {
        customerId: data.customerId,
        customerCode: customer.code,
        amount: data.amount,
        method: data.method,
        allocationsCount: allocations.length,
      },
    });

    return { payment, allocations };
  });

  logger.info(
    { paymentId: result.payment.id, customerId: data.customerId, amount: data.amount },
    "payment created with FIFO allocations",
  );

  return result;
}

// ─── FIFO Allocation Logic ────────────────────────────────────────
// Allocates payment to the oldest open SOs (by orderDate, then createdAt).
// "Debt" per SO = loaded value - already allocated. Since loaded value
// is not tracked yet (Phase E), debt is effectively 0 for all SOs.
// Until weighing exists, all payments remain as unallocated customer credit.
// The logic is correct for when loaded value is available.

async function applyFifoAllocations(
  tx: TxClient,
  paymentId: number,
  customerId: number,
  paymentAmount: Decimal,
) {
  const contracts = await tx.masterContract.findMany({
    where: { customerId },
    select: { contractNumber: true },
  });
  const contractNumbers = contracts.map((c) => c.contractNumber);
  if (contractNumbers.length === 0) return [];

  const openOrders = await tx.salesOrder.findMany({
    where: {
      contractNumber: { in: contractNumbers },
      status: { in: ["approved", "in_progress"] },
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: {
      orderNumber: true,
      items: { select: { pricePerTon: true } },
      paymentAllocations: { select: { allocatedAmount: true } },
    },
  });

  // Until Phase E, loaded value = 0 → debt = 0 → nothing to allocate.
  // Future: compute loaded value from weigh sessions per SO, then:
  //   debt = loadedValue - sum(allocations)
  // For now, keep allocations array empty and the full amount stays
  // as unallocated customer credit (derived).
  const allocations: Array<{ orderNumber: string; allocatedAmount: Decimal }> = [];
  let remaining = paymentAmount;

  for (const order of openOrders) {
    if (remaining.lte(0)) break;

    // loadedValue will come from Phase E (sum of weigh close postings).
    // Placeholder: 0 until truck/weigh operations write actual loaded data.
    const loadedValue = new Decimal(0);

    const alreadyAllocated = order.paymentAllocations.reduce(
      (sum, a) => sum.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );

    const debt = Decimal.max(loadedValue.minus(alreadyAllocated), 0);
    if (debt.lte(0)) continue;

    const toAllocate = Decimal.min(remaining, debt);

    await tx.paymentAllocation.create({
      data: {
        paymentId,
        orderNumber: order.orderNumber,
        allocatedAmount: toAllocate.toDecimalPlaces(2).toNumber(),
      },
    });

    allocations.push({ orderNumber: order.orderNumber, allocatedAmount: toAllocate });
    remaining = remaining.minus(toAllocate);
  }

  return allocations;
}

// ─── Customer Balance ─────────────────────────────────────────────

export async function getCustomerBalance(customerId: number): Promise<CustomerBalance> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, code: true, fullName: true },
  });
  if (!customer) throw new ServiceError("العميل غير موجود", "NOT_FOUND");

  const [payments, contracts] = await Promise.all([
    prisma.payment.findMany({
      where: { customerId },
      select: { amount: true },
    }),
    prisma.masterContract.findMany({
      where: { customerId },
      select: { contractNumber: true },
    }),
  ]);

  const totalPaid = payments.reduce(
    (sum, p) => sum.plus(new Decimal(p.amount.toString())),
    new Decimal(0),
  );

  const contractNumbers = contracts.map((c) => c.contractNumber);

  const orders = contractNumbers.length > 0
    ? await prisma.salesOrder.findMany({
        where: {
          contractNumber: { in: contractNumbers },
          status: { notIn: ["cancelled"] },
        },
        orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
        select: {
          orderNumber: true,
          kind: true,
          grade: true,
          status: true,
          paymentAllocations: { select: { allocatedAmount: true } },
        },
      })
    : [];

  let totalAllocated = new Decimal(0);
  const orderBalances: OrderBalance[] = [];

  for (const order of orders) {
    const allocated = order.paymentAllocations.reduce(
      (sum, a) => sum.plus(new Decimal(a.allocatedAmount.toString())),
      new Decimal(0),
    );
    totalAllocated = totalAllocated.plus(allocated);

    // loadedValue = 0 until Phase E
    const loadedValue = new Decimal(0);
    const balance = allocated.minus(loadedValue);

    orderBalances.push({
      orderNumber: order.orderNumber,
      kind: order.kind,
      grade: order.grade,
      status: order.status,
      totalAllocated: allocated.toDecimalPlaces(2).toFixed(2),
      loadedValue: loadedValue.toDecimalPlaces(2).toFixed(2),
      balance: balance.toDecimalPlaces(2).toFixed(2),
    });
  }

  const unallocatedCredit = totalPaid.minus(totalAllocated);

  return {
    customerId: customer.id,
    customerCode: customer.code,
    customerName: customer.fullName,
    totalPaid: totalPaid.toDecimalPlaces(2).toFixed(2),
    totalAllocated: totalAllocated.toDecimalPlaces(2).toFixed(2),
    unallocatedCredit: unallocatedCredit.toDecimalPlaces(2).toFixed(2),
    orderBalances,
  };
}

// ─── List Customers with Balances (for finance overview) ──────────

export async function listCustomersForPayment() {
  return prisma.customer.findMany({
    where: { isActive: true },
    select: { id: true, code: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 500,
  });
}
