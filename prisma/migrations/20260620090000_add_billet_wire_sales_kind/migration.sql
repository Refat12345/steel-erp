-- Add the new BILLET_WIRE sales-order kind (imported billet tying wire, 6mm).
-- Sold by weight (tons), no grade, no special ratio — behaves like scrap/shortbar.
ALTER TYPE "SalesOrderKind" ADD VALUE IF NOT EXISTS 'BILLET_WIRE';

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
  'billet_wire_6mm',
  'أسلاك تربيط بيلت مستورد 6 mm',
  false,
  true,
  false,
  true,
  13
)
ON CONFLICT ("code") DO NOTHING;
