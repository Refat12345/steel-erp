import fs from "fs";
import path from "path";

const root = process.cwd();
const out = path.join(root, "docs/login-options/option-3");
fs.mkdirSync(out, { recursive: true });

fs.copyFileSync(
  path.join(root, "src/app/(auth)/login/page.tsx"),
  path.join(out, "page.tsx"),
);
fs.copyFileSync(
  path.join(root, "src/components/auth/login-forge-scene.tsx"),
  path.join(out, "login-forge-scene.tsx"),
);

const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");

const t0 = css.indexOf("  /* Auth / Login —");
const t1 = css.indexOf("  --login-kicker:");
if (t0 < 0 || t1 < 0) throw new Error("login tokens not found");
const t2 = css.indexOf("\n", t1);
fs.writeFileSync(path.join(out, "login-tokens.css"), css.slice(t0, t2 + 1));

const c0 = css.indexOf("/* ─── Auth / Login — Flagship");
const c1 = css.indexOf("/* ─── ERP Utility Classes");
if (c0 < 0 || c1 < 0) throw new Error("login styles not found");
fs.writeFileSync(path.join(out, "login-styles.css"), css.slice(c0, c1));

const i18n = {
  en: {
    brand: {
      tagline: "From gate to weighbridge — one live record.",
      heroSupport:
        "Sign in with your plant account. Permissions follow your role.",
      monogram: "FD",
      footer: "steelTech · ERP",
    },
    auth: {
      title: "Sign in",
      subtitle: "Enter your username and password to continue.",
      ambient: "Contracts · Weighbridge · Stock yards",
    },
  },
  ar: {
    brand: {
      tagline: "من البوابة للقبان — سجل واحد حيّ.",
      heroSupport: "ادخل بحسابك في المصنع. الصلاحيات تتبع دورك.",
      monogram: "FD",
      footer: "steelTech · نظام ERP",
    },
    auth: {
      title: "تسجيل الدخول",
      subtitle: "أدخل اسم المستخدم وكلمة المرور للمتابعة.",
      ambient: "عقود · قبان · ساحات",
    },
  },
};
fs.writeFileSync(
  path.join(out, "i18n-login-keys.json"),
  `${JSON.stringify(i18n, null, 2)}\n`,
);

console.log("Option 3 snapshot saved to", out);
