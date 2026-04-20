-- AlterTable
ALTER TABLE "truck_operations" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "weigh_sessions" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
