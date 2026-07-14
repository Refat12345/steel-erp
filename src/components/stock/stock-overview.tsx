"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { RefreshCw, MapPin, Warehouse, Layers, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SEGMENT_META,
  segmentUnitLabel,
  unitLabel,
  type Segment,
  type StockUnit,
} from "./stock-shared";

interface BalanceLine {
  sizeId: number | null;
  sizeName: string | null;
  grade: "FIRST" | "SECOND" | null;
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
  isActive: boolean;
  gridRow: number;
  gridCol: number;
  gridSpan: number;
  lines: BalanceLine[];
  totalQuantity: number;
  totalTons: number | null;
}

const BUNDLE_SEGMENTS: Segment[] = ["GENERAL", "GOVERNORATES", "ISOLATION"];
const SEGMENT_ORDER: Segment[] = ["GENERAL", "GOVERNORATES", "ISOLATION", "SHORTBAR"];

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** One yard's live schematic map — tiles driven by grid coords, colored by
 *  segment, showing the current balance on each site. */
function LiveYardMap({ locations }: { locations: LocationBalance[] }) {
  if (locations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        لا توجد مواقع نشطة في هذه الساحة
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
          const empty = l.totalQuantity === 0 && (l.totalTons ?? 0) === 0;
          // Label from the PRIMARY-unit lines only (the parallel tonnage line
          // mirrors the same size, so it would just duplicate the name).
          const primaryLines = l.lines.filter((ln) => ln.unit === l.unit && ln.quantity !== 0);
          const sizeLabel =
            primaryLines.length > 2
              ? `${primaryLines.length} مقاسات`
              : primaryLines.length > 0
                ? primaryLines.map((ln) => ln.sizeName ?? "قصائر").join("، ")
                : l.expectedSize?.displayName ?? segmentUnitLabel(l.segment);
          return (
            <div
              key={l.locationId}
              className={cn(
                "flex flex-col justify-between rounded-md border p-2 text-center shadow-sm transition",
                meta.tile,
                empty && "opacity-45",
              )}
              style={{
                gridColumn: `${l.gridCol} / span ${l.gridSpan}`,
                gridRow: `${l.gridRow}`,
              }}
              title={`${l.nameAr} — ${meta.label}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-xs font-bold leading-none">{l.code}</span>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
              </div>
              <div
                className="mt-1 text-base font-bold leading-none tabular-nums"
                dir="rtl"
              >
                {empty ? (
                  <span className="text-xs font-normal opacity-60">فارغ</span>
                ) : (
                  <>
                    {fmt(l.totalQuantity)}
                    <span className="ms-0.5 text-[10px] font-normal opacity-70">
                      {unitLabel(l.unit)}
                    </span>
                    {l.isDualUnit && (l.totalTons ?? 0) > 0 && (
                      <span className="ms-1 text-[10px] font-normal opacity-70">
                        / {fmt(l.totalTons ?? 0)} طن
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="mt-0.5 truncate text-[10px] opacity-75" dir="rtl">
                {sizeLabel}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StockOverview() {
  const [balances, setBalances] = useState<LocationBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeYard, setActiveYard] = useState<string>("");

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

  // Size breakdown for bundle segments: size → bundles per segment + total,
  // plus the parallel tonnage. Bundle and ton lines are counted separately.
  const sizeBreakdown = useMemo(() => {
    const bySize = new Map<
      string,
      {
        sizeName: string;
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
        const key = ln.sizeName ?? "—";
        const row =
          bySize.get(key) ??
          { sizeName: key, GENERAL: 0, GOVERNORATES: 0, ISOLATION: 0, total: 0, tons: 0 };
        if (ln.unit === "TON") {
          row.tons += ln.quantity;
        } else {
          row[b.segment as "GENERAL" | "GOVERNORATES" | "ISOLATION"] += ln.quantity;
          row.total += ln.quantity;
        }
        bySize.set(key, row);
      }
    }
    return [...bySize.values()].sort((a, b) => a.sizeName.localeCompare(b.sizeName, "ar"));
  }, [balances]);

  const shortbarTotal = useMemo(
    () =>
      balances
        .filter((b) => b.segment === "SHORTBAR")
        .reduce((sum, b) => sum + b.totalQuantity, 0),
    [balances],
  );

  const grandOccupied = balances.filter((b) => b.totalQuantity > 0).length;

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
                  {meta.label}
                </div>
                <div className="mt-1.5 text-xl font-bold tabular-nums">
                  {fmt(s.total)}{" "}
                  <span className="text-xs font-normal opacity-70">{unitLabel(s.unit)}</span>
                </div>
                <div className="text-[11px] opacity-70">{s.occupied} موقع مشغول</div>
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
            خريطة الساحات — الأرصدة الحيّة
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => void fetchData()}>
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {SEGMENT_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", SEGMENT_META[s].dot)} />
                {SEGMENT_META[s].label}
              </div>
            ))}
          </div>

          {yards.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              <Warehouse className="mx-auto mb-2 h-8 w-8 opacity-40" />
              لا توجد مواقع مضبوطة
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
                  <LiveYardMap locations={y.locations} />
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
            الإجمالي حسب المقاس (ربطات)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sizeBreakdown.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              لا توجد أرصدة ربطات بعد
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">المقاس</TableHead>
                    <TableHead className="w-28 text-center">نخب أول عام</TableHead>
                    <TableHead className="w-28 text-center">نخب أول محافظات</TableHead>
                    <TableHead className="w-24 text-center">نخب ثاني</TableHead>
                    <TableHead className="w-24 text-center">إجمالي الربطات</TableHead>
                    <TableHead className="w-24 text-center">الطن</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sizeBreakdown.map((r) => (
                    <TableRow key={r.sizeName}>
                      <TableCell className="text-start font-medium">{r.sizeName}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.GENERAL ? fmt(r.GENERAL) : "—"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.GOVERNORATES ? fmt(r.GOVERNORATES) : "—"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {r.ISOLATION ? fmt(r.ISOLATION) : "—"}
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">
                        {fmt(r.total)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">
                        {r.tons ? fmt(r.tons) : "—"}
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
              إجمالي القصائر:{" "}
              <span className="font-bold tabular-nums">{fmt(shortbarTotal)}</span> طن
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {grandOccupied} موقع مشغول من أصل {balances.length}
      </p>
    </div>
  );
}
