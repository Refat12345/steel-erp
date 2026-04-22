"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Trash2, Plus } from "lucide-react";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";

interface Customer {
  id: number;
  code: string;
  fullName: string;
}

interface SizeOption {
  id: number;
  code: string;
  displayName: string;
  isBundleType: boolean;
}

interface RequestItemRow {
  key: number;
  sizeId: string;
  bundleCount: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

let rowKeyCounter = 0;

export function RegisterTruckDialog({ open, onOpenChange, onSuccess }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [requestItems, setRequestItems] = useState<RequestItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);

  const fetchReferenceData = useCallback(async () => {
    setLoadingRef(true);
    try {
      const [custRes, sizeRes] = await Promise.all([
        fetch("/api/customers?active=true&limit=500"),
        fetch("/api/sizes"),
      ]);
      const custJson = await custRes.json();
      const sizeJson = await sizeRes.json();
      if (custJson.success) setCustomers(custJson.data || []);
      if (sizeJson.success) setSizes(sizeJson.data || []);
    } catch {
      toast.error("خطأ في تحميل البيانات المرجعية");
    } finally {
      setLoadingRef(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchReferenceData();
  }, [open, fetchReferenceData]);

  const reset = () => {
    setCustomerId("");
    setPlateNumber("");
    setDriverName("");
    setNotes("");
    setRequestItems([]);
  };

  const addRequestItem = () => {
    setRequestItems((prev) => [
      ...prev,
      { key: ++rowKeyCounter, sizeId: "", bundleCount: "" },
    ]);
  };

  const removeRequestItem = (key: number) => {
    setRequestItems((prev) => prev.filter((r) => r.key !== key));
  };

  const updateRequestItem = (
    key: number,
    field: "sizeId" | "bundleCount",
    value: string,
  ) => {
    setRequestItems((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const usedSizeIds = new Set(requestItems.map((r) => r.sizeId).filter(Boolean));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerId) {
      toast.error("يرجى اختيار الزبون");
      return;
    }
    if (!plateNumber.trim() || !driverName.trim()) {
      toast.error("رقم اللوحة واسم السائق مطلوبان");
      return;
    }

    const items = requestItems
      .filter((r) => r.sizeId)
      .map((r) => ({
        sizeId: Number(r.sizeId),
        bundleCount: r.bundleCount ? Number(r.bundleCount) : null,
      }));

    for (const item of items) {
      if (item.bundleCount !== null && item.bundleCount < 1) {
        toast.error("عدد الربطات يجب أن يكون 1 على الأقل");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/trucks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify({
          customerId: Number(customerId),
          plateNumber: plateNumber.trim(),
          driverName: driverName.trim(),
          notes: notes.trim() || undefined,
          requestItems: items.length > 0 ? items : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تم تسجيل الشاحنة بنجاح");
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل شاحنة جديدة</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer */}
          <div className="space-y-2">
            <Label>الزبون *</Label>
            {loadingRef ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            ) : (
              <Select
                value={customerId}
                onValueChange={(v) => setCustomerId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الزبون" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.fullName} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Plate + Driver */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plateNumber">رقم اللوحة *</Label>
              <Input
                id="plateNumber"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="مثال: دمشق 123456"
                autoFocus
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

          {/* Request Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>تفاصيل الطلبية</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRequestItem}
                disabled={loadingRef}
              >
                <Plus className="h-4 w-4 ml-1" />
                إضافة قياس
              </Button>
            </div>

            {requestItems.length === 0 && (
              <p className="text-sm text-muted-foreground">
                لم يتم إضافة تفاصيل للطلبية بعد (اختياري)
              </p>
            )}

            <div className="space-y-2">
              {requestItems.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <div className="flex-1 min-w-0">
                    <Select
                      value={row.sizeId}
                      onValueChange={(v) =>
                        updateRequestItem(row.key, "sizeId", v ?? "")
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="القياس" />
                      </SelectTrigger>
                      <SelectContent>
                        {sizes
                          .filter(
                            (s) =>
                              String(s.id) === row.sizeId ||
                              !usedSizeIds.has(String(s.id)),
                          )
                          .map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.displayName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      value={row.bundleCount}
                      onChange={(e) =>
                        updateRequestItem(row.key, "bundleCount", e.target.value)
                      }
                      placeholder="ربطات"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive"
                    onClick={() => removeRequestItem(row.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
