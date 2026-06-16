"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);
  const [contractNumber, setContractNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [driverNationalId, setDriverNationalId] = useState("");
  const [declaredWeightKg, setDeclaredWeightKg] = useState("");
  const [bundleCount, setBundleCount] = useState("");
  const [notes, setNotes] = useState("");
  // length -> entered expected pieces (string)
  const [pieces, setPieces] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const fetchContracts = useCallback(async () => {
    setLoadingRef(true);
    try {
      const res = await fetch("/api/billet-contracts?status=Active&pageSize=100");
      const json = await res.json();
      if (json.success) setContracts(json.data || []);
    } catch {
      toast.error("خطأ في تحميل عقود الموردين");
    } finally {
      setLoadingRef(false);
    }
  }, []);

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
      toast.error("يرجى اختيار عقد المورّد");
      return;
    }
    if (!driverName.trim() || !plateNumber.trim()) {
      toast.error("اسم السائق ورقم اللوحة مطلوبان");
      return;
    }
    const weight = Number(declaredWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error("وزن الطلبية المعلن يجب أن يكون أكبر من صفر");
      return;
    }

    const pieceLines: { billetLengthM: number; expectedPieces: number }[] = [];
    for (const line of selectedContract?.pieceLines ?? []) {
      const raw = pieces[line.billetLengthM];
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        toast.error(`عدد القطع للطول ${line.billetLengthM}م غير صالح`);
        return;
      }
      pieceLines.push({ billetLengthM: line.billetLengthM, expectedPieces: n });
    }
    if (pieceLines.length === 0) {
      toast.error("أدخل عدد القطع المعلن لطول واحد على الأقل");
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
      toast.success(`تم تسجيل الاستلام ${json.data.receiptNumber}`);
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في التسجيل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل استلام بيلت</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
          {/* Contract */}
          <div className="space-y-2">
            <Label>عقد المورّد *</Label>
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
                  <SelectValue placeholder="اختر العقد" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.length === 0 ? (
                    <SelectItem value="" disabled>
                      لا توجد عقود فعّالة
                    </SelectItem>
                  ) : (
                    contracts.map((c) => (
                      <SelectItem key={c.contractNumber} value={c.contractNumber}>
                        {c.contractNumber} — {c.supplierName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Driver + Plate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plateNumber">رقم اللوحة *</Label>
              <Input
                id="plateNumber"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="مثال: دمشق 123456"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driverName">اسم السائق *</Label>
              <Input
                id="driverName"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="الاسم الكامل"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="driverNationalId">رقم السائق (اختياري)</Label>
              <Input
                id="driverNationalId"
                value={driverNationalId}
                onChange={(e) => setDriverNationalId(e.target.value)}
                placeholder="رقم الهوية / الهاتف"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="declaredWeight">وزن الطلبية المعلن (كغ) *</Label>
              <Input
                id="declaredWeight"
                type="number"
                min={0}
                step="0.001"
                inputMode="decimal"
                value={declaredWeightKg}
                onChange={(e) => setDeclaredWeightKg(e.target.value)}
                placeholder="من ارسالية المورّد"
              />
            </div>
          </div>

          {/* Declared pieces per contract length */}
          <div className="space-y-2">
            <Label>عدد القطع المعلن لكل طول *</Label>
            {!selectedContract ? (
              <p className="text-sm text-muted-foreground">اختر العقد أولاً لعرض الأطوال</p>
            ) : (
              <div className="space-y-2">
                {selectedContract.pieceLines.map((line) => (
                  <div key={line.billetLengthM} className="flex items-center gap-3">
                    <span className="w-16 text-sm font-medium">{line.billetLengthM}م</span>
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
                      placeholder="عدد القطع"
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  اترك الطول غير الموجود على هذه الشاحنة فارغاً.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bundleCount">عدد الربطات (اختياري)</Label>
            <Input
              id="bundleCount"
              type="number"
              min={1}
              value={bundleCount}
              onChange={(e) => setBundleCount(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={saving || loadingRef}>
              {saving ? "جاري التسجيل..." : "تسجيل"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
