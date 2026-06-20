"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowRight,
  AlertTriangle,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Ban,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDate } from "@/lib/date-format";

interface CatalogSize {
  id: number;
  code: string;
  displayName: string;
  isBundleType: boolean;
  isSpecialRatio: boolean;
}

interface OrderItemRow {
  id: number;
  sizeId: number;
  pricePerTon: string | number;
  size: { id: number; code: string; displayName: string };
}

interface SalesOrderDetail {
  orderNumber: string;
  contractNumber: string;
  kind: string;
  grade: string | null;
  settlementMode: string;
  paymentDeadlineDays: number | null;
  totalQtyTons: string | number;
  toleranceType: string;
  toleranceValue: string | number;
  specialRatioPct: string | number | null;
  orderDate: string;
  deliveryDate: string;
  status: string;
  notes: string | null;
  createdAt: string;
  contract: {
    contractNumber: string;
    status: string;
    customer: {
      id: number;
      code: string;
      fullName: string;
      phonePrimary: string;
      nationalId: string;
    };
  };
  items: OrderItemRow[];
  creator: { username: string; fullName: string };
  updater: { username: string; fullName: string } | null;
}

const SHORTBAR_SCRAP_CODES = new Set([
  "shortbar_1_4m",
  "shortbar_4_12m",
  "scrap",
]);

function sizesForKind(kind: string, sizes: CatalogSize[]): CatalogSize[] {
  if (kind === "REBAR") {
    return sizes.filter(
      (s) => s.isBundleType && !SHORTBAR_SCRAP_CODES.has(s.code),
    );
  }
  if (kind === "SHORTBAR_1_4M") {
    return sizes.filter((s) => s.code === "shortbar_1_4m");
  }
  if (kind === "SHORTBAR_4_12M") {
    return sizes.filter((s) => s.code === "shortbar_4_12m");
  }
  if (kind === "SCRAP") {
    return sizes.filter((s) => s.code === "scrap");
  }
  if (kind === "BILLET_WIRE") {
    return sizes.filter((s) => s.code === "billet_wire_6mm");
  }
  return [];
}

const kindLabels: Record<string, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
  BILLET_WIRE: "أسلاك تربيط",
};

const gradeLabels: Record<string, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
};

const settlementLabels: Record<string, string> = {
  CREDIT: "آجل",
  PAYMENT_PLAN: "نظام دفعات",
};

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  draft: { label: "مسودة", variant: "secondary" },
  approved: { label: "معتمد", variant: "default" },
  in_progress: { label: "قيد التنفيذ", variant: "default" },
  completed: { label: "مكتمل", variant: "secondary" },
  cancelled: { label: "ملغى", variant: "destructive" },
};

function formatKindDisplay(kind: string, grade: string | null): string {
  const k = kindLabels[kind] ?? kind;
  if (!grade) return k;
  const g = gradeLabels[grade] ?? grade;
  return `${k} (${g})`;
}

function formatQtyTons(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("ar-SA", { maximumFractionDigits: 3 });
}

function formatMoney(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("ar-SA", { maximumFractionDigits: 2 });
}

