import { requirePagePermission } from "@/lib/page-auth";

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("payment.view");
  return <>{children}</>;
}
