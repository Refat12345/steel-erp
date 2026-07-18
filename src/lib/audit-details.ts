/**
 * Human-readable formatter for AuditLog `details` JSON.
 *
 * The audit log stores arbitrary JSON shapes per operation. This formatter
 * walks the structure dynamically and produces a single sentence that
 * managers can read at a glance, without requiring code updates for every
 * new event type. Unknown keys are still surfaced (humanized) so
 * information is never lost.
 *
 * Contract: `formatAuditDetails(action, details, locale?) => string`
 *   - `locale` defaults to `"ar"` for backward compatibility.
 *   - `details` can be a JS object, an array, a JSON-encoded string,
 *     a plain string, null or undefined.
 *   - On invalid JSON or unsupported value, falls back to a readable
 *     textual representation (original string or JSON.stringify).
 */

import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { formatDecimal, formatInteger } from "@/lib/number-format";
import arMessages from "../../messages/ar.json";
import enMessages from "../../messages/en.json";

type JsonObject = Record<string, unknown>;

/** Minimal translator surface used by this formatter (avoids IntlMessages generics). */
interface MessageT {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
}

const catalogs = {
  ar: arMessages,
  en: enMessages,
} as const;

function resolveLocale(locale?: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

function getTranslators(locale: Locale): { t: MessageT; tEnums: MessageT } {
  const messages = catalogs[locale];
  return {
    t: createTranslator({ locale, messages, namespace: "audit" }) as MessageT,
    tEnums: createTranslator({ locale, messages, namespace: "enums" }) as MessageT,
  };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

function labelFor(key: string, t: MessageT): string {
  const fieldKey = `details.fields.${key}`;
  return t.has(fieldKey) ? t(fieldKey) : humanizeKey(key);
}

function safeParse(
  details: unknown,
  emDash: string,
): { value: unknown; raw: string } {
  if (details == null) return { value: null, raw: emDash };

  if (typeof details === "string") {
    const trimmed = details.trim();
    if (trimmed === "") return { value: null, raw: emDash };
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return { value: JSON.parse(trimmed), raw: trimmed };
      } catch {
        return { value: trimmed, raw: trimmed };
      }
    }
    return { value: trimmed, raw: trimmed };
  }

  try {
    return { value: details, raw: JSON.stringify(details) };
  } catch {
    return { value: details, raw: emDash };
  }
}

function formatFileSize(bytes: number, t: MessageT): string {
  if (bytes < 1024) {
    return t("details.fileSizeBytes", { value: formatInteger(bytes) });
  }
  if (bytes < 1024 * 1024) {
    return t("details.fileSizeKb", {
      value: formatDecimal(bytes / 1024, 3),
    });
  }
  return t("details.fileSizeMb", {
    value: formatDecimal(bytes / 1024 / 1024, 3),
  });
}

function formatPathTail(value: string): string {
  const tail = value.split(/[\\/]/).pop();
  return tail && tail.length > 0 ? tail : value;
}

function statusLabel(value: string, t: MessageT, tEnums: MessageT): string {
  const truckKey = `truckStatus.${value}`;
  if (tEnums.has(truckKey)) return tEnums(truckKey);

  const orderKey = `salesOrderStatus.${value}`;
  if (tEnums.has(orderKey)) return tEnums(orderKey);

  const auditKey = `details.statuses.${value}`;
  if (t.has(auditKey)) return t(auditKey);

  return value;
}

function gradeLabel(value: string, tEnums: MessageT): string {
  const key = `grade.${value}`;
  return tEnums.has(key) ? tEnums(key) : value;
}

function eventLabel(value: string, t: MessageT): string {
  const key = `details.events.${value}`;
  return t.has(key) ? t(key) : humanizeKey(value);
}

function actionLabel(action: string, t: MessageT): string {
  const key = `actions.${action}`;
  return t.has(key) ? t(key) : action;
}

