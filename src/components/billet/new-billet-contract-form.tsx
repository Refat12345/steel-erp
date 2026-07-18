"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compressImage } from "@/lib/compress-image";
import { formatDecimal, formatInteger } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import { ArrowLeft, ArrowRight, FileText, Loader2, Plus, Trash2, Upload, X } from "lucide-react";

interface PieceRow {
  key: number;
  lengthM: string;
  pieces: string;
}

let rowKey = 0;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewBilletContractForm() {
  const t = useTranslations("billet");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [contractedWeightKg, setContractedWeightKg] = useState("");
  const [contractDate, setContractDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [pieceRows, setPieceRows] = useState<PieceRow[]>([
    { key: ++rowKey, lengthM: "6", pieces: "" },
    { key: ++rowKey, lengthM: "12", pieces: "" },
  ]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return t("fileSizeB", { n: formatInteger(bytes) });
    if (bytes < 1024 * 1024) {
      return t("fileSizeKb", { n: formatInteger(bytes / 1024) });
    }
    return t("fileSizeMb", { n: formatDecimal(bytes / (1024 * 1024), 1) });
  };

  const onSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) setFiles((prev) => [...prev, ...selected]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const addRow = () =>
    setPieceRows((prev) => [...prev, { key: ++rowKey, lengthM: "", pieces: "" }]);
  const removeRow = (key: number) =>
    setPieceRows((prev) => prev.filter((r) => r.key !== key));
  const updateRow = (key: number, field: "lengthM" | "pieces", value: string) =>
    setPieceRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
    for (const r of pieceRows) {
      if (!r.lengthM && !r.pieces) continue;
      const len = Number(r.lengthM);
      const pcs = Number(r.pieces);
      if (!Number.isInteger(len) || len <= 0) {
        toast.error(t("contracts.toastLengthInteger"));
        return;
      }
      if (!Number.isInteger(pcs) || pcs <= 0) {
        toast.error(t("contracts.toastPiecesForLength", { length: len }));
        return;
      }
      if (seen.has(len)) {
        toast.error(t("contracts.toastDuplicateLength"));
        return;
      }
      seen.add(len);
      lines.push({ billetLengthM: len, contractedPieces: pcs });
    }

    if (lines.length === 0) {
      toast.error(t("contracts.toastAddAtLeastOneLength"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/billet-contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: supplierName.trim(),
          contractedWeightKg: weight,
          contractDate: contractDate || undefined,
          notes: notes.trim() || undefined,
          pieceLines: lines,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error);
        return;
      }
      const contractNumber: string = json.data.contractNumber;
      toast.success(t("contracts.toastCreated", { number: contractNumber }));

      if (files.length > 0) {
        let failed = 0;
        for (const raw of files) {
          try {
            const file = raw.type.startsWith("image/")
              ? await compressImage(raw, "truck")
              : raw;
            const fd = new FormData();
            fd.append("file", file);
            const upRes = await fetch(
              `/api/billet-contracts/${encodeURIComponent(contractNumber)}/attachment`,
              { method: "POST", body: fd },
            );
            const upJson = await upRes.json();
            if (!upJson.success) failed++;
          } catch {
            failed++;
          }
        }
        if (failed > 0) {
          toast.warning(
            t("contracts.toastAttachmentsPartial", {
              failed,
              total: files.length,
            }),
          );
        } else {
          toast.success(t("contracts.toastAttachmentsUploaded"));
        }
      }

      router.push(`/billet-contracts/${encodeURIComponent(contractNumber)}`);
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <BackIcon className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("contracts.newTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("contracts.newSubtitle")}
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("contracts.detailsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplierName">{t("contracts.supplierNameRequired")}</Label>
              <Input
                id="supplierName"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder={t("contracts.supplierNamePlaceholder")}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="weight">{t("contracts.totalWeightRequired")}</Label>
                <Input
                  id="weight"
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={contractedWeightKg}
                  onChange={(e) => setContractedWeightKg(e.target.value)}
                  placeholder={t("contracts.totalWeightPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contractDate">{t("contracts.contractDate")}</Label>
                <Input
                  id="contractDate"
                  type="date"
                  value={contractDate}
                  onChange={(e) => setContractDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {t("contracts.piecesPerLengthRequired")}
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5 ms-1" />
                {t("contracts.addLength")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pieceRows.map((row) => (
              <div key={row.key} className="flex items-end gap-2">
                <div className="w-28 space-y-1.5">
                  <Label className="text-xs">{t("contracts.lengthM")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={row.lengthM}
                    onChange={(e) => updateRow(row.key, "lengthM", e.target.value)}
                    placeholder="6"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">{t("contracts.pieceCount")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={row.pieces}
                    onChange={(e) => updateRow(row.key, "pieces", e.target.value)}
                    placeholder={t("contracts.pieceCountPlaceholder")}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive"
                  onClick={() => removeRow(row.key)}
                  disabled={pieceRows.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {t("contracts.leaveEmptyLengthHint")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("contracts.attachments")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={onSelectFiles}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 ms-1" />
              {t("contracts.addAttachment")}
            </Button>
            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-md border p-2 text-sm"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFileSize(f.size)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-destructive"
                      onClick={() => removeFile(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {t("contracts.attachmentsHint")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("notes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("contracts.notesPlaceholder")}
              rows={3}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {t("contracts.createContract")}
          </Button>
        </div>
      </form>
    </div>
  );
}
