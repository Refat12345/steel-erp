-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "superseded_by_id" INTEGER;

-- CreateIndex
CREATE INDEX "stock_movements_superseded_by_id_idx" ON "stock_movements"("superseded_by_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
