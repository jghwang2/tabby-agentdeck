# Codex queued question shortcut — 2026-09-23

## Cause and change

The isolated Windows Tabby app received a real CDP Alt+Up key event but wrote
`ESC[1;5A` (Ctrl+Up) to its terminal session. The local Codex reference tests
(`D:/Project/ad-account-switch-stage/codex-source/codex-rs/tui/src/chatwidget/tests/questions_tests.rs:35`)
open asynchronous questions with `KeyCode::Up, KeyModifiers::ALT`.
The native `Action Required` title reflects the outstanding question;
changing the sidebar status would not fix the shortcut.

`src/codexKeys.ts` preserves Alt+Up as `ESC[1;3A` for Windows Codex panes.
Other agents, other modifiers, and IME composition use the original key path.
Installation is idempotent. Sending uses the existing IME-aware pane sender.

## Validation

- Full `npm test`, typecheck, and staged production build passed.
- An isolated app loaded `.tmp/question-stage/dist/index.js` using ConPTY.
- Real CDP Alt+Up emitted exactly `ESC[1;3A`; the offline question fixture
  changed from queued question to `QUESTION OPEN`.
- Real Enter emitted CR; the fixture changed to `ANSWER RECORDED`.
- This is an offline terminal integration test, not a live model question
  or an approval of any user operation.
- Evidence: `.tmp/question-evidence/ui-open.json`, `ui-answer.json`,
  `unit.log`, and `build.log`.

- Full isolated regression: 144 passed, 0 failed, 22 skipped. Build and unit
  steps were skipped by this runner because they passed separately; unavailable
  environment cases remain skips, not passes. Full results are preserved in
  `.tmp/question-evidence/regression.json` and `regression.log`.

## Deployment

Copied the verified bundle and source map into live `dist/` without rebuilding.
SHA-256 (staging and live):
`E4EBF8BC60937C7842CA29F54C3D7A16014E45817BE62FC3151335B8EEBF393C`.
Live log: `2026-09-23T05:29:21.045Z reload restored tabs=6 dead=0 ms=27749`.
Tabby PID 24032 and existing Codex PIDs 33680 and 28888 remained alive.
No commit or push was performed.
