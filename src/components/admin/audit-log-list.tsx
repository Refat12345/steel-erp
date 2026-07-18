"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileSearch, Filter } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { formatAuditDetails } from "@/lib/audit-details";
import { formatDateTime } from "@/lib/date-format";
import { formatInteger } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";

type AuditAction = "create" | "update" | "status_change" | "upload" | "delete";

interface AuditLogRow {
  id: number;
  userId: number;
  action: AuditAction;
  entityType: string;
  entityId: string;
  details: unknown;
  createdAt: string;
  user: {
    id: number;
    username: string;
    fullName: string;
  };
}

interface AuditUserOption {
  id: number;
  username: string;
  fullName: string;
}

const ACTION_VALUES: AuditAction[] = [
  "create",
  "update",
  "status_change",
  "upload",
  "delete",
];

export function AuditLogList() {
  const t = useTranslations("audit");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [users, setUsers] = useState<AuditUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [userIdFilter, setUserIdFilter] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const pageSize = 25;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/admin/audit-logs/users", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setUsers(json.data);
      } else {
        toast.error(json.error || t("errorFetchUsers"));
      }
    } catch {
      toast.error(t("errorFetchUsersGeneric"));
    } finally {
      setUsersLoading(false);
    }
  }, [t]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (userIdFilter) params.set("userId", userIdFilter);
      if (actionFilter) params.set("action", actionFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await fetch(`/api/admin/audit-logs?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
        setTotal(json.total);
      } else {
        toast.error(json.error || t("errorFetchLogs"));
      }
    } catch {
      toast.error(t("errorFetchLogsGeneric"));
    } finally {
      setLoading(false);
    }
  }, [actionFilter, page, userIdFilter, fromDate, toDate, t]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    setPage(1);
  }, [userIdFilter, actionFilter, fromDate, toDate]);

  return (
    <div className="space-y-4" dir={dir}>
      <div className="rounded-lg border p-3">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          {t("filters")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("user")}</label>
            <select
              dir={dir}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              disabled={usersLoading}
            >
              <option value="">{t("allUsers")}</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.fullName} ({u.username})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("actionType")}</label>
            <select
              dir={dir}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">{t("allActions")}</option>
              {ACTION_VALUES.map((action) => (
                <option key={action} value={action}>
                  {t(`actions.${action}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("fromDate")}</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("toDate")}</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">{t("colTime")}</TableHead>
              <TableHead className="w-44">{t("colUser")}</TableHead>
              <TableHead className="w-28">{t("colAction")}</TableHead>
              <TableHead className="w-36">{t("colEntity")}</TableHead>
              <TableHead className="w-36">{t("colEntityId")}</TableHead>
              <TableHead>{t("colDetails")}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-36 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <FileSearch className="h-8 w-8 opacity-50" />
                    {t("empty")}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.user.fullName}
                    <div className="text-xs text-muted-foreground">{row.user.username}</div>
                  </TableCell>
                  <TableCell>
                    {t.has(`actions.${row.action}`)
                      ? t(`actions.${row.action}`)
                      : row.action}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.entityType}</TableCell>
                  <TableCell className="font-mono text-xs">{row.entityId}</TableCell>
                  <TableCell className="max-w-[340px] truncate text-xs text-muted-foreground">
                    {formatAuditDetails(row.action, row.details, locale)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex flex-wrap items-center justify-center gap-4">
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
