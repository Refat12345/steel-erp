import { describe, expect, it } from "vitest";

import { withLocalizedTruckLabels } from "./localized-name";

describe("withLocalizedTruckLabels — session sourceLocation", () => {
  const truck = {
    id: 1,
    destination: null,
    sessions: [
      {
        id: 10,
        fromProduction: false,
        size: {
          displayName: "مقاس 12",
          displayNameEn: "Size 12",
        },
        sourceLocation: {
          id: 5,
          code: "A5",
          nameAr: "موقع أ",
          nameEn: "Site A",
          yard: {
            id: 1,
            nameAr: "الساحة الأمامية",
            nameEn: "Front yard",
          },
        },
      },
      {
        id: 11,
        fromProduction: true,
        size: null,
        sourceLocation: null,
      },
    ],
  };

  it("rewrites source location and yard names for English locale", () => {
    const localized = withLocalizedTruckLabels(truck, "en");
    const session = localized.sessions[0];

    expect(session.sourceLocation?.nameAr).toBe("Site A");
    expect(session.sourceLocation?.yard?.nameAr).toBe("Front yard");
    expect(session.size?.displayName).toBe("Size 12");
  });

  it("keeps Arabic names for Arabic locale", () => {
    const localized = withLocalizedTruckLabels(truck, "ar");
    const session = localized.sessions[0];

    expect(session.sourceLocation?.nameAr).toBe("موقع أ");
    expect(session.sourceLocation?.yard?.nameAr).toBe("الساحة الأمامية");
    expect(session.size?.displayName).toBe("مقاس 12");
  });

  it("falls back to Arabic when English stock name is null", () => {
    const localized = withLocalizedTruckLabels(
      {
        sessions: [
          {
            sourceLocation: {
              id: 5,
              code: "A5",
              nameAr: "موقع أ",
              nameEn: null,
              yard: { id: 1, nameAr: "الساحة", nameEn: null },
            },
          },
        ],
      },
      "en",
    );

    expect(localized.sessions[0].sourceLocation?.nameAr).toBe("موقع أ");
    expect(localized.sessions[0].sourceLocation?.yard?.nameAr).toBe("الساحة");
  });

  it("leaves null sourceLocation unchanged", () => {
    const localized = withLocalizedTruckLabels(truck, "en");
    expect(localized.sessions[1].sourceLocation).toBeNull();
    expect(localized.sessions[1].fromProduction).toBe(true);
  });

  it("does not invent sessions when the payload has none", () => {
    const localized = withLocalizedTruckLabels({ id: 1 }, "en");
    expect(localized).toEqual({ id: 1 });
  });
});
