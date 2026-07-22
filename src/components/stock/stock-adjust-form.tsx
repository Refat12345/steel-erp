"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { formatDecimal } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  isDualUnitSegment,
  segmentEnforcesOneSize,
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
  expectedSize: { id: number; displayName: string } | null;
  lines: BalanceLine[];
  totalQuantity: number;
  totalTons: number | null;
}

function fmt(n: number): string {
  return formatDecimal(n, 3);
}

export function StockAdjustForm() {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

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
      if (balJson.success && locJson.success) {
        // Merge expectedSize from locations (balances payload already has it,
        // but keep an explicit map so empty bays still lock correctly).
        const expectedById = new Map<number, { id: number; displayName: string } | null>();
        for (const y of locJson.data.yards as Array<{
          locations: Array<{
            id: number;
            expectedSize: { id: number; displayName: string } | null;
          }>;
        }>) {
          for (const l of y.locations) {
            expectedById.set(l.id, l.expectedSize);
          }
        }
        setBalances(
          (balJson.data as LocationBalance[]).map((b) => ({
            ...b,
            expectedSize: b.expectedSize ?? expectedById.get(b.locationId) ?? null,
          })),
        );
        setSizes(
          (locJson.data.sizes as (SizeOption & { isBundleType: boolean })[]).filter(
            (s) => s.isBundleType,
          ),
        );
      } else {
        if (!balJson.success) toast.error(balJson.error || t("errorLoadBalances"));
        if (!locJson.success) toast.error(locJson.error || t("errorLoadLocations"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  // GENERAL / GOVERNORATES: lock to the occupied bundle size (or expected
  // size when empty). Same rule as production-in — prevents parking tons of
  // a different diameter on a bay that already holds 8mm bundles.
  const currentSize = useMemo(() => {
    if (!selected || !segmentEnforcesOneSize(selected.segment)) return null;
    const line = selected.lines.find(
      (l) => l.unit === "BUNDLE" && l.sizeId != null && l.quantity > 0,
    );
    if (line?.sizeId != null) {
      return { id: line.sizeId, displayName: line.sizeName ?? String(line.sizeId) };
    }
    return selected.expectedSize;
  }, [selected]);
  const sizeLocked = currentSize != null;
  const lockedSizeLabel = currentSize?.displayName ?? "";

  useEffect(() => {
    if (!sizeLocked || !currentSize) return;
    const locked = String(currentSize.id);
    if (sizeId !== locked) setSizeId(locked);
  }, [sizeLocked, currentSize, sizeId]);

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
    const value = v ?? "";
    setLocationId(value);
    setUnit("");
    setActual("");
    const loc = balances.find((b) => String(b.locationId) === value);
    if (loc && segmentEnforcesOneSize(loc.segment)) {
      const line = loc.lines.find(
        (l) => l.unit === "BUNDLE" && l.sizeId != null && l.quantity > 0,
      );
      const size = line?.sizeId != null
        ? { id: line.sizeId, displayName: line.sizeName ?? "" }
        : loc.expectedSize;
      setSizeId(size ? String(size.id) : "");
    } else {
      setSizeId("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!effectiveUnit) {
      toast.error(t("selectAdjustUnitToast"));
      return;
    }
    if (parsedActual == null || !Number.isFinite(parsedActual) || parsedActual < 0) {
      toast.error(t("enterActualQuantity"));
      return;
    }
    if (needsSize && !sizeId) {
      toast.error(t("sizeRequiredForLocation"));
      return;
    }
    if (sizeLocked && currentSize && Number(sizeId) !== currentSize.id) {
      toast.error(
        t("locationSizeMustMatchExpectedToast", {
          size: currentSize.displayName,
        }),
      );
      return;
    }
    if (isBundle && !Number.isInteger(parsedActual)) {
      toast.error(t("bundlesMustBeInteger"));
      return;
    }
    if (reason.trim().length < 5) {
      toast.error(t("adjustReasonMinLength"));
      return;
    }
    if (delta === 0) {
      toast.error(t("noDelta"));
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
        toast.error(json.error || t("errorAdjust"));
        return;
      }
      const d = json.data as { delta: number };
      const deltaStr = `${d.delta > 0 ? "+" : ""}${fmt(d.delta)}`;
      toast.success(t("adjustSuccess", { delta: deltaStr }));
      setActual("");
      setReason("");
      await fetchData();
    } catch {
      toast.error(t("errorConnection"));
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
          {t("adjustFormTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("locationRequired")}</Label>
            <Select items={locationItems} value={locationId} onValueChange={handleLocationChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("selectStockLocation")} />
              </SelectTrigger>
              <SelectContent dir={dir}>
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
                        {fmt(b.totalQuantity)} {tEnums(`stockUnit.${b.unit}`)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected && dual && (
            <div className="space-y-1.5">
              <Label>{t("adjustUnitRequired")}</Label>
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
                    {u === "BUNDLE" ? t("unitBundles") : t("unitTons")}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {needsSize && effectiveUnit && (
            <div className="space-y-1.5">
              <Label>{t("sizeRequired")}</Label>
              {sizeLocked ? (
                <>
                  <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">
                    {lockedSizeLabel}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selected?.lines.some(
                      (l) => l.unit === "BUNDLE" && l.sizeId != null && l.quantity > 0,
                    )
                      ? t("sizeLockedToBalanceHint")
                      : t("sizeLockedToLocationHint")}
                  </p>
                </>
              ) : (
                <Select items={sizeItems} value={sizeId} onValueChange={(v) => setSizeId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("selectSize")} />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
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
              )}
            </div>
          )}

          {currentQty != null && selected && effectiveUnit && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t("systemBalance")}{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {fmt(currentQty)} {tEnums(`stockUnit.${effectiveUnit}`)}
              </span>
            </div>
          )}

          {effectiveUnit && (
            <div className="space-y-1.5">
              <Label htmlFor="actual">
                {isBundle ? t("actualBundleCountRequired") : t("actualQuantityTonsRequired")}
              </Label>
              <Input
                id="actual"
                type="number"
                min={0}
                step={isBundle ? 1 : 0.001}
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                dir="ltr"
                className="text-start"
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
              {t("deltaPreview")}{" "}
              <span className="font-bold tabular-nums" dir="ltr">
                {delta > 0 ? "+" : ""}
                {fmt(delta)}
              </span>{" "}
              {effectiveUnit ? tEnums(`stockUnit.${effectiveUnit}`) : ""}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">{t("adjustReasonRequired")}</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={t("adjustReasonPlaceholder")}
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
            {t("submitAdjustment")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
