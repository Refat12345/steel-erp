-- Per-round material attribution for internal-weighing-exempt trucks
-- (scrap / billet wire / …). Chosen by the loader at loading-complete when
-- the truck carries more than one exempt size; the auto-generated mirror
-- weigh session at gross is attributed to it.
ALTER TABLE "bridge_rounds" ADD COLUMN "size_id" INTEGER;

-- CreateIndex
CREATE INDEX "bridge_rounds_size_id_idx" ON "bridge_rounds"("size_id");

-- AddForeignKey
ALTER TABLE "bridge_rounds" ADD CONSTRAINT "bridge_rounds_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "size_lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
