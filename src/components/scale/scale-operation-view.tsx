"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { toast } from "sonner";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Weight,
  Camera,
  Lock,
  Unlock,
  CircleCheck,
  Ban,
  Printer,
  ArrowRight,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { buildFileViewUrl } from "@/lib/uploaded-file-url";
import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";
import { getDisplayGradeLabel } from "@/lib/truck-grade";
import type { SalesOrderGrade } from "@prisma/client";
import { compressImage } from "@/lib/compress-image";
import {
  durationBetween,
  formatDuration,
  formatDurationCompact,
} from "@/lib/format-duration";

interface SizeOption {
  id: number;
  code: string;
  displayName: string;
}

interface WeighSessionItem {
  id: number;
  sessionNumber: number;
  sizeId: number | null;
  bundleCount: number | null;
  weightTons: string;
  version: number;
  size: { id: number; code: string; displayName: string } | null;
}

interface TruckPhoto {
  id: number;
  filePath: string;
  capturedAt: string;
}

interface TruckRequestItemData {
  id: number;
  sizeId: number;
  bundleCount: number | null;
  requestedTons: string | null;
  size: { id: number; code: string; displayName: string; isBundleType: boolean };
}

interface TruckDetail {
  id: number;
  customerId: number | null;
  destinationId: number | null;
  plateNumber: string;
  driverName: string;
  salesOrderNumber: string | null;
  status: string;
  tareWeightKg: string | null;
  grossWeightKg: string | null;
  tareTime: string | null;
  grossTime: string | null;
  notes: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  customer: { id: number; fullName: string; code: string } | null;
  destination: { id: number; name: string; details: string | null } | null;
  creator: { id: number; fullName: string; username: string };
  closer: { id: number; fullName: string; username: string } | null;
  sessions: WeighSessionItem[];
  photos: TruckPhoto[];
  requestItems: TruckRequestItemData[];
  operationalGrade: SalesOrderGrade | null;
  salesOrder: {
    orderNumber: string;
    kind: string;
    grade: SalesOrderGrade | null;
    totalQtyTons: string;
    contract: { customer: { id: number; fullName: string; code: string } };
  } | null;
}

const statusMap: Record<string, { label: string; color: string }> = {
  Queued: { label: "بالطابور", color: "bg-gray-100 text-gray-800" },
  FirstWeigh: { label: "وزن فارغ", color: "bg-sky-100 text-sky-800" },
  OnScale: { label: "على الميزان", color: "bg-amber-100 text-amber-800" },
  LoadingComplete: { label: "تحميل مكتمل", color: "bg-emerald-100 text-emerald-800" },
  SecondWeigh: { label: "وزن محمّل", color: "bg-indigo-100 text-indigo-800" },
  Completed: { label: "مكتملة", color: "bg-green-100 text-green-800" },
  Cancelled: { label: "ملغاة", color: "bg-red-100 text-red-800" },
};

