-- Step 1: Insert system user (non-loginable) for FK references on historical/seed data
INSERT INTO "users" ("username", "password_hash", "full_name", "role_code", "is_active", "created_at", "updated_at")
VALUES ('system', '!nologin', 'النظام', 'admin', false, NOW(), NOW())
ON CONFLICT ("username") DO NOTHING;

-- Step 2: Add new nullable FK columns

-- Users
ALTER TABLE "users" ADD COLUMN "created_by_id" INTEGER;

-- Customers
ALTER TABLE "customers" ADD COLUMN "created_by_id" INTEGER;
ALTER TABLE "customers" ADD COLUMN "updated_by_id" INTEGER;

-- MasterContracts
ALTER TABLE "master_contracts" ADD COLUMN "created_by_id" INTEGER;
ALTER TABLE "master_contracts" ADD COLUMN "updated_by_id" INTEGER;

-- ContractAttachments
ALTER TABLE "contract_attachments" ADD COLUMN "uploaded_by_id" INTEGER;

-- UserPermissionOverrides
ALTER TABLE "user_permission_overrides" ADD COLUMN "granted_by_id" INTEGER;

-- Step 3: Populate FK columns by mapping old string values to User IDs

-- Users: map created_by string to user id
UPDATE "users" SET "created_by_id" = COALESCE(
  (SELECT u2.id FROM "users" u2 WHERE u2."username" = "users"."created_by"),
  (SELECT u2.id FROM "users" u2 WHERE u2."username" = 'system')
) WHERE "created_by" IS NOT NULL;

-- Customers: map created_by string to user id
UPDATE "customers" SET "created_by_id" = COALESCE(
  (SELECT u.id FROM "users" u WHERE u."username" = "customers"."created_by"),
  (SELECT u.id FROM "users" u WHERE u."username" = 'system')
);

-- MasterContracts: map created_by string to user id
UPDATE "master_contracts" SET "created_by_id" = COALESCE(
  (SELECT u.id FROM "users" u WHERE u."username" = "master_contracts"."created_by"),
  (SELECT u.id FROM "users" u WHERE u."username" = 'system')
);

-- ContractAttachments: map uploaded_by string to user id
UPDATE "contract_attachments" SET "uploaded_by_id" = COALESCE(
  (SELECT u.id FROM "users" u WHERE u."username" = "contract_attachments"."uploaded_by"),
  (SELECT u.id FROM "users" u WHERE u."username" = 'system')
);

-- UserPermissionOverrides: map granted_by string to user id
UPDATE "user_permission_overrides" SET "granted_by_id" = COALESCE(
  (SELECT u.id FROM "users" u WHERE u."username" = "user_permission_overrides"."granted_by"),
  (SELECT u.id FROM "users" u WHERE u."username" = 'system')
);

-- Step 4: Set NOT NULL constraints on required FK columns
ALTER TABLE "customers" ALTER COLUMN "created_by_id" SET NOT NULL;
ALTER TABLE "master_contracts" ALTER COLUMN "created_by_id" SET NOT NULL;
ALTER TABLE "contract_attachments" ALTER COLUMN "uploaded_by_id" SET NOT NULL;
ALTER TABLE "user_permission_overrides" ALTER COLUMN "granted_by_id" SET NOT NULL;

-- Step 5: Drop old string columns
ALTER TABLE "users" DROP COLUMN "created_by";
ALTER TABLE "customers" DROP COLUMN "created_by";
ALTER TABLE "master_contracts" DROP COLUMN "created_by";
ALTER TABLE "contract_attachments" DROP COLUMN "uploaded_by";
ALTER TABLE "user_permission_overrides" DROP COLUMN "granted_by";

-- Step 6: Add Foreign Key constraints
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "master_contracts" ADD CONSTRAINT "master_contracts_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "master_contracts" ADD CONSTRAINT "master_contracts_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contract_attachments" ADD CONSTRAINT "contract_attachments_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
