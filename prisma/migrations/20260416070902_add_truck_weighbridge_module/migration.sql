-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('Queued', 'Approved', 'FirstWeigh', 'Loading', 'OnScale', 'LoadingComplete', 'SecondWeigh', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "truck_operations" (
    "id" SERIAL NOT NULL,
    "plate_number" TEXT NOT NULL,
    "driver_name" TEXT NOT NULL,
    "sales_order_number" TEXT,
    "status" "TruckStatus" NOT NULL DEFAULT 'Queued',
    "tare_weight_kg" DECIMAL(10,1),
    "gross_weight_kg" DECIMAL(10,1),
    "tare_time" TIMESTAMP(3),
    "gross_time" TIMESTAMP(3),
    "notes" TEXT,
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" INTEGER NOT NULL,

    CONSTRAINT "truck_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weigh_sessions" (
    "id" SERIAL NOT NULL,
    "truck_operation_id" INTEGER NOT NULL,
    "session_number" INTEGER NOT NULL,
    "size_id" INTEGER,
    "bundle_count" INTEGER,
    "weight_tons" DECIMAL(10,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weigh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_photos" (
    "id" SERIAL NOT NULL,
    "truck_operation_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "truck_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "truck_operations_plate_number_idx" ON "truck_operations"("plate_number");

-- CreateIndex
CREATE INDEX "truck_operations_status_idx" ON "truck_operations"("status");

-- CreateIndex
CREATE INDEX "truck_operations_sales_order_number_idx" ON "truck_operations"("sales_order_number");

-- CreateIndex
CREATE INDEX "truck_operations_created_at_idx" ON "truck_operations"("created_at");

-- CreateIndex
CREATE INDEX "weigh_sessions_truck_operation_id_idx" ON "weigh_sessions"("truck_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "weigh_sessions_truck_operation_id_session_number_key" ON "weigh_sessions"("truck_operation_id", "session_number");

-- CreateIndex
CREATE INDEX "truck_photos_truck_operation_id_idx" ON "truck_photos"("truck_operation_id");

-- AddForeignKey
ALTER TABLE "truck_operations" ADD CONSTRAINT "truck_operations_sales_order_number_fkey" FOREIGN KEY ("sales_order_number") REFERENCES "sales_orders"("order_number") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_operations" ADD CONSTRAINT "truck_operations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_operations" ADD CONSTRAINT "truck_operations_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_sessions" ADD CONSTRAINT "weigh_sessions_truck_operation_id_fkey" FOREIGN KEY ("truck_operation_id") REFERENCES "truck_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_sessions" ADD CONSTRAINT "weigh_sessions_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "size_lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_photos" ADD CONSTRAINT "truck_photos_truck_operation_id_fkey" FOREIGN KEY ("truck_operation_id") REFERENCES "truck_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
