"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContractList } from "@/components/contracts/contract-list";
import { CustomerList } from "@/components/contracts/customer-list";
import { FileText, Users } from "lucide-react";

export function ContractsPageContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">العقود والعملاء</h1>
        <p className="text-sm text-muted-foreground mt-1">
          إدارة عقود البيع العامة وبيانات العملاء
        </p>
      </div>

      <Tabs defaultValue="contracts" dir="rtl">
        <TabsList>
          <TabsTrigger value="contracts" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            العقود
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            العملاء
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
