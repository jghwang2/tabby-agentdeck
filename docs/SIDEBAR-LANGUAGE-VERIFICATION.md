# Sidebar language support

The sidebar uses Tabby's selected locale, matching the settings page. English UK and US share English copy; Chinese uses separate simplified and traditional copy. Unknown locales use English.

Supported languages: af, bg, cs, da, de, en, es, fr, hr, id, it, ja, ko, pl, pt, ru, sr, sv, tr, uk, zh-CN, zh-TW.

Localized UI includes search, status labels, standard permission reasons, elapsed time, past-session controls and menus, group labels, account selection, usage reset labels, buttons and their tooltips. Session titles, task names, account names, paths and unrecognized messages remain as provided.

## Verification

- `npm test`: existing regressions, account tests and sidebar translation checks.
- `node test/sidebarI18n.cjs`: complete key coverage and matching placeholders across 22 languages; reset/availability labels; user content preservation.
- `node tools/cdp.js 9238 tools/probe-sidebar-locales.js`: 199 checks in isolated Tabby, selecting all 22 languages through the real settings control; automatic sidebar updates, permission reasons and unchanged Korean user content.
- `node tools/cdp.js 9238 tools/probe-sidebar-language.js`: 42 checks across English UK, Korean and English US, including all six states and switching back without reopening.

Build to `.tmp/accounts-stage/dist` and launch with `tools/test-instance.ps1 -PluginRoot D:/Project/tabby-agentdeck/.tmp/accounts-stage -Port 9238`. Only the tested staged bundle is copied into `dist` for the authorized live reload. The tests do not modify account credentials or Claude configuration.
