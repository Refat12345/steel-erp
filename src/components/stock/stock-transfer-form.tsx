"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2, ArrowLeftRight, MoveRight } from "lucide-react";
import {
  SEGMENT_META,
  unitLabel,
  segmentEnforcesOneSize,
  type Segment,
  type StockUnit,
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

export function StockTransferForm() {
  const [balances, setBalances] = useState<LocationBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [sourceId, setSourceId] = useState<string>("");
  const [sizeKey, setSizeKey] = useState<string>(""); // sizeId as string, "none" for tons
  const [quantity, setQuantity] = useState<string>("");
  const [quantityTons, setQuantityTons] = useState<string>(""); // actual weight for rebar
  const [destId, setDestId] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stock/balances");
      const json = await res.json();
      if (json.success) setBalances(json.data as LocationBalance[]);
      else toast.error(json.error || "خطأ في جلب الأرصدة");
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Only locations that currently hold stock can be a source.
  const sourceOptions = useMemo(
    () => balances.filter((b) => b.totalQuantity > 0),
    [balances],
  );

  const source = useMemo(
    () => balances.find((b) => String(b.locationId) === sourceId) ?? null,
    [balances, sourceId],
  );

  // Positive-balance BUNDLE lines at the source (usually one after the
  // one-size rule, but legacy sites may hold more than one size). The parallel
  // TON lines are excluded here — they mirror the same size.
  const sourceLines = useMemo(
    () => (source ? source.lines.filter((l) => l.unit === "BUNDLE" && l.quantity > 0) : []),
    [source],
  );

  const isBundle = source?.unit === "BUNDLE";
  const isDual = source?.isDualUnit ?? false;

  // Auto-select the size line when the source changes.
  useEffect(() => {
    if (!source) {
      setSizeKey("");
      return;
    }
    if (source.unit === "TON") {
      setSizeKey("none");
    } else {
      const first = source.lines.find((l) => l.unit === "BUNDLE" && l.quantity > 0);
      setSizeKey(first?.sizeId != null ? String(first.sizeId) : "");
    }
    setDestId("");
    setQuantity("");
    setQuantityTons("");
  }, [source]);

  const selectedSizeId: number | null =
    sizeKey === "none" || sizeKey === "" ? null : Number(sizeKey);

  const available = useMemo(() => {
    if (!source) return 0;
    if (source.unit === "TON") return source.totalQuantity;
    const line = source.lines.find((l) => l.unit === "BUNDLE" && l.sizeId === selectedSizeId);
    return line?.quantity ?? 0;
  }, [source, selectedSizeId]);

  // Parallel tonnage available at the source for the selected rebar size.
  const availableTons = useMemo(() => {
    if (!source || !isDual) return 0;
    const line = source.lines.find((l) => l.unit === "TON" && l.sizeId === selectedSizeId);
    return line?.quantity ?? 0;
  }, [source, selectedSizeId, isDual]);

  // Destination candidates: same unit, not the source. Classify each as
  // blocked (holds a different size), suggested (empty or same size), or plain.
  const destOptions = useMemo(() => {
    if (!source) return [];
    return balances
      .filter((b) => b.unit === source.unit && b.locationId !== source.locationId)
      .map((b) => {
        // The ISOLATION zone accepts multiple sizes, so a different size there
        // is not a blocker — only single-size (first-grade) sites are blocked.
        const otherSize =
          isBundle && segmentEnforcesOneSize(b.segment)
            ? b.lines.some(
                (l) => l.unit === "BUNDLE" && l.sizeId !== selectedSizeId && l.quantity > 0,
              )
            : false;
        const sameSize = isBundle
          ? b.lines.some((l) => l.unit === "BUNDLE" && l.sizeId === selectedSizeId && l.quantity > 0)
          : false;
        const empty = b.totalQuantity === 0;
        return {
          loc: b,
          blocked: otherSize,
          suggested: empty || sameSize,
          reasonLabel: sameSize
            ? "نفس المقاس"
            : empty
              ? b.segment === source.segment
                ? "فارغ · نفس النخب"
                : "فارغ"
              : otherSize
                ? "مشغول بمقاس آخر"
                : "",
        };
      })
      .sort((a, b) => {
        if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
        if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
        return a.loc.code.localeCompare(b.loc.code);
      });
  }, [balances, source, isBundle, selectedSizeId]);

  const dest = balances.find((b) => String(b.locationId) === destId) ?? null;

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const sourceItems = useMemo(
    () =>
      sourceOptions.map((b) => ({
        value: String(b.locationId),
        label: `${b.nameAr} (${fmt(b.totalQuantity)} ${unitLabel(b.unit)})`,
      })),
    [sourceOptions],
  );
  const sizeLineItems = useMemo(
    () =>
      sourceLines.map((l) => ({
        value: String(l.sizeId),
        label: l.sizeName ?? "—",
      })),
    [sourceLines],
  );
  const destItems = useMemo(
    () =>
      destOptions.map((o) => ({
        value: String(o.loc.locationId),
        label: o.loc.nameAr,
      })),
    [destOptions],
  );

  function reset() {
    setQuantity("");
    setQuantityTons("");
    setDestId("");
    setReason("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !dest) {
      toast.error("اختر الموقع المصدر والوجهة");
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      toast.error("أدخل كمية صحيحة");
      return;
    }
    if (qty > available) {
      toast.error(`الكمية أكبر من المتاح (${fmt(available)})`);
      return;
    }
    if (isBundle && !Number.isInteger(qty)) {
      toast.error("عدد الربطات يجب أن يكون عدداً صحيحاً");
      return;
    }
    const tons = Number(quantityTons);
    if (isDual) {
      if (!tons || tons <= 0) {
        toast.error("أدخل الوزن الفعلي المرحَّل (طن)");
        return;
      }
      if (tons > availableTons) {
        toast.error(`الوزن أكبر من المتاح (${fmt(availableTons)} طن)`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/stock/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromLocationId: source.locationId,
          toLocationId: dest.locationId,
          sizeId: isBundle ? selectedSizeId : null,
          quantity: qty,
          quantityTons: isDual ? tons : null,
          reason,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || "تعذّر الترحيل");
        return;
      }
      toast.success("تم الترحيل بنجاح");
      reset();
      await fetchData();
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          ترحيل بين المواقع
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sourceOptions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            لا توجد مواقع فيها رصيد للترحيل منها
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Source */}
            <div className="space-y-1.5">
              <Label>من موقع</Label>
              <Select items={sourceItems} value={sourceId} onValueChange={(v) => setSourceId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الموقع المصدر" />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((b) => (
                    <SelectItem key={b.locationId} value={String(b.locationId)}>
                      <span className="flex w-full items-center justify-between gap-3">
                        <span>{b.nameAr}</span>
                        <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                          {fmt(b.totalQuantity)} {unitLabel(b.unit)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Size line (bundles with more than one size only) */}
            {isBundle && sourceLines.length > 1 && (
              <div className="space-y-1.5">
                <Label>المقاس</Label>
                <Select items={sizeLineItems} value={sizeKey} onValueChange={(v) => setSizeKey(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="اختر المقاس" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceLines.map((l) => (
                      <SelectItem key={l.sizeId ?? "n"} value={String(l.sizeId)}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{l.sizeName ?? "—"}</span>
                          <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                            {fmt(l.quantity)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {source && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                المتاح للترحيل:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {fmt(available)} {unitLabel(source.unit)}
                </span>
                {isDual && (
                  <>
                    {" "}·{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {fmt(availableTons)} طن
                    </span>
                  </>
                )}
                {isBundle && sourceLines.length === 1 && sourceLines[0].sizeName && (
                  <> · مقاس {sourceLines[0].sizeName}</>
                )}
              </div>
            )}

            {/* Quantity (primary unit) */}
            <div className="space-y-1.5">
              <Label>{isBundle ? "عدد الربطات" : "الكمية (طن)"}</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={isBundle ? 1 : 0.001}
                max={available || undefined}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={isBundle ? "عدد الربطات" : "بالطن"}
              />
            </div>

            {/* Actual weight for rebar (dual-unit) transfers */}
            {isDual && (
              <div className="space-y-1.5">
                <Label>الوزن الفعلي المرحَّل (طن)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.001}
                  max={availableTons || undefined}
                  value={quantityTons}
                  onChange={(e) => setQuantityTons(e.target.value)}
                  placeholder="بالطن"
                />
              </div>
            )}

            {/* Destination */}
            <div className="space-y-1.5">
              <Label>إلى موقع</Label>
              <Select items={destItems} value={destId} onValueChange={(v) => setDestId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الموقع الوجهة" />
                </SelectTrigger>
                <SelectContent>
                  {destOptions.map((o) => (
                    <SelectItem
                      key={o.loc.locationId}
                      value={String(o.loc.locationId)}
                      disabled={o.blocked}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${SEGMENT_META[o.loc.segment].dot}`}
                        />
                        {o.loc.nameAr}
                        {o.suggested && (
                          <Badge variant="secondary" className="text-[10px]">
                            مقترح
                          </Badge>
                        )}
                        {o.reasonLabel && (
                          <span className="text-[10px] text-muted-foreground">
                            · {o.reasonLabel}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview */}
            {source && dest && quantity && (
              <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <span className="font-medium">{source.code}</span>
                <MoveRight className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{dest.code}</span>
                <span className="tabular-nums font-semibold">
                  {fmt(Number(quantity) || 0)} {unitLabel(source.unit)}
                  {isDual && quantityTons && (
                    <> / {fmt(Number(quantityTons) || 0)} طن</>
                  )}
                </span>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label>ملاحظة (اختياري)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="سبب الترحيل"
                maxLength={500}
              />
            </div>

            <Button
              type="submit"
              disabled={
                submitting || !source || !dest || !quantity || (isDual && !quantityTons)
              }
            >
              {submitting && <Loader2 className="animate-spin" />}
              تنفيذ الترحيل
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
