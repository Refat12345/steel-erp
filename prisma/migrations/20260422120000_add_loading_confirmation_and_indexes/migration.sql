-- ──────────────────────────────────────────────────────────────────
-- Two-role workflow enforcement: loader must confirm loading before
-- the operator can record the gross weight. Track the confirmation
-- timestamp and the loader's user id for audit / dispute traceability.
--
-- Also add a composite index to speed up queue queries
-- (WHERE status=? ORDER BY created_at DESC) which dominate the
-- /trucks list and dashboard stats under production load.
--
-- Not added here (already present from a previous migration):
--   truck_operations_plate_open_uniq
--     — partial UNIQUE on plate_number WHERE status NOT IN
--       ('Completed','Cancelled'), i.e. the "at most one active session
--       per plate" constraint mandated in Part 2.
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE "truck_operations"
  ADD COLUMN "loading_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "loader_id"            INTEGER;

ALTER TABLE "truck_operations"
  ADD CONSTRAINT "truck_operations_loader_id_fkey"
  FOREIGN KEY ("loader_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK: if loader_id is set then loading_confirmed_at must also be set,
-- and vice-versa. Prevents half-written confirmations from tooling bugs.
ALTER TABLE "truck_operations"
  ADD CONSTRAINT "truck_operations_loading_confirmation_pair_chk"
  CHECK (
    ("loader_id" IS NULL AND "loading_confirmed_at" IS NULL)
    OR
    ("loader_id" IS NOT NULL AND "loading_confirmed_at" IS NOT NULL)
  );

CREATE INDEX "truck_operations_loader_id_idx"
  ON "truck_operations" ("loader_id");

CREATE INDEX "truck_operations_status_created_at_idx"
  ON "truck_operations" ("status", "created_at" DESC);
