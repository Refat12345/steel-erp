import { requirePagePermission } from "@/lib/page-auth";
import { BilletReceiptList } from "@/components/billet/billet-receipt-list";

export default async function BilletReceiptsPage() {
  await requirePagePermission("billet.receipt.view");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">استلام البيلت</h1>
        <p className="text-sm text-muted-foreground mt-1">
          تسجيل شاحنات البيلت الواردة ومتابعة الوزن والتفريغ والإغلاق
        </p>
      </div>
      <BilletReceiptList />
    </div>
  );
}
