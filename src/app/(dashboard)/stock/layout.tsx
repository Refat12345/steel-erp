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
  // Any stock operational permission may enter the route group. Each page
  // still enforces its own stricter code (e.g. production-in → production.*
  // only — clerks do not need stock.view for the map).
  await requirePagePermission(
    "stock.view",
    "stock.movements.view",
    "stock.production.ton",
    "stock.production.bundle",
    "stock.transfer",
    "stock.adjust",
    "stock.opening_balance",
    "stock.location.manage",
  );
  return <>{children}</>;
}
