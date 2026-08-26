"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { sessionHasPermission } from "@/lib/client-permissions";
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
import { sizeCodeSupportsGrade, sizeCodeToKind } from "@/lib/material-kind";
import {
  classificationIdFromSelect,
  classificationSelectValue,
  defaultClassificationId,
  isSizeSelectableOnRequestLine,
  NO_CLASSIFICATION_SELECT_VALUE,
  offeredClassificationSelectIds,
  offeredSteelClassifications,
  resolveClassificationId,
  unusedClassificationId,
  usedClassificationIdsForSizeGrade,
} from "@/lib/steel-classification-default";
import {
  isRequestItemsEditableDuringLoading,
  isRequestItemsOnlyEdit,
  notesForPatch,
  operationalGradeIfChanged,
} from "@/lib/truck-edit-ui";
import { Plus, Trash2 } from "lucide-react";
import type { SalesOrderGrade } from "@prisma/client";
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

interface ClassificationOption {
  id: number;
  code: string;
  displayName: string;
  grade: SalesOrderGrade;
}

interface RequestItemRow {
  key: number;
  sizeCode: string;
  /** Grade for this line ("" = none). Same size may repeat once per grade. */
  grade: SalesOrderGrade | "";
  /** Technical classification id as string ("" = none). */
  classificationId: string;
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
    grade: SalesOrderGrade | null;
    classificationId: number | null;
    bundleCount: number | null;
    requestedTons: string | null;
    size: { id: number; code: string; displayName: string; isBundleType: boolean };
  }[];
}

const EDITABLE_STATUSES = [
  "Queued",
  "Approved",
  "FirstWeigh",
  "OnScale",
  "Loading",
  "LoadingComplete",
  "SecondWeigh",
] as const;
const GRADES: SalesOrderGrade[] = ["FIRST", "SECOND"];

interface Props {
  truckId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

let rowKeyCounter = 0;

function populateFormFromTruck(
  truck: EditableTruck,
  setters: {
    setCustomerId: (v: string) => void;
    setDestinationId: (v: number | null) => void;
    setPlateNumber: (v: string) => void;
    setDriverName: (v: string) => void;
    setNotes: (v: string) => void;
    setIsRebarLoad: (v: boolean) => void;
    setOperationalGrade: (v: SalesOrderGrade | "") => void;
    setRequestItems: (v: RequestItemRow[]) => void;
  },
) {
  setters.setCustomerId(truck.customerId ? String(truck.customerId) : "");
  setters.setDestinationId(truck.destinationId);
  setters.setPlateNumber(truck.plateNumber);
  setters.setDriverName(truck.driverName);
  setters.setNotes(truck.notes ?? "");
  setters.setIsRebarLoad(Boolean(truck.operationalGrade));
  setters.setOperationalGrade(truck.operationalGrade ?? "");
  setters.setRequestItems(
    truck.requestItems.map((item) => ({
      key: ++rowKeyCounter,
      sizeCode: item.size.code,
      grade: item.grade ?? "",
      classificationId: item.classificationId ? String(item.classificationId) : "",
      bundleCount: item.bundleCount ? String(item.bundleCount) : "",
      requestedTons: item.requestedTons ? String(item.requestedTons) : "",
    })),
  );
}

export function EditTruckDialog({ truckId, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations("trucks");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const { data: session } = useSession();
  const canEditQueued = sessionHasPermission(session, "truck.edit_queued");
  const canEditApproved = sessionHasPermission(session, "truck.edit_approved");
  const canEditRequestItems = sessionHasPermission(
    session,
    "truck.edit_request_items",
  );

  const [truck, setTruck] = useState<EditableTruck | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
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
  const [classifications, setClassifications] = useState<ClassificationOption[]>([]);
  const [sessionCount, setSessionCount] = useState(0);

  const requestItemsOnly = truck
    ? isRequestItemsOnlyEdit(truck.status, sessionCount, canEditApproved)
    : false;
  const editAfterTare =
    truck?.status === "FirstWeigh" && sessionCount === 0 && canEditApproved;
  const lockIdentityFields = requestItemsOnly || editAfterTare;
  const canMutateRequestItems =
    (truck?.status === "Queued" && canEditQueued) || canEditRequestItems;
  const canSubmit =
    !!truck &&
    EDITABLE_STATUSES.includes(truck.status as (typeof EDITABLE_STATUSES)[number]) &&
    (requestItemsOnly ? canEditRequestItems : editAfterTare ? canEditApproved : canEditQueued);

  const fetchReferenceData = useCallback(async () => {
    setLoadingRef(true);
    try {
      const [custRes, sizeRes, classRes] = await Promise.all([
        fetch("/api/customers?active=true&limit=500"),
        fetch("/api/sizes"),
        fetch("/api/steel-classifications"),
      ]);
      const custJson = await custRes.json();
      const sizeJson = await sizeRes.json();
      const classJson = await classRes.json();
      if (custJson.success) setCustomers(custJson.data || []);
      if (sizeJson.success) setSizes(sizeJson.data || []);
      if (classJson.success) setClassifications(offeredSteelClassifications(classJson.data || []));
    } catch {
      toast.error(t("errorRefData"));
    } finally {
      setLoadingRef(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) fetchReferenceData();
  }, [open, fetchReferenceData]);

  useEffect(() => {
    if (classifications.length === 0) return;
    const allowed = new Set(classifications.map((c) => String(c.id)));
    setRequestItems((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.classificationId && !allowed.has(row.classificationId)) {
          changed = true;
          return { ...row, classificationId: "" };
        }
        return row;
      });
      return changed ? next : prev;
    });
  }, [classifications]);

