-- CreateTable
CREATE TABLE "supplier_contract_attachments" (
    "id" SERIAL NOT NULL,
    "supplier_contract_number" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" INTEGER NOT NULL,

    CONSTRAINT "supplier_contract_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_contract_attachments_supplier_contract_number_idx" ON "supplier_contract_attachments"("supplier_contract_number");

-- AddForeignKey
ALTER TABLE "supplier_contract_attachments" ADD CONSTRAINT "supplier_contract_attachments_supplier_contract_number_fkey" FOREIGN KEY ("supplier_contract_number") REFERENCES "supplier_contracts"("contract_number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contract_attachments" ADD CONSTRAINT "supplier_contract_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
