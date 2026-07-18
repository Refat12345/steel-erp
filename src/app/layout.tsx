import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";
import { getTextDirection, type Locale } from "@/i18n/config";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brand");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
    icons: {
      icon: [{ url: BRAND.faviconPath, sizes: "any" }],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;
  const dir = getTextDirection(locale);

  return (
    <html lang={locale} dir={dir} className={`${cairo.variable} h-full`}>
      <body className="min-h-full font-[family-name:var(--font-cairo)] antialiased">
        <NextIntlClientProvider>
          <Providers>
            {children}
            <Toaster position="top-center" richColors dir={dir} />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
