import { ScaleCardPrint } from "@/components/scale/scale-card-print";

export default async function ScaleCardPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const truckId = parseInt(id, 10);

  if (isNaN(truckId)) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        معرّف العملية غير صالح
      </div>
    );
  }

  return <ScaleCardPrint truckId={truckId} />;
}
