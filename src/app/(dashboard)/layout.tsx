import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  isStockModuleEnabled,
  isLanguageSwitcherEnabled,
} from "@/config/feature-flags";
import { canOpenMillLiveDashboard } from "@/lib/mill-live-access";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const tBrand = await getTranslations("brand");
  const millLiveDashboardEnabled = canOpenMillLiveDashboard({
    username: session.user.username,
    permissions: session.user.permissions,
  });

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          stockModuleEnabled={isStockModuleEnabled()}
          millLiveDashboardEnabled={millLiveDashboardEnabled}
        />
        <main className="flex-1 flex flex-col min-h-screen min-w-0 max-w-full overflow-x-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarToggle />
            <Separator orientation="vertical" className="h-6" />
            <h1 className="text-sm font-medium text-muted-foreground truncate">
              {tBrand("header")}
            </h1>
            {isLanguageSwitcherEnabled() && (
              <div className="ms-auto">
                <LocaleSwitcher />
              </div>
            )}
          </header>
          <div className="flex-1 p-4 sm:p-6 min-w-0 max-w-full">{children}</div>
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
