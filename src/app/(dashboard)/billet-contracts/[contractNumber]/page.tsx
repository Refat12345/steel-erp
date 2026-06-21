"use client";

import { useRef, useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { sessionHasPermission } from "@/lib/client-permissions";
import { compressImage } from "@/lib/compress-image";
import { fetchUploadedFile } from "@/lib/uploaded-file-url";
import { formatDate } from "@/lib/date-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Package,
  Truck,
  Save,
  Loader2,
  AlertTriangle,
  Scale,
  Plus,
  Trash2,
  Paperclip,
  Upload,
  FileText,
  History,
} from "lucide-react";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PieceBalance {
  billetLengthM: number;
  contractedPieces: number;
  acceptedPieces: number;
  remainingPieces: number;
}

interface ReceiptRow {
  id: number;
  receiptNumber: string;
  status: string;
  plateNumber: string;
  driverName: string;
  netWeightKg: string | null;
  isPriorWithdrawal: boolean;
  priorWithdrawalDate: string | null;
  createdAt: string;
}

interface ContractData {
  contract: {
    contractNumber: string;
    supplierName: string;
    status: string;
    contractDate: string;
    notes: string | null;
    createdAt: string;
    creator: { username: string; fullName: string };
  };
  contractedWeightKg: string;
  receivedWeightKg: string;
  remainingWeightKg: string;
  pieceBalances: PieceBalance[];
  receipts: ReceiptRow[];
  attachments: AttachmentRow[];
}

interface AttachmentRow {
  id: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

interface EditablePieceRow {
  key: number;
  billetLengthM: string;
  contractedPieces: string;
  acceptedPieces: number;
}

let pieceRowKey = 0;

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  Active: { label: "فعّال", variant: "default" },
  Completed: { label: "مكتمل", variant: "secondary" },
  Cancelled: { label: "ملغى", variant: "destructive" },
};

const receiptStatusMap: Record<string, string> = {
  Registered: "مسجّلة",
  Loaded: "وُزنت محمّلة",
  Unloading: "قيد التفريغ",
  AwaitingExit: "بانتظار الخروج",
  Completed: "مكتملة",
  Cancelled: "ملغاة",
};

