-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "OverrideType" AS ENUM ('grant', 'revoke');

-- AlterTable: Convert master_contracts.status from TEXT to ContractStatus enum
ALTER TABLE "master_contracts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "master_contracts" ALTER COLUMN "status" TYPE "ContractStatus" USING "status"::"ContractStatus";
ALTER TABLE "master_contracts" ALTER COLUMN "status" SET DEFAULT 'active';

-- AlterTable: Convert user_permission_overrides.override_type from TEXT to OverrideType enum
ALTER TABLE "user_permission_overrides" ALTER COLUMN "override_type" TYPE "OverrideType" USING "override_type"::"OverrideType";

-- CreateIndex
CREATE INDEX "customers_phone_primary_idx" ON "customers"("phone_primary");

-- CreateIndex
CREATE INDEX "customers_created_at_idx" ON "customers"("created_at");

-- CreateIndex
CREATE INDEX "master_contracts_customer_id_idx" ON "master_contracts"("customer_id");

-- CreateIndex
CREATE INDEX "master_contracts_status_idx" ON "master_contracts"("status");

-- CreateIndex
CREATE INDEX "master_contracts_created_at_idx" ON "master_contracts"("created_at");

-- CreateIndex
CREATE INDEX "contract_attachments_contract_number_idx" ON "contract_attachments"("contract_number");
