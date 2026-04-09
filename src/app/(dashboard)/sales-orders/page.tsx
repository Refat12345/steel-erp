import { ShoppingCart, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function SalesOrdersPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-xl"
            style={{
              background: "oklch(0.720 0.150 65 / 14%)",
              boxShadow: "inset 0 0 0 1px oklch(0.720 0.150 65 / 28%)",
            }}
          >
            <ShoppingCart className="h-7 w-7" style={{ color: "oklch(0.720 0.150 65)" }} />
          </div>
          <h2 className="text-lg font-bold">أوامر البيع</h2>
          <p className="text-sm text-muted-foreground text-center">
            إنشاء وإدارة أوامر البيع بأنماط التسوية المختلفة
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            الشريحة 2 — قيد التطوير
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
