"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Eraser, Loader2, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SystemSettings() {
  const t = useTranslations("admin.settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.success) {
          setSavedValue(j.data.analyticsStartDate);
          setInputValue(j.data.analyticsStartDate ?? "");
        } else {
          toast.error(j.error || t("errorLoad"));
        }
      })
      .catch(() => {
        if (!cancelled) toast.error(t("errorConnection"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function persist(value: string | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsStartDate: value }),
      });
      const json = await res.json();
      if (json.success) {
        setSavedValue(value);
        setInputValue(value ?? "");
        toast.success(value ? t("toastSaved") : t("toastCleared"));
      } else {
        toast.error(json.error || t("errorGeneric"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setSaving(false);
    }
  }

  const dirty = (inputValue || null) !== savedValue;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      <Card className="max-w-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-primary" />
            {t("analyticsStartTitle")}
          </CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("analyticsStartDescription")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Skeleton className="h-9 w-full max-w-xs" />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="analytics-start-date">{t("dateLabel")}</Label>
                <Input
                  id="analytics-start-date"
                  type="date"
                  className="max-w-xs"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  {savedValue
                    ? t("currentlyActive", { date: savedValue })
                    : t("notActive")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => persist(inputValue || null)}
                  disabled={saving || !dirty}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("save")}
                </Button>
                {savedValue && (
                  <Button
                    variant="outline"
                    onClick={() => persist(null)}
                    disabled={saving}
                  >
                    <Eraser className="h-4 w-4" />
                    {t("clearDate")}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
