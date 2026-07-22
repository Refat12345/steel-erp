"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { formatDecimal, formatInteger } from "@/lib/number-format";
import { formatDateTime } from "@/lib/date-format";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  Loader2,
  PackagePlus,
  ClipboardList,
  Sun,
  Moon,
  Clock3,
  UserRound,
  TriangleAlert,
} from "lucide-react";
import {
  segmentTrackedUnits,
  isDualUnitSegment,
  segmentEnforcesOneSize,
  naturalShiftOf,
  inShiftGraceWindow,
  previousShiftOf,
  SHIFT_VALUES,
  type ShiftValue,
  type Segment,
  type StockUnit,
  type SizeOption,
} from "./stock-shared";

interface TodayEntry {
  id: number;
  createdAt: string;
  locationId: number;
  locationCode: string;
  locationNameAr: string;
  sizeId: number | null;
  sizeName: string | null;
  segment: Segment;
  quantity: number;
  unit: StockUnit;
  shift: ShiftValue;
  createdBy: string;
}

type PairGap = "missing_bundles" | "missing_tons";

interface IncompletePair {
  key: string;
  locationId: number;
  sizeId: number | null;
  locationNameAr: string;
  sizeName: string | null;
  gap: PairGap;
}

type EntryMode = "production" | "opening";

interface LocationOption {
  id: number;
  code: string;
  nameAr: string;
  segment: Segment;
  unit: StockUnit;
  allowedGrade: "FIRST" | "SECOND" | null;
  isActive: boolean;
  yardNameAr: string;
  expectedSize: { id: number; displayName: string } | null;
  /** Positive BUNDLE balance size when the bay is occupied — wins over expectedSize. */
  currentSize: { id: number; displayName: string } | null;
}

interface ApiYard {
  nameAr: string;
  locations: Array<{
    id: number;
    code: string;
    nameAr: string;
    segment: Segment;
    unit: StockUnit;
    allowedGrade: "FIRST" | "SECOND" | null;
    isActive: boolean;
    expectedSize: { id: number; displayName: string } | null;
  }>;
}

