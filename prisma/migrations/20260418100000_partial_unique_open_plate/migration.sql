-- Partial unique index: at most one open (non-terminal) operation per plate.
-- Belt-and-suspenders for the application-level check in registerTruck().
-- Even under a race condition, this index forces a P2002 on the second insert.

CREATE UNIQUE INDEX "truck_operations_plate_open_uniq"
  ON "truck_operations" ("plate_number")
  WHERE "status" NOT IN ('Completed', 'Cancelled');
