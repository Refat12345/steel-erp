-- CreateEnum
CREATE TYPE "SupplierContractStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

-- CreateEnum
CREATE TYPE "BilletReceiptStatus" AS ENUM ('Registered', 'Loaded', 'Unloading', 'AwaitingExit', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "supplier_contracts" (
    "contract_number" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "contracted_weight_kg" DECIMAL(12,3) NOT NULL,
    "status" "SupplierContractStatus" NOT NULL DEFAULT 'Active',
    "contract_date" DATE NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "updated_by_id" INTEGER,

    CONSTRAINT "supplier_contracts_pkey" PRIMARY KEY ("contract_number")
);

-- CreateTable
CREATE TABLE "supplier_contract_piece_lines" (
    "id" SERIAL NOT NULL,
    "supplier_contract_number" TEXT NOT NULL,
    "billet_length_m" INTEGER NOT NULL,
    "contracted_pieces" INTEGER NOT NULL,

    CONSTRAINT "supplier_contract_piece_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billet_receipts" (
    "id" SERIAL NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "supplier_contract_number" TEXT NOT NULL,
    "driver_name" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "driver_national_id" TEXT,
    "declared_weight_kg" DECIMAL(12,3) NOT NULL,
    "status" "BilletReceiptStatus" NOT NULL DEFAULT 'Registered',
    "loaded_weight_kg" DECIMAL(10,1),
    "entry_time" TIMESTAMP(3),
    "empty_weight_kg" DECIMAL(10,1),
    "exit_time" TIMESTAMP(3),
    "unloading_photo_path" TEXT,
    "unloading_photo_at" TIMESTAMP(3),
    "count_entered_at" TIMESTAMP(3),
    "count_mismatch_reason" TEXT,
    "net_weight_kg" DECIMAL(10,1),
    "bundle_count" INTEGER,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "closed_by_id" INTEGER,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "billet_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billet_receipt_piece_lines" (
    "id" SERIAL NOT NULL,
    "billet_receipt_id" INTEGER NOT NULL,
    "billet_length_m" INTEGER NOT NULL,
    "expected_pieces" INTEGER NOT NULL,
    "counted_pieces" INTEGER,
    "rejected_pieces" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "billet_receipt_piece_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billet_receipt_attachments" (
    "id" SERIAL NOT NULL,
    "billet_receipt_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" INTEGER NOT NULL,

    CONSTRAINT "billet_receipt_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_contracts_status_idx" ON "supplier_contracts"("status");

-- CreateIndex
CREATE INDEX "supplier_contracts_supplier_name_idx" ON "supplier_contracts"("supplier_name");

-- CreateIndex
CREATE INDEX "supplier_contracts_created_at_idx" ON "supplier_contracts"("created_at");

-- CreateIndex
CREATE INDEX "supplier_contract_piece_lines_supplier_contract_number_idx" ON "supplier_contract_piece_lines"("supplier_contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_contract_piece_lines_supplier_contract_number_bill_key" ON "supplier_contract_piece_lines"("supplier_contract_number", "billet_length_m");

-- CreateIndex
CREATE UNIQUE INDEX "billet_receipts_receipt_number_key" ON "billet_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "billet_receipts_supplier_contract_number_idx" ON "billet_receipts"("supplier_contract_number");

-- CreateIndex
CREATE INDEX "billet_receipts_plate_number_idx" ON "billet_receipts"("plate_number");

-- CreateIndex
CREATE INDEX "billet_receipts_status_idx" ON "billet_receipts"("status");

-- CreateIndex
CREATE INDEX "billet_receipts_created_at_idx" ON "billet_receipts"("created_at");

-- CreateIndex
CREATE INDEX "billet_receipt_piece_lines_billet_receipt_id_idx" ON "billet_receipt_piece_lines"("billet_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "billet_receipt_piece_lines_billet_receipt_id_billet_length__key" ON "billet_receipt_piece_lines"("billet_receipt_id", "billet_length_m");

-- CreateIndex
CREATE INDEX "billet_receipt_attachments_billet_receipt_id_idx" ON "billet_receipt_attachments"("billet_receipt_id");

-- AddForeignKey
ALTER TABLE "supplier_contracts" ADD CONSTRAINT "supplier_contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contracts" ADD CONSTRAINT "supplier_contracts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contract_piece_lines" ADD CONSTRAINT "supplier_contract_piece_lines_supplier_contract_number_fkey" FOREIGN KEY ("supplier_contract_number") REFERENCES "supplier_contracts"("contract_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billet_receipts" ADD CONSTRAINT "billet_receipts_supplier_contract_number_fkey" FOREIGN KEY ("supplier_contract_number") REFERENCES "supplier_contracts"("contract_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billet_receipts" ADD CONSTRAINT "billet_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billet_receipts" ADD CONSTRAINT "billet_receipts_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billet_receipt_piece_lines" ADD CONSTRAINT "billet_receipt_piece_lines_billet_receipt_id_fkey" FOREIGN KEY ("billet_receipt_id") REFERENCES "billet_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billet_receipt_attachments" ADD CONSTRAINT "billet_receipt_attachments_billet_receipt_id_fkey" FOREIGN KEY ("billet_receipt_id") REFERENCES "billet_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billet_receipt_attachments" ADD CONSTRAINT "billet_receipt_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one open (non-terminal) billet receipt per plate.
-- Belt-and-suspenders for the application-level check in registerReceipt().
-- Even under a race condition, this index forces a P2002 on the second insert.
CREATE UNIQUE INDEX "billet_receipts_plate_open_uniq"
  ON "billet_receipts" ("plate_number")
  WHERE "status" NOT IN ('Completed', 'Cancelled');
