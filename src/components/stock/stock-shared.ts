export type Segment = "GENERAL" | "GOVERNORATES" | "ISOLATION" | "SHORTBAR";

export interface YardOption {
  id: number;
  code: string;
  nameAr: string;
}

export interface SizeOption {
  id: number;
  code: string;
  displayName: string;
}

export interface StockLocation {
  id: number;
  yardId: number;
  code: string;
  nameAr: string;
  segment: Segment;
  unit: "BUNDLE" | "TON";
  allowedGrade: "FIRST" | "SECOND" | null;
  expectedSize: { id: number; code: string; displayName: string } | null;
  isActive: boolean;
  sortOrder: number;
  gridRow: number;
  gridCol: number;
  gridSpan: number;
  notes: string | null;
  movementCount: number;
}

export interface Yard {
  id: number;
  code: string;
  nameAr: string;
  isActive: boolean;
  locations: StockLocation[];
}

interface SegmentMeta {
  label: string;
  /** Tailwind classes for the schematic map tile. */
  tile: string;
  /** Tailwind classes for a small dot / badge accent. */
  dot: string;
}

/** Presentation metadata per segment (labels + map colors). */
export const SEGMENT_META: Record<Segment, SegmentMeta> = {
  GENERAL: {
    label: "نخب أول عام",
    tile: "border-sky-300 bg-sky-50 text-sky-900",
    dot: "bg-sky-500",
  },
  GOVERNORATES: {
    label: "نخب أول محافظات",
    tile: "border-amber-300 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
  },
  ISOLATION: {
    label: "نخب ثاني (عزل)",
    tile: "border-rose-300 bg-rose-50 text-rose-900",
    dot: "bg-rose-500",
  },
  SHORTBAR: {
    label: "قصائر (بالطن)",
    tile: "border-emerald-300 bg-emerald-50 text-emerald-900",
    dot: "bg-emerald-500",
  },
};

/** Client mirror of the server's segment → unit derivation (display only). */
export function segmentUnitLabel(segment: Segment): string {
  return segment === "SHORTBAR" ? "بالطن" : "بالربطات";
}

/** Client mirror of the server's segment → grade derivation (display only). */
export function segmentGradeLabel(segment: Segment): string {
  if (segment === "SHORTBAR") return "بدون نخب";
  if (segment === "ISOLATION") return "نخب ثاني";
  return "نخب أول";
}

export type StockUnit = "BUNDLE" | "TON";

/** Singular counting-unit label for a quantity. */
export function unitLabel(unit: StockUnit): string {
  return unit === "TON" ? "طن" : "ربطة";
}

/**
 * Client mirror of the server's segment → tracked-units derivation. Rebar
 * (المبروم) tracks BOTH bundles and tons in parallel; short-bar (قصائر) tracks
 * tons only. Keep in sync with `trackedUnits` in `stock.service.ts`.
 */
export function segmentTrackedUnits(segment: Segment): StockUnit[] {
  return segment === "SHORTBAR" ? ["TON"] : ["BUNDLE", "TON"];
}

/** Rebar sites carry a parallel bundle + ton balance; short-bar does not. */
export function isDualUnitSegment(segment: Segment): boolean {
  return segment !== "SHORTBAR";
}

/**
 * Client mirror of the server's one-size-per-location rule. First-grade sites
 * (GENERAL / GOVERNORATES) are single-size; the ISOLATION zone holds many sizes
 * at once, so the rule is lifted. Keep in sync with `enforcesOneSize` in
 * `stock.service.ts`.
 */
export function segmentEnforcesOneSize(segment: Segment): boolean {
  return segment === "GENERAL" || segment === "GOVERNORATES";
}

// ── Work shifts (client mirror of stock.service.ts — keep in sync) ──────────

export type ShiftValue = "MORNING" | "EVENING";

export const SHIFT_GRACE_MINUTES = 30;

export const SHIFT_LABEL: Record<ShiftValue, string> = {
  MORNING: "الوردية الصباحية (8ص–8م)",
  EVENING: "الوردية المسائية (8م–8ص)",
};

/** Shift a timestamp naturally falls in: 08:00–20:00 MORNING, else EVENING. */
export function naturalShiftOf(d: Date): ShiftValue {
  const h = d.getHours();
  return h >= 8 && h < 20 ? "MORNING" : "EVENING";
}

/** Inside the grace window right after a shift boundary (08:00 / 20:00)? */
export function inShiftGraceWindow(d: Date): boolean {
  const h = d.getHours();
  return (h === 8 || h === 20) && d.getMinutes() < SHIFT_GRACE_MINUTES;
}

export function previousShiftOf(s: ShiftValue): ShiftValue {
  return s === "MORNING" ? "EVENING" : "MORNING";
}

export type MovementType =
  | "OPENING_BALANCE"
  | "PRODUCTION_IN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "LOAD_OUT"
  | "ADJUSTMENT";

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  OPENING_BALANCE: "رصيد افتتاحي",
  PRODUCTION_IN: "دخول إنتاج",
  TRANSFER_OUT: "ترحيل خارج",
  TRANSFER_IN: "ترحيل داخل",
  LOAD_OUT: "خصم تحميل",
  ADJUSTMENT: "تصحيح جرد",
};

export function gradeLabel(grade: "FIRST" | "SECOND" | null): string {
  if (grade === "FIRST") return "نخب أول";
  if (grade === "SECOND") return "نخب ثاني";
  return "—";
}
