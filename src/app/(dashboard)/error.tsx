"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const tCommon = useTranslations("common");

  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="text-lg font-bold">{t("dashboardErrorTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("dashboardErrorBody")}</p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono" dir="ltr">
              {error.digest}
            </p>
          )}
          <div className="flex gap-3 mt-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="me-1.5 h-4 w-4" />
              {tCommon("retry")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => (window.location.href = "/")}
            >
              <Home className="me-1.5 h-4 w-4" />
              {tCommon("home")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
