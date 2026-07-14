"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
import { Loader2, PackagePlus, ClipboardList } from "lucide-react";
import {
  gradeLabel,
  unitLabel,
  segmentTrackedUnits,
  isDualUnitSegment,
  naturalShiftOf,
  inShiftGraceWindow,
  previousShiftOf,
  SHIFT_LABEL,
  type ShiftValue,
  type Segment,
  type StockUnit,
  type SizeOption,
} from "./stock-shared";

interface TodayEntry {
  id: number;
  createdAt: string;
  locationCode: string;
  locationNameAr: string;
  sizeName: string | null;
  quantity: number;
  unit: StockUnit;
  shift: ShiftValue;
  createdBy: string;
}

type EntryMode = "production" | "opening";

const MODE_CONFIG: Record<
  EntryMode,
  { endpoint: string; title: string; submit: string; success: string; icon: typeof PackagePlus }
> = {
  production: {
    endpoint: "/api/stock/movements",
    title: "تسجيل دخول إنتاج",
    submit: "تسجيل الدخول",
    success: "تم تسجيل دخول الإنتاج",
    icon: PackagePlus,
  },
  opening: {
    endpoint: "/api/stock/opening-balance",
    title: "إدخال رصيد افتتاحي",
    submit: "تسجيل الرصيد الافتتاحي",
    success: "تم تسجيل الرصيد الافتتاحي",
    icon: ClipboardList,
  },
};

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
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
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

  // Wall clock, refreshed every 30 s — drives the shift grace-window UI so the
  // toggle appears/disappears on time even if the page stays open for hours.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
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

  useEffect(() => {
    void fetchToday();
  }, [fetchToday]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stock/locations");
        const json = await res.json();
        if (json.success) {
          const flat: LocationOption[] = (json.data.yards as ApiYard[]).flatMap((y) =>
            y.locations
              .filter((l) => l.isActive)
              .map((l) => ({ ...l, yardNameAr: y.nameAr })),
          );
          setLocations(flat);
          setSizes(
            (json.data.sizes as (SizeOption & { isBundleType: boolean })[]).filter(
              (s) => s.isBundleType,
            ),
          );
        } else {
          toast.error(json.error || "خطأ في جلب المواقع");
        }
      } catch {
        toast.error("خطأ في الاتصال");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  // Feed grouped by work shift, with per-shift totals for a quick sanity read.
  const shiftGroups = useMemo(() => {
    return (["MORNING", "EVENING"] as const).map((s) => {
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

  function handleLocationChange(v: string | null) {
    const value = v ?? "";
    setLocationId(value);
    setUnit("");
    setQuantity("");
    const loc = locations.find((l) => String(l.id) === value);
    // Pre-fill the indicative size for rebar sites; clear for short-bar.
    if (loc && isDualUnitSegment(loc.segment) && loc.expectedSize) {
      setSizeId(String(loc.expectedSize.id));
    } else {
      setSizeId("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (enterableUnits.length === 0) {
      toast.error("لا تملك صلاحية الإدخال لهذا الموقع");
      return;
    }
    if (!effectiveUnit) {
      toast.error("اختر وحدة الإدخال (ربطات أو طن)");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("الكمية يجب أن تكون أكبر من صفر");
      return;
    }
    if (isBundle && !Number.isInteger(qty)) {
      toast.error("عدد الربطات يجب أن يكون عدداً صحيحاً");
      return;
    }
    if (needsSize && !sizeId) {
      toast.error("المقاس مطلوب لهذا الموقع");
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
      const res = await fetch(config.endpoint, {
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
        toast.error(json.error || "تعذّر تسجيل العملية");
        return;
      }
      if (json.data?.warning) toast.warning(json.data.warning);
      toast.success(config.success);
      setQuantity("");
      setReason("");
      void fetchToday();
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-lg" />;
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {config.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>الموقع *</Label>
            <Select items={locationItems} value={locationId} onValueChange={handleLocationChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختر موقع المخزون" />
              </SelectTrigger>
              <SelectContent>
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
                النخب: {gradeLabel(selected.allowedGrade)}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {isDualUnitSegment(selected.segment) ? "مبروم — ربطات وطن" : "قصائر — بالطن"}
              </Badge>
            </div>
          )}

          {selected && enterableUnits.length === 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              لا تملك صلاحية الإدخال لهذا الموقع بالوحدة المتاحة.
            </p>
          )}

          {/* Unit toggle — only when the user may enter more than one unit here */}
          {enterableUnits.length > 1 && (
            <div className="space-y-1.5">
              <Label>وحدة الإدخال *</Label>
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
                    }}
                  >
                    {u === "BUNDLE" ? "ربطات" : "طن"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {needsSize && effectiveUnit && (
            <div className="space-y-1.5">
              <Label>المقاس *</Label>
              <Select items={sizeItems} value={sizeId} onValueChange={(v) => setSizeId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر المقاس" />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {effectiveUnit && (
            <div className="space-y-1.5">
              <Label htmlFor="quantity">
                {isBundle ? "عدد الربطات *" : "الكمية (طن) *"}
              </Label>
              <Input
                id="quantity"
                type="number"
                min={0}
                step={isBundle ? 1 : 0.001}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                dir="ltr"
                className="text-left"
                disabled={!selected}
              />
              <p className="text-xs text-muted-foreground">
                الوحدة: {unitLabel(effectiveUnit)}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">ملاحظة (اختياري)</Label>
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
              <Label className="text-amber-900">لأي وردية يعود هذا الإدخال؟</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={graceShift === "previous" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setGraceShift("previous")}
                >
                  {SHIFT_LABEL[previousShiftOf(naturalShiftOf(now))]}
                </Button>
                <Button
                  type="button"
                  variant={graceShift === "current" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setGraceShift("current")}
                >
                  {SHIFT_LABEL[naturalShiftOf(now)]}
                </Button>
              </div>
              <p className="text-xs text-amber-800">
                بدأت وردية جديدة قبل قليل — إذا كان الإدخال يخص الوردية المنتهية اتركه على
                «{SHIFT_LABEL[previousShiftOf(naturalShiftOf(now))]}».
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting || !selected || !effectiveUnit || !quantity}
          >
            {submitting && <Loader2 className="animate-spin" />}
            {config.submit}
          </Button>
        </form>
      </CardContent>
    </Card>

    {showToday && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4" />
            إدخالات اليوم التشغيلي (8ص – 8ص)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {shiftGroups.map(({ shift: s, entries, bundles, tons }) => (
            <div key={s}>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-xs font-semibold">{SHIFT_LABEL[s]}</h4>
                {entries.length > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {bundles > 0 && `${bundles} ربطة`}
                    {bundles > 0 && tons > 0 && " · "}
                    {tons > 0 && `${tons} طن`}
                  </span>
                )}
              </div>
              {entries.length === 0 ? (
                <p className="text-xs text-muted-foreground">لا إدخالات بعد.</p>
              ) : (
                <ul className="divide-y text-xs">
                  {entries.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{e.locationNameAr}</span>
                        {e.sizeName && (
                          <span className="ms-1 text-muted-foreground">· {e.sizeName}</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {e.quantity} {unitLabel(e.unit)}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(e.createdAt).toLocaleTimeString("ar", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {e.createdBy}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    )}
    </div>
  );
}