export function ScaleOperationView({ truckId }: { truckId: number }) {
  const { data: session } = useSession();
  const [truck, setTruck] = useState<TruckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sizes, setSizes] = useState<SizeOption[]>([]);

  const [showTareDialog, setShowTareDialog] = useState(false);
  const [showGrossDialog, setShowGrossDialog] = useState(false);
  const [showCorrectTareDialog, setShowCorrectTareDialog] = useState(false);
  const [showCorrectGrossDialog, setShowCorrectGrossDialog] = useState(false);
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const canTare = sessionHasPermission(session, "scale.enter_tare");
  const canGross = sessionHasPermission(session, "scale.enter_gross");
  const canSession = sessionHasPermission(session, "scale.enter_session");
  const canEditSession = sessionHasPermission(session, "scale.edit_session");
  const canPhoto = sessionHasPermission(session, "scale.upload_photo");
  const canLoadingComplete = sessionHasPermission(session, "scale.loading_complete");
  const canReopen = sessionHasPermission(session, "scale.reopen_before_gross");
  const canClose = sessionHasPermission(session, "scale.close");
  const canCancel = sessionHasPermission(session, "scale.cancel");

  const fetchTruck = useCallback(async () => {
    try {
      const res = await fetch(`/api/trucks/${truckId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setTruck(json.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [truckId]);

  useEffect(() => {
    fetchTruck();
    fetch("/api/sizes")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setSizes(j.data);
      })
      .catch(() => {});
  }, [fetchTruck]);

  // useEffect(() => {
  //   fetchTruck();
  //   if (canSession ) {
  //     fetch("/api/sizes")
  //       .then((r) => r.json())
  //       .then((j) => {
  //         if (j.success) setSizes(j.data);
  //       })
  //       .catch(() => {});
  //   }
  // }, [fetchTruck, canSession]);

  const doAction = async (
    url: string,
    method: string,
    body?: unknown,
    formData?: FormData,
  ) => {
    setActionLoading(true);
    try {
      const opts: RequestInit = { method };
      // One fresh key per user action; retries of the same action should
      // reuse the same key, but the current UI does not retry implicitly.
      // Photo upload uses FormData and its endpoint is not idempotency-
      // protected, so skip the header in that branch.
      const headers: Record<string, string> = {};
      if (formData) {
        opts.body = formData;
      } else {
        if (body !== undefined) {
          headers["Content-Type"] = "application/json";
          opts.body = JSON.stringify(body);
        }
        headers["Idempotency-Key"] = createClientIdempotencyKey();
        opts.headers = headers;
      }
      const res = await fetch(url, opts);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تمت العملية بنجاح");
      await fetchTruck();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ");
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!truck) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        العملية غير موجودة
      </div>
    );
  }

  const st = statusMap[truck.status] ?? { label: truck.status, color: "" };
  const totalSessionsTons = truck.sessions.reduce(
    (sum, s) => sum + Number(s.weightTons),
    0,
  );
  const tare = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;
  const gross = truck.grossWeightKg ? Number(truck.grossWeightKg) : null;
  const bridgeNetKg = tare != null && gross != null ? gross - tare : null;
  const isActive = !["Completed", "Cancelled"].includes(truck.status);

  // Timing calculations
  const waitMs = durationBetween(truck.createdAt, truck.tareTime);
  const loadingEndTime = truck.grossTime
    ?? (truck.status === "Cancelled" ? truck.closedAt : null);
  const loadingInProgress =
    truck.tareTime != null && loadingEndTime == null && truck.status !== "Cancelled";
  const loadingMs = loadingInProgress
    ? durationBetween(truck.tareTime, new Date())
    : durationBetween(truck.tareTime, loadingEndTime);
  const totalMs = durationBetween(
    truck.createdAt,
    truck.closedAt ?? (isActive ? new Date() : null),
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/trucks">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 me-1" />
            العودة للقائمة
          </Button>
        </Link>
        <h2 className="text-lg font-bold">
          عملية #{truck.id}
        </h2>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${st.color}`}>
          {st.label}
        </span>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {truck.customer && (
          <InfoCard
            label="الزبون"
            value={`${truck.customer.fullName} (${truck.customer.code})`}
          />
        )}
        <InfoCard label="رقم اللوحة" value={truck.plateNumber} />
        <InfoCard label="السائق" value={truck.driverName} />
        <InfoCard
          label="الوجهة"
          value={
            truck.destination
              ? truck.destination.details
                ? `${truck.destination.name} - ${truck.destination.details}`
                : truck.destination.name
              : "—"
          }
        />
        {getDisplayGradeLabel(truck) && (
          <InfoCard label="النخب" value={getDisplayGradeLabel(truck)!} />
        )}
        <InfoCard
          label="وزن الفارغ"
          value={tare != null ? `${tare.toLocaleString("ar-SY")} كغ` : "—"}
        />
        <InfoCard
          label="وزن المحمّل"
          value={gross != null ? `${gross.toLocaleString("ar-SY")} كغ` : "—"}
        />
      </div>

      {bridgeNetKg != null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoCard
            label="صافي القبان"
            value={`${bridgeNetKg.toLocaleString("ar-SY")} كغ`}
          />
          <InfoCard
            label="مجموع الوزنات الداخلية"
            value={`${totalSessionsTons.toFixed(3)} طن`}
          />
          <InfoCard
            label="الفرق"
            value={`${(bridgeNetKg / 1000 - totalSessionsTons).toFixed(3)} طن`}
          />
        </div>
      )}

      {/* Timeline / Timing Breakdown */}
      <TimingCard
        createdAt={truck.createdAt}
        tareTime={truck.tareTime}
        grossTime={truck.grossTime}
        closedAt={truck.closedAt}
        status={truck.status}
        waitMs={waitMs}
        loadingMs={loadingMs}
        totalMs={totalMs}
        loadingInProgress={loadingInProgress}
      />

      {/* Request Items (what the customer ordered) */}
      {truck.requestItems && truck.requestItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">تفاصيل الطلبية</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[360px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>القياس</TableHead>
                    <TableHead>الكمية المطلوبة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {truck.requestItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.size.displayName}</TableCell>
                      <TableCell className="font-mono">
                        {item.size.isBundleType
                          ? item.bundleCount != null
                            ? `${item.bundleCount} ربطة`
                            : "—"
                          : item.requestedTons != null
                            ? `${Number(item.requestedTons).toFixed(3)} طن`
                            : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {truck.salesOrder && (
        <Card>
          <CardContent className="py-3 text-sm">
            <span className="text-muted-foreground">أمر البيع: </span>
            <span className="font-medium">{truck.salesOrder.orderNumber}</span>
            <span className="text-muted-foreground mx-2">—</span>
            <span>{truck.salesOrder.contract.customer.fullName}</span>
          </CardContent>
        </Card>
      )}

      {truck.cancelReason && (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm text-destructive">
            <span className="font-medium">سبب الإلغاء: </span>
            {truck.cancelReason}
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      {isActive && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">الإجراءات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {truck.status === "Queued" && canTare && (
              <Button onClick={() => setShowTareDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                إدخال وزن الفارغ
              </Button>
            )}
            {["FirstWeigh", "OnScale", "LoadingComplete"].includes(truck.status) && canTare && (
              <Button
                variant="outline"
                onClick={() => setShowCorrectTareDialog(true)}
                disabled={actionLoading}
              >
                <Pencil className="h-4 w-4 me-1" />
                تصحيح وزن الفارغ
              </Button>
            )}
            {(truck.status === "FirstWeigh" || truck.status === "OnScale") && canSession && (
              <Button onClick={() => setShowSessionDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                إضافة وزنة
              </Button>
            )}
            {(truck.status === "FirstWeigh" || truck.status === "OnScale") && canPhoto && (
              <PhotoUploadButton truckId={truck.id} onUploaded={fetchTruck} disabled={actionLoading} />
            )}
            {truck.status === "OnScale" && canLoadingComplete && (
              <Button
                variant="default"
                onClick={() => doAction(`/api/trucks/${truck.id}/loading-complete`, "POST")}
                disabled={actionLoading}
              >
                <Lock className="h-4 w-4 me-1" />
                تأكيد اكتمال التحميل
              </Button>
            )}
            {truck.status === "LoadingComplete" && canReopen && (
              <Button
                variant="outline"
                onClick={() => doAction(`/api/trucks/${truck.id}/reopen`, "POST")}
                disabled={actionLoading}
              >
                <Unlock className="h-4 w-4 me-1" />
                إعادة فتح التحميل
              </Button>
            )}
            {truck.status === "LoadingComplete" && canGross && (
              <Button onClick={() => setShowGrossDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                إدخال وزن المحمّل
              </Button>
            )}
            {truck.status === "SecondWeigh" && canGross && (
              <Button
                variant="outline"
                onClick={() => setShowCorrectGrossDialog(true)}
                disabled={actionLoading}
              >
                <Pencil className="h-4 w-4 me-1" />
                تصحيح وزن المحمّل
              </Button>
            )}
            {truck.status === "SecondWeigh" && canClose && (
              <Button
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => doAction(`/api/trucks/${truck.id}/close`, "POST")}
                disabled={actionLoading}
              >
                <CircleCheck className="h-4 w-4 me-1" />
                إغلاق العملية
              </Button>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                onClick={() => setShowCancelDialog(true)}
                disabled={actionLoading}
              >
                <Ban className="h-4 w-4 me-1" />
                إلغاء
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {truck.status === "Completed" && (
        <div className="flex gap-2">
          <Link href={`/scale/${truck.id}/print`} target="_blank">
            <Button variant="outline">
              <Printer className="h-4 w-4 me-1" />
              طباعة (داخلي)
            </Button>
          </Link>
          <Link href={`/scale/${truck.id}/print?format=driver`} target="_blank">
            <Button variant="outline">
              <Printer className="h-4 w-4 me-1" />
              طباعة نسخة السائق
            </Button>
          </Link>
        </div>
      )}

      {/* Sessions Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            الوزنات الداخلية ({truck.sessions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {truck.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              لا توجد وزنات بعد
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>القياس</TableHead>
                    <TableHead>الربطات</TableHead>
                    <TableHead>الوزن (طن)</TableHead>
                    {canEditSession &&
                      (truck.status === "OnScale" || truck.status === "FirstWeigh") && (
                        <TableHead className="w-[60px]" />
                      )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {truck.sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono">{s.sessionNumber}</TableCell>
                      <TableCell>{s.size?.displayName ?? "—"}</TableCell>
                      <TableCell>{s.bundleCount ?? "—"}</TableCell>
                      <TableCell className="font-mono">
                        {Number(s.weightTons).toFixed(3)}
                      </TableCell>
                      {canEditSession &&
                        (truck.status === "OnScale" || truck.status === "FirstWeigh") && (
                          <TableCell>
                            <EditSessionButton
                              truckId={truck.id}
                              session={s}
                              sizes={sizes}
                              onEdited={fetchTruck}
                            />
                          </TableCell>
                        )}
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell colSpan={3}>المجموع الكلي (كل الوزنات)</TableCell>
                    <TableCell className="font-mono">
                      {totalSessionsTons.toFixed(3)}
                    </TableCell>
                    {canEditSession &&
                      (truck.status === "OnScale" || truck.status === "FirstWeigh") && (
                        <TableCell />
                      )}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {truck.sessions.length > 0 && (
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-sm font-medium">الإجمالي حسب القياس</p>
              <p className="text-xs text-muted-foreground">
                مجموع الوزن (والربطات) لكل قياس عبر كل الوزنات — مثال: وزنتان لنفس القياس يظهران كسطر واحد.
              </p>
              <div className="overflow-x-auto">
                <Table className="min-w-[320px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>القياس</TableHead>
                      <TableHead>إجمالي الربطات</TableHead>
                      <TableHead>إجمالي الوزن (طن)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregateWeighSessionsBySize(truck.sessions).map((row) => (
                      <TableRow key={row.sizeId ?? "none"}>
                        <TableCell>{row.displayName}</TableCell>
                        <TableCell className="font-mono">
                          {row.totalBundles != null
                            ? row.totalBundles.toLocaleString("ar-SY")
                            : "—"}
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {row.totalTons.toFixed(3)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photos */}
      {truck.photos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              الصور ({truck.photos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {truck.photos.map((p) => (
                <a
                  key={p.id}
                  href={buildFileViewUrl(p.filePath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded-lg overflow-hidden border bg-muted hover:opacity-80 transition-opacity"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={buildFileViewUrl(p.filePath)}
                    alt={`صورة ${p.id}`}
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground space-y-1">
          <div>سجّل بواسطة: {truck.creator.fullName} — {new Date(truck.createdAt).toLocaleString("ar-SY")}</div>
          {truck.closer && truck.closedAt && (
            <div>
              {truck.status === "Cancelled" ? "ألغى" : "أغلق"} بواسطة: {truck.closer.fullName} — {new Date(truck.closedAt).toLocaleString("ar-SY")}
            </div>
          )}
          {truck.notes && <div>ملاحظات: {truck.notes}</div>}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <WeightDialog
        open={showTareDialog}
        onOpenChange={setShowTareDialog}
        title="إدخال وزن الفارغ (كغ)"
        onSubmit={(kg) => doAction(`/api/trucks/${truck.id}/tare`, "PATCH", { weightKg: kg })}
      />
      <WeightDialog
        open={showGrossDialog}
        onOpenChange={setShowGrossDialog}
        title="إدخال وزن المحمّل (كغ)"
        onSubmit={(kg) => doAction(`/api/trucks/${truck.id}/gross`, "PATCH", { weightKg: kg })}
      />
      <WeightDialog
        open={showCorrectTareDialog}
        onOpenChange={setShowCorrectTareDialog}
        title="تصحيح وزن الفارغ (كغ)"
        currentValue={tare ?? undefined}
        onSubmit={(kg) =>
          doAction(`/api/trucks/${truck.id}/correct-tare`, "PATCH", {
            weightKg: kg,
            expectedVersion: truck.version,
          })
        }
      />
      <WeightDialog
        open={showCorrectGrossDialog}
        onOpenChange={setShowCorrectGrossDialog}
        title="تصحيح وزن المحمّل (كغ)"
        currentValue={gross ?? undefined}
        onSubmit={(kg) =>
          doAction(`/api/trucks/${truck.id}/correct-gross`, "PATCH", {
            weightKg: kg,
            expectedVersion: truck.version,
          })
        }
      />
      <SessionDialog
        open={showSessionDialog}
        onOpenChange={setShowSessionDialog}
        truckId={truck.id}
        sizes={sizes}
        onSuccess={fetchTruck}
      />
      <CancelDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        truckId={truck.id}
        onSuccess={fetchTruck}
      />
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}

// ─── Timing / Timeline Card ───────────────────────────────────────

function TimingCard({
  createdAt,
  tareTime,
  grossTime,
  closedAt,
  status,
  waitMs,
  loadingMs,
  totalMs,
  loadingInProgress,
}: {
  createdAt: string;
  tareTime: string | null;
  grossTime: string | null;
  closedAt: string | null;
  status: string;
  waitMs: number | null;
  loadingMs: number | null;
  totalMs: number | null;
  loadingInProgress: boolean;
}) {
  const steps: {
    label: string;
    time: string | null;
    durationLabel?: string;
    durationMs?: number | null;
    highlight?: boolean;
    inProgress?: boolean;
  }[] = [
    {
      label: "تسجيل في اللوجستك",
      time: createdAt,
    },
    {
      label: "دخول القبان فارغاً",
      time: tareTime,
      durationLabel: "وقت الانتظار",
      durationMs: waitMs,
    },
    {
      label: "وزن المحمّل (الخروج)",
      time: grossTime,
      durationLabel: "مدة التحميل",
      durationMs: loadingMs,
      highlight: true,
      inProgress: loadingInProgress,
    },
  ];

  if (closedAt) {
    steps.push({
      label: status === "Cancelled" ? "إلغاء العملية" : "إغلاق العملية",
      time: closedAt,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">الجدول الزمني للعملية</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricBox
            label="وقت الانتظار"
            sublabel="من التسجيل إلى دخول القبان"
            valueMs={waitMs}
          />
          <MetricBox
            label={loadingInProgress ? "مدة التحميل (جارٍ)" : "مدة التحميل"}
            sublabel="من الوزن الفارغ إلى المحمّل"
            valueMs={loadingMs}
            emphasize
            pulse={loadingInProgress}
          />
          <MetricBox
            label="المدة الكلية"
            sublabel="من التسجيل إلى الإغلاق"
            valueMs={totalMs}
          />
        </div>

        {/* Vertical timeline */}
        <div className="relative ps-6 border-s-2 border-dashed border-muted">
          {steps.map((step, i) => (
            <div key={i} className="relative pb-4 last:pb-0">
              <span
                className={`absolute -start-[30px] top-1 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background ${
                  step.time
                    ? step.highlight
                      ? "bg-emerald-500"
                      : "bg-sky-500"
                    : step.inProgress
                      ? "bg-amber-500 animate-pulse"
                      : "bg-muted-foreground/30"
                }`}
              />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{step.label}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {step.time
                    ? new Date(step.time).toLocaleString("ar-SY")
                    : "— لم يحصل بعد —"}
                </span>
              </div>
              {step.durationMs != null && step.durationLabel && (
                <div className="mt-1 text-xs text-muted-foreground">
                  <span>{step.durationLabel}: </span>
                  <span className="font-semibold text-foreground">
                    {formatDuration(step.durationMs)}
                  </span>
                  {step.inProgress && (
                    <span className="ms-2 text-amber-600">(جارٍ الآن)</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricBox({
  label,
  sublabel,
  valueMs,
  emphasize,
  pulse,
}: {
  label: string;
  sublabel: string;
  valueMs: number | null;
  emphasize?: boolean;
  pulse?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        emphasize ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900" : "bg-muted/30"
      } ${pulse ? "animate-pulse" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-0.5 font-mono tabular-nums ${emphasize ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {formatDurationCompact(valueMs)}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>
    </div>
  );
}

// ─── Weight Input Dialog (tare / gross) ────────────────────────────

function WeightDialog({
  open,
  onOpenChange,
  title,
  currentValue,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  currentValue?: number;
  onSubmit: (kg: number) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const parsedKg = parseFloat(value);
  const isValid = !isNaN(parsedKg) && parsedKg > 0;

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast.error("أدخل وزناً صالحاً");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    const ok = await onSubmit(parsedKg);
    setSubmitting(false);
    if (ok) {
      setValue("");
      setConfirming(false);
      onOpenChange(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setValue("");
      setConfirming(false);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <form onSubmit={handleNext} className="space-y-4">
            {currentValue !== undefined && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">القيمة الحالية: </span>
                <span className="font-mono font-semibold">{currentValue.toLocaleString("ar-SY")} كغ</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>الوزن بالكيلوغرام</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="مثال: 15200"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={!isValid}>
                التالي
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
              <p className="text-sm text-muted-foreground mb-1">هل أنت متأكد من القيمة التالية؟</p>
              <p className="text-3xl font-bold font-mono" dir="ltr">
                {parsedKg.toLocaleString("ar-SY")} <span className="text-base font-normal">كغ</span>
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                تعديل القيمة
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting}
                className="bg-green-600 hover:bg-green-700"
              >
                {submitting ? "جاري الحفظ..." : "تأكيد الحفظ"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Session Dialog ────────────────────────────────────────────────

function SessionDialog({
  open,
  onOpenChange,
  truckId,
  sizes,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  truckId: number;
  sizes: SizeOption[];
  onSuccess: () => void;
}) {
  const [sizeCode, setSizeCode] = useState<string>("");
  const [bundleCount, setBundleCount] = useState("");
  const [weightTons, setWeightTons] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedWeight = parseFloat(weightTons);
  const parsedBundles = bundleCount ? parseInt(bundleCount, 10) : null;
  const selectedSize = sizes.find((s) => s.code === sizeCode);
  const isValid = !isNaN(parsedWeight) && parsedWeight > 0;

  const reset = () => {
    setSizeCode("");
    setBundleCount("");
    setWeightTons("");
    setConfirming(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast.error("أدخل وزناً صالحاً");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { weightTons: parsedWeight };
      if (sizeCode) {
        const sz = sizes.find((s) => s.code === sizeCode);
        if (sz) body.sizeId = sz.id;
      }
      if (parsedBundles != null) body.bundleCount = parsedBundles;

      const res = await fetch(`/api/trucks/${truckId}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تمت إضافة الوزنة");
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>إضافة وزنة داخلية</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <form onSubmit={handleNext} className="space-y-4">
            <div className="space-y-2">
              <Label>القياس</Label>
              <Select
                value={sizeCode}
                onValueChange={(v) => setSizeCode(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر القياس" />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s.id} value={s.code}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>عدد الربطات (اختياري)</Label>
              <Input
                type="number"
                min="1"
                value={bundleCount}
                onChange={(e) => setBundleCount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>الوزن بالطن</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={weightTons}
                onChange={(e) => setWeightTons(e.target.value)}
                placeholder="مثال: 6.120"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={!isValid}>
                التالي
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
              <p className="text-sm text-muted-foreground mb-1">هل أنت متأكد من إضافة الوزنة التالية؟</p>
              <p className="text-3xl font-bold font-mono" dir="ltr">
                {parsedWeight.toFixed(3)} <span className="text-base font-normal">طن</span>
              </p>
              <div className="mt-2 text-sm space-y-0.5">
                <div>
                  <span className="text-muted-foreground">القياس: </span>
                  <span className="font-medium">{selectedSize?.displayName ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">الربطات: </span>
                  <span className="font-medium">
                    {parsedBundles != null ? parsedBundles.toLocaleString("ar-SY") : "—"}
                  </span>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                تعديل القيم
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={saving}
                className="bg-green-600 hover:bg-green-700"
              >
                {saving ? "جاري الحفظ..." : "تأكيد الإضافة"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Session Button ──────────────────────────────────────────

function EditSessionButton({
  truckId,
  session: s,
  sizes,
  onEdited,
}: {
  truckId: number;
  session: WeighSessionItem;
  sizes: SizeOption[];
  onEdited: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sizeCode, setSizeCode] = useState(s.size?.code ?? "");
  const [bundleCount, setBundleCount] = useState(
    s.bundleCount != null ? String(s.bundleCount) : "",
  );
  const [weightTons, setWeightTons] = useState(String(Number(s.weightTons)));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedWeight = parseFloat(weightTons);
  const parsedBundles = bundleCount ? parseInt(bundleCount, 10) : null;
  const selectedSize = sizes.find((sz) => sz.code === sizeCode);
  const originalWeight = Number(s.weightTons);
  const isValid = !isNaN(parsedWeight) && parsedWeight > 0;

  const handleClose = (v: boolean) => {
    if (!v) setConfirming(false);
    setOpen(v);
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast.error("أدخل وزناً صالحاً");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { weightTons: parsedWeight };
      if (sizeCode) {
        const sz = sizes.find((x) => x.code === sizeCode);
        body.sizeId = sz?.id ?? null;
      } else {
        body.sizeId = null;
      }
      body.bundleCount = parsedBundles;
      body.expectedVersion = s.version;

      const res = await fetch(`/api/trucks/${truckId}/sessions/${s.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تم تعديل الوزنة");
      setConfirming(false);
      setOpen(false);
      onEdited();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        تعديل
      </Button>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تعديل الوزنة #{s.sessionNumber}</DialogTitle>
          </DialogHeader>

          {!confirming ? (
            <form onSubmit={handleNext} className="space-y-4">
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">القيمة الحالية: </span>
                <span className="font-mono font-semibold">{originalWeight.toFixed(3)} طن</span>
              </div>
              <div className="space-y-2">
                <Label>القياس</Label>
                <Select
                  value={sizeCode}
                  onValueChange={(v) => setSizeCode(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر القياس" />
                  </SelectTrigger>
                  <SelectContent>
                    {sizes.map((sz) => (
                      <SelectItem key={sz.id} value={sz.code}>
                        {sz.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>عدد الربطات</Label>
                <Input
                  type="number"
                  min="1"
                  value={bundleCount}
                  onChange={(e) => setBundleCount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>الوزن بالطن</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={weightTons}
                  onChange={(e) => setWeightTons(e.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                  إلغاء
                </Button>
                <Button type="submit" disabled={!isValid}>
                  التالي
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
                <p className="text-sm text-muted-foreground mb-1">هل أنت متأكد من تعديل الوزنة إلى القيمة التالية؟</p>
                <p className="text-3xl font-bold font-mono" dir="ltr">
                  {parsedWeight.toFixed(3)} <span className="text-base font-normal">طن</span>
                </p>
                <div className="mt-2 text-sm space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">القياس: </span>
                    <span className="font-medium">{selectedSize?.displayName ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الربطات: </span>
                    <span className="font-medium">
                      {parsedBundles != null ? parsedBundles.toLocaleString("ar-SY") : "—"}
                    </span>
                  </div>
                  <div className="pt-1 text-xs text-muted-foreground">
                    القيمة السابقة: {originalWeight.toFixed(3)} طن
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                  تعديل القيم
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {saving ? "جاري الحفظ..." : "تأكيد التعديل"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Photo Upload Button ──────────────────────────────────────────

function PhotoUploadButton({
  truckId,
  onUploaded,
  disabled,
}: {
  truckId: number;
  onUploaded: () => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;

    setUploading(true);
    try {
      const file = await compressImage(raw);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/trucks/${truckId}/photo`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تم رفع الصورة");
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في رفع الصورة");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
      >
        <Camera className="h-4 w-4 me-1" />
        {uploading ? "جاري الرفع..." : "رفع صورة"}
      </Button>
    </>
  );
}

// ─── Cancel Dialog ────────────────────────────────────────────────

function CancelDialog({
  open,
  onOpenChange,
  truckId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  truckId: number;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error("أدخل سبب الإلغاء");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/trucks/${truckId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تم إلغاء العملية");
      setReason("");
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>إلغاء العملية</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>سبب الإلغاء</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="اكتب سبب الإلغاء..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              تراجع
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
