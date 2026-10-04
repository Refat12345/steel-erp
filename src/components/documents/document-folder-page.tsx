"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";
import { pickLocalizedName } from "@/lib/localized-name";
import { formatDateTime } from "@/lib/date-format";
import { formatDecimal, formatInteger } from "@/lib/number-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileKindBadge } from "@/components/documents/file-kind-badge";
import { FolderLinkCard } from "@/components/documents/folder-link-card";
import { FolderFormDialog } from "@/components/documents/folder-form-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderMembersDialog } from "@/components/documents/folder-members-dialog";
import {
  DocumentPreviewDialog,
  type PreviewFile,
} from "@/components/documents/document-preview-dialog";

interface FolderInfo {
  id: number;
  name: string;
  nameEn: string | null;
  canUpload: boolean;
  canManage: boolean;
  parent: { id: number; name: string; nameEn: string | null } | null;
}

interface ChildFolder {
  id: number;
  name: string;
  nameEn: string | null;
  fileCount: number;
  folderCount: number;
}

interface DocumentRow {
  id: number;
  title: string | null;
  notes: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploaderName: string;
  canDelete: boolean;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const json = await response.json().catch(() => null);
  return typeof json?.error === "string" ? json.error : fallback;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${formatInteger(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatInteger(Math.round(bytes / 1024))} KB`;
  return `${formatDecimal(bytes / (1024 * 1024), 1)} MB`;
}

export function DocumentFolderPage({ folderId }: { folderId: string }) {
  const t = useTranslations("documents");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const [folder, setFolder] = useState<FolderInfo | null>(null);
  const [children, setChildren] = useState<ChildFolder[]>([]);
  const [files, setFiles] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [createChildOpen, setCreateChildOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 25;

  const loadFolder = useCallback(async () => {
    const response = await fetch(`/api/documents/folders/${folderId}`);
    if (response.status === 404 || response.status === 403) {
      setMissing(true);
      setFolder(null);
      return;
    }
    if (!response.ok) throw new Error(await readApiError(response, t("loadFailed")));
    const json = await response.json();
    setMissing(false);
    setFolder(json.data);
  }, [folderId, t]);

  const loadChildren = useCallback(async () => {
    const response = await fetch(`/api/documents/folders?parentId=${folderId}`);
    if (response.status === 404 || response.status === 403) return;
    if (!response.ok) throw new Error(await readApiError(response, t("loadFailed")));
    const json = await response.json();
    setChildren(json.data?.folders ?? []);
  }, [folderId, t]);

  const loadFiles = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (query) params.set("search", query);
    const response = await fetch(`/api/documents/folders/${folderId}/files?${params}`);
    if (response.status === 404 || response.status === 403) {
      setMissing(true);
      return;
    }
    if (!response.ok) throw new Error(await readApiError(response, t("loadFailed")));
    const json = await response.json();
    setFiles(json.data?.data ?? []);
    setTotal(json.data?.total ?? 0);
    if (json.data) {
      setFolder((current) =>
        current
          ? { ...current, canUpload: json.data.canUpload, canManage: json.data.canManage }
          : current,
      );
    }
  }, [folderId, page, query, t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        await loadFolder();
        if (!cancelled) await Promise.all([loadFiles(), loadChildren()]);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFolder, loadFiles, loadChildren, t]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayName = folder ? pickLocalizedName(locale, folder.name, folder.nameEn) : "";
  const backHref = folder?.parent ? `/documents/${folder.parent.id}` : "/documents";
  const backLabel = folder?.parent
    ? pickLocalizedName(locale, folder.parent.name, folder.parent.nameEn)
    : t("backToFolders");
  const folderDetail = (child: ChildFolder) => {
    const filesLabel = t("fileCount", { count: formatInteger(child.fileCount) });
    if (child.folderCount <= 0) return filesLabel;
    return `${filesLabel} · ${t("folderCount", { count: formatInteger(child.folderCount) })}`;
  };

  const createChild = async (input: { name: string; nameEn: string }) => {
    const response = await fetch("/api/documents/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, parentId: Number(folderId) }),
    });
    if (!response.ok) throw new Error(await readApiError(response, t("saveFailed")));
    toast.success(t("folderCreated"));
    await loadChildren();
  };

  const rename = async (input: { name: string; nameEn: string }) => {
    const response = await fetch(`/api/documents/folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readApiError(response, t("saveFailed")));
    toast.success(t("folderRenamed"));
    await loadFolder();
  };

  const removeFolder = async () => {
    if (!window.confirm(t("deleteFolderConfirm"))) return;
    const response = await fetch(`/api/documents/folders/${folderId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(await readApiError(response, t("saveFailed")));
      return;
    }
    toast.success(t("folderDeleted"));
    router.push("/documents");
    router.refresh();
  };

  const takeFile = (file: File | undefined) => {
    if (!file || uploading) return;
    setPendingFile(file);
  };

  const clearPendingFile = () => {
    setPendingFile(null);
    setTitle("");
    setNotes("");
  };

  const upload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", pendingFile);
      body.set("title", title);
      body.set("notes", notes);
      const response = await fetch(`/api/documents/folders/${folderId}/files`, {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error(await readApiError(response, t("saveFailed")));
      toast.success(t("fileUploaded"));
      clearPendingFile();
      setPage(1);
      await loadFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (file: DocumentRow) => {
    if (!window.confirm(t("deleteFileConfirm", { name: file.fileName }))) return;
    const response = await fetch(`/api/documents/files/${file.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(await readApiError(response, t("saveFailed")));
      return;
    }
    toast.success(t("fileDeleted"));
    await loadFiles();
  };

  if (missing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("folderMissing")}</p>
        <Button variant="outline" nativeButton={false} render={<Link href="/documents" />}>
          <BackIcon className="h-4 w-4" />
          {t("backToFolders")}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6" dir={dir}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
            <Folder className="size-6 fill-amber-400 text-amber-500" />
          </span>
          <div className="min-w-0">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <BackIcon className="size-4" />
              {backLabel}
            </Link>
            <h1 className="truncate text-xl font-bold tracking-tight">
              {loading ? t("loading") : displayName}
            </h1>
          </div>
        </div>
        {folder?.canManage && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setCreateChildOpen(true)}>
              <Plus className="size-4" />
              {t("createSubfolder")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" aria-label={t("folderActions")}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onClick={() => setMembersOpen(true)}>
                  <Users />
                  {t("membersTitle")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil />
                  {t("renameFolder")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={removeFolder}>
                  <Trash2 />
                  {t("deleteFolder")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {children.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("innerFolders")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((child) => (
              <FolderLinkCard
                key={child.id}
                href={`/documents/${child.id}`}
                name={pickLocalizedName(locale, child.name, child.nameEn)}
                detail={folderDetail(child)}
              />
            ))}
          </div>
        </section>
      )}

      {folder?.canUpload && (
        <div
          className={`rounded-xl border border-dashed p-4 ${dragging ? "border-foreground/30 bg-muted/50" : "bg-muted/20"}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            takeFile(event.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
            disabled={uploading}
            onChange={(event) => {
              takeFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {!pendingFile ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("chooseFile")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("uploadHint")}</p>
              </div>
              <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="size-4" />
                {t("chooseFile")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileKindBadge
                  mimeType={pendingFile.type}
                  fileName={pendingFile.name}
                  className="size-10 rounded-lg"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{pendingFile.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatFileSize(pendingFile.size)}
                  </span>
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("fileTitle")}
                  maxLength={200}
                  disabled={uploading}
                />
                <Input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t("fileNotes")}
                  maxLength={2000}
                  disabled={uploading}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void upload()} disabled={uploading}>
                  <Upload className="size-4" />
                  {uploading ? t("uploadInProgress") : t("uploadNow")}
                </Button>
                <Button variant="outline" onClick={clearPendingFile} disabled={uploading}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <h2 className="me-auto text-sm font-medium text-muted-foreground">{t("filesHeading")}</h2>
        <div className="relative min-w-0 w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchFiles")}
            className="ps-8"
          />
        </div>
        <Button type="submit" variant="outline">
          {t("search")}
        </Button>
      </form>

      {loading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columnFile")}</TableHead>
                <TableHead>{t("columnSize")}</TableHead>
                <TableHead>{t("columnUploader")}</TableHead>
                <TableHead>{t("columnDate")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t("noFiles")}
                  </TableCell>
                </TableRow>
              ) : (
                files.map((file) => (
                  <TableRow
                    key={file.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setPreview({
                        id: file.id,
                        fileName: file.fileName,
                        mimeType: file.mimeType,
                      })
                    }
                  >
                    <TableCell className="max-w-[280px]">
                      <span className="flex min-w-0 items-start gap-2">
                        <FileKindBadge
                          mimeType={file.mimeType}
                          fileName={file.fileName}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{file.fileName}</span>
                          {file.title ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {file.title}
                            </span>
                          ) : null}
                          {file.notes ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {file.notes}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatFileSize(file.fileSize)}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{file.uploaderName}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(file.uploadedAt)}
                    </TableCell>
                    <TableCell>
                      {file.canDelete && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("deleteFile")}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeFile(file);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {total > pageSize && (
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {isRtl ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            {t("previous")}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("pageOf", { page: formatInteger(page), totalPages: formatInteger(totalPages) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
            {isRtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        </div>
      )}

      <DocumentPreviewDialog file={preview} onClose={() => setPreview(null)} />

      {folder && (
        <>
          <FolderFormDialog
            open={createChildOpen}
            onOpenChange={setCreateChildOpen}
            mode="create"
            onSubmit={createChild}
          />
          <FolderFormDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            mode="rename"
            initialName={folder.name}
            initialNameEn={folder.nameEn}
            onSubmit={rename}
          />
          <FolderMembersDialog
            open={membersOpen}
            onOpenChange={setMembersOpen}
            folderId={folder.id}
          />
        </>
      )}
    </div>
  );
}
