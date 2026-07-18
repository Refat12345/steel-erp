import { getTranslations } from "next-intl/server";
import { ScaleCardPrint } from "@/components/scale/scale-card-print";

export default async function ScaleCardPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { id } = await params;
  const { format } = await searchParams;
  const truckId = parseInt(id, 10);
  const t = await getTranslations("scale");

  if (isNaN(truckId)) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {t("invalidId")}
      </div>
    );
  }

  const variant = format === "driver" ? "driver" : "internal";

  return <ScaleCardPrint truckId={truckId} variant={variant} />;
}
