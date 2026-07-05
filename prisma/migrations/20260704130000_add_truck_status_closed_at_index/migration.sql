-- Dashboard / operations-stats queries filter completed trucks by
-- `status = 'Completed' AND closed_at >= X` (14/30-day windows). Existing
-- indexes cover (status, created_at) but not closed_at, forcing a heap
-- filter over ALL completed rows as history grows. This composite index
-- keeps those hot queries index-driven.
CREATE INDEX "truck_operations_status_closed_at_idx"
  ON "truck_operations"("status", "closed_at");
