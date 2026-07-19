/**
 * Feature flags — runtime, server-evaluated only.
 *
 * These are read from plain (NON `NEXT_PUBLIC_`) environment variables, so they
 * are evaluated on the server/edge at request time — NOT inlined into the
 * client bundle at build time. That means the flag can be flipped by editing
 * the server env (`.env.production`) and running `pm2 reload` — no rebuild,
 * no redeploy of code. This is the "deploy ≠ release" (dark-launch) pattern.
 *
 * Client components must NOT import these directly (the value would always be
 * `false` on the client, where the env var doesn't exist). Instead, a server
 * component reads the flag and passes it down as a prop.
 */

/**
 * Finished-goods stock (warehouse) module. Dark-launched: the code ships to
 * production but stays completely hidden — from every user, admins included —
 * until `STOCK_MODULE_ENABLED=true` is set on the server. Off by default so a
 * plain deploy never surfaces work-in-progress. Enforced at the middleware
 * (routes), the stock route-group layout (pages), the load-out logic (stock
 * deductions become inert), the sidebar, and the scale weigh-session dialog.
 */
export function isStockModuleEnabled(): boolean {
  return process.env.STOCK_MODULE_ENABLED === "true";
}

/**
 * Language switcher (i18n plan phase 7 — revealed). Visible by default after
 * deploy; no env change required. Emergency kill-switch: set
 * `LANGUAGE_SWITCHER_ENABLED=false` in the server env and `pm2 reload`
 * (no rebuild). Any other value or unset → shown.
 */
export function isLanguageSwitcherEnabled(): boolean {
  return process.env.LANGUAGE_SWITCHER_ENABLED !== "false";
}
