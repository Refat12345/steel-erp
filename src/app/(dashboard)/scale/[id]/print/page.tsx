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

  if (isNaN(truckId)) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        معرّف العملية غير صالح
      </div>
    );
  }

  const variant = format === "driver" ? "driver" : "internal";

  return <ScaleCardPrint truckId={truckId} variant={variant} />;
}
