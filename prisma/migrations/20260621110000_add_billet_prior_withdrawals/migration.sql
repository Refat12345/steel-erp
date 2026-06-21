-- Add explicit support for historical supplier-contract withdrawals.
ALTER TABLE "billet_receipts"
ADD COLUMN "is_prior_withdrawal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "prior_withdrawal_date" DATE;

CREATE INDEX "billet_receipts_is_prior_withdrawal_idx"
ON "billet_receipts" ("is_prior_withdrawal");
