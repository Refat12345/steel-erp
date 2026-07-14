-- CreateEnum
CREATE TYPE "StockShift" AS ENUM ('MORNING', 'EVENING');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "shift" "StockShift";
