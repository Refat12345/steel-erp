"use client";

import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  FileText,
  ShoppingCart,
  Truck,
  Wallet,
  BarChart3,
  Shield,
  ClipboardList,
  LogOut,
  Factory,
  LayoutDashboard,
  Boxes,
  PackageCheck,
  Warehouse,
  PackagePlus,
  ScrollText,
  ArrowLeftRight,
  ClipboardCheck,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { isNavUrlSuspended } from "@/config/suspended-pages";
import { isAnalyticsRestrictedRole } from "@/lib/rbac-policy";
import { BrandWordmark } from "@/components/layout/brand-wordmark";
import { getTextDirection, type Locale } from "@/i18n/config";
import { pickLocalizedName } from "@/lib/localized-name";

/* CSS custom properties defined in globals.css */
const BLUE = "oklch(0.620 0.175 222)";
const BLUE_10 = "oklch(0.620 0.175 222 / 10%)";
const BLUE_18 = "oklch(0.620 0.175 222 / 18%)";
const BLUE_30 = "oklch(0.620 0.175 222 / 30%)";
const BLUE_55 = "oklch(0.620 0.175 222 / 55%)";
const BLUE_70 = "oklch(0.620 0.175 222 / 70%)";
const WHITE_4 = "oklch(1 0 0 / 4%)";
const WHITE_6 = "oklch(1 0 0 / 6%)";
const EMERALD = "oklch(0.630 0.155 152)";

const navItems: {
  titleKey:
    | "dashboard"
    | "contracts"
    | "salesOrders"
    | "trucks"
    | "billetContracts"
    | "billetReceipts"
    | "stock"
    | "stockMovements"
    | "stockProductionIn"
    | "stockTransfer"
    | "stockAdjust"
    | "stockLocations"
    | "loadedTrucks"
    | "finance"
    | "reports"
    | "admin"
    | "auditLog"
    | "settings";
  url: string;
  icon: typeof LayoutDashboard;
  permission: string | string[] | null;
}[] = [
  {
    titleKey: "dashboard",
    url: "/",
    icon: LayoutDashboard,
    permission: "dashboard.view",
  },
  {
    titleKey: "contracts",
    url: "/contracts",
    icon: FileText,
    permission: "contract.view",
  },
  {
    titleKey: "salesOrders",
    url: "/sales-orders",
    icon: ShoppingCart,
    permission: "salesorder.view",
  },
  {
    titleKey: "trucks",
    url: "/trucks",
    icon: Truck,
    permission: ["truck.view_queue", "truck.view_approved"],
  },
  {
    titleKey: "billetContracts",
    url: "/billet-contracts",
    icon: Boxes,
    permission: "billet.contract.view",
  },
  {
    titleKey: "billetReceipts",
    url: "/billet-receipts",
    icon: PackageCheck,
    permission: "billet.receipt.view",
  },
  {
    titleKey: "stock",
    url: "/stock",
    icon: Boxes,
    permission: "stock.view",
  },
  {
    titleKey: "stockMovements",
    url: "/stock/movements",
    icon: ScrollText,
    permission: "stock.movements.view",
  },
  {
    titleKey: "stockProductionIn",
    url: "/stock/production-in",
    icon: PackagePlus,
    permission: ["stock.production.ton", "stock.production.bundle"],
  },
  // Opening-balance (/stock/opening-balance) intentionally hidden — stock
  // adjust covers it. Page + guards remain (admin) and can be restored here.
  {
    titleKey: "stockTransfer",
    url: "/stock/transfer",
    icon: ArrowLeftRight,
    permission: "stock.transfer",
  },
  {
    titleKey: "stockAdjust",
    url: "/stock/adjust",
    icon: ClipboardCheck,
    permission: "stock.adjust",
  },
  {
    titleKey: "stockLocations",
    url: "/stock/locations",
    icon: Warehouse,
    permission: "stock.location.manage",
  },
  {
    titleKey: "loadedTrucks",
    url: "/loaded-trucks",
    icon: Truck,
    permission: "report.daily_trucks",
  },
  {
    titleKey: "finance",
    url: "/finance",
    icon: Wallet,
    permission: "payment.view",
  },
  {
    titleKey: "reports",
    url: "/reports",
    icon: BarChart3,
    permission: "reports.view",
  },
  {
    titleKey: "admin",
    url: "/admin",
    icon: Shield,
    permission: "user.manage",
  },
  {
    titleKey: "auditLog",
    url: "/admin/audit-log",
    icon: ClipboardList,
    permission: "user.manage",
  },
  {
    titleKey: "settings",
    url: "/admin/settings",
    icon: Settings,
    permission: "settings.edit",
  },
];

