"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Printer, ArrowRight } from "lucide-react";
import Link from "next/link";
import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";
import { formatDuration } from "@/lib/format-duration";
import { formatDate, formatDateTime } from "@/lib/date-format";
import type { TruckTimings } from "@/lib/truck-timing";
import { getDisplayGradeLabel } from "@/lib/truck-grade";
import {
  computeA4PrintFitScale,
  SCALE_CARD_PRINT_HEIGHT_FUDGE,
} from "@/lib/scale-card-print-fit";
import type { SalesOrderGrade } from "@prisma/client";

interface WeighSessionItem {
  id: number;
  sessionNumber: number;
  sizeId: number | null;
  bundleCount: number | null;
  weightTons: string;
  size: { displayName: string } | null;
}

interface TruckRequestItemPrint {
  id: number;
  bundleCount: number | null;
  requestedTons: string | null;
  size: { displayName: string; isBundleType: boolean };
}

interface TruckDetail {
  id: number;
  plateNumber: string;
  driverName: string;
  status: string;
  tareWeightKg: string | null;
  grossWeightKg: string | null;
  tareTime: string | null;
  grossTime: string | null;
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
  loadingConfirmedAt: string | null;
  customer: { id: number; fullName: string; code: string } | null;
  destination: { id: number; name: string; details: string | null } | null;
  creator: { fullName: string };
  closer: { fullName: string } | null;
  loader: { fullName: string } | null;
  sessions: WeighSessionItem[];
  requestItems: TruckRequestItemPrint[];
  operationalGrade: SalesOrderGrade | null;
  salesOrder: {
    orderNumber: string;
    kind: string;
    grade: SalesOrderGrade | null;
    contract: { customer: { fullName: string; code: string } };
  } | null;
  timings: TruckTimings;
}