/** Format one leaf value, choosing units/format from the key name. */
function formatScalar(
  key: string,
  value: unknown,
  t: MessageT,
  tEnums: MessageT,
): string {
  if (value == null) return t("details.emDash");
  if (typeof value === "boolean") {
    return value ? t("details.yes") : t("details.no");
  }

  if (/Kg$/.test(key)) {
    const n = asNumber(value);
    if (n !== null) {
      return t("details.kgValue", { value: formatInteger(n) });
    }
  }
  if (/Tons?$/i.test(key)) {
    const n = asNumber(value);
    if (n !== null) {
      return t("details.tonsValue", { value: formatDecimal(n, 3) });
    }
  }
  if (key === "fileSize") {
    const n = asNumber(value);
    if (n !== null) return formatFileSize(n, t);
  }

  // Numeric reference fields (loaderId, truckId, sessionNumber, …).
  // Only apply `#N` when the JSON value is genuinely numeric — string
  // identifiers (e.g. `nationalId: "12345"`) stay verbatim.
  if (
    (/Id$/.test(key) || /Number$/.test(key)) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return t("details.idRef", { id: formatInteger(value) });
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return formatDecimal(value, 3);
  }

  if (typeof value === "string") {
    if (key === "status" || key === "from" || key === "to") {
      return statusLabel(value, t, tEnums);
    }
    if (key === "event" || key === "action") {
      return eventLabel(value, t);
    }
    if (key === "grade" || key === "roundGrade" || key === "operationalGrade") {
      return gradeLabel(value, tEnums);
    }
    if (key === "filePath" || key === "path") {
      return formatPathTail(value);
    }
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface RenderContext {
  consumed: Set<string>;
  t: MessageT;
  tEnums: MessageT;
}

/** Walk an object and produce "label: value" fragments. */
function renderObject(obj: JsonObject, ctx: RenderContext): string[] {
  const { t, tEnums } = ctx;
  const fragments: string[] = [];
  const listSep = t("details.listSep");

  if ("bridgeNetKg" in obj && "bridgeNetTons" in obj) {
    const kg = asNumber(obj.bridgeNetKg);
    const tons = asNumber(obj.bridgeNetTons);
    if (kg !== null && tons !== null) {
      fragments.push(
        t("details.bridgeNetCombined", {
          kg: formatInteger(kg),
          tons: formatDecimal(tons, 3),
        }),
      );
      ctx.consumed.add("bridgeNetKg");
      ctx.consumed.add("bridgeNetTons");
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (ctx.consumed.has(key)) continue;
    if (value == null) continue;

    if (
      (key === "newValue" || key === "previousValue" || key === "oldValue") &&
      isPlainObject(value)
    ) {
      const nested = renderObject(value, ctx);
      if (nested.length === 0) continue;
      if (key === "newValue") {
        fragments.push(...nested);
      } else {
        fragments.push(
          t("details.previousValueWrapped", { value: nested.join(listSep) }),
        );
      }
      continue;
    }

    if (isPlainObject(value)) {
      const nested = renderObject(value, ctx);
      if (nested.length > 0) {
        fragments.push(
          t("details.fieldValue", {
            label: labelFor(key, t),
            value: `{ ${nested.join(listSep)} }`,
          }),
        );
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const arraySep = t("details.arraySep");
      const items = value.map((item) =>
        isPlainObject(item)
          ? `{ ${renderObject(item, ctx).join(listSep)} }`
          : formatScalar(key, item, t, tEnums),
      );
      fragments.push(
        t("details.fieldValue", {
          label: labelFor(key, t),
          value: `[${items.join(arraySep)}]`,
        }),
      );
      continue;
    }

    fragments.push(
      t("details.fieldValue", {
        label: labelFor(key, t),
        value: formatScalar(key, value, t, tEnums),
      }),
    );
  }

  return fragments;
}

export function formatAuditDetails(
  action: string,
  details: unknown,
  locale: string = DEFAULT_LOCALE,
): string {
  const resolved = resolveLocale(locale);
  const { t, tEnums } = getTranslators(resolved);
  const emDash = t("details.emDash");
  const { value, raw } = safeParse(details, emDash);

  if (value === null || value === undefined) return raw;
  if (typeof value === "string") return value;
  if (!isPlainObject(value)) return raw;

  const ctx: RenderContext = { consumed: new Set(), t, tEnums };
  const listSep = t("details.listSep");

  // ── Composite patterns (single-sentence shortcuts) ───────────────────
  const topTruckId = asNumber(value.truckId);
  const topFilePath = typeof value.filePath === "string" ? value.filePath : null;
  if (topFilePath && topTruckId !== null && /uploads[\\/]+trucks/i.test(topFilePath)) {
    return t("details.photoUploaded", { truckId: formatInteger(topTruckId) });
  }

  const topSessionNumber = asNumber(value.sessionNumber);
  const topWeightTons = asNumber(value.weightTons);
  if (topSessionNumber !== null && topTruckId !== null && topWeightTons !== null) {
    ctx.consumed.add("sessionNumber");
    ctx.consumed.add("truckId");
    ctx.consumed.add("weightTons");
    const head = t("details.sessionCreated", {
      sessionNumber: formatInteger(topSessionNumber),
      truckId: formatInteger(topTruckId),
      weight: formatDecimal(topWeightTons, 3),
    });
    const extras = renderObject(value, ctx);
    return extras.length > 0 ? `${head}${listSep}${extras.join(listSep)}` : head;
  }

  // ── Headline: event → status transition → action ─────────────────────
  const headlineParts: string[] = [];

  if (typeof value.event === "string") {
    headlineParts.push(eventLabel(value.event, t));
    ctx.consumed.add("event");
  } else if (typeof value.action === "string" && t.has(`details.events.${value.action}`)) {
    headlineParts.push(eventLabel(value.action, t));
    ctx.consumed.add("action");
  }

  const fromStatus = typeof value.from === "string" ? value.from : null;
  const toStatus = typeof value.to === "string" ? value.to : null;
  if (fromStatus && toStatus) {
    const phrase = t("details.statusFromTo", {
      from: statusLabel(fromStatus, t, tEnums),
      to: statusLabel(toStatus, t, tEnums),
    });
    headlineParts.push(
      headlineParts.length === 0
        ? t("details.statusChangeWithPhrase", { phrase })
        : t("details.statusChangeParen", { phrase }),
    );
    ctx.consumed.add("from");
    ctx.consumed.add("to");
  } else if (toStatus && !fromStatus) {
    const to = statusLabel(toStatus, t, tEnums);
    headlineParts.push(
      headlineParts.length === 0
        ? t("details.statusChangeTo", { to })
        : t("details.statusChangeToParen", { to }),
    );
    ctx.consumed.add("to");
  }

  if (headlineParts.length === 0) {
    headlineParts.push(actionLabel(action, t));
  }

  const body = renderObject(value, ctx);
  if (body.length === 0) return headlineParts.join(" ");
  return `${headlineParts.join(" ")}${t("details.headlineBodySep")}${body.join(listSep)}`;
}
