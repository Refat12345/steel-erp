"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { sessionHasPermission } from "@/lib/client-permissions";
import { compressImage } from "@/lib/compress-image";
import { fetchUploadedFile } from "@/lib/uploaded-file-url";
import { useLocale, useTranslations } from "next-intl";
import { getTextDirection, type Locale } from "@/i18n/config";
import { formatDate } from "@/lib/date-format";
import { formatDecimal, formatInteger } from "@/lib/number-format";
import { formatDurationLocalized } from "@/lib/format-duration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Loader2,
  Scale,
  Camera,
  Package,
  Paperclip,
  Upload,
  FileText,
  ExternalLink,
  Truck,
  Timer,
  XCircle,
  CheckCircle2,
  History,
} from "lucide-react";

interface PieceLine {
  id: number;
  billetLengthM: number;
  expectedPieces: number;
  countedPieces: number | null;
  rejectedPieces: number;
}

interface Attachment {
  id: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  uploader: { username: string; fullName: string };
}

interface ReceiptDetail {
  id: number;
  receiptNumber: string;
  supplierContractNumber: string;
  driverName: string;
  plateNumber: string;
  driverNationalId: string | null;
  declaredWeightKg: string;
  status: string;
  loadedWeightKg: string | null;
  entryTime: string | null;
  emptyWeightKg: string | null;
  exitTime: string | null;
  unloadingPhotoPath: string | null;
  unloadingPhotoAt: string | null;
  countEnteredAt: string | null;
  countMismatchReason: string | null;
  netWeightKg: string | null;
  isPriorWithdrawal: boolean;
  priorWithdrawalDate: string | null;
  isAdjustment: boolean;
  bundleCount: number | null;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
  closedAt: string | null;
  contract: { contractNumber: string; supplierName: string; status: string };
  pieceLines: PieceLine[];
  attachments: Attachment[];
  creator: { fullName: string };
  closer: { fullName: string } | null;
}

const statusMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Registered: "outline",
  Loaded: "secondary",
  Unloading: "secondary",
  AwaitingExit: "secondary",
  Completed: "default",
  Cancelled: "destructive",
};

interface CountRow {
  counted: string;
  rejected: string;
}

interface ContractOption {
  contractNumber: string;
  supplierName: string;
  pieceLines: { billetLengthM: number; contractedPieces: number }[];
}

interface UnloadLinePayload {
  billetLengthM: number;
  countedPieces: number;
  rejectedPieces: number;
}

