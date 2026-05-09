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
import { Trash2, Plus } from "lucide-react";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { GRADE_LABELS } from "@/lib/truck-grade";
import type { SalesOrderGrade } from "@prisma/client";
import { DestinationSelect } from "@/components/destinations/destination-select";

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
  /** Size catalog `code` (e.g. "8mm"); maps to numeric id only when submitting. */
  sizeCode: string;
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
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [requestItems, setRequestItems] = useState<RequestItemRow[]>([]);
  const [saving, setSaving] = useState(false);
  // UI-only: controls grade field visibility. Not persisted to DB.
  const [isRebarLoad, setIsRebarLoad] = useState(false);
  const [operationalGrade, setOperationalGrade] = useState<SalesOrderGrade | "">("");

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
    setDestinationId(null);
    setPlateNumber("");
    setDriverName("");
    setNotes("");
    setRequestItems([]);
    setIsRebarLoad(false);
    setOperationalGrade("");
  };

  const addRequestItem = () => {
    setRequestItems((prev) => [
      ...prev,
      { key: ++rowKeyCounter, sizeCode: "", bundleCount: "" },
    ]);
  };

  const removeRequestItem = (key: number) => {
    setRequestItems((prev) => prev.filter((r) => r.key !== key));
  };

  const updateRequestItem = (
    key: number,
    field: "sizeCode" | "bundleCount",
    value: string,
  ) => {
    setRequestItems((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const usedSizeCodes = new Set(
    requestItems.map((r) => r.sizeCode).filter(Boolean),
  );

  /** Lets Select.Value show the customer name; Base UI renders raw `value` without `items`. */
  const customerSelectItems = useMemo(
    () =>
      customers.map((c) => ({
        value: String(c.id),
        label: `${c.fullName} (${c.code})`,
      })),
    [customers],
  );

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

    const items: { sizeId: number; bundleCount: number | null }[] = [];
    for (const r of requestItems.filter((x) => x.sizeCode)) {
      const sz = sizes.find((s) => s.code === r.sizeCode);
      if (!sz) {
        toast.error("قياس غير صالح، أعد تحميل الصفحة والمحاولة");
        return;
      }
      items.push({
        sizeId: sz.id,
        bundleCount: r.bundleCount ? Number(r.bundleCount) : null,
      });
    }

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
          destinationId,
          plateNumber: plateNumber.trim(),
          driverName: driverName.trim(),
          notes: notes.trim() || undefined,
          requestItems: items.length > 0 ? items : undefined,
          // Only send grade when load type is explicitly REBAR and a grade is chosen.
          // Clears automatically when isRebarLoad is false (no stale value sent).
          operationalGrade: isRebarLoad && operationalGrade ? operationalGrade : undefined,
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
                items={customerSelectItems}
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

          {/* Destination */}
          <div className="space-y-2">
            <Label>الوجهة (اختياري)</Label>
            <DestinationSelect
              value={destinationId}
              onValueChange={setDestinationId}
              disabled={saving}
            />
          </div>

          {/* Load type — UI-only toggle to show/hide grade */}
          <div className="space-y-2">
            <Label>نوع الحمل (اختياري)</Label>
            <Select
              value={isRebarLoad ? "REBAR" : "OTHER"}
              onValueChange={(v) => {
                const rebar = v === "REBAR";
                setIsRebarLoad(rebar);
                // Clear grade immediately when kind changes away from REBAR
                // so no stale value survives in the payload.
                if (!rebar) setOperationalGrade("");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختر نوع الحمل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OTHER">غير مبروم</SelectItem>
                <SelectItem value="REBAR">مبروم</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Grade — visible only when load type is REBAR */}
          {isRebarLoad && (
            <div className="space-y-2">
              <Label>النخب (اختياري)</Label>
              <Select
                value={operationalGrade}
                onValueChange={(v) =>
                  setOperationalGrade((v as SalesOrderGrade | "") ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر النخب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">لا يوجد</SelectItem>
                  {(Object.entries(GRADE_LABELS) as [SalesOrderGrade, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

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
                      value={row.sizeCode}
                      onValueChange={(v) =>
                        updateRequestItem(row.key, "sizeCode", v ?? "")
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="القياس" />
                      </SelectTrigger>
                      <SelectContent>
                        {sizes
                          .filter(
                            (s) =>
                              s.code === row.sizeCode ||
                              !usedSizeCodes.has(s.code),
                          )
                          .map((s) => (
                            <SelectItem key={s.id} value={s.code}>
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
