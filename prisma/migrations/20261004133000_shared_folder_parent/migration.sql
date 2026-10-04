-- Folders may contain folders. Existing folders stay at the root (parent_id NULL).
-- ON DELETE RESTRICT: a folder that still has inner folders cannot be removed.

ALTER TABLE "shared_folders" ADD COLUMN "parent_id" INTEGER;

CREATE INDEX "shared_folders_parent_id_idx" ON "shared_folders"("parent_id");

ALTER TABLE "shared_folders" ADD CONSTRAINT "shared_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "shared_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
