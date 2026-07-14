"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  unitLabel,
  isDualUnitSegment,
  type Segment,
  type StockUnit,
  type SizeOption,
} from "./stock-shared";

interface BalanceLine {
  sizeId: number | null;
  sizeName: string | null;
  unit: StockUnit;
  quantity: number;
}
interface LocationBalance {
  locationId: number;
  code: string;
  nameAr: string;
  yardNameAr: string;
  segment: Segment;
  unit: StockUnit;
  isDualUnit: boolean;
  isActive: boolean;
  lines: BalanceLine[];
  totalQuantity: number;
  totalTons: number | null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function StockAdjustForm() {
  const [balances, setBalances] = useState<LocationBalance[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [locationId, setLocationId] = useState("");
  const [unit, setUnit] = useState<StockUnit | "">("");
  const [sizeId, setSizeId] = useState("");
  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, locRes] = await Promise.all([
        fetch("/api/stock/balances"),
        fetch("/api/stock/locations"),
      ]);
      const balJson = await balRes.json();
      const locJson = await locRes.json();
      if (balJson.success) setBalances(balJson.data as LocationBalance[]);
      else toast.error(balJson.error || "خطأ في جلب الأرصدة");
      if (locJson.success) {
        setSizes(
          (locJson.data.sizes as (SizeOption & { isBundleType: boolean })[]).filter(
            (s) => s.isBundleType,
          ),
        );
      }
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const selected = useMemo(
    () => balances.find((b) => String(b.locationId) === locationId) ?? null,
    [balances, locationId],
  );
  const dual = selected?.isDualUnit ?? false;
  // Rebar sites let the user pick which balance to correct; short-bar is TON.
  const effectiveUnit: StockUnit | "" = selected
    ? dual
      ? unit
      : "TON"
    : "";
  const isBundle = effectiveUnit === "BUNDLE";
  // Rebar needs a size for both units; short-bar carries no size.
  const needsSize = selected != null && isDualUnitSegment(selected.segment);

  // Base UI's Select shows the raw value in the trigger unless an items
  // (value → label) map is provided.
  const locationItems = useMemo(
    () =>
      balances.map((b) => ({
        value: String(b.locationId),
        label: `${b.yardNameAr} — ${b.nameAr}`,
      })),
    [balances],
  );
  const sizeItems = useMemo(
    () => sizes.map((s) => ({ value: String(s.id), label: s.displayName })),
    [sizes],
  );

  // Current system balance for the chosen (location, size, unit) triple.
  const currentQty = useMemo(() => {
    if (!selected || !effectiveUnit) return null;
    if (!needsSize) {
      const line = selected.lines.find((l) => l.unit === effectiveUnit && l.sizeId == null);
      return line?.quantity ?? 0;
    }
    if (!sizeId) return null;
    const line = selected.lines.find(
      (l) => l.unit === effectiveUnit && l.sizeId === Number(sizeId),
    );
    return line?.quantity ?? 0;
  }, [selected, sizeId, effectiveUnit, needsSize]);

  const parsedActual = actual === "" ? null : Number(actual);
  const delta =
    currentQty != null && parsedActual != null && Number.isFinite(parsedActual)
      ? parsedActual - currentQty
      : null;

  function handleLocationChange(v: string | null) {
    setLocationId(v ?? "");
    setUnit("");
    setSizeId("");
    setActual("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!effectiveUnit) {
      toast.error("اختر وحدة التصحيح (ربطات أو طن)");
      return;
    }
    if (parsedActual == null || !Number.isFinite(parsedActual) || parsedActual < 0) {
      toast.error("أدخل الكمية الفعلية (صفر أو أكثر)");
      return;
    }
    if (needsSize && !sizeId) {
      toast.error("المقاس مطلوب لهذا الموقع");
      return;
    }
    if (isBundle && !Number.isInteger(parsedActual)) {
      toast.error("عدد الربطات يجب أن يكون عدداً صحيحاً");
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("اذكر سبب التصحيح (5 أحرف على الأقل)");
      return;
    }
    if (delta === 0) {
      toast.error("لا يوجد فرق — الرصيد الفعلي يطابق رصيد النظام");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: selected.locationId,
          unit: effectiveUnit,
          sizeId: needsSize ? Number(sizeId) : null,
          actualQuantity: parsedActual,
          reason,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || "تعذّر تسجيل التصحيح");
        return;
      }
      const d = json.data as { delta: number };
      toast.success(
        `تم التصحيح — الفرق المسجّل: ${d.delta > 0 ? "+" : ""}${fmt(d.delta)}`,
      );
      setActual("");
      setReason("");
      await fetchData();
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-lg" />;
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" />
          تصحيح جرد
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>الموقع *</Label>
            <Select items={locationItems} value={locationId} onValueChange={handleLocationChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختر موقع المخزون" />
              </SelectTrigger>
              <SelectContent>
                {balances.map((b) => (
                  <SelectItem key={b.locationId} value={String(b.locationId)}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span>
                        {b.nameAr}
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({b.yardNameAr})
                        </span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                        {fmt(b.totalQuantity)} {unitLabel(b.unit)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected && dual && (
            <div className="space-y-1.5">
              <Label>وحدة التصحيح *</Label>
              <div className="flex gap-2">
                {(["BUNDLE", "TON"] as StockUnit[]).map((u) => (
                  <Button
                    key={u}
                    type="button"
                    variant={effectiveUnit === u ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => {
                      setUnit(u);
                      setActual("");
                    }}
                  >
                    {u === "BUNDLE" ? "ربطات" : "طن"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {needsSize && effectiveUnit && (
            <div className="space-y-1.5">
              <Label>المقاس *</Label>
              <Select items={sizeItems} value={sizeId} onValueChange={(v) => setSizeId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر المقاس" />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => {
                    const line = selected?.lines.find(
                      (l) => l.unit === effectiveUnit && l.sizeId === s.id,
                    );
                    return (
                      <SelectItem key={s.id} value={String(s.id)}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{s.displayName}</span>
                          {line && (
                            <span
                              className="text-xs tabular-nums text-muted-foreground"
                              dir="ltr"
                            >
                              {fmt(line.quantity)}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {currentQty != null && selected && effectiveUnit && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              رصيد النظام الحالي:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {fmt(currentQty)} {unitLabel(effectiveUnit)}
              </span>
            </div>
          )}

          {effectiveUnit && (
            <div className="space-y-1.5">
              <Label htmlFor="actual">
                {isBundle ? "العدد الفعلي المعدود (ربطات) *" : "الكمية الفعلية (طن) *"}
              </Label>
              <Input
                id="actual"
                type="number"
                min={0}
                step={isBundle ? 1 : 0.001}
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                dir="ltr"
                className="text-left"
                disabled={!selected || (needsSize && !sizeId)}
              />
            </div>
          )}

          {delta != null && delta !== 0 && selected && (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-medium",
                delta > 0
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-rose-300 bg-rose-50 text-rose-900",
              )}
            >
              الفرق الذي سيُسجَّل:{" "}
              <span className="font-bold tabular-nums" dir="ltr">
                {delta > 0 ? "+" : ""}
                {fmt(delta)}
              </span>{" "}
              {effectiveUnit ? unitLabel(effectiveUnit) : ""}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">سبب التصحيح *</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="مثال: جرد فعلي بتاريخ اليوم — فرق عدّ"
            />
          </div>

          <Button
            type="submit"
            disabled={
              submitting ||
              !selected ||
              !effectiveUnit ||
              actual === "" ||
              (needsSize && !sizeId)
            }
          >
            {submitting && <Loader2 className="animate-spin" />}
            تسجيل التصحيح
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
