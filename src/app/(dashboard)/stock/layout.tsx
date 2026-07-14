import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/page-auth";
import { isStockModuleEnabled } from "@/config/feature-flags";

export default async function StockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Dark-launch: when the module is disabled the whole route group renders as
  // 404 (reveals nothing about the unreleased feature). Backstops middleware.
  if (!isStockModuleEnabled()) notFound();
  await requirePagePermission("stock.view");
  return <>{children}</>;
}