export function BilletReceiptOperationView({ receiptId }: { receiptId: number }) {
  const t = useTranslations("billet");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const formatKg = (value: string | number | null) =>
    value == null || !Number.isFinite(Number(value)) ? t("emDash") : formatDecimal(value, 1);
  const { data: session } = useSession();
  const router = useRouter();

  const canWeigh = sessionHasPermission(session, "billet.receipt.weigh");
  const canRegister = sessionHasPermission(session, "billet.receipt.register");
  const canUnload = sessionHasPermission(session, "billet.receipt.unload");
  const canClose = sessionHasPermission(session, "billet.receipt.close");
  const canUpload = sessionHasPermission(session, "billet.receipt.upload");
  const canCancel = sessionHasPermission(session, "billet.receipt.cancel");

  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [loadedWeight, setLoadedWeight] = useState("");
  const [emptyWeight, setEmptyWeight] = useState("");
  const [countRows, setCountRows] = useState<Record<number, CountRow>>({});
  const [mismatchReason, setMismatchReason] = useState("");
  const [confirmUnloadOpen, setConfirmUnloadOpen] = useState(false);
  const [pendingUnloadLines, setPendingUnloadLines] = useState<UnloadLinePayload[]>([]);
  const [pendingUnloadMismatch, setPendingUnloadMismatch] = useState(false);

  const [now, setNow] = useState(() => Date.now());

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [editContractNumber, setEditContractNumber] = useState("");
  const [editDriverName, setEditDriverName] = useState("");
  const [editPlateNumber, setEditPlateNumber] = useState("");
  const [editDriverNationalId, setEditDriverNationalId] = useState("");
  const [editDeclaredWeightKg, setEditDeclaredWeightKg] = useState("");
  const [editBundleCount, setEditBundleCount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPieces, setEditPieces] = useState<Record<number, string>>({});

  const photoInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<number | null>(null);

  const fetchReceipt = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}`);
      const json = await res.json();
      if (json.success) {
        setReceipt(json.data);
        // Seed count rows from registered lines.
        const seed: Record<number, CountRow> = {};
        for (const l of json.data.pieceLines as PieceLine[]) {
          seed[l.billetLengthM] = {
            counted: l.countedPieces != null ? String(l.countedPieces) : "",
            rejected: String(l.rejectedPieces ?? 0),
          };
        }
        setCountRows(seed);
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("receipts.errorLoadDetail"));
    } finally {
      setLoading(false);
    }
  }, [receiptId, t]);

  const canEditRegistration =
    canRegister &&
    receipt != null &&
    (receipt.status === "Registered" || receipt.status === "Loaded") &&
    receipt.unloadingPhotoPath == null &&
    receipt.unloadingPhotoAt == null;

  const selectedEditContract = useMemo(
    () => contracts.find((contract) => contract.contractNumber === editContractNumber) || null,
    [contracts, editContractNumber],
  );

  const fetchContracts = useCallback(async () => {
    setContractsLoading(true);
    try {
      const res = await fetch("/api/billet-receipts/contract-options");
      const json = await res.json();
      if (json.success) {
        setContracts(json.data || []);
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("receipts.errorLoadContracts"));
    } finally {
      setContractsLoading(false);
    }
  }, [t]);

  const openEditDialog = async () => {
    if (!receipt) return;
    setEditContractNumber(receipt.supplierContractNumber);
    setEditDriverName(receipt.driverName);
    setEditPlateNumber(receipt.plateNumber);
    setEditDriverNationalId(receipt.driverNationalId || "");
    setEditDeclaredWeightKg(String(Number(receipt.declaredWeightKg)));
    setEditBundleCount(receipt.bundleCount != null ? String(receipt.bundleCount) : "");
    setEditNotes(receipt.notes || "");
    const nextPieces: Record<number, string> = {};
    for (const line of receipt.pieceLines) {
      nextPieces[line.billetLengthM] = String(line.expectedPieces);
    }
    setEditPieces(nextPieces);
    setEditOpen(true);
    await fetchContracts();
  };

  const submitRegistrationEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receipt || !selectedEditContract) {
      toast.error(t("receipts.toastSelectContract"));
      return;
    }
    if (!editDriverName.trim() || !editPlateNumber.trim()) {
      toast.error(t("receipts.toastDriverPlateRequired"));
      return;
    }

    const weight = Number(editDeclaredWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error(t("receipts.toastDeclaredWeightPositive"));
      return;
    }

    const pieceLines: { billetLengthM: number; expectedPieces: number }[] = [];
    for (const line of selectedEditContract.pieceLines) {
      const raw = editPieces[line.billetLengthM];
      if (!raw) continue;
      const pieces = Number(raw);
      if (!Number.isInteger(pieces) || pieces <= 0) {
        toast.error(t("receipts.toastPiecesInvalidForLength", { length: line.billetLengthM }));
        return;
      }
      pieceLines.push({ billetLengthM: line.billetLengthM, expectedPieces: pieces });
    }
    if (pieceLines.length === 0) {
      toast.error(t("receipts.toastEnterAtLeastOneLength"));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierContractNumber: editContractNumber,
          driverName: editDriverName.trim(),
          plateNumber: editPlateNumber.trim(),
          driverNationalId: editDriverNationalId.trim() || undefined,
          declaredWeightKg: weight,
          bundleCount: editBundleCount ? Number(editBundleCount) : undefined,
          notes: editNotes.trim() || undefined,
          pieceLines,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastTruckUpdated"));
      setEditOpen(false);
      fetchReceipt();
    } catch {
      toast.error(t("receipts.toastEditSaveError"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    fetchReceipt();
  }, [fetchReceipt]);

  // Live unloading timer tick.
  useEffect(() => {
    if (receipt?.status !== "Unloading") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [receipt?.status]);

  const submitLoadedWeight = async () => {
    const w = Number(loadedWeight);
    if (!Number.isFinite(w) || w <= 0) {
      toast.error(t("receipts.toastInvalidWeight"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}/loaded-weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: w }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastLoadedRecorded"));
      setLoadedWeight("");
      fetchReceipt();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const submitPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;
    setBusy(true);
    try {
      const file = await compressImage(raw, "truck");
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/billet-receipts/${receiptId}/unload-photo`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastUnloadStarted"));
      fetchReceipt();
    } catch {
      toast.error(t("receipts.toastPhotoUploadError"));
    } finally {
      setBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const hasMismatch = (): boolean => {
    if (!receipt) return false;
    return receipt.pieceLines.some((l) => {
      const row = countRows[l.billetLengthM];
      if (!row || row.counted === "") return false;
      return Number(row.counted) !== l.expectedPieces;
    });
  };

  const submitUnloadResult = async () => {
    if (!receipt) return;
    const lines: UnloadLinePayload[] = [];
    let totalAcceptedPieces = 0;
    for (const l of receipt.pieceLines) {
      const row = countRows[l.billetLengthM];
      if (!row || row.counted === "") {
        toast.error(t("receipts.toastEnterCountedForLength", { length: l.billetLengthM }));
        return;
      }
      const counted = Number(row.counted);
      const rejected = Number(row.rejected || "0");
      if (!Number.isInteger(counted) || counted < 0) {
        toast.error(
          t("receipts.toastPiecesInvalidForLength", {
            length: l.billetLengthM,
          }),
        );
        return;
      }
      if (!Number.isInteger(rejected) || rejected < 0 || rejected > counted) {
        toast.error(t("receipts.toastRejectedInvalidForLength", { length: l.billetLengthM }));
        return;
      }
      totalAcceptedPieces += counted - rejected;
      lines.push({ billetLengthM: l.billetLengthM, countedPieces: counted, rejectedPieces: rejected });
    }

    if (totalAcceptedPieces <= 0) {
      toast.error(t("receipts.toastZeroAccepted"));
      return;
    }

    const mismatch = hasMismatch();
    if (mismatch && !mismatchReason.trim()) {
      toast.error(t("receipts.toastMismatchReasonRequired"));
      return;
    }

    setPendingUnloadLines(lines);
    setPendingUnloadMismatch(mismatch);
    setConfirmUnloadOpen(true);
  };

  const confirmUnloadResult = async () => {
    if (!receipt || pendingUnloadLines.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}/unload-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: pendingUnloadLines,
          mismatchReason: mismatchReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastUnloadResultRecorded"));
      setConfirmUnloadOpen(false);
      setPendingUnloadLines([]);
      setPendingUnloadMismatch(false);
      setMismatchReason("");
      fetchReceipt();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const reopenUnload = async () => {
    if (!receipt) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}/reopen-unload`, {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastReopenCount"));
      fetchReceipt();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const submitComplete = async () => {
    const w = Number(emptyWeight);
    if (!Number.isFinite(w) || w <= 0) {
      toast.error(t("receipts.toastEnterEmptyWeight"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: w }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastClosed"));
      setEmptyWeight("");
      fetchReceipt();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const submitAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;
    setBusy(true);
    try {
      const file = raw.type.startsWith("image/") ? await compressImage(raw, "truck") : raw;
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/billet-receipts/${receiptId}/attachment`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastAttachmentUploaded"));
      fetchReceipt();
    } catch {
      toast.error(t("receipts.toastAttachmentUploadError"));
    } finally {
      setBusy(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  };

  const submitCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error(t("receipts.toastCancelReasonRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/billet-receipts/${receiptId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("receipts.toastCancelled"));
      setCancelOpen(false);
      setCancelReason("");
      fetchReceipt();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (filePath: string, id: number) => {
    setOpeningAttachmentId(id);
    try {
      const res = await fetchUploadedFile(filePath);
      if (!res.ok) {
        toast.error(t("receipts.toastFileLoadError"));
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const win = window.open(objUrl, "_blank");
      if (win) win.opener = null;
      else toast.error(t("receipts.toastPopupBlocked"));
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
    } catch {
      toast.error(t("receipts.toastServerError"));
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

  if (!receipt) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t("receipts.notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/billet-receipts")}>
          {t("receipts.backToList")}
        </Button>
      </div>
    );
  }

  const st = statusMap[receipt.status] || statusMap.Registered;
  const isTerminal = receipt.status === "Completed" || receipt.status === "Cancelled";
  const canAddAttachment = canUpload && receipt.status !== "Cancelled";

  // Net preview for the close step.
  const loadedNum = receipt.loadedWeightKg != null ? Number(receipt.loadedWeightKg) : null;
  const emptyNum = emptyWeight ? Number(emptyWeight) : null;
  const netPreview =
    loadedNum != null && emptyNum != null && emptyNum < loadedNum
      ? loadedNum - emptyNum
      : null;
  const declaredNum = Number(receipt.declaredWeightKg);
  const netPreviewDiff = netPreview != null ? netPreview - declaredNum : null;

  // Unloading duration (live while Unloading, fixed once counted).
  let unloadingDurationMs: number | null = null;
  if (receipt.unloadingPhotoAt) {
    const start = new Date(receipt.unloadingPhotoAt).getTime();
    const end = receipt.countEnteredAt ? new Date(receipt.countEnteredAt).getTime() : now;
    unloadingDurationMs = end - start;
  }

  const completedNet = receipt.netWeightKg != null ? Number(receipt.netWeightKg) : null;
  const completedDiff = completedNet != null ? completedNet - declaredNum : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/billet-receipts")}
          >
            <BackIcon className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight font-mono">
                {receipt.receiptNumber}
              </h1>
              <Badge variant={st}>{tEnums(`billetReceiptStatus.${receipt.status}`)}</Badge>
              {receipt.isPriorWithdrawal && <Badge variant="secondary">{t("contracts.typePriorWithdrawal")}</Badge>}
              {receipt.isAdjustment && <Badge variant="outline">{t("receipts.balanceAdjustmentBadge")}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {receipt.plateNumber} — {receipt.driverName}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canEditRegistration && (
            <Button
              size="sm"
              variant="outline"
              onClick={openEditDialog}
              disabled={busy}
            >
              {t("receipts.editTruck")}
            </Button>
          )}
          {canCancel && !isTerminal && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setCancelOpen(true)}
            >
              <XCircle className="h-4 w-4" />
              {t("cancel")}
            </Button>
          )}
        </div>
      </div>

      {/* Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            {t("receipts.infoTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t("receipts.labelSupplier")}</span>{" "}
              <button
                className="font-medium text-primary hover:underline"
                onClick={() =>
                  router.push(`/billet-contracts/${receipt.supplierContractNumber}`)
                }
              >
                {receipt.contract.supplierName} ({receipt.contract.contractNumber})
              </button>
            </div>
            <div>
              <span className="text-muted-foreground">
                {receipt.isPriorWithdrawal || receipt.isAdjustment
                  ? t("receipts.labelType")
                  : t("receipts.labelPlate")}
              </span>{" "}
              <span className="font-medium">
                {receipt.isPriorWithdrawal
                  ? t("receipts.typePriorBeforeSystem")
                  : receipt.isAdjustment
                    ? t("receipts.typeBalanceAdjustment")
                    : receipt.plateNumber}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">
                {receipt.isPriorWithdrawal || receipt.isAdjustment
                  ? t("receipts.labelRef")
                  : t("receipts.labelDriver")}
              </span>{" "}
              {receipt.driverName}
              {!receipt.isPriorWithdrawal &&
              !receipt.isAdjustment &&
              receipt.driverNationalId
                ? ` — ${receipt.driverNationalId}`
                : ""}
            </div>
            <div>
              <span className="text-muted-foreground">{t("receipts.labelDeclaredWeight")}</span>{" "}
              <span className="tabular-nums">{t("kgValue", { value: formatKg(receipt.declaredWeightKg) })}</span>
            </div>
            {receipt.bundleCount != null && (
              <div>
                <span className="text-muted-foreground">{t("receipts.labelBundleCount")}</span>{" "}
                {receipt.bundleCount}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">
                {receipt.isPriorWithdrawal
                  ? t("receipts.labelWithdrawalDate")
                  : t("receipts.labelCreated")}
              </span>{" "}
              <span dir="ltr">
                {formatDate(receipt.priorWithdrawalDate || receipt.createdAt)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Step actions ─────────────────────────────────────────── */}

      {/* Registered → Loaded weight */}
      {receipt.status === "Registered" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4" />
              {t("receipts.loadedWeightTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canWeigh ? (
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="loaded">{t("receipts.entryWeightLabel")}</Label>
                  <Input
                    id="loaded"
                    type="number"
                    min={0}
                    step="0.1"
                    inputMode="decimal"
                    value={loadedWeight}
                    onChange={(e) => setLoadedWeight(e.target.value)}
                    placeholder={t("receipts.entryWeightPlaceholder")}
                  />
                </div>
                <Button onClick={submitLoadedWeight} disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t("receipts.register")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("receipts.waitingLoadedWeight")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loaded → Unloading photo */}
      {receipt.status === "Loaded" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4" />
              {t("receipts.startUnloadTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground mb-0.5">{t("receipts.loadedWeightRecorded")}</p>
              <p className="text-xl font-bold tabular-nums">
                {t("kgValue", { value: formatKg(receipt.loadedWeightKg) })}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("receipts.startUnloadHint")}
            </p>
            {canUnload ? (
              <>
                <Button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={busy}
                  className="gap-1.5"
                >
                  {busy ? <Loader2 className="animate-spin" /> : <Camera className="h-4 w-4" />}
                  {t("receipts.captureStartTimer")}
                </Button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={submitPhoto}
                  disabled={busy}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("receipts.waitingUnloadStart")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Unloading → enter counts */}
      {receipt.status === "Unloading" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t("receipts.countPiecesTitle")}
              </span>
              <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                <Timer className="h-4 w-4" />
                {unloadingDurationMs != null
                  ? formatDurationLocalized(unloadingDurationMs, locale)
                  : t("emDash")}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canUnload ? (
              <>
                <div className="space-y-2">
                  {receipt.pieceLines.map((l) => {
                    const row = countRows[l.billetLengthM] || { counted: "", rejected: "0" };
                    const mismatch =
                      row.counted !== "" && Number(row.counted) !== l.expectedPieces;
                    return (
                      <div
                        key={l.billetLengthM}
                        className="rounded-md border p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{t("lengthMeters", { n: formatInteger(l.billetLengthM) })}</span>
                          <span className="text-xs text-muted-foreground">
                            {t("receipts.declaredLabel")} {l.expectedPieces}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">{t("receipts.counted")}</Label>
                            <Input
                              type="number"
                              min={0}
                              value={row.counted}
                              onChange={(e) =>
                                setCountRows((prev) => ({
                                  ...prev,
                                  [l.billetLengthM]: {
                                    ...prev[l.billetLengthM],
                                    counted: e.target.value,
                                  },
                                }))
                              }
                              className={mismatch ? "border-destructive" : undefined}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{t("receipts.rejected")}</Label>
                            <Input
                              type="number"
                              min={0}
                              value={row.rejected}
                              onChange={(e) =>
                                setCountRows((prev) => ({
                                  ...prev,
                                  [l.billetLengthM]: {
                                    ...prev[l.billetLengthM],
                                    rejected: e.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                        </div>
                        {mismatch && (
                          <p className="flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {t("receipts.mismatchFromDeclared")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {hasMismatch() && (
                  <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <Label htmlFor="mismatchReason" className="text-destructive">
                      {t("receipts.mismatchReasonRequired")}
                    </Label>
                    <Textarea
                      id="mismatchReason"
                      value={mismatchReason}
                      onChange={(e) => setMismatchReason(e.target.value)}
                      rows={2}
                      placeholder={t("receipts.mismatchReasonPlaceholder")}
                    />
                  </div>
                )}

                <Button onClick={submitUnloadResult} disabled={busy} className="w-full">
                  {busy && <Loader2 className="animate-spin" />}
                  {t("receipts.confirmCountStopTimer")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("receipts.waitingCountEntry")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* AwaitingExit → empty weight + close */}
      {receipt.status === "AwaitingExit" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4" />
              {t("receipts.emptyWeightCloseTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Weight summary — always visible */}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">{t("receipts.loaded")}</p>
                <p className="font-bold tabular-nums">
                  {t("kgValue", { value: formatKg(receipt.loadedWeightKg) })}
                </p>
              </div>
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">{t("receipts.empty")}</p>
                <p className="font-bold tabular-nums">
                  {emptyNum != null ? t("kgValue", { value: formatKg(emptyNum) }) : t("emDash")}
                </p>
              </div>
              <div
                className={`rounded-lg border p-2.5 text-center ${netPreview != null ? "bg-muted/30" : ""}`}
              >
                <p className="text-xs text-muted-foreground mb-0.5">{t("receipts.actualNet")}</p>
                <p className="font-bold tabular-nums">
                  {netPreview != null ? t("kgValue", { value: formatKg(netPreview) }) : t("emDash")}
                </p>
              </div>
            </div>

            {canUnload && receipt.emptyWeightKg == null && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="mb-2">{t("receipts.reopenCountHint")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reopenUnload}
                  disabled={busy}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  {t("receipts.reopenCount")}
                </Button>
              </div>
            )}
            {canClose ? (
              <>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="empty">{t("receipts.emptyWeightLabel")}</Label>
                    <Input
                      id="empty"
                      type="number"
                      min={0}
                      step="0.1"
                      inputMode="decimal"
                      value={emptyWeight}
                      onChange={(e) => setEmptyWeight(e.target.value)}
                      placeholder={t("receipts.emptyWeightPlaceholder")}
                    />
                  </div>
                  <Button onClick={submitComplete} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}
                    {t("receipts.close")}
                  </Button>
                </div>
                {netPreviewDiff != null && (
                  <div className="rounded-md border p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("receipts.diffFromDeclared")}</span>
                      <span className="tabular-nums font-semibold">
                        {t("kgValueSigned", {
                          sign: netPreviewDiff > 0 ? "+" : "",
                          value: formatKg(netPreviewDiff),
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("receipts.waitingEmptyClose")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completed summary */}
      {receipt.status === "Completed" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-600">
              {receipt.isPriorWithdrawal || receipt.isAdjustment ? (
                <History className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {receipt.isPriorWithdrawal
                ? t("receipts.completedPriorTitle")
                : receipt.isAdjustment
                  ? t("receipts.completedAdjustTitle")
                  : t("receipts.completedTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
              {!receipt.isPriorWithdrawal && !receipt.isAdjustment && (
                <>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("receipts.loaded")}</p>
                    <p className="font-bold tabular-nums">
                      {formatKg(receipt.loadedWeightKg)}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("receipts.empty")}</p>
                    <p className="font-bold tabular-nums">
                      {formatKg(receipt.emptyWeightKg)}
                    </p>
                  </div>
                </>
              )}
              <div className="rounded-lg border p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">{t("receipts.net")}</p>
                <p className="font-bold tabular-nums">{formatKg(receipt.netWeightKg)}</p>
              </div>
              {receipt.isPriorWithdrawal || receipt.isAdjustment ? (
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {receipt.isPriorWithdrawal
                      ? t("receipts.labelWithdrawalDate")
                      : t("receipts.registrationDate")}
                  </p>
                  <p className="font-bold" dir="ltr">
                    {formatDate(receipt.priorWithdrawalDate || receipt.createdAt)}
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("receipts.diffFromDeclared")}</p>
                    <p className="font-bold tabular-nums">
                      {completedDiff != null
                        ? `${completedDiff > 0 ? "+" : ""}${formatKg(completedDiff)}`
                        : t("emDash")}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("receipts.unloadingDuration")}</p>
                    <p className="font-bold">
                      {unloadingDurationMs != null
                        ? formatDurationLocalized(unloadingDurationMs, locale)
                        : t("emDash")}
                    </p>
                  </div>
                </>
              )}
            </div>
            {receipt.countMismatchReason && (
              <p className="mt-3 flex items-start gap-1 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {t("receipts.countMismatchReason")}: {receipt.countMismatchReason}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cancelled */}
      {receipt.status === "Cancelled" && (
        <Card>
          <CardContent className="py-4">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              {t("receipts.cancelledWithReason", {
                reason: receipt.cancelReason || t("receipts.reasonNotSpecified"),
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pieces table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            {t("receipts.piecesPerLengthTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-x-auto">
            <Table className="w-full min-w-[480px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t("receipts.colLength")}</TableHead>
                  <TableHead className="text-center">{t("receipts.colDeclared")}</TableHead>
                  <TableHead className="text-center">{t("receipts.counted")}</TableHead>
                  <TableHead className="text-center">{t("receipts.rejected")}</TableHead>
                  <TableHead className="text-center">{t("receipts.colAccepted")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.pieceLines.map((l) => {
                  const accepted =
                    l.countedPieces != null
                      ? Math.max(0, l.countedPieces - l.rejectedPieces)
                      : null;
                  return (
                    <TableRow key={l.billetLengthM}>
                      <TableCell className="text-start font-medium">
                        {t("lengthMeters", { n: formatInteger(l.billetLengthM) })}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {l.expectedPieces}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {l.countedPieces ?? t("emDash")}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {l.rejectedPieces}
                      </TableCell>
                      <TableCell className="text-center tabular-nums font-semibold">
                        {accepted ?? t("emDash")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              {t("receipts.attachmentsCount", { count: formatInteger(receipt.attachments.length) })} ({formatInteger(receipt.attachments.length)})
            </CardTitle>
            {canAddAttachment && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => attachInputRef.current?.click()}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {receipt.status === "Completed"
                    ? t("receipts.addLateAttachment")
                    : t("receipts.addAttachment")}
                </Button>
                <input
                  ref={attachInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={submitAttachment}
                  disabled={busy}
                />
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {receipt.unloadingPhotoPath && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border p-2.5">
              <Camera className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{t("receipts.unloadPhoto")}</p>
                {receipt.unloadingPhotoAt && (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {formatDate(receipt.unloadingPhotoAt)}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openAttachment(receipt.unloadingPhotoPath!, -1)}
                disabled={openingAttachmentId === -1}
                title={t("receipts.previewPhoto")}
              >
                {openingAttachmentId === -1 ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )}
          {receipt.attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {receipt.status === "Completed" && canAddAttachment
                ? t("receipts.noAttachmentsLateHint")
                : t("receipts.noAttachments")}
            </p>
          ) : (
            <div className="space-y-2">
              {receipt.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/30 transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{att.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("fileSizeKbLabel", {
                        size: formatInteger(att.fileSize / 1024),
                        date: formatDate(att.uploadedAt),
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openAttachment(att.filePath, att.id)}
                    disabled={openingAttachmentId === att.id}
                    title={t("receipts.previewFile")}
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

      {/* Edit registration dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent dir={dir} className="max-w-lg max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("receipts.editDialogTitle")}</DialogTitle>
            <DialogDescription>{t("receipts.editDialogDesc")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRegistrationEdit} className="min-w-0 space-y-4">
            <div className="space-y-2">
              <Label>{t("receipts.supplierContractRequired")}</Label>
              {contractsLoading ? (
                <div className="h-9 animate-pulse rounded-md bg-muted" />
              ) : (
                <Select
                  value={editContractNumber}
                  onValueChange={(value) => {
                    setEditContractNumber(value ?? "");
                    setEditPieces({});
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("receipts.selectContract")} />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
                    {contracts.map((contract) => (
                      <SelectItem
                        key={contract.contractNumber}
                        value={contract.contractNumber}
                      >
                        {contract.contractNumber} — {contract.supplierName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="editPlateNumber">{t("receipts.plateRequired")}</Label>
                <Input
                  id="editPlateNumber"
                  value={editPlateNumber}
                  onChange={(e) => setEditPlateNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDriverName">{t("receipts.driverRequired")}</Label>
                <Input
                  id="editDriverName"
                  value={editDriverName}
                  onChange={(e) => setEditDriverName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="editDriverNationalId">{t("receipts.driverIdOptional")}</Label>
                <Input
                  id="editDriverNationalId"
                  value={editDriverNationalId}
                  onChange={(e) => setEditDriverNationalId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDeclaredWeight">{t("receipts.declaredWeightRequired")}</Label>
                <Input
                  id="editDeclaredWeight"
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={editDeclaredWeightKg}
                  onChange={(e) => setEditDeclaredWeightKg(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("receipts.declaredPiecesPerLength")}</Label>
              {!selectedEditContract ? (
                <p className="text-sm text-muted-foreground">{t("receipts.selectContractFirst")}</p>
              ) : (
                <div className="space-y-2">
                  {selectedEditContract.pieceLines.map((line) => (
                    <div key={line.billetLengthM} className="flex items-center gap-3">
                      <span className="w-16 text-sm font-medium">
                        {t("lengthMeters", { n: formatInteger(line.billetLengthM) })}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        className="flex-1"
                        value={editPieces[line.billetLengthM] ?? ""}
                        onChange={(e) =>
                          setEditPieces((prev) => ({
                            ...prev,
                            [line.billetLengthM]: e.target.value,
                          }))
                        }
                        placeholder={t("contracts.pieceCountPlaceholder")}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    {t("receipts.leaveEmptyTruckLengthHint")}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="editBundleCount">{t("receipts.bundleCountOptional")}</Label>
              <Input
                id="editBundleCount"
                type="number"
                min={1}
                value={editBundleCount}
                onChange={(e) => setEditBundleCount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editNotes">{t("notesOptional")}</Label>
              <Textarea
                id="editNotes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={busy}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={busy || contractsLoading}>
                {busy && <Loader2 className="animate-spin" />}
                {t("receipts.saveEdit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm unload result dialog */}
      <Dialog
        open={confirmUnloadOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setConfirmUnloadOpen(open);
        }}
      >
        <DialogContent dir={dir} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("receipts.confirmCountTitle")}</DialogTitle>
            <DialogDescription>{t("receipts.confirmCountDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border overflow-x-auto">
              <Table className="w-full min-w-[360px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("receipts.colLength")}</TableHead>
                    <TableHead className="text-center">{t("receipts.counted")}</TableHead>
                    <TableHead className="text-center">{t("receipts.rejected")}</TableHead>
                    <TableHead className="text-center">{t("receipts.colAccepted")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingUnloadLines.map((line) => (
                    <TableRow key={line.billetLengthM}>
                      <TableCell className="text-start font-medium">
                        {t("lengthMeters", { n: formatInteger(line.billetLengthM) })}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {line.countedPieces}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {line.rejectedPieces}
                      </TableCell>
                      <TableCell className="text-center tabular-nums font-semibold">
                        {line.countedPieces - line.rejectedPieces}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pendingUnloadMismatch && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                {t("receipts.mismatchWillSave")}{" "}
                <span className="font-medium">{mismatchReason.trim()}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmUnloadOpen(false)}
              disabled={busy}
            >
              {t("receipts.review")}
            </Button>
            <Button onClick={confirmUnloadResult} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t("receipts.lockCount")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent dir={dir} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("receipts.cancelDialogTitle")}</DialogTitle>
            <DialogDescription>{t("receipts.cancelDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="cancelReason">{t("receipts.reasonRequired")}</Label>
            <Input
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t("receipts.cancelReasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={submitCancel} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t("receipts.confirmCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
