"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DestinationSelect } from "@/components/destinations/destination-select";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { GRADE_LABELS } from "@/lib/truck-grade";
import { Plus, Trash2 } from "lucide-react";
import type { SalesOrderGrade } from "@prisma/client";

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
  sizeCode: string;
  bundleCount: string;
  requestedTons: string;
}

export interface EditableTruck {
  id: number;
  status: string;
  version: number;
  customerId: number | null;
  destinationId: number | null;
  plateNumber: string;
  driverName: string;
  salesOrderNumber: string | null;
  notes: string | null;
  operationalGrade: SalesOrderGrade | null;
  requestItems: {
    sizeId: number;
    bundleCount: number | null;
    requestedTons: string | null;
    size: { id: number; code: string; displayName: string; isBundleType: boolean };
  }[];
}

interface Props {
  truck: EditableTruck | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

let rowKeyCounter = 0;

export function EditTruckDialog({ truck, open, onOpenChange, onSuccess }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [requestItems, setRequestItems] = useState<RequestItemRow[]>([]);
  const [isRebarLoad, setIsRebarLoad] = useState(false);
  const [operationalGrade, setOperationalGrade] = useState<SalesOrderGrade | "">("");
  const [saving, setSaving] = useState(false);
  const [loadingRef, setLoadingRef] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);

  const requestItemsOnly = truck?.status === "Approved";
  const canSubmit = truck?.status === "Queued" || truck?.status === "Approved";

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

  useEffect(() => {
    if (!truck || !open) return;
    setCustomerId(truck.customerId ? String(truck.customerId) : "");
    setDestinationId(truck.destinationId);
    setPlateNumber(truck.plateNumber);
    setDriverName(truck.driverName);
    setNotes(truck.notes ?? "");
    setIsRebarLoad(Boolean(truck.operationalGrade));
    setOperationalGrade(truck.operationalGrade ?? "");
    setRequestItems(
      truck.requestItems.map((item) => ({
        key: ++rowKeyCounter,
        sizeCode: item.size.code,
        bundleCount: item.bundleCount ? String(item.bundleCount) : "",
        requestedTons: item.requestedTons ? String(item.requestedTons) : "",
      })),
    );
  }, [truck, open]);

  const customerSelectItems = useMemo(
    () =>
      customers.map((c) => ({
        value: String(c.id),
        label: `${c.fullName} (${c.code})`,
      })),
    [customers],
  );

  const usedSizeCodes = new Set(requestItems.map((r) => r.sizeCode).filter(Boolean));

  const addRequestItem = () => {
    setRequestItems((prev) => [
      ...prev,
      { key: ++rowKeyCounter, sizeCode: "", bundleCount: "", requestedTons: "" },
    ]);
  };

  const removeRequestItem = (key: number) => {
    setRequestItems((prev) => prev.filter((r) => r.key !== key));
  };

