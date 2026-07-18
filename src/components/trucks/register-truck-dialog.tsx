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
import { Trash2, Plus } from "lucide-react";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { sizeCodeSupportsGrade, sizeCodeToKind } from "@/lib/material-kind";
import type { SalesOrderGrade } from "@prisma/client";
import { DestinationSelect } from "@/components/destinations/destination-select";
import { getTextDirection, type Locale } from "@/i18n/config";

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
  /** Grade for this line ("" = none). Same size may repeat once per grade. */
  grade: SalesOrderGrade | "";
  bundleCount: string;
  requestedTons: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const GRADES: SalesOrderGrade[] = ["FIRST", "SECOND"];

let rowKeyCounter = 0;

export function RegisterTruckDialog({ open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations("trucks");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

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
      toast.error(t("errorRefData"));
    } finally {
      setLoadingRef(false);
    }
  }, [t]);

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
      {
        key: ++rowKeyCounter,
        sizeCode: "",
        // New rows inherit the operation-level grade so the common
        // single-grade flow never needs the per-row grade field.
        grade: isRebarLoad ? operationalGrade : "",
        bundleCount: "",
        requestedTons: "",
      },
    ]);
  };

  const removeRequestItem = (key: number) => {
    setRequestItems((prev) => prev.filter((r) => r.key !== key));
  };

  const updateRequestItem = (
    key: number,
    field: "sizeCode" | "grade" | "bundleCount" | "requestedTons",
    value: string,
  ) => {
    setRequestItems((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (field === "sizeCode") {
          const kind = value ? sizeCodeToKind(value) : null;
          const grade =
            kind != null && kind !== "REBAR"
              ? ""
              : kind === "REBAR"
                ? r.grade || operationalGrade || ""
                : r.grade;
          return {
            ...r,
            sizeCode: value,
            bundleCount: "",
            requestedTons: "",
            grade,
          };
        }
        return { ...r, [field]: value };
      }),
    );
  };

  // Uniqueness is per (size, grade): "12mm FIRST" and "12mm SECOND" may
  // coexist on the same request.
  const usedSizeGradeKeys = new Set(
    requestItems
      .filter((r) => r.sizeCode)
      .map((r) => `${r.sizeCode}:${r.grade}`),
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
      toast.error(t("toastSelectCustomer"));
      return;
    }
    if (!plateNumber.trim() || !driverName.trim()) {
      toast.error(t("toastPlateDriverRequired"));
      return;
    }

    const items: {
      sizeId: number;
      grade: SalesOrderGrade | null;
      bundleCount: number | null;
      requestedTons: number | null;
    }[] = [];
    const seenKeys = new Set<string>();
    for (const r of requestItems.filter((x) => x.sizeCode)) {
      const sz = sizes.find((s) => s.code === r.sizeCode);
      if (!sz) {
        toast.error(t("toastInvalidSize"));
        return;
      }
      const grade =
        isRebarLoad && r.grade && sizeCodeSupportsGrade(r.sizeCode) ? r.grade : null;
      const dupKey = `${sz.id}:${grade ?? ""}`;
      if (seenKeys.has(dupKey)) {
        toast.error(t("toastDuplicateSizeGrade"));
        return;
      }
      seenKeys.add(dupKey);
      const bundleCount = r.bundleCount ? Number(r.bundleCount) : null;
      const requestedTons = r.requestedTons ? Number(r.requestedTons) : null;
      if (sz.isBundleType) {
        if (bundleCount === null || bundleCount < 1) {
          toast.error(t("toastBundlesRequired"));
          return;
        }
      } else if (requestedTons === null || requestedTons <= 0) {
        toast.error(t("toastTonsRequired"));
        return;
      }
      items.push({
        sizeId: sz.id,
        grade,
        bundleCount: sz.isBundleType ? bundleCount : null,
        requestedTons: sz.isBundleType ? null : requestedTons,
      });
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
      toast.success(t("registerSuccess"));
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorRegister"));
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
          <DialogTitle>{t("registerTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
          {/* Customer */}
          <div className="space-y-2">
            <Label>{t("customerRequired")}</Label>
            {loadingRef ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            ) : (
              <Select
                items={customerSelectItems}
                value={customerId}
                onValueChange={(v) => setCustomerId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectCustomer")} />
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
            <Label>{t("destinationOptional")}</Label>
            <DestinationSelect
              value={destinationId}
              onValueChange={setDestinationId}
              disabled={saving}
            />
          </div>

          {/* Load type — UI-only toggle to show/hide grade */}
          <div className="space-y-2">
            <Label>{t("loadTypeOptional")}</Label>
            <Select
              value={isRebarLoad ? "REBAR" : "OTHER"}
              onValueChange={(v) => {
                const rebar = v === "REBAR";
                setIsRebarLoad(rebar);
                // Clear grades immediately when kind changes away from REBAR
                // so no stale value survives in the payload — including the
                // per-row grades on request items.
                if (!rebar) {
                  setOperationalGrade("");
                  setRequestItems((prev) => prev.map((r) => ({ ...r, grade: "" })));
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("selectLoadType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OTHER">{t("loadTypeOther")}</SelectItem>
                <SelectItem value="REBAR">{t("loadTypeRebar")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Grade — visible only when load type is REBAR */}
          {isRebarLoad && (
            <div className="space-y-2">
              <Label>{t("gradeOptional")}</Label>
              <Select
                value={operationalGrade}
                onValueChange={(v) =>
                  setOperationalGrade((v as SalesOrderGrade | "") ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectGrade")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("noGrade")}</SelectItem>
                  {GRADES.map((key) => (
                    <SelectItem key={key} value={key}>
                      {tEnums(`grade.${key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Plate + Driver */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plateNumber">{t("plateRequired")}</Label>
              <Input
                id="plateNumber"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder={t("platePlaceholder")}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driverName">{t("driverRequired")}</Label>
              <Input
                id="driverName"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder={t("driverPlaceholder")}
              />
            </div>
          </div>

          {/* Request Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("requestItems")}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRequestItem}
                disabled={loadingRef}
              >
                <Plus className="h-4 w-4 me-1" />
                {t("addSize")}
              </Button>
            </div>

            {requestItems.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("requestItemsEmpty")}
              </p>
            )}

            <div className="min-w-0 space-y-2">
              {requestItems.map((row) => {
                const selectedSize = sizes.find((s) => s.code === row.sizeCode);
                return (
                  <div
                    key={row.key}
                    className="min-w-0 space-y-2 rounded-md border p-2"
                  >
                    <Select
                      value={row.sizeCode}
                      onValueChange={(v) =>
                        updateRequestItem(row.key, "sizeCode", v ?? "")
                      }
                    >
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder={t("size")} />
                      </SelectTrigger>
                      <SelectContent>
                        {sizes
                          .filter(
                            (s) =>
                              s.code === row.sizeCode ||
                              !usedSizeGradeKeys.has(`${s.code}:${row.grade}`),
                          )
                          .map((s) => (
                            <SelectItem key={s.id} value={s.code}>
                              {s.displayName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {isRebarLoad && sizeCodeSupportsGrade(row.sizeCode) && (
                      <Select
                        value={row.grade}
                        onValueChange={(v) =>
                          updateRequestItem(row.key, "grade", v ?? "")
                        }
                      >
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue placeholder={t("grade")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">{t("noGradeShort")}</SelectItem>
                          {GRADES.map((key) => (
                            <SelectItem key={key} value={key}>
                              {tEnums(`grade.${key}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="flex min-w-0 items-center gap-2">
                      {selectedSize?.isBundleType === false ? (
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          className="min-w-0 flex-1"
                          value={row.requestedTons}
                          onChange={(e) =>
                            updateRequestItem(row.key, "requestedTons", e.target.value)
                          }
                          placeholder={t("tons")}
                        />
                      ) : (
                        <Input
                          type="number"
                          min={1}
                          className="min-w-0 flex-1"
                          value={row.bundleCount}
                          onChange={(e) =>
                            updateRequestItem(row.key, "bundleCount", e.target.value)
                          }
                          placeholder={t("bundles")}
                        />
                      )}
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
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes */}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || loadingRef}>
              {saving ? t("registering") : t("register")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