export function ScaleCardPrint({
  truckId,
  variant = "internal",
}: {
  truckId: number;
  variant?: "internal" | "driver";
}) {
  const isDriver = variant === "driver";
  const isInternal = !isDriver;
  const printBodyClass = `scale-card-print-${variant}`;
  const [truck, setTruck] = useState<TruckDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const printHostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const fetchTruck = useCallback(async () => {
    try {
      const res = await fetch(`/api/trucks/${truckId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setTruck(json.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [truckId]);

  useEffect(() => {
    fetchTruck();
  }, [fetchTruck]);

  const resetPrintFit = useCallback(() => {
    const card = cardRef.current;
    const host = printHostRef.current;
    if (card) {
      card.classList.remove("scale-card--measure-print", "scale-card--print-fitted");
      card.style.zoom = "";
      card.style.transform = "";
      card.style.transformOrigin = "";
    }
    if (host) {
      host.style.height = "";
      host.style.overflow = "";
    }
  }, []);

  const applyPrintFit = useCallback(() => {
    const card = cardRef.current;
    const host = printHostRef.current;
    if (!card || !host) return;

    resetPrintFit();

    card.classList.add("scale-card--measure-print");
    const width = card.offsetWidth;
    const height = Math.max(card.scrollHeight, card.getBoundingClientRect().height);
    card.classList.remove("scale-card--measure-print");

    const scale = computeA4PrintFitScale(
      width,
      height * SCALE_CARD_PRINT_HEIGHT_FUDGE,
    );
    if (scale >= 0.999) return;

    card.classList.add("scale-card--print-fitted");

    if (typeof CSS !== "undefined" && CSS.supports("zoom", "1")) {
      card.style.zoom = String(scale);
      return;
    }

    card.style.transformOrigin = "top center";
    card.style.transform = `scale(${scale})`;
    host.style.height = `${height * scale}px`;
    host.style.overflow = "hidden";
  }, [resetPrintFit]);

  useEffect(() => {
    document.body.classList.add(printBodyClass);
    const onBeforePrint = () => applyPrintFit();
    const onAfterPrint = () => resetPrintFit();

    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      document.body.classList.remove(printBodyClass);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      resetPrintFit();
    };
  }, [printBodyClass, applyPrintFit, resetPrintFit]);

  const handlePrint = useCallback(() => {
    applyPrintFit();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  }, [applyPrintFit]);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>;
  }
  if (!truck) {
    return <div className="p-8 text-center text-muted-foreground">العملية غير موجودة</div>;
  }

  const tare = truck.tareWeightKg ? Number(truck.tareWeightKg) : 0;
  const gross = truck.grossWeightKg ? Number(truck.grossWeightKg) : 0;
  const bridgeNetKg = gross - tare;
  const totalSessionsTons = truck.sessions.reduce(
    (sum, s) => sum + Number(s.weightTons),
    0,
  );
  const bridgeNetTons = bridgeNetKg / 1000;
  const discrepancyTons = bridgeNetTons - totalSessionsTons;
  const { waitMs, scaleMs, internalLoadingMs, totalMs, loaderName, loadingConfirmedAt } =
    truck.timings;

  const sessionsBySize = aggregateWeighSessionsBySize(truck.sessions);
  const totalAggregateBundles =
    sessionsBySize.length > 0 &&
    sessionsBySize.every((row) => row.totalBundles != null)
      ? sessionsBySize.reduce((sum, row) => sum + (row.totalBundles ?? 0), 0)
      : null;

  const hostClassName = `scale-card-print-host scale-card-print-host--${variant} mx-auto max-w-[210mm]`;

  return (
    <>
      {/* Screen-only toolbar */}
      <div className="print:hidden flex items-center gap-3 mb-4 flex-wrap">
        <Link href={`/scale/${truck.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 me-1" />
            العودة
          </Button>
        </Link>
        <div className="flex items-center gap-2 ms-auto">
          <Link
            href={`/scale/${truck.id}/print`}
            className={variant === "internal" ? "pointer-events-none" : ""}
          >
            <Button
              variant={variant === "internal" ? "secondary" : "outline"}
              size="sm"
              disabled={variant === "internal"}
            >
              نسخة داخلية
            </Button>
          </Link>
          <Link
            href={`/scale/${truck.id}/print?format=driver`}
            className={variant === "driver" ? "pointer-events-none" : ""}
          >
            <Button
              variant={variant === "driver" ? "secondary" : "outline"}
              size="sm"
              disabled={variant === "driver"}
            >
              نسخة السائق
            </Button>
          </Link>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 me-1" />
            طباعة
          </Button>
        </div>
      </div>

      {/* Printable card — internal host clips scaled content to one A4 page */}
      <div ref={printHostRef} className={hostClassName}>
      <div
        ref={cardRef}
        className={`scale-card scale-card--${variant} mx-auto max-w-[210mm] bg-white text-black p-6 print:p-3 print:leading-tight border print:border-0 rounded-lg print:rounded-none ${isDriver ? "print:text-[8pt]" : "print:text-[9pt]"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-3 print:pb-2 print:mb-2">
          {/* Logo */}
          <div className="flex-shrink-0">
            {/* Place steeltech-logo.png in /public to activate */}
            <img
              src="/steeltech-logo.png"
              alt="SteelTech"
              className="h-20 print:h-14 w-auto object-contain max-w-[200px] print:max-w-[150px]"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          {/* Title */}
          <div className="text-center flex-1">
            <h1 className="text-xl font-bold print:text-[14pt]">كرت قبان</h1>
            {isDriver && (
              <p className="text-xs font-semibold text-gray-500 mt-0.5 tracking-wide">
                — نسخة السائق —
              </p>
            )}
            <p className="text-xs text-gray-500 print:text-[7pt]">
              نظام إدارة القبان
            </p>
          </div>
          {/* Spacer to balance logo */}
          <div className="flex-shrink-0 w-20 print:w-14" aria-hidden />
        </div>

        {/* Card Number + Date */}
        <div className="flex justify-between items-center mb-3 print:mb-2 text-sm">
          <div>
            <span className="font-bold">رقم الكرت: </span>
            <span className="font-mono">{truck.id}</span>
          </div>
          <div>
            <span className="font-bold">التاريخ: </span>
            <span>
              {truck.closedAt
                ? formatDate(truck.closedAt)
                : formatDate(truck.createdAt)}
            </span>
          </div>
        </div>

        {/* Truck Info */}
        <table className="w-full text-sm mb-3 print:mb-2">
          <tbody>
            {truck.customer && (
              <tr>
                <td className="font-bold py-1 pe-4 w-1/4">الزبون:</td>
                <td className="py-1" colSpan={3}>
                  {truck.customer.fullName} ({truck.customer.code})
                </td>
              </tr>
            )}
            <tr>
              <td className="font-bold py-1 pe-4 w-1/4">رقم اللوحة:</td>
              <td className="py-1">{truck.plateNumber}</td>
              <td className="font-bold py-1 pe-4 w-1/4">السائق:</td>
              <td className="py-1">{truck.driverName}</td>
            </tr>
            <tr>
              <td className="font-bold py-1 pe-4">الوجهة:</td>
              <td className="py-1" colSpan={3}>
                {truck.destination
                  ? truck.destination.details
                    ? `${truck.destination.name} - ${truck.destination.details}`
                    : truck.destination.name
                  : "—"}
              </td>
            </tr>
            {truck.salesOrder && (
              <tr>
                <td className="font-bold py-1 pe-4">أمر البيع:</td>
                <td className="py-1">{truck.salesOrder.orderNumber}</td>
                <td className="font-bold py-1 pe-4">العميل:</td>
                <td className="py-1">{truck.salesOrder.contract.customer.fullName}</td>
              </tr>
            )}
            {getDisplayGradeLabel(truck) && (
              <tr>
                <td className="font-bold py-1 pe-4">النخب:</td>
                <td className="py-1" colSpan={3}>{getDisplayGradeLabel(truck)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Request Items */}
        {truck.requestItems && truck.requestItems.length > 0 && (
          <div className="mb-3 print:mb-2">
            <h3 className="font-bold text-sm mb-2">تفاصيل الطلبية</h3>
            <div className="border border-black rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 print:bg-gray-200">
                    <th className="py-1.5 px-2 text-start border-b border-black">القياس</th>
                    <th className="py-1.5 px-2 text-start border-b border-black">الكمية المطلوبة</th>
                  </tr>
                </thead>
                <tbody>
                  {truck.requestItems.map((item) => (
                    <tr key={item.id} className="border-b border-gray-200">
                      <td className="py-1 px-2">{item.size.displayName}</td>
                      <td className="py-1 px-2 font-mono">
                        {item.size.isBundleType
                          ? item.bundleCount != null
                            ? `${item.bundleCount} ربطة`
                            : "—"
                          : item.requestedTons != null
                            ? `${Number(item.requestedTons).toFixed(3)} طن`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Weight Summary */}
        <div className="border border-black rounded mb-3 print:mb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 print:bg-gray-200">
                <th className="py-2 px-3 text-start font-bold border-b border-black">البند</th>
                <th className="py-2 px-3 text-start font-bold border-b border-black">القيمة</th>
                <th className="py-2 px-3 text-start font-bold border-b border-black">الوقت</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-300">
                <td className="py-2 px-3">تسجيل الشاحنة (اللوجستك)</td>
                <td className="py-2 px-3 text-gray-600">—</td>
                <td className="py-2 px-3 text-xs">
                  {formatDateTime(truck.createdAt)}
                </td>
              </tr>
              <tr className="border-b border-gray-300">
                <td className="py-2 px-3">وزن الفارغ (Tare)</td>
                <td className="py-2 px-3 font-mono font-bold">
                  {tare.toLocaleString("en-US")} كغ
                </td>
                <td className="py-2 px-3 text-xs">
                  {truck.tareTime
                    ? formatDateTime(truck.tareTime)
                    : "—"}
                </td>
              </tr>
              <tr className="border-b border-gray-300">
                <td className="py-2 px-3">وزن المحمّل (Gross)</td>
                <td className="py-2 px-3 font-mono font-bold">
                  {gross.toLocaleString("en-US")} كغ
                </td>
                <td className="py-2 px-3 text-xs">
                  {truck.grossTime
                    ? formatDateTime(truck.grossTime)
                    : "—"}
                </td>
              </tr>
              <tr className="bg-gray-50">
                <td className="py-2 px-3 font-bold">صافي القبان (Net)</td>
                <td className="py-2 px-3 font-mono font-bold text-base">
                  {bridgeNetKg.toLocaleString("en-US")} كغ
                </td>
                <td className="py-2 px-3" />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Timing Summary — internal only */}
        {!isDriver && (
          <div className="border border-black rounded mb-3 print:mb-2">
            <div className="bg-gray-100 print:bg-gray-200 px-3 py-1.5 border-b border-black">
              <h3 className="text-sm font-bold">الأزمنة</h3>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="py-1.5 px-3 w-1/2">
                    وقت الانتظار (التسجيل → دخول القبان)
                  </td>
                  <td className="py-1.5 px-3 font-semibold">
                    {formatDuration(waitMs)}
                  </td>
                </tr>
                <tr className="border-b border-gray-300 bg-emerald-50 print:bg-gray-50">
                  <td className="py-1.5 px-3 font-bold">
                    مدة القبان (الفارغ → المحمّل)
                  </td>
                  <td className="py-1.5 px-3 font-bold">
                    {formatDuration(scaleMs)}
                  </td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="py-1.5 px-3">
                    مدة التحميل الداخلي (أول وزنة → تأكيد المحمّل)
                  </td>
                  <td className="py-1.5 px-3 font-semibold">
                    {formatDuration(internalLoadingMs)}
                  </td>
                </tr>
                {loadingConfirmedAt && loaderName && (
                  <tr className="border-b border-gray-300">
                    <td className="py-1.5 px-3">تأكيد المحمّل</td>
                    <td className="py-1.5 px-3 font-semibold">
                      {loaderName} —{" "}
                      {formatDateTime(loadingConfirmedAt)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="py-1.5 px-3">
                    المدة الكلية (التسجيل → الإغلاق)
                  </td>
                  <td className="py-1.5 px-3 font-semibold">
                    {formatDuration(totalMs)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Sessions — internal: totals by size; driver: aggregate without tons */}
        {truck.sessions.length > 0 && (
          <div className="mb-3 print:mb-2">
            <h3 className="font-bold text-sm mb-2">
              {isDriver
                ? "الإجمالي حسب القياس"
                : `الوزنات الداخلية (${truck.sessions.length} وزنة) — الإجمالي حسب القياس`}
            </h3>
            <div className="border border-black rounded">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 print:bg-gray-200">
                      <th className="py-1.5 px-2 text-start border-b border-black">القياس</th>
                      <th className="py-1.5 px-2 text-start border-b border-black">إجمالي الربطات</th>
                      {!isDriver && (
                        <th className="py-1.5 px-2 text-start border-b border-black">إجمالي الوزن (طن)</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsBySize.map((row) => (
                      <tr key={row.sizeId ?? "none"} className="border-b border-gray-200">
                        <td className="py-1 px-2">{row.displayName}</td>
                        <td className="py-1 px-2 font-mono">
                          {row.totalBundles != null
                            ? row.totalBundles.toLocaleString("en-US")
                            : "—"}
                        </td>
                        {!isDriver && (
                          <td className="py-1 px-2 font-mono font-bold">{row.totalTons.toFixed(3)}</td>
                        )}
                      </tr>
                    ))}
                    {!isDriver && (
                      <tr className="bg-gray-50 font-bold">
                        <td className="py-1.5 px-2">المجموع الكلي (كل الوزنات)</td>
                        <td className="py-1.5 px-2 font-mono">
                          {totalAggregateBundles != null
                            ? totalAggregateBundles.toLocaleString("en-US")
                            : "—"}
                        </td>
                        <td className="py-1.5 px-2 font-mono">{totalSessionsTons.toFixed(3)} طن</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
          </div>
        )}

        {/* Cross Verification — internal only */}
        {!isDriver && (
          <div className="border border-dashed border-gray-400 rounded p-3 print:p-2 mb-3 print:mb-2 text-sm">
            <h3 className="font-bold mb-1">المقارنة (للتحقق فقط)</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-gray-600">صافي القبان: </span>
                <span className="font-mono font-bold">{bridgeNetTons.toFixed(3)} طن</span>
              </div>
              <div>
                <span className="text-gray-600">مجموع الداخلي: </span>
                <span className="font-mono font-bold">{totalSessionsTons.toFixed(3)} طن</span>
              </div>
              <div>
                <span className="text-gray-600">الفرق: </span>
                <span
                  className={`font-mono font-bold ${Math.abs(discrepancyTons) > 0.5 ? "text-red-600" : ""}`}
                >
                  {discrepancyTons.toFixed(3)} طن
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-end text-xs text-gray-600 border-t border-gray-300 pt-3">
          <div className="space-y-0.5">
            {!isDriver && (
              <div>المشغّل: {truck.closer?.fullName ?? truck.creator.fullName}</div>
            )}
            {truck.closedAt && (
              <div>وقت الإغلاق: {formatDateTime(truck.closedAt)}</div>
            )}
          </div>
          <div className="text-left space-y-0.5">
            {truck.notes && <div>ملاحظات: {truck.notes}</div>}
            <div>طُبع: {formatDateTime(new Date())}</div>
          </div>
        </div>

        {/* Signature Lines */}
        <div className="mt-8 flex justify-around text-sm print:mt-3">
          <div className="text-center">
            <div className="w-32 border-b border-black mb-1" />
            <div>موظف القبان</div>
          </div>
          <div className="text-center">
            <div className="w-32 border-b border-black mb-1" />
            <div>السائق</div>
          </div>
          <div className="text-center">
            <div className="w-32 border-b border-black mb-1" />
            <div>مشرف القبان</div>
          </div>
        </div>
      </div>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        /* Mirror print typography while measuring on screen */
        .scale-card--internal.scale-card--measure-print {
          font-size: 9pt !important;
          line-height: 1.25 !important;
          padding: 0.75rem !important;
        }
        .scale-card--driver.scale-card--measure-print {
          font-size: 8pt !important;
          line-height: 1.25 !important;
          padding: 0.75rem !important;
        }
        .scale-card--internal.scale-card--measure-print th,
        .scale-card--internal.scale-card--measure-print td,
        .scale-card--driver.scale-card--measure-print th,
        .scale-card--driver.scale-card--measure-print td {
          padding-top: 0.2rem !important;
          padding-bottom: 0.2rem !important;
        }

        @media print {
          body {
            margin: 0;
            padding: 0;
          }
          nav,
          header,
          aside,
          .print\\:hidden {
            display: none !important;
          }
          main {
            padding: 0 !important;
            overflow: visible !important;
          }
          .scale-card {
            box-shadow: none;
            border: none;
          }
          .scale-card-print-host--internal,
          .scale-card-print-host--driver {
            overflow: visible !important;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .scale-card--internal {
            font-size: 9pt;
            line-height: 1.25;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .scale-card--driver {
            font-size: 8pt;
            line-height: 1.25;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .scale-card--internal th,
          .scale-card--internal td,
          .scale-card--driver th,
          .scale-card--driver td {
            padding-top: 0.15rem;
            padding-bottom: 0.15rem;
          }
          .scale-card--internal h3,
          .scale-card--driver h3 {
            margin-bottom: 0.25rem;
          }
          @page {
            size: A4 portrait;
            margin: 4mm;
          }
        }
      `}</style>
    </>
  );
}
