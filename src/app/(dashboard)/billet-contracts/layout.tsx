import { requirePagePermission } from "@/lib/page-auth";

export default async function BilletContractsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("billet.contract.view");
  return <>{children}</>;
}
