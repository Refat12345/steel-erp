"use client";

import { useRef, useState, useEffect, useCallback, use } from "react";
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
  ArrowLeft,
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

function formatFileSize(bytes: number, t: ReturnType<typeof useTranslations>): string {
  if (bytes < 1024) return t("fileSizeB", { n: formatInteger(bytes) });
  if (bytes < 1024 * 1024) return t("fileSizeKb", { n: formatInteger(bytes / 1024) });
  return t("fileSizeMb", { n: formatDecimal(bytes / (1024 * 1024), 1) });
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

const statusMap: Record<string, "default" | "secondary" | "destructive"> = {
  Active: "default",
  Completed: "secondary",
  Cancelled: "destructive",
};

export default function BilletContractDetailPage({
  params,
}: {
  params: Promise<{ contractNumber: string }>;
}) {
  const { contractNumber } = use(params);
  const t = useTranslations("billet");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const formatKg = (value: string | number | null) =>
    value == null || !Number.isFinite(Number(value)) ? t("emDash") : formatDecimal(value, 3);
  const formatRemainingKg = (value: string | number | null) => {
    if (value == null || !Number.isFinite(Number(value))) return t("emDash");
    return Number(value) < 0 ? t("contracts.overshoot", { value: formatKg(Math.abs(Number(value))) }) : formatKg(value);
  };
  const formatRemainingPieces = (value: number | null) =>
    value == null || !Number.isFinite(value) ? t("emDash") : value < 0 ? t("contracts.overshoot", { value: formatInteger(Math.abs(value)) }) : formatInteger(value);
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
  const [priorNotes, setPriorNotes] = useState("");
  const [priorPieces, setPriorPieces] = useState<Record<number, string>>({});
  const [priorSaving, setPriorSaving] = useState(false);

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustWeightKg, setAdjustWeightKg] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustPieces, setAdjustPieces] = useState<Record<number, string>>({});
  const [adjustSaving, setAdjustSaving] = useState(false);

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
      toast.error(t("contracts.errorLoadDetail"));
    } finally {
      setLoading(false);
    }
  }, [contractNumber, t]);

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
    setPriorNotes(t("contracts.priorNotesDefault"));
    setPriorPieces(seed);
    setPriorDialogOpen(true);
  };

  const openAdjustmentDialog = () => {
    if (!data) return;
    setAdjustWeightKg("");
    setAdjustNotes("");
    setAdjustPieces({});
    setAdjustDialogOpen(true);
  };

  const saveContractDetails = async () => {
    if (!supplierName.trim()) {
      toast.error(t("contracts.toastSupplierRequired"));
      return;
    }

    const weight = Number(contractedWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error(t("contracts.toastWeightPositive"));
      return;
    }

    const lines: { billetLengthM: number; contractedPieces: number }[] = [];
    const seen = new Set<number>();
    for (const row of pieceRows) {
      const len = Number(row.billetLengthM);
      const pcs = Number(row.contractedPieces);
      if (!Number.isInteger(len) || len <= 0) {
        toast.error(t("contracts.toastLengthInteger"));
        return;
      }
      if (!Number.isInteger(pcs) || pcs <= 0) {
        toast.error(t("contracts.toastPiecesForLengthNamed", { length: row.billetLengthM || t("contracts.ariaLength") }));
        return;
      }
      if (seen.has(len)) {
        toast.error(t("contracts.toastDuplicateLength"));
        return;
      }
      if (pcs < row.acceptedPieces) {
        toast.error(t("contracts.toastPiecesBelowAccepted", { length: len, accepted: formatInteger(row.acceptedPieces) }));
        return;
      }
      seen.add(len);
      lines.push({ billetLengthM: len, contractedPieces: pcs });
    }

    if (lines.length === 0) {
      toast.error(t("contracts.toastAddAtLeastOneLength"));
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
        toast.success(t("contracts.toastSaved"));
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("contracts.toastSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async () => {
    if (!statusReason.trim()) {
      toast.error(t("contracts.toastStatusReasonRequired"));
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
        toast.success(t("contracts.toastStatusChanged"));
        setStatusDialogOpen(false);
        setStatusReason("");
        fetchContract();
      } else {
        toast.error(json.error);
      }
    } catch {
      toast.error(t("contracts.toastStatusChangeError"));
    } finally {
      setStatusSaving(false);
    }
  };

  const submitPriorWithdrawal = async () => {
    if (!data) return;
    const weight = Number(priorWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error(t("contracts.toastPriorWeightPositive"));
      return;
    }
    if (!priorNotes.trim()) {
      toast.error(t("contracts.toastPriorNotesRequired"));
      return;
    }

    // Piece counts are optional — a prior withdrawal may be weight-only.
    const lines = data.pieceBalances
      .map((balance) => ({
        billetLengthM: balance.billetLengthM,
        acceptedPieces: Number(priorPieces[balance.billetLengthM] || 0),
      }))
      .filter((line) => line.acceptedPieces > 0);

    for (const line of lines) {
      if (!Number.isInteger(line.acceptedPieces)) {
        toast.error(t("contracts.toastPriorPiecesInteger", { length: line.billetLengthM }));
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
      toast.success(t("contracts.toastPriorSuccess"));
      setPriorDialogOpen(false);
      fetchContract();
    } catch {
      toast.error(t("contracts.toastPriorError"));
    } finally {
      setPriorSaving(false);
    }
  };

  const submitAdjustment = async () => {
    if (!data) return;
    const weight = adjustWeightKg.trim() === "" ? 0 : Number(adjustWeightKg);
    if (!Number.isFinite(weight)) {
      toast.error(t("contracts.toastAdjustWeightInvalid"));
      return;
    }
    if (!adjustNotes.trim()) {
      toast.error(t("contracts.toastAdjustReasonRequired"));
      return;
    }

    const lines: { billetLengthM: number; pieces: number }[] = [];
    for (const balance of data.pieceBalances) {
      const raw = (adjustPieces[balance.billetLengthM] ?? "").trim();
      if (raw === "" || raw === "-") continue;
      const pieces = Number(raw);
      if (!Number.isInteger(pieces)) {
        toast.error(
          t("contracts.toastPriorPiecesInteger", {
            length: balance.billetLengthM,
          }),
        );
        return;
      }
      if (pieces !== 0) lines.push({ billetLengthM: balance.billetLengthM, pieces });
    }

    if (weight === 0 && lines.length === 0) {
      toast.error(t("contracts.toastAdjustNeedValue"));
      return;
    }

    setAdjustSaving(true);
    try {
      const res = await fetch(
        `/api/billet-contracts/${encodeURIComponent(contractNumber)}/adjustment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            netWeightKg: weight,
            notes: adjustNotes.trim(),
            pieceLines: lines,
          }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      toast.success(t("contracts.toastAdjustSuccess"));
      setAdjustDialogOpen(false);
      fetchContract();
    } catch {
      toast.error(t("contracts.toastAdjustError"));
    } finally {
      setAdjustSaving(false);
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
      toast.success(t("contracts.toastAttachmentUploaded"));
      fetchContract();
    } catch {
      toast.error(t("contracts.toastUploadError"));
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
        toast.error(t("contracts.toastFileLoadError"));
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const win = window.open(objUrl, "_blank");
      if (win) win.opener = null;
      else toast.error(t("contracts.toastPopupBlocked"));
      window.setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
    } catch {
      toast.error(t("contracts.toastServerError"));
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
        <p className="text-muted-foreground">{t("contracts.notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/billet-contracts")}>
          {t("contracts.backToContracts")}
        </Button>
      </div>
    );
  }

  const st = statusMap[data.contract.status] || statusMap.Active;
  const hasOvershoot =
    Number(data.remainingWeightKg) < 0 ||
    data.pieceBalances.some((balance) => balance.remainingPieces < 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/billet-contracts")}
          >
            <BackIcon className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight font-mono">
                {data.contract.contractNumber}
              </h1>
              <Badge variant={st}>{tEnums(`billetContractStatus.${data.contract.status}`)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {data.contract.supplierName} — {t("contracts.createdAtBy", { date: formatDate(data.contract.createdAt), name: data.contract.creator.fullName })}
            </p>
          </div>
        </div>

        {(canRecordPriorWithdrawal || canChangeStatus) &&
          data.contract.status === "Active" && (
          <div className="flex flex-wrap gap-2 pe-10">
            {canRecordPriorWithdrawal && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openPriorWithdrawalDialog}
                >
                  <History className="h-4 w-4" />
                  {t("contracts.priorWithdrawal")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openAdjustmentDialog}
                >
                  <Scale className="h-4 w-4" />
                  {t("contracts.balanceAdjustment")}
                </Button>
              </>
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
                  {t("contracts.complete")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setNewStatus("Cancelled");
                    setStatusDialogOpen(true);
                  }}
                >
                  {t("cancel")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Editable contract details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("contracts.detailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplierName">{t("contracts.supplierNameLabel")}</Label>
            <Input
              id="supplierName"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              readOnly={!canEdit}
              className={!canEdit ? "bg-muted/50" : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contractedWeightKg">{t("contracts.contractedWeightLabel")}</Label>
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
              {t("contracts.contractedWeightHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Balance summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {t("contracts.weightBalanceTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("contracts.contracted")}</p>
              <p className="text-lg font-bold tabular-nums">
                {formatKg(data.contractedWeightKg)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("contracts.received")}</p>
              <p className="text-lg font-bold tabular-nums">
                {formatKg(data.receivedWeightKg)}
              </p>
            </div>
            <div
              className={`rounded-lg border p-3 ${
                Number(data.remainingWeightKg) < 0
                  ? "border-destructive/50 bg-destructive/10"
                  : "bg-muted/30"
              }`}
            >
              <p className="text-xs text-muted-foreground">{t("contracts.remaining")}</p>
              <p
                className={`text-lg font-bold tabular-nums ${
                  Number(data.remainingWeightKg) < 0 ? "text-destructive" : ""
                }`}
              >
                {formatRemainingKg(data.remainingWeightKg)}
              </p>
            </div>
          </div>
          {hasOvershoot ? (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {t("contracts.overshootHint")}
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Piece balances */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("contracts.pieceBalanceTitle")}
            </CardTitle>
            {canEdit && (
              <Button type="button" variant="outline" size="sm" onClick={addPieceRow}>
                <Plus className="h-3.5 w-3.5" />
                {t("contracts.addLength")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-x-auto">
            <Table className="w-full min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t("contracts.colLength")}</TableHead>
                  <TableHead className="text-center">{t("contracts.contracted")}</TableHead>
                  <TableHead className="text-center">{t("contracts.colAcceptedReceived")}</TableHead>
                  <TableHead className="text-center">{t("contracts.remaining")}</TableHead>
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
                              aria-label={t("contracts.ariaLength")}
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
                              aria-label={t("contracts.ariaContractedPieces")}
                            />
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {row.acceptedPieces}
                          </TableCell>
                          <TableCell
                            className={`text-center tabular-nums font-semibold ${
                              remainingPieces != null && remainingPieces < 0
                                ? "text-destructive"
                                : ""
                            }`}
                          >
                            {formatRemainingPieces(remainingPieces)}
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
                                  ? t("contracts.cannotDeleteLengthWithReceipts")
                                  : t("contracts.deleteLength")
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
                          {t("lengthMeters", { n: formatInteger(b.billetLengthM) })}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {b.contractedPieces}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {b.acceptedPieces}
                        </TableCell>
                        <TableCell
                          className={`text-center tabular-nums font-semibold ${
                            b.remainingPieces < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatRemainingPieces(b.remainingPieces)}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
          {canEdit && (
            <p className="mt-2 text-xs text-muted-foreground">{t("contracts.pieceEditHint")}</p>
          )}
        </CardContent>
      </Card>

      {/* Receipts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            {t("contracts.linkedReceipts", { count: formatInteger(data.receipts.length) })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("contracts.noReceiptsYet")}
            </p>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table className="w-full min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("contracts.colReceiptNumber")}</TableHead>
                    <TableHead className="text-start">{t("contracts.colType")}</TableHead>
                    <TableHead className="text-start">{t("contracts.colPlate")}</TableHead>
                    <TableHead className="text-start">{t("contracts.colStatus")}</TableHead>
                    <TableHead className="text-start">{t("contracts.colNetKg")}</TableHead>
                    <TableHead className="text-start">{t("contracts.colDate")}</TableHead>
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
                          <Badge variant="secondary">{t("contracts.priorWithdrawal")}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("contracts.typeReceipt")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-start">{r.plateNumber}</TableCell>
                      <TableCell className="text-start text-xs">
                        {tEnums(`billetReceiptStatus.${r.status}`)}
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
              {t("contracts.attachmentsCount", { count: formatInteger(data.attachments.length) })}
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
                  {t("contracts.uploadAttachment")}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {data.attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("contracts.noAttachments")}
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
                    {formatFileSize(a.fileSize, t)}
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
          <CardTitle className="text-base">{t("notes")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            readOnly={!canEdit}
            rows={3}
            placeholder={t("contracts.notesPlaceholderDetail")}
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
                {t("contracts.saveContractEdits")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prior Withdrawal Dialog */}
      <Dialog open={priorDialogOpen} onOpenChange={setPriorDialogOpen}>
        <DialogContent dir={dir} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("contracts.priorDialogTitle")}</DialogTitle>
            <DialogDescription>{t("contracts.priorDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="priorWeightKg">{t("contracts.priorNetWeightRequired")}</Label>
                <Input
                  id="priorWeightKg"
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={priorWeightKg}
                  onChange={(e) => setPriorWeightKg(e.target.value)}
                  placeholder={t("contracts.priorWeightPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priorDate">{t("contracts.priorDate")}</Label>
                <Input
                  id="priorDate"
                  type="date"
                  value={priorDate}
                  onChange={(e) => setPriorDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("contracts.priorAcceptedPiecesOptional")}</Label>
              <div className="rounded-lg border overflow-x-auto">
                <Table className="min-w-[420px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t("contracts.colLength")}</TableHead>
                      <TableHead className="text-center">{t("contracts.colCurrentRemaining")}</TableHead>
                      <TableHead className="text-center">{t("contracts.colPriorPieces")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pieceBalances.map((balance) => (
                      <TableRow key={balance.billetLengthM}>
                        <TableCell className="text-start font-medium">
                          {t("lengthMeters", { n: formatInteger(balance.billetLengthM) })}
                        </TableCell>
                        <TableCell
                          className={`text-center tabular-nums ${
                            balance.remainingPieces < 0 ? "text-destructive font-semibold" : ""
                          }`}
                        >
                          {formatRemainingPieces(balance.remainingPieces)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={0}
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
              <Label htmlFor="priorNotes">{t("contracts.priorNotesRequired")}</Label>
              <Textarea
                id="priorNotes"
                value={priorNotes}
                onChange={(e) => setPriorNotes(e.target.value)}
                rows={3}
                placeholder={t("contracts.priorNotesPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPriorDialogOpen(false)}
              disabled={priorSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={submitPriorWithdrawal} disabled={priorSaving}>
              {priorSaving && <Loader2 className="animate-spin" />}
              {t("contracts.priorSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment Dialog */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent dir={dir} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("contracts.adjustDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("contracts.adjustDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adjustWeightKg">{t("contracts.adjustNetWeight")}</Label>
              <Input
                id="adjustWeightKg"
                type="number"
                step="0.001"
                inputMode="decimal"
                value={adjustWeightKg}
                onChange={(e) => setAdjustWeightKg(e.target.value)}
                placeholder={t("contracts.adjustWeightPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("contracts.adjustPiecesByLength")}</Label>
              <div className="rounded-lg border overflow-x-auto">
                <Table className="min-w-[420px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t("contracts.colLength")}</TableHead>
                      <TableHead className="text-center">{t("contracts.colCurrentAccepted")}</TableHead>
                      <TableHead className="text-center">{t("contracts.colPieceAdjust")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pieceBalances.map((balance) => (
                      <TableRow key={balance.billetLengthM}>
                        <TableCell className="text-start font-medium">
                          {t("lengthMeters", { n: formatInteger(balance.billetLengthM) })}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {balance.acceptedPieces}
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            value={adjustPieces[balance.billetLengthM] ?? ""}
                            onChange={(e) =>
                              setAdjustPieces((prev) => ({
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
              <Label htmlFor="adjustNotes">{t("contracts.adjustReasonRequired")}</Label>
              <Textarea
                id="adjustNotes"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                rows={3}
                placeholder={t("contracts.adjustReasonPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAdjustDialogOpen(false)}
              disabled={adjustSaving}
            >
              {t("cancel")}
            </Button>
            <Button onClick={submitAdjustment} disabled={adjustSaving}>
              {adjustSaving && <Loader2 className="animate-spin" />}
              {t("contracts.adjustSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent dir={dir} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {newStatus === "Completed"
                ? t("contracts.statusCompleteTitle")
                : t("contracts.statusCancelTitle")}
            </DialogTitle>
            <DialogDescription>{t("contracts.statusReasonDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="statusReason">{t("contracts.reasonRequired")}</Label>
            <Input
              id="statusReason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder={t("contracts.statusReasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button
              variant={newStatus === "Cancelled" ? "destructive" : "default"}
              onClick={changeStatus}
              disabled={statusSaving}
            >
              {statusSaving && <Loader2 className="animate-spin" />}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
