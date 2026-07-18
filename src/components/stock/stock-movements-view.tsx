"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Boxes,
  ScrollText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDecimal } from "@/lib/number-format";
import { formatDateTime } from "@/lib/date-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  MOVEMENT_TYPES,
  type MovementType,
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
  yardNameAr: string;
  segment: Segment;
  unit: StockUnit;
  isDualUnit: boolean;
  isActive: boolean;
  lines: BalanceLine[];
  totalQuantity: number;
  totalTons: number | null;
}

interface Movement {
  id: number;
  createdAt: string;
  type: MovementType;
  locationId: number;
  locationCode: string;
  locationNameAr: string;
  sizeName: string | null;
  grade: "FIRST" | "SECOND" | null;
  quantity: number;
  unit: StockUnit;
  reason: string | null;
  createdBy: string;
}

function fmt(n: number): string {
  return formatDecimal(n, 3);
}

export function StockMovementsView() {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";

  const [balances, setBalances] = useState<LocationBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(true);

  const [movements, setMovements] = useState<Movement[]>([]);
  const [movLoading, setMovLoading] = useState(true);
  const [locationFilter, setLocationFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const fetchBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const res = await fetch("/api/stock/balances");
      const json = await res.json();
      if (json.success) setBalances(json.data as LocationBalance[]);
      else toast.error(json.error || t("errorLoadBalances"));
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setBalancesLoading(false);
    }
  }, [t]);

  const fetchMovements = useCallback(async () => {
    setMovLoading(true);
    try {
      const params = new URLSearchParams();
      if (locationFilter) params.set("locationId", locationFilter);
      if (typeFilter) params.set("type", typeFilter);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/stock/movements?${params}`);
      const json = await res.json();
      if (json.success) {
        setMovements(json.data as Movement[]);
        setTotal(json.total as number);
      } else {
        toast.error(json.error || t("errorLoadMovements"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setMovLoading(false);
    }
  }, [locationFilter, typeFilter, page, t]);

  useEffect(() => {
    void fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    setPage(1);
  }, [locationFilter, typeFilter]);

  useEffect(() => {
    void fetchMovements();
  }, [fetchMovements]);

  const nonZero = balances.filter((b) => b.totalQuantity !== 0 || b.lines.length > 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const locationFilterItems = [
    { value: "", label: t("allLocations") },
    ...balances.map((b) => ({
      value: String(b.locationId),
      label: b.nameAr,
    })),
  ];
  const typeFilterItems = [
    { value: "", label: t("allTypes") },
    ...MOVEMENT_TYPES.map((type) => ({
      value: type,
      label: tEnums(`stockMovementType.${type}`),
    })),
  ];

  function gradeLabel(grade: "FIRST" | "SECOND" | null): string {
    if (grade === "FIRST" || grade === "SECOND") return tEnums(`grade.${grade}`);
    return t("emDash");
  }

  return (
    <div className="space-y-6">
      {/* ── Current balances ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4" />
            {t("currentBalances")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : nonZero.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("noBalancesYet")}
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("colLocation")}</TableHead>
                    <TableHead className="text-start">{t("colYard")}</TableHead>
                    <TableHead className="text-start">{t("colDetail")}</TableHead>
                    <TableHead className="w-32 text-center">{t("colTotal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nonZero.map((b) => (
                    <TableRow key={b.locationId}>
                      <TableCell className="text-start font-medium">
                        <span className="font-mono text-xs">{b.code}</span> — {b.nameAr}
                      </TableCell>
                      <TableCell className="text-start text-xs text-muted-foreground">
                        {b.yardNameAr}
                      </TableCell>
                      <TableCell className="text-start text-xs">
                        {b.lines.length === 0
                          ? t("emDash")
                          : b.lines
                              .map((l) =>
                                t("balanceLine", {
                                  size: l.sizeName ?? t("shortbar"),
                                  gradePart: l.grade
                                    ? t("gradePart", { grade: gradeLabel(l.grade) })
                                    : "",
                                  qty: fmt(l.quantity),
                                  unit: tEnums(`stockUnit.${l.unit}`),
                                }),
                              )
                              .join(", ")}
                      </TableCell>
                      <TableCell className="text-center tabular-nums font-semibold">
                        {fmt(b.totalQuantity)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          {tEnums(`stockUnit.${b.unit}`)}
                        </span>
                        {b.isDualUnit && (b.totalTons ?? 0) > 0 && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {" "}
                            {t("withTons", { tons: fmt(b.totalTons ?? 0) })}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Movement log ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" />
            {t("movementLog")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select
              items={locationFilterItems}
              value={locationFilter}
              onValueChange={(v) => setLocationFilter(v ?? "")}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder={t("allLocations")} />
              </SelectTrigger>
              <SelectContent dir={dir}>
                <SelectItem value="">{t("allLocations")}</SelectItem>
                {balances.map((b) => (
                  <SelectItem key={b.locationId} value={String(b.locationId)}>
                    {b.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={typeFilterItems}
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v ?? "")}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("allTypes")} />
              </SelectTrigger>
              <SelectContent dir={dir}>
                <SelectItem value="">{t("allTypes")}</SelectItem>
                {MOVEMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {tEnums(`stockMovementType.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36 text-start">{t("colDate")}</TableHead>
                  <TableHead className="text-start">{t("colLocation")}</TableHead>
                  <TableHead className="w-28 text-start">{t("colType")}</TableHead>
                  <TableHead className="text-start">{t("colSizeGrade")}</TableHead>
                  <TableHead className="w-28 text-center">{t("colQuantity")}</TableHead>
                  <TableHead className="text-start">{t("colBy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {t("noMovements")}
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-start text-xs tabular-nums" dir="ltr">
                        {formatDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell className="text-start text-xs">
                        <span className="font-mono">{m.locationCode}</span> — {m.locationNameAr}
                      </TableCell>
                      <TableCell className="text-start">
                        <Badge variant="secondary" className="text-[10px]">
                          {tEnums(`stockMovementType.${m.type}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-start text-xs">
                        {m.sizeName ?? t("shortbar")}
                        {m.grade
                          ? t("gradeDot", { grade: gradeLabel(m.grade) })
                          : ""}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-center tabular-nums font-semibold",
                          m.quantity < 0 ? "text-destructive" : "text-emerald-600",
                        )}
                      >
                        {m.quantity > 0 ? "+" : ""}
                        {fmt(m.quantity)}
                      </TableCell>
                      <TableCell className="text-start text-xs text-muted-foreground">
                        {m.createdBy}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {total > pageSize && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t("pageOfMovements", { page, totalPages, total })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {isRtl ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {isRtl ? (
                    <ChevronLeft className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
