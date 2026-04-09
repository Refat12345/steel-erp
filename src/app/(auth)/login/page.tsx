"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Factory,
  User,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("اسم المستخدم أو كلمة المرور غير صحيحة");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="auth-login-page relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Background dot grid */}
      <div className="auth-login-dot-grid pointer-events-none absolute inset-0" />

      {/* Decorative glow orbs */}
      <div className="auth-login-glow-primary pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full" />
      <div className="auth-login-glow-accent pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full" />

      {/* Main content */}
      <div className="animate-in fade-in-0 slide-in-from-bottom-4 duration-700 relative z-10 w-full max-w-[22rem]">
        {/* Brand section */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="auth-login-brand-icon flex h-16 w-16 items-center justify-center rounded-2xl">
            <Factory className="text-sidebar-primary h-8 w-8" />
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              مصنع الحديد
            </h1>
            <p className="auth-login-brand-subtitle mt-1 text-[13px] font-medium">
              نظام إدارة المصنع — ERP
            </p>
          </div>
        </div>

        {/* Login card */}
        <div className="auth-login-card rounded-2xl p-7">
          <div className="mb-6 border-b border-border pb-5">
            <h2 className="text-base font-bold text-card-foreground">
              تسجيل الدخول
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              أدخل بيانات حسابك للمتابعة
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="username"
                className="text-[13px] font-semibold text-foreground"
              >
                اسم المستخدم
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  required
                  autoFocus
                  autoComplete="username"
                  dir="ltr"
                  className="h-11 pl-10 pr-4 text-[13px] placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="password"
                className="text-[13px] font-semibold text-foreground"
              >
                كلمة المرور
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  dir="ltr"
                  className="h-11 pl-10 pr-10 text-[13px] placeholder:tracking-widest"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  aria-label={
                    showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="auth-login-error animate-in fade-in-0 slide-in-from-top-1 duration-300 flex items-start gap-2.5 rounded-lg border p-3"
              >
                <AlertCircle className="text-destructive mt-px h-4 w-4 shrink-0" />
                <p className="text-destructive text-[13px] font-medium">
                  {error}
                </p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-11 w-full gap-2 text-[13px] font-bold tracking-wide"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>جارٍ التحقق...</span>
                </>
              ) : (
                "تسجيل الدخول"
              )}
            </Button>
          </form>
        </div>

        <p className="auth-login-footer mt-6 text-center text-xs">
          نظام إدارة مصنع الحديد &nbsp;·&nbsp; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
