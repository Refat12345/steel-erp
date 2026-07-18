"use client";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getTextDirection,
  isLocale,
  type Locale,
} from "@/i18n/config";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/**
 * Root error boundary — replaces the entire document, so next-intl's
 * provider is unavailable. Locale + copy are resolved from the cookie
 * and the static message files instead.
 */
function readLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`),
  );
  const value = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = readLocale();
  const dir = getTextDirection(locale);
  const messages = locale === "en" ? en : ar;
  const t = messages.errors;
  const retry = messages.common.retry;

  return (
    <html dir={dir} lang={locale}>
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          backgroundColor: "#fafafa",
          color: "#1a1a1a",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "400px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "12px",
              backgroundColor: "#fef2f2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem",
              fontSize: "24px",
            }}
          >
            ⚠️
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "8px" }}>
            {t.globalTitle}
          </h2>
          <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "16px" }}>
            {t.globalBody}
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "11px",
                color: "#9ca3af",
                fontFamily: "monospace",
                direction: "ltr",
                marginBottom: "16px",
              }}
            >
              {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "8px 20px",
              fontSize: "14px",
              backgroundColor: "#18181b",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            {retry}
          </button>
        </div>
      </body>
    </html>
  );
}
