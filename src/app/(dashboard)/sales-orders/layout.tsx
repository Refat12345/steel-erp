import { requirePagePermission } from "@/lib/page-auth";

export default async function SalesOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("salesorder.view");
  return <>{children}</>;
}
