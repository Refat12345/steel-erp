-- CreateEnum
CREATE TYPE "SalesOrderKind" AS ENUM ('REBAR', 'SHORTBAR_1_4M', 'SHORTBAR_4_12M', 'SCRAP');

-- CreateEnum
CREATE TYPE "SalesOrderGrade" AS ENUM ('FIRST', 'SECOND');

-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('CREDIT', 'PAYMENT_PLAN');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('draft', 'approved', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ToleranceType" AS ENUM ('percentage', 'weight');

-- CreateEnum
CREATE TYPE "SliceStatus" AS ENUM ('pending', 'partial', 'paid');

-- CreateTable
CREATE TABLE "sales_orders" (
    "order_number" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "kind" "SalesOrderKind" NOT NULL,
    "grade" "SalesOrderGrade",
    "settlement_mode" "SettlementMode" NOT NULL,
    "payment_deadline_days" INTEGER,
    "total_qty_tons" DECIMAL(12,3) NOT NULL,
    "tolerance_type" "ToleranceType" NOT NULL,
    "tolerance_value" DECIMAL(8,3) NOT NULL,
    "special_ratio_pct" DECIMAL(5,2),
    "buffer_pct" DECIMAL(5,2),
    "order_date" DATE NOT NULL,
    "delivery_date" DATE NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "updated_by_id" INTEGER,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("order_number")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "size_id" INTEGER NOT NULL,
    "price_per_ton" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_slices" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "posting_date" DATE NOT NULL,
    "quantity_tons" DECIMAL(12,3) NOT NULL,
    "amount_due" DECIMAL(14,2) NOT NULL,
    "deadline" DATE NOT NULL,
    "status" "SliceStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_slices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_orders_contract_number_idx" ON "sales_orders"("contract_number");

-- CreateIndex
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");

-- CreateIndex
CREATE INDEX "sales_orders_kind_idx" ON "sales_orders"("kind");

-- CreateIndex
CREATE INDEX "sales_orders_created_at_idx" ON "sales_orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_number_size_id_key" ON "order_items"("order_number", "size_id");

-- CreateIndex
CREATE INDEX "payment_slices_order_number_idx" ON "payment_slices"("order_number");

-- CreateIndex
CREATE INDEX "payment_slices_deadline_idx" ON "payment_slices"("deadline");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_contract_number_fkey" FOREIGN KEY ("contract_number") REFERENCES "master_contracts"("contract_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_number_fkey" FOREIGN KEY ("order_number") REFERENCES "sales_orders"("order_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "size_lookup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slices" ADD CONSTRAINT "payment_slices_order_number_fkey" FOREIGN KEY ("order_number") REFERENCES "sales_orders"("order_number") ON DELETE RESTRICT ON UPDATE CASCADE;
