import { NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listActiveContractOptions } from "@/lib/services/billet-contract.service";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.register")) return forbidden();

  try {
    const data = await listActiveContractOptions();
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleServiceError(e);
  }
}