  useEffect(() => {
    if (!open || truckId == null) {
      setTruck(null);
      setSessionCount(0);
      return;
    }

    let cancelled = false;

    const loadTruck = async () => {
      setLoadingDetail(true);
      setTruck(null);
      try {
        const res = await fetch(`/api/trucks/${truckId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || t("errorLoadTruck"));

        const data = json.data as EditableTruck & { sessions?: unknown[] };

        if (!EDITABLE_STATUSES.includes(data.status as (typeof EDITABLE_STATUSES)[number])) {
          toast.error(t("errorNotEditableStatus"));
          onOpenChange(false);
          return;
        }

        const loadedSessionCount = data.sessions?.length ?? 0;
        const mayEditThisTruck =
          (data.status === "Queued" && canEditQueued) ||
          (data.status === "Approved" && canEditRequestItems) ||
          (data.status === "FirstWeigh" &&
            (loadedSessionCount === 0
              ? canEditApproved || canEditRequestItems
              : canEditRequestItems)) ||
          (isRequestItemsEditableDuringLoading(data.status) && canEditRequestItems);
        if (!mayEditThisTruck) {
          toast.error(t("errorNotEditableStatus"));
          onOpenChange(false);
          return;
        }

        setSessionCount(loadedSessionCount);

        const editable: EditableTruck = {
          id: data.id,
          status: data.status,
          version: data.version,
          customerId: data.customerId,
          destinationId: data.destinationId,
          plateNumber: data.plateNumber,
          driverName: data.driverName,
          salesOrderNumber: data.salesOrderNumber,
          notes: data.notes,
          operationalGrade: data.operationalGrade,
          requestItems: data.requestItems,
        };

        setTruck(editable);
        populateFormFromTruck(editable, {
          setCustomerId,
          setDestinationId,
          setPlateNumber,
          setDriverName,
          setNotes,
          setIsRebarLoad,
          setOperationalGrade,
          setRequestItems,
        });
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : t("errorLoadTruckGeneric"));
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    };

    void loadTruck();
    return () => {
      cancelled = true;
    };
    // onOpenChange omitted — parent inline callback would retrigger fetch every render
  }, [open, truckId, t, canEditQueued, canEditApproved, canEditRequestItems]);

  const customerSelectItems = useMemo(
    () =>
      customers.map((c) => ({
        value: String(c.id),
        label: `${c.fullName} (${c.code})`,
      })),
    [customers],
  );

  // Uniqueness is per (size, grade, classification): "16mm FIRST unclassified"
  // and "16mm FIRST B500B" may coexist on the same request.

  const addRequestItem = () => {
    const grade = isRebarLoad ? operationalGrade : "";
    setRequestItems((prev) => [
      ...prev,
      {
        key: ++rowKeyCounter,
        sizeCode: "",
        // New rows inherit the operation-level grade so the common
        // single-grade flow never needs the per-row grade field.
        grade,
        classificationId: defaultClassificationId(classifications, grade),
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
    field: "sizeCode" | "grade" | "classificationId" | "bundleCount" | "requestedTons",
    value: string,
  ) => {
    setRequestItems((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        if (field === "sizeCode") {
          const kind = value ? sizeCodeToKind(value) : null;
          const grade =
            kind != null && kind !== "REBAR"
              ? ""
              : kind === "REBAR"
                ? row.grade || operationalGrade || ""
                : row.grade;
          const resolved = resolveClassificationId({
            current: row.classificationId,
            nextGrade: grade,
            classifications,
            applyDefaultIfEmpty: !row.grade && !!grade,
          });
          return {
            ...row,
            sizeCode: value,
            bundleCount: "",
            requestedTons: "",
            grade,
            classificationId: unusedClassificationId({
              current: resolved,
              usedByOthers: usedClassificationIdsForSizeGrade(
                prev.filter((other) => other.key !== key),
                value,
                grade,
              ),
              offeredClassificationIds: offeredClassificationSelectIds(
                classifications,
                grade,
              ),
            }),
          };
        }
        if (field === "grade") {
          const grade = (value as SalesOrderGrade | "") ?? "";
          const resolved = resolveClassificationId({
            current: row.classificationId,
            nextGrade: grade,
            classifications,
            applyDefaultIfEmpty: true,
          });
          return {
            ...row,
            grade,
            classificationId: unusedClassificationId({
              current: resolved,
              usedByOthers: usedClassificationIdsForSizeGrade(
                prev.filter((other) => other.key !== key),
                row.sizeCode,
                grade,
              ),
              offeredClassificationIds: offeredClassificationSelectIds(
                classifications,
                grade,
              ),
            }),
          };
        }
        return { ...row, [field]: value };
      }),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!truck) return;

    if (truck.status === "Queued" && (!customerId || !plateNumber.trim() || !driverName.trim())) {
      toast.error(t("toastCustomerPlateDriverRequired"));
      return;
    }
    if (editAfterTare && !driverName.trim()) {
      toast.error(t("toastDriverRequired"));
      return;
    }

    const items: {
      sizeId: number;
      grade: SalesOrderGrade | null;
      classificationId: number | null;
      bundleCount: number | null;
      requestedTons: number | null;
    }[] = [];
    const seenKeys = new Set<string>();
    if (canMutateRequestItems || requestItemsOnly) {
      for (const row of requestItems.filter((x) => x.sizeCode)) {
        const size = sizes.find((s) => s.code === row.sizeCode);
        if (!size) {
          toast.error(t("toastInvalidSize"));
          return;
        }
        const grade =
          isRebarLoad && row.grade && sizeCodeSupportsGrade(row.sizeCode)
            ? row.grade
            : null;
        // Classification only travels with a graded line — never without grade.
        const classificationId =
          grade && row.classificationId ? Number(row.classificationId) : null;
        const dupKey = `${size.id}:${grade ?? ""}:${classificationId ?? ""}`;
        if (seenKeys.has(dupKey)) {
          toast.error(t("toastDuplicateSizeGrade"));
          return;
        }
        seenKeys.add(dupKey);
        const bundleCount = row.bundleCount ? Number(row.bundleCount) : null;
        const requestedTons = row.requestedTons ? Number(row.requestedTons) : null;
        if (size.isBundleType) {
          if (bundleCount === null || bundleCount < 1) {
            toast.error(t("toastBundlesRequired"));
            return;
          }
        } else if (requestedTons === null || requestedTons <= 0) {
          toast.error(t("toastTonsRequired"));
          return;
        }
        items.push({
          sizeId: size.id,
          grade,
          classificationId,
          bundleCount: size.isBundleType ? bundleCount : null,
          requestedTons: size.isBundleType ? null : requestedTons,
        });
      }
    }

    setSaving(true);
    try {
      const gradePatch = operationalGradeIfChanged(
        truck.operationalGrade,
        isRebarLoad,
        operationalGrade,
      );

      const payload = requestItemsOnly
        ? {
            expectedVersion: truck.version,
            requestItems: items,
          }
        : editAfterTare
          ? {
              expectedVersion: truck.version,
              destinationId,
              driverName: driverName.trim(),
              notes: notesForPatch(notes),
              ...(canEditRequestItems ? { requestItems: items } : {}),
              ...gradePatch,
            }
          : {
              expectedVersion: truck.version,
              customerId: Number(customerId),
              destinationId,
              plateNumber: plateNumber.trim(),
              driverName: driverName.trim(),
              notes: notesForPatch(notes),
              requestItems: items,
              ...gradePatch,
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
      toast.success(t("editSuccess"));
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorEdit"));
    } finally {
      setSaving(false);
    }
  };

  const formBusy = loadingDetail || loadingRef;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={dir}
        className="max-w-lg max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("editTitle", { id: truckId ?? truck?.id ?? "" })}</DialogTitle>
        </DialogHeader>
        {loadingDetail ? (
          <div className="space-y-4 py-2">
            <div className="h-9 animate-pulse rounded-md bg-muted" />
            <div className="h-9 animate-pulse rounded-md bg-muted" />
            <div className="h-24 animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
          {requestItemsOnly && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {truck &&
              (isRequestItemsEditableDuringLoading(truck.status) ||
                (truck.status === "FirstWeigh" && sessionCount > 0))
                ? t("editDuringLoadingNote")
                : t("editApprovedOnlyItems")}
            </p>
          )}
          {editAfterTare && (
            <p className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-100">
              {t("editAfterTareNote")}
            </p>
          )}

          <div className="space-y-2">
            <Label>{t("customerRequired")}</Label>
            {loadingRef ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            ) : (
              <Select
                items={customerSelectItems}
                value={customerId}
                onValueChange={(v) => setCustomerId(v ?? "")}
                disabled={lockIdentityFields || saving}
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

          <div className="space-y-2">
            <Label>{t("destinationOptional")}</Label>
            <DestinationSelect
              value={destinationId}
              onValueChange={setDestinationId}
              disabled={requestItemsOnly || saving}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("loadTypeOptional")}</Label>
            <Select
              value={isRebarLoad ? "REBAR" : "OTHER"}
              onValueChange={(v) => {
                const rebar = v === "REBAR";
                setIsRebarLoad(rebar);
                if (!rebar) {
                  setOperationalGrade("");
                  setRequestItems((prev) =>
                    prev.map((r) => ({ ...r, grade: "", classificationId: "" })),
                  );
                }
              }}
              disabled={requestItemsOnly || saving}
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

          {isRebarLoad && (
            <div className="space-y-2">
              <Label>{t("gradeOptional")}</Label>
              <Select
                value={operationalGrade}
                onValueChange={(v) =>
                  setOperationalGrade((v as SalesOrderGrade | "") ?? "")
                }
                disabled={requestItemsOnly || saving}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="editPlateNumber">{t("plateRequired")}</Label>
              <Input
                id="editPlateNumber"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                disabled={lockIdentityFields || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editDriverName">{t("driverRequired")}</Label>
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
              <Label>{t("requestItems")}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRequestItem}
                disabled={loadingRef || saving || !canMutateRequestItems}
              >
                <Plus className="h-4 w-4 me-1" />
                {t("addSize")}
              </Button>
            </div>

            <div className="min-w-0 space-y-2">
              {requestItems.map((row) => {
                const selectedSize = sizes.find((s) => s.code === row.sizeCode);
                const usedClassIds = usedClassificationIdsForSizeGrade(
                  requestItems.filter((r) => r.key !== row.key),
                  row.sizeCode,
                  row.grade,
                );
                const classOptions = classifications.filter(
                  (c) =>
                    c.grade === row.grade &&
                    (String(c.id) === row.classificationId ||
                      !usedClassIds.has(String(c.id))),
                );
                const noneAvailable =
                  row.classificationId === "" || !usedClassIds.has("");
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
                      disabled={saving || !canMutateRequestItems}
                    >
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder={t("size")} />
                      </SelectTrigger>
                      <SelectContent>
                        {sizes
                          .filter((s) =>
                            isSizeSelectableOnRequestLine({
                              sizeCode: s.code,
                              rowSizeCode: row.sizeCode,
                              rowGrade: row.grade,
                              otherLines: requestItems.filter((r) => r.key !== row.key),
                              offeredClassificationIds: offeredClassificationSelectIds(
                                classifications,
                                row.grade,
                              ),
                            }),
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
                        disabled={saving || !canMutateRequestItems}
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
                    {isRebarLoad &&
                      sizeCodeSupportsGrade(row.sizeCode) &&
                      row.grade &&
                      classifications.some((c) => c.grade === row.grade) && (
                        <Select
                          items={[
                            ...(noneAvailable
                              ? [
                                  {
                                    value: NO_CLASSIFICATION_SELECT_VALUE,
                                    label: t("noClassificationShort"),
                                  },
                                ]
                              : []),
                            ...classOptions.map((c) => ({
                              value: String(c.id),
                              label: c.displayName,
                            })),
                          ]}
                          value={classificationSelectValue(row.classificationId)}
                          onValueChange={(v) =>
                            updateRequestItem(
                              row.key,
                              "classificationId",
                              classificationIdFromSelect(v),
                            )
                          }
                          disabled={saving || !canMutateRequestItems}
                        >
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue placeholder={t("noClassificationShort")} />
                          </SelectTrigger>
                          <SelectContent>
                            {noneAvailable && (
                              <SelectItem value={NO_CLASSIFICATION_SELECT_VALUE}>
                                {t("noClassificationShort")}
                              </SelectItem>
                            )}
                            {classOptions.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.displayName}
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
                          disabled={saving || !canMutateRequestItems}
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
                          disabled={saving || !canMutateRequestItems}
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-destructive"
                        onClick={() => removeRequestItem(row.key)}
                        disabled={saving || !canMutateRequestItems}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="editNotes">{t("notesOptional")}</Label>
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
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || !truck || saving || formBusy}>
              {saving ? t("saving") : t("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
