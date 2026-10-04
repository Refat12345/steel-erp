"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MemberRow {
  userId: number;
  username: string;
  fullName: string;
  canUpload: boolean;
}

interface UserHit {
  id: number;
  username: string;
  fullName: string;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const json = await response.json().catch(() => null);
  return typeof json?.error === "string" ? json.error : fallback;
}

export function FolderMembersDialog({
  open,
  onOpenChange,
  folderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: number;
}) {
  const t = useTranslations("documents");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSearch("");
    setHits([]);
    void (async () => {
      try {
        const response = await fetch(`/api/documents/folders/${folderId}/members`);
        if (!response.ok) throw new Error(await readApiError(response, t("loadFailed")));
        const json = await response.json();
        if (!cancelled) setMembers(json.data ?? []);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, folderId, t]);

  useEffect(() => {
    if (!open) return;
    const query = search.trim();
    if (query.length < 1) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        const response = await fetch(`/api/documents/users?search=${encodeURIComponent(query)}`);
        if (!response.ok) return;
        const json = await response.json();
        setHits(json.data ?? []);
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [open, search]);

  const addUser = (user: UserHit) => {
    setMembers((current) => {
      if (current.some((member) => member.userId === user.id)) return current;
      return [
        ...current,
        { userId: user.id, username: user.username, fullName: user.fullName, canUpload: false },
      ];
    });
    setSearch("");
    setHits([]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/documents/folders/${folderId}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: members.map((member) => ({
            userId: member.userId,
            canUpload: member.canUpload,
          })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, t("saveFailed")));
      toast.success(t("membersSaved"));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("membersTitle")}</DialogTitle>
          <DialogDescription>{t("membersHint")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchUsers")}
            autoComplete="off"
          />
          {hits.length > 0 && (
            <ul className="max-h-36 overflow-y-auto rounded-md border">
              {hits.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-muted"
                    onClick={() => addUser(user)}
                  >
                    <span className="truncate">{user.fullName}</span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {user.username}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {member.username}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={member.canUpload}
                      onChange={(event) =>
                        setMembers((current) =>
                          current.map((row) =>
                            row.userId === member.userId
                              ? { ...row, canUpload: event.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                    {t("canUpload")}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setMembers((current) => current.filter((row) => row.userId !== member.userId))
                    }
                  >
                    {t("remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
