"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { sessionHasPermission } from "@/lib/client-permissions";
import { compressImage } from "@/lib/compress-image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  ArrowLeft,
  User,
  FileText,
  Paperclip,
  Upload,
  Loader2,
  Save,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { fetchUploadedFile } from "@/lib/uploaded-file-url";
import { formatDate } from "@/lib/date-format";
import { formatInteger } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";

interface Attachment {
  id: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  uploader: { username: string; fullName: string };
}

interface ContractDetail {
  contractNumber: string;
  customerId: number;
  attachmentPath: string;
  status: string;
  notes: string | null;
  createdAt: string;
  creator: { username: string; fullName: string };
  customer: {
    id: number;
    code: string;
    fullName: string;
    fatherName: string;
    nationalId: string;
    phonePrimary: string;
    phoneSecondary: string | null;
    companyAddress: string;
    isActive: boolean;
  };
  attachments: Attachment[];
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive"
> = {
  active: "default",
  suspended: "destructive",
  closed: "secondary",
};

export default function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractNumber: string }>;
}) {
  const { contractNumber } = use(params);
  const t = useTranslations("contracts");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const { data: session } = useSession();
  const canEditContract = sessionHasPermission(session, "contract.edit");
  const canChangeContractStatus = sessionHasPermission(
    session,
    "contract.change_status",
  );
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<number | null>(
    null,
  );

  const openAttachmentPreview = async (att: Attachment) => {
    setOpeningAttachmentId(att.id);
    try {
      const res = await fetchUploadedFile(att.filePath);
      if (res.status === 401) {
        toast.error(t("sessionExpired"));
        return;
      }
      if (!res.ok) {
        let message = t("errorLoadFile");
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) message = j.error;
        } catch {
          /* ignore */
        }
        toast.error(message);
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      // Do not pass "noopener" in windowFeatures: the spec requires open() to return null then,
      // so we'd falsely show "allow popups" even when the tab opened successfully.
      const win = window.open(objUrl, "_blank");
      if (win) {
        win.opener = null;
      } else {
        toast.error(t("allowPopups"));
        URL.revokeObjectURL(objUrl);
        return;
      }
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
    } catch {
      toast.error(t("errorServerConnection"));
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  const fetchContract = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractNumber}`);
      const json = await res.json();
      if (json.success) {
        setContract(json.data);
        setNotes(json.data.notes || "");
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("errorLoadContract"));
    } finally {
      setLoading(false);
    }
  }, [contractNumber, t]);

  useEffect(() => {
    fetchContract();
  }, [fetchContract]);

  const saveNotes = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${contractNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t("notesSaved"));
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("errorSave"));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async () => {
    if (!statusReason.trim()) {
      toast.error(t("statusReasonRequired"));
      return;
    }
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/contracts/${contractNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, statusReason }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t("statusChanged"));
        setStatusDialogOpen(false);
        setStatusReason("");
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("errorStatusChange"));
    } finally {
      setStatusSaving(false);
    }
  };

  const uploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;
    setUploading(true);
    try {
      const file = raw.type.startsWith("image/")
        ? await compressImage(raw)
        : raw;
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadJson.success) {
        toast.error(uploadJson.error);
        return;
      }

      const res = await fetch(`/api/contracts/${contractNumber}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: uploadJson.data.filePath,
          fileName: uploadJson.data.fileName,
          fileSize: uploadJson.data.fileSize,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t("attachmentUploaded"));
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("errorAttachmentUpload"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 min-w-0">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 min-w-0">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/contracts")}>
          {t("backToContracts")}
        </Button>
      </div>
    );
  }

  const statusKey = (["active", "suspended", "closed"] as const).includes(
    contract.status as "active" | "suspended" | "closed",
  )
    ? (contract.status as "active" | "suspended" | "closed")
    : "active";
  const statusVariant = STATUS_VARIANTS[statusKey] ?? "default";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/contracts")}
          >
            <BackIcon className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight font-mono truncate">
                {contract.contractNumber}
              </h1>
              <Badge variant={statusVariant}>
                {tEnums(`contractStatus.${statusKey}`)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("createdAtBy", {
                date: formatDate(contract.createdAt),
                name: contract.creator.fullName,
              })}
            </p>
          </div>
        </div>

        {canChangeContractStatus && contract.status === "active" && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setNewStatus("suspended");
              setStatusDialogOpen(true);
            }}
          >
            {t("suspendContract")}
          </Button>
        )}
        {canChangeContractStatus && contract.status === "suspended" && (
          <Button
            size="sm"
            onClick={() => {
              setNewStatus("active");
              setStatusDialogOpen(true);
            }}
          >
            {t("reactivate")}
          </Button>
        )}
      </div>

      {/* Customer Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            {t("customerInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t("labelName")}</span>{" "}
              <span className="font-medium">{contract.customer.fullName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("labelFatherName")}
              </span>{" "}
              {contract.customer.fatherName}
            </div>
            <div>
              <span className="text-muted-foreground">{t("labelCode")}</span>{" "}
              <span className="font-mono">{contract.customer.code}</span>
            </div>
            <div>
              <span className="text-muted-foreground">
                {t("labelNationalId")}
              </span>{" "}
              <span className="font-mono" dir="ltr">
                {contract.customer.nationalId}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("labelPhone")}</span>{" "}
              <span dir="ltr">{contract.customer.phonePrimary}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("labelAddress")}</span>{" "}
              {contract.customer.companyAddress}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              {t("attachmentsCount", {
                count: formatInteger(contract.attachments.length),
              })}
            </CardTitle>
            {canEditContract && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {t("addAttachment")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                  onChange={uploadAttachment}
                  disabled={uploading}
                />
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {contract.attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("noAttachments")}
            </p>
          ) : (
            <div className="space-y-2">
              {contract.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/30 transition-colors group min-w-0"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{att.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("fileSizeKbDate", {
                        size: formatInteger(att.fileSize / 1024),
                        date: formatDate(att.uploadedAt),
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openAttachmentPreview(att)}
                    disabled={openingAttachmentId === att.id}
                    title={t("previewFile")}
                  >
                    {openingAttachmentId === att.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("notes")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            readOnly={!canEditContract}
            rows={3}
            placeholder={t("notesPlaceholder")}
            className={!canEditContract ? "bg-muted/50" : undefined}
          />
          {canEditContract && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={saveNotes}
                disabled={saving || notes === (contract.notes || "")}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {t("saveNotes")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent dir={dir} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {newStatus === "suspended"
                ? t("suspendContract")
                : t("reactivateContract")}
            </DialogTitle>
            <DialogDescription>{t("statusReasonRequired")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="statusReason">{t("statusReasonLabel")}</Label>
            <Input
              id="statusReason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder={t("statusReasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button
              variant={newStatus === "suspended" ? "destructive" : "default"}
              onClick={changeStatus}
              disabled={statusSaving}
            >
              {statusSaving && <Loader2 className="animate-spin" />}
              {newStatus === "suspended" ? t("suspend") : t("activate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
