import { requirePagePermission } from "@/lib/page-auth";
import { BilletReceiptOperationView } from "@/components/billet/billet-receipt-operation-view";

export default async function BilletReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("billet.receipt.view");
  const { id } = await params;
  return <BilletReceiptOperationView receiptId={Number(id)} />;
}
