# Permanent tab identities — 2026-10-01

- Terminal tabs receive permanent letters; an optional alias can be assigned once
  by double-clicking the title and pressing Enter. Escape/blur cancels editing.
- Letters and aliases share a case-insensitive, Unicode-normalized namespace.
  Closed names remain reserved. Reservations live in `agentDeck.sessionIdentities`;
  recovery profiles retain `AGENTDECK_IDENTITY`.
- Sidebar numbers are removed. Ctrl+1…9 follows visible order. Dragging changes
  order without renaming tabs. Message transport still addresses exact session IDs.
- Recovery must wait for terminal profiles before allocating an identity. The first
  isolated reload exposed premature allocation; the final build fixes this.

## Verification

- Typecheck, full `npm test`, identity unit tests and whitespace checks passed.
- Final staged build: `.tmp/identity-final/dist/index.js`.
- Isolated full regression: 169 PASS / 0 FAIL / 7 SKIP out of 176.
  Build and unit steps were skipped by that runner because they ran separately.
  Report: `.tmp/identity-final-regression/report/regression.json`.
- Actual DOM tests: aliases saved, duplicates refused, rename refused, positional
  jumps, close/new reservations, real pointer drag. All passed.
- Reload preserved names, aliases, reservation records and all three PTY IDs.
  Evidence: `.tmp/identity-reload-after.json`, `.tmp/identity-drag-result.json`,
  `.tmp/identity-ui-final.json`.
- Actual hook + CLI mailbox test passed registration, snapshot names, send,
  receive, reply, acknowledgement and replacement-recipient isolation.
  Evidence: `.tmp/identity-context.json`.

## Installation state

The tested bundle and source map were copied to the installed plugin's `dist`.
SHA256: `8093884A8D7ADF7E869341356E1DEF7C393880D714BB2AED43AAA66F81BB1041`.
Previous installed artifacts are backed up in `.tmp/identity-installed-backup`.
The live application is a packaged installation without the development watcher
or a connected CDP endpoint. The reload service itself remains available.
At 2026-10-01 11:24:45 KST it was invoked through the existing Angular injector
from Tabby's Settings → Open DevTools console. Reload restored all six terminals;
the six PTY IDs and their order were unchanged. The live DOM shows A through F
with no numeric badges. Evidence: `.tmp/identity-live-reload-after.json`; live
diagnostic log records `reload restored tabs=6 dead=0 ms=4114` at 02:24:51Z.
The settings tab opened for this operation and DevTools were closed afterward.

During an earlier foreground-keyboard attempt, the target window changed and
text was accidentally submitted into another CLI tab. This was disclosed to the
user. Subsequent input used direct messages to the verified DevTools renderer
window handle, with no foreground keyboard injection.
No commit, push or release was performed.

## Final job-alias revision and status-row layout

The earlier letter UI above is superseded. Original titles now occupy their own
full row. Automatic job aliases appear before the status badge in the metadata
row, with no four-character restriction and no A/B/C/D or positional badge.
Aliases remain fixed, unique and reserved after closing their tab.

- Full npm test completed with exit 0; production staging build succeeded.
- Final isolated UI regression: 168 PASS, 0 FAIL, 8 SKIP (176 total).
  Build/unit stages were separately executed; other skips concern clipboard,
  absent Claude sessions and informational performance measurements.
- Isolated identity, title preservation, reorder, positional navigation,
  close/reservation, reload persistence and real mailbox round-trip probes passed.
- Screenshots: `.tmp/job-alias-layout.png`, `.tmp/job-alias-long-layout.png`.
- Final staging and installed SHA256:
  `56E93421DE25F1D9D295F27F0D0391241771F29AC8FE54E8BDF70C48408525A5`.
- Live reload accepted; all four currently open PTYs retained their exact IDs.
  Original titles remain visible; aliases are 허브1, 허브2, 에이전트덱1, 게임1.
  All four aliases are before status badges and numeric badges are absent.
  Evidence: `.tmp/job-alias-live-after.json` and
  `.tmp/job-alias-layout-regression.log`.
- Installed artifact backup: `.tmp/job-alias-installed-backup`.
