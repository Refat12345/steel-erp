# Login Option 3 — restore guide

Saved: 2026-07-27. Say **ارجع للخيار 3** to restore this baseline.

## Contents

| File | Restores to |
|------|-------------|
| `page.tsx` | `src/app/(auth)/login/page.tsx` |
| `login-forge-scene.tsx` | `src/components/auth/login-forge-scene.tsx` |
| `login-tokens.css` | Auth/Login token block in `:root` inside `src/app/globals.css` |
| `login-styles.css` | Flagship Mill Gate styles + keyframes in `src/app/globals.css` |
| `i18n-login-keys.json` | Login-related keys in `messages/en.json` + `messages/ar.json` |

## Features frozen in this option

- Split layout (visual left / form right on desktop)
- Forge scene: rebar SVG, heat, rings, FD watermark
- FD monogram badge on brand icon
- Quiet FD corner mark on form panel
- **No** FD kicker above the Sign in title
- Copy: tagline, heroSupport, ambient module strip

## Re-snapshot (if Option 3 is updated later)

```bash
node scripts/snapshot-login-option-3.mjs
```