export function ProductionInForm({
  mode = "production",
  allowedUnits = ["BUNDLE", "TON"],
}: {
  mode?: EntryMode;
  /** Counting units the current user may enter (from their permissions). */
  allowedUnits?: StockUnit[];
}) {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const endpoint =
    mode === "production" ? "/api/stock/movements" : "/api/stock/opening-balance";
  const title =
    mode === "production" ? t("productionInFormTitle") : t("openingBalanceFormTitle");
  const submitLabel =
    mode === "production" ? t("productionInSubmit") : t("openingBalanceSubmit");
  const successMsg =
    mode === "production" ? t("productionInSuccess") : t("openingBalanceSuccess");
  const Icon = mode === "production" ? PackagePlus : ClipboardList;

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [locationId, setLocationId] = useState("");
  const [unit, setUnit] = useState<StockUnit | "">("");
  const [sizeId, setSizeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [todayEntries, setTodayEntries] = useState<TodayEntry[]>([]);
  const quantityRef = useRef<HTMLInputElement>(null);
  const formCardRef = useRef<HTMLDivElement>(null);

  // Wall clock, refreshed every 30 s — drives the shift grace-window UI so the
  // toggle appears/disappears on time even if the page stays open for hours.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Shift grace window: within 30 min after a boundary (08:00 / 20:00) the
  // clerk may assign the entry to the shift that just ended. Defaults to the
  // PREVIOUS shift — the most likely case (late recording of finished work).
  const inGrace = mode === "production" && inShiftGraceWindow(now);
  const [graceShift, setGraceShift] = useState<"previous" | "current">("previous");

  // A fresh key per distinct payload: any change to the core fields mints a new
  // key so a double-tap / retry of the *same* entry is deduped server-side,
  // while an edited entry gets its own key (no false 409).
  const [idemKey, setIdemKey] = useState(() => createClientIdempotencyKey());
  useEffect(() => {
    setIdemKey(createClientIdempotencyKey());
  }, [locationId, unit, sizeId, quantity, graceShift]);

  const showToday = mode === "production";

  const applyCurrentSizes = useCallback(
    (
      yards: ApiYard[],
      balances: Array<{
        locationId: number;
        lines: Array<{
          sizeId: number | null;
          sizeName: string | null;
          unit: StockUnit;
          quantity: number;
        }>;
      }>,
    ) => {
      const currentSizeByLoc = new Map<number, { id: number; displayName: string }>();
      for (const bal of balances) {
        const line = bal.lines.find(
          (ln) => ln.unit === "BUNDLE" && ln.sizeId != null && ln.quantity > 0,
        );
        if (line?.sizeId != null) {
          currentSizeByLoc.set(bal.locationId, {
            id: line.sizeId,
            displayName: line.sizeName ?? String(line.sizeId),
          });
        }
      }
      return yards.flatMap((y) =>
        y.locations
          .filter((l) => l.isActive)
          .map((l) => ({
            ...l,
            yardNameAr: y.nameAr,
            currentSize: currentSizeByLoc.get(l.id) ?? null,
          })),
      );
    },
    [],
  );

  const fetchToday = useCallback(async () => {
    if (!showToday) return;
    try {
      const res = await fetch("/api/stock/production-today");
      const json = await res.json();
      if (json.success) setTodayEntries(json.data as TodayEntry[]);
    } catch {
      // Non-critical: the entry form still works without the feed.
    }
  }, [showToday]);

  /** Refresh occupied-bay sizes after a successful inbound so the lock tracks reality. */
  const refreshCurrentSizes = useCallback(async () => {
    try {
      const [locRes, balRes] = await Promise.all([
        fetch("/api/stock/locations"),
        fetch("/api/stock/balances"),
      ]);
      const locJson = await locRes.json();
      const balJson = await balRes.json();
      if (!locJson.success || !balJson.success) return;
      setLocations(applyCurrentSizes(locJson.data.yards as ApiYard[], balJson.data));
    } catch {
      // Non-critical.
    }
  }, [applyCurrentSizes]);

  useEffect(() => {
    void fetchToday();
  }, [fetchToday]);

  useEffect(() => {
    (async () => {
      try {
        const [locRes, balRes] = await Promise.all([
          fetch("/api/stock/locations"),
          fetch("/api/stock/balances"),
        ]);
        const locJson = await locRes.json();
        const balJson = await balRes.json();
        if (!locJson.success) {
          toast.error(locJson.error || t("errorLoadLocations"));
          return;
        }
        setLocations(
          applyCurrentSizes(
            locJson.data.yards as ApiYard[],
            balJson.success ? balJson.data : [],
          ),
        );
        setSizes(
          (locJson.data.sizes as (SizeOption & { isBundleType: boolean })[]).filter(
            (s) => s.isBundleType,
          ),
        );
      } catch {
        toast.error(t("errorConnection"));
      } finally {
        setLoading(false);
      }
    })();
  }, [t, applyCurrentSizes]);

  const selected = useMemo(
    () => locations.find((l) => String(l.id) === locationId) ?? null,
    [locations, locationId],
  );

  // Units the user can enter AT this location = tracked units ∩ allowed units.
  const enterableUnits = useMemo<StockUnit[]>(() => {
    if (!selected) return [];
    const tracked = segmentTrackedUnits(selected.segment);
    return tracked.filter((u) => allowedUnits.includes(u));
  }, [selected, allowedUnits]);

  const effectiveUnit: StockUnit | "" =
    enterableUnits.length === 1 ? enterableUnits[0] : unit;

  // Rebar sites need a size for BOTH units; short-bar (ton) never does.
  const needsSize = selected != null && isDualUnitSegment(selected.segment);
  const isBundle = effectiveUnit === "BUNDLE";
  // GENERAL / GOVERNORATES: lock size. Occupied bay → current balance size;
  // empty bay → expectedSize from location settings. ISOLATION stays free.
  const lockedSize =
    selected != null && segmentEnforcesOneSize(selected.segment)
      ? (selected.currentSize ?? selected.expectedSize)
      : null;
  const sizeLocked = lockedSize != null;
  const lockedSizeLabel = lockedSize?.displayName ?? "";
  const sizeLockedFromBalance = selected?.currentSize != null;

  // Keep submitted sizeId in sync with the locked display value.
  useEffect(() => {
    if (!sizeLocked || !lockedSize) return;
    const locked = String(lockedSize.id);
    if (sizeId !== locked) setSizeId(locked);
  }, [sizeLocked, lockedSize, sizeId]);

  // Feed grouped by work shift, with per-shift totals for a quick sanity read.
  const shiftGroups = useMemo(() => {
    return SHIFT_VALUES.map((s) => {
      const entries = todayEntries.filter((e) => e.shift === s);
      const bundles = entries
        .filter((e) => e.unit === "BUNDLE")
        .reduce((sum, e) => sum + e.quantity, 0);
      const tons = entries
        .filter((e) => e.unit === "TON")
        .reduce((sum, e) => sum + e.quantity, 0);
      return { shift: s, entries, bundles, tons };
    });
  }, [todayEntries]);

  const dayTotals = useMemo(() => {
    const bundles = todayEntries
      .filter((e) => e.unit === "BUNDLE")
      .reduce((sum, e) => sum + e.quantity, 0);
    const tons = todayEntries
      .filter((e) => e.unit === "TON")
      .reduce((sum, e) => sum + e.quantity, 0);
    return { bundles, tons, count: todayEntries.length };
  }, [todayEntries]);

  // Rebar sites need both units for the same location+size today. Short-bar
  // is ton-only and never appears here. Used to highlight incomplete pairs
  // (e.g. tons recorded, bundles still missing).
  const incompletePairs = useMemo(() => {
    const groups = new Map<
      string,
      {
        locationId: number;
        sizeId: number | null;
        locationNameAr: string;
        sizeName: string | null;
        bundles: number;
        tons: number;
      }
    >();
    for (const e of todayEntries) {
      if (!isDualUnitSegment(e.segment)) continue;
      const key = `${e.locationId}:${e.sizeId ?? "null"}`;
      const g = groups.get(key) ?? {
        locationId: e.locationId,
        sizeId: e.sizeId,
        locationNameAr: e.locationNameAr,
        sizeName: e.sizeName,
        bundles: 0,
        tons: 0,
      };
      if (e.unit === "BUNDLE") g.bundles += e.quantity;
      else g.tons += e.quantity;
      if (!g.sizeName && e.sizeName) g.sizeName = e.sizeName;
      groups.set(key, g);
    }
    const out: IncompletePair[] = [];
    for (const [key, g] of groups) {
      if (g.tons > 0 && g.bundles <= 0) {
        out.push({
          key,
          locationId: g.locationId,
          sizeId: g.sizeId,
          locationNameAr: g.locationNameAr,
          sizeName: g.sizeName,
          gap: "missing_bundles",
        });
      } else if (g.bundles > 0 && g.tons <= 0) {
        out.push({
          key,
          locationId: g.locationId,
          sizeId: g.sizeId,
          locationNameAr: g.locationNameAr,
          sizeName: g.sizeName,
          gap: "missing_tons",
        });
      }
    }
    return out;
  }, [todayEntries]);

  const incompleteByKey = useMemo(() => {
    const map = new Map<string, PairGap>();
    for (const p of incompletePairs) map.set(p.key, p.gap);
    return map;
  }, [incompletePairs]);

  function entryPairKey(e: TodayEntry): string {
    return `${e.locationId}:${e.sizeId ?? "null"}`;
  }

  // Today's already-recorded totals at the selected location+size — shown in
  // the form so the clerk immediately sees what their colleague entered.
  const selectedTodayTotals = useMemo(() => {
    if (!selected) return null;
    const relevant = todayEntries.filter(
      (e) =>
        e.locationId === selected.id &&
        (!needsSize || !sizeId || e.sizeId === Number(sizeId)),
    );
    if (relevant.length === 0) return null;
    const bundles = relevant
      .filter((e) => e.unit === "BUNDLE")
      .reduce((sum, e) => sum + e.quantity, 0);
    const tons = relevant
      .filter((e) => e.unit === "TON")
      .reduce((sum, e) => sum + e.quantity, 0);
    return { bundles, tons };
  }, [selected, todayEntries, needsSize, sizeId]);

  /** One-tap fix from the pair-gap alert: pre-fill location, size, and the
   *  missing unit, then focus the quantity input. */
  function quickFillFromGap(p: IncompletePair) {
    const missingUnit: StockUnit = p.gap === "missing_bundles" ? "BUNDLE" : "TON";
    if (!allowedUnits.includes(missingUnit)) {
      toast.error(t("pairGapNoPermission"));
      return;
    }
    // Gap size must match the size the bay will accept: current balance if
    // occupied, otherwise the configured expected size.
    const loc = locations.find((l) => l.id === p.locationId);
    if (loc && segmentEnforcesOneSize(loc.segment) && p.sizeId != null) {
      const accepted = loc.currentSize ?? loc.expectedSize;
      if (accepted != null && p.sizeId !== accepted.id) {
        toast.error(
          t("pairGapSizeConflict", {
            entrySize: p.sizeName ?? "—",
            expectedSize: accepted.displayName,
          }),
          { duration: 8000 },
        );
        return;
      }
    }
    setLocationId(String(p.locationId));
    setSizeId(p.sizeId != null ? String(p.sizeId) : "");
    setUnit(missingUnit);
    setQuantity("");
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Wait for the quantity field to render (it mounts once a unit is set).
    setTimeout(() => quantityRef.current?.focus(), 150);
  }

  // Base UI's Select shows the raw value in the trigger unless items provided.
  const locationItems = useMemo(
    () =>
      locations.map((l) => ({
        value: String(l.id),
        label: `${l.nameAr} (${l.yardNameAr})`,
      })),
    [locations],
  );
  const sizeItems = useMemo(
    () => sizes.map((s) => ({ value: String(s.id), label: s.displayName })),
    [sizes],
  );

  function gradeLabel(grade: "FIRST" | "SECOND" | null): string {
    if (grade === "FIRST" || grade === "SECOND") return tEnums(`grade.${grade}`);
    return t("emDash");
  }

  function handleLocationChange(v: string | null) {
    const value = v ?? "";
    setLocationId(value);
    setUnit("");
    setQuantity("");
    const loc = locations.find((l) => String(l.id) === value);
    // Single-size rebar: prefer current balance size, else expectedSize.
    // Multi-size ISOLATION keeps a free choice; short-bar has no size.
    if (loc && isDualUnitSegment(loc.segment)) {
      const size = loc.currentSize ?? loc.expectedSize;
      setSizeId(size ? String(size.id) : "");
    } else {
      setSizeId("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (enterableUnits.length === 0) {
      toast.error(t("noEntryPermissionToast"));
      return;
    }
    if (!effectiveUnit) {
      toast.error(t("selectEntryUnitToast"));
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t("qtyMustBePositive"));
      return;
    }
    if (isBundle && !Number.isInteger(qty)) {
      toast.error(t("bundlesMustBeInteger"));
      return;
    }
    if (needsSize && !sizeId) {
      toast.error(t("sizeRequiredForLocation"));
      return;
    }
    if (sizeLocked && lockedSize && Number(sizeId) !== lockedSize.id) {
      toast.error(
        t("locationSizeMustMatchExpectedToast", {
          size: lockedSize.displayName,
        }),
      );
      return;
    }

    // Send an explicit shift only during the grace window; otherwise the
    // server derives it from its own clock.
    const submitTime = new Date();
    const shift: ShiftValue | null =
      mode === "production" && inShiftGraceWindow(submitTime)
        ? graceShift === "previous"
          ? previousShiftOf(naturalShiftOf(submitTime))
          : naturalShiftOf(submitTime)
        : null;

    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          locationId: selected.id,
          unit: effectiveUnit,
          sizeId: needsSize ? Number(sizeId) : null,
          quantity: qty,
          shift,
          reason,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t("errorSaveOperation"));
        return;
      }
      if (json.data?.warning) toast.warning(json.data.warning);
      toast.success(successMsg);
      // Keep location/unit/size so consecutive entries at the same bay are
      // fast; clear only the per-entry fields and refocus quantity.
      setQuantity("");
      setReason("");
      quantityRef.current?.focus();
      void fetchToday();
      void refreshCurrentSizes();
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return showToday ? (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    ) : (
      <Skeleton className="h-96 w-full max-w-lg" />
    );
  }

  const previousShiftLabel = tEnums(
    `stockShift.${previousShiftOf(naturalShiftOf(now))}`,
  );
  const currentShiftLabel = tEnums(`stockShift.${naturalShiftOf(now)}`);

  return (
    <div
      className={cn(
        "min-w-0 gap-4",
        showToday
          ? "grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start"
          : "flex max-w-lg flex-col",
      )}
    >
      <Card
        ref={formCardRef}
        className={cn("min-w-0", showToday && "lg:sticky lg:top-4")}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("locationRequired")}</Label>
              <Select items={locationItems} value={locationId} onValueChange={handleLocationChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectStockLocation")} />
                </SelectTrigger>
                <SelectContent dir={dir}>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      <span>
                        {l.nameAr}
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({l.yardNameAr})
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selected && (
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  {t("gradeBadge", { grade: gradeLabel(selected.allowedGrade) })}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {isDualUnitSegment(selected.segment)
                    ? t("rebarDualUnit")
                    : t("shortbarByTon")}
                </Badge>
              </div>
            )}

            {/* What was already recorded today at this bay — instant context
                so the clerk avoids duplicates and sees the colleague's side. */}
            {mode === "production" && selected && selectedTodayTotals && (
              <div className="rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-950">
                <span className="font-semibold">{t("recordedTodayHere")}</span>{" "}
                <span className="tabular-nums">
                  {selectedTodayTotals.bundles > 0 &&
                    t("shiftBundles", {
                      count: formatInteger(selectedTodayTotals.bundles),
                    })}
                  {selectedTodayTotals.bundles > 0 &&
                    selectedTodayTotals.tons > 0 &&
                    " · "}
                  {selectedTodayTotals.tons > 0 &&
                    t("shiftTons", {
                      count: formatDecimal(selectedTodayTotals.tons, 3),
                    })}
                </span>
              </div>
            )}

            {selected && enterableUnits.length === 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {t("noEntryPermissionForLocation")}
              </p>
            )}

            {/* Unit toggle — only when the user may enter more than one unit here */}
            {enterableUnits.length > 1 && (
              <div className="space-y-1.5">
                <Label>{t("entryUnitRequired")}</Label>
                <div className="flex gap-2">
                  {enterableUnits.map((u) => (
                    <Button
                      key={u}
                      type="button"
                      variant={effectiveUnit === u ? "default" : "outline"}
                      className={cn("flex-1")}
                      onClick={() => {
                        setUnit(u);
                        setQuantity("");
                        setTimeout(() => quantityRef.current?.focus(), 100);
                      }}
                    >
                      {u === "BUNDLE" ? t("unitBundles") : t("unitTons")}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {needsSize && effectiveUnit && (
              <div className="space-y-1.5">
                <Label>{t("sizeRequired")}</Label>
                {sizeLocked ? (
                  <>
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">
                      {lockedSizeLabel}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {sizeLockedFromBalance
                        ? t("sizeLockedToBalanceHint")
                        : t("sizeLockedToLocationHint")}
                    </p>
                  </>
                ) : (
                  <>
                    <Select
                      items={sizeItems}
                      value={sizeId}
                      onValueChange={(v) => setSizeId(v ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectSize")} />
                      </SelectTrigger>
                      <SelectContent dir={dir}>
                        {sizes.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selected && segmentEnforcesOneSize(selected.segment) && (
                      <p className="text-xs text-amber-800">
                        {t("locationMissingExpectedSizeHint")}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {effectiveUnit && (
              <div className="space-y-1.5">
                <Label htmlFor="quantity">
                  {isBundle ? t("bundleCountRequired") : t("quantityTonsRequired")}
                </Label>
                <Input
                  ref={quantityRef}
                  id="quantity"
                  type="number"
                  inputMode={isBundle ? "numeric" : "decimal"}
                  min={0}
                  step={isBundle ? 1 : 0.001}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  dir="ltr"
                  className="h-11 text-start text-lg font-semibold tabular-nums"
                  disabled={!selected}
                />
                <p className="text-xs text-muted-foreground">
                  {t("unitLabel", { unit: tEnums(`stockUnit.${effectiveUnit}`) })}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">{t("notesOptional")}</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>

            {/* Shift assignment — visible only during the 30-min grace window
                after a shift boundary (08:00 / 20:00). */}
            {inGrace && (
              <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
                <Label className="text-amber-900">{t("shiftWhich")}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={graceShift === "previous" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setGraceShift("previous")}
                  >
                    {previousShiftLabel}
                  </Button>
                  <Button
                    type="button"
                    variant={graceShift === "current" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setGraceShift("current")}
                  >
                    {currentShiftLabel}
                  </Button>
                </div>
                <p className="text-xs text-amber-800">
                  {t("shiftGraceHint", { shift: previousShiftLabel })}
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="h-11 w-full text-base"
              disabled={
                submitting ||
                !selected ||
                !effectiveUnit ||
                !quantity ||
                (needsSize && !sizeId)
              }
            >
              {submitting && <Loader2 className="animate-spin" />}
              {submitLabel}
            </Button>
          </form>
        </CardContent>
      </Card>

      {showToday && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="space-y-3 border-b bg-muted/30 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardList className="h-4 w-4" />
                </span>
                <span className="leading-snug">{t("todayEntriesTitle")}</span>
              </CardTitle>
              {dayTotals.count > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {dayTotals.bundles > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-sky-100 text-sky-900 tabular-nums"
                    >
                      {t("shiftBundles", { count: formatInteger(dayTotals.bundles) })}
                    </Badge>
                  )}
                  {dayTotals.tons > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-emerald-100 text-emerald-900 tabular-nums"
                    >
                      {t("shiftTons", { count: formatDecimal(dayTotals.tons, 3) })}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("todayEntriesSubtitle")}</p>
            {incompletePairs.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950"
              >
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-xs font-semibold">{t("pairGapAlertTitle")}</p>
                    <ul className="space-y-1.5 text-xs">
                      {incompletePairs.map((p) => {
                        const missingUnit: StockUnit =
                          p.gap === "missing_bundles" ? "BUNDLE" : "TON";
                        const canFix = allowedUnits.includes(missingUnit);
                        return (
                          <li
                            key={p.key}
                            className="flex flex-wrap items-center gap-1.5"
                          >
                            <span className="font-medium">{p.locationNameAr}</span>
                            {p.sizeName && (
                              <Badge
                                variant="secondary"
                                className="bg-amber-100 text-[10px] text-amber-950"
                              >
                                {p.sizeName}
                              </Badge>
                            )}
                            <span className="text-amber-800">
                              —{" "}
                              {p.gap === "missing_bundles"
                                ? t("pairGapMissingBundles")
                                : t("pairGapMissingTons")}
                            </span>
                            {canFix && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 border-amber-400 bg-amber-100/60 px-2 text-[11px] text-amber-950 hover:bg-amber-100"
                                onClick={() => quickFillFromGap(p)}
                              >
                                {t("pairGapFixNow")}
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3 p-3 sm:p-4">
            {dayTotals.count === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center">
                <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{t("noEntriesYet")}</p>
              </div>
            ) : (
              shiftGroups.map(({ shift: s, entries, bundles, tons }) => {
                const isMorning = s === "MORNING";
                const ShiftIcon = isMorning ? Sun : Moon;
                return (
                  <section
                    key={s}
                    className={cn(
                      "rounded-xl border",
                      isMorning
                        ? "border-amber-200/80 bg-amber-50/40"
                        : "border-indigo-200/80 bg-indigo-50/40",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-inherit px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full",
                            isMorning
                              ? "bg-amber-200/70 text-amber-900"
                              : "bg-indigo-200/70 text-indigo-900",
                          )}
                        >
                          <ShiftIcon className="h-3.5 w-3.5" />
                        </span>
                        <h4 className="text-sm font-semibold">
                          {tEnums(`stockShift.${s}`)}
                        </h4>
                        <Badge variant="outline" className="text-[10px] tabular-nums">
                          {t("todayEntriesCount", { count: entries.length })}
                        </Badge>
                      </div>
                      {entries.length > 0 && (
                        <div className="flex flex-wrap gap-1 text-[11px] tabular-nums text-muted-foreground">
                          {bundles > 0 && (
                            <span>{t("shiftBundles", { count: formatInteger(bundles) })}</span>
                          )}
                          {bundles > 0 && tons > 0 && <span>·</span>}
                          {tons > 0 && (
                            <span>{t("shiftTons", { count: formatDecimal(tons, 3) })}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {entries.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-muted-foreground">
                        {t("noEntriesYet")}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border/60 p-1.5">
                        {entries.map((e) => {
                          const qtyLabel =
                            e.unit === "BUNDLE"
                              ? formatInteger(e.quantity)
                              : formatDecimal(e.quantity, 3);
                          const timeLabel =
                            formatDateTime(e.createdAt).split(" ")[1] ?? "";
                          const gap = incompleteByKey.get(entryPairKey(e));
                          return (
                            <li
                              key={e.id}
                              className={cn(
                                "flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
                                gap
                                  ? "border border-amber-300 bg-amber-50/90 ring-1 ring-amber-200"
                                  : "bg-background/80",
                              )}
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                  <span className="truncate text-sm font-semibold">
                                    {e.locationNameAr}
                                  </span>
                                  {e.sizeName && (
                                    <Badge
                                      variant="secondary"
                                      className="max-w-full truncate text-[10px] font-normal"
                                    >
                                      {e.sizeName}
                                    </Badge>
                                  )}
                                  {gap && (
                                    <Badge className="gap-1 border-transparent bg-amber-200 text-[10px] text-amber-950 hover:bg-amber-200">
                                      <TriangleAlert className="h-3 w-3" />
                                      {gap === "missing_bundles"
                                        ? t("pairGapBadgeMissingBundles")
                                        : t("pairGapBadgeMissingTons")}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                  <span className="inline-flex items-center gap-1" dir="ltr">
                                    <Clock3 className="h-3 w-3" />
                                    {timeLabel}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <UserRound className="h-3 w-3" />
                                    {e.createdBy}
                                  </span>
                                </div>
                              </div>
                              <div
                                className={cn(
                                  "inline-flex shrink-0 items-baseline gap-1.5 self-start rounded-lg px-2.5 py-1.5 sm:self-center",
                                  e.unit === "BUNDLE"
                                    ? "bg-sky-100 text-sky-950"
                                    : "bg-emerald-100 text-emerald-950",
                                )}
                              >
                                <span className="text-base font-bold tabular-nums leading-none">
                                  {qtyLabel}
                                </span>
                                <span className="text-[11px] font-medium">
                                  {tEnums(`stockUnit.${e.unit}`)}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
