"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  salesOrderCreateSchema,
  type SalesOrderCreateInput,
} from "@/lib/validators/sales-order";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDecimal } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";

interface ContractOption {
  contractNumber: string;
  status: string;
  customer: {
    id: number;
    code: string;
    fullName: string;
    phonePrimary: string;
  };
}

const KIND_VALUES = [
  "REBAR",
  "SHORTBAR_1_4M",
  "SHORTBAR_4_12M",
  "SCRAP",
  "BILLET_WIRE",
  "REBAR_UNDER_70CM",
  "BILLET_SCRAP_10M",
  "SCRAP_50CM_1M",
] as const;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function NewSalesOrderForm() {
  const t = useTranslations("salesOrders");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SalesOrderCreateInput>({
    resolver: zodResolver(salesOrderCreateSchema),
    defaultValues: {
      contractNumber: "",
      kind: "REBAR",
      grade: null,
      settlementMode: "CREDIT",
      paymentDeadlineDays: 28,
      totalQtyTons: undefined as unknown as number,
      toleranceType: "percentage",
      toleranceValue: 0,
      specialRatioPct: 10,
      orderDate: todayISO(),
      deliveryDate: "",
      notes: "",
    },
  });

  const kind = watch("kind");
  const settlementMode = watch("settlementMode");
  const toleranceType = watch("toleranceType");
  const totalQtyTons = watch("totalQtyTons");
  const toleranceValue = watch("toleranceValue");
  const contractNumber = watch("contractNumber");

  const selectedContract = useMemo(
    () => contracts.find((c) => c.contractNumber === contractNumber) ?? null,
    [contracts, contractNumber],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setContractsLoading(true);
      try {
        const res = await fetch(
          "/api/contracts?status=active&pageSize=100",
        );
        const json = await res.json();
        if (!cancelled && json.success) {
          setContracts(json.data as ContractOption[]);
        }
      } catch {
        if (!cancelled) toast.error(t("errorLoadContracts"));
      } finally {
        if (!cancelled) setContractsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (kind !== "REBAR") {
      setValue("grade", null);
      setValue("specialRatioPct", null);
    } else {
      setValue("specialRatioPct", 10);
    }
  }, [kind, setValue]);

  useEffect(() => {
    if (settlementMode === "PAYMENT_PLAN") {
      setValue("paymentDeadlineDays", null);
    } else {
      setValue("paymentDeadlineDays", 28);
    }
  }, [settlementMode, setValue]);

  const maxAllowedTons = useMemo(() => {
    const q = Number(totalQtyTons);
    const tVal = Number(toleranceValue);
    if (Number.isNaN(q) || Number.isNaN(tVal)) return null;
    if (toleranceType === "percentage") return q * (1 + tVal / 100);
    return q + tVal;
  }, [totalQtyTons, toleranceValue, toleranceType]);

  const onSubmit = async (data: SalesOrderCreateInput) => {
    const payload: SalesOrderCreateInput = {
      ...data,
      contractNumber: data.contractNumber,
      kind: data.kind,
      grade: data.kind === "REBAR" ? data.grade : null,
      settlementMode: data.settlementMode,
      paymentDeadlineDays:
        data.settlementMode === "CREDIT" ? data.paymentDeadlineDays : null,
      specialRatioPct: data.kind === "REBAR" ? (data.specialRatioPct ?? 10) : null,
      notes: data.notes ?? "",
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/sales-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!json.success) {
        toast.error(json.error ?? t("errorGeneric"));
        return;
      }

      toast.success(
        t("createSuccess", { number: json.data.orderNumber as string }),
      );
      router.push("/sales-orders");
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setSubmitting(false);
    }
  };

  if (sessionStatus === "loading") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!sessionHasPermission(session, "salesorder.create")) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/sales-orders")}>
            <BackIcon className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">{t("newTitle")}</h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("noCreatePermission")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <BackIcon className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("newTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("newSubtitle")}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("sectionContract")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="contractNumber">{t("contractNumber")}</Label>
              <Select
                value={contractNumber || undefined}
                onValueChange={(v) =>
                  setValue("contractNumber", v ?? "")
                }
                disabled={contractsLoading}
              >
                <SelectTrigger
                  id="contractNumber"
                  className="w-full min-w-0"
                  aria-invalid={!!errors.contractNumber}
                >
                  <SelectValue
                    placeholder={
                      contractsLoading ? t("loading") : t("selectActiveContract")
                    }
                  />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {contracts.map((c) => (
                    <SelectItem key={c.contractNumber} value={c.contractNumber}>
                      {c.contractNumber} — {c.customer.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.contractNumber && (
                <p className="text-xs text-destructive">
                  {errors.contractNumber.message}
                </p>
              )}
            </div>

            {selectedContract && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-medium text-foreground">
                  {selectedContract.customer.fullName}
                </p>
                <p className="text-muted-foreground">
                  {selectedContract.customer.code} —{" "}
                  {selectedContract.customer.phonePrimary}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("sectionKindSettlement")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("orderKind")}</Label>
              <Select
                value={kind}
                onValueChange={(v) =>
                  setValue("kind", v as SalesOrderCreateInput["kind"])
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder={t("selectKind")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {KIND_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {tEnums(`materialKind.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.kind && (
                <p className="text-xs text-destructive">{errors.kind.message}</p>
              )}
            </div>

            {kind === "REBAR" && (
              <div className="space-y-2">
                <Label>{t("grade")}</Label>
                <Select
                  value={watch("grade") ?? undefined}
                  onValueChange={(v) =>
                    setValue("grade", v as SalesOrderCreateInput["grade"])
                  }
                >
                  <SelectTrigger
                    className="w-full min-w-0"
                    aria-invalid={!!errors.grade}
                  >
                    <SelectValue placeholder={t("selectGrade")} />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
                    <SelectItem value="FIRST">
                      {tEnums("grade.FIRST")}
                    </SelectItem>
                    <SelectItem value="SECOND">
                      {tEnums("grade.SECOND")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {errors.grade && (
                  <p className="text-xs text-destructive">
                    {errors.grade.message}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>{t("settlementMode")}</Label>
              <Select
                value={settlementMode}
                onValueChange={(v) =>
                  setValue(
                    "settlementMode",
                    v as SalesOrderCreateInput["settlementMode"],
                  )
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder={t("selectSettlement")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  <SelectItem value="CREDIT">
                    {tEnums("settlementMode.CREDIT")}
                  </SelectItem>
                  <SelectItem value="PAYMENT_PLAN">
                    {tEnums("settlementMode.PAYMENT_PLAN")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {errors.settlementMode && (
                <p className="text-xs text-destructive">
                  {errors.settlementMode.message}
                </p>
              )}
            </div>

            {settlementMode === "CREDIT" && (
              <div className="space-y-2">
                <Label htmlFor="paymentDeadlineDays">
                  {t("paymentDeadlineDays")}
                </Label>
                <Input
                  id="paymentDeadlineDays"
                  type="number"
                  min={1}
                  step={1}
                  aria-invalid={!!errors.paymentDeadlineDays}
                  {...register("paymentDeadlineDays", {
                    valueAsNumber: true,
                  })}
                />
                {errors.paymentDeadlineDays && (
                  <p className="text-xs text-destructive">
                    {errors.paymentDeadlineDays.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("sectionQtyTolerance")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totalQtyTons">{t("totalQtyTons")}</Label>
              <Input
                id="totalQtyTons"
                type="number"
                min={0}
                step="any"
                aria-invalid={!!errors.totalQtyTons}
                {...register("totalQtyTons", { valueAsNumber: true })}
              />
              {errors.totalQtyTons && (
                <p className="text-xs text-destructive">
                  {errors.totalQtyTons.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("toleranceType")}</Label>
              <Select
                value={toleranceType}
                onValueChange={(v) =>
                  setValue(
                    "toleranceType",
                    v as SalesOrderCreateInput["toleranceType"],
                  )
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  <SelectItem value="percentage">
                    {tEnums("toleranceType.percentage")}
                  </SelectItem>
                  <SelectItem value="weight">
                    {tEnums("toleranceType.weight")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {errors.toleranceType && (
                <p className="text-xs text-destructive">
                  {errors.toleranceType.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="toleranceValue">
                {toleranceType === "percentage"
                  ? t("tolerancePctLabel")
                  : t("toleranceWeightLabel")}
              </Label>
              <Input
                id="toleranceValue"
                type="number"
                min={0}
                step="any"
                aria-invalid={!!errors.toleranceValue}
                {...register("toleranceValue", { valueAsNumber: true })}
              />
              {errors.toleranceValue && (
                <p className="text-xs text-destructive">
                  {errors.toleranceValue.message}
                </p>
              )}
            </div>

            {kind === "REBAR" && (
              <div className="space-y-2">
                <Label htmlFor="specialRatioPct">{t("specialRatioPct")}</Label>
                <Input
                  id="specialRatioPct"
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  aria-invalid={!!errors.specialRatioPct}
                  {...register("specialRatioPct", { valueAsNumber: true })}
                />
                {errors.specialRatioPct && (
                  <p className="text-xs text-destructive">
                    {errors.specialRatioPct.message}
                  </p>
                )}
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {t("maxAllowed")}
              {maxAllowedTons != null ? (
                <span className="font-medium text-foreground tabular-nums weight-value">
                  {t("maxAllowedTons", {
                    value: formatDecimal(maxAllowedTons, 3),
                  })}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("emDash")}</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("sectionDates")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orderDate">{t("orderDate")}</Label>
              <Input id="orderDate" type="date" {...register("orderDate")} />
              {errors.orderDate && (
                <p className="text-xs text-destructive">
                  {errors.orderDate.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryDate">{t("deliveryDate")}</Label>
              <Input id="deliveryDate" type="date" {...register("deliveryDate")} />
              {errors.deliveryDate && (
                <p className="text-xs text-destructive">
                  {errors.deliveryDate.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("sectionNotes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              {...register("notes")}
              placeholder={t("notesOptional")}
              rows={3}
            />
            {errors.notes && (
              <p className="text-xs text-destructive mt-1">{errors.notes.message}</p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("createSubmit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
