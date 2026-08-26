import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/config";
import { localizedSize } from "@/lib/localized-name";
import { listActiveSizes } from "@/lib/services/size-lookup.service";
import { getMillLiveProductSizeId } from "@/lib/services/settings.service";

/** Snapshots older than this are treated as delayed / not live. */
const STALE_AFTER_MS = 3 * 60 * 1000;

export type MillLiveSizeOption = {
  id: number;
  displayName: string;
};

export type MillLiveSnapshot = {
  productSizeId: number | null;
  productSizeLabel: string | null;
  totalBillets: number;
  frontPackCount: number;
  backPackCount: number;
  hourlyBreakdown: number[];
  createdAt: string | null;
  isLive: boolean;
};

export type MillLiveCurrentResponse = MillLiveSnapshot & {
  canEditProductSize: boolean;
  sizes: MillLiveSizeOption[];
};

function emptyHourlyBreakdown(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

function asHourlyBreakdown(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 24) {
    return emptyHourlyBreakdown();
  }
  return value.map((n) => {
    const num = typeof n === "number" ? n : Number(n);
    return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
  });
}

async function resolveAdminProductSize(
  locale: Locale,
): Promise<{ productSizeId: number | null; productSizeLabel: string | null }> {
  const productSizeId = await getMillLiveProductSizeId();
  if (productSizeId == null) {
    return { productSizeId: null, productSizeLabel: null };
  }

  const size = await prisma.sizeLookup.findUnique({
    where: { id: productSizeId },
    select: { displayName: true, displayNameEn: true },
  });
  if (!size) {
    return { productSizeId: null, productSizeLabel: null };
  }

  return {
    productSizeId,
    productSizeLabel: localizedSize(size, locale),
  };
}

/** Active rebar/bundle sizes for the mill-live admin picker. */
export async function listMillLiveSizeOptions(
  locale: Locale,
): Promise<MillLiveSizeOption[]> {
  const rows = await listActiveSizes();
  return rows
    .filter((s) => s.isBundleType)
    .map((s) => ({
      id: s.id,
      displayName: localizedSize(s, locale),
    }));
}

/**
 * Latest PLC/SCADA counters plus the admin-selected product size.
 * Telemetry may be absent (zeros / not live); the size still resolves
 * from SystemSetting so the board can render before the first SCADA sync.
 */
export async function getLatestMillLiveSnapshot(
  locale: Locale,
): Promise<MillLiveSnapshot> {
  const [productSize, row] = await Promise.all([
    resolveAdminProductSize(locale),
    prisma.plcTelemetry.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        totalBillets: true,
        frontPackCount: true,
        backPackCount: true,
        hourlyBreakdown: true,
        createdAt: true,
      },
    }),
  ]);

  if (!row) {
    return {
      ...productSize,
      totalBillets: 0,
      frontPackCount: 0,
      backPackCount: 0,
      hourlyBreakdown: emptyHourlyBreakdown(),
      createdAt: null,
      isLive: false,
    };
  }

  const ageMs = Date.now() - row.createdAt.getTime();
  return {
    ...productSize,
    totalBillets: row.totalBillets,
    frontPackCount: row.frontPackCount,
    backPackCount: row.backPackCount,
    hourlyBreakdown: asHourlyBreakdown(row.hourlyBreakdown),
    createdAt: row.createdAt.toISOString(),
    isLive: ageMs <= STALE_AFTER_MS,
  };
}
