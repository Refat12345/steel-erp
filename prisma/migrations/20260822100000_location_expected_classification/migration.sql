-- AlterTable
ALTER TABLE "stock_locations" ADD COLUMN "expected_classification_id" INTEGER;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_expected_classification_id_fkey" FOREIGN KEY ("expected_classification_id") REFERENCES "steel_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "stock_locations_expected_classification_id_idx" ON "stock_locations"("expected_classification_id");
