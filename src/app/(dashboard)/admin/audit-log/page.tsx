import { getTranslations } from "next-intl/server";
import { AuditLogList } from "@/components/admin/audit-log-list";

export default async function AuditLogPage() {
  const t = await getTranslations("audit");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <AuditLogList />
    </div>
  );
}
