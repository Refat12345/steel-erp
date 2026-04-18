-- AlterTable
ALTER TABLE "truck_operations" ADD COLUMN     "customer_id" INTEGER;

-- CreateTable
CREATE TABLE "truck_request_items" (
    "id" SERIAL NOT NULL,
    "truck_operation_id" INTEGER NOT NULL,
    "size_id" INTEGER NOT NULL,
    "bundle_count" INTEGER,
    "requested_tons" DECIMAL(10,3),

    CONSTRAINT "truck_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "truck_request_items_truck_operation_id_idx" ON "truck_request_items"("truck_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "truck_request_items_truck_operation_id_size_id_key" ON "truck_request_items"("truck_operation_id", "size_id");

-- CreateIndex
CREATE INDEX "truck_operations_customer_id_idx" ON "truck_operations"("customer_id");

-- AddForeignKey
ALTER TABLE "truck_operations" ADD CONSTRAINT "truck_operations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_request_items" ADD CONSTRAINT "truck_request_items_truck_operation_id_fkey" FOREIGN KEY ("truck_operation_id") REFERENCES "truck_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_request_items" ADD CONSTRAINT "truck_request_items_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "size_lookup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
