"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  Trash2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { buildFileViewUrl } from "@/lib/uploaded-file-url";
import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";
import { buildRequestVsLoadedComparison } from "@/lib/loading-complete-comparison";
import {
  computeWeighbridgeDiscrepancy,
  isWeighbridgeDiscrepancyWarning,
} from "@/lib/weighbridge-discrepancy";
import { getDisplayGradeLabel, GRADE_LABELS } from "@/lib/truck-grade";
import { shouldWarnBridgeRoundProductMix } from "@/lib/material-kind";
import type { SalesOrderGrade } from "@prisma/client";
import { compressImage } from "@/lib/compress-image";
import {
  formatDuration,
  formatDurationCompact,
} from "@/lib/format-duration";
import { formatDateTime } from "@/lib/date-format";
import type { TruckTimings } from "@/lib/truck-timing";
import { AdminCorrectionPanel } from "@/components/scale/admin-correction-panel";

interface SizeOption {
  id: number;
  code: string;
  displayName: string;
  isBundleType: boolean;
}

interface WeighSessionItem {
  id: number;
  bridgeRoundId: number | null;
  sessionNumber: number;
  sizeId: number | null;
  bundleCount: number | null;
  weightTons: string;
  version: number;
  size: {
    id: number;
    code: string;
    displayName: string;
    isBundleType: boolean;
  } | null;
}

interface TruckPhoto {
  id: number;
  bridgeRoundId: number | null;
  filePath: string;
  capturedAt: string;
}

interface TruckRequestItemData {
  id: number;
  sizeId: number;
  grade: SalesOrderGrade | null;
  bundleCount: number | null;
  requestedTons: string | null;
  size: { id: number; code: string; displayName: string; isBundleType: boolean };
}

interface BridgeRoundItem {
  id: number;
  roundNumber: number;
  grade: SalesOrderGrade | null;
  sizeId: number | null;
  size: { id: number; displayName: string } | null;
  startWeightKg: string;
  endWeightKg: string | null;
  startTime: string;
  endTime: string | null;
  isFinal: boolean;
  loadingConfirmedAt: string | null;
  loader: { id: number; fullName: string; username: string } | null;
  version: number;
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
  loadingConfirmedAt: string | null;
  lastReopenedAt: string | null;
  version: number;
  createdAt: string;
  customer: { id: number; fullName: string; code: string } | null;
  destination: { id: number; name: string; details: string | null } | null;
  creator: { id: number; fullName: string; username: string };
  closer: { id: number; fullName: string; username: string } | null;
  loader: { id: number; fullName: string; username: string } | null;
  sessions: WeighSessionItem[];
  photos: TruckPhoto[];
  requestItems: TruckRequestItemData[];
  rounds: BridgeRoundItem[];
  operationalGrade: SalesOrderGrade | null;
  skipInternalWeighing: boolean;
  salesOrder: {
    orderNumber: string;
    kind: string;
    grade: SalesOrderGrade | null;
    totalQtyTons: string;
    contract: { customer: { id: number; fullName: string; code: string } };
  } | null;
  timings: TruckTimings;
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

export function ScaleOperationView({
  truckId,
  discrepancyWarnKg,
}: {
  truckId: number;
  discrepancyWarnKg: number;
}) {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const backHref =
    searchParams.get("from") === "loaded-trucks" ? "/loaded-trucks" : "/trucks";
  const [truck, setTruck] = useState<TruckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sizes, setSizes] = useState<SizeOption[]>([]);

  const [showTareDialog, setShowTareDialog] = useState(false);
  const [showGrossDialog, setShowGrossDialog] = useState(false);
  const [showCorrectTareDialog, setShowCorrectTareDialog] = useState(false);
  const [showCorrectGrossDialog, setShowCorrectGrossDialog] = useState(false);
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showLoadingCompleteDialog, setShowLoadingCompleteDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const canTare = sessionHasPermission(session, "scale.enter_tare");
  const canGross = sessionHasPermission(session, "scale.enter_gross");
  const canSession = sessionHasPermission(session, "scale.enter_session");
  const canEditSession = sessionHasPermission(session, "scale.edit_session");
  const canDeleteSession = sessionHasPermission(session, "scale.delete_session");
  const canManageSession =
    (canEditSession || canDeleteSession) &&
    (truck?.status === "OnScale" || truck?.status === "FirstWeigh");
  const canPhoto = sessionHasPermission(session, "scale.upload_photo");
  const canLoadingComplete = sessionHasPermission(session, "scale.loading_complete");
  const canReopen = sessionHasPermission(session, "scale.reopen_before_gross");
  const canClose = sessionHasPermission(session, "scale.close");
  const canCancel = sessionHasPermission(session, "scale.cancel");
  const canCorrectCompleted = sessionHasPermission(session, "scale.correct_completed");

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

