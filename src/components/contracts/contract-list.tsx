"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDate } from "@/lib/date-format";
import { formatInteger } from "@/lib/number-format";
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
  Plus,
  Search,
  Eye,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";

interface Contract {
  contractNumber: string;
  customerId: number;
  status: string;
  notes: string | null;
  createdAt: string;
  customer: {
    id: number;
    code: string;
    fullName: string;
    phonePrimary: string;
  };
  _count: { attachments: number };
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive"
> = {
  active: "default",
  suspended: "destructive",
  closed: "secondary",
};

export function ContractList() {
  const t = useTranslations("contracts");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const isRtl = getTextDirection(locale) === "rtl";
  const { data: session } = useSession();
  const canCreateContract = sessionHasPermission(session, "contract.create");
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/contracts?${params}`);
      const json = await res.json();
      if (json.success) {
        setContracts(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error(t("errorLoadContracts"));
    } finally {
      setLoading(false);
    }
  }, [search, page, t]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(fetchContracts, 300);
    return () => clearTimeout(timer);
  }, [fetchContracts]);

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchContractPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pe-9"
          />
        </div>
        {canCreateContract && (
          <Button onClick={() => router.push("/contracts/new")} size="sm">
            <Plus className="h-4 w-4" />
            {t("newContract")}
          </Button>
        )}
      </div>

      {/* Table — overflow handled by Table's internal container */}
      <div className="rounded-lg border min-w-0">
        <Table className="w-full min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[7.5rem] text-start">
                {t("columns.contractNumber")}
              </TableHead>
              <TableHead className="w-[11rem] max-w-[11rem] text-start">
                {t("columns.customer")}
              </TableHead>
              <TableHead className="w-[7.5rem] text-start">
                {t("columns.customerCode")}
              </TableHead>
              <TableHead dir="ltr" className="w-36 max-w-36 text-start">
                {t("columns.phone")}
              </TableHead>
              <TableHead dir="ltr" className="w-36 max-w-36 text-start">
                {t("columns.createdAt")}
              </TableHead>
              <TableHead className="w-12 text-center">
                {t("columns.attachments")}
              </TableHead>
              <TableHead className="w-20 text-center">
                {t("columns.status")}
              </TableHead>
              <TableHead className="w-16 text-center" aria-label={t("view")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : contracts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="h-8 w-8 opacity-40" />
                    {search ? t("emptyNoResults") : t("emptyNoContracts")}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contracts.map((c) => {
                const statusKey = (
                  ["active", "suspended", "closed"] as const
                ).includes(c.status as "active" | "suspended" | "closed")
                  ? (c.status as "active" | "suspended" | "closed")
                  : "active";
                const variant = STATUS_VARIANTS[statusKey] ?? "default";
                return (
                  <TableRow key={c.contractNumber}>
                    <TableCell className="w-[7.5rem] text-start font-mono text-sm font-semibold">
                      {c.contractNumber}
                    </TableCell>
                    <TableCell className="w-[11rem] max-w-[11rem] text-start font-medium">
                      <span
                        className="block truncate"
                        title={c.customer.fullName}
                      >
                        {c.customer.fullName}
                      </span>
                    </TableCell>
                    <TableCell className="w-[7.5rem] text-start font-mono text-xs">
                      {c.customer.code}
                    </TableCell>
                    <TableCell
                      dir="ltr"
                      className="w-36 max-w-36 text-start text-xs tabular-nums"
                    >
                      {c.customer.phonePrimary}
                    </TableCell>
                    <TableCell
                      dir="ltr"
                      className="w-36 max-w-36 text-start font-mono text-xs tabular-nums"
                    >
                      {formatDate(c.createdAt)}
                    </TableCell>
                    <TableCell className="w-12 text-center align-middle tabular-nums">
                      <div className="flex justify-center">
                        {formatInteger(c._count.attachments)}
                      </div>
                    </TableCell>
                    <TableCell className="w-20 text-center align-middle">
                      <div className="flex justify-center">
                        <Badge variant={variant}>
                          {tEnums(`contractStatus.${statusKey}`)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="w-16 text-center align-middle">
                      <div className="flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            router.push(`/contracts/${c.contractNumber}`)
                          }
                          title={t("view")}
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
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {isRtl ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
            {t("previous")}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("pageOf", {
              page: formatInteger(page),
              totalPages: formatInteger(totalPages),
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
            {isRtl ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
