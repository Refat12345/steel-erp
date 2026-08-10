-- CreateTable
CREATE TABLE "plc_telemetry" (
    "id" TEXT NOT NULL,
    "product_size" DOUBLE PRECISION NOT NULL,
    "total_billets" INTEGER NOT NULL,
    "front_pack_count" INTEGER NOT NULL,
    "back_pack_count" INTEGER NOT NULL,
    "hourly_breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plc_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plc_telemetry_created_at_idx" ON "plc_telemetry"("created_at");
