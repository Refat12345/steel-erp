"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";

/**
 * Toggles the UI language between Arabic and English. Persists the
 * preference (cookie + User.locale) via /api/user/locale, then does a full
 * reload so <html lang/dir> and all server components re-render in the new
 * locale.
 *
 * Shown by default (phase 7). Hidden only when LANGUAGE_SWITCHER_ENABLED=false
 * (emergency kill-switch — see feature-flags.ts).
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  const [isPending, setIsPending] = useState(false);

  const target: Locale = locale === "ar" ? "en" : "ar";
  const targetLabel = target === "ar" ? t("languageArabic") : t("languageEnglish");

  async function switchLocale() {
    setIsPending(true);
    try {
      const res = await fetch("/api/user/locale", {
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
      disabled={isPending}
      aria-label={t("language")}
      className="gap-1.5 text-muted-foreground"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Languages className="h-4 w-4" />
      )}
      <span className="text-xs font-medium">{targetLabel}</span>
    </Button>
  );
}
