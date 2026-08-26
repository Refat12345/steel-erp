-- Steel classifications (technical sub-classifications within a grade):
--   * New catalog table steel_classifications (B500B / B400DWR — both FIRST
--     grade). A refinement label, NOT a new grade: grade-based rules are
--     unaffected.
--   * truck_request_items, weigh_sessions and stock_movements gain a nullable
--     classification_id. Intentionally NOT added to bridge_rounds: a round
--     stays single-grade but MAY mix classifications (management rule), so
--     the per-classification breakdown comes from weigh sessions.
--   * truck_request_items uniqueness becomes (truck_operation_id, size_id,
--     grade, classification_id) plus a partial unique index for the
--     "grade set, no classification" case; the existing grade-IS-NULL partial
--     index keeps guarding no-grade lines.
--   * NULL classification_id = unclassified (all pre-existing rows).
-- All changes are additive — no destructive UPDATE/DELETE on existing data.

-- CreateTable
CREATE TABLE "steel_classifications" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "display_name_en" TEXT,
    "grade" "SalesOrderGrade" NOT NULL DEFAULT 'FIRST',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "steel_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "steel_classifications_code_key" ON "steel_classifications"("code");

-- AlterTable
ALTER TABLE "truck_request_items" ADD COLUMN "classification_id" INTEGER;

-- AlterTable
ALTER TABLE "weigh_sessions" ADD COLUMN "classification_id" INTEGER;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "classification_id" INTEGER;

-- AddForeignKey
ALTER TABLE "truck_request_items" ADD CONSTRAINT "truck_request_items_classification_id_fkey" FOREIGN KEY ("classification_id") REFERENCES "steel_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_sessions" ADD CONSTRAINT "weigh_sessions_classification_id_fkey" FOREIGN KEY ("classification_id") REFERENCES "steel_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_classification_id_fkey" FOREIGN KEY ("classification_id") REFERENCES "steel_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "truck_request_items_classification_id_idx" ON "truck_request_items"("classification_id");

-- CreateIndex
CREATE INDEX "weigh_sessions_classification_id_idx" ON "weigh_sessions"("classification_id");

-- CreateIndex
CREATE INDEX "stock_movements_classification_id_idx" ON "stock_movements"("classification_id");

-- DropIndex (old uniqueness: one row per size+grade per truck)
DROP INDEX "truck_request_items_truck_operation_id_size_id_grade_key";

-- CreateIndex (new uniqueness: one row per size+grade+classification per truck)
CREATE UNIQUE INDEX "truck_request_items_op_size_grade_classification_key"
    ON "truck_request_items"("truck_operation_id", "size_id", "grade", "classification_id");

-- NULL classifications are distinct in the composite index above, so enforce
-- "same size+grade without classification may appear only once" separately.
-- (The pre-existing truck_request_items_size_no_grade_uniq partial index
-- still guards the grade-IS-NULL case — no-grade lines never carry a
-- classification, which the application layer enforces.)
CREATE UNIQUE INDEX "truck_request_items_size_grade_no_class_uniq"
    ON "truck_request_items"("truck_operation_id", "size_id", "grade")
    WHERE "grade" IS NOT NULL AND "classification_id" IS NULL;

-- ─── Seed the initial catalog ──────────────────────────────────────
-- Idempotent so re-running on a DB where the admin already created these
-- codes is harmless. Both are FIRST-grade classifications; codes are
-- identical in Arabic and English UI.
INSERT INTO "steel_classifications" ("code", "display_name", "display_name_en", "grade", "sort_order")
VALUES
    ('B500B', 'B500B', 'B500B', 'FIRST', 1),
    ('B400DWR', 'B400DWR', 'B400DWR', 'FIRST', 2)
ON CONFLICT ("code") DO NOTHING;
