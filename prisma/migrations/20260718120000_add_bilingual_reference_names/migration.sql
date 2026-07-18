-- Phase 5 (bilingual i18n): English display names for reference data.
-- All columns are nullable so existing rows are never broken. localizedName()
-- falls back to the Arabic column whenever the English one is null/empty.

-- ─── Columns ──────────────────────────────────────────────────────
ALTER TABLE "destinations" ADD COLUMN "name_en" TEXT;
ALTER TABLE "size_lookup" ADD COLUMN "display_name_en" TEXT;
ALTER TABLE "roles" ADD COLUMN "display_name_en" TEXT;
ALTER TABLE "permissions" ADD COLUMN "display_name_en" TEXT;
ALTER TABLE "stock_yards" ADD COLUMN "name_en" TEXT;
ALTER TABLE "stock_locations" ADD COLUMN "name_en" TEXT;

-- ─── Backfill destinations (mirrors CITY_EN in src/lib/en-labels.ts) ──
UPDATE "destinations" SET "name_en" = 'Damascus'       WHERE "name" = 'دمشق';
UPDATE "destinations" SET "name_en" = 'Rural Damascus' WHERE "name" = 'ريف دمشق';
UPDATE "destinations" SET "name_en" = 'Homs'           WHERE "name" = 'حمص';
UPDATE "destinations" SET "name_en" = 'Hama'           WHERE "name" = 'حماة';
UPDATE "destinations" SET "name_en" = 'Aleppo'         WHERE "name" = 'حلب';
UPDATE "destinations" SET "name_en" = 'Lattakia'       WHERE "name" = 'اللاذقية';
UPDATE "destinations" SET "name_en" = 'Tartus'         WHERE "name" = 'طرطوس';
UPDATE "destinations" SET "name_en" = 'Daraa'          WHERE "name" = 'درعا';
UPDATE "destinations" SET "name_en" = 'As-Suwayda'     WHERE "name" = 'السويداء';
UPDATE "destinations" SET "name_en" = 'Idlib'          WHERE "name" = 'إدلب';
UPDATE "destinations" SET "name_en" = 'Al-Hasakah'     WHERE "name" = 'الحسكة';
UPDATE "destinations" SET "name_en" = 'Deir ez-Zor'    WHERE "name" = 'دير الزور';
UPDATE "destinations" SET "name_en" = 'Raqqa'          WHERE "name" = 'الرقة';
UPDATE "destinations" SET "name_en" = 'Quneitra'       WHERE "name" = 'القنيطرة';

-- ─── Backfill sizes (mirrors SIZE_EN_BY_CODE in src/lib/en-labels.ts) ──
UPDATE "size_lookup" SET "display_name_en" = '6mm'                            WHERE "code" = '6mm';
UPDATE "size_lookup" SET "display_name_en" = '8mm'                            WHERE "code" = '8mm';
UPDATE "size_lookup" SET "display_name_en" = '10mm'                           WHERE "code" = '10mm';
UPDATE "size_lookup" SET "display_name_en" = '12mm'                           WHERE "code" = '12mm';
UPDATE "size_lookup" SET "display_name_en" = '14mm'                           WHERE "code" = '14mm';
UPDATE "size_lookup" SET "display_name_en" = '16mm'                           WHERE "code" = '16mm';
UPDATE "size_lookup" SET "display_name_en" = '18mm'                           WHERE "code" = '18mm';
UPDATE "size_lookup" SET "display_name_en" = '20mm'                           WHERE "code" = '20mm';
UPDATE "size_lookup" SET "display_name_en" = '22mm'                           WHERE "code" = '22mm';
UPDATE "size_lookup" SET "display_name_en" = '25mm'                           WHERE "code" = '25mm';
UPDATE "size_lookup" SET "display_name_en" = 'Short bars 1–4 m'               WHERE "code" = 'shortbar_1_4m';
UPDATE "size_lookup" SET "display_name_en" = 'Short bars 4–12 m'              WHERE "code" = 'shortbar_4_12m';
UPDATE "size_lookup" SET "display_name_en" = 'Scrap'                          WHERE "code" = 'scrap';
UPDATE "size_lookup" SET "display_name_en" = 'Imported billet tying wire 6mm' WHERE "code" = 'billet_wire_6mm';
UPDATE "size_lookup" SET "display_name_en" = 'Rebar under 70 cm'             WHERE "code" = 'rebar_under_70cm';
UPDATE "size_lookup" SET "display_name_en" = 'Billet scrap 10m'              WHERE "code" = 'billet_scrap_10m';
UPDATE "size_lookup" SET "display_name_en" = 'Scrap 50 cm to 1 m'           WHERE "code" = 'scrap_50cm_1m';
