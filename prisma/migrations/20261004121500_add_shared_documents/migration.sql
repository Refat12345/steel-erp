-- Shared document library: one-level folders with per-folder membership.

CREATE TABLE "shared_folders" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" INTEGER NOT NULL,

    CONSTRAINT "shared_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "folder_members" (
    "id" SERIAL NOT NULL,
    "folder_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "can_upload" BOOLEAN NOT NULL DEFAULT false,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_id" INTEGER NOT NULL,

    CONSTRAINT "folder_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shared_documents" (
    "id" SERIAL NOT NULL,
    "folder_id" INTEGER NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" INTEGER NOT NULL,

    CONSTRAINT "shared_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shared_folders_created_at_idx" ON "shared_folders"("created_at");

CREATE UNIQUE INDEX "folder_members_folder_id_user_id_key" ON "folder_members"("folder_id", "user_id");
CREATE INDEX "folder_members_user_id_idx" ON "folder_members"("user_id");

CREATE INDEX "shared_documents_folder_id_uploaded_at_idx" ON "shared_documents"("folder_id", "uploaded_at");

ALTER TABLE "shared_folders" ADD CONSTRAINT "shared_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "folder_members" ADD CONSTRAINT "folder_members_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "shared_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folder_members" ADD CONSTRAINT "folder_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "folder_members" ADD CONSTRAINT "folder_members_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shared_documents" ADD CONSTRAINT "shared_documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "shared_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shared_documents" ADD CONSTRAINT "shared_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
