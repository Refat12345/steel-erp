import { requirePagePermission } from "@/lib/page-auth";

export default async function BilletReceiptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("billet.receipt.view");
  return <>{children}</>;
}
