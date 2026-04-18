"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Printer, ArrowRight } from "lucide-react";
import Link from "next/link";
import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";
import { durationBetween, formatDuration } from "@/lib/format-duration";

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
  size: { displayName: string };
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
  customer: { id: number; fullName: string; code: string } | null;
  creator: { fullName: string };
  closer: { fullName: string } | null;
  sessions: WeighSessionItem[];
  requestItems: TruckRequestItemPrint[];
  salesOrder: {
    orderNumber: string;
    kind: string;
    grade: string | null;
    contract: { customer: { fullName: string; code: string } };
  } | null;
}

export function ScaleCardPrint({ truckId }: { truckId: number }) {
  const [truck, setTruck] = useState<TruckDetail | null>(null);
  const [loading, setLoading] = useState(true);

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

  const waitMs = durationBetween(truck.createdAt, truck.tareTime);
  const loadingMs = durationBetween(truck.tareTime, truck.grossTime);
  const totalMs = durationBetween(truck.createdAt, truck.closedAt);

  return (
    <>
      {/* Screen-only toolbar */}
      <div className="print:hidden flex items-center gap-3 mb-4">
        <Link href={`/scale/${truck.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 me-1" />
            العودة
          </Button>
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4 me-1" />
          طباعة
        </Button>
      </div>

      {/* Printable card */}
      <div className="scale-card mx-auto max-w-[210mm] bg-white text-black p-6 print:p-4 print:text-[11pt] print:leading-tight border print:border-0 rounded-lg print:rounded-none">
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-3 mb-4">
          <h1 className="text-xl font-bold print:text-[16pt]">كرت قبان</h1>
          <p className="text-sm text-gray-600 print:text-[9pt]">
            مصنع الحديد — نظام إدارة القبان
          </p>
        </div>

        {/* Card Number + Date */}
        <div className="flex justify-between items-center mb-4 text-sm">
          <div>
            <span className="font-bold">رقم الكرت: </span>
            <span className="font-mono">{truck.id}</span>
          </div>
          <div>
            <span className="font-bold">التاريخ: </span>
            <span>
              {truck.closedAt
                ? new Date(truck.closedAt).toLocaleDateString("ar-SY")
                : new Date(truck.createdAt).toLocaleDateString("ar-SY")}
            </span>
          </div>
        </div>

        {/* Truck Info */}
        <table className="w-full text-sm mb-4">
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
            {truck.salesOrder && (
              <tr>
                <td className="font-bold py-1 pe-4">أمر البيع:</td>
                <td className="py-1">{truck.salesOrder.orderNumber}</td>
                <td className="font-bold py-1 pe-4">العميل:</td>
                <td className="py-1">{truck.salesOrder.contract.customer.fullName}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Request Items */}
        {truck.requestItems && truck.requestItems.length > 0 && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2">تفاصيل الطلبية</h3>
            <div className="border border-black rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 print:bg-gray-200">
                    <th className="py-1.5 px-2 text-start border-b border-black">القياس</th>
                    <th className="py-1.5 px-2 text-start border-b border-black">عدد الربطات</th>
                  </tr>
                </thead>
                <tbody>
                  {truck.requestItems.map((item) => (
                    <tr key={item.id} className="border-b border-gray-200">
                      <td className="py-1 px-2">{item.size.displayName}</td>
                      <td className="py-1 px-2 font-mono">{item.bundleCount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Weight Summary */}
        <div className="border border-black rounded mb-4">
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
                  {new Date(truck.createdAt).toLocaleString("ar-SY")}
                </td>
              </tr>
              <tr className="border-b border-gray-300">
                <td className="py-2 px-3">وزن الفارغ (Tare)</td>
                <td className="py-2 px-3 font-mono font-bold">
                  {tare.toLocaleString("ar-SY")} كغ
                </td>
                <td className="py-2 px-3 text-xs">
                  {truck.tareTime
                    ? new Date(truck.tareTime).toLocaleString("ar-SY")
                    : "—"}
                </td>
              </tr>
              <tr className="border-b border-gray-300">
                <td className="py-2 px-3">وزن المحمّل (Gross)</td>
                <td className="py-2 px-3 font-mono font-bold">
                  {gross.toLocaleString("ar-SY")} كغ
                </td>
                <td className="py-2 px-3 text-xs">
                  {truck.grossTime
                    ? new Date(truck.grossTime).toLocaleString("ar-SY")
                    : "—"}
                </td>
              </tr>
              <tr className="bg-gray-50">
                <td className="py-2 px-3 font-bold">صافي القبان (Net)</td>
                <td className="py-2 px-3 font-mono font-bold text-base">
                  {bridgeNetKg.toLocaleString("ar-SY")} كغ
                </td>
                <td className="py-2 px-3" />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Timing Summary */}
        <div className="border border-black rounded mb-4">
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
                  مدة التحميل (الفارغ → المحمّل)
                </td>
                <td className="py-1.5 px-3 font-bold">
                  {formatDuration(loadingMs)}
                </td>
              </tr>
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

        {/* Internal Sessions */}
        {truck.sessions.length > 0 && (
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2">
              الوزنات الداخلية ({truck.sessions.length} وزنة)
            </h3>
            <div className="border border-black rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 print:bg-gray-200">
                    <th className="py-1.5 px-2 text-start border-b border-black w-10">#</th>
                    <th className="py-1.5 px-2 text-start border-b border-black">القياس</th>
                    <th className="py-1.5 px-2 text-start border-b border-black">الربطات</th>
                    <th className="py-1.5 px-2 text-start border-b border-black">الوزن (طن)</th>
                  </tr>
                </thead>
                <tbody>
                  {truck.sessions.map((s) => (
                    <tr key={s.id} className="border-b border-gray-200">
                      <td className="py-1 px-2 font-mono">{s.sessionNumber}</td>
                      <td className="py-1 px-2">{s.size?.displayName ?? "—"}</td>
                      <td className="py-1 px-2">{s.bundleCount ?? "—"}</td>
                      <td className="py-1 px-2 font-mono">{Number(s.weightTons).toFixed(3)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td colSpan={3} className="py-1.5 px-2">المجموع الكلي (كل الوزنات)</td>
                    <td className="py-1.5 px-2 font-mono">{totalSessionsTons.toFixed(3)} طن</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <h3 className="font-bold text-sm mb-2">الإجمالي حسب القياس</h3>
              <div className="border border-black rounded">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 print:bg-gray-200">
                      <th className="py-1.5 px-2 text-start border-b border-black">القياس</th>
                      <th className="py-1.5 px-2 text-start border-b border-black">إجمالي الربطات</th>
                      <th className="py-1.5 px-2 text-start border-b border-black">إجمالي الوزن (طن)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregateWeighSessionsBySize(truck.sessions).map((row) => (
                      <tr key={row.sizeId ?? "none"} className="border-b border-gray-200">
                        <td className="py-1 px-2">{row.displayName}</td>
                        <td className="py-1 px-2 font-mono">
                          {row.totalBundles != null
                            ? row.totalBundles.toLocaleString("ar-SY")
                            : "—"}
                        </td>
                        <td className="py-1 px-2 font-mono font-bold">{row.totalTons.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Cross Verification */}
        <div className="border border-dashed border-gray-400 rounded p-3 mb-4 text-sm">
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
              <span className={`font-mono font-bold ${Math.abs(discrepancyTons) > 0.5 ? "text-red-600" : ""}`}>
                {discrepancyTons.toFixed(3)} طن
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-end text-xs text-gray-600 border-t border-gray-300 pt-3">
          <div className="space-y-0.5">
            <div>المشغّل: {truck.closer?.fullName ?? truck.creator.fullName}</div>
            {truck.closedAt && (
              <div>وقت الإغلاق: {new Date(truck.closedAt).toLocaleString("ar-SY")}</div>
            )}
          </div>
          <div className="text-left space-y-0.5">
            {truck.notes && <div>ملاحظات: {truck.notes}</div>}
            <div>طُبع: {new Date().toLocaleString("ar-SY")}</div>
          </div>
        </div>

        {/* Signature Lines */}
        <div className="mt-8 flex justify-around text-sm print:mt-12">
          <div className="text-center">
            <div className="w-32 border-b border-black mb-1" />
            <div>عامل القبان</div>
          </div>
          <div className="text-center">
            <div className="w-32 border-b border-black mb-1" />
            <div>السائق</div>
          </div>
          <div className="text-center">
            <div className="w-32 border-b border-black mb-1" />
            <div>المدير</div>
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body { margin: 0; padding: 0; }
          nav, header, aside, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
          .scale-card { box-shadow: none; border: none; }
          @page { size: A4 portrait; margin: 10mm; }
        }
      `}</style>
    </>
  );
}