export default function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = use(params);
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const [order, setOrder] = useState<SalesOrderDetail | null>(null);
  const [catalogSizes, setCatalogSizes] = useState<CatalogSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveReason, setApproveReason] = useState("");
  const [approveSaving, setApproveSaving] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);

  const loadOrder = useCallback(async () => {
    const res = await fetch(`/api/sales-orders/${encodeURIComponent(orderNumber)}`);
    const json = await res.json();
    if (!json.success) {
      setOrder(null);
      return;
    }
    setOrder(json.data as SalesOrderDetail);
  }, [orderNumber]);

  const loadSizes = useCallback(async () => {
    const res = await fetch("/api/sizes");
    const json = await res.json();
    if (json.success) {
      setCatalogSizes(json.data as CatalogSize[]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadOrder(), loadSizes()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOrder, loadSizes]);

  useEffect(() => {
    if (!order || catalogSizes.length === 0) return;
    const rows = sizesForKind(order.kind, catalogSizes);
    const next: Record<number, string> = {};
    for (const row of rows) {
      const existing = order.items.find((i) => i.sizeId === row.id);
      next[row.id] = existing ? String(existing.pricePerTon) : "";
    }
    setPriceInputs(next);
  }, [order?.orderNumber, order?.kind, order?.items, catalogSizes]);

  const pricingSizes = useMemo(() => {
    if (!order) return [];
    return sizesForKind(order.kind, catalogSizes);
  }, [order, catalogSizes]);

  const canEditPrices = useMemo(() => {
    if (!session?.user || !order) return false;
    if (order.status !== "draft" && order.status !== "approved") return false;
    if (!sessionHasPermission(session, "salesorder.set_price")) {
      return false;
    }
    if (order.status === "draft") {
      return sessionHasPermission(session, "salesorder.edit_draft");
    }
    return sessionHasPermission(session, "salesorder.edit_approved");
  }, [session, order]);

  const canApprove =
    order?.status === "draft" &&
    sessionHasPermission(session, "salesorder.approve");

  const canCancel =
    order &&
    (order.status === "draft" || order.status === "approved") &&
    sessionHasPermission(session, "salesorder.cancel");

  const savePrices = async () => {
    if (!order) return;
    const items = Object.entries(priceInputs)
      .map(([sizeId, raw]) => ({
        sizeId: Number(sizeId),
        pricePerTon: parseFloat(String(raw).replace(/,/g, "")),
      }))
      .filter((x) => !Number.isNaN(x.pricePerTon) && x.pricePerTon > 0);

    if (items.length === 0) {
      toast.error("أدخل سعراً صالحاً لبند واحد على الأقل");
      return;
    }

    setSavingPrices(true);
    try {
      const res = await fetch(
        `/api/sales-orders/${encodeURIComponent(orderNumber)}/items`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        },
      );
      const json = await res.json();
      if (json.success) {
        toast.success("تم حفظ أسعار البنود");
        await loadOrder();
      } else {
        toast.error(json.error ?? "تعذر حفظ الأسعار");
      }
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setSavingPrices(false);
    }
  };

  const submitApprove = async () => {
    if (!approveReason.trim()) {
      toast.error("أدخل سبب الاعتماد");
      return;
    }
    setApproveSaving(true);
    try {
      const res = await fetch(
        `/api/sales-orders/${encodeURIComponent(orderNumber)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "approved",
            statusReason: approveReason.trim(),
          }),
        },
      );
      const json = await res.json();
      if (json.success) {
        toast.success("تم اعتماد أمر البيع");
        setApproveOpen(false);
        setApproveReason("");
        await loadOrder();
      } else {
        toast.error(json.error ?? "تعذر الاعتماد");
      }
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setApproveSaving(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error("يجب إدخال سبب الإلغاء");
      return;
    }
    setCancelSaving(true);
    try {
      const res = await fetch(
        `/api/sales-orders/${encodeURIComponent(orderNumber)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "cancelled",
            statusReason: cancelReason.trim(),
          }),
        },
      );
      const json = await res.json();
      if (json.success) {
        toast.success("تم إلغاء أمر البيع");
        setCancelOpen(false);
        setCancelReason("");
        await loadOrder();
      } else {
        toast.error(json.error ?? "تعذر الإلغاء");
      }
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setCancelSaving(false);
    }
  };

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">أمر البيع غير موجود</p>
        <Button variant="outline" onClick={() => router.push("/sales-orders")}>
          العودة لأوامر البيع
        </Button>
      </div>
    );
  }

  const st = statusMap[order.status] ?? {
    label: order.status,
    variant: "secondary" as const,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/sales-orders")}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight font-mono">
              {order.orderNumber}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatKindDisplay(order.kind, order.grade)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={st.variant}>{st.label}</Badge>
          {canApprove && (
            <Button
              size="sm"
              className="gap-1"
              onClick={() => setApproveOpen(true)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              اعتماد
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="destructive"
              className="gap-1"
              onClick={() => setCancelOpen(true)}
            >
              <Ban className="h-3.5 w-3.5" />
              إلغاء
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">العقد والعميل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="link"
              className="h-auto p-0 font-mono text-base"
              onClick={() =>
                router.push(`/contracts/${order.contractNumber}`)
              }
            >
              {order.contractNumber}
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
            </Button>
            <span className="text-muted-foreground">—</span>
            <span className="font-medium">{order.contract.customer.fullName}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {order.contract.customer.code} — {order.contract.customer.phonePrimary}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">تفاصيل الأمر</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <span className="text-muted-foreground">نمط التسوية</span>
            <p className="font-medium">
              {settlementLabels[order.settlementMode] ?? order.settlementMode}
            </p>
          </div>
          {order.settlementMode === "CREDIT" && order.paymentDeadlineDays != null && (
            <div>
              <span className="text-muted-foreground">مهلة السداد</span>
              <p className="font-medium tabular-nums">
                {order.paymentDeadlineDays} يوم
              </p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">الكمية الإجمالية</span>
            <p className="font-medium tabular-nums">
              {formatQtyTons(order.totalQtyTons)} طن
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">السماحية</span>
            <p className="font-medium">
              {order.toleranceType === "percentage"
                ? `${formatQtyTons(order.toleranceValue)} %`
                : `${formatQtyTons(order.toleranceValue)} طن`}
            </p>
          </div>
          {order.specialRatioPct != null && order.kind === "REBAR" && (
            <div>
              <span className="text-muted-foreground">النسبة الخاصة 8+10مم</span>
              <p className="font-medium tabular-nums">
                {formatMoney(order.specialRatioPct)} %
              </p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">تاريخ الأمر</span>
            <p className="font-medium">
              {formatDate(order.orderDate)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">تاريخ التسليم المتوقع</span>
            <p className="font-medium">
              {formatDate(order.deliveryDate)}
            </p>
          </div>
          {order.notes && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">ملاحظات</span>
              <p className="font-medium whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">بنود الأسعار</CardTitle>
          {canEditPrices && (
            <Button
              size="sm"
              onClick={savePrices}
              disabled={savingPrices}
              className="gap-2"
            >
              {savingPrices && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              حفظ الأسعار
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {order.items.length === 0 && !canEditPrices && (
            <p className="text-sm text-muted-foreground">لا توجد أسعار مثبتة بعد</p>
          )}

          {(order.items.length > 0 || canEditPrices) && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>القياس</TableHead>
                    <TableHead className="text-left w-40">
                      السعر للطن (ل.س)
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canEditPrices
                    ? pricingSizes.map((sz) => (
                        <TableRow key={sz.id}>
                          <TableCell className="font-medium">
                            {sz.displayName}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              className="tabular-nums"
                              value={priceInputs[sz.id] ?? ""}
                              onChange={(e) =>
                                setPriceInputs((prev) => ({
                                  ...prev,
                                  [sz.id]: e.target.value,
                                }))
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    : order.items
                        .slice()
                        .sort((a, b) =>
                          a.size.displayName.localeCompare(
                            b.size.displayName,
                            "ar",
                          ),
                        )
                        .map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              {row.size.displayName}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatMoney(row.pricePerTon)}
                            </TableCell>
                          </TableRow>
                        ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!canEditPrices && order.items.length > 0 && (
            <p className="text-xs text-muted-foreground">
              عرض فقط — لا يمكن تعديل الأسعار في هذه الحالة أو لعدم امتلاكك الصلاحية
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>اعتماد أمر البيع</DialogTitle>
            <DialogDescription>
              سيتم تغيير الحالة إلى «معتمد». أدخل سبباً موجزاً للسجل.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approveReason">السبب</Label>
            <Textarea
              id="approveReason"
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              placeholder="مثال: مطابقة للعقد"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submitApprove} disabled={approveSaving} className="gap-2">
              {approveSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              اعتماد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء أمر البيع</DialogTitle>
            <DialogDescription>
              لا يمكن التراجع عن الإلغاء. أدخل السبب للسجل.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancelReason">سبب الإلغاء *</Label>
            <Textarea
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              رجوع
            </Button>
            <Button
              variant="destructive"
              onClick={submitCancel}
              disabled={cancelSaving}
              className="gap-2"
            >
              {cancelSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              تأكيد الإلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
