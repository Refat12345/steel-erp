"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html dir="rtl" lang="ar">
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
            حدث خطأ في النظام
          </h2>
          <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "16px" }}>
            عذراً، حدث خطأ غير متوقع. يرجى تحديث الصفحة.
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
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
