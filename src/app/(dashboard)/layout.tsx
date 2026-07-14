import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { BRAND } from "@/lib/brand";
import { isStockModuleEnabled } from "@/config/feature-flags";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar stockModuleEnabled={isStockModuleEnabled()} />
        <main className="flex-1 flex flex-col min-h-screen min-w-0 max-w-full overflow-x-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
            <h1 className="text-sm font-medium text-muted-foreground truncate">
              {BRAND.headerAr}
            </h1>
          </header>
          <div className="flex-1 p-4 sm:p-6 min-w-0 max-w-full">{children}</div>
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