export function AppSidebar({
  stockModuleEnabled = false,
}: {
  stockModuleEnabled?: boolean;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tBrand = useTranslations("brand");
  const locale = useLocale() as Locale;
  // The sidebar sits on the reading-start edge: right in RTL, left in LTR.
  // `dir` must be passed explicitly because the mobile Sheet portals outside
  // the <html dir> root (see mobile-responsive rules).
  const dir = getTextDirection(locale);
  const side = dir === "rtl" ? "right" : "left";

  function closeMobileNav() {
    if (isMobile) setOpenMobile(false);
  }

  // Close the mobile sheet after any client-side navigation (backup if onClick is skipped).
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  async function handleSignOut() {
    await signOut({ redirect: false });
    router.push("/login");
    router.refresh();
  }

  if (!session) return null;

  const userPermissions = new Set(session.user.permissions);
  const analyticsRestricted = isAnalyticsRestrictedRole(session.user.role);

  const visibleItems = navItems.filter((item) => {
    if (isNavUrlSuspended(item.url)) return false;

    // Dark-launch: hide every stock entry until the module is released.
    // Server-driven prop (runtime env), so no rebuild needed to flip it.
    if (!stockModuleEnabled && item.url.startsWith("/stock")) return false;

    // Hardcoded denylist — analytics-restricted roles never see the
    // dashboard or reports entries, even if a permission override has
    // been granted. Real enforcement lives in the server guards/API;
    // this is UI hygiene so nothing is tempting them to click.
    if (analyticsRestricted && (item.url === "/" || item.url === "/reports")) {
      return false;
    }

    // Owner (manager) uses the simplified "loaded trucks" view instead of
    // the full operational trucks queue — hide the queue entry from their
    // sidebar only. UI hygiene; other roles keep /trucks unchanged.
    if (session.user.role === "manager" && item.url === "/trucks") {
      return false;
    }

    if (item.permission === null) return true;
    if (Array.isArray(item.permission))
      return item.permission.some((p) => userPermissions.has(p));
    return userPermissions.has(item.permission);
  });

  // Resolve the single active entry as the longest matching URL prefix so a
  // parent route (e.g. /stock) doesn't stay highlighted on its children
  // (/stock/movements, /stock/locations, ...).
  const activeUrl = visibleItems.reduce<string | null>((best, item) => {
    const matches =
      item.url === "/"
        ? pathname === "/"
        : pathname === item.url || pathname.startsWith(item.url + "/");
    if (!matches) return best;
    if (best === null || item.url.length > best.length) return item.url;
    return best;
  }, null);

  const initials = session.user.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2);

  const signOutLabel = tCommon("signOut");

  return (
    <Sidebar side={side} collapsible="icon" dir={dir}>

      {/* ── Brand Header ─────────────────────────────────────────────── */}
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-3">

          {/* Logo bubble with glow */}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300"
            style={{
              background: BLUE_18,
              boxShadow: `inset 0 0 0 1px ${BLUE_30}, 0 0 20px ${BLUE_10}`,
            }}
          >
            <Factory className="h-5 w-5" style={{ color: BLUE }} />
          </div>

          {/* Brand text */}
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <BrandWordmark size="sm" />
            <span
              className="text-[10px] font-semibold uppercase tracking-widest leading-tight"
              style={{ color: BLUE_70 }}
            >
              {tBrand("sidebarSubtitle")}
            </span>
          </div>
        </div>
      </SidebarHeader>

      {/* Hairline divider */}
      <div className="mx-3 h-px shrink-0" style={{ background: WHITE_6 }} />

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <SidebarContent className="py-2">
        <SidebarGroup className="px-2">
          {/* Section label */}
          <SidebarGroupLabel
            className="mb-1 h-auto px-1 text-[10px] font-semibold uppercase tracking-widest group-data-[collapsible=icon]:hidden"
            style={{ color: BLUE_55 }}
          >
            {tCommon("navigation")}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5" onClick={closeMobileNav}>
              {visibleItems.map((item) => {
                const isActive = item.url === activeUrl;
                const title = tNav(item.titleKey);
                return (
                  <SidebarMenuItem key={item.url} className="relative">

                    {/* Active indicator — small glowing dot on the inner edge */}
                    {isActive && (
                      <div
                        className="absolute top-1/2 end-2 -translate-y-1/2 h-1.5 w-1.5 rounded-full group-data-[collapsible=icon]:hidden"
                        style={{
                          background: BLUE,
                          boxShadow: `0 0 6px ${BLUE_70}`,
                        }}
                      />
                    )}

                    <SidebarMenuButton
                      render={<Link href={item.url} />}
                      isActive={isActive}
                      tooltip={title}
                      className="h-10 gap-2.5 rounded-lg px-2"
                    >
                      {/* Icon in styled bubble */}
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                          !isActive &&
                            "opacity-55 group-hover/menu-button:opacity-100"
                        )}
                        style={
                          isActive
                            ? {
                                background: BLUE_18,
                                boxShadow: `inset 0 0 0 1px ${BLUE_30}`,
                              }
                            : undefined
                        }
                      >
                        <item.icon
                          className="h-4 w-4"
                          style={isActive ? { color: BLUE } : undefined}
                        />
                      </div>

                      {/* Nav label */}
                      <span
                        className={cn(
                          "text-sm transition-colors duration-150",
                          isActive
                            ? "font-semibold"
                            : "font-medium text-sidebar-foreground/70 group-hover/menu-button:text-sidebar-foreground"
                        )}
                      >
                        {title}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Hairline divider */}
      <div className="mx-3 h-px shrink-0" style={{ background: WHITE_6 }} />

      {/* ── User Footer ──────────────────────────────────────────────── */}
      <SidebarFooter className="px-3 py-3 gap-1">

        {/* User identity card */}
        <div
          className="flex items-center gap-3 rounded-lg px-2 py-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1"
          style={{ background: WHITE_4 }}
        >
          {/* Avatar with online dot */}
          <div className="relative shrink-0">
            <Avatar className="h-8 w-8">
              <AvatarFallback
                className="text-xs font-bold"
                style={{
                  background: BLUE_18,
                  color: BLUE,
                }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <span
              className="absolute -bottom-0.5 -end-0.5 block h-2.5 w-2.5 rounded-full border-2"
              style={{
                background: EMERALD,
                borderColor: "var(--sidebar)",
              }}
            />
          </div>

          {/* Name + role */}
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-semibold text-sidebar-foreground leading-snug">
              {session.user.name}
            </span>
            <span
              className="truncate text-[10px] font-medium leading-snug"
              style={{ color: BLUE_70 }}
            >
              {pickLocalizedName(
                locale,
                session.user.roleName,
                session.user.roleNameEn,
              )}
            </span>
          </div>
        </div>

        {/* Sign out */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={signOutLabel}
              onClick={() => void handleSignOut()}
              className="h-9 gap-2.5 rounded-lg px-2 text-sidebar-foreground/50 hover:bg-destructive/12 hover:text-destructive transition-colors duration-200"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200">
                <LogOut className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium">{signOutLabel}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

      </SidebarFooter>
    </Sidebar>
  );
}
