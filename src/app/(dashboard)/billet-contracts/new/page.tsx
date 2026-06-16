import { requirePagePermission } from "@/lib/page-auth";
import { NewBilletContractForm } from "@/components/billet/new-billet-contract-form";

export default async function NewBilletContractPage() {
  await requirePagePermission("billet.contract.create");
  return <NewBilletContractForm />;
}
