import { getTranslations } from "next-intl/server";
import { ScaleOperationView } from "@/components/scale/scale-operation-view";
import { WEIGHBRIDGE_DISCREPANCY_WARN_KG } from "@/lib/weighbridge-discrepancy";
import { isStockModuleEnabled } from "@/config/feature-flags";

export default async function ScaleOperationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const truckId = parseInt(id, 10);
  const t = await getTranslations("scale");

  if (isNaN(truckId)) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {t("invalidId")}
      </div>
    );
  }

  return (
    <ScaleOperationView
      truckId={truckId}
      discrepancyWarnKg={WEIGHBRIDGE_DISCREPANCY_WARN_KG}
      stockModuleEnabled={isStockModuleEnabled()}
    />
  );
}
