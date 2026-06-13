import { describe, expect, it } from "vitest";

import { formatAuditDetails } from "./audit-details";

const intFmt = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 3 });

describe("formatAuditDetails", () => {
  it("returns a placeholder for null/undefined", () => {
    expect(formatAuditDetails("create", null)).toBe("—");
    expect(formatAuditDetails("update", undefined)).toBe("—");
    expect(formatAuditDetails("update", "")).toBe("—");
  });

  it("returns plain strings unchanged", () => {
    expect(formatAuditDetails("update", "manual note")).toBe("manual note");
  });

  it("returns invalid JSON strings unchanged", () => {
    expect(formatAuditDetails("update", "{not-json")).toBe("{not-json");
  });

  it("parses stringified JSON before formatting", () => {
    expect(
      formatAuditDetails("upload", '{"truckId":7,"filePath":"uploads/trucks/a.jpg"}'),
    ).toBe(`تم رفع صورة للشاحنة #${intFmt.format(7)}`);
  });

  it("describes tare-recorded events with the new weight and status", () => {
    const out = formatAuditDetails("status_change", {
      event: "tare_recorded",
      newValue: { status: "FirstWeigh", tareWeightKg: 12499 },
    });
    expect(out).toContain("تم تسجيل وزن التار");
    expect(out).toContain("الحالة: الوزن الأول");
    expect(out).toContain(`وزن التار: ${intFmt.format(12499)} كغ`);
  });

  it("describes gross-recorded events with the loader id", () => {
    const out = formatAuditDetails("status_change", {
      event: "gross_recorded",
      newValue: { status: "SecondWeigh", loaderId: 14 },
    });
    expect(out).toContain("تم تسجيل الوزن الإجمالي");
    expect(out).toContain(`المحمّل: #${intFmt.format(14)}`);
  });

  it("describes loading-confirmed events", () => {
    const out = formatAuditDetails("status_change", {
      event: "loading_confirmed",
      newValue: { status: "LoadingComplete", loaderId: 1 },
    });
    expect(out).toContain("تم تأكيد التحميل");
    expect(out).toContain(`المحمّل: #${intFmt.format(1)}`);
  });

  it("describes a round-weighed-return event with round details in Arabic", () => {
    const out = formatAuditDetails("status_change", {
      event: "round_weighed_return",
      newValue: {
        status: "FirstWeigh",
        roundNumber: 1,
        roundGrade: "FIRST",
        roundNetKg: 15000,
        nextRoundNumber: 2,
      },
    });
    expect(out).toContain("وزنة خارجية ورجوع للتحميل");
    expect(out).toContain(`دورة القبان: #${intFmt.format(1)}`);
    expect(out).toContain("نخب الدورة: نخب أول");
    expect(out).toContain(`صافي الدورة: ${intFmt.format(15000)} كغ`);
    expect(out).toContain(`الدورة التالية: #${intFmt.format(2)}`);
  });

  it("describes a gross correction with old/new weights and cascade flag", () => {
    const out = formatAuditDetails("update", {
      action: "gross_correction",
      roundNumber: 2,
      isFinalRound: false,
      cascadedToNextRound: true,
      oldGrossWeightKg: 25000,
      newGrossWeightKg: 24700,
    });
    expect(out).toContain("تصحيح وزنة خارجية");
    expect(out).toContain(`الوزن الإجمالي السابق: ${intFmt.format(25000)} كغ`);
    expect(out).toContain(`الوزن الإجمالي الجديد: ${intFmt.format(24700)} كغ`);
    expect(out).toContain("انعكس على بداية الدورة التالية: نعم");
    expect(out).toContain("وزنة الخروج النهائي: لا");
  });

  it("translates grade enum values to Arabic labels", () => {
    const out = formatAuditDetails("update", { grade: "SECOND" });
    expect(out).toContain("النخب: نخب ثاني");
  });

  it("describes a session_reopened event (gap fix)", () => {
    const out = formatAuditDetails("status_change", {
      event: "session_reopened",
      newValue: { status: "OnScale" },
    });
    expect(out).toContain("تم إعادة فتح التحميل قبل الوزن");
  });

  it("merges bridge-net kg + tons into a single fragment on status close", () => {
    const out = formatAuditDetails("status_change", {
      to: "Completed",
      from: "SecondWeigh",
      bridgeNetKg: 6201,
      bridgeNetTons: 6.201,
    });
    expect(out).toContain("تغيير الحالة");
    expect(out).toContain("الوزن الثاني");
    expect(out).toContain("اكتملت");
    expect(out).toContain(
      `صافي الميزان: ${intFmt.format(6201)} كغ (${decFmt.format(6.201)} طن)`,
    );
  });

  it("formats weigh-session creation as a single headline", () => {
    const out = formatAuditDetails("create", {
      sizeId: 4,
      truckId: 7,
      weightTons: 6.13,
      sessionNumber: 1,
    });
    expect(out).toContain(
      `إنشاء جلسة وزن #${intFmt.format(1)} للشاحنة #${intFmt.format(7)} — الوزن: ${decFmt.format(6.13)} طن`,
    );
    expect(out).toContain(`المقاس: #${intFmt.format(4)}`);
  });

  it("surfaces unknown keys via humanized labels without losing data", () => {
    const out = formatAuditDetails("update", {
      fullName: "Ahmed",
      nationalId: "12345",
      customCode: "ABC",
    });
    expect(out).toContain("تعديل");
    expect(out).toContain("الاسم: Ahmed");
    expect(out).toContain("الرقم الوطني: 12345");
    expect(out).toContain("custom code: ABC");
  });

  it("describes status transitions with no event and includes the reason", () => {
    const out = formatAuditDetails("status_change", {
      from: "draft",
      to: "approved",
      reason: "اعتماد الإدارة",
    });
    expect(out).toContain("تغيير الحالة");
    expect(out).toContain("من مسودة");
    expect(out).toContain("إلى موافق عليه");
    expect(out).toContain("السبب: اعتماد الإدارة");
  });

  it("renders nested arrays and objects without crashing", () => {
    const out = formatAuditDetails("update", {
      items: [
        { sizeId: 1, weightTons: 2.5 },
        { sizeId: 2, weightTons: 3.75 },
      ],
    });
    expect(out).toContain("تعديل");
    expect(out).toContain("items");
    expect(out).toContain(`${decFmt.format(2.5)} طن`);
    expect(out).toContain(`${decFmt.format(3.75)} طن`);
  });
});
