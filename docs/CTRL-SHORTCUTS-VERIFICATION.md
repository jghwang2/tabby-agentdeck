# Ctrl shortcut defaults — 2026-09-18

Defaults now match the user's saved bindings: Ctrl+T (new tab), Ctrl+L
(session list), Ctrl+O (preview), Ctrl+R (repair), Ctrl+S / Ctrl+D
(split right / down), and Ctrl+Q (close pane). Cmd+T remains available.
Existing AgentDeck bindings are preserved. Only exact stock split bindings
are converted; custom, multiple and explicitly disabled split bindings remain.
The settings reset defaults use the same new keys.

English/Korean READMEs, landing pages, guides and full references were updated.
`npm pack --dry-run --ignore-scripts --json` confirmed README.md is included.
No commit, push or npm publication was performed.

## Validation

- `npm test`: passed. Final hotkey checks: 32 passed; keybinding checks: 62 passed.
- `npx tsc --noEmit`: exit 0.
- Isolated production build: `.tmp/ctrl-stage/dist/index.js`; existing Sass legacy API warning only.
- `.tmp/ctrl-defaults.cjs`: stock split migration, idempotence, preservation of custom/disabled bindings, and all seven settings reset defaults passed.
- `.tmp/ctrl-ui.json`: 16 checks passed, including actual CDP key events for all seven actions and toggling focus/preview back.
- `.tmp/ctrl-save-result.json`: Ctrl+S in the preview editor saved the file without splitting the terminal.
- Full regression runner executed from the staging tree with SkipBuild/SkipUnit because both were already run separately: 177 entries, initially 143 pass / 9 fail / 25 skipped.
- The nine failures were existing Korean-only expectations against the English sidebar. Reruns with Korean selected resolved all nine: `.tmp/ctrl-ko-main.json` (25 pass, 0 fail, 14 skipped), `.tmp/ctrl-ko-status.json` (8 pass, 0 fail), `.tmp/ctrl-ko-group.json` (13 pass, 0 fail, 1 skipped).
- Final preview regression with multiple terminal panes: `.tmp/ctrl-viewer-final.json`, 15 pass / 0 fail / 0 skipped.
- Broad-run skips include checks covered separately (build/unit/restart), unavailable image clipboard injection, live Claude/session-hook prerequisites and drag timing. They are not counted as passes.
- Whitespace check passed with CRLF-aware Git whitespace settings.

Validated bundle SHA256: `6930194E0038CEEE029093290A3D6460A13FF9A1A93F58D72655E919C8D0920F`.

The identical bundle was copied to the live dist without rebuilding. Live log
`~/.agentdeck-diag.log`: `2026-09-18T08:46:16.199Z reload go reason=dev:build tabs=4`,
then `2026-09-18T08:46:19.556Z reload restored tabs=4 dead=0 ms=1776`.
All four live sessions were restored.
