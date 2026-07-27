"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

type LocaleSwitcherProps = {
  /** Dark login surfaces need lighter ghost styling */
  variant?: "default" | "on-dark";
  className?: string;
};

/**
 * Toggles the UI language between Arabic and English.
 * - Authenticated: PUT /api/user/locale (cookie + User.locale)
 * - Anonymous (login): PUT /api/locale (cookie only)
 * Then full reload so <html lang/dir> and server components refresh.
 *
 * Shown by default (phase 7). Hidden only when LANGUAGE_SWITCHER_ENABLED=false
 * (emergency kill-switch — see feature-flags.ts).
 */
export function LocaleSwitcher({
  variant = "default",
  className,
}: LocaleSwitcherProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  const { status } = useSession();
  const [isPending, setIsPending] = useState(false);

  const target: Locale = locale === "ar" ? "en" : "ar";
  const targetLabel = target === "ar" ? t("languageArabic") : t("languageEnglish");

  async function switchLocale() {
    setIsPending(true);
    try {
      const endpoint =
        status === "authenticated" ? "/api/user/locale" : "/api/locale";
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: target }),
      });
      if (!res.ok) throw new Error("locale update failed");
      window.location.reload();
    } catch {
      toast.error(t("languageChangeError"));
      setIsPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void switchLocale()}
      disabled={isPending || status === "loading"}
      aria-label={t("language")}
      className={cn(
        "gap-1.5",
        variant === "on-dark"
          ? "text-white/75 hover:bg-white/10 hover:text-white"
          : "text-muted-foreground",
        className,
      )}
    >
      {isPending || status === "loading" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Languages className="h-4 w-4" />
      )}
      <span className="text-xs font-medium">{targetLabel}</span>
    </Button>
  );
}
