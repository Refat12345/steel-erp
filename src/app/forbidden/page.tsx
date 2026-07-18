"use client";

import { ShieldX, ArrowLeft, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { getTextDirection, type Locale } from "@/i18n/config";

export default function ForbiddenPage() {
  const router = useRouter();
  const t = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      dir={dir}
    >
      <div className="flex flex-col items-center gap-6 text-center max-w-md">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-2xl"
          style={{
            background: "oklch(0.600 0.200 25 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.600 0.200 25 / 25%)",
          }}
        >
          <ShieldX
            className="h-10 w-10"
            style={{ color: "oklch(0.600 0.200 25)" }}
          />
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("forbiddenTitle")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t("forbiddenBody")}
            <br />
            {t("forbiddenHint")}
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            <BackIcon className="h-4 w-4 me-1" />
            {tCommon("goBack")}
          </Button>
          <Button onClick={() => router.push("/")}>
            {tCommon("home")}
          </Button>
        </div>
      </div>
    </div>
  );
}
