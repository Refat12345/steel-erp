"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
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

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function NewSalesOrderForm() {
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
        if (!cancelled) toast.error("تعذر تحميل قائمة العقود");
      } finally {
        if (!cancelled) setContractsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    const t = Number(toleranceValue);
    if (Number.isNaN(q) || Number.isNaN(t)) return null;
    if (toleranceType === "percentage") return q * (1 + t / 100);
    return q + t;
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
        toast.error(json.error ?? "حدث خطأ");
        return;
      }

      toast.success(
        `تم إنشاء أمر البيع ${json.data.orderNumber as string} بنجاح`,
      );
      router.push("/sales-orders");
    } catch {
      toast.error("حدث خطأ في الاتصال");
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
            <ArrowRight className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">أمر بيع جديد</h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            لا تملك صلاحية إنشاء أمر بيع. تواصل مع المسؤول إذا كنت بحاجة للوصول.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">أمر بيع جديد</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            إنشاء أمر بيع جديد تحت عقد ساري
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">العقد</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="contractNumber">رقم العقد</Label>
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
                      contractsLoading ? "جاري التحميل..." : "اختر عقداً سارياً"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
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
            <CardTitle className="text-base">نوع أمر البيع والتسوية</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>نوع الأمر</Label>
              <Select
                value={kind}
                onValueChange={(v) =>
                  setValue("kind", v as SalesOrderCreateInput["kind"])
                }
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder="اختر النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REBAR">مبروم</SelectItem>
                  <SelectItem value="SHORTBAR_1_4M">قصائر 1–4 م</SelectItem>
                  <SelectItem value="SHORTBAR_4_12M">قصائر 4–12 م</SelectItem>
                  <SelectItem value="SCRAP">خردة</SelectItem>
                </SelectContent>
              </Select>
              {errors.kind && (
                <p className="text-xs text-destructive">{errors.kind.message}</p>
              )}
            </div>

            {kind === "REBAR" && (
              <div className="space-y-2">
                <Label>النخب</Label>
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
                    <SelectValue placeholder="اختر النخب" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIRST">نخب أول</SelectItem>
                    <SelectItem value="SECOND">نخب ثاني</SelectItem>
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
              <Label>نمط التسوية</Label>
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
                  <SelectValue placeholder="اختر نمط التسوية" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CREDIT">آجل</SelectItem>
                  <SelectItem value="PAYMENT_PLAN">نظام دفعات</SelectItem>
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
                <Label htmlFor="paymentDeadlineDays">مهلة السداد (أيام)</Label>
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
            <CardTitle className="text-base">الكمية والسماحية</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totalQtyTons">الكمية الإجمالية (طن)</Label>
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
              <Label>نوع السماحية</Label>
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
                <SelectContent>
                  <SelectItem value="percentage">نسبة مئوية</SelectItem>
                  <SelectItem value="weight">وزن بالطن</SelectItem>
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
                  ? "نسبة السماحية (%)"
                  : "وزن السماحية (طن)"}
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
                <Label htmlFor="specialRatioPct">
                  النسبة الخاصة 8مم+10مم (%)
                </Label>
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
              الحد الأقصى المسموح:{" "}
              {maxAllowedTons != null ? (
                <span className="font-medium text-foreground tabular-nums">
                  {maxAllowedTons.toLocaleString("ar-SA", {
                    maximumFractionDigits: 3,
                  })}{" "}
                  طن
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">التواريخ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orderDate">تاريخ الأمر</Label>
              <Input id="orderDate" type="date" {...register("orderDate")} />
              {errors.orderDate && (
                <p className="text-xs text-destructive">
                  {errors.orderDate.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryDate">تاريخ التسليم المتوقع</Label>
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
            <CardTitle className="text-base">ملاحظات</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              {...register("notes")}
              placeholder="ملاحظات إضافية (اختياري)"
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
            إلغاء
          </Button>
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            إنشاء أمر البيع
          </Button>
        </div>
      </form>
    </div>
  );
}