  // The size catalog is only consumed by the internal-session weighing
  // features (add / edit / delete a session weight). The external scale
  // operator has none of those permissions and would only get a 403 from
  // `/api/sizes`, so fetch it solely when the user can actually use it.
  const needsSizes =
    canSession || canEditSession || canDeleteSession || canCorrectCompleted;

  useEffect(() => {
    fetchTruck();
    if (!needsSizes) return;
    fetch("/api/sizes")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setSizes(j.data);
      })
      .catch(() => {});
  }, [fetchTruck, needsSizes]);

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

  const totalSessionsTons = truck.sessions.reduce(
    (sum, s) => sum + Number(s.weightTons),
    0,
  );
  const tare = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;
  const gross = truck.grossWeightKg ? Number(truck.grossWeightKg) : null;
  const bridgeNetKg = tare != null && gross != null ? gross - tare : null;
  const bridgeDiscrepancyKg =
    bridgeNetKg != null
      ? computeWeighbridgeDiscrepancy({
          tareKg: tare ?? 0,
          grossKg: gross ?? 0,
          internalTotalTons: totalSessionsTons,
        }).discrepancyKg
      : null;
  const isActive = !["Completed", "Cancelled"].includes(truck.status);
  const timings = truck.timings;

  // ── Bridge rounds ──────────────────────────────────────────────
  const rounds = truck.rounds ?? [];
  const openRound = rounds.find((r) => r.endWeightKg == null) ?? null;
  const hasClosedRound = rounds.some((r) => r.endWeightKg != null);
  const isMultiRound = rounds.length > 1;
  const currentRoundSessions = openRound
    ? truck.sessions.filter((s) => s.bridgeRoundId === openRound.id)
    : [];
  const currentRoundTons = currentRoundSessions.reduce(
    (sum, s) => sum + Number(s.weightTons),
    0,
  );
  const currentRoundPhotoCount = openRound
    ? truck.photos.filter((p) => p.bridgeRoundId === openRound.id).length
    : truck.photos.length;
  const lastClosedRound =
    [...rounds].reverse().find((r) => r.endWeightKg != null) ?? null;
  const lastClosedRoundTons = lastClosedRound
    ? truck.sessions
        .filter((s) => s.bridgeRoundId === lastClosedRound.id)
        .reduce((sum, s) => sum + Number(s.weightTons), 0)
    : 0;

  const st = statusMap[truck.status] ?? { label: truck.status, color: "" };
  // FirstWeigh on round ≥ 2 means "weighed out, came back to load more" —
  // the default label ("وزن فارغ") would be misleading.
  const statusLabel =
    truck.status === "FirstWeigh" && openRound && openRound.roundNumber > 1
      ? `بانتظار التحميل — دورة ${openRound.roundNumber}`
      : st.label;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 me-1" />
            العودة للقائمة
          </Button>
        </Link>
        <h2 className="text-lg font-bold">
          عملية #{truck.id}
        </h2>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${st.color}`}>
          {statusLabel}
        </span>
        {isMultiRound && (
          <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-800">
            {openRound
              ? `دورة ${openRound.roundNumber} من ${rounds.length}`
              : `${rounds.length} دورات قبان`}
          </span>
        )}
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
          value={tare != null ? `${tare.toLocaleString("en-US")} كغ` : "—"}
        />
        <InfoCard
          label="وزن المحمّل"
          value={gross != null ? `${gross.toLocaleString("en-US")} كغ` : "—"}
        />
      </div>

      {bridgeNetKg != null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoCard
            label="صافي القبان"
            value={`${bridgeNetKg.toLocaleString("en-US")} كغ`}
          />
          <InfoCard
            label="مجموع الوزنات الداخلية"
            value={`${totalSessionsTons.toFixed(3)} طن`}
          />
          <InfoCard
            label="الفرق"
            value={
              bridgeDiscrepancyKg != null
                ? `${bridgeDiscrepancyKg.toLocaleString("en-US")} كغ`
                : "—"
            }
          />
          {bridgeDiscrepancyKg != null &&
            isWeighbridgeDiscrepancyWarning(bridgeDiscrepancyKg, discrepancyWarnKg) && (
              <div className="sm:col-span-3 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
                <p className="font-semibold">تنبيه: فرق كبير بين القبان والوزنات الداخلية</p>
                <p className="mt-1 text-xs">
                  الفرق {bridgeDiscrepancyKg.toLocaleString("en-US")} كغ يتجاوز الحد{" "}
                  {discrepancyWarnKg.toLocaleString("en-US")} كغ
                </p>
              </div>
            )}
        </div>
      )}

      {/* Bridge Rounds (multi-round visits only) */}
      {isMultiRound && (
        <RoundsCard
          rounds={rounds}
          sessions={truck.sessions}
          discrepancyWarnKg={discrepancyWarnKg}
        />
      )}

      {/* Timeline / Timing Breakdown */}
      <TimingCard
        createdAt={truck.createdAt}
        tareTime={truck.tareTime}
        grossTime={truck.grossTime}
        closedAt={truck.closedAt}
        status={truck.status}
        timings={timings}
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
                    {truck.requestItems.some((i) => i.grade) && (
                      <TableHead>النخب</TableHead>
                    )}
                    <TableHead>الكمية المطلوبة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {truck.requestItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.size.displayName}</TableCell>
                      {truck.requestItems.some((i) => i.grade) && (
                        <TableCell>
                          {item.grade ? GRADE_LABELS[item.grade] : "—"}
                        </TableCell>
                      )}
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
            {["FirstWeigh", "OnScale", "LoadingComplete"].includes(truck.status) &&
              canTare &&
              !hasClosedRound && (
              <Button
                variant="outline"
                onClick={() => setShowCorrectTareDialog(true)}
                disabled={actionLoading}
              >
                <Pencil className="h-4 w-4 me-1" />
                تصحيح وزن الفارغ
              </Button>
            )}
            {(truck.status === "FirstWeigh" || truck.status === "OnScale") &&
              canSession &&
              !truck.skipInternalWeighing && (
              <Button onClick={() => setShowSessionDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                إضافة وزنة
              </Button>
            )}
            {(truck.status === "FirstWeigh" || truck.status === "OnScale") && canPhoto && (
              <PhotoUploadButton truckId={truck.id} onUploaded={fetchTruck} disabled={actionLoading} />
            )}
            {(truck.status === "OnScale" ||
              (truck.status === "FirstWeigh" && truck.skipInternalWeighing)) &&
              canLoadingComplete && (
              <Button
                variant="default"
                onClick={() => setShowLoadingCompleteDialog(true)}
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
            {(truck.status === "SecondWeigh" ||
              (["FirstWeigh", "OnScale", "LoadingComplete"].includes(truck.status) &&
                hasClosedRound)) &&
              canGross && (
              <Button
                variant="outline"
                onClick={() => setShowCorrectGrossDialog(true)}
                disabled={actionLoading}
              >
                <Pencil className="h-4 w-4 me-1" />
                {truck.status === "SecondWeigh"
                  ? "تصحيح وزن المحمّل"
                  : "تصحيح آخر وزنة خارجية"}
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

      {truck.status === "Completed" && canCorrectCompleted && (
        <AdminCorrectionPanel truck={truck} sizes={sizes} onChanged={fetchTruck} />
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
              {truck.skipInternalWeighing
                ? "شاحنة خردة/أسلاك تربيط — بدون وزنات داخلية. يُحتسب الصافي تلقائياً من القبان (فارغ ومحمّل) عند إدخال وزن المحمّل."
                : "لا توجد وزنات بعد"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    {isMultiRound && <TableHead className="w-[60px]">الدورة</TableHead>}
                    <TableHead>القياس</TableHead>
                    <TableHead>الربطات</TableHead>
                    <TableHead>الوزن (طن)</TableHead>
                    {canManageSession && <TableHead className="w-[100px]">إجراءات</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {truck.sessions.map((s) => {
                    // Sessions of an already-weighed round are frozen — the
                    // service rejects edits, so don't offer the buttons.
                    const inOpenRound =
                      openRound != null && s.bridgeRoundId === openRound.id;
                    const roundNumber =
                      rounds.find((r) => r.id === s.bridgeRoundId)?.roundNumber ??
                      null;
                    return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono">{s.sessionNumber}</TableCell>
                      {isMultiRound && (
                        <TableCell className="font-mono">
                          {roundNumber ?? "—"}
                        </TableCell>
                      )}
                      <TableCell>{s.size?.displayName ?? "—"}</TableCell>
                      <TableCell>{s.bundleCount ?? "—"}</TableCell>
                      <TableCell className="font-mono">
                        {Number(s.weightTons).toFixed(3)}
                      </TableCell>
                      {canManageSession && (
                        <TableCell>
                          {inOpenRound ? (
                            <div className="flex items-center gap-0.5">
                              {canEditSession && (
                                <EditSessionButton
                                  truckId={truck.id}
                                  session={s}
                                  sizes={sizes}
                                  onEdited={fetchTruck}
                                />
                              )}
                              {canDeleteSession && (
                                <DeleteSessionButton
                                  truckId={truck.id}
                                  session={s}
                                  onDeleted={fetchTruck}
                                />
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Lock className="h-3 w-3" aria-hidden />
                              مُرحَّلة
                            </span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                  <TableRow className="font-bold">
                    <TableCell colSpan={isMultiRound ? 4 : 3}>المجموع الكلي (كل الوزنات)</TableCell>
                    <TableCell className="font-mono">
                      {totalSessionsTons.toFixed(3)}
                    </TableCell>
                    {canManageSession && <TableCell />}
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
                            ? row.totalBundles.toLocaleString("en-US")
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
          <div>سجّل بواسطة: {truck.creator.fullName} — {formatDateTime(truck.createdAt)}</div>
          {truck.closer && truck.closedAt && (
            <div>
              {truck.status === "Cancelled" ? "ألغى" : "أغلق"} بواسطة: {truck.closer.fullName} — {formatDateTime(truck.closedAt)}
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
        title={
          openRound && openRound.roundNumber > 1
            ? `إدخال وزنة الدورة ${openRound.roundNumber} (كغ)`
            : "إدخال وزن المحمّل (كغ)"
        }
        crossCheck={
          openRound
            ? {
                tareKg: Number(openRound.startWeightKg),
                internalTotalTons: currentRoundTons,
                discrepancyWarnKg,
              }
            : undefined
        }
        exitChoice={{
          roundNumber: openRound?.roundNumber ?? 1,
          roundStartKg: openRound ? Number(openRound.startWeightKg) : tare ?? 0,
        }}
        onSubmit={(kg, exit) =>
          doAction(`/api/trucks/${truck.id}/gross`, "PATCH", {
            weightKg: kg,
            exit: exit ?? "final",
          })
        }
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
        title={
          lastClosedRound && !lastClosedRound.isFinal
            ? `تصحيح وزنة الدورة ${lastClosedRound.roundNumber} (كغ)`
            : "تصحيح وزن المحمّل (كغ)"
        }
        currentValue={
          lastClosedRound
            ? Number(lastClosedRound.endWeightKg)
            : gross ?? undefined
        }
        crossCheck={
          lastClosedRound
            ? {
                tareKg: Number(lastClosedRound.startWeightKg),
                internalTotalTons: lastClosedRoundTons,
                discrepancyWarnKg,
              }
            : tare != null
              ? {
                  tareKg: tare,
                  internalTotalTons: totalSessionsTons,
                  discrepancyWarnKg,
                }
              : undefined
        }
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
        currentRoundSessions={currentRoundSessions}
        roundNumber={openRound?.roundNumber ?? 1}
        onSuccess={fetchTruck}
      />
      <LoadingCompleteDialog
        open={showLoadingCompleteDialog}
        onOpenChange={setShowLoadingCompleteDialog}
        truckId={truck.id}
        plateNumber={truck.plateNumber}
        customerLabel={
          truck.customer
            ? `${truck.customer.fullName} (${truck.customer.code})`
            : null
        }
        sessions={currentRoundSessions}
        requestItems={truck.requestItems}
        photoCount={currentRoundPhotoCount}
        skipInternalWeighing={truck.skipInternalWeighing}
        roundNumber={openRound?.roundNumber ?? 1}
        initialGrade={openRound?.grade ?? null}
        initialSizeId={openRound?.sizeId ?? null}
        showGradeSelect={
          !truck.skipInternalWeighing &&
          (truck.operationalGrade != null ||
            truck.requestItems.some((i) => i.grade != null) ||
            isMultiRound)
        }
        onConfirm={async (grade, sizeId) => {
          const body: { grade?: SalesOrderGrade | null; sizeId?: number | null } = {};
          if (grade !== undefined) body.grade = grade;
          if (sizeId !== undefined) body.sizeId = sizeId;
          const ok = await doAction(
            `/api/trucks/${truck.id}/loading-complete`,
            "POST",
            Object.keys(body).length > 0 ? body : undefined,
          );
          if (ok) setShowLoadingCompleteDialog(false);
          return ok;
        }}
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

// ─── Bridge Rounds Card ───────────────────────────────────────────

function RoundsCard({
  rounds,
  sessions,
  discrepancyWarnKg,
}: {
  rounds: BridgeRoundItem[];
  sessions: WeighSessionItem[];
  discrepancyWarnKg: number;
}) {
  const totalNetKg = rounds.reduce((sum, r) => {
    if (r.endWeightKg == null) return sum;
    return sum + (Number(r.endWeightKg) - Number(r.startWeightKg));
  }, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">دورات القبان ({rounds.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-2">
          كل دورة = ما بين وزنتين خارجيتين. صافي الدورة هو الوزن المعتمد لما
          حُمِّل فيها، ووزن بداية كل دورة يُنسخ تلقائياً من نهاية الدورة السابقة.
        </p>
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>النخب</TableHead>
                <TableHead>الأصناف المحمّلة</TableHead>
                <TableHead>وزن البداية (كغ)</TableHead>
                <TableHead>وزن النهاية (كغ)</TableHead>
                <TableHead>الصافي المعتمد (كغ)</TableHead>
                <TableHead>الفرق عن الداخلي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rounds.map((r) => {
                const startKg = Number(r.startWeightKg);
                const endKg = r.endWeightKg != null ? Number(r.endWeightKg) : null;
                const netKg = endKg != null ? endKg - startKg : null;
                const roundSessions = sessions.filter(
                  (s) => s.bridgeRoundId === r.id,
                );
                const internalKg =
                  roundSessions.reduce((sum, s) => sum + Number(s.weightTons), 0) *
                  1000;
                const discrepancyKg =
                  netKg != null ? Math.abs(netKg - internalKg) : null;
                const sizeNames = [
                  ...new Set(
                    roundSessions
                      .map((s) => s.size?.displayName)
                      .filter((n): n is string => Boolean(n)),
                  ),
                ];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.roundNumber}</TableCell>
                    <TableCell>{r.grade ? GRADE_LABELS[r.grade] : "—"}</TableCell>
                    <TableCell className="text-xs">
                      {sizeNames.length > 0
                        ? sizeNames.join("، ")
                        : r.size?.displayName ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {startKg.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="font-mono">
                      {endKg != null ? (
                        endKg.toLocaleString("en-US")
                      ) : (
                        <span className="text-amber-600">دورة جارية</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {netKg != null ? netKg.toLocaleString("en-US") : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {discrepancyKg != null ? (
                        <span
                          className={
                            isWeighbridgeDiscrepancyWarning(
                              discrepancyKg,
                              discrepancyWarnKg,
                            )
                              ? "font-bold text-red-600"
                              : ""
                          }
                        >
                          {Math.round(discrepancyKg).toLocaleString("en-US")} كغ
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-bold bg-muted/50">
                <TableCell colSpan={5}>مجموع الصافي المعتمد</TableCell>
                <TableCell className="font-mono">
                  {totalNetKg.toLocaleString("en-US")}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
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
  timings,
}: {
  createdAt: string;
  tareTime: string | null;
  grossTime: string | null;
  closedAt: string | null;
  status: string;
  timings: TruckTimings;
}) {
  const steps: {
    label: string;
    time: string | null;
    durationLabel?: string;
    durationMs?: number | null;
    highlight?: boolean;
    inProgress?: boolean;
    subtitle?: string;
  }[] = [
    {
      label: "تسجيل في اللوجستك",
      time: createdAt,
    },
    {
      label: "دخول القبان فارغاً",
      time: tareTime,
      durationLabel: "وقت الانتظار",
      durationMs: timings.waitMs,
    },
    {
      label: "أول وزنة داخلية",
      time: timings.firstSessionAt,
    },
    {
      label: "تأكيد اكتمال التحميل",
      time: timings.loadingConfirmedAt,
      durationLabel: "مدة التحميل الداخلي",
      durationMs: timings.internalLoadingMs,
      inProgress: timings.internalLoadingInProgress,
      subtitle: timings.loaderName ? `بواسطة: ${timings.loaderName}` : undefined,
    },
    {
      label: "وزن المحمّل (الخروج)",
      time: grossTime,
      durationLabel: "مدة القبان",
      durationMs: timings.scaleMs,
      highlight: true,
      inProgress: timings.scaleInProgress,
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricBox
            label="وقت الانتظار"
            sublabel="من التسجيل إلى دخول القبان"
            valueMs={timings.waitMs}
          />
          <MetricBox
            label={timings.scaleInProgress ? "مدة القبان (جارٍ)" : "مدة القبان"}
            sublabel="من الوزن الفارغ إلى المحمّل"
            valueMs={timings.scaleMs}
            emphasize="scale"
            pulse={timings.scaleInProgress}
          />
          <MetricBox
            label={
              timings.internalLoadingInProgress
                ? "مدة التحميل الداخلي (جارٍ)"
                : "مدة التحميل الداخلي"
            }
            sublabel="من أول وزنة إلى تأكيد المحمّل"
            valueMs={timings.internalLoadingMs}
            emphasize="internal"
            pulse={timings.internalLoadingInProgress}
          />
          <MetricBox
            label="المدة الكلية"
            sublabel="من التسجيل إلى الإغلاق"
            valueMs={timings.totalMs}
          />
        </div>

        <div className="relative ps-6 border-s-2 border-dashed border-muted">
          {steps.map((step, i) => (
            <div key={i} className="relative pb-4 last:pb-0">
              <span
                className={`absolute -start-[30px] top-1 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background ${
                  step.time
                    ? step.highlight
                      ? "bg-emerald-500"
                      : step.inProgress
                        ? "bg-amber-500 animate-pulse"
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
                    ? formatDateTime(step.time)
                    : step.inProgress
                      ? "— في الانتظار —"
                      : "— لم يحصل بعد —"}
                </span>
              </div>
              {step.subtitle && (
                <div className="mt-0.5 text-xs text-muted-foreground">{step.subtitle}</div>
              )}
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
  emphasize?: "scale" | "internal";
  pulse?: boolean;
}) {
  const emphasizeClass =
    emphasize === "scale"
      ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900"
      : emphasize === "internal"
        ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900"
        : "bg-muted/30";
  const valueClass =
    emphasize === "scale"
      ? "text-emerald-700 dark:text-emerald-400"
      : emphasize === "internal"
        ? "text-amber-700 dark:text-amber-400"
        : "";

  return (
    <div
      className={`rounded-lg border p-3 ${emphasizeClass} ${pulse ? "animate-pulse" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-0.5 font-mono tabular-nums ${valueClass}`}>
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
  crossCheck,
  exitChoice,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  currentValue?: number;
  crossCheck?: {
    tareKg: number;
    internalTotalTons: number;
    discrepancyWarnKg: number;
  };
  /**
   * When set, the confirm step offers two outcomes for the external
   * weighing: final exit, or return inside to load another round.
   */
  exitChoice?: {
    roundNumber: number;
    roundStartKg: number;
  };
  onSubmit: (kg: number, exit?: "final" | "return") => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingExit, setSubmittingExit] = useState<"final" | "return" | null>(
    null,
  );

  const parsedKg = parseFloat(value);
  const isValid = !isNaN(parsedKg) && parsedKg > 0;
  const roundNetPreview =
    exitChoice && isValid ? parsedKg - exitChoice.roundStartKg : null;
  const discrepancyPreview =
    crossCheck && isValid
      ? computeWeighbridgeDiscrepancy({
          tareKg: crossCheck.tareKg,
          grossKg: parsedKg,
          internalTotalTons: crossCheck.internalTotalTons,
        })
      : null;
  const showDiscrepancyWarning =
    discrepancyPreview != null &&
    isWeighbridgeDiscrepancyWarning(
      discrepancyPreview.discrepancyKg,
      crossCheck?.discrepancyWarnKg,
    );

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast.error("أدخل وزناً صالحاً");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async (exit?: "final" | "return") => {
    setSubmitting(true);
    if (exit) setSubmittingExit(exit);
    const ok = await onSubmit(parsedKg, exit);
    setSubmitting(false);
    setSubmittingExit(null);
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
                <span className="font-mono font-semibold">{currentValue.toLocaleString("en-US")} كغ</span>
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
            {showDiscrepancyWarning && discrepancyPreview && crossCheck && (
              <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200">
                <p className="font-bold">تنبيه: فرق كبير بين القبان والوزنات الداخلية</p>
                <div className="mt-2 space-y-1 font-mono text-xs sm:text-sm">
                  <p>
                    صافي القبان:{" "}
                    {discrepancyPreview.bridgeNetKg.toLocaleString("en-US")} كغ
                  </p>
                  <p>
                    مجموع الداخلي:{" "}
                    {discrepancyPreview.internalKg.toLocaleString("en-US")} كغ
                  </p>
                  <p className="font-semibold">
                    الفرق: {discrepancyPreview.discrepancyKg.toLocaleString("en-US")} كغ
                    {" "}(الحد: {crossCheck.discrepancyWarnKg.toLocaleString("en-US")} كغ)
                  </p>
                </div>
                <p className="mt-2 text-xs">
                  يمكنك المتابعة بعد التحقق الفعلي على الأرض.
                </p>
              </div>
            )}
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
              <p className="text-sm text-muted-foreground mb-1">هل أنت متأكد من القيمة التالية؟</p>
              <p className="text-3xl font-bold font-mono" dir="ltr">
                {parsedKg.toLocaleString("en-US")} <span className="text-base font-normal">كغ</span>
              </p>
              {exitChoice && roundNetPreview != null && (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">
                    صافي الدورة {exitChoice.roundNumber}:{" "}
                  </span>
                  <span className="font-mono font-semibold" dir="ltr">
                    {roundNetPreview.toLocaleString("en-US")} كغ
                  </span>
                </p>
              )}
            </div>
            {exitChoice ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  «خروج نهائي» يُنهي الوزن ويجهّز العملية للإغلاق. «رجوع
                  للتحميل» يفتح دورة جديدة تبدأ من هذه الوزنة لتحميل صنف أو نخب
                  آخر.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleConfirm("final")}
                    disabled={submitting}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {submittingExit === "final"
                      ? "جاري الحفظ..."
                      : "تأكيد — وزنة وخروج نهائي"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleConfirm("return")}
                    disabled={submitting}
                    className="border border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-100"
                  >
                    {submittingExit === "return"
                      ? "جاري الحفظ..."
                      : `تأكيد — وزنة ورجوع للتحميل (دورة ${exitChoice.roundNumber + 1})`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirming(false)}
                    disabled={submitting}
                  >
                    تعديل القيمة
                  </Button>
                </div>
              </div>
            ) : (
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
            )}
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
  currentRoundSessions,
  roundNumber,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  truckId: number;
  sizes: SizeOption[];
  /** Sessions already recorded in the current bridge round. */
  currentRoundSessions: WeighSessionItem[];
  roundNumber: number;
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

  const existingSizeCodes = currentRoundSessions
    .map(
      (s) =>
        s.size?.code ?? sizes.find((sz) => sz.id === s.sizeId)?.code ?? null,
    )
    .filter((code): code is string => code != null);

  const mixedSizeWarning =
    selectedSize != null &&
    shouldWarnBridgeRoundProductMix(existingSizeCodes, selectedSize.code);

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
            {selectedSize?.isBundleType && (
            <div className="space-y-2">
              <Label>عدد الربطات (اختياري)</Label>
              <Input
                type="number"
                min="1"
                value={bundleCount}
                onChange={(e) => setBundleCount(e.target.value)}
              />
            </div>
            )}
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
                    {parsedBundles != null ? parsedBundles.toLocaleString("en-US") : "—"}
                  </span>
                </div>
              </div>
            </div>
            {mixedSizeWarning && (
              <div
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200 flex gap-2"
                role="alert"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                <span>
                  تنبيه: الدورة {roundNumber} تحتوي نوعاً مختلفاً (مثلاً مبروم
                  مع قصائر أو خردة) — القبان الخارجي يعطي وزناً واحداً للدورة
                  ولا يفصل بين الأنواع. إن أردت فصل كل نوع، استخدم «رجوع
                  للتحميل» وافتح دورة جديدة.
                </span>
              </div>
            )}
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
              {selectedSize?.isBundleType && (
              <div className="space-y-2">
                <Label>عدد الربطات</Label>
                <Input
                  type="number"
                  min="1"
                  value={bundleCount}
                  onChange={(e) => setBundleCount(e.target.value)}
                />
              </div>
              )}
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
                      {parsedBundles != null ? parsedBundles.toLocaleString("en-US") : "—"}
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

