-- Add the new REBAR_UNDER_70CM sales-order kind (rebar under 70 cm).
-- Sold by weight (tons), no grade, no special ratio, no internal weighing.
ALTER TYPE "SalesOrderKind" ADD VALUE IF NOT EXISTS 'REBAR_UNDER_70CM';

-- Reference data: register the matching size in the lookup catalog so the
-- product is available on production after `prisma migrate deploy` without a
-- manual insert. Idempotent — re-running the migration is a no-op.
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
  'rebar_under_70cm',
  'مبروم أقل من 70 سم',
  false,
  true,
  false,
  true,
  14
)
ON CONFLICT ("code") DO NOTHING;
