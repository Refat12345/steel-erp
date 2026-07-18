"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getTextDirection, type Locale } from "@/i18n/config";
import type {
  PermissionMatrixItem,
  PermissionSource,
  UserPermissionMatrix,
} from "@/lib/services/user-permission.service";

const MODULE_ORDER = [
  "contracts",
  "sales",
  "logistics",
  "finance",
  "scale",
  "admin",
  "reports",
  "analytics",
] as const;

interface UserSummary {
  id: number;
  username: string;
  fullName: string;
  roleCode: string;
}

interface UserPermissionsDialogProps {
  user: UserSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function sourceBadgeVariant(
  source: PermissionSource,
): "secondary" | "outline" | "destructive" {
  switch (source) {
    case "grant":
      return "outline";
    case "revoke":
      return "destructive";
    default:
      return "secondary";
  }
}

export function UserPermissionsDialog({
  user,
  open,
  onOpenChange,
}: UserPermissionsDialogProps) {
  const t = useTranslations("admin.permissions");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const [matrix, setMatrix] = useState<UserPermissionMatrix | null>(null);
  const [enabledByCode, setEnabledByCode] = useState<Map<string, boolean>>(new Map());
  const [initialEnabled, setInitialEnabled] = useState<Map<string, boolean>>(new Map());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [copyCandidates, setCopyCandidates] = useState<UserSummary[]>([]);
  const [copying, setCopying] = useState(false);

  function sourceLabel(source: PermissionSource): string {
    switch (source) {
      case "grant":
        return t("sourceGrant");
      case "revoke":
        return t("sourceRevoke");
      default:
        return t("sourceRole");
    }
  }

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t("errorLoad"));
        return;
      }
      const data = json.data as UserPermissionMatrix;
      setMatrix(data);
      setWarnings(data.warnings ?? []);
      const map = new Map(
        data.permissions.map((p) => [p.code, p.effective] as const),
      );
      setEnabledByCode(new Map(map));
      setInitialEnabled(new Map(map));
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }, [user.id, t]);

  useEffect(() => {
    if (open) void loadMatrix();
  }, [open, loadMatrix]);

  useEffect(() => {
    if (!copyOpen) return;
    void fetch("/api/admin/users?page=1&pageSize=100&isActive=true")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          const list = (j.data as UserSummary[]).filter(
            (u) => u.id !== user.id && u.roleCode !== "admin",
          );
          setCopyCandidates(list);
        }
      });
  }, [copyOpen, user.id]);

  const grouped = useMemo(() => {
    if (!matrix) return [];
    const byModule = new Map<string, PermissionMatrixItem[]>();
    for (const p of matrix.permissions) {
      const list = byModule.get(p.module) ?? [];
      list.push(p);
      byModule.set(p.module, list);
    }
    const order: string[] = [...MODULE_ORDER];
    for (const key of byModule.keys()) {
      if (!order.includes(key)) order.push(key);
    }
    return order
      .filter((m) => byModule.has(m))
      .map((m) => {
        const key = `modules.${m}` as const;
        return {
          module: m,
          label: t.has(key) ? t(key) : m,
          items: byModule.get(m)!,
        };
      });
  }, [matrix, t]);

  const dirty = useMemo(() => {
    if (enabledByCode.size !== initialEnabled.size) return true;
    for (const [code, enabled] of enabledByCode) {
      if (initialEnabled.get(code) !== enabled) return true;
    }
    return false;
  }, [enabledByCode, initialEnabled]);

  function setEnabled(code: string, enabled: boolean) {
    setEnabledByCode((prev) => {
      const next = new Map(prev);
      next.set(code, enabled);
      return next;
    });
  }

  async function handleSave() {
    if (!matrix || matrix.readOnly) return;
    setSaving(true);
    try {
      const permissions = matrix.permissions.map((p) => ({
        code: p.code,
        enabled: enabledByCode.get(p.code) ?? p.effective,
      }));
      const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t("toastSaved"));
        const data = json.data as UserPermissionMatrix;
        setMatrix(data);
        setWarnings(json.warnings ?? data.warnings ?? []);
        const map = new Map(
          data.permissions.map((p) => [p.code, p.effective] as const),
        );
        setEnabledByCode(new Map(map));
        setInitialEnabled(new Map(map));
      } else {
        toast.error(json.error || t("errorGeneric"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!matrix || matrix.readOnly) return;
    if (!confirm(t("confirmReset", { name: matrix.user.fullName }))) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/permissions/reset`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t("toastReset"));
        const data = json.data as UserPermissionMatrix;
        setMatrix(data);
        setWarnings(json.warnings ?? data.warnings ?? []);
        const map = new Map(
          data.permissions.map((p) => [p.code, p.effective] as const),
        );
        setEnabledByCode(new Map(map));
        setInitialEnabled(new Map(map));
      } else {
        toast.error(json.error || t("errorGeneric"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setResetting(false);
    }
  }

  async function handleCopy() {
    if (!copySourceId) {
      toast.error(t("errorSelectCopySource"));
      return;
    }
    setCopying(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/permissions/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUserId: Number(copySourceId) }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t("toastCopied"));
        setCopyOpen(false);
        setCopySourceId("");
        const data = json.data as UserPermissionMatrix;
        setMatrix(data);
        setWarnings(json.warnings ?? data.warnings ?? []);
        const map = new Map(
          data.permissions.map((p) => [p.code, p.effective] as const),
        );
        setEnabledByCode(new Map(map));
        setInitialEnabled(new Map(map));
      } else {
        toast.error(json.error || t("errorGeneric"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!flex max-h-[90dvh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        dir={dir}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-start">
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-start">
            {user.fullName}{" "}
            <span className="font-mono text-xs">({user.username})</span>
            {matrix && (
              <Badge variant="secondary" className="ms-2">
                {matrix.user.roleDisplayName}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {matrix?.readOnly && (
          <div className="mx-4 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
            {t("adminReadOnly")}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mx-4 mt-3 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("warnings")}
            </div>
            <ul className="list-disc space-y-0.5 ps-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              {grouped.map(({ module, label, items }) => (
                <section key={module}>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{label}</h3>
                  <ul className="space-y-2">
                    {items.map((p) => {
                      const enabled = enabledByCode.get(p.code) ?? p.effective;
                      const disabled =
                        matrix?.readOnly || !p.editableByActor || p.reservedUnused;
                      return (
                        <li
                          key={p.code}
                          className={`flex items-start gap-3 rounded-md border px-3 py-2 ${
                            p.sensitive ? "border-destructive/30 bg-destructive/5" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            id={`perm-${p.code}`}
                            checked={enabled}
                            disabled={disabled}
                            onChange={(e) => setEnabled(p.code, e.target.checked)}
                            className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-primary disabled:opacity-50"
                          />
                          <label
                            htmlFor={`perm-${p.code}`}
                            className={`min-w-0 flex-1 cursor-pointer ${disabled ? "opacity-60" : ""}`}
                          >
                            <span className="block text-sm font-medium leading-snug">
                              {p.displayName}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge
                                variant={sourceBadgeVariant(
                                  matrix?.readOnly ? "role" : p.source,
                                )}
                                className="text-[10px]"
                              >
                                {sourceLabel(matrix?.readOnly ? "role" : p.source)}
                              </Badge>
                              {p.reservedUnused && (
                                <Badge variant="outline" className="text-[10px]">
                                  {t("reserved")}
                                </Badge>
                              )}
                              {!p.editableByActor && !matrix?.readOnly && (
                                <Badge variant="outline" className="text-[10px]">
                                  {t("outOfScope")}
                                </Badge>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-3 border-t bg-background p-4">
          {!matrix?.readOnly && !loading && copyOpen && (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Label className="text-xs">{t("copyFrom")}</Label>
                <Select
                  value={copySourceId}
                  onValueChange={(v) => setCopySourceId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("selectUser")} />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
                    {copyCandidates.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.fullName} ({c.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={copying || !copySourceId}
                onClick={() => void handleCopy()}
              >
                {copying && <Loader2 className="h-3 w-3 animate-spin" />}
                {t("copy")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCopyOpen(false);
                  setCopySourceId("");
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          )}

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {!matrix?.readOnly && !loading && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={resetting || saving}
                  onClick={() => void handleReset()}
                >
                  {resetting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("resetToDefault")}
                </Button>
                {!copyOpen && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCopyOpen(true)}
                  >
                    {t("copyFromOther")}
                  </Button>
                )}
              </div>
            )}
            <div className="flex w-full gap-2 sm:ms-auto sm:w-auto">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("close")}
              </Button>
              {!matrix?.readOnly && (
                <Button
                  type="button"
                  disabled={!dirty || saving || loading}
                  onClick={() => void handleSave()}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("save")}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
