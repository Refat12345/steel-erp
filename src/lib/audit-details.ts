/**
 * Human-readable Arabic formatter for AuditLog `details` JSON.
 *
 * The audit log stores arbitrary JSON shapes per operation. This formatter
 * walks the structure dynamically and produces a single Arabic sentence
 * that managers can read at a glance, without requiring code updates for
 * every new event type. Unknown keys are still surfaced (humanized) so
 * information is never lost.
 *
 * Contract: `formatAuditDetails(action, details) => string`
 *   - `details` can be a JS object, an array, a JSON-encoded string,
 *     a plain string, null or undefined.
 *   - On invalid JSON or unsupported value, falls back to a readable
 *     textual representation (original string or JSON.stringify).
 */

type JsonObject = Record<string, unknown>;

const arabicInteger = new Intl.NumberFormat("ar-EG", {
  maximumFractionDigits: 0,
});

const arabicDecimal = new Intl.NumberFormat("ar-EG", {
  maximumFractionDigits: 3,
});

const EVENT_LABELS: Record<string, string> = {
  truck_registered: "تم تسجيل الشاحنة",
  tare_recorded: "تم تسجيل وزن التار",
  gross_recorded: "تم تسجيل الوزن الإجمالي",
  round_weighed_return: "وزنة خارجية ورجوع للتحميل (دورة جديدة)",
  gross_correction: "تصحيح وزنة خارجية",
  completed_grade_corrected: "تصحيح إداري: نخب دورة لشاحنة مكتملة",
  completed_tare_corrected: "تصحيح إداري: وزن الفارغ لشاحنة مكتملة",
  completed_external_card_corrected: "تصحيح إداري: رقم كرت القبان لشاحنة مكتملة",
  completed_external_corrected: "تصحيح إداري: وزنة خارجية لشاحنة مكتملة",
  completed_session_added: "تصحيح إداري: إضافة وزنة داخلية لشاحنة مكتملة",
  completed_session_edited: "تصحيح إداري: تعديل وزنة داخلية لشاحنة مكتملة",
  completed_session_deleted: "تصحيح إداري: حذف وزنة داخلية لشاحنة مكتملة",
  loading_confirmed: "تم تأكيد التحميل",
  loading_reopened: "تم إعادة فتح التحميل",
  session_reopened: "تم إعادة فتح التحميل قبل الوزن",
  session_cancelled: "تم إلغاء العملية",
  cancelled: "تم الإلغاء",
  approved: "تمت الموافقة",
  rejected: "تم الرفض",
  password_reset: "إعادة تعيين كلمة المرور",
};

const STATUS_LABELS: Record<string, string> = {
  Queued: "في الانتظار",
  Approved: "موافق عليها",
  FirstWeigh: "الوزن الأول",
  SecondWeigh: "الوزن الثاني",
  LoadingComplete: "اكتمل التحميل",
  Completed: "اكتملت",
  Cancelled: "ملغاة",
  draft: "مسودة",
  approved: "موافق عليه",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغى",
  pending: "قيد الانتظار",
  partial: "جزئي",
};

const GRADE_VALUE_LABELS: Record<string, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
};

const ACTION_LABELS: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  status_change: "تغيير حالة",
  upload: "رفع ملف",
  delete: "حذف",
};

