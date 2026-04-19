/**
 * إيقاف مؤقت لواجهات أقسام كاملة (عرض "قيد التطوير" وإخفاء الرابط من القائمة).
 * غيّر القيمة إلى false لإعادة تفعيل القسم دون البحث في الملفات.
 *
 * ملاحظة: لا يعطّل مسارات API؛ فقط واجهة Next.js تحت /sales-orders و /finance.
 */
export const SUSPEND_SALES_ORDERS_UI = true;
export const SUSPEND_FINANCE_UI = true;

/** لاستخدامها في القائمة الجانبية — يخفى الرابط عند التعليق */
export function isNavUrlSuspended(url: string): boolean {
  if (SUSPEND_SALES_ORDERS_UI && url.startsWith("/sales-orders")) return true;
  if (SUSPEND_FINANCE_UI && url.startsWith("/finance")) return true;
  return false;
}
