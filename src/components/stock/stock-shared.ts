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
  /** Tailwind classes for the schematic map tile. */
  tile: string;
  /** Tailwind classes for a small dot / badge accent. */
  dot: string;
}

/** Presentation metadata per segment (map colors only — labels via enums.stockSegment). */
export const SEGMENT_META: Record<Segment, SegmentMeta> = {
  GENERAL: {
    tile: "border-sky-300 bg-sky-50 text-sky-900",
    dot: "bg-sky-500",
  },
  GOVERNORATES: {
    tile: "border-amber-300 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
  },
  ISOLATION: {
    tile: "border-rose-300 bg-rose-50 text-rose-900",
    dot: "bg-rose-500",
  },
  SHORTBAR: {
    tile: "border-emerald-300 bg-emerald-50 text-emerald-900",
    dot: "bg-emerald-500",
  },
};

export const SEGMENT_ORDER: Segment[] = [
  "GENERAL",
  "GOVERNORATES",
  "ISOLATION",
  "SHORTBAR",
];

export type StockUnit = "BUNDLE" | "TON";

/**
 * Client mirror of the server's segment → tracked-units derivation. Rebar
 * tracks BOTH bundles and tons in parallel; short-bar tracks tons only.
 * Keep in sync with `trackedUnits` in `stock.service.ts`.
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

export const SHIFT_VALUES: ShiftValue[] = ["MORNING", "EVENING"];

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

export const MOVEMENT_TYPES: MovementType[] = [
  "OPENING_BALANCE",
  "PRODUCTION_IN",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "LOAD_OUT",
  "ADJUSTMENT",
];
