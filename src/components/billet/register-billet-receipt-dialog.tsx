"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getTextDirection, type Locale } from "@/i18n/config";

interface ContractOption {
  contractNumber: string;
  supplierName: string;
  pieceLines: { billetLengthM: number; contractedPieces: number }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RegisterBilletReceiptDialog({ open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations("billet");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);
  const [contractNumber, setContractNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [driverNationalId, setDriverNationalId] = useState("");
  const [declaredWeightKg, setDeclaredWeightKg] = useState("");
  const [bundleCount, setBundleCount] = useState("");
  const [notes, setNotes] = useState("");
  const [pieces, setPieces] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const fetchContracts = useCallback(async () => {
    setLoadingRef(true);
    try {
      const res = await fetch("/api/billet-receipts/contract-options");
      const json = await res.json();
      if (json.success) setContracts(json.data || []);
    } catch {
      toast.error(t("receipts.errorLoadContracts"));
    } finally {
      setLoadingRef(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) fetchContracts();
  }, [open, fetchContracts]);

  const selectedContract = useMemo(
    () => contracts.find((c) => c.contractNumber === contractNumber) || null,
    [contracts, contractNumber],
  );

  const reset = () => {
    setContractNumber("");
    setDriverName("");
    setPlateNumber("");
    setDriverNationalId("");
    setDeclaredWeightKg("");
    setBundleCount("");
    setNotes("");
    setPieces({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contractNumber) {
      toast.error(t("receipts.toastSelectContract"));
      return;
    }
    if (!driverName.trim() || !plateNumber.trim()) {
      toast.error(t("receipts.toastDriverPlateRequired"));
      return;
    }
    const weight = Number(declaredWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error(t("receipts.toastDeclaredWeightPositive"));
      return;
    }

    const pieceLines: { billetLengthM: number; expectedPieces: number }[] = [];
    for (const line of selectedContract?.pieceLines ?? []) {
      const raw = pieces[line.billetLengthM];
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        toast.error(
          t("receipts.toastPiecesInvalidForLength", { length: line.billetLengthM }),
        );
        return;
      }
      pieceLines.push({ billetLengthM: line.billetLengthM, expectedPieces: n });
    }
    if (pieceLines.length === 0) {
      toast.error(t("receipts.toastEnterAtLeastOneLength"));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/billet-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierContractNumber: contractNumber,
          driverName: driverName.trim(),
          plateNumber: plateNumber.trim(),
          driverNationalId: driverNationalId.trim() || undefined,
          declaredWeightKg: weight,
          bundleCount: bundleCount ? Number(bundleCount) : undefined,
          notes: notes.trim() || undefined,
          pieceLines,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(t("receipts.toastRegistered", { number: json.data.receiptNumber }));
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("receipts.toastRegisterError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={dir}
        className="max-w-lg max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("receipts.registerTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label>{t("receipts.supplierContractRequired")}</Label>
            {loadingRef ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            ) : (
              <Select
                value={contractNumber}
                onValueChange={(v) => {
                  setContractNumber(v ?? "");
                  setPieces({});
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("receipts.selectContract")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {contracts.length === 0 ? (
                    <SelectItem value="" disabled>
                      {t("receipts.noActiveContracts")}
                    </SelectItem>
                  ) : (
                    contracts.map((c) => (
                      <SelectItem key={c.contractNumber} value={c.contractNumber}>
                        {t("receipts.contractOption", {
                          number: c.contractNumber,
                          supplier: c.supplierName,
                        })}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plateNumber">{t("receipts.plateRequired")}</Label>
              <Input
                id="plateNumber"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder={t("receipts.platePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driverName">{t("receipts.driverRequired")}</Label>
              <Input
                id="driverName"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder={t("receipts.driverPlaceholder")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="driverNationalId">{t("receipts.driverIdOptional")}</Label>
              <Input
                id="driverNationalId"
                value={driverNationalId}
                onChange={(e) => setDriverNationalId(e.target.value)}
                placeholder={t("receipts.driverIdPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="declaredWeight">{t("receipts.declaredWeightRequired")}</Label>
              <Input
                id="declaredWeight"
                type="number"
                min={0}
                step="0.001"
                inputMode="decimal"
                value={declaredWeightKg}
                onChange={(e) => setDeclaredWeightKg(e.target.value)}
                placeholder={t("receipts.declaredWeightPlaceholder")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("receipts.declaredPiecesPerLength")}</Label>
            {!selectedContract ? (
              <p className="text-sm text-muted-foreground">
                {t("receipts.selectContractFirst")}
              </p>
            ) : (
              <div className="space-y-2">
                {selectedContract.pieceLines.map((line) => (
                  <div key={line.billetLengthM} className="flex items-center gap-3">
                    <span className="w-16 text-sm font-medium">
                      {t("lengthMeters", { n: line.billetLengthM })}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      className="flex-1"
                      value={pieces[line.billetLengthM] ?? ""}
                      onChange={(e) =>
                        setPieces((prev) => ({
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
            <Label htmlFor="bundleCount">{t("receipts.bundleCountOptional")}</Label>
            <Input
              id="bundleCount"
              type="number"
              min={1}
              value={bundleCount}
              onChange={(e) => setBundleCount(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{t("notesOptional")}</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || loadingRef}>
              {saving ? t("receipts.registering") : t("receipts.register")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
