-- CreateTable
CREATE TABLE "destinations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destinations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "truck_operations" ADD COLUMN "destination_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "destinations_name_key" ON "destinations"("name");

-- CreateIndex
CREATE INDEX "destinations_is_active_sort_order_idx" ON "destinations"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "truck_operations_destination_id_idx" ON "truck_operations"("destination_id");

-- AddForeignKey
ALTER TABLE "truck_operations" ADD CONSTRAINT "truck_operations_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
