import { requirePagePermission } from "@/lib/page-auth";

export default async function ScaleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("truck.view_approved", "scale.start", "scale.close");
  return <>{children}</>;
}
