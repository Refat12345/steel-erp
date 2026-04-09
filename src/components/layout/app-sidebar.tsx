"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  ShoppingCart,
  Truck,
  Scale,
  Wallet,
  BarChart3,
  Shield,
  ClipboardList,
  LogOut,
  Factory,
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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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

const navItems = [
  {
    title: "العقود",
    url: "/contracts",
    icon: FileText,
    permission: "contract.view",
  },
  {
    title: "أوامر البيع",
    url: "/sales-orders",
    icon: ShoppingCart,
    permission: "salesorder.view",
  },
  {
    title: "الشاحنات",
    url: "/trucks",
    icon: Truck,
    permission: "truck.view_queue",
  },
  {
    title: "القبان",
    url: "/scale",
    icon: Scale,
    permission: "scale.start",
  },
  {
    title: "المالية",
    url: "/finance",
    icon: Wallet,
    permission: "payment.view",
  },
  {
    title: "التقارير",
    url: "/reports",
    icon: BarChart3,
    permission: "report.daily_trucks",
  },
  {
    title: "الإدارة",
    url: "/admin",
    icon: Shield,
    permission: "user.manage",
  },
  {
    title: "سجل التدقيق",
    url: "/admin/audit-log",
    icon: ClipboardList,
    permission: "user.manage",
  },
];

export function AppSidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  if (!session) return null;

  const userPermissions = new Set(session.user.permissions);
  const isAdmin = session.user.role === "admin";

  const visibleItems = navItems.filter(
    (item) => isAdmin || userPermissions.has(item.permission)
  );

  const initials = session.user.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <Sidebar side="right" collapsible="icon">

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
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground leading-tight">
              مصنع الحديد
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-widest leading-tight"
              style={{ color: BLUE_70 }}
            >
              ERP System
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
            التنقل
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {visibleItems.map((item) => {
                const isActive = pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url} className="relative">

                    {/* Active indicator — small glowing dot on the inner edge */}
                    {isActive && (
                      <div
                        className="absolute top-1/2 left-2 -translate-y-1/2 h-1.5 w-1.5 rounded-full group-data-[collapsible=icon]:hidden"
                        style={{
                          background: BLUE,
                          boxShadow: `0 0 6px ${BLUE_70}`,
                        }}
                      />
                    )}

                    <SidebarMenuButton
                      render={<Link href={item.url} />}
                      isActive={isActive}
                      tooltip={item.title}
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
                        {item.title}
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
              className="absolute -bottom-0.5 -left-0.5 block h-2.5 w-2.5 rounded-full border-2"
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
              {session.user.roleName}
            </span>
          </div>
        </div>

        {/* Sign out */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="تسجيل الخروج"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="h-9 gap-2.5 rounded-lg px-2 text-sidebar-foreground/50 hover:bg-destructive/12 hover:text-destructive transition-colors duration-200"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200">
                <LogOut className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium">تسجيل الخروج</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

      </SidebarFooter>
    </Sidebar>
  );
}
