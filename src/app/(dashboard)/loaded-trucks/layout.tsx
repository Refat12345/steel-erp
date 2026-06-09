import { requirePagePermission } from "@/lib/page-auth";

export default async function LoadedTrucksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("report.daily_trucks");
  return <>{children}</>;
}
