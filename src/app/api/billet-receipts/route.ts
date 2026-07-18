import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  parsePagination,
} from "@/lib/api-utils";
import {
  getOperationalDayWindow,
  type OperationalDayWindow,
} from "@/lib/operational-day";
import { registerReceiptSchema } from "@/lib/validators/billet-receipt";
import { listReceipts, registerReceipt } from "@/lib/services/billet-receipt.service";
import { getAnalyticsStartDateValue } from "@/lib/services/settings.service";
import type { BilletReceiptStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.view")) return forbidden();

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || "";
  const plateNumber = searchParams.get("plateNumber") || "";
  const supplierContractNumber = searchParams.get("contractNumber") || "";
  const operationalDate = searchParams.get("operationalDate");
  const pagination = parsePagination(searchParams);

  try {
    let window: OperationalDayWindow | null = null;
    if (operationalDate) {
      try {
        window = getOperationalDayWindow(operationalDate);
      } catch {
        return badRequest("invalidOperationalDate");
      }
    }

    const [result, analyticsStartDate] = await Promise.all([
      listReceipts(
        {
          status: status ? (status as BilletReceiptStatus) : undefined,
          plateNumber: plateNumber || undefined,
          supplierContractNumber: supplierContractNumber || undefined,
          dateFrom: window?.from,
          dateTo: window?.to,
        },
        pagination,
      ),
      getAnalyticsStartDateValue(),
    ]);
    return NextResponse.json({ success: true, ...result, analyticsStartDate });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.register")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = registerReceiptSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const receipt = await registerReceipt(parsed.data, session.userId);
    return ok(receipt);
  } catch (e) {
    return handleServiceError(e);
  }
}