// ─── Delete Session Button ────────────────────────────────────────

function DeleteSessionButton({
  truckId,
  session: s,
  onDeleted,
}: {
  truckId: number;
  session: WeighSessionItem;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const weightLabel = Number(s.weightTons).toFixed(3);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/trucks/${truckId}/sessions/${s.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify({ expectedVersion: s.version }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success("تم حذف الوزنة");
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`حذف الوزنة ${s.sessionNumber}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الوزنة #{s.sessionNumber}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">سيتم حذف الوزنة التالية نهائياً:</p>
            <p className="text-2xl font-bold font-mono" dir="ltr">
              {weightLabel} <span className="text-base font-normal">طن</span>
            </p>
            {s.size?.displayName && (
              <p className="text-sm mt-2">
                <span className="text-muted-foreground">القياس: </span>
                {s.size.displayName}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirm()}
              disabled={saving}
            >
              {saving ? "جاري الحذف..." : "تأكيد الحذف"}
            </Button>
          </DialogFooter>
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
      const file = await compressImage(raw, "truck");
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

// ─── Loading Complete Dialog ────────────────────────────────────────

function LoadingCompleteDialog({
  open,
  onOpenChange,
  truckId,
  plateNumber,
  customerLabel,
  sessions,
  requestItems,
  photoCount,
  skipInternalWeighing,
  roundNumber,
  initialGrade,
  initialSizeId,
  showGradeSelect,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  truckId: number;
  plateNumber: string;
  customerLabel: string | null;
  /** Sessions of the CURRENT round only — earlier rounds are already weighed. */
  sessions: WeighSessionItem[];
  requestItems: TruckRequestItemData[];
  photoCount: number;
  /** Exempt trucks (scrap / billet wire) skip internal sessions entirely. */
  skipInternalWeighing: boolean;
  roundNumber: number;
  initialGrade: SalesOrderGrade | null;
  /** Previously chosen material of the open round (re-confirm after reopen). */
  initialSizeId: number | null;
  showGradeSelect: boolean;
  onConfirm: (
    grade?: SalesOrderGrade | null,
    sizeId?: number | null,
  ) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [grade, setGrade] = useState<SalesOrderGrade | "">(initialGrade ?? "");
  const [sizeId, setSizeId] = useState<number | null>(initialSizeId);

  // Exempt trucks carrying more than one material: the loader must declare
  // which material this round loaded (the round net is attributed to it).
  const materialOptions = skipInternalWeighing
    ? [...new Map(requestItems.map((i) => [i.sizeId, i.size])).values()]
    : [];
  const showMaterialSelect = materialOptions.length > 1;
  /** Base UI Select renders raw `value` without `items` — map id → display name. */
  const materialSelectItems = useMemo(
    () =>
      materialOptions.map((size) => ({
        value: String(size.id),
        label: size.displayName,
      })),
    [materialOptions],
  );

  // Re-sync the defaults whenever the dialog opens for a (possibly new) round.
  useEffect(() => {
    if (open) {
      setGrade(initialGrade ?? "");
      setSizeId(initialSizeId);
    }
  }, [open, initialGrade, initialSizeId]);

  const bySize = aggregateWeighSessionsBySize(sessions);
  const { rows: requestRows, warnings: requestWarnings } =
    buildRequestVsLoadedComparison(
      requestItems,
      sessions,
      showGradeSelect ? (grade === "" ? null : grade) : undefined,
    );
  const totalTons = sessions.reduce((sum, s) => sum + Number(s.weightTons), 0);
  const totalBundles =
    bySize.length > 0 && bySize.every((row) => row.totalBundles != null)
      ? bySize.reduce((sum, row) => sum + (row.totalBundles ?? 0), 0)
      : null;

  // Exempt trucks never carry internal sessions, so "nothing loaded yet"
  // comparison warnings are noise — the round net is recorded at gross.
  const warnings: string[] = skipInternalWeighing ? [] : [...requestWarnings];
  if (!skipInternalWeighing && sessions.length === 0) {
    warnings.push("لا توجد وزنات داخلية — يُفضّل إضافة وزنة واحدة على الأقل قبل التأكيد");
  }
  if (photoCount === 0) {
    warnings.push("لم تُرفع أي صورة بعد — يُفضّل رفع صورة واحدة على الأقل قبل التأكيد");
  }
  if (
    sessions.some(
      (s) => s.size?.isBundleType === true && s.bundleCount == null,
    )
  ) {
    warnings.push("بعض الوزنات لم يُسجَّل فيها عدد الربطات — راجع القائمة قبل التأكيد");
  }

  const handleConfirm = async () => {
    if (showMaterialSelect && sizeId == null) {
      toast.error("حدد مادة هذه الدورة قبل التأكيد");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(
        showGradeSelect ? (grade === "" ? null : grade) : undefined,
        showMaterialSelect ? sizeId : undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {roundNumber > 1
              ? `تأكيد اكتمال التحميل — دورة ${roundNumber}`
              : "تأكيد اكتمال التحميل"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="text-muted-foreground space-y-0.5">
            <div>
              <span className="font-medium text-foreground">عملية #{truckId}</span>
              <span className="mx-2">·</span>
              <span>{plateNumber}</span>
            </div>
            {customerLabel && <div>{customerLabel}</div>}
          </div>

          {showGradeSelect && (
            <div className="space-y-2">
              <Label>نخب هذه الدورة</Label>
              <Select
                value={grade}
                onValueChange={(v) => setGrade((v as SalesOrderGrade | "") ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر النخب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">بلا نخب (سكراب / غير مبروم)</SelectItem>
                  {(Object.entries(GRADE_LABELS) as [SalesOrderGrade, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                نخب واحد لكل دورة — إذا حمّلت الشاحنة نخبين، افصلهما بوزنة
                «رجوع للتحميل» بين الدورتين.
              </p>
            </div>
          )}

          {showMaterialSelect && (
            <div className="space-y-2">
              <Label>مادة هذه الدورة *</Label>
              <Select
                items={materialSelectItems}
                value={sizeId != null ? String(sizeId) : ""}
                onValueChange={(v) => setSizeId(v ? Number(v) : null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر المادة المحمّلة" />
                </SelectTrigger>
                <SelectContent>
                  {materialOptions.map((size) => (
                    <SelectItem key={size.id} value={String(size.id)}>
                      {size.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                مادة واحدة لكل دورة — صافي القبان لهذه الدورة سيُسجَّل تلقائياً
                على المادة المختارة. إذا حمّلت الشاحنة مادتين، افصلهما بوزنة
                «رجوع للتحميل» بين الدورتين.
              </p>
            </div>
          )}

          {requestRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">تفاصيل الطلبية مقابل المحمّل</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[280px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>القياس</TableHead>
                      <TableHead>المطلوب</TableHead>
                      <TableHead>المحمّل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requestRows.map((row) => (
                      <TableRow key={`${row.sizeId}:${row.grade ?? ""}`}>
                        <TableCell>
                          {row.displayName}
                          {row.grade && (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              — {GRADE_LABELS[row.grade]}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {row.requestedLabel}
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {row.loadedLabel}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {sessions.length > 0 && (
            <p className="text-sm font-medium">
              {requestRows.length > 0 ? "تفصيل المحمّل (حسب القياس)" : "ما تم تحميله"}
            </p>
          )}

          {sessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">لا توجد وزنات داخلية بعد</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table className="min-w-[260px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>القياس</TableHead>
                    <TableHead>الربطات</TableHead>
                    <TableHead>الوزن (طن)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySize.map((row) => (
                    <TableRow key={row.sizeId ?? "none"}>
                      <TableCell>{row.displayName}</TableCell>
                      <TableCell className="font-mono">
                        {row.totalBundles != null
                          ? row.totalBundles.toLocaleString("en-US")
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono font-semibold">
                        {row.totalTons.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell>المجموع الكلي</TableCell>
                    <TableCell className="font-mono">
                      {totalBundles != null
                        ? totalBundles.toLocaleString("en-US")
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{totalTons.toFixed(3)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {sessions.length.toLocaleString("en-US")} وزنة ·{" "}
            {photoCount.toLocaleString("en-US")} صورة
          </p>

          {warnings.length > 0 && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5 dark:bg-amber-950/30 dark:border-amber-700"
              role="alert"
            >
              {warnings.map((msg) => (
                <p key={msg} className="text-xs text-amber-900 dark:text-amber-200 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <span>{msg}</span>
                </p>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            بعد التأكيد تُجمَّد الوزنات الداخلية ولا تُعدَّل إلا بإعادة فتح التحميل (إن وُجدت
            الصلاحية).
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            تراجع
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700"
          >
            {saving ? "جاري التأكيد..." : "تأكيد اكتمال التحميل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
