import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  hasAnyPermission,
  STOCK_STRUCTURE_READ_PERMISSIONS,
  handleServiceError,
} from "@/lib/api-utils";
import {
  StockLocationSegment,
  SalesOrderGrade,
} from "@prisma/client";
import { getLocationBalances, type BalanceFilters } from "@/lib/services/stock.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasAnyPermission(session, ...STOCK_STRUCTURE_READ_PERMISSIONS)) {
    return forbidden();
  }

  const { searchParams } = req.nextUrl;
  const filters: BalanceFilters = {};

  const yardId = parseInt(searchParams.get("yardId") || "", 10);
  if (!isNaN(yardId)) filters.yardId = yardId;

  const sizeId = parseInt(searchParams.get("sizeId") || "", 10);
  if (!isNaN(sizeId)) filters.sizeId = sizeId;

  const segment = searchParams.get("segment");
  if (segment && segment in StockLocationSegment) {
    filters.segment = segment as StockLocationSegment;
  }

  const grade = searchParams.get("grade");
  if (grade && grade in SalesOrderGrade) {
    filters.grade = grade as SalesOrderGrade;
  }

  if (searchParams.get("includeInactive") === "1") {
    filters.includeInactive = true;
  }

  try {
    const balances = await getLocationBalances(filters);
    return ok(balances);
  } catch (e) {
    return handleServiceError(e);
  }
}
