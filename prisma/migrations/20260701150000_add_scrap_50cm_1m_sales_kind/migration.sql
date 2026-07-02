-- Add the new SCRAP_50CM_1M sales-order kind (scrap 50 cm to 1 m).
-- Sold by weight (tons), no grade, no special ratio, no internal weighing.
ALTER TYPE "SalesOrderKind" ADD VALUE IF NOT EXISTS 'SCRAP_50CM_1M';

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
  'scrap_50cm_1m',
  'سكراب من 50 سم إلى 1 م',
  false,
  true,
  false,
  true,
  16
)
ON CONFLICT ("code") DO NOTHING;
