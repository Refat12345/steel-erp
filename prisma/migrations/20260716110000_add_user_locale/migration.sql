-- Add UI language preference to users. Default "ar" keeps existing behavior.
ALTER TABLE "users" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'ar';
