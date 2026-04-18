import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-orange-500/10">
            <FileQuestion className="h-7 w-7 text-orange-600" />
          </div>
          <h2 className="text-lg font-bold">الصفحة غير موجودة</h2>
          <p className="text-sm text-muted-foreground">
            عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/">
              <Home className="ml-1.5 h-4 w-4" />
              العودة للصفحة الرئيسية
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
