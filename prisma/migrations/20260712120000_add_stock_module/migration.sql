-- CreateEnum
CREATE TYPE "StockLocationSegment" AS ENUM ('GENERAL', 'GOVERNORATES', 'ISOLATION', 'SHORTBAR');

-- CreateEnum
CREATE TYPE "StockUnit" AS ENUM ('BUNDLE', 'TON');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'PRODUCTION_IN', 'TRANSFER_OUT', 'TRANSFER_IN', 'LOAD_OUT', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "weigh_sessions" ADD COLUMN     "source_location_id" INTEGER;

-- CreateTable
CREATE TABLE "stock_yards" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stock_yards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" SERIAL NOT NULL,
    "yard_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "segment" "StockLocationSegment" NOT NULL,
    "unit" "StockUnit" NOT NULL,
    "allowed_grade" "SalesOrderGrade",
    "expected_size_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "grid_row" INTEGER NOT NULL DEFAULT 1,
    "grid_col" INTEGER NOT NULL DEFAULT 1,
    "grid_span" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" SERIAL NOT NULL,
    "location_id" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "size_id" INTEGER,
    "grade" "SalesOrderGrade",
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "StockUnit" NOT NULL,
    "transfer_group_id" TEXT,
    "weigh_session_id" INTEGER,
    "truck_operation_id" INTEGER,
    "reason" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_yards_code_key" ON "stock_yards"("code");

-- CreateIndex
CREATE INDEX "stock_locations_segment_is_active_idx" ON "stock_locations"("segment", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_yard_id_code_key" ON "stock_locations"("yard_id", "code");

-- CreateIndex
CREATE INDEX "stock_movements_location_id_size_id_idx" ON "stock_movements"("location_id", "size_id");

-- CreateIndex
CREATE INDEX "stock_movements_truck_operation_id_idx" ON "stock_movements"("truck_operation_id");

-- CreateIndex
CREATE INDEX "stock_movements_transfer_group_id_idx" ON "stock_movements"("transfer_group_id");

-- CreateIndex
CREATE INDEX "stock_movements_type_created_at_idx" ON "stock_movements"("type", "created_at");

-- CreateIndex
CREATE INDEX "weigh_sessions_source_location_id_idx" ON "weigh_sessions"("source_location_id");

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_yard_id_fkey" FOREIGN KEY ("yard_id") REFERENCES "stock_yards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_expected_size_id_fkey" FOREIGN KEY ("expected_size_id") REFERENCES "size_lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "size_lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_weigh_session_id_fkey" FOREIGN KEY ("weigh_session_id") REFERENCES "weigh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_truck_operation_id_fkey" FOREIGN KEY ("truck_operation_id") REFERENCES "truck_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_sessions" ADD CONSTRAINT "weigh_sessions_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
