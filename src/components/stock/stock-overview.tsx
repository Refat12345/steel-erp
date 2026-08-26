"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "next-auth/react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { RefreshCw, MapPin, Warehouse, Layers, Ruler, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDecimal } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SEGMENT_META,
  SEGMENT_ORDER,
  segmentHoldsSteelClassification,
  type Segment,
  type StockUnit,
  type LocationClassificationRef,
} from "./stock-shared";

interface BalanceLine {
  sizeId: number | null;
  sizeName: string | null;
  grade: "FIRST" | "SECOND" | null;
  classificationId: number | null;
  classificationName: string | null;
  unit: StockUnit;
  quantity: number;
}
interface LocationBalance {
  locationId: number;
  code: string;
  nameAr: string;
  yardId: number;
  yardNameAr: string;
  segment: Segment;
  unit: StockUnit;
  isDualUnit: boolean;
  expectedSize: { id: number; displayName: string } | null;
  expectedClassification?: { id: number; code: string; displayName: string } | null;
  isActive: boolean;
  gridRow: number;
  gridCol: number;
  gridSpan: number;
  lines: BalanceLine[];
  totalQuantity: number;
  totalTons: number | null;
}

const BUNDLE_SEGMENTS: Segment[] = ["GENERAL", "GOVERNORATES", "ISOLATION"];

function fmt(n: number): string {
  return formatDecimal(n, 3);
}

