const APP_TIME_ZONE = "Asia/Damascus";

const datePartsFormatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timePartsFormatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type DateInput = string | number | Date;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "—";

  const parts = datePartsFormatter.formatToParts(date);
  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const day = getPart(parts, "day");

  return `${year}-${month}-${day}`;
}

export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "—";

  const timeParts = timePartsFormatter.formatToParts(date);
  const hour = getPart(timeParts, "hour");
  const minute = getPart(timeParts, "minute");

  return `${formatDate(date)} ${hour}:${minute}`;
}
