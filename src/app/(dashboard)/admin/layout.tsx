import { requirePagePermission } from "@/lib/page-auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("user.manage");
  return <>{children}</>;
}