const FIELD_LABELS: Record<string, string> = {
  tareWeightKg: "وزن التار",
  grossWeightKg: "الوزن الإجمالي",
  bridgeNetKg: "صافي الميزان",
  bridgeNetTons: "صافي الميزان (طن)",
  internalTotalTons: "مجموع الوزنات الداخلية (طن)",
  discrepancyKg: "فرق القبان والداخلي (كغ)",
  discrepancyWarning: "تنبيه فرق الوزن",
  discrepancyThresholdKg: "حد التنبيه (كغ)",
  weightTons: "الوزن",
  weightKg: "الوزن",
  loaderId: "المحمّل",
  truckId: "الشاحنة",
  sizeId: "المقاس",
  roundNumber: "دورة القبان",
  nextRoundNumber: "الدورة التالية",
  roundGrade: "نخب الدورة",
  roundStartWeightKg: "وزن بداية الدورة",
  roundEndWeightKg: "وزن نهاية الدورة",
  roundNetKg: "صافي الدورة",
  isFinalRound: "وزنة الخروج النهائي",
  cascadedToNextRound: "انعكس على بداية الدورة التالية",
  rounds: "الدورات",
  grade: "النخب",
  oldGrossWeightKg: "الوزن الإجمالي السابق",
  newGrossWeightKg: "الوزن الإجمالي الجديد",
  oldTareWeightKg: "وزن التار السابق",
  newTareWeightKg: "وزن التار الجديد",
  oldExternalCardNumber: "رقم كرت القبان السابق",
  newExternalCardNumber: "رقم كرت القبان الجديد",
  externalCardNumber: "رقم كرت القبان",
  oldEndWeightKg: "وزن نهاية الدورة السابق",
  newEndWeightKg: "وزن نهاية الدورة الجديد",
  oldGrade: "النخب السابق",
  newGrade: "النخب الجديد",
  changes: "التعديلات",
  deleted: "الوزنة المحذوفة",
  bundleCount: "عدد الربطات",
  expectedVersion: "الإصدار المتوقّع",
  sessionCount: "عدد الوزنات",
  photoCount: "عدد الصور",
  customerId: "الزبون",
  contractId: "العقد",
  salesOrderId: "أمر البيع",
  orderId: "أمر البيع",
  userId: "المستخدم",
  sessionNumber: "جلسة الوزن",
  reason: "السبب",
  fullName: "الاسم",
  nationalId: "الرقم الوطني",
  phoneNumber: "رقم الهاتف",
  fileName: "اسم الملف",
  fileSize: "حجم الملف",
  filePath: "الملف",
  notes: "ملاحظات",
  status: "الحالة",
  from: "من",
  to: "إلى",
  event: "الحدث",
  action: "الإجراء",
  previousValue: "القيمة السابقة",
  newValue: "القيمة الجديدة",
};

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

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

