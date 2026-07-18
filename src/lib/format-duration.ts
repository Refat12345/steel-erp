/**
 * Format a duration (in milliseconds) as a human-readable Arabic string.
 *
 * Examples:
 *   formatDuration(90_000)        → "دقيقة و 30 ثانية"
 *   formatDuration(5_400_000)     → "ساعة و 30 دقيقة"
 *   formatDuration(93_600_000)    → "يوم و ساعتان"
 *
 * Returns "—" for null / negative values.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "أقل من ثانية";

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(arabicUnit(days, "يوم", "يومان", "أيام"));
  if (hours > 0) parts.push(arabicUnit(hours, "ساعة", "ساعتان", "ساعات"));
  if (minutes > 0 && days === 0) {
    parts.push(arabicUnit(minutes, "دقيقة", "دقيقتان", "دقائق"));
  }
  if (seconds > 0 && days === 0 && hours === 0) {
    parts.push(arabicUnit(seconds, "ثانية", "ثانيتان", "ثوانٍ"));
  }

  if (parts.length === 0) return "أقل من ثانية";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, 2).join(" و ");
}

/**
 * Compact format for tables: "2س 30د" or "45د" or "1ي 5س".
 */
export function formatDurationCompact(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `<1د`;

  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;

  if (days > 0) {
    return hours > 0 ? `${days}ي ${hours}س` : `${days}ي`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}س ${minutes}د` : `${hours}س`;
  }
  return `${minutes}د`;
}

/**
 * Compact English format for tables: "2h 30m" or "45m" or "1d 5h".
 */
export function formatDurationCompactEn(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `<1m`;

  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Full English duration (mirror of formatDuration) for bilingual UI.
 * Examples: "1 minute and 30 seconds", "1 hour and 30 minutes".
 */
export function formatDurationEn(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "less than a second";

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(englishUnit(days, "day", "days"));
  if (hours > 0) parts.push(englishUnit(hours, "hour", "hours"));
  if (minutes > 0 && days === 0) {
    parts.push(englishUnit(minutes, "minute", "minutes"));
  }
  if (seconds > 0 && days === 0 && hours === 0) {
    parts.push(englishUnit(seconds, "second", "seconds"));
  }

  if (parts.length === 0) return "less than a second";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, 2).join(" and ");
}

/** Locale-aware full duration for scale / truck timelines. */
export function formatDurationLocalized(
  ms: number | null | undefined,
  locale: string,
): string {
  return locale === "en" ? formatDurationEn(ms) : formatDuration(ms);
}

/** Locale-aware compact duration for metric boxes / tables. */
export function formatDurationCompactLocalized(
  ms: number | null | undefined,
  locale: string,
): string {
  return locale === "en"
    ? formatDurationCompactEn(ms)
    : formatDurationCompact(ms);
}

function englishUnit(n: number, singular: string, plural: string): string {
  if (n === 1) return `1 ${singular}`;
  return `${n} ${plural}`;
}

/** Compute milliseconds between two ISO-string/Date values. */
export function durationBetween(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): number | null {
  if (!from || !to) return null;
  const a = typeof from === "string" ? new Date(from).getTime() : from.getTime();
  const b = typeof to === "string" ? new Date(to).getTime() : to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

function arabicUnit(
  n: number,
  singular: string,
  dual: string,
  plural: string,
): string {
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${n} ${plural}`;
  return `${n} ${singular}`;
}
