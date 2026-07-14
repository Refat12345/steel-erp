-- AlterTable
ALTER TABLE "stock_locations" ADD COLUMN "is_virtual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "weigh_sessions" ADD COLUMN "from_production" BOOLEAN NOT NULL DEFAULT false;

-- Seed the single virtual "direct from production" pass-through location.
-- Attached to the lowest-id yard purely to satisfy the FK; it is filtered out
-- of the map, pickers, and admin by the is_virtual flag.
INSERT INTO "stock_locations"
  ("yard_id", "code", "name_ar", "segment", "unit", "allowed_grade",
   "is_active", "is_virtual", "sort_order", "grid_row", "grid_col", "grid_span",
   "created_at", "updated_at")
SELECT y."id", '__DIRECT__', 'خط الإنتاج (تسليم مباشر)', 'GENERAL', 'BUNDLE', NULL,
       true, true, 9999, 1, 1, 1, now(), now()
FROM "stock_yards" y
ORDER BY y."id" ASC
LIMIT 1
ON CONFLICT DO NOTHING;
