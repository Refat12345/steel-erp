-- Weighbridge-card number issued by the finance-side legacy scale program.
-- Entered manually by the operator when closing the operation (mandatory at
-- close, enforced in the service layer) so both systems share one card
-- number. Nullable because Cancelled operations and rows closed before this
-- field existed have none; unique so the same card can never be recorded on
-- two operations (Postgres treats NULLs as distinct).
ALTER TABLE "truck_operations" ADD COLUMN "external_card_number" TEXT;

CREATE UNIQUE INDEX "truck_operations_external_card_number_key"
  ON "truck_operations"("external_card_number");
