import { requirePagePermission } from "@/lib/page-auth";
import { NewContractForm } from "@/components/contracts/new-contract-form";

export default async function NewContractPage() {
  await requirePagePermission("contract.create");
  return <NewContractForm />;
}
