"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTextDirection, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

export function SidebarToggle({ className }: { className?: string }) {
  const { toggleSidebar, state, isMobile, openMobile } = useSidebar();
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";

  // Desktop uses expanded/collapsed; mobile uses the sheet open state.
  const isOpen = isMobile ? openMobile : state === "expanded";
  const label = isOpen ? t("collapseSidebar") : t("expandSidebar");

  const Icon = isRtl
    ? isOpen
      ? PanelRightClose
      : PanelRightOpen
    : isOpen
      ? PanelLeftClose
      : PanelLeftOpen;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            aria-label={label}
            aria-expanded={isOpen}
            onClick={toggleSidebar}
            className={cn(
              "border-border/80 bg-background text-foreground shadow-sm",
              "hover:bg-muted hover:border-sidebar-primary/35 hover:text-foreground",
              "focus-visible:border-sidebar-primary/50",
              className
            )}
          />
        }
      >
        <Icon className="size-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
