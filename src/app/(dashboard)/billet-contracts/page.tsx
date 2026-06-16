import { requirePagePermission } from "@/lib/page-auth";
import { BilletContractList } from "@/components/billet/billet-contract-list";

export default async function BilletContractsPage() {
  await requirePagePermission("billet.contract.view");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">عقود الموردين</h1>
        <p className="text-sm text-muted-foreground mt-1">
          عقود توريد البيلت: الوزن الإجمالي وعدد القطع لكل طول والرصيد المتبقّي
        </p>
      </div>
      <BilletContractList />
    </div>
  );
}
