import { AuditLogList } from "@/components/admin/audit-log-list";

export default function AuditLogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">سجل التدقيق</h1>
        <p className="text-sm text-muted-foreground">
          عرض من قام بأي عملية، وعلى أي كيان، ومتى.
        </p>
      </div>

      <AuditLogList />
    </div>
  );
}