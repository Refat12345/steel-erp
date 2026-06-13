-- Multi-round bridge weighing:
--   * New table bridge_rounds (one row per external weighbridge round).
--   * weigh_sessions / truck_photos gain nullable bridge_round_id.
--   * truck_request_items gain nullable grade; uniqueness becomes
--     (truck_operation_id, size_id, grade) plus a partial unique index for
--     grade IS NULL (Postgres treats NULLs as distinct in unique indexes).
--   * Backfill: every operation that already has a tare weight gets round 1
--     mirroring its current tare/gross/loader fields; existing sessions and
--     photos are linked to that round.
-- All changes are additive — no destructive UPDATE/DELETE on existing data.

-- CreateTable
CREATE TABLE "bridge_rounds" (
    "id" SERIAL NOT NULL,
    "truck_operation_id" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL,
    "grade" "SalesOrderGrade",
    "start_weight_kg" DECIMAL(10,1) NOT NULL,
    "end_weight_kg" DECIMAL(10,1),
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "loading_confirmed_at" TIMESTAMP(3),
    "loader_id" INTEGER,
    "last_reopened_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bridge_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bridge_rounds_truck_operation_id_round_number_key"
    ON "bridge_rounds"("truck_operation_id", "round_number");

-- CreateIndex
CREATE INDEX "bridge_rounds_truck_operation_id_idx" ON "bridge_rounds"("truck_operation_id");

-- CreateIndex
CREATE INDEX "bridge_rounds_loader_id_idx" ON "bridge_rounds"("loader_id");

-- At most one open (end_weight_kg IS NULL) round per operation.
CREATE UNIQUE INDEX "bridge_rounds_open_round_uniq"
    ON "bridge_rounds"("truck_operation_id")
    WHERE "end_weight_kg" IS NULL;

-- A closed round must weigh more at the end than at the start.
ALTER TABLE "bridge_rounds"
    ADD CONSTRAINT "bridge_rounds_end_gt_start_chk"
    CHECK ("end_weight_kg" IS NULL OR "end_weight_kg" > "start_weight_kg");

-- Loader confirmation columns are null-together or set-together (mirrors
-- truck_operations_loading_confirmation_pair_chk).
ALTER TABLE "bridge_rounds"
    ADD CONSTRAINT "bridge_rounds_loading_confirmation_pair_chk"
    CHECK (("loading_confirmed_at" IS NULL) = ("loader_id" IS NULL));

-- AddForeignKey
ALTER TABLE "bridge_rounds"
    ADD CONSTRAINT "bridge_rounds_truck_operation_id_fkey"
    FOREIGN KEY ("truck_operation_id") REFERENCES "truck_operations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_rounds"
    ADD CONSTRAINT "bridge_rounds_loader_id_fkey"
    FOREIGN KEY ("loader_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "weigh_sessions" ADD COLUMN "bridge_round_id" INTEGER;

-- AlterTable
ALTER TABLE "truck_photos" ADD COLUMN "bridge_round_id" INTEGER;

-- AddForeignKey
ALTER TABLE "weigh_sessions"
    ADD CONSTRAINT "weigh_sessions_bridge_round_id_fkey"
    FOREIGN KEY ("bridge_round_id") REFERENCES "bridge_rounds"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_photos"
    ADD CONSTRAINT "truck_photos_bridge_round_id_fkey"
    FOREIGN KEY ("bridge_round_id") REFERENCES "bridge_rounds"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "weigh_sessions_bridge_round_id_idx" ON "weigh_sessions"("bridge_round_id");

-- CreateIndex
CREATE INDEX "truck_photos_bridge_round_id_idx" ON "truck_photos"("bridge_round_id");

-- AlterTable: grade per request line
ALTER TABLE "truck_request_items" ADD COLUMN "grade" "SalesOrderGrade";

-- DropIndex (old uniqueness: one row per size per truck)
DROP INDEX "truck_request_items_truck_operation_id_size_id_key";

-- CreateIndex (new uniqueness: one row per size+grade per truck)
CREATE UNIQUE INDEX "truck_request_items_truck_operation_id_size_id_grade_key"
    ON "truck_request_items"("truck_operation_id", "size_id", "grade");

-- NULL grades are distinct in the composite index above, so enforce
-- "same size without grade may appear only once" separately.
CREATE UNIQUE INDEX "truck_request_items_size_no_grade_uniq"
    ON "truck_request_items"("truck_operation_id", "size_id")
    WHERE "grade" IS NULL;

-- ─── Backfill ──────────────────────────────────────────────────────
-- Round 1 for every operation that already passed the tare weighing.
-- start = tare, end = gross (null while still loading), grade = the
-- operation-level operational grade, loader stamps copied as-is.
INSERT INTO "bridge_rounds" (
    "truck_operation_id", "round_number", "grade",
    "start_weight_kg", "end_weight_kg",
    "start_time", "end_time", "is_final",
    "loading_confirmed_at", "loader_id", "last_reopened_at",
    "updated_at"
)
SELECT
    t."id", 1, t."operational_grade",
    t."tare_weight_kg", t."gross_weight_kg",
    COALESCE(t."tare_time", t."created_at"), t."gross_time",
    (t."gross_weight_kg" IS NOT NULL),
    t."loading_confirmed_at", t."loader_id", t."last_reopened_at",
    CURRENT_TIMESTAMP
FROM "truck_operations" t
WHERE t."tare_weight_kg" IS NOT NULL;

-- Link existing internal weighings and photos to the backfilled round 1.
UPDATE "weigh_sessions" ws
SET "bridge_round_id" = br."id"
FROM "bridge_rounds" br
WHERE br."truck_operation_id" = ws."truck_operation_id"
  AND br."round_number" = 1
  AND ws."bridge_round_id" IS NULL;

UPDATE "truck_photos" tp
SET "bridge_round_id" = br."id"
FROM "bridge_rounds" br
WHERE br."truck_operation_id" = tp."truck_operation_id"
  AND br."round_number" = 1
  AND tp."bridge_round_id" IS NULL;
