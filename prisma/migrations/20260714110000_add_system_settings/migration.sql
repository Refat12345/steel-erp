-- Key-value store for admin-tunable operational settings (e.g.
-- `analytics_start_date` = the operational date from which dashboard
-- analytics are computed). Values are strings parsed by the owning
-- service; write history is captured in audit_logs.
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
