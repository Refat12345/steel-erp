import { requirePagePermission } from "@/lib/page-auth";

export default async function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("document.view", "document.manage");
  return <>{children}</>;
}
