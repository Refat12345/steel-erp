import { requirePagePermission } from "@/lib/page-auth";
import { SystemSettings } from "@/components/admin/system-settings";

export default async function AdminSettingsPage() {
  // Stricter than the admin layout's `user.manage` gate (Layer 3 of the
  // RBAC defence for this sub-route).
  await requirePagePermission("settings.edit");
  return <SystemSettings />;
}
