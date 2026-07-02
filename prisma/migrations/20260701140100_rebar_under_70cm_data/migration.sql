-- Rename rebar-under product from 50 cm to 70 cm (legacy dev DBs only).
-- On fresh production this is a no-op: rebar_under_50cm / REBAR_UNDER_50CM never existed.
-- Cast enum to text so PostgreSQL does not require REBAR_UNDER_50CM in the enum type.
UPDATE "size_lookup"
SET
  "code" = 'rebar_under_70cm',
  "display_name" = 'مبروم أقل من 70 سم'
WHERE "code" = 'rebar_under_50cm';

UPDATE "sales_orders"
SET "kind" = 'REBAR_UNDER_70CM'
WHERE "kind"::text = 'REBAR_UNDER_50CM';