function safeParse(details: unknown): { value: unknown; raw: string } {
  if (details == null) return { value: null, raw: "—" };

  if (typeof details === "string") {
    const trimmed = details.trim();
    if (trimmed === "") return { value: null, raw: "—" };
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
    return { value: details, raw: "—" };
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${arabicInteger.format(bytes)} بايت`;
  if (bytes < 1024 * 1024) return `${arabicDecimal.format(bytes / 1024)} ك.ب`;
  return `${arabicDecimal.format(bytes / 1024 / 1024)} م.ب`;
}

function formatPathTail(value: string): string {
  const tail = value.split(/[\\/]/).pop();
  return tail && tail.length > 0 ? tail : value;
}

/** Format one leaf value, choosing units/format from the key name. */
function formatScalar(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";

  if (/Kg$/.test(key)) {
    const n = asNumber(value);
    if (n !== null) return `${arabicInteger.format(n)} كغ`;
  }
  if (/Tons?$/i.test(key)) {
    const n = asNumber(value);
    if (n !== null) return `${arabicDecimal.format(n)} طن`;
  }
  if (key === "fileSize") {
    const n = asNumber(value);
    if (n !== null) return formatFileSize(n);
  }

  // Numeric reference fields (loaderId, truckId, sessionNumber, …).
  // Only apply `#N` when the JSON value is genuinely numeric — string
  // identifiers (e.g. `nationalId: "12345"`) stay verbatim.
  if (
    (/Id$/.test(key) || /Number$/.test(key)) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return `#${arabicInteger.format(value)}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return arabicDecimal.format(value);
  }

  if (typeof value === "string") {
    if (key === "status" || key === "from" || key === "to") {
      return STATUS_LABELS[value] ?? value;
    }
    if (key === "event" || key === "action") {
      return EVENT_LABELS[value] ?? humanizeKey(value);
    }
    if (key === "grade" || key === "roundGrade" || key === "operationalGrade") {
      return GRADE_VALUE_LABELS[value] ?? value;
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
}

/** Walk an object and produce Arabic "label: value" fragments. */
function renderObject(obj: JsonObject, ctx: RenderContext): string[] {
  const fragments: string[] = [];

  if ("bridgeNetKg" in obj && "bridgeNetTons" in obj) {
    const kg = asNumber(obj.bridgeNetKg);
    const tons = asNumber(obj.bridgeNetTons);
    if (kg !== null && tons !== null) {
      fragments.push(
        `صافي الميزان: ${arabicInteger.format(kg)} كغ (${arabicDecimal.format(tons)} طن)`,
      );
      ctx.consumed.add("bridgeNetKg");
      ctx.consumed.add("bridgeNetTons");
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (ctx.consumed.has(key)) continue;
    if (value == null) continue;

    if ((key === "newValue" || key === "previousValue" || key === "oldValue") && isPlainObject(value)) {
      const nested = renderObject(value, ctx);
      if (nested.length === 0) continue;
      if (key === "newValue") {
        fragments.push(...nested);
      } else {
        fragments.push(`القيمة السابقة (${nested.join("، ")})`);
      }
      continue;
    }

    if (isPlainObject(value)) {
      const nested = renderObject(value, ctx);
      if (nested.length > 0) {
        fragments.push(`${labelFor(key)}: { ${nested.join("، ")} }`);
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const items = value.map((item) =>
        isPlainObject(item)
          ? `{ ${renderObject(item, ctx).join("، ")} }`
          : formatScalar(key, item),
      );
      fragments.push(`${labelFor(key)}: [${items.join(", ")}]`);
      continue;
    }

    fragments.push(`${labelFor(key)}: ${formatScalar(key, value)}`);
  }

  return fragments;
}

function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

export function formatAuditDetails(action: string, details: unknown): string {
  const { value, raw } = safeParse(details);

  if (value === null || value === undefined) return raw;
  if (typeof value === "string") return value;
  if (!isPlainObject(value)) return raw;

  const ctx: RenderContext = { consumed: new Set() };

  // ── Composite patterns (single-sentence shortcuts) ───────────────────
  const topTruckId = asNumber(value.truckId);
  const topFilePath = typeof value.filePath === "string" ? value.filePath : null;
  if (topFilePath && topTruckId !== null && /uploads[\\/]+trucks/i.test(topFilePath)) {
    return `تم رفع صورة للشاحنة #${arabicInteger.format(topTruckId)}`;
  }

  const topSessionNumber = asNumber(value.sessionNumber);
  const topWeightTons = asNumber(value.weightTons);
  if (topSessionNumber !== null && topTruckId !== null && topWeightTons !== null) {
    ctx.consumed.add("sessionNumber");
    ctx.consumed.add("truckId");
    ctx.consumed.add("weightTons");
    const head = `إنشاء جلسة وزن #${arabicInteger.format(topSessionNumber)} للشاحنة #${arabicInteger.format(topTruckId)} — الوزن: ${arabicDecimal.format(topWeightTons)} طن`;
    const extras = renderObject(value, ctx);
    return extras.length > 0 ? `${head}، ${extras.join("، ")}` : head;
  }

  // ── Headline: event → status transition → action ─────────────────────
  const headlineParts: string[] = [];

  if (typeof value.event === "string") {
    headlineParts.push(EVENT_LABELS[value.event] ?? humanizeKey(value.event));
    ctx.consumed.add("event");
  } else if (typeof value.action === "string" && EVENT_LABELS[value.action]) {
    headlineParts.push(EVENT_LABELS[value.action]);
    ctx.consumed.add("action");
  }

  const fromStatus = typeof value.from === "string" ? value.from : null;
  const toStatus = typeof value.to === "string" ? value.to : null;
  if (fromStatus && toStatus) {
    const phrase = `من ${statusLabel(fromStatus)} إلى ${statusLabel(toStatus)}`;
    headlineParts.push(headlineParts.length === 0 ? `تغيير الحالة ${phrase}` : `(${phrase})`);
    ctx.consumed.add("from");
    ctx.consumed.add("to");
  } else if (toStatus && !fromStatus) {
    const t = statusLabel(toStatus);
    headlineParts.push(headlineParts.length === 0 ? `تغيير الحالة إلى ${t}` : `(إلى ${t})`);
    ctx.consumed.add("to");
  }

  if (headlineParts.length === 0) {
    headlineParts.push(ACTION_LABELS[action] ?? action);
  }

  const body = renderObject(value, ctx);
  if (body.length === 0) return headlineParts.join(" ");
  return `${headlineParts.join(" ")} — ${body.join("، ")}`;
}
