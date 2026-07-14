"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  SEGMENT_META,
  segmentUnitLabel,
  segmentGradeLabel,
  type Segment,
  type YardOption,
  type SizeOption,
  type StockLocation,
} from "./stock-shared";

interface FormState {
  yardId: string;
  code: string;
  nameAr: string;
  segment: Segment;
  expectedSizeId: string;
  gridRow: string;
  gridCol: string;
  gridSpan: string;
  sortOrder: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  yardId: "",
  code: "",
  nameAr: "",
  segment: "GENERAL",
  expectedSizeId: "",
  gridRow: "1",
  gridCol: "1",
  gridSpan: "1",
  sortOrder: "0",
  notes: "",
  isActive: true,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  yards: YardOption[];
  sizes: SizeOption[];
  editData?: StockLocation | null;
  defaultYardId?: number;
}

export function StockLocationFormDialog({
  open,
  onOpenChange,
  onSuccess,
  yards,
  sizes,
  editData,
  defaultYardId,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const isEdit = !!editData;
  const hasMovements = (editData?.movementCount ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    if (editData) {
      setForm({
        yardId: String(editData.yardId),
        code: editData.code,
        nameAr: editData.nameAr,
        segment: editData.segment,
        expectedSizeId: editData.expectedSize ? String(editData.expectedSize.id) : "",
        gridRow: String(editData.gridRow),
        gridCol: String(editData.gridCol),
        gridSpan: String(editData.gridSpan),
        sortOrder: String(editData.sortOrder),
        notes: editData.notes ?? "",
        isActive: editData.isActive,
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        yardId: defaultYardId ? String(defaultYardId) : yards[0] ? String(yards[0].id) : "",
      });
    }
  }, [open, editData, defaultYardId, yards]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const yardItems = useMemo(
    () => yards.map((y) => ({ value: String(y.id), label: y.nameAr })),
    [yards],
  );
  const segmentItems = useMemo(
    () =>
      (Object.keys(SEGMENT_META) as Segment[]).map((s) => ({
        value: s,
        label: SEGMENT_META[s].label,
      })),
    [],
  );
  const sizeItems = useMemo(
    () => [
      { value: "", label: "بدون" },
      ...sizes.map((s) => ({ value: String(s.id), label: s.displayName })),
    ],
    [sizes],
  );
  const statusItems = useMemo(
    () => [
      { value: "active", label: "نشط" },
      { value: "inactive", label: "موقوف" },
    ],
    [],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const expectedSizeId =
        form.expectedSizeId === "" ? null : Number(form.expectedSizeId);

      let url: string;
      let method: string;
      let body: Record<string, unknown>;

      if (isEdit && editData) {
        url = `/api/stock/locations/${editData.id}`;
        method = "PATCH";
        body = {
          nameAr: form.nameAr,
          segment: form.segment,
          expectedSizeId,
          gridRow: Number(form.gridRow),
          gridCol: Number(form.gridCol),
          gridSpan: Number(form.gridSpan),
          sortOrder: Number(form.sortOrder),
          notes: form.notes,
          isActive: form.isActive,
        };
        // Code is only editable while the location has no movements.
        if (!hasMovements) body.code = form.code;
      } else {
        url = "/api/stock/locations";
        method = "POST";
        body = {
          yardId: Number(form.yardId),
          code: form.code,
          nameAr: form.nameAr,
          segment: form.segment,
          expectedSizeId,
          gridRow: Number(form.gridRow),
          gridCol: Number(form.gridCol),
          gridSpan: Number(form.gridSpan),
          sortOrder: Number(form.sortOrder),
          notes: form.notes,
        };
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || "حدث خطأ");
        return;
      }
      toast.success(isEdit ? "تم تحديث الموقع" : "تمت إضافة الموقع");
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل موقع" : "إضافة موقع"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "الكود يُثبَّت بعد أول حركة؛ الاسم قابل للتعديل دائماً."
              : "أضف موقعاً جديداً للساحة. تُشتق وحدة العدّ والنخب من التصنيف تلقائياً."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>الساحة *</Label>
              <Select
                items={yardItems}
                value={form.yardId}
                onValueChange={(v) => set("yardId", v ?? "")}
                disabled={isEdit}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الساحة" />
                </SelectTrigger>
                <SelectContent>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">الكود *</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                dir="ltr"
                className="text-left"
                disabled={isEdit && hasMovements}
              />
              {isEdit && hasMovements && (
                <p className="text-xs text-muted-foreground">
                  لا يمكن تعديل الكود لوجود حركات على الموقع
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nameAr">الاسم الظاهر *</Label>
            <Input
              id="nameAr"
              value={form.nameAr}
              onChange={(e) => set("nameAr", e.target.value)}
              placeholder="مثال: A5 محافظات"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>التصنيف *</Label>
              <Select
                items={segmentItems}
                value={form.segment}
                onValueChange={(v) => set("segment", (v ?? "GENERAL") as Segment)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SEGMENT_META) as Segment[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SEGMENT_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[10px]">
                  {segmentUnitLabel(form.segment)}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {segmentGradeLabel(form.segment)}
                </Badge>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>المقاس الاسترشادي</Label>
              <Select
                items={sizeItems}
                value={form.expectedSizeId}
                onValueChange={(v) => set("expectedSizeId", v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">بدون</SelectItem>
                  {sizes.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">استرشادي فقط — لا يقيّد الإدخال</p>
            </div>
          </div>

          <div className="grid gap-4 grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="gridRow">الصف</Label>
              <Input
                id="gridRow"
                type="number"
                min={1}
                value={form.gridRow}
                onChange={(e) => set("gridRow", e.target.value)}
                dir="ltr"
                className="text-center"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gridCol">العمود</Label>
              <Input
                id="gridCol"
                type="number"
                min={1}
                value={form.gridCol}
                onChange={(e) => set("gridCol", e.target.value)}
                dir="ltr"
                className="text-center"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gridSpan">الامتداد</Label>
              <Input
                id="gridSpan"
                type="number"
                min={1}
                value={form.gridSpan}
                onChange={(e) => set("gridSpan", e.target.value)}
                dir="ltr"
                className="text-center"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            موضع الموقع على خريطة الساحة (الصف/العمود على الشبكة). الامتداد لعرض
            مناطق أوسع كالقصائر.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sortOrder">ترتيب العرض</Label>
              <Input
                id="sortOrder"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
                dir="ltr"
                className="text-center"
              />
            </div>
            {isEdit && (
              <div className="space-y-1.5">
                <Label>الحالة</Label>
                <Select
                  items={statusItems}
                  value={form.isActive ? "active" : "inactive"}
                  onValueChange={(v) => set("isActive", v === "active")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="inactive">موقوف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading || !form.code || !form.nameAr || !form.yardId}>
              {loading && <Loader2 className="animate-spin" />}
              {isEdit ? "حفظ التعديلات" : "إضافة الموقع"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