function baySizeLabel(
  l: LocationBalance,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string {
  const primaryLines = l.lines.filter((ln) => ln.unit === l.unit && ln.quantity !== 0);
  const lineLabels = [
    ...new Set(
      primaryLines.map((ln) => {
        const size = ln.sizeName ?? t("shortbar");
        return ln.classificationName ? `${size} ${ln.classificationName}` : size;
      }),
    ),
  ];
  if (lineLabels.length > 2) return t("sizesCount", { count: lineLabels.length });
  if (lineLabels.length > 0) return lineLabels.join(", ");
  return (
    [l.expectedSize?.displayName, l.expectedClassification?.code]
      .filter(Boolean)
      .join(" ") ||
    (l.segment === "SHORTBAR" ? t("segmentUnitByTons") : t("segmentUnitByBundles"))
  );
}

function canMarkBayB500B(l: LocationBalance): boolean {
  if (!segmentHoldsSteelClassification(l.segment)) return false;
  if (l.expectedClassification) return false;
  return l.totalQuantity > 0;
}

/** One yard's live schematic map — tiles driven by grid coords, colored by
 *  segment, showing the current balance on each site. */
function LiveYardMap({
  locations,
  onSelect,
}: {
  locations: LocationBalance[];
  onSelect: (location: LocationBalance) => void;
}) {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  if (locations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("noActiveLocationsInYard")}
      </div>
    );
  }
  const maxCol = Math.max(...locations.map((l) => l.gridCol + l.gridSpan - 1), 1);
  const maxRow = Math.max(...locations.map((l) => l.gridRow), 1);

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-3">
      <div
        dir="ltr"
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${maxCol}, minmax(96px, 1fr))`,
          gridTemplateRows: `repeat(${maxRow}, auto)`,
          minWidth: maxCol * 104,
        }}
      >
        {locations.map((l) => {
          const meta = SEGMENT_META[l.segment];
          const segmentLabel = tEnums(`stockSegment.${l.segment}`);
          const empty = l.totalQuantity === 0 && (l.totalTons ?? 0) === 0;
          const sizeLabel = baySizeLabel(l, t);
          return (
            <button
              type="button"
              key={l.locationId}
              className={cn(
                "flex flex-col justify-between rounded-md border p-2 text-center shadow-sm transition",
                meta.tile,
                empty && "opacity-45",
                "cursor-pointer hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              style={{
                gridColumn: `${l.gridCol} / span ${l.gridSpan}`,
                gridRow: `${l.gridRow}`,
              }}
              title={`${l.nameAr} (${l.code}) — ${segmentLabel}`}
              onClick={() => onSelect(l)}
            >
              <div className="flex items-start justify-between gap-1">
                <span
                  className="line-clamp-2 min-w-0 text-start text-sm font-bold leading-snug"
                  dir={dir}
                >
                  {l.nameAr}
                </span>
                <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", meta.dot)} />
              </div>
              <div className="mt-0.5 truncate text-[10px] font-medium opacity-80" dir={dir}>
                {segmentLabel}
              </div>
              <div
                className="mt-1 text-base font-bold leading-none tabular-nums"
                dir={dir}
              >
                {empty ? (
                  <span className="text-xs font-normal opacity-60">{t("empty")}</span>
                ) : (
                  <>
                    {fmt(l.totalQuantity)}
                    <span className="ms-0.5 text-[10px] font-normal opacity-70">
                      {tEnums(`stockUnit.${l.unit}`)}
                    </span>
                    {l.isDualUnit && (l.totalTons ?? 0) > 0 && (
                      <span className="ms-1 text-[10px] font-normal opacity-70">
                        {t("withTons", { tons: fmt(l.totalTons ?? 0) })}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] opacity-75">
                <span className="truncate" dir={dir}>
                  {sizeLabel}
                </span>
                <span className="shrink-0 font-mono tabular-nums opacity-70">{l.code}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StockOverview() {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const { data: session } = useSession();
  const canMarkClassification = sessionHasPermission(
    session,
    "stock.classification.mark",
  );
  const [balances, setBalances] = useState<LocationBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeYard, setActiveYard] = useState<string>("");
  const [selectedBay, setSelectedBay] = useState<LocationBalance | null>(null);
  const [b500b, setB500b] = useState<LocationClassificationRef | null>(null);
  const [marking, setMarking] = useState(false);

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [balRes, classRes] = await Promise.all([
        fetch("/api/stock/balances"),
        fetch("/api/steel-classifications"),
      ]);
      const json = await balRes.json();
      if (json.success) setBalances(json.data as LocationBalance[]);
      else toast.error(json.error || t("errorLoadBalances"));
      const classJson = await classRes.json().catch(() => null);
      if (classJson?.success) {
        const rows = classJson.data as LocationClassificationRef[];
        setB500b(rows.find((c) => c.code === "B500B") ?? rows[0] ?? null);
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

  // Group locations by yard, preserving first-seen order (service sorts them).
  const yards = useMemo(() => {
    const map = new Map<number, { id: number; nameAr: string; locations: LocationBalance[] }>();
    for (const b of balances) {
      let y = map.get(b.yardId);
      if (!y) {
        y = { id: b.yardId, nameAr: b.yardNameAr, locations: [] };
        map.set(b.yardId, y);
      }
      y.locations.push(b);
    }
    return [...map.values()];
  }, [balances]);

  useEffect(() => {
    setActiveYard((prev) =>
      prev && yards.some((y) => String(y.id) === prev)
        ? prev
        : yards[0]
          ? String(yards[0].id)
          : "",
    );
  }, [yards]);

  // Per-segment totals + occupied-site counts.
  const segmentSummary = useMemo(() => {
    const acc = new Map<Segment, { total: number; occupied: number; unit: StockUnit }>();
    for (const b of balances) {
      const cur = acc.get(b.segment) ?? { total: 0, occupied: 0, unit: b.unit };
      cur.total += b.totalQuantity;
      if (b.totalQuantity > 0) cur.occupied += 1;
      acc.set(b.segment, cur);
    }
    return SEGMENT_ORDER.filter((s) => acc.has(s)).map((s) => ({
      segment: s,
      ...acc.get(s)!,
    }));
  }, [balances]);

  // Size breakdown for bundle segments: (size, classification) → bundles per
  // segment + total, plus the parallel tonnage. Splitting by classification
  // keeps B500B and B400DWR of the same size on separate rows.
  const sizeBreakdown = useMemo(() => {
    const bySize = new Map<
      string,
      {
        sizeName: string;
        classificationName: string | null;
        GENERAL: number;
        GOVERNORATES: number;
        ISOLATION: number;
        total: number;
        tons: number;
      }
    >();
    for (const b of balances) {
      if (!BUNDLE_SEGMENTS.includes(b.segment)) continue;
      for (const ln of b.lines) {
        if (ln.quantity === 0) continue;
        const sizeName = ln.sizeName ?? "—";
        const key = `${sizeName}|${ln.classificationName ?? ""}`;
        const row =
          bySize.get(key) ??
          {
            sizeName,
            classificationName: ln.classificationName,
            GENERAL: 0,
            GOVERNORATES: 0,
            ISOLATION: 0,
            total: 0,
            tons: 0,
          };
        if (ln.unit === "TON") {
          row.tons += ln.quantity;
        } else {
          row[b.segment as "GENERAL" | "GOVERNORATES" | "ISOLATION"] += ln.quantity;
          row.total += ln.quantity;
        }
        bySize.set(key, row);
      }
    }
    return [...bySize.values()].sort(
      (a, b) =>
        a.sizeName.localeCompare(b.sizeName, locale) ||
        (a.classificationName ?? "").localeCompare(b.classificationName ?? "", locale),
    );
  }, [balances, locale]);

  const shortbarTotal = useMemo(
    () =>
      balances
        .filter((b) => b.segment === "SHORTBAR")
        .reduce((sum, b) => sum + b.totalQuantity, 0),
    [balances],
  );

  const grandOccupied = balances.filter((b) => b.totalQuantity > 0).length;

  async function markSelectedBay() {
    if (!selectedBay || !b500b) return;
    const sizeLabel = baySizeLabel(selectedBay, t);
    if (
      !window.confirm(
        t("markLocationB500BConfirm", {
          location: selectedBay.nameAr,
          size: sizeLabel,
          classification: b500b.displayName,
        }),
      )
    ) {
      return;
    }
    setMarking(true);
    try {
      const res = await fetch(
        `/api/stock/locations/${selectedBay.locationId}/mark-classification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classificationId: b500b.id }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t("errorGeneric"));
        return;
      }
      toast.success(
        t("markLocationB500BSuccess", { classification: b500b.displayName }),
      );
      setSelectedBay(null);
      await fetchData({ silent: true });
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setMarking(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Segment summary strip ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {segmentSummary.map((s) => {
          const meta = SEGMENT_META[s.segment];
          return (
            <Card key={s.segment} className={cn("border", meta.tile)}>
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  {tEnums(`stockSegment.${s.segment}`)}
                </div>
                <div className="mt-1.5 text-xl font-bold tabular-nums">
                  {fmt(s.total)}{" "}
                  <span className="text-xs font-normal opacity-70">
                    {tEnums(`stockUnit.${s.unit}`)}
                  </span>
                </div>
                <div className="text-[11px] opacity-70">
                  {t("occupiedSites", { count: s.occupied })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Live yard maps ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            {t("liveYardMapTitle")}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => void fetchData()}>
            <RefreshCw className="h-4 w-4" />
            {t("refresh")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {SEGMENT_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", SEGMENT_META[s].dot)} />
                {tEnums(`stockSegment.${s}`)}
              </div>
            ))}
          </div>
          {canMarkClassification && (
            <p className="text-xs text-muted-foreground">{t("mapMarkClassificationHint")}</p>
          )}

          {yards.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              <Warehouse className="mx-auto mb-2 h-8 w-8 opacity-40" />
              {t("noLocationsConfigured")}
            </div>
          ) : (
            <Tabs value={activeYard} onValueChange={(v) => setActiveYard(v as string)}>
              <TabsList>
                {yards.map((y) => (
                  <TabsTrigger key={y.id} value={String(y.id)}>
                    {y.nameAr}
                    <Badge variant="secondary" className="ms-1.5 text-[10px]">
                      {y.locations.filter((l) => l.totalQuantity > 0).length}/{y.locations.length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              {yards.map((y) => (
                <TabsContent key={y.id} value={String(y.id)} className="pt-2">
                  <LiveYardMap
                    locations={y.locations}
                    onSelect={(l) => setSelectedBay(l)}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* ── Size breakdown (bundles) ──────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="h-4 w-4" />
            {t("sizeBreakdownTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sizeBreakdown.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("noBundleBalancesYet")}
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("colSize")}</TableHead>
                    <TableHead className="w-28 text-center">{t("colGeneral")}</TableHead>
                    <TableHead className="w-28 text-center">{t("colGovernorates")}</TableHead>
                    <TableHead className="w-24 text-center">{t("colSecondGrade")}</TableHead>
                    <TableHead className="w-24 text-center">{t("colTotalBundles")}</TableHead>
                    <TableHead className="w-24 text-center">{t("colTons")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sizeBreakdown.map((r) => (
                    <TableRow key={`${r.sizeName}|${r.classificationName ?? ""}`}>
                      <TableCell className="text-start font-medium">
                        {r.sizeName}
                        {r.classificationName && (
                          <Badge
                            variant="outline"
                            className="ms-1.5 text-[10px] font-normal"
                          >
                            {r.classificationName}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.GENERAL ? fmt(r.GENERAL) : t("emDash")}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.GOVERNORATES ? fmt(r.GOVERNORATES) : t("emDash")}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.ISOLATION ? fmt(r.ISOLATION) : t("emDash")}
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">
                        {fmt(r.total)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">
                        {r.tons ? fmt(r.tons) : t("emDash")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {shortbarTotal > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900">
              <Layers className="h-4 w-4" />
              {t("shortbarTotal")}{" "}
              <span className="font-bold tabular-nums">{fmt(shortbarTotal)}</span>{" "}
              {t("tonsSuffix")}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {t("occupiedOfTotal", { occupied: grandOccupied, total: balances.length })}
      </p>

      <Sheet
        open={selectedBay != null}
        onOpenChange={(open) => {
          if (!open) setSelectedBay(null);
        }}
      >
        <SheetContent side="bottom" dir={dir} className="max-h-[85dvh]">
          {selectedBay && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedBay.nameAr}</SheetTitle>
                <SheetDescription>
                  {selectedBay.code} · {tEnums(`stockSegment.${selectedBay.segment}`)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-2 px-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("colSize")}</span>
                  <span className="font-medium">{baySizeLabel(selectedBay, t)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("colQuantity")}</span>
                  <span className="tabular-nums font-medium">
                    {fmt(selectedBay.totalQuantity)}{" "}
                    {tEnums(`stockUnit.${selectedBay.unit}`)}
                    {selectedBay.isDualUnit && (selectedBay.totalTons ?? 0) > 0 &&
                      t("withTons", { tons: fmt(selectedBay.totalTons ?? 0) })}
                  </span>
                </div>
                {selectedBay.expectedClassification && (
                  <Badge variant="outline" className="font-mono">
                    {selectedBay.expectedClassification.code}
                  </Badge>
                )}
              </div>
              <SheetFooter>
                {selectedBay.expectedClassification ? (
                  <p className="w-full text-xs text-muted-foreground">
                    {t("bayAlreadyB500B", {
                      classification: selectedBay.expectedClassification.displayName,
                    })}
                  </p>
                ) : canMarkClassification && canMarkBayB500B(selectedBay) && b500b ? (
                  <Button
                    className="w-full"
                    disabled={marking}
                    onClick={() => void markSelectedBay()}
                  >
                    {marking && <Loader2 className="animate-spin" />}
                    {t("markAsB500B", { classification: b500b.displayName })}
                  </Button>
                ) : canMarkClassification &&
                  segmentHoldsSteelClassification(selectedBay.segment) ? (
                  <p className="w-full text-xs text-muted-foreground">
                    {t("reserveB500BFromLocations")}
                  </p>
                ) : null}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
