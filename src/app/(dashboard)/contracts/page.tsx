import { requirePagePermission } from "@/lib/page-auth";
import { ContractsPageContent } from "@/components/contracts/contracts-page-content";

export default async function ContractsPage() {
  await requirePagePermission("contract.view");
  return <ContractsPageContent />;
}
