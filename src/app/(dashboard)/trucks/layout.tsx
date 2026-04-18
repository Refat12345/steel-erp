import { requirePagePermission } from "@/lib/page-auth";

export default async function TrucksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("truck.view_queue", "truck.view_approved");
  return <>{children}</>;
}
