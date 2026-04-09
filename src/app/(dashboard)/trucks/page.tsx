import { Truck, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function TrucksPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-xl"
            style={{
              background: "oklch(0.630 0.155 152 / 12%)",
              boxShadow: "inset 0 0 0 1px oklch(0.630 0.155 152 / 25%)",
            }}
          >
            <Truck className="h-7 w-7" style={{ color: "oklch(0.630 0.155 152)" }} />
          </div>
          <h2 className="text-lg font-bold">الشاحنات</h2>
          <p className="text-sm text-muted-foreground text-center">
            تسجيل الشاحنات وإدارة طابور الانتظار
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            الشريحة 3 — قيد التطوير
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
