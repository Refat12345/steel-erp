import { requirePagePermission } from "@/lib/page-auth";
import { LoadedTrucksList } from "@/components/trucks/loaded-trucks-list";

export default async function LoadedTrucksPage() {
  await requirePagePermission("report.daily_trucks");
  return <LoadedTrucksList />;
}
