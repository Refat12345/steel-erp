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

type NavTitleKey =
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

type SectionKey =
  | "sectionOverview"
  | "sectionSales"
  | "sectionBillets"
  | "sectionStock"
  | "sectionFinance"
  | "sectionSystem";

type NavItem = {
  titleKey: NavTitleKey;
  url: string;
  icon: typeof LayoutDashboard;
  permission: string | string[] | null;
};

type NavSection = {
  sectionKey: SectionKey;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    sectionKey: "sectionOverview",
    items: [
      {
        titleKey: "dashboard",
        url: "/",
        icon: LayoutDashboard,
        permission: "dashboard.view",
      },
    ],
  },
  {
    sectionKey: "sectionSales",
    items: [
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
        titleKey: "loadedTrucks",
        url: "/loaded-trucks",
        icon: Truck,
        permission: "report.daily_trucks",
      },
    ],
  },
  {
    sectionKey: "sectionBillets",
    items: [
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
    ],
  },
  {
    sectionKey: "sectionStock",
    items: [
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
        permission: [
          "stock.production.ton",
          "stock.production.bundle",
          "stock.production.correct",
        ],
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
    ],
  },
  {
    sectionKey: "sectionFinance",
    items: [
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
    ],
  },
  {
    sectionKey: "sectionSystem",
    items: [
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
    ],
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
  const userRole = session.user.role;
  const analyticsRestricted = isAnalyticsRestrictedRole(userRole);

  function isItemVisible(item: NavItem): boolean {
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
    if (userRole === "manager" && item.url === "/trucks") {
      return false;
    }

    if (item.permission === null) return true;
    if (Array.isArray(item.permission))
      return item.permission.some((p) => userPermissions.has(p));
    return userPermissions.has(item.permission);
  }

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(isItemVisible),
    }))
    .filter((section) => section.items.length > 0);

  const allVisibleItems = visibleSections.flatMap((s) => s.items);

  // Resolve the single active entry as the longest matching URL prefix so a
  // parent route (e.g. /stock) doesn't stay highlighted on its children
  // (/stock/movements, /stock/locations, ...).
  const activeUrl = allVisibleItems.reduce<string | null>((best, item) => {
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
  const roleLabel = pickLocalizedName(
    locale,
    session.user.roleName,
    session.user.roleNameEn
  );

  return (
    <Sidebar side={side} collapsible="icon" dir={dir}>
      {/* ── Brand Header ─────────────────────────────────────────────── */}
      <SidebarHeader className="relative px-3 pt-4 pb-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-1.5 group-data-[collapsible=icon]:pt-3 group-data-[collapsible=icon]:pb-2">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <div className="app-sidebar-brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Factory className="h-5 w-5 text-sidebar-primary" />
          </div>

          <div className="flex min-w-0 flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <BrandWordmark size="sm" className="text-[15px]" />
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] leading-tight text-sidebar-primary/75">
              {tBrand("sidebarSubtitle")}
            </span>
          </div>
        </div>
        <div
          aria-hidden
          className="app-sidebar-header-line mt-3.5 h-px w-full group-data-[collapsible=icon]:hidden"
        />
        <div
          aria-hidden
          className="app-sidebar-section-rule mt-2 hidden group-data-[collapsible=icon]:block"
        />
      </SidebarHeader>

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <SidebarContent className="px-1 py-1 group-data-[collapsible=icon]:px-1.5">
        {visibleSections.map((section, sectionIndex) => (
          <SidebarGroup
            key={section.sectionKey}
            className={cn(
              "px-2",
              sectionIndex === 0 ? "pt-1 pb-2" : "py-2",
              "group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-0.5"
            )}
          >
            {sectionIndex > 0 && (
              <div
                aria-hidden
                className="app-sidebar-section-rule mb-1 hidden group-data-[collapsible=icon]:block"
              />
            )}

            <SidebarGroupLabel className="mb-1.5 h-auto px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden">
              {tNav(section.sectionKey)}
            </SidebarGroupLabel>

            <SidebarGroupContent>
              <SidebarMenu
                className="gap-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1"
                onClick={closeMobileNav}
              >
                {section.items.map((item) => {
                  const isActive = item.url === activeUrl;
                  const title = tNav(item.titleKey);
                  return (
                    <SidebarMenuItem key={item.url} className="relative w-full group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                      {isActive && (
                        <div
                          aria-hidden
                          className="app-sidebar-active-bar absolute inset-y-1.5 start-0 z-10 w-[3px] rounded-full group-data-[collapsible=icon]:hidden"
                        />
                      )}

                      <SidebarMenuButton
                        render={<Link href={item.url} />}
                        isActive={isActive}
                        tooltip={title}
                        className={cn(
                          "app-sidebar-nav-item h-10 gap-2.5 rounded-xl px-2.5",
                          "data-active:bg-transparent hover:bg-transparent",
                          "data-active:hover:bg-transparent",
                          "group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0!"
                        )}
                      >
                        <div
                          className="app-sidebar-icon-chip flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          data-active={isActive || undefined}
                        >
                          <item.icon
                            className={cn(
                              "h-4 w-4 transition-colors duration-150",
                              isActive
                                ? "text-sidebar-primary"
                                : "text-sidebar-foreground/70 group-hover/menu-button:text-sidebar-foreground"
                            )}
                          />
                        </div>

                        <span
                          className={cn(
                            "text-sm tracking-tight transition-colors duration-150 group-data-[collapsible=icon]:hidden",
                            isActive
                              ? "font-semibold text-sidebar-accent-foreground"
                              : "font-medium text-sidebar-foreground/82 group-hover/menu-button:text-sidebar-foreground"
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
        ))}
      </SidebarContent>

      {/* ── User Footer ──────────────────────────────────────────────── */}
      <SidebarFooter className="gap-1.5 px-3 pb-3 pt-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-1.5 group-data-[collapsible=icon]:pb-2.5">
        <div
          aria-hidden
          className="app-sidebar-header-line mb-1 h-px w-full group-data-[collapsible=icon]:hidden"
        />
        <div
          aria-hidden
          className="app-sidebar-section-rule mb-1 hidden group-data-[collapsible=icon]:block"
        />

        <div className="app-sidebar-user-card flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-0">
          <div className="relative shrink-0">
            <Avatar className="h-9 w-9 ring-2 ring-sidebar-primary/25 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
              <AvatarFallback className="bg-sidebar-primary/20 text-xs font-bold text-sidebar-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="app-sidebar-online-dot absolute -bottom-0.5 -end-0.5 block h-2.5 w-2.5 rounded-full border-2 border-[oklch(0.175_0.028_240)] group-data-[collapsible=icon]:h-2 group-data-[collapsible=icon]:w-2" />
          </div>

          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-semibold text-sidebar-foreground leading-snug">
              {session.user.name}
            </span>
            <span className="truncate text-[10px] font-medium leading-snug text-sidebar-primary/80">
              {roleLabel}
            </span>
          </div>
        </div>

        <SidebarMenu className="group-data-[collapsible=icon]:w-auto">
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton
              tooltip={signOutLabel}
              onClick={() => void handleSignOut()}
              className="h-9 gap-2.5 rounded-xl px-2.5 text-sidebar-foreground/50 hover:bg-destructive/14 hover:text-destructive transition-colors duration-200 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-auto">
                <LogOut className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium group-data-[collapsible=icon]:hidden">
                {signOutLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
