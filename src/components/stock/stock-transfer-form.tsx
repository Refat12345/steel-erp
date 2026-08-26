"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { formatDecimal } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  SEGMENT_META,
  segmentEnforcesOneSize,
  type Segment,
  type StockUnit,
} from "./stock-shared";

interface BalanceLine {
  sizeId: number | null;
  sizeName: string | null;
  classificationId: number | null;
  classificationName: string | null;
  unit: StockUnit;
  quantity: number;
}

/** Stable key for a (size, classification) balance line. */
function lineKeyOf(l: Pick<BalanceLine, "sizeId" | "classificationId">): string {
  return `${l.sizeId ?? "n"}:${l.classificationId ?? "n"}`;
}

/** Size label + classification suffix, e.g. "12 مم B500B". */
function lineLabel(
  l: Pick<BalanceLine, "sizeName" | "classificationName">,
  fallback: string,
): string {
  const size = l.sizeName ?? fallback;
  return l.classificationName ? `${size} ${l.classificationName}` : size;
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
  expectedClassification: { id: number; code: string; displayName: string } | null;
  allowedGrade?: "FIRST" | "SECOND" | null;
  lines: BalanceLine[];
  totalQuantity: number;
  totalTons: number | null;
}

function fmt(n: number): string {
  return formatDecimal(n, 3);
}

