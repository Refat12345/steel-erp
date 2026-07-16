-- Signed balance corrections on supplier contracts. An adjustment is a
-- Completed BilletReceipt whose net weight and piece deltas may be negative;
-- balance aggregations must not clamp its piece deltas to zero.
ALTER TABLE "billet_receipts" ADD COLUMN "is_adjustment" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "billet_receipts_is_adjustment_idx" ON "billet_receipts"("is_adjustment");
