"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FolderOpen, Plus } from "lucide-react";
import { FolderLinkCard } from "@/components/documents/folder-link-card";
import { getTextDirection, type Locale } from "@/i18n/config";
import { pickLocalizedName } from "@/lib/localized-name";
import { formatInteger } from "@/lib/number-format";
import { sessionHasPermission } from "@/lib/client-permissions";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderFormDialog } from "@/components/documents/folder-form-dialog";

interface FolderCard {
  id: number;
  name: string;
  nameEn: string | null;
  fileCount: number;
  folderCount: number;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const json = await response.json().catch(() => null);
  return typeof json?.error === "string" ? json.error : fallback;
}

export function DocumentsPage() {
  const t = useTranslations("documents");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const { data: session } = useSession();
  const canManage = sessionHasPermission(session, "document.manage");
  const [folders, setFolders] = useState<FolderCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/documents/folders");
      if (!response.ok) throw new Error(await readApiError(response, t("loadFailed")));
      const json = await response.json();
      setFolders(json.data?.folders ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const folderDetail = (folder: FolderCard) => {
    const files = t("fileCount", { count: formatInteger(folder.fileCount) });
    if (folder.folderCount <= 0) return files;
    return `${files} · ${t("folderCount", { count: formatInteger(folder.folderCount) })}`;
  };

  const createFolder = async (input: { name: string; nameEn: string }) => {
    const response = await fetch("/api/documents/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readApiError(response, t("saveFailed")));
    toast.success(t("folderCreated"));
    await load();
  };

  return (
    <div className="min-w-0 max-w-full space-y-6" dir={dir}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("createFolder")}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : folders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("noFolders")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <FolderLinkCard
              key={folder.id}
              href={`/documents/${folder.id}`}
              name={pickLocalizedName(locale, folder.name, folder.nameEn)}
              detail={folderDetail(folder)}
            />
          ))}
        </div>
      )}

      <FolderFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={createFolder}
      />
    </div>
  );
}