export function StockTransferForm() {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const [balances, setBalances] = useState<LocationBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [sourceId, setSourceId] = useState<string>("");
  // Selected balance line: "sizeId:classificationId" ("n" = null), "none" for tons.
  const [sizeKey, setSizeKey] = useState<string>("");
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
      else toast.error(json.error || t("errorLoadBalances"));
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setSizeKey(first?.sizeId != null ? lineKeyOf(first) : "");
    }
    setDestId("");
    setQuantity("");
    setQuantityTons("");
  }, [source]);

  // The selected (size, classification) line resolved from the composite key.
  const selectedLine = useMemo(
    () =>
      sizeKey === "none" || sizeKey === ""
        ? null
        : (sourceLines.find((l) => lineKeyOf(l) === sizeKey) ?? null),
    [sourceLines, sizeKey],
  );
  const selectedSizeId: number | null = selectedLine?.sizeId ?? null;
  const selectedClassificationId: number | null =
    selectedLine?.classificationId ?? null;

  const available = useMemo(() => {
    if (!source) return 0;
    if (source.unit === "TON") return source.totalQuantity;
    return selectedLine?.quantity ?? 0;
  }, [source, selectedLine]);

  // Parallel tonnage available at the source for the selected rebar line
  // (same size AND classification — the two units mirror each other).
  const availableTons = useMemo(() => {
    if (!source || !isDual) return 0;
    const line = source.lines.find(
      (l) =>
        l.unit === "TON" &&
        l.sizeId === selectedSizeId &&
        l.classificationId === selectedClassificationId,
    );
    return line?.quantity ?? 0;
  }, [source, selectedSizeId, selectedClassificationId, isDual]);

  // Destination candidates: same unit, not the source. Classify each as
  // blocked (holds a different size / empty with mismatched expectedSize),
  // suggested (empty or same size), or plain.
  const destOptions = useMemo(() => {
    if (!source) return [];
    return balances
      .filter((b) => b.unit === source.unit && b.locationId !== source.locationId)
      .map((b) => {
        // The ISOLATION zone accepts multiple sizes, so a different size there
        // is not a blocker — only single-size (first-grade) sites are blocked.
        const enforces = isBundle && segmentEnforcesOneSize(b.segment);
        const otherSize = enforces
          ? b.lines.some(
              (l) => l.unit === "BUNDLE" && l.sizeId !== selectedSizeId && l.quantity > 0,
            )
          : false;
        const sameSize = isBundle
          ? b.lines.some((l) => l.unit === "BUNDLE" && l.sizeId === selectedSizeId && l.quantity > 0)
          : false;
        const emptyBundles = !b.lines.some(
          (l) => l.unit === "BUNDLE" && l.sizeId != null && l.quantity > 0,
        );
        const empty = b.totalQuantity === 0;
        // Empty (no positive bundles): expectedSize must match the transferred size.
        const expectedMismatch =
          enforces &&
          emptyBundles &&
          b.expectedSize != null &&
          selectedSizeId != null &&
          b.expectedSize.id !== selectedSizeId;
        const destClassId = b.expectedClassification?.id ?? null;
        const classMismatch =
          (b.segment === "GENERAL" || b.segment === "GOVERNORATES") &&
          destClassId !== selectedClassificationId;
        let reasonLabel = "";
        if (classMismatch && destClassId != null)
          reasonLabel = t("destExpectedClassificationOnly", {
            classification: b.expectedClassification!.displayName,
          });
        else if (classMismatch)
          reasonLabel = t("destOrdinaryRebarOnly");
        else if (sameSize) reasonLabel = t("destSameSize");
        else if (expectedMismatch)
          reasonLabel = t("destExpectedSizeOnly", { size: b.expectedSize!.displayName });
        else if (empty)
          reasonLabel =
            b.segment === source.segment ? t("destEmptySameSegment") : t("destEmpty");
        else if (otherSize) reasonLabel = t("destOccupiedOtherSize");
        return {
          loc: b,
          blocked: otherSize || expectedMismatch || classMismatch,
          suggested: (empty || sameSize) && !expectedMismatch && !classMismatch,
          reasonLabel,
        };
      })
      .sort((a, b) => {
        if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
        if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
        return a.loc.code.localeCompare(b.loc.code);
      });
  }, [balances, source, isBundle, selectedSizeId, selectedClassificationId, t]);

  const dest = balances.find((b) => String(b.locationId) === destId) ?? null;

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const sourceItems = useMemo(
    () =>
      sourceOptions.map((b) => ({
        value: String(b.locationId),
        label: `${b.nameAr} (${fmt(b.totalQuantity)} ${tEnums(`stockUnit.${b.unit}`)})`,
      })),
    [sourceOptions, tEnums],
  );
  const sizeLineItems = useMemo(
    () =>
      sourceLines.map((l) => ({
        value: lineKeyOf(l),
        label: lineLabel(l, t("emDash")),
      })),
    [sourceLines, t],
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
      toast.error(t("selectSourceAndDest"));
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      toast.error(t("enterValidQuantity"));
      return;
    }
    if (qty > available) {
      toast.error(t("qtyExceedsAvailable", { available: fmt(available) }));
      return;
    }
    if (isBundle && !Number.isInteger(qty)) {
      toast.error(t("bundlesMustBeInteger"));
      return;
    }
    const tons = Number(quantityTons);
    if (isDual) {
      if (!tons || tons <= 0) {
        toast.error(t("enterActualWeightTons"));
        return;
      }
      if (tons > availableTons) {
        toast.error(t("weightExceedsAvailable", { available: fmt(availableTons) }));
        return;
      }
    }
    const destMeta = destOptions.find((o) => o.loc.locationId === dest.locationId);
    if (destMeta?.blocked) {
      toast.error(
        destMeta.reasonLabel ||
          t("locationSizeMustMatchExpectedToast", {
            size: dest.expectedSize?.displayName ?? t("emDash"),
          }),
      );
      return;
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
          classificationId: isBundle ? selectedClassificationId : null,
          quantity: qty,
          quantityTons: isDual ? tons : null,
          reason,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t("errorTransfer"));
        return;
      }
      toast.success(t("transferSuccess"));
      reset();
      await fetchData();
    } catch {
      toast.error(t("errorConnection"));
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
          {t("transferFormTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sourceOptions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("noSourceWithBalance")}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Source */}
            <div className="space-y-1.5">
              <Label>{t("fromLocation")}</Label>
              <Select items={sourceItems} value={sourceId} onValueChange={(v) => setSourceId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectSourceLocation")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {sourceOptions.map((b) => (
                    <SelectItem key={b.locationId} value={String(b.locationId)}>
                      <span className="flex w-full items-center justify-between gap-3">
                        <span>{b.nameAr}</span>
                        <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                          {fmt(b.totalQuantity)} {tEnums(`stockUnit.${b.unit}`)}
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
                <Label>{t("size")}</Label>
                <Select items={sizeLineItems} value={sizeKey} onValueChange={(v) => setSizeKey(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("selectSize")} />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
                    {sourceLines.map((l) => (
                      <SelectItem key={lineKeyOf(l)} value={lineKeyOf(l)}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{lineLabel(l, t("emDash"))}</span>
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
                {t("availableToTransfer")}{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {fmt(available)} {tEnums(`stockUnit.${source.unit}`)}
                </span>
                {isDual && (
                  <span className="font-semibold text-foreground tabular-nums">
                    {t("availableTonsPart", { tons: fmt(availableTons) })}
                  </span>
                )}
                {isBundle && sourceLines.length === 1 && sourceLines[0].sizeName && (
                  <>{t("sizeColon", { size: lineLabel(sourceLines[0], "") })}</>
                )}
              </div>
            )}

            {/* Quantity (primary unit) */}
            <div className="space-y-1.5">
              <Label>{isBundle ? t("bundleCount") : t("quantityTons")}</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={isBundle ? 1 : 0.001}
                max={available || undefined}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={isBundle ? t("placeholderBundles") : t("placeholderTons")}
              />
            </div>

            {/* Actual weight for rebar (dual-unit) transfers */}
            {isDual && (
              <div className="space-y-1.5">
                <Label>{t("actualWeightTons")}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.001}
                  max={availableTons || undefined}
                  value={quantityTons}
                  onChange={(e) => setQuantityTons(e.target.value)}
                  placeholder={t("placeholderTons")}
                />
              </div>
            )}

            {/* Destination */}
            <div className="space-y-1.5">
              <Label>{t("toLocation")}</Label>
              <Select items={destItems} value={destId} onValueChange={(v) => setDestId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectDestLocation")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
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
                            {t("suggested")}
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
                  {fmt(Number(quantity) || 0)} {tEnums(`stockUnit.${source.unit}`)}
                  {isDual && quantityTons && (
                    <>{t("withTons", { tons: fmt(Number(quantityTons) || 0) })}</>
                  )}
                </span>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label>{t("notesOptional")}</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("transferReasonPlaceholder")}
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
              {t("executeTransfer")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
