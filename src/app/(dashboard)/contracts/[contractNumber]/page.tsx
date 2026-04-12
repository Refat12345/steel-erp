"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { sessionHasPermission } from "@/lib/client-permissions";
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

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive"; color: string }> = {
  active: { label: "نشط", variant: "default", color: "oklch(0.630 0.155 152)" },
  suspended: { label: "معلّق", variant: "destructive", color: "oklch(0.610 0.210 0)" },
  closed: { label: "مغلق", variant: "secondary", color: "" },
};

export default function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractNumber: string }>;
}) {
  const { contractNumber } = use(params);
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
    null
  );

  const openAttachmentPreview = async (att: Attachment) => {
    setOpeningAttachmentId(att.id);
    try {
      const res = await fetchUploadedFile(att.filePath);
      if (res.status === 401) {
        toast.error("انتهت الجلسة — أعد تسجيل الدخول");
        return;
      }
      if (!res.ok) {
        let message = "تعذر تحميل الملف";
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
        toast.error("اسمح بالنوافذ المنبثقة لمعاينة الملف");
        URL.revokeObjectURL(objUrl);
        return;
      }
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
    } catch {
      toast.error(
        "تعذر الاتصال بالخادم. استخدم نفس العنوان الذي فتحت منه النظام (مثلاً 127.0.0.1 أو localhost فقط) وتأكد أن السيرفر يعمل."
      );
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
      toast.error("خطأ في جلب بيانات العقد");
    } finally {
      setLoading(false);
    }
  }, [contractNumber]);

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
        toast.success("تم حفظ الملاحظات");
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error("خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async () => {
    if (!statusReason.trim()) {
      toast.error("يجب إدخال سبب تغيير الحالة");
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
        toast.success("تم تغيير حالة العقد");
        setStatusDialogOpen(false);
        setStatusReason("");
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error("خطأ في تغيير الحالة");
    } finally {
      setStatusSaving(false);
    }
  };

  const uploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
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
        toast.success("تم رفع المرفق");
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error("خطأ في رفع المرفق");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">العقد غير موجود</p>
        <Button variant="outline" onClick={() => router.push("/contracts")}>
          العودة للعقود
        </Button>
      </div>
    );
  }

  const st = statusConfig[contract.status] || statusConfig.active;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/contracts")}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight font-mono">
                {contract.contractNumber}
              </h1>
              <Badge variant={st.variant}>{st.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              أُنشئ بتاريخ{" "}
              {new Date(contract.createdAt).toLocaleDateString("ar-SA")} بواسطة{" "}
              {contract.creator.fullName}
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
            تعليق العقد
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
            إعادة تفعيل
          </Button>
        )}
      </div>

      {/* Customer Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            بيانات العميل
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-muted-foreground">الاسم:</span>{" "}
              <span className="font-medium">{contract.customer.fullName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">اسم الأب:</span>{" "}
              {contract.customer.fatherName}
            </div>
            <div>
              <span className="text-muted-foreground">الرمز:</span>{" "}
              <span className="font-mono">{contract.customer.code}</span>
            </div>
            <div>
              <span className="text-muted-foreground">الرقم الوطني:</span>{" "}
              <span className="font-mono" dir="ltr">
                {contract.customer.nationalId}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">الهاتف:</span>{" "}
              <span dir="ltr">{contract.customer.phonePrimary}</span>
            </div>
            <div>
              <span className="text-muted-foreground">العنوان:</span>{" "}
              {contract.customer.companyAddress}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              المرفقات ({contract.attachments.length})
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
                  إضافة مرفق
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
              لا توجد مرفقات
            </p>
          ) : (
            <div className="space-y-2">
              {contract.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/30 transition-colors group"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{att.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {(att.fileSize / 1024).toFixed(0)} كيلوبايت —{" "}
                      {new Date(att.uploadedAt).toLocaleDateString("ar-SA")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openAttachmentPreview(att)}
                    disabled={openingAttachmentId === att.id}
                    title="معاينة الملف"
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
          <CardTitle className="text-base">ملاحظات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            readOnly={!canEditContract}
            rows={3}
            placeholder="ملاحظات على العقد..."
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
                حفظ الملاحظات
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {newStatus === "suspended" ? "تعليق العقد" : "إعادة تفعيل العقد"}
            </DialogTitle>
            <DialogDescription>
              يجب إدخال سبب لتغيير حالة العقد
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="statusReason">السبب *</Label>
            <Input
              id="statusReason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="أدخل سبب تغيير الحالة..."
            />
          </div>
          <DialogFooter>
            <Button
              variant={newStatus === "suspended" ? "destructive" : "default"}
              onClick={changeStatus}
              disabled={statusSaving}
            >
              {statusSaving && <Loader2 className="animate-spin" />}
              {newStatus === "suspended" ? "تعليق" : "تفعيل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