function formatKg(value: string | number | null): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export default function BilletContractDetailPage({
  params,
}: {
  params: Promise<{ contractNumber: string }>;
}) {
  const { contractNumber } = use(params);
  const { data: session } = useSession();
  const canEdit = sessionHasPermission(session, "billet.contract.edit");
  const canChangeStatus = sessionHasPermission(session, "billet.contract.change_status");
  const canRecordPriorWithdrawal = sessionHasPermission(
    session,
    "billet.contract.prior_withdrawal",
  );
  const canUpload =
    sessionHasPermission(session, "billet.contract.upload") || canEdit;
  const router = useRouter();

  const [data, setData] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [supplierName, setSupplierName] = useState("");
  const [contractedWeightKg, setContractedWeightKg] = useState("");
  const [notes, setNotes] = useState("");
  const [pieceRows, setPieceRows] = useState<EditablePieceRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);

  const [priorDialogOpen, setPriorDialogOpen] = useState(false);
  const [priorWeightKg, setPriorWeightKg] = useState("");
  const [priorDate, setPriorDate] = useState("");
  const [priorNotes, setPriorNotes] = useState("سحب سابق قبل تشغيل النظام");
  const [priorPieces, setPriorPieces] = useState<Record<number, string>>({});
  const [priorSaving, setPriorSaving] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchContract = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/billet-contracts/${contractNumber}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setSupplierName(json.data.contract.supplierName);
        setContractedWeightKg(String(Number(json.data.contractedWeightKg)));
        setNotes(json.data.contract.notes || "");
        setPieceRows(
          json.data.pieceBalances.map((b: PieceBalance) => ({
            key: ++pieceRowKey,
            billetLengthM: String(b.billetLengthM),
            contractedPieces: String(b.contractedPieces),
            acceptedPieces: b.acceptedPieces,
          })),
        );
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

  const addPieceRow = () => {
    setPieceRows((prev) => [
      ...prev,
      {
        key: ++pieceRowKey,
        billetLengthM: "",
        contractedPieces: "",
        acceptedPieces: 0,
      },
    ]);
  };

  const removePieceRow = (key: number) => {
    setPieceRows((prev) => prev.filter((r) => r.key !== key));
  };

  const updatePieceRow = (
    key: number,
    field: "billetLengthM" | "contractedPieces",
    value: string,
  ) => {
    setPieceRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const openPriorWithdrawalDialog = () => {
    if (!data) return;
    const seed: Record<number, string> = {};
    for (const row of data.pieceBalances) {
      if (row.remainingPieces > 0) seed[row.billetLengthM] = "";
    }
    setPriorWeightKg("");
    setPriorDate("");
    setPriorNotes("سحب سابق قبل تشغيل النظام");
    setPriorPieces(seed);
    setPriorDialogOpen(true);
  };

  const saveContractDetails = async () => {
    if (!supplierName.trim()) {
      toast.error("اسم المورّد مطلوب");
      return;
    }

    const weight = Number(contractedWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error("الوزن الإجمالي يجب أن يكون أكبر من صفر");
      return;
    }

    const lines: { billetLengthM: number; contractedPieces: number }[] = [];
    const seen = new Set<number>();
    for (const row of pieceRows) {
      const len = Number(row.billetLengthM);
      const pcs = Number(row.contractedPieces);
      if (!Number.isInteger(len) || len <= 0) {
        toast.error("طول البيلت يجب أن يكون عدداً صحيحاً موجباً");
        return;
      }
      if (!Number.isInteger(pcs) || pcs <= 0) {
        toast.error(`عدد القطع للطول ${row.billetLengthM || "المحدد"} يجب أن يكون أكبر من صفر`);
        return;
      }
      if (seen.has(len)) {
        toast.error("لا يمكن تكرار نفس الطول");
        return;
      }
      if (pcs < row.acceptedPieces) {
        toast.error(`عدد قطع طول ${len}م لا يمكن أن يكون أقل من المستلَم (${row.acceptedPieces})`);
        return;
      }
      seen.add(len);
      lines.push({ billetLengthM: len, contractedPieces: pcs });
    }

    if (lines.length === 0) {
      toast.error("أضف عدد القطع لطول واحد على الأقل");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/billet-contracts/${contractNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: supplierName.trim(),
          contractedWeightKg: weight,
          notes,
          pieceLines: lines,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("تم حفظ تعديلات العقد");
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
      const res = await fetch(`/api/billet-contracts/${contractNumber}`, {
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

  const submitPriorWithdrawal = async () => {
    if (!data) return;
    const weight = Number(priorWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error("الوزن الصافي يجب أن يكون أكبر من صفر");
      return;
    }
    if (!priorNotes.trim()) {
      toast.error("ملاحظة السحب السابق مطلوبة");
      return;
    }

    const lines = data.pieceBalances
      .map((balance) => ({
        billetLengthM: balance.billetLengthM,
        acceptedPieces: Number(priorPieces[balance.billetLengthM] || 0),
        remainingPieces: balance.remainingPieces,
      }))
      .filter((line) => line.acceptedPieces > 0);

    if (lines.length === 0) {
      toast.error("أدخل عدد القطع لطول واحد على الأقل");
      return;
    }
    for (const line of lines) {
      if (!Number.isInteger(line.acceptedPieces)) {
        toast.error(`عدد قطع طول ${line.billetLengthM}م يجب أن يكون عدداً صحيحاً`);
        return;
      }
      if (line.acceptedPieces > line.remainingPieces) {
        toast.error(
          `عدد قطع طول ${line.billetLengthM}م يتجاوز المتبقي (${line.remainingPieces})`,
        );
        return;
      }
    }

    setPriorSaving(true);
    try {
      const res = await fetch(
        `/api/billet-contracts/${encodeURIComponent(contractNumber)}/prior-withdrawal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            netWeightKg: weight,
            withdrawalDate: priorDate || undefined,
            notes: priorNotes.trim(),
            pieceLines: lines.map(({ billetLengthM, acceptedPieces }) => ({
              billetLengthM,
              acceptedPieces,
            })),
          }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success("تم تسجيل السحب السابق وخصمه من رصيد العقد");
      setPriorDialogOpen(false);
      fetchContract();
    } catch {
      toast.error("خطأ في تسجيل السحب السابق");
    } finally {
      setPriorSaving(false);
    }
  };

  const uploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;
    setUploading(true);
    try {
      const file = raw.type.startsWith("image/")
        ? await compressImage(raw, "truck")
        : raw;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/billet-contracts/${encodeURIComponent(contractNumber)}/attachment`,
        { method: "POST", body: fd },
      );
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success("تم رفع المرفق");
      fetchContract();
    } catch {
      toast.error("خطأ في رفع المرفق");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openAttachment = async (filePath: string, id: number) => {
    setOpeningAttachmentId(id);
    try {
      const res = await fetchUploadedFile(filePath);
      if (!res.ok) {
        toast.error("تعذر تحميل الملف");
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const win = window.open(objUrl, "_blank");
      if (win) win.opener = null;
      else toast.error("اسمح بالنوافذ المنبثقة لمعاينة الملف");
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
    } catch {
      toast.error("تعذر الاتصال بالخادم");
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">العقد غير موجود</p>
        <Button variant="outline" onClick={() => router.push("/billet-contracts")}>
          العودة للعقود
        </Button>
      </div>
    );
  }

  const st = statusMap[data.contract.status] || statusMap.Active;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/billet-contracts")}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight font-mono">
                {data.contract.contractNumber}
              </h1>
              <Badge variant={st.variant}>{st.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {data.contract.supplierName} — أُنشئ {formatDate(data.contract.createdAt)} بواسطة{" "}
              {data.contract.creator.fullName}
            </p>
          </div>
        </div>

        {(canRecordPriorWithdrawal || canChangeStatus) &&
          data.contract.status === "Active" && (
          <div className="flex shrink-0 gap-2">
            {canRecordPriorWithdrawal && (
              <Button
                size="sm"
                variant="outline"
                onClick={openPriorWithdrawalDialog}
              >
                <History className="h-4 w-4" />
                سحب سابق
              </Button>
            )}
            {canChangeStatus && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setNewStatus("Completed");
                    setStatusDialogOpen(true);
                  }}
                >
                  إتمام
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setNewStatus("Cancelled");
                    setStatusDialogOpen(true);
                  }}
                >
                  إلغاء
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Editable contract details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">بيانات العقد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplierName">اسم المورّد</Label>
            <Input
              id="supplierName"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              readOnly={!canEdit}
              className={!canEdit ? "bg-muted/50" : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contractedWeightKg">الوزن الإجمالي المتعاقد عليه (كغ)</Label>
            <Input
              id="contractedWeightKg"
              type="number"
              min={0}
              step="0.001"
              inputMode="decimal"
              value={contractedWeightKg}
              onChange={(e) => setContractedWeightKg(e.target.value)}
              readOnly={!canEdit}
              className={!canEdit ? "bg-muted/50" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              لا يمكن تخفيض الوزن تحت الوزن المستلَم فعلياً.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Balance summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" />
            رصيد الوزن (كغ)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">المتعاقد</p>
              <p className="text-lg font-bold tabular-nums">
                {formatKg(data.contractedWeightKg)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">المستلَم</p>
              <p className="text-lg font-bold tabular-nums">
                {formatKg(data.receivedWeightKg)}
              </p>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">المتبقّي</p>
              <p className="text-lg font-bold tabular-nums">
                {formatKg(data.remainingWeightKg)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Piece balances */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              رصيد القطع لكل طول
            </CardTitle>
            {canEdit && (
              <Button type="button" variant="outline" size="sm" onClick={addPieceRow}>
                <Plus className="h-3.5 w-3.5" />
                إضافة طول
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-x-auto">
            <Table className="w-full min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الطول</TableHead>
                  <TableHead className="text-center">المتعاقد</TableHead>
                  <TableHead className="text-center">المستلَم المقبول</TableHead>
                  <TableHead className="text-center">المتبقّي</TableHead>
                  {canEdit && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {canEdit
                  ? pieceRows.map((row) => {
                      const contractedPieces = Number(row.contractedPieces);
                      const remainingPieces = Number.isFinite(contractedPieces)
                        ? contractedPieces - row.acceptedPieces
                        : null;

                      return (
                        <TableRow key={row.key}>
                          <TableCell className="text-start">
                            <Input
                              type="number"
                              min={1}
                              value={row.billetLengthM}
                              onChange={(e) =>
                                updatePieceRow(row.key, "billetLengthM", e.target.value)
                              }
                              className="h-8 w-24"
                              aria-label="الطول"
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              min={1}
                              value={row.contractedPieces}
                              onChange={(e) =>
                                updatePieceRow(row.key, "contractedPieces", e.target.value)
                              }
                              className="h-8 w-28 text-center"
                              aria-label="عدد القطع المتعاقد عليها"
                            />
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {row.acceptedPieces}
                          </TableCell>
                          <TableCell className="text-center tabular-nums font-semibold">
                            {remainingPieces == null ? "—" : remainingPieces}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => removePieceRow(row.key)}
                              disabled={pieceRows.length <= 1 || row.acceptedPieces > 0}
                              title={
                                row.acceptedPieces > 0
                                  ? "لا يمكن حذف طول عليه استلامات"
                                  : "حذف الطول"
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : data.pieceBalances.map((b) => (
                      <TableRow key={b.billetLengthM}>
                        <TableCell className="text-start font-medium">
                          {b.billetLengthM}م
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {b.contractedPieces}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {b.acceptedPieces}
                        </TableCell>
                        <TableCell className="text-center tabular-nums font-semibold">
                          {b.remainingPieces}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
          {canEdit && (
            <p className="mt-2 text-xs text-muted-foreground">
              لا يمكن تخفيض عدد القطع تحت المستلَم المقبول، ولا حذف طول عليه استلامات.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Receipts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            الاستلامات المرتبطة ({data.receipts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              لا توجد استلامات بعد
            </p>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table className="w-full min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">رقم الاستلام</TableHead>
                    <TableHead className="text-start">النوع</TableHead>
                    <TableHead className="text-start">اللوحة</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="text-start">الصافي (كغ)</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.receipts.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/billet-receipts/${r.id}`)}
                    >
                      <TableCell className="text-start font-mono text-sm">
                        {r.receiptNumber}
                      </TableCell>
                      <TableCell className="text-start">
                        {r.isPriorWithdrawal ? (
                          <Badge variant="secondary">سحب سابق</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">استلام</span>
                        )}
                      </TableCell>
                      <TableCell className="text-start">{r.plateNumber}</TableCell>
                      <TableCell className="text-start text-xs">
                        {receiptStatusMap[r.status] || r.status}
                      </TableCell>
                      <TableCell className="text-start tabular-nums">
                        {formatKg(r.netWeightKg)}
                      </TableCell>
                      <TableCell className="text-start text-xs">
                        <span dir="ltr">
                          {formatDate(r.priorWithdrawalDate || r.createdAt)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              المرفقات ({data.attachments.length})
            </CardTitle>
            {canUpload && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={uploadAttachment}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  رفع مرفق
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {data.attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              لا توجد مرفقات
            </p>
          ) : (
            <ul className="space-y-2">
              {data.attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="flex-1 truncate text-start text-primary hover:underline disabled:opacity-60"
                    onClick={() => openAttachment(a.filePath, a.id)}
                    disabled={openingAttachmentId === a.id}
                  >
                    {a.fileName}
                  </button>
                  {openingAttachmentId === a.id && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatFileSize(a.fileSize)}
                  </span>
                </li>
              ))}
            </ul>
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
            readOnly={!canEdit}
            rows={3}
            placeholder="ملاحظات على العقد..."
            className={!canEdit ? "bg-muted/50" : undefined}
          />
          {canEdit && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={saveContractDetails}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                حفظ تعديلات العقد
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prior Withdrawal Dialog */}
      <Dialog open={priorDialogOpen} onOpenChange={setPriorDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تسجيل سحب سابق</DialogTitle>
            <DialogDescription>
              يُخصم هذا السجل فوراً من رصيد العقد ويظهر في التقارير كسحب سابق.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="priorWeightKg">الوزن الصافي (كغ) *</Label>
                <Input
                  id="priorWeightKg"
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={priorWeightKg}
                  onChange={(e) => setPriorWeightKg(e.target.value)}
                  placeholder="مثال: 8330940"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priorDate">تاريخ السحب</Label>
                <Input
                  id="priorDate"
                  type="date"
                  value={priorDate}
                  onChange={(e) => setPriorDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>القطع المقبولة حسب الطول *</Label>
              <div className="rounded-lg border overflow-x-auto">
                <Table className="min-w-[420px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">الطول</TableHead>
                      <TableHead className="text-center">المتبقي الحالي</TableHead>
                      <TableHead className="text-center">قطع السحب السابق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pieceBalances.map((balance) => (
                      <TableRow key={balance.billetLengthM}>
                        <TableCell className="text-start font-medium">
                          {balance.billetLengthM}م
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {balance.remainingPieces}
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={0}
                            max={balance.remainingPieces}
                            value={priorPieces[balance.billetLengthM] ?? ""}
                            onChange={(e) =>
                              setPriorPieces((prev) => ({
                                ...prev,
                                [balance.billetLengthM]: e.target.value,
                              }))
                            }
                            className="h-8 text-center"
                            placeholder="0"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priorNotes">ملاحظة / سبب *</Label>
              <Textarea
                id="priorNotes"
                value={priorNotes}
                onChange={(e) => setPriorNotes(e.target.value)}
                rows={3}
                placeholder="مثال: سحب قبل تشغيل النظام حسب كشوفات المورد"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPriorDialogOpen(false)}
              disabled={priorSaving}
            >
              إلغاء
            </Button>
            <Button onClick={submitPriorWithdrawal} disabled={priorSaving}>
              {priorSaving && <Loader2 className="animate-spin" />}
              تسجيل وخصم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {newStatus === "Completed" ? "إتمام العقد" : "إلغاء العقد"}
            </DialogTitle>
            <DialogDescription>يجب إدخال سبب لتغيير حالة العقد</DialogDescription>
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
              variant={newStatus === "Cancelled" ? "destructive" : "default"}
              onClick={changeStatus}
              disabled={statusSaving}
            >
              {statusSaving && <Loader2 className="animate-spin" />}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