  const updateRequestItem = (
    key: number,
    field: "sizeCode" | "bundleCount" | "requestedTons",
    value: string,
  ) => {
    setRequestItems((prev) =>
      prev.map((row) =>
        row.key === key
          ? {
              ...row,
              [field]: value,
              ...(field === "sizeCode" ? { bundleCount: "", requestedTons: "" } : {}),
            }
          : row,
      ),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!truck) return;

    if (!requestItemsOnly && (!customerId || !plateNumber.trim() || !driverName.trim())) {
      toast.error("الزبون ورقم اللوحة واسم السائق مطلوبة");
      return;
    }

    const items: {
      sizeId: number;
      bundleCount: number | null;
      requestedTons: number | null;
    }[] = [];
    for (const row of requestItems.filter((x) => x.sizeCode)) {
      const size = sizes.find((s) => s.code === row.sizeCode);
      if (!size) {
        toast.error("قياس غير صالح، أعد تحميل الصفحة والمحاولة");
        return;
      }
      const bundleCount = row.bundleCount ? Number(row.bundleCount) : null;
      const requestedTons = row.requestedTons ? Number(row.requestedTons) : null;
      if (size.isBundleType) {
        if (bundleCount === null || bundleCount < 1) {
          toast.error("عدد الربطات مطلوب ويجب أن يكون 1 على الأقل");
          return;
        }
      } else if (requestedTons === null || requestedTons <= 0) {
        toast.error("الوزن بالطن مطلوب ويجب أن يكون أكبر من صفر");
        return;
      }
      items.push({
        sizeId: size.id,
        bundleCount: size.isBundleType ? bundleCount : null,
        requestedTons: size.isBundleType ? null : requestedTons,
      });
    }

    setSaving(true);
    try {
      const payload = requestItemsOnly
        ? {
            expectedVersion: truck.version,
            requestItems: items,
          }
        : {
            expectedVersion: truck.version,
            customerId: Number(customerId),
            destinationId,
            plateNumber: plateNumber.trim(),
            driverName: driverName.trim(),
            notes: notes.trim() || undefined,
            operationalGrade: isRebarLoad && operationalGrade ? operationalGrade : null,
            requestItems: items,
          };

      const res = await fetch(`/api/trucks/${truck.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تم تعديل الشاحنة بنجاح");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطأ في تعديل الشاحنة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل الشاحنة #{truck?.id}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {requestItemsOnly && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              الشاحنة معتمدة، لذلك يمكن تعديل تفاصيل الطلبية فقط قبل بدء الوزن.
            </p>
          )}

          <div className="space-y-2">
            <Label>الزبون *</Label>
            {loadingRef ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            ) : (
              <Select
                items={customerSelectItems}
                value={customerId}
                onValueChange={(v) => setCustomerId(v ?? "")}
                disabled={requestItemsOnly || saving}
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

          <div className="space-y-2">
            <Label>الوجهة (اختياري)</Label>
            <DestinationSelect
              value={destinationId}
              onValueChange={setDestinationId}
              disabled={requestItemsOnly || saving}
            />
          </div>

          <div className="space-y-2">
            <Label>نوع الحمل (اختياري)</Label>
            <Select
              value={isRebarLoad ? "REBAR" : "OTHER"}
              onValueChange={(v) => {
                const rebar = v === "REBAR";
                setIsRebarLoad(rebar);
                if (!rebar) setOperationalGrade("");
              }}
              disabled={requestItemsOnly || saving}
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

          {isRebarLoad && (
            <div className="space-y-2">
              <Label>النخب (اختياري)</Label>
              <Select
                value={operationalGrade}
                onValueChange={(v) =>
                  setOperationalGrade((v as SalesOrderGrade | "") ?? "")
                }
                disabled={requestItemsOnly || saving}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="editPlateNumber">رقم اللوحة *</Label>
              <Input
                id="editPlateNumber"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                disabled={requestItemsOnly || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editDriverName">اسم السائق *</Label>
              <Input
                id="editDriverName"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                disabled={requestItemsOnly || saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>تفاصيل الطلبية</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRequestItem}
                disabled={loadingRef || saving}
              >
                <Plus className="h-4 w-4 ml-1" />
                إضافة قياس
              </Button>
            </div>

            <div className="space-y-2">
              {requestItems.map((row) => {
                const selectedSize = sizes.find((s) => s.code === row.sizeCode);
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_auto]"
                  >
                    <Select
                      value={row.sizeCode}
                      onValueChange={(v) =>
                        updateRequestItem(row.key, "sizeCode", v ?? "")
                      }
                      disabled={saving}
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
                    {selectedSize?.isBundleType === false ? (
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={row.requestedTons}
                        onChange={(e) =>
                          updateRequestItem(row.key, "requestedTons", e.target.value)
                        }
                        placeholder="طن"
                        disabled={saving}
                      />
                    ) : (
                      <Input
                        type="number"
                        min={1}
                        value={row.bundleCount}
                        onChange={(e) =>
                          updateRequestItem(row.key, "bundleCount", e.target.value)
                        }
                        placeholder="ربطات"
                        disabled={saving}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => removeRequestItem(row.key)}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="editNotes">ملاحظات (اختياري)</Label>
            <Textarea
              id="editNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={requestItemsOnly || saving}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={!canSubmit || saving || loadingRef}>
              {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
