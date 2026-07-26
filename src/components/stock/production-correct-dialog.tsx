"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { formatDecimal, formatInteger } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  segmentTrackedUnits,
  type Segment,
  type StockUnit,
} from "./stock-shared";

export interface CorrectableEntry {
  id: number;
  locationId: number;
  locationNameAr: string;
  sizeName: string | null;
  quantity: number;
  unit: StockUnit;
  segment: Segment;
}

interface LocationOption {
  id: number;
  nameAr: string;
  segment: Segment;
}

export function ProductionCorrectDialog({
  entry,
  locations,
  open,
  onOpenChange,
  onCorrected,
}: {
  entry: CorrectableEntry | null;
  locations: LocationOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCorrected: () => void;
}) {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!entry || !open) return;
    setLocationId(String(entry.locationId));
    setQuantity(
      entry.unit === "BUNDLE"
        ? String(Math.round(entry.quantity))
        : String(entry.quantity),
    );
    setReason("");
  }, [entry, open]);

  const locationItems = useMemo(() => {
    if (!entry) return [];
    return locations
      .filter((l) => segmentTrackedUnits(l.segment).includes(entry.unit))
      .map((l) => ({
        value: String(l.id),
        label: l.nameAr,
      }));
  }, [entry, locations]);

  const originalQtyLabel = entry
    ? entry.unit === "BUNDLE"
      ? formatInteger(entry.quantity)
      : formatDecimal(entry.quantity, 3)
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entry) return;

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t("qtyMustBePositive"));
      return;
    }
    if (entry.unit === "BUNDLE" && !Number.isInteger(qty)) {
      toast.error(t("bundlesMustBeInteger"));
      return;
    }
    if (!locationId) {
      toast.error(t("selectStockLocation"));
      return;
    }
    if (reason.trim().length < 5) {
      toast.error(t("adjustReasonMinLength"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/stock/production-correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movementId: entry.id,
          locationId: Number(locationId),
          quantity: qty,
          reason: reason.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t("errorCorrectEntry"));
        return;
      }
      toast.success(t("correctEntrySuccess"));
      onOpenChange(false);
      onCorrected();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("correctEntryTitle")}</DialogTitle>
          <DialogDescription>{t("correctEntryDesc")}</DialogDescription>
        </DialogHeader>

        {entry && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {t("correctEntryOriginal", {
                qty: `${originalQtyLabel} ${tEnums(`stockUnit.${entry.unit}`)}`,
                location: entry.sizeName
                  ? `${entry.locationNameAr} · ${entry.sizeName}`
                  : entry.locationNameAr,
              })}
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="correct-location">{t("locationRequired")}</Label>
              <Select
                value={locationId}
                onValueChange={(v) => setLocationId(v ?? "")}
                items={locationItems}
              >
                <SelectTrigger id="correct-location" className="w-full">
                  <SelectValue placeholder={t("selectStockLocation")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {locationItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correct-qty">
                {entry.unit === "BUNDLE"
                  ? t("bundleCountRequired")
                  : t("quantityTonsRequired")}
              </Label>
              <Input
                id="correct-qty"
                type="number"
                inputMode={entry.unit === "BUNDLE" ? "numeric" : "decimal"}
                step={entry.unit === "BUNDLE" ? "1" : "0.001"}
                min={entry.unit === "BUNDLE" ? "1" : "0.001"}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="tabular-nums"
                dir="ltr"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correct-reason">{t("correctEntryReason")}</Label>
              <Textarea
                id="correct-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("correctEntryReasonPlaceholder")}
                rows={3}
              />
            </div>

            <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                {t("correctEntryCancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("correctEntrySubmit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
