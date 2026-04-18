"use client";

import { ShieldX, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function ForbiddenPage() {
  const router = useRouter();

  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      dir="rtl"
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
            غير مصرّح بالدخول
          </h1>
          <p className="mt-2 text-muted-foreground">
            لا تملك الصلاحيات اللازمة للوصول إلى هذه الصفحة.
            <br />
            تواصل مع المدير إذا كنت تعتقد أن هذا خطأ.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowRight className="h-4 w-4 me-1" />
            العودة
          </Button>
          <Button onClick={() => router.push("/")}>
            الصفحة الرئيسية
          </Button>
        </div>
      </div>
    </div>
  );
}
