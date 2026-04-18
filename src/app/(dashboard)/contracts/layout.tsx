import { requirePagePermission } from "@/lib/page-auth";

export default async function ContractsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("contract.view");
  return <>{children}</>;
}
