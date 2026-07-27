"use client";

import { useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
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
import { BrandWordmark } from "@/components/layout/brand-wordmark";
import { LoginForgeScene } from "@/components/auth/login-forge-scene";

function FdMonogram({ size = "md" }: { size?: "md" | "lg" }) {
  const tBrand = useTranslations("brand");
  const box = size === "lg" ? "h-[4.25rem] w-[4.25rem]" : "h-14 w-14";
  const type = size === "lg" ? "text-[18px]" : "text-[15px]";

  return (
    <div
      className={`auth-login-brand-icon relative flex items-center justify-center rounded-2xl ${box}`}
      aria-hidden
    >
      <span className="auth-login-brand-orbit" />
      <span
        className={`auth-login-monogram relative z-[1] font-bold tracking-[0.16em] ${type}`}
        dir="ltr"
      >
        {tBrand("monogram")}
      </span>
    </div>
  );
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const tBrand = useTranslations("brand");
  const monogram = tBrand("monogram");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl: origin ? `${origin}/` : "/",
    });

    setLoading(false);

    if (result?.error) {
      if (result.error === "TOO_MANY_REQUESTS") {
        setError(t("errorTooManyRequests"));
      } else {
        setError(t("errorInvalidCredentials"));
      }
      return;
    }

    if (result?.ok === false) {
      setError(t("errorGeneric"));
      return;
    }

    let session = await getSession();
    for (let i = 0; i < 5 && !session; i++) {
      await new Promise((r) => setTimeout(r, 120));
      session = await getSession();
    }
    if (!session) {
      setError(t("errorNoSession"));
      return;
    }

    window.location.assign("/");
  }

  return (
    <div className="auth-login-page relative min-h-dvh overflow-hidden lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
      {/* Visual panel — desktop only */}
      <aside className="auth-login-visual relative hidden min-h-dvh flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
        <LoginForgeScene idPrefix="auth-desk" monogram={monogram} />
        <div className="auth-login-seam" />

        <div className="auth-login-enter-brand relative z-10 max-w-md">
          <FdMonogram size="md" />
          <h1 className="mt-9 leading-none">
            <BrandWordmark
              size="lg"
              variant="on-dark"
              className="text-[2.35rem]"
            />
          </h1>
          <p className="auth-login-brand-subtitle mt-4 max-w-[22rem] text-[15px] leading-relaxed font-medium">
            {tBrand("tagline")}
          </p>
          <p className="auth-login-panel-subtitle mt-2 max-w-[22rem] text-[13px] leading-relaxed">
            {tBrand("heroSupport")}
          </p>
        </div>

        <div className="auth-login-enter-footer relative z-10">
          <div className="auth-login-status-line mb-4 h-px w-16" />
          <p className="auth-login-ambient text-[12px] font-medium tracking-[0.04em]">
            {t("ambient")}
          </p>
          <p className="auth-login-footer mt-6 text-xs">
            {tBrand("footer")} · {new Date().getFullYear()}
          </p>
        </div>
      </aside>

      {/* Mobile atmosphere — compact scene */}
      <div className="auth-login-mobile-scene pointer-events-none absolute inset-0 lg:hidden">
        <LoginForgeScene
          idPrefix="auth-mob"
          monogram={monogram}
          compact
        />
        <div className="auth-login-dot-grid absolute inset-0 opacity-40" />
      </div>

      {/* Form panel */}
      <main className="auth-login-form-panel relative z-10 flex min-h-dvh items-center justify-center p-4 sm:p-8 lg:p-12">
        <div className="auth-login-glow-primary pointer-events-none absolute -top-28 -end-28 hidden h-[460px] w-[460px] rounded-full lg:block" />
        <div className="auth-login-glow-accent pointer-events-none absolute -bottom-36 -start-20 hidden h-[400px] w-[400px] rounded-full lg:block" />

        <span
          className="auth-login-fd-corner pointer-events-none absolute end-6 bottom-5 select-none lg:end-10 lg:bottom-8"
          aria-hidden
          dir="ltr"
        >
          {monogram}
        </span>

        <div className="relative w-full max-w-[25rem]">
          <div className="auth-login-enter-brand mb-8 flex flex-col items-center gap-4 lg:hidden">
            <FdMonogram size="lg" />
            <div className="max-w-[20rem] text-center">
              <h1 className="leading-none">
                <BrandWordmark size="lg" variant="on-dark" />
              </h1>
              <p className="auth-login-brand-subtitle mt-1.5 text-[13px] leading-snug font-medium">
                {tBrand("tagline")}
              </p>
              <p className="auth-login-panel-subtitle mt-1 text-[12px] leading-relaxed">
                {tBrand("heroSupport")}
              </p>
            </div>
          </div>

          <div className="auth-login-enter-brand mb-9 hidden lg:block">
            <h2 className="auth-login-panel-title text-[1.75rem] font-bold tracking-tight">
              {t("title")}
            </h2>
            <p className="auth-login-panel-subtitle mt-2 text-sm leading-relaxed">
              {t("subtitle")}
            </p>
          </div>

          <div className="auth-login-enter-card auth-login-card rounded-2xl p-7 sm:p-8">
            <div className="auth-login-card-accent" />
            <div className="auth-login-card-sheen" />

            <div className="mb-6 border-b border-border pb-5 lg:hidden">
              <h2 className="text-base font-bold text-card-foreground">
                {t("title")}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("subtitle")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="auth-login-field space-y-1.5">
                <Label
                  htmlFor="username"
                  className="text-[13px] font-semibold text-foreground"
                >
                  {t("username")}
                </Label>
                <div className="relative">
                  <User className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("usernamePlaceholder")}
                    required
                    autoFocus
                    autoComplete="username"
                    dir="ltr"
                    className="auth-login-input h-11 ps-10 pe-4 text-[13px] placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>

              <div className="auth-login-field auth-login-field-2 space-y-1.5">
                <Label
                  htmlFor="password"
                  className="text-[13px] font-semibold text-foreground"
                >
                  {t("password")}
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    dir="ltr"
                    className="auth-login-input h-11 ps-10 pe-10 text-[13px] placeholder:tracking-widest"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    aria-label={
                      showPassword ? t("hidePassword") : t("showPassword")
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
                <div className="auth-login-error animate-in fade-in-0 slide-in-from-top-1 duration-300 flex items-start gap-2.5 rounded-lg border p-3">
                  <AlertCircle className="text-destructive mt-px h-4 w-4 shrink-0" />
                  <p className="text-destructive text-[13px] font-medium">
                    {error}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="auth-login-submit mt-2 h-11 w-full gap-2 text-[13px] font-bold tracking-wide"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("submitting")}</span>
                  </>
                ) : (
                  t("submit")
                )}
              </Button>
            </form>
          </div>

          <p className="auth-login-enter-footer auth-login-footer mt-6 text-center text-xs lg:hidden">
            {tBrand("footer")} · {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  );
}
