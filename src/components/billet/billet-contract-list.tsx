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
import { Plus, Search, Eye, Package, ChevronLeft, ChevronRight } from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";
import { formatDecimal, formatInteger } from "@/lib/number-format";

interface PieceLine {
  id: number;
  billetLengthM: number;
  contractedPieces: number;
}

interface BilletContract {
  contractNumber: string;
  supplierName: string;
  contractedWeightKg: string;
  status: string;
  contractDate: string;
  createdAt: string;
  pieceLines: PieceLine[];
  _count: { receipts: number };
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive"
> = {
  Active: "default",
  Completed: "secondary",
  Cancelled: "destructive",
};

function formatKgDisplay(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return formatDecimal(n, 3);
}

export function BilletContractList() {
  const t = useTranslations("billet");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";
  const { data: session } = useSession();
  const canCreate = sessionHasPermission(session, "billet.contract.create");
  const router = useRouter();
  const [contracts, setContracts] = useState<BilletContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/billet-contracts?${params}`);
      const json = await res.json();
      if (json.success) {
        setContracts(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error(t("contracts.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [search, status, page, t]);

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  useEffect(() => {
    const timer = setTimeout(fetchContracts, 300);
    return () => clearTimeout(timer);
  }, [fetchContracts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statusLabel = (code: string) =>
    tEnums(`billetContractStatus.${code}` as "billetContractStatus.Active");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("contracts.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pe-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t("contracts.allStatuses")} />
          </SelectTrigger>
          <SelectContent dir={dir}>
            <SelectItem value="">{t("contracts.allStatuses")}</SelectItem>
            <SelectItem value="Active">{statusLabel("Active")}</SelectItem>
            <SelectItem value="Completed">{statusLabel("Completed")}</SelectItem>
            <SelectItem value="Cancelled">{statusLabel("Cancelled")}</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && (
          <Button onClick={() => router.push("/billet-contracts/new")} size="sm">
            <Plus className="h-4 w-4" />
            {t("contracts.newContract")}
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="w-full min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 text-start">
                {t("contracts.columns.contractNumber")}
              </TableHead>
              <TableHead className="w-48 max-w-48 text-start">
                {t("contracts.columns.supplier")}
              </TableHead>
              <TableHead className="w-32 text-start">
                {t("contracts.columns.totalWeightKg")}
              </TableHead>
              <TableHead className="w-40 text-start">
                {t("contracts.columns.piecesPerLength")}
              </TableHead>
              <TableHead className="w-20 text-center">
                {t("contracts.columns.receipts")}
              </TableHead>
              <TableHead className="w-20 text-center">
                {t("contracts.columns.status")}
              </TableHead>
              <TableHead className="w-14 text-center" aria-label={t("view")} />
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
            ) : contracts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Package className="h-8 w-8 opacity-40" />
                    {search || status
                      ? t("contracts.emptyNoResults")
                      : t("contracts.emptyNoContracts")}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contracts.map((c) => {
                const variant = statusVariant[c.status] || statusVariant.Active;
                return (
                  <TableRow key={c.contractNumber}>
                    <TableCell className="text-start font-mono text-sm font-semibold">
                      {c.contractNumber}
                    </TableCell>
                    <TableCell className="max-w-48 text-start font-medium">
                      <span className="block truncate" title={c.supplierName}>
                        {c.supplierName}
                      </span>
                    </TableCell>
                    <TableCell className="text-start tabular-nums">
                      {formatKgDisplay(c.contractedWeightKg)}
                    </TableCell>
                    <TableCell className="text-start text-xs">
                      {c.pieceLines.length === 0
                        ? t("emDash")
                        : c.pieceLines
                            .map((l) =>
                              t("lengthPieces", {
                                length: l.billetLengthM,
                                pieces: formatInteger(l.contractedPieces),
                              }),
                            )
                            .join(t("listSeparator"))}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatInteger(c._count.receipts)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Badge variant={variant}>{statusLabel(c.status)}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            router.push(`/billet-contracts/${c.contractNumber}`)
                          }
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
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
            {t("contracts.pageOf", {
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
    </div>
  );
}
