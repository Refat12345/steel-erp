"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Search,
  KeyRound,
  Pencil,
  UserCheck,
  UserX,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RoleInfo {
  code: string;
  displayName: string;
}

interface UserItem {
  id: number;
  username: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
  createdAt: string;
  role: RoleInfo;
  creator: { id: number; fullName: string } | null;
}

export function UserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterActive, setFilterActive] = useState("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [resetPwUser, setResetPwUser] = useState<UserItem | null>(null);

  const PAGE_SIZE = 25;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set("search", search);
      if (filterRole !== "all") params.set("roleCode", filterRole);
      if (filterActive !== "all") params.set("isActive", filterActive);

      const res = await fetch(`/api/admin/users?${params}`);
      const json = await res.json();
      if (json.success) {
        setUsers(json.data);
        setTotal(json.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, filterRole, filterActive]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetch("/api/admin/roles")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setRoles(j.data);
      });
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground">
            إنشاء وتعديل وإدارة حسابات المستخدمين
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="ml-1.5 h-4 w-4" />
          مستخدم جديد
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم أو اسم المستخدم..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pr-9"
                />
              </div>
            </div>
            <Select
              value={filterRole}
              onValueChange={(v) => {
                setFilterRole(v ?? "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="الدور" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأدوار</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filterActive}
              onValueChange={(v) => {
                setFilterActive(v ?? "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="true">نشط</SelectItem>
                <SelectItem value="false">معطّل</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">اسم المستخدم</TableHead>
                <TableHead className="text-right">الاسم الكامل</TableHead>
                <TableHead className="text-right">الدور</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">تاريخ الإنشاء</TableHead>
                <TableHead className="text-right">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    لا يوجد مستخدمون
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-mono text-sm">{user.username}</TableCell>
                    <TableCell>{user.fullName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{user.role.displayName}</Badge>
                    </TableCell>
                    <TableCell>
                      {user.isActive ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25">
                          نشط
                        </Badge>
                      ) : (
                        <Badge variant="destructive">معطّل</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString("ar-SY")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="تعديل"
                          onClick={() => setEditUser(user)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="إعادة تعيين كلمة المرور"
                          onClick={() => setResetPwUser(user)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={user.isActive ? "تعطيل" : "تفعيل"}
                          onClick={() => void toggleActive(user)}
                        >
                          {user.isActive ? (
                            <UserX className="h-3.5 w-3.5 text-destructive" />
                          ) : (
                            <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {total} مستخدم
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                السابق
              </Button>
              <span className="text-sm">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Create Dialog */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
        onSuccess={() => {
          setCreateOpen(false);
          void fetchUsers();
        }}
      />

      {/* Edit Dialog */}
      {editUser && (
        <EditUserDialog
          user={editUser}
          open={!!editUser}
          onOpenChange={(open) => {
            if (!open) setEditUser(null);
          }}
          roles={roles}
          onSuccess={() => {
            setEditUser(null);
            void fetchUsers();
          }}
        />
      )}

      {/* Reset Password Dialog */}
      {resetPwUser && (
        <ResetPasswordDialog
          user={resetPwUser}
          open={!!resetPwUser}
          onOpenChange={(open) => {
            if (!open) setResetPwUser(null);
          }}
          onSuccess={() => {
            setResetPwUser(null);
          }}
        />
      )}
    </div>
  );

  async function toggleActive(user: UserItem) {
    const action = user.isActive ? "تعطيل" : "تفعيل";
    if (!confirm(`هل أنت متأكد من ${action} حساب "${user.fullName}"؟`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم ${action} الحساب بنجاح`);
        void fetchUsers();
      } else {
        toast.error(json.error || "حدث خطأ");
      }
    } catch {
      toast.error("حدث خطأ في الاتصال");
    }
  }
}

/* ────────────── Create Dialog ────────────── */

function CreateUserDialog({
  open,
  onOpenChange,
  roles,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: RoleInfo[];
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setUsername("");
    setFullName("");
    setPassword("");
    setRoleCode("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, fullName, password, roleCode }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("تم إنشاء المستخدم بنجاح");
        reset();
        onSuccess();
      } else {
        toast.error(json.error || "حدث خطأ");
      }
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>مستخدم جديد</DialogTitle>
          <DialogDescription>أدخل بيانات المستخدم الجديد</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label>اسم المستخدم (إنجليزي)</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              dir="ltr"
              required
              minLength={3}
            />
          </div>
          <div className="space-y-2">
            <Label>الاسم الكامل</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="الاسم الكامل"
              required
              minLength={2}
            />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              dir="ltr"
              required
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label>الدور</Label>
            <Select
              value={roleCode}
              onValueChange={(v) => setRoleCode(v ?? "")}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر الدور" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !roleCode}>
              {saving && <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />}
              إنشاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────── Edit Dialog ────────────── */

function EditUserDialog({
  user,
  open,
  onOpenChange,
  roles,
  onSuccess,
}: {
  user: UserItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: RoleInfo[];
  onSuccess: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [roleCode, setRoleCode] = useState(user.roleCode);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, roleCode }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("تم تحديث المستخدم بنجاح");
        onSuccess();
      } else {
        toast.error(json.error || "حدث خطأ");
      }
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل المستخدم: {user.username}</DialogTitle>
          <DialogDescription>عدّل بيانات المستخدم</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label>الاسم الكامل</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div className="space-y-2">
            <Label>الدور</Label>
            <Select
              value={roleCode}
              onValueChange={(v) => setRoleCode(v ?? user.roleCode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────── Reset Password Dialog ────────────── */

function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: {
  user: UserItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم تغيير كلمة مرور "${user.fullName}" بنجاح`);
        setNewPassword("");
        onSuccess();
      } else {
        toast.error(json.error || "حدث خطأ");
      }
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setNewPassword("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>إعادة تعيين كلمة المرور</DialogTitle>
          <DialogDescription>
            تغيير كلمة مرور المستخدم: {user.fullName} ({user.username})
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label>كلمة المرور الجديدة</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••"
              dir="ltr"
              required
              minLength={6}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || newPassword.length < 6}>
              {saving && <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />}
              تغيير كلمة المرور
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
