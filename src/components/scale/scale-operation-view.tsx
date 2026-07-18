"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  ArrowLeft,
  ArrowRight,
  Pencil,
  Trash2,
  AlertTriangle,
  StickyNote,
} from "lucide-react";
import Link from "next/link";
import { TruckNotesDialog } from "@/components/trucks/truck-notes-dialog";
import { canShowTruckNotesButton } from "@/lib/truck-edit-ui";
import { buildFileViewUrl } from "@/lib/uploaded-file-url";
import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";
import { buildRequestVsLoadedComparison } from "@/lib/loading-complete-comparison";
import {
  computeWeighbridgeDiscrepancy,
  isWeighbridgeDiscrepancyWarning,
} from "@/lib/weighbridge-discrepancy";
import { getDisplayGrade } from "@/lib/truck-grade";
import { getTextDirection, type Locale } from "@/i18n/config";
import { formatDecimal, formatInteger, formatKg } from "@/lib/number-format";
import { shouldWarnBridgeRoundProductMix } from "@/lib/material-kind";
import type { SalesOrderGrade } from "@prisma/client";
import { compressImage } from "@/lib/compress-image";
import {
  formatDurationCompactLocalized,
  formatDurationLocalized,
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

interface SourceLocationOption {
  locationId: number;
  code: string;
  nameAr: string;
  yardNameAr: string;
  unit: "BUNDLE" | "TON";
  totalQuantity: number;
  lines: { sizeId: number | null; unit: "BUNDLE" | "TON"; quantity: number }[];
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
  externalCardNumber: string | null;
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

const statusColors: Record<string, string> = {
  Queued: "bg-gray-100 text-gray-800",
  FirstWeigh: "bg-sky-100 text-sky-800",
  OnScale: "bg-amber-100 text-amber-800",
  LoadingComplete: "bg-emerald-100 text-emerald-800",
  SecondWeigh: "bg-indigo-100 text-indigo-800",
  Completed: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
};

const GRADES: SalesOrderGrade[] = ["FIRST", "SECOND"];

export function ScaleOperationView({
  truckId,
  discrepancyWarnKg,
  stockModuleEnabled = false,
}: {
  truckId: number;
  discrepancyWarnKg: number;
  stockModuleEnabled?: boolean;
}) {
  const t = useTranslations("scale");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const isRtl = getTextDirection(locale) === "rtl";
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
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showLoadingCompleteDialog, setShowLoadingCompleteDialog] = useState(false);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
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
  const canEditApproved = sessionHasPermission(session, "truck.edit_approved");

  const fetchTruck = useCallback(async () => {
    try {
      const res = await fetch(`/api/trucks/${truckId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setTruck(json.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [truckId, t]);

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
      toast.success(t("successAction"));
      await fetchTruck();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorGeneric"));
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
        {t("notFound")}
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

  const statusColor = statusColors[truck.status] ?? "";
  const statusLabel =
    truck.status === "FirstWeigh" && openRound && openRound.roundNumber > 1
      ? t("awaitingLoadRound", { n: openRound.roundNumber })
      : statusColors[truck.status]
        ? tEnums(`truckStatus.${truck.status}`)
        : truck.status;
  const displayGrade = getDisplayGrade(truck);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="sm">
            {isRtl ? (
              <ArrowRight className="h-4 w-4 me-1" />
            ) : (
              <ArrowLeft className="h-4 w-4 me-1" />
            )}
            {t("backToList")}
          </Button>
        </Link>
        <h2 className="text-lg font-bold">
          {t("operationNumber", { id: truck.id })}
        </h2>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}>
          {statusLabel}
        </span>
        {isMultiRound && (
          <span className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-800">
            {openRound
              ? t("roundOfTotal", { current: openRound.roundNumber, total: rounds.length })
              : t("bridgeRoundsCount", { count: rounds.length })}
          </span>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {truck.customer && (
          <InfoCard
            label={t("customer")}
            value={`${truck.customer.fullName} (${truck.customer.code})`}
          />
        )}
        <InfoCard label={t("plateNumber")} value={truck.plateNumber} />
        <InfoCard label={t("driver")} value={truck.driverName} />
        <InfoCard
          label={t("destination")}
          value={
            truck.destination
              ? truck.destination.details
                ? `${truck.destination.name} - ${truck.destination.details}`
                : truck.destination.name
              : t("emDash")
          }
        />
        {displayGrade && (
          <InfoCard label={t("grade")} value={tEnums(`grade.${displayGrade}`)} />
        )}
        <InfoCard
          label={t("tareWeight")}
          value={tare != null ? t("kgValue", { value: formatKg(tare) }) : t("emDash")}
        />
        <InfoCard
          label={t("grossWeight")}
          value={gross != null ? t("kgValue", { value: formatKg(gross) }) : t("emDash")}
        />
        {truck.externalCardNumber && (
          <InfoCard label={t("externalCardNumber")} value={truck.externalCardNumber} />
        )}
      </div>

      {/* Operational note — surfaced prominently near the top, not buried in
          the footer metadata, so operators see it while working the bridge. */}
      {truck.notes && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                {t("note")}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-amber-900 dark:text-amber-100">
                {truck.notes}
              </p>
            </div>
          </div>
        </div>
      )}

      {bridgeNetKg != null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoCard
            label={t("bridgeNet")}
            value={t("kgValue", { value: formatKg(bridgeNetKg) })}
          />
          <InfoCard
            label={t("internalSessionsTotal")}
            value={t("tonsValue", { value: formatDecimal(totalSessionsTons, 3) })}
          />
          <InfoCard
            label={t("difference")}
            value={
              bridgeDiscrepancyKg != null
                ? t("kgValue", { value: formatKg(bridgeDiscrepancyKg) })
                : t("emDash")
            }
          />
          {bridgeDiscrepancyKg != null &&
            isWeighbridgeDiscrepancyWarning(bridgeDiscrepancyKg, discrepancyWarnKg) && (
              <div className="sm:col-span-3 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
                <p className="font-semibold">{t("discrepancyWarningTitle")}</p>
                <p className="mt-1 text-xs">
                  {t("discrepancyWarningDetail", {
                    diff: formatKg(bridgeDiscrepancyKg),
                    limit: formatKg(discrepancyWarnKg),
                  })}
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
            <CardTitle className="text-base">{t("requestDetails")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[360px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("size")}</TableHead>
                    {truck.requestItems.some((i) => i.grade) && (
                      <TableHead>{t("grade")}</TableHead>
                    )}
                    <TableHead>{t("requestedQty")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {truck.requestItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.size.displayName}</TableCell>
                      {truck.requestItems.some((i) => i.grade) && (
                        <TableCell>
                          {item.grade ? tEnums(`grade.${item.grade}`) : t("emDash")}
                        </TableCell>
                      )}
                      <TableCell className="font-mono">
                        {item.size.isBundleType
                          ? item.bundleCount != null
                            ? t("bundlesValue", { value: formatInteger(item.bundleCount) })
                            : t("emDash")
                          : item.requestedTons != null
                            ? t("tonsValue", {
                                value: formatDecimal(Number(item.requestedTons), 3),
                              })
                            : t("emDash")}
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
            <span className="text-muted-foreground">{t("salesOrder")}</span>
            <span className="font-medium">{truck.salesOrder.orderNumber}</span>
            <span className="text-muted-foreground mx-2">{t("emDash")}</span>
            <span>{truck.salesOrder.contract.customer.fullName}</span>
          </CardContent>
        </Card>
      )}

      {truck.cancelReason && (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm text-destructive">
            <span className="font-medium">{t("cancelReason")}</span>
            {truck.cancelReason}
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      {isActive && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("actions")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {truck.status === "Queued" && canTare && (
              <Button onClick={() => setShowTareDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                {t("enterTare")}
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
                {t("correctTare")}
              </Button>
            )}
            {(truck.status === "FirstWeigh" || truck.status === "OnScale") &&
              canSession &&
              !truck.skipInternalWeighing && (
              <Button onClick={() => setShowSessionDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                {t("addSession")}
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
                {t("confirmLoadingComplete")}
              </Button>
            )}
            {truck.status === "LoadingComplete" && canReopen && (
              <Button
                variant="outline"
                onClick={() => doAction(`/api/trucks/${truck.id}/reopen`, "POST")}
                disabled={actionLoading}
              >
                <Unlock className="h-4 w-4 me-1" />
                {t("reopenLoading")}
              </Button>
            )}
            {truck.status === "LoadingComplete" && canGross && (
              <Button onClick={() => setShowGrossDialog(true)} disabled={actionLoading}>
                <Weight className="h-4 w-4 me-1" />
                {t("enterGross")}
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
                  ? t("correctGross")
                  : t("correctLastExternal")}
              </Button>
            )}
            {truck.status === "SecondWeigh" && canClose && (
              <Button
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setShowCloseDialog(true)}
                disabled={actionLoading}
              >
                <CircleCheck className="h-4 w-4 me-1" />
                {t("closeOperation")}
              </Button>
            )}
            {canShowTruckNotesButton(truck.status, canEditApproved) && (
              <Button
                variant="outline"
                onClick={() => setShowNotesDialog(true)}
                disabled={actionLoading}
              >
                <StickyNote className="h-4 w-4 me-1" />
                {truck.notes ? t("editNote") : t("addNote")}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                onClick={() => setShowCancelDialog(true)}
                disabled={actionLoading}
              >
                <Ban className="h-4 w-4 me-1" />
                {t("cancel")}
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
              {t("printInternal")}
            </Button>
          </Link>
          <Link href={`/scale/${truck.id}/print?format=driver`} target="_blank">
            <Button variant="outline">
              <Printer className="h-4 w-4 me-1" />
              {t("printDriver")}
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
            {t("internalSessions", { count: truck.sessions.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {truck.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {truck.skipInternalWeighing ? t("scrapNoInternal") : t("noSessionsYet")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    {isMultiRound && <TableHead className="w-[60px]">{t("round")}</TableHead>}
                    <TableHead>{t("size")}</TableHead>
                    <TableHead>{t("bundles")}</TableHead>
                    <TableHead>{t("weightTons")}</TableHead>
                    {canManageSession && <TableHead className="w-[100px]">{t("actions")}</TableHead>}
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
                          {roundNumber ?? t("emDash")}
                        </TableCell>
                      )}
                      <TableCell>{s.size?.displayName ?? t("emDash")}</TableCell>
                      <TableCell>{s.bundleCount ?? t("emDash")}</TableCell>
                      <TableCell className="font-mono">
                        {formatDecimal(Number(s.weightTons), 3)}
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
                              {t("frozen")}
                            </span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                  <TableRow className="font-bold">
                    <TableCell colSpan={isMultiRound ? 4 : 3}>{t("grandTotalAllSessions")}</TableCell>
                    <TableCell className="font-mono">
                      {formatDecimal(totalSessionsTons, 3)}
                    </TableCell>
                    {canManageSession && <TableCell />}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {truck.sessions.length > 0 && (
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-sm font-medium">{t("totalBySize")}</p>
              <p className="text-xs text-muted-foreground">
                {t("totalBySizeHint")}
              </p>
              <div className="overflow-x-auto">
                <Table className="min-w-[320px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("size")}</TableHead>
                      <TableHead>{t("totalBundles")}</TableHead>
                      <TableHead>{t("totalWeightTons")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregateWeighSessionsBySize(truck.sessions).map((row) => (
                      <TableRow key={row.sizeId ?? "none"}>
                        <TableCell>{row.displayName}</TableCell>
                        <TableCell className="font-mono">
                          {row.totalBundles != null
                            ? formatInteger(row.totalBundles)
                            : t("emDash")}
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {formatDecimal(row.totalTons, 3)}
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
              {t("photos", { count: truck.photos.length })}
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
                    alt={t("photoAlt", { id: p.id })}
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
          <div>
            {t("createdBy", {
              name: truck.creator.fullName,
              time: formatDateTime(truck.createdAt),
            })}
          </div>
          {truck.closer && truck.closedAt && (
            <div>
              {truck.status === "Cancelled"
                ? t("cancelledBy", {
                    name: truck.closer.fullName,
                    time: formatDateTime(truck.closedAt),
                  })
                : t("closedBy", {
                    name: truck.closer.fullName,
                    time: formatDateTime(truck.closedAt),
                  })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <TruckNotesDialog
        truckId={showNotesDialog ? truck.id : null}
        open={showNotesDialog}
        onOpenChange={setShowNotesDialog}
        onSuccess={fetchTruck}
      />
      <WeightDialog
        open={showTareDialog}
        onOpenChange={setShowTareDialog}
        title={t("enterTareTitle")}
        onSubmit={(kg) => doAction(`/api/trucks/${truck.id}/tare`, "PATCH", { weightKg: kg })}
      />
      <WeightDialog
        open={showGrossDialog}
        onOpenChange={setShowGrossDialog}
        title={
          openRound && openRound.roundNumber > 1
            ? t("enterRoundGrossTitle", { n: openRound.roundNumber })
            : t("enterGrossTitle")
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
        title={t("correctTareTitle")}
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
            ? t("correctRoundGrossTitle", { n: lastClosedRound.roundNumber })
            : t("correctGrossTitle")
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
        stockModuleEnabled={stockModuleEnabled}
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
      <CloseDialog
        open={showCloseDialog}
        onOpenChange={setShowCloseDialog}
        truckId={truck.id}
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
  const t = useTranslations("scale");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const listSeparator = locale === "en" ? ", " : "، ";
  const totalNetKg = rounds.reduce((sum, r) => {
    if (r.endWeightKg == null) return sum;
    return sum + (Number(r.endWeightKg) - Number(r.startWeightKg));
  }, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t("bridgeRoundsTitle", { count: rounds.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-2">
          {t("bridgeRoundsHint")}
        </p>
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>{t("grade")}</TableHead>
                <TableHead>{t("loadedProducts")}</TableHead>
                <TableHead>{t("startWeightKg")}</TableHead>
                <TableHead>{t("endWeightKg")}</TableHead>
                <TableHead>{t("approvedNetKg")}</TableHead>
                <TableHead>{t("vsInternalDiff")}</TableHead>
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
                    <TableCell>{r.grade ? tEnums(`grade.${r.grade}`) : t("emDash")}</TableCell>
                    <TableCell className="text-xs">
                      {sizeNames.length > 0
                        ? sizeNames.join(listSeparator)
                        : r.size?.displayName ?? t("emDash")}
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatKg(startKg)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {endKg != null ? (
                        formatKg(endKg)
                      ) : (
                        <span className="text-amber-600">{t("roundInProgress")}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {netKg != null ? formatKg(netKg) : t("emDash")}
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
                          {t("kgValue", { value: formatKg(Math.round(discrepancyKg)) })}
                        </span>
                      ) : (
                        t("emDash")
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-bold bg-muted/50">
                <TableCell colSpan={5}>{t("approvedNetTotal")}</TableCell>
                <TableCell className="font-mono">
                  {formatKg(totalNetKg)}
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
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;

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
      label: t("stepRegistered"),
      time: createdAt,
    },
    {
      label: t("stepTareEntry"),
      time: tareTime,
      durationLabel: t("waitTime"),
      durationMs: timings.waitMs,
    },
    {
      label: t("stepFirstInternal"),
      time: timings.firstSessionAt,
    },
    {
      label: t("stepLoadingConfirmed"),
      time: timings.loadingConfirmedAt,
      durationLabel: t("internalLoadingDuration"),
      durationMs: timings.internalLoadingMs,
      inProgress: timings.internalLoadingInProgress,
      subtitle: timings.loaderName
        ? t("byLoader", { name: timings.loaderName })
        : undefined,
    },
    {
      label: t("stepGrossExit"),
      time: grossTime,
      durationLabel: t("scaleDuration"),
      durationMs: timings.scaleMs,
      highlight: true,
      inProgress: timings.scaleInProgress,
    },
  ];

  if (closedAt) {
    steps.push({
      label: status === "Cancelled" ? t("stepCancelled") : t("stepClosed"),
      time: closedAt,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("timelineTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricBox
            label={t("waitTime")}
            sublabel={t("waitTimeSub")}
            valueMs={timings.waitMs}
            locale={locale}
          />
          <MetricBox
            label={
              timings.scaleInProgress ? t("scaleDurationRunning") : t("scaleDuration")
            }
            sublabel={t("scaleDurationSub")}
            valueMs={timings.scaleMs}
            emphasize="scale"
            pulse={timings.scaleInProgress}
            locale={locale}
          />
          <MetricBox
            label={
              timings.internalLoadingInProgress
                ? t("internalLoadingDurationRunning")
                : t("internalLoadingDuration")
            }
            sublabel={t("internalLoadingDurationSub")}
            valueMs={timings.internalLoadingMs}
            emphasize="internal"
            pulse={timings.internalLoadingInProgress}
            locale={locale}
          />
          <MetricBox
            label={t("totalDuration")}
            sublabel={t("totalDurationSub")}
            valueMs={timings.totalMs}
            locale={locale}
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
                      ? t("waitingNow")
                      : t("notHappenedYet")}
                </span>
              </div>
              {step.subtitle && (
                <div className="mt-0.5 text-xs text-muted-foreground">{step.subtitle}</div>
              )}
              {step.durationMs != null && step.durationLabel && (
                <div className="mt-1 text-xs text-muted-foreground">
                  <span>{step.durationLabel}: </span>
                  <span className="font-semibold text-foreground">
                    {formatDurationLocalized(step.durationMs, locale)}
                  </span>
                  {step.inProgress && (
                    <span className="ms-2 text-amber-600">{t("inProgressNow")}</span>
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
  locale,
}: {
  label: string;
  sublabel: string;
  valueMs: number | null;
  emphasize?: "scale" | "internal";
  pulse?: boolean;
  locale: Locale;
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
        {formatDurationCompactLocalized(valueMs, locale)}
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
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
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
      toast.error(t("toastInvalidWeight"));
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
      <DialogContent dir={dir} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <form onSubmit={handleNext} className="space-y-4">
            {currentValue !== undefined && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("currentValue")}</span>
                <span className="font-mono font-semibold">
                  {t("kgValue", { value: formatKg(currentValue) })}
                </span>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("weightKgLabel")}</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("weightKgPlaceholder")}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!isValid}>
                {t("next")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            {showDiscrepancyWarning && discrepancyPreview && crossCheck && (
              <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200">
                <p className="font-bold">{t("discrepancyWarningTitle")}</p>
                <div className="mt-2 space-y-1 font-mono text-xs sm:text-sm">
                  <p>
                    {t("bridgeNetLabel")}
                    {t("kgValue", { value: formatKg(discrepancyPreview.bridgeNetKg) })}
                  </p>
                  <p>
                    {t("internalTotalLabel")}
                    {t("kgValue", { value: formatKg(discrepancyPreview.internalKg) })}
                  </p>
                  <p className="font-semibold">
                    {t("differenceWithLimit", {
                      diff: formatKg(discrepancyPreview.discrepancyKg),
                      limit: formatKg(crossCheck.discrepancyWarnKg),
                    })}
                  </p>
                </div>
                <p className="mt-2 text-xs">
                  {t("discrepancyContinueHint")}
                </p>
              </div>
            )}
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
              <p className="text-sm text-muted-foreground mb-1">{t("confirmValuePrompt")}</p>
              <p className="text-3xl font-bold font-mono" dir="ltr">
                {t("kgValue", { value: formatKg(parsedKg) })}
              </p>
              {exitChoice && roundNetPreview != null && (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("roundNetPreview", { n: exitChoice.roundNumber })}
                  </span>
                  <span className="font-mono font-semibold" dir="ltr">
                    {t("kgValue", { value: formatKg(roundNetPreview) })}
                  </span>
                </p>
              )}
            </div>
            {exitChoice ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {t("exitChoiceHint")}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleConfirm("final")}
                    disabled={submitting}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {submittingExit === "final"
                      ? t("saving")
                      : t("confirmFinalExit")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleConfirm("return")}
                    disabled={submitting}
                    className="border border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-100"
                  >
                    {submittingExit === "return"
                      ? t("saving")
                      : t("confirmReturnLoad", { n: exitChoice.roundNumber + 1 })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirming(false)}
                    disabled={submitting}
                  >
                    {t("editValue")}
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
                  {t("editValue")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={submitting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {submitting ? t("saving") : t("confirmSave")}
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

// Sentinel value for material loaded straight off the production line — it
// never entered the yard, so no stock location applies and nothing is deducted.
const PRODUCTION_SOURCE = "__production__";

function SessionDialog({
  open,
  onOpenChange,
  truckId,
  sizes,
  currentRoundSessions,
  roundNumber,
  onSuccess,
  stockModuleEnabled = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  truckId: number;
  sizes: SizeOption[];
  /** Sessions already recorded in the current bridge round. */
  currentRoundSessions: WeighSessionItem[];
  roundNumber: number;
  onSuccess: () => void;
  /** When false the stock module is dark-launched: no source picker, no deduction. */
  stockModuleEnabled?: boolean;
}) {
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [sizeCode, setSizeCode] = useState<string>("");
  const [bundleCount, setBundleCount] = useState("");
  const [weightTons, setWeightTons] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [sources, setSources] = useState<SourceLocationOption[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedWeight = parseFloat(weightTons);
  const parsedBundles = bundleCount ? parseInt(bundleCount, 10) : null;
  const selectedSize = sizes.find((s) => s.code === sizeCode);

  // Load current stock balances to offer source locations. The internal loader
  // role holds stock.view, so this succeeds for whoever enters weigh sessions.
  useEffect(() => {
    // Dark-launch: skip the stock lookup entirely while the module is hidden
    // (the endpoint 404s and no source picker is shown).
    if (!open || !stockModuleEnabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stock/balances");
        const json = await res.json();
        if (!cancelled && json.success) {
          setSources(json.data as SourceLocationOption[]);
        }
      } catch {
        /* picker just stays empty; entry can still proceed if stock is unset */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stockModuleEnabled]);

  // Source candidates matching the counting unit implied by the chosen size.
  const neededUnit: "BUNDLE" | "TON" | null = selectedSize
    ? selectedSize.isBundleType
      ? "BUNDLE"
      : "TON"
    : null;

  // Only locations that actually hold stock matching the chosen size (for
  // bundles) or any stock (for tons). Empty / other-size locations are hidden
  // entirely — the loader should never pick a source the system says is empty.
  const sourceOptions = useMemo(() => {
    if (!neededUnit) return [];
    return sources
      .filter((s) => s.unit === neededUnit)
      .map((s) => {
        const qty =
          neededUnit === "BUNDLE" && selectedSize
            ? s.lines.find((l) => l.unit === "BUNDLE" && l.sizeId === selectedSize.id)
                ?.quantity ?? 0
            : s.totalQuantity;
        return { loc: s, qty };
      })
      .filter((o) => o.qty > 0)
      .sort((a, b) => b.qty - a.qty);
  }, [sources, neededUnit, selectedSize]);

  // Group the matching locations by yard (front / back) for a clearer list.
  const sourceYardGroups = useMemo(() => {
    const map = new Map<string, typeof sourceOptions>();
    for (const o of sourceOptions) {
      const arr = map.get(o.loc.yardNameAr) ?? [];
      arr.push(o);
      map.set(o.loc.yardNameAr, arr);
    }
    return [...map.entries()].map(([yardNameAr, options]) => ({ yardNameAr, options }));
  }, [sourceOptions]);

  const isProductionSource = sourceId === PRODUCTION_SOURCE;
  const selectedSource = isProductionSource
    ? null
    : sources.find((s) => String(s.locationId) === sourceId) ?? null;
  const sourceIsBundle = selectedSource?.unit === "BUNDLE";

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const sourceSelectItems = useMemo(
    () => [
      { value: PRODUCTION_SOURCE, label: t("fromProduction") },
      ...sourceOptions.map((o) => ({
        value: String(o.loc.locationId),
        label: `${o.loc.nameAr} — ${o.loc.yardNameAr}`,
      })),
    ],
    [sourceOptions, t],
  );
  const sizeSelectItems = useMemo(
    () => sizes.map((s) => ({ value: s.code, label: s.displayName })),
    [sizes],
  );

  // Bundle count is required for bundle-type sizes. When the stock module is
  // live this is driven by the chosen source's unit; while dark-launched (no
  // source picker) it falls back to the size's own type.
  const bundleRequired = stockModuleEnabled
    ? sourceIsBundle
    : !!selectedSize?.isBundleType;

  // With the stock module live the operator must state the source explicitly
  // (a yard location or the production line). While dark-launched there is no
  // source field, so the session validates on weight (+ bundles) alone.
  const isValid =
    !isNaN(parsedWeight) &&
    parsedWeight > 0 &&
    (!stockModuleEnabled || isProductionSource || !!selectedSource) &&
    (!bundleRequired || (parsedBundles != null && parsedBundles > 0));

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
    setSourceId("");
    setConfirming(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(parsedWeight) || parsedWeight <= 0) {
      toast.error(t("toastInvalidWeight"));
      return;
    }
    if (stockModuleEnabled && !isProductionSource && !selectedSource) {
      toast.error(t("toastSelectSource"));
      return;
    }
    if (bundleRequired && (parsedBundles == null || parsedBundles <= 0)) {
      toast.error(t("toastBundlesRequired"));
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
      if (selectedSource) body.sourceLocationId = selectedSource.locationId;
      // Direct-from-production cross-dock: no yard source; the server writes a
      // paired receipt + load-out on the virtual location at close.
      if (isProductionSource) body.fromProduction = true;

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
      toast.success(t("sessionAdded"));
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorShort"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent dir={dir} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addInternalSessionTitle")}</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <form onSubmit={handleNext} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("size")}</Label>
              <Select
                items={sizeSelectItems}
                value={sizeCode}
                onValueChange={(v) => {
                  setSizeCode(v ?? "");
                  setSourceId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectSize")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {sizes.map((s) => (
                    <SelectItem key={s.id} value={s.code}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {stockModuleEnabled && (
            <div className="space-y-2">
              <Label>{t("source")}</Label>
              <Select
                items={sourceSelectItems}
                value={sourceId}
                onValueChange={(v) => setSourceId(v ?? "")}
                disabled={!selectedSize}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      selectedSize ? t("selectSource") : t("selectSizeFirst")
                    }
                  />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  <SelectItem value={PRODUCTION_SOURCE}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="font-medium">{t("fromProduction")}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("noYardDeduction")}
                      </span>
                    </span>
                  </SelectItem>
                  {sourceOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {selectedSize ? t("noStockForSize") : t("noMatchingLocations")}
                    </div>
                  ) : (
                    sourceYardGroups.map((g) => (
                      <SelectGroup key={g.yardNameAr}>
                        <SelectLabel className="font-semibold">
                          {g.yardNameAr}
                        </SelectLabel>
                        {g.options.map((o) => (
                          <SelectItem
                            key={o.loc.locationId}
                            value={String(o.loc.locationId)}
                          >
                            <span className="flex w-full items-center justify-between gap-3">
                              <span>{o.loc.nameAr}</span>
                              <span
                                className="text-xs tabular-nums text-muted-foreground"
                                dir="ltr"
                              >
                                {o.loc.unit === "TON"
                                  ? t("tonsValue", {
                                      value: formatDecimal(o.qty, 3),
                                    })
                                  : t("bundlesValue", {
                                      value: formatInteger(o.qty),
                                    })}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            )}
            {selectedSize?.isBundleType && (
            <div className="space-y-2">
              <Label>{t("bundleCount")}</Label>
              <Input
                type="number"
                min="1"
                value={bundleCount}
                onChange={(e) => setBundleCount(e.target.value)}
              />
            </div>
            )}
            <div className="space-y-2">
              <Label>{t("weightTonsLabel")}</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={weightTons}
                onChange={(e) => setWeightTons(e.target.value)}
                placeholder={t("weightTonsPlaceholder")}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!isValid}>
                {t("next")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
              <p className="text-sm text-muted-foreground mb-1">{t("confirmAddSessionPrompt")}</p>
              <p className="text-3xl font-bold font-mono" dir="ltr">
                {t("tonsValue", { value: formatDecimal(parsedWeight, 3) })}
              </p>
              <div className="mt-2 text-sm space-y-0.5">
                <div>
                  <span className="text-muted-foreground">{t("sizeLabel")}</span>
                  <span className="font-medium">{selectedSize?.displayName ?? t("emDash")}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("bundlesLabel")}</span>
                  <span className="font-medium">
                    {parsedBundles != null ? formatInteger(parsedBundles) : t("emDash")}
                  </span>
                </div>
                {stockModuleEnabled && (
                <div>
                  <span className="text-muted-foreground">{t("sourceLabel")}</span>
                  <span className="font-medium">
                    {isProductionSource
                      ? t("productionSourceConfirm")
                      : selectedSource
                        ? `${selectedSource.code} — ${selectedSource.nameAr}`
                        : t("emDash")}
                  </span>
                </div>
                )}
              </div>
            </div>
            {mixedSizeWarning && (
              <div
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200 flex gap-2"
                role="alert"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                <span>
                  {t("mixedSizeWarning", { n: roundNumber })}
                </span>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                {t("editValues")}
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={saving}
                className="bg-green-600 hover:bg-green-700"
              >
                {saving ? t("saving") : t("confirmAdd")}
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
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
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
      toast.error(t("toastInvalidWeight"));
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
      toast.success(t("sessionEdited"));
      setConfirming(false);
      setOpen(false);
      onEdited();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorShort"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("edit")}
      </Button>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent dir={dir} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("editSessionTitle", { n: s.sessionNumber })}</DialogTitle>
          </DialogHeader>

          {!confirming ? (
            <form onSubmit={handleNext} className="space-y-4">
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("currentValue")}</span>
                <span className="font-mono font-semibold">
                  {t("tonsValue", { value: formatDecimal(originalWeight, 3) })}
                </span>
              </div>
              <div className="space-y-2">
                <Label>{t("size")}</Label>
                <Select
                  items={sizes.map((sz) => ({ value: sz.code, label: sz.displayName }))}
                  value={sizeCode}
                  onValueChange={(v) => setSizeCode(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("selectSize")} />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
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
                <Label>{t("bundleCount")}</Label>
                <Input
                  type="number"
                  min="1"
                  value={bundleCount}
                  onChange={(e) => setBundleCount(e.target.value)}
                />
              </div>
              )}
              <div className="space-y-2">
                <Label>{t("weightTonsLabel")}</Label>
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
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={!isValid}>
                  {t("next")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-950/30 dark:border-amber-700">
                <p className="text-sm text-muted-foreground mb-1">{t("confirmEditSessionPrompt")}</p>
                <p className="text-3xl font-bold font-mono" dir="ltr">
                  {t("tonsValue", { value: formatDecimal(parsedWeight, 3) })}
                </p>
                <div className="mt-2 text-sm space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">{t("sizeLabel")}</span>
                    <span className="font-medium">{selectedSize?.displayName ?? t("emDash")}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("bundlesLabel")}</span>
                    <span className="font-medium">
                      {parsedBundles != null ? formatInteger(parsedBundles) : t("emDash")}
                    </span>
                  </div>
                  <div className="pt-1 text-xs text-muted-foreground">
                    {t("previousValue", { value: formatDecimal(originalWeight, 3) })}
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                  {t("editValues")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {saving ? t("saving") : t("confirmEdit")}
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
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const weightLabel = formatDecimal(Number(s.weightTons), 3);

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
      toast.success(t("sessionDeleted"));
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorShort"));
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
        aria-label={t("deleteSessionAria", { n: s.sessionNumber })}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir={dir} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteSessionTitle", { n: s.sessionNumber })}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">{t("deleteSessionPrompt")}</p>
            <p className="text-2xl font-bold font-mono" dir="ltr">
              {t("tonsValue", { value: weightLabel })}
            </p>
            {s.size?.displayName && (
              <p className="text-sm mt-2">
                <span className="text-muted-foreground">{t("sizeLabel")}</span>
                {s.size.displayName}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirm()}
              disabled={saving}
            >
              {saving ? t("deleting") : t("confirmDelete")}
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
  const t = useTranslations("scale");
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
      toast.success(t("photoUploaded"));
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("photoUploadError"));
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
        {uploading ? t("uploading") : t("uploadPhoto")}
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
  const t = useTranslations("scale");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
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
    warnings.push(t("warnNoInternalSessions"));
  }
  if (photoCount === 0) {
    warnings.push(t("warnNoPhotos"));
  }
  if (
    sessions.some(
      (s) => s.size?.isBundleType === true && s.bundleCount == null,
    )
  ) {
    warnings.push(t("warnMissingBundles"));
  }

  const handleConfirm = async () => {
    if (showMaterialSelect && sizeId == null) {
      toast.error(t("toastSelectRoundMaterial"));
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
      <DialogContent dir={dir} className="max-w-sm max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {roundNumber > 1
              ? t("loadingCompleteRoundTitle", { n: roundNumber })
              : t("loadingCompleteTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="text-muted-foreground space-y-0.5">
            <div>
              <span className="font-medium text-foreground">
                {t("operationNumber", { id: truckId })}
              </span>
              <span className="mx-2">{t("emDash")}</span>
              <span>{plateNumber}</span>
            </div>
            {customerLabel && <div>{customerLabel}</div>}
          </div>

          {showGradeSelect && (
            <div className="space-y-2">
              <Label>{t("roundGrade")}</Label>
              <Select
                value={grade}
                onValueChange={(v) => setGrade((v as SalesOrderGrade | "") ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectGrade")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  <SelectItem value="">{t("noGradeScrap")}</SelectItem>
                  {GRADES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {tEnums(`grade.${g}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("roundGradeHint")}
              </p>
            </div>
          )}

          {showMaterialSelect && (
            <div className="space-y-2">
              <Label>{t("roundMaterial")}</Label>
              <Select
                items={materialSelectItems}
                value={sizeId != null ? String(sizeId) : ""}
                onValueChange={(v) => setSizeId(v ? Number(v) : null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectMaterial")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {materialOptions.map((size) => (
                    <SelectItem key={size.id} value={String(size.id)}>
                      {size.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("roundMaterialHint")}
              </p>
            </div>
          )}

          {requestRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("requestVsLoaded")}</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[280px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("size")}</TableHead>
                      <TableHead>{t("requested")}</TableHead>
                      <TableHead>{t("loaded")}</TableHead>
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
                              {t("emDash")} {tEnums(`grade.${row.grade}`)}
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
              {requestRows.length > 0 ? t("loadedBySize") : t("whatWasLoaded")}
            </p>
          )}

          {sessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">{t("noInternalSessionsYet")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table className="min-w-[260px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("size")}</TableHead>
                    <TableHead>{t("bundles")}</TableHead>
                    <TableHead>{t("weightTons")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySize.map((row) => (
                    <TableRow key={row.sizeId ?? "none"}>
                      <TableCell>{row.displayName}</TableCell>
                      <TableCell className="font-mono">
                        {row.totalBundles != null
                          ? formatInteger(row.totalBundles)
                          : t("emDash")}
                      </TableCell>
                      <TableCell className="font-mono font-semibold">
                        {formatDecimal(row.totalTons, 3)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell>{t("grandTotal")}</TableCell>
                    <TableCell className="font-mono">
                      {totalBundles != null
                        ? formatInteger(totalBundles)
                        : t("emDash")}
                    </TableCell>
                    <TableCell className="font-mono">{formatDecimal(totalTons, 3)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t("sessionsPhotosCount", {
              sessions: formatInteger(sessions.length),
              photos: formatInteger(photoCount),
            })}
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
            {t("loadingCompleteFreezeHint")}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("goBack")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700"
          >
            {saving ? t("confirming") : t("confirmLoadingComplete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Close Dialog ─────────────────────────────────────────────────
//
// Closing is refused (client- and server-side) until the operator types the
// weighbridge-card number issued by the finance-side legacy scale program
// for this same exit, so both systems always share one card number.

function CloseDialog({
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
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [cardNumber, setCardNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (v: boolean) => {
    if (!v) setCardNumber("");
    onOpenChange(v);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardNumber.trim()) {
      toast.error(t("toastCardRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/trucks/${truckId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify({ externalCardNumber: cardNumber.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(t("operationClosed"));
      setCardNumber("");
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorShort"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir={dir} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("closeOperation")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="external-card-number">{t("externalCardNumber")}</Label>
            <Input
              id="external-card-number"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder={t("cardNumberPlaceholder")}
              maxLength={30}
              autoFocus
              dir="ltr"
              className="text-start font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {t("closeCardHint")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("goBack")}
            </Button>
            <Button
              type="submit"
              className="bg-green-600 hover:bg-green-700"
              disabled={saving || !cardNumber.trim()}
            >
              {saving ? t("closing") : t("confirmClose")}
            </Button>
          </DialogFooter>
        </form>
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
  const t = useTranslations("scale");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error(t("toastCancelReasonRequired"));
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
      toast.success(t("operationCancelled"));
      setReason("");
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorShort"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("stepCancelled")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t("cancelReasonLabel")}</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t("cancelReasonPlaceholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("goBack")}
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? t("cancelling") : t("confirmCancel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
