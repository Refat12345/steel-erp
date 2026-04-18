import { requirePagePermission } from "@/lib/page-auth";
import { NewSalesOrderForm } from "@/components/sales-orders/new-sales-order-form";

export default async function NewSalesOrderPage() {
  await requirePagePermission("salesorder.create");
  return <NewSalesOrderForm />;
}
