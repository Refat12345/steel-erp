import { isLanguageSwitcherEnabled } from "@/config/feature-flags";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {isLanguageSwitcherEnabled() && (
        <div className="fixed top-4 end-4 z-50">
          <LocaleSwitcher variant="on-dark" />
        </div>
      )}
      {children}
    </>
  );
}
