"use client";

import { useLocale, useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContractList } from "@/components/contracts/contract-list";
import { CustomerList } from "@/components/contracts/customer-list";
import { FileText, Users } from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";

export function ContractsPageContent() {
  const t = useTranslations("contracts");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <Tabs defaultValue="contracts" dir={dir}>
        <TabsList>
          <TabsTrigger value="contracts" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {t("tabContracts")}
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {t("tabCustomers")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="mt-4">
          <ContractList />
        </TabsContent>

        <TabsContent value="customers" className="mt-4">
          <CustomerList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
