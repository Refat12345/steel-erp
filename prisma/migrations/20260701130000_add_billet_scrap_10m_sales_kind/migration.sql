-- Add the new BILLET_SCRAP_10M sales-order kind (billet scrap 10 m).
-- Sold by weight (tons), no grade, no special ratio, no internal weighing.
ALTER TYPE "SalesOrderKind" ADD VALUE IF NOT EXISTS 'BILLET_SCRAP_10M';

INSERT INTO "size_lookup" (
  "code",
  "display_name",
  "is_special_ratio",
  "subject_to_tolerance",
  "is_bundle_type",
  "is_active",
  "sort_order"
)
VALUES (
  'billet_scrap_10m',
  'بيلت خردة 10m',
  false,
  true,
  false,
  true,
  15
)
ON CONFLICT ("code") DO NOTHING;
