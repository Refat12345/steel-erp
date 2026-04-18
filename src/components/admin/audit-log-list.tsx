"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const actionLabelMap: Record<AuditAction, string> = {
  create: "إنشاء",
  update: "تعديل",
  status_change: "تغيير حالة",
  upload: "رفع ملف",
  delete: "حذف",
};

function renderDetails(details: unknown): string {
  if (details == null) return "—";
  if (typeof details === "string") return details;
  try {
    const text = JSON.stringify(details);
    return text.length > 80 ? `${text.slice(0, 80)}...` : text;
  } catch {
    return "—";
  }
}

export function AuditLogList() {
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
        toast.error(json.error || "تعذر جلب المستخدمين");
      }
    } catch {
      toast.error("خطأ في جلب قائمة المستخدمين");
    } finally {
      setUsersLoading(false);
    }
  }, []);

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
        toast.error(json.error || "تعذر جلب سجل التدقيق");
      }
    } catch {
      toast.error("خطأ في جلب سجل التدقيق");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, page, userIdFilter, fromDate, toDate]);

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
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          عوامل التصفية
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">المستخدم</label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              disabled={usersLoading}
            >
              <option value="">كل المستخدمين</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.fullName} ({u.username})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">نوع الإجراء</label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">كل الإجراءات</option>
              <option value="create">إنشاء</option>
              <option value="update">تعديل</option>
              <option value="status_change">تغيير حالة</option>
              <option value="upload">رفع ملف</option>
              <option value="delete">حذف</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">من تاريخ</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">إلى تاريخ</label>
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
              <TableHead className="w-44">الوقت</TableHead>
              <TableHead className="w-44">المستخدم</TableHead>
              <TableHead className="w-28">الإجراء</TableHead>
              <TableHead className="w-36">الكيان</TableHead>
              <TableHead className="w-36">معرف الكيان</TableHead>
              <TableHead>التفاصيل</TableHead>
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
                    لا توجد سجلات مطابقة
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs">
                    {new Date(row.createdAt).toLocaleString("ar-SA")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.user.fullName}
                    <div className="text-xs text-muted-foreground">{row.user.username}</div>
                  </TableCell>
                  <TableCell>{actionLabelMap[row.action] ?? row.action}</TableCell>
                  <TableCell className="font-mono text-xs">{row.entityType}</TableCell>
                  <TableCell className="font-mono text-xs">{row.entityId}</TableCell>
                  <TableCell className="max-w-[340px] truncate text-xs text-muted-foreground">
                    {renderDetails(row.details)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>

          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
