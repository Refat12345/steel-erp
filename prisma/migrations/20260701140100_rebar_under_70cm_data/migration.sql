-- Rename rebar-under product from 50 cm to 70 cm (display + stable codes).
UPDATE "size_lookup"
SET
  "code" = 'rebar_under_70cm',
  "display_name" = 'مبروم أقل من 70 سم'
WHERE "code" = 'rebar_under_50cm';

UPDATE "sales_orders"
SET "kind" = 'REBAR_UNDER_70CM'
WHERE "kind" = 'REBAR_UNDER_50CM';
