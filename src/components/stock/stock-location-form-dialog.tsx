"use client";

import { useState, useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  classificationIdFromSelect,
  classificationSelectValue,
  NO_CLASSIFICATION_SELECT_VALUE,
} from "@/lib/steel-classification-default";
import {
  SEGMENT_ORDER,
  segmentHoldsSteelClassification,
  type Segment,
  type YardOption,
  type SizeOption,
  type StockLocation,
  type LocationClassificationRef,
} from "./stock-shared";

interface FormState {
  yardId: string;
  code: string;
  nameAr: string;
  segment: Segment;
  expectedSizeId: string;
  expectedClassificationId: string;
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
  expectedClassificationId: "",
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
  classifications: LocationClassificationRef[];
  editData?: StockLocation | null;
  defaultYardId?: number;
}

function segmentUnitKey(segment: Segment): "segmentUnitByTons" | "segmentUnitByBundles" {
  return segment === "SHORTBAR" ? "segmentUnitByTons" : "segmentUnitByBundles";
}

export function StockLocationFormDialog({
  open,
  onOpenChange,
  onSuccess,
  yards,
  sizes,
  classifications,
  editData,
  defaultYardId,
}: Props) {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

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
        expectedClassificationId: editData.expectedClassification
          ? String(editData.expectedClassification.id)
          : "",
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

  function segmentGradeLabel(segment: Segment): string {
    if (segment === "SHORTBAR") return t("noGrade");
    if (segment === "ISOLATION") return tEnums("grade.SECOND");
    return tEnums("grade.FIRST");
  }

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const yardItems = useMemo(
    () => yards.map((y) => ({ value: String(y.id), label: y.nameAr })),
    [yards],
  );
  const segmentItems = useMemo(
    () =>
      SEGMENT_ORDER.map((s) => ({
        value: s,
        label: tEnums(`stockSegment.${s}`),
      })),
    [tEnums],
  );
  const sizeItems = useMemo(
    () => [
      { value: "", label: t("none") },
      ...sizes.map((s) => ({ value: String(s.id), label: s.displayName })),
    ],
    [sizes, t],
  );
  const classificationItems = useMemo(
    () => [
      { value: NO_CLASSIFICATION_SELECT_VALUE, label: t("noClassification") },
      ...classifications.map((c) => ({ value: String(c.id), label: c.displayName })),
    ],
    [classifications, t],
  );
  const showClassification = segmentHoldsSteelClassification(form.segment);
  const statusItems = useMemo(
    () => [
      { value: "active", label: t("statusActive") },
      { value: "inactive", label: t("statusInactive") },
    ],
    [t],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const expectedSizeId =
        form.expectedSizeId === "" ? null : Number(form.expectedSizeId);
      const expectedClassificationId = showClassification
        ? form.expectedClassificationId
          ? Number(form.expectedClassificationId)
          : null
        : null;

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
          expectedClassificationId,
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
          expectedClassificationId,
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
        toast.error(json.error || t("errorGeneric"));
        return;
      }
      toast.success(isEdit ? t("locationUpdated") : t("locationCreated"));
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("editLocationTitle") : t("addLocationTitle")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("editLocationDesc") : t("addLocationDesc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("yardRequired")}</Label>
              <Select
                items={yardItems}
                value={form.yardId}
                onValueChange={(v) => set("yardId", v ?? "")}
                disabled={isEdit}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectYard")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">{t("codeRequired")}</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                dir="ltr"
                className="text-start"
                disabled={isEdit && hasMovements}
              />
              {isEdit && hasMovements && (
                <p className="text-xs text-muted-foreground">{t("codeLockedHint")}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nameAr">{t("displayNameRequired")}</Label>
            <Input
              id="nameAr"
              value={form.nameAr}
              onChange={(e) => set("nameAr", e.target.value)}
              placeholder={t("displayNamePlaceholder")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("segmentRequired")}</Label>
              <Select
                items={segmentItems}
                value={form.segment}
                onValueChange={(v) => {
                  const next = (v ?? "GENERAL") as Segment;
                  setForm((prev) => ({
                    ...prev,
                    segment: next,
                    expectedClassificationId: segmentHoldsSteelClassification(next)
                      ? prev.expectedClassificationId
                      : "",
                  }));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {SEGMENT_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tEnums(`stockSegment.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[10px]">
                  {t(segmentUnitKey(form.segment))}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {segmentGradeLabel(form.segment)}
                </Badge>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("indicativeSize")}</Label>
              <Select
                items={sizeItems}
                value={form.expectedSizeId}
                onValueChange={(v) => set("expectedSizeId", v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("none")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  <SelectItem value="">{t("none")}</SelectItem>
                  {sizes.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("indicativeSizeHint")}</p>
            </div>
          </div>

          {showClassification && (
            <div className="space-y-1.5">
              <Label>{t("expectedClassification")}</Label>
              <Select
                items={classificationItems}
                value={classificationSelectValue(form.expectedClassificationId)}
                onValueChange={(v) =>
                  set("expectedClassificationId", classificationIdFromSelect(v))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("noClassification")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  <SelectItem value={NO_CLASSIFICATION_SELECT_VALUE}>
                    {t("noClassification")}
                  </SelectItem>
                  {classifications.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("expectedClassificationHint")}
              </p>
            </div>
          )}

          <div className="grid gap-4 grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="gridRow">{t("gridRow")}</Label>
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
              <Label htmlFor="gridCol">{t("gridCol")}</Label>
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
              <Label htmlFor="gridSpan">{t("gridSpan")}</Label>
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
          <p className="-mt-2 text-xs text-muted-foreground">{t("gridHint")}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sortOrder">{t("sortOrder")}</Label>
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
                <Label>{t("status")}</Label>
                <Select
                  items={statusItems}
                  value={form.isActive ? "active" : "inactive"}
                  onValueChange={(v) => set("isActive", v === "active")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
                    <SelectItem value="active">{t("statusActive")}</SelectItem>
                    <SelectItem value="inactive">{t("statusInactive")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">{t("notes")}</Label>
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
              {isEdit ? t("saveChanges") : t("addLocationSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
