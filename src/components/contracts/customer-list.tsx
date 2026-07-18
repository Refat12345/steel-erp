"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatInteger } from "@/lib/number-format";
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
import { CustomerFormDialog } from "./customer-form-dialog";
import {
  Plus,
  Search,
  Pencil,
  UserCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";

interface Customer {
  id: number;
  code: string;
  fullName: string;
  fatherName: string;
  nationalId: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  companyAddress: string;
  commercialRegistration: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { contracts: number };
}

export function CustomerList() {
  const t = useTranslations("contracts");
  const locale = useLocale() as Locale;
  const isRtl = getTextDirection(locale) === "rtl";
  const { data: session } = useSession();
  const canCreateCustomer = sessionHasPermission(session, "contract.create");
  const canEditCustomer = sessionHasPermission(session, "contract.edit");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/customers?${params}`);
      const json = await res.json();
      if (json.success) {
        setCustomers(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error(t("errorLoadCustomers"));
    } finally {
      setLoading(false);
    }
  }, [search, page, t]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(timer);
  }, [fetchCustomers]);

  const handleEdit = (c: Customer) => {
    setEditCustomer(c);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditCustomer(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchCustomerPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pe-9"
          />
        </div>
        {canCreateCustomer && (
          <Button onClick={handleAdd} size="sm">
            <Plus className="h-4 w-4" />
            {t("addCustomer")}
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border min-w-0">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 text-start">{t("columns.code")}</TableHead>
              <TableHead className="text-start">{t("columns.fullName")}</TableHead>
              <TableHead className="text-start">
                {t("columns.fatherName")}
              </TableHead>
              <TableHead
                dir="ltr"
                className="w-[10.5rem] max-w-[10.5rem] text-start"
              >
                {t("columns.nationalId")}
              </TableHead>
              <TableHead dir="ltr" className="w-36 max-w-36 text-start">
                {t("columns.phone")}
              </TableHead>
              <TableHead className="w-20 text-center">
                {t("columns.contractsCount")}
              </TableHead>
              <TableHead className="min-w-[5rem] text-center">
                {t("columns.status")}
              </TableHead>
              {canEditCustomer && (
                <TableHead className="w-16 text-center" aria-label={t("edit")} />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: canEditCustomer ? 8 : 7 }).map(
                    (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canEditCustomer ? 8 : 7}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <UserCircle className="h-8 w-8 opacity-40" />
                    {search
                      ? t("emptyNoResults")
                      : canCreateCustomer
                        ? t("emptyNoCustomersCreate")
                        : t("emptyNoCustomers")}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-start font-mono text-xs">
                    {c.code}
                  </TableCell>
                  <TableCell className="text-start font-medium">
                    {c.fullName}
                  </TableCell>
                  <TableCell className="text-start">{c.fatherName}</TableCell>
                  <TableCell
                    dir="ltr"
                    className="w-[10.5rem] max-w-[10.5rem] text-start font-mono text-xs tabular-nums break-all"
                  >
                    {c.nationalId}
                  </TableCell>
                  <TableCell
                    dir="ltr"
                    className="w-36 max-w-36 text-start text-xs tabular-nums"
                  >
                    {c.phonePrimary}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {formatInteger(c._count.contracts)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.isActive ? "default" : "secondary"}>
                      {c.isActive ? t("customerActive") : t("customerInactive")}
                    </Badge>
                  </TableCell>
                  {canEditCustomer && (
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEdit(c)}
                        title={t("edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
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

      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditCustomer(null);
        }}
        onSuccess={fetchCustomers}
        editData={editCustomer ?? undefined}
      />
    </div>
  );
}
