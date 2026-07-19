import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileQuestion, Home } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default async function DashboardNotFound() {
  const t = await getTranslations("errors");
  const tCommon = await getTranslations("common");

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-orange-500/10">
            <FileQuestion className="h-7 w-7 text-orange-600" />
          </div>
          <h2 className="text-lg font-bold">{t("pageNotFoundTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("pageNotFoundBody")}</p>
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "mt-2 inline-flex")}
          >
            <Home className="me-1.5 h-4 w-4" />
            {tCommon("home")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
