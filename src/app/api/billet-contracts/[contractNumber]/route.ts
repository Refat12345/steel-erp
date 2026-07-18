import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { billetContractUpdateSchema } from "@/lib/validators/billet-contract";
import {
  getContractWithBalance,
  updateContract,
} from "@/lib/services/billet-contract.service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contractNumber: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.contract.view")) return forbidden();

  const { contractNumber } = await params;
  try {
    const result = await getContractWithBalance(contractNumber);
    return ok(result);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ contractNumber: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = billetContractUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  const isStatusChange = parsed.data.status != null;
  const isContractEdit =
    parsed.data.supplierName !== undefined ||
    parsed.data.contractedWeightKg !== undefined ||
    parsed.data.notes !== undefined ||
    parsed.data.pieceLines !== undefined;

  if (!isStatusChange && !isContractEdit) {
    return badRequest("noChangesToSave");
  }

  if (isStatusChange && !hasPermission(session, "billet.contract.change_status")) {
    return forbidden();
  }
  if (isContractEdit && !hasPermission(session, "billet.contract.edit")) {
    return forbidden();
  }

  const { contractNumber } = await params;
  try {
    const updated = await updateContract(contractNumber, parsed.data, session.userId);
    return ok(updated);
  } catch (e) {
    return handleServiceError(e);
  }
}
