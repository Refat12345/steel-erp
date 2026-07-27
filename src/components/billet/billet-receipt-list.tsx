"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { sessionHasPermission } from "@/lib/client-permissions";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Plus,
  Search,
  Truck,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import { RegisterBilletReceiptDialog } from "@/components/billet/register-billet-receipt-dialog";
import { getTextDirection, type Locale } from "@/i18n/config";
import { formatDecimal, formatInteger } from "@/lib/number-format";

interface ReceiptItem {
  id: number;
  receiptNumber: string;
  plateNumber: string;
  driverName: string;
  status: string;
  netWeightKg: string | null;
  isPriorWithdrawal: boolean;
  priorWithdrawalDate: string | null;
  createdAt: string;
  contract: { contractNumber: string; supplierName: string };
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Registered: "outline",
  Loaded: "secondary",
  Unloading: "secondary",
  AwaitingExit: "secondary",
  Completed: "default",
  Cancelled: "destructive",
};

function formatKgDisplay(value: string | null): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return formatDecimal(n, 1);
}

export function BilletReceiptList() {
  const t = useTranslations("billet");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";
  const { data: session } = useSession();
  const canRegister = sessionHasPermission(session, "billet.receipt.register");
  const canViewHistory = sessionHasPermission(
    session,
    "billet.receipt.view_history",
  );
  const router = useRouter();
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [plateNumber, setPlateNumber] = useState("");
  const [status, setStatus] = useState("");
  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analyticsStartDate, setAnalyticsStartDate] = useState<string | null>(null);
  const pageSize = 25;

  const todayOperationalDate = defaultOperationalDateInput();
  const isTodaySelected = operationalDate === todayOperationalDate;

  const statusLabel = (code: string) =>
    tEnums(`billetReceiptStatus.${code}` as "billetReceiptStatus.Registered");

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (plateNumber) params.set("plateNumber", plateNumber);
      if (status) params.set("status", status);
      if (operationalDate) params.set("operationalDate", operationalDate);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/billet-receipts?${params}`);
      const json = await res.json();
      if (json.success) {
        setReceipts(json.data);
        setTotal(json.total);
        setAnalyticsStartDate(json.analyticsStartDate ?? null);
      }
    } catch {
      toast.error(t("receipts.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [plateNumber, status, operationalDate, page, t]);

  useEffect(() => {
    setPage(1);
  }, [plateNumber, status, operationalDate]);

  useEffect(() => {
    const timer = setTimeout(fetchReceipts, 300);
    return () => clearTimeout(timer);
  }, [fetchReceipts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card/70 p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <label
              htmlFor="billet-plate-search"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("receipts.search")}
            </label>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="billet-plate-search"
                placeholder={t("receipts.searchPlatePlaceholder")}
                className="ps-9"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="flex w-full flex-col gap-1.5 sm:w-[11rem]">
            <label className="text-xs font-medium text-muted-foreground">
              {t("receipts.status")}
            </label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("receipts.allStatuses")} />
              </SelectTrigger>
              <SelectContent dir={dir}>
                <SelectItem value="">{t("receipts.allStatuses")}</SelectItem>
                <SelectItem value="Registered">{statusLabel("Registered")}</SelectItem>
                <SelectItem value="Loaded">{statusLabel("Loaded")}</SelectItem>
                <SelectItem value="Unloading">{statusLabel("Unloading")}</SelectItem>
                <SelectItem value="AwaitingExit">{statusLabel("AwaitingExit")}</SelectItem>
                <SelectItem value="Completed">{statusLabel("Completed")}</SelectItem>
                <SelectItem value="Cancelled">{statusLabel("Cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {canViewHistory && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="billet-operational-date"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("receipts.operationalDay")}
                </label>
                <span className="text-[11px] text-muted-foreground">
                  {t("receipts.operationalDayHint")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="billet-operational-date"
                  type="date"
                  className="w-[10.5rem] shrink-0"
                  value={operationalDate}
                  min={analyticsStartDate ?? undefined}
                  onChange={(e) => setOperationalDate(e.target.value)}
                />
                <Button
                  type="button"
                  variant={isTodaySelected ? "default" : "outline"}
                  className="shrink-0"
                  onClick={() => setOperationalDate(defaultOperationalDateInput())}
                >
                  <CalendarDays className="h-4 w-4 me-1" />
                  {t("receipts.today")}
                </Button>
              </div>
            </div>
          )}

          {operationalDate && (
            <Badge
              variant="secondary"
              className="h-10 shrink-0 px-3 text-sm tabular-nums"
            >
              {loading
                ? "…"
                : t("receipts.recordsCount", { total: formatInteger(total) })}
            </Badge>
          )}

          {canRegister && (
            <Button className="shrink-0" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 me-1" />
              {t("receipts.registerReceipt")}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="w-full min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 text-start">
                {t("receipts.columns.receiptNumber")}
              </TableHead>
              <TableHead className="w-40 max-w-40 text-start">
                {t("receipts.columns.supplier")}
              </TableHead>
              <TableHead className="w-28 text-start">
                {t("receipts.columns.type")}
              </TableHead>
              <TableHead className="w-32 text-start">
                {t("receipts.columns.plate")}
              </TableHead>
              <TableHead className="w-32 text-start">
                {t("receipts.columns.driver")}
              </TableHead>
              <TableHead className="w-28 text-start">
                {t("receipts.columns.netKg")}
              </TableHead>
              <TableHead className="w-24 text-center">
                {t("receipts.columns.status")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : receipts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Truck className="h-8 w-8 opacity-40" />
                    {plateNumber || status
                      ? t("receipts.emptyNoResults")
                      : t("receipts.emptyNoRecordsForDay")}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              receipts.map((r) => {
                const variant = statusVariant[r.status] || statusVariant.Registered;
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/billet-receipts/${r.id}`)}
                  >
                    <TableCell className="text-start font-mono text-sm font-semibold">
                      {r.receiptNumber}
                    </TableCell>
                    <TableCell className="max-w-40 text-start">
                      <span className="block truncate" title={r.contract.supplierName}>
                        {r.contract.supplierName}
                      </span>
                    </TableCell>
                    <TableCell className="text-start">
                      {r.isPriorWithdrawal ? (
                        <Badge variant="secondary">
                          {t("receipts.typePriorWithdrawal")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("receipts.typeReceipt")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-start">{r.plateNumber}</TableCell>
                    <TableCell className="text-start truncate">{r.driverName}</TableCell>
                    <TableCell className="text-start tabular-nums">
                      {formatKgDisplay(r.netWeightKg)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Badge variant={variant}>{statusLabel(r.status)}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t("receipts.pageOf", {
              page: formatInteger(page),
              totalPages: formatInteger(totalPages),
              total: formatInteger(total),
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={t("previous")}
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
              aria-label={t("next")}
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

      <RegisterBilletReceiptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={fetchReceipts}
      />
    </div>
  );
}
