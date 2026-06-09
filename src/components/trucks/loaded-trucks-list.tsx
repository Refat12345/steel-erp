"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Search, CalendarDays } from "lucide-react";
import { formatDate } from "@/lib/date-format";
import { defaultOperationalDateInput } from "@/lib/operational-day";

interface LoadedSize {
  sizeId: number | null;
  displayName: string;
  totalTons: number;
  totalBundles: number | null;
}

interface LoadedTruckItem {
  id: number;
  status: string;
  customerName: string | null;
  destinationName: string | null;
  tareWeightKg: string | null;
  grossWeightKg: string | null;
  createdAt: string;
  loadedSizes: LoadedSize[];
}

const PAGE_SIZE = 25;

function formatKg(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatTons(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function LoadedTrucksList() {
  const router = useRouter();
  const [data, setData] = useState<LoadedTruckItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [customerSearch, setCustomerSearch] = useState("");
  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );

  const todayOperationalDate = defaultOperationalDateInput();
  const isTodaySelected = operationalDate === todayOperationalDate;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (customerSearch.trim()) params.set("customer", customerSearch.trim());
      if (operationalDate) params.set("operationalDate", operationalDate);

      const res = await fetch(`/api/trucks/loaded?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
      setTotal(json.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [page, customerSearch, operationalDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [customerSearch, operationalDate]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">حركة الشاحنات</h2>
        <p className="text-sm text-muted-foreground">
          عرض الزبون والوجهة وصافي القبان والأقطار المحمّلة لكل شاحنة
        </p>
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border bg-card/70 p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {/* Customer search */}
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <label
              htmlFor="loaded-customer-search"
              className="text-xs font-medium text-muted-foreground"
            >
              بحث
            </label>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="loaded-customer-search"
                placeholder="بحث باسم الزبون..."
                className="ps-9"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Operational day */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label
                htmlFor="loaded-operational-date"
                className="text-xs font-medium text-muted-foreground"
              >
                يوم التشغيل
              </label>
              <span className="text-[11px] text-muted-foreground">(08:00 ← 08:00)</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="loaded-operational-date"
                type="date"
                className="w-[10.5rem] shrink-0"
                value={operationalDate}
                onChange={(e) => setOperationalDate(e.target.value)}
              />
              <Button
                type="button"
                variant={isTodaySelected ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setOperationalDate(defaultOperationalDateInput())}
              >
                <CalendarDays className="h-4 w-4 me-1" />
                اليوم
              </Button>
            </div>
          </div>

          {/* Count */}
          {operationalDate && (
            <Badge
              variant="secondary"
              className="h-10 px-3 text-sm tabular-nums shrink-0"
            >
              {loading ? "…" : `${total.toLocaleString("en-US")} شاحنة`}
            </Badge>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead>الزبون</TableHead>
              <TableHead>الوجهة</TableHead>
              <TableHead>صافي القبان (كغ)</TableHead>
              <TableHead>الأقطار المحمّلة</TableHead>
              <TableHead>التاريخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-muted-foreground"
                >
                  لا توجد شاحنات
                </TableCell>
              </TableRow>
            ) : (
              data.map((truck) => {
                const isCancelled = truck.status === "Cancelled";
                const tareKg = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;
                const grossKg = truck.grossWeightKg ? Number(truck.grossWeightKg) : null;
                const bridgeNetKg =
                  tareKg != null && grossKg != null ? grossKg - tareKg : null;
                return (
                  <TableRow
                    key={truck.id}
                    className={`cursor-pointer hover:bg-muted/50 ${
                      isCancelled ? "bg-destructive/5 hover:bg-destructive/10" : ""
                    }`}
                    onClick={() =>
                      router.push(`/scale/${truck.id}?from=loaded-trucks`)
                    }
                  >
                    <TableCell className="text-sm">
                      {truck.customerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {truck.destinationName ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums">
                      {bridgeNetKg != null ? formatKg(bridgeNetKg) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {truck.loadedSizes.length === 0 ? (
                        "—"
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {truck.loadedSizes.map((s, idx) => (
                            <Badge
                              key={s.sizeId ?? `none-${idx}`}
                              variant="secondary"
                              className="font-normal tabular-nums"
                            >
                              <span className="font-medium">{s.displayName}</span>
                              {s.totalBundles != null && (
                                <span className="ms-1">
                                  {s.totalBundles.toLocaleString("en-US")} ربطة
                                </span>
                              )}
                              <span className="ms-1 text-muted-foreground">
                                ({formatTons(s.totalTons)} طن)
                              </span>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(truck.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">
            {total > 0
              ? `عرض ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} من ${total}`
              : "لا توجد نتائج"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="px-2 tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
