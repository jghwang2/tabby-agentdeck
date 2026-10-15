# 1.2.8 release validation — 2026-10-15

Integrated the current main branch (`46e3650`) before validating the release. Its alias reconciliation and recovery guard remain in place alongside the scheduled-task tracking and modal editor.

## Artifact

- Build: `powershell -File tools/stage-build.ps1 -Release -Destination .tmp/release-128`
- Bundle SHA256: `0230F5BE74AB46BE6F43B7B50E77A96283F64D0B2BDC4758EF9E266378895ACD`
- `check-release.js` passed against the staged bundle: development watcher code absent; no source map.
- Packed with `npm pack --ignore-scripts` from the verified stage. Archive includes `updater/agentdeck-update.ps1`.

## Results

- Type checking, version synchronization and full unit suite: passed.
- Isolated full UI regression: **169 passed, 0 failed, 7 skipped**. Build and unit checks ran separately; the remaining skips cover OS image clipboard, a live Claude fixture and performance measurement conditions.
- Modal Save/Cancel, validation, failed-save rollback/retry and concurrent event preservation: 14 checks passed.
- Tab editing, per-tab scheduled tasks, one-shot firing, cancellation, manual counts and close protection: 25 checks passed.
- More than nine tabs, scrolling, numeric navigation, resume and close/reopen: 12 checks passed.
- Session messaging compatibility: 43 checks passed.
- Session-preserving reload retained the edited title, alias, manual scheduled count, permanent tab identity and same live PTY.

Evidence is stored locally under `.tmp/release-128-*.json`, `.tmp/release-128-unit.log`, and `.tmp/tabby-agentdeck-test-release-128-regression/report/regression.json`.

The preceding feature build was already applied to the live application with three sessions preserved. The desktop was locked during final release preparation, so the 1.2.8 release artifact was validated in isolated instances; no additional live application reload was performed at that point.

## Publication and live application

- Release commit: `d4456bef41cb6d268920a85c0e15224a2c376c2a`; annotated tag: `v1.2.8`. Main and the working branch were pushed together with the tag.
- [npm publication workflow](https://github.com/jghwang2/tabby-agentdeck/actions/runs/38697087273) and main CI passed. npm initially reported processing; registry metadata subsequently confirmed `latest = 1.2.8`.
- Downloading the published npm archive confirmed the runtime bundle has the exact SHA256 above, includes the updater script, and has no source map.
- After the desktop unlocked, the tested release was installed and reloaded. All four then-open tabs retained their aliases, custom titles, permanent identities, session IDs and running PTYs. Three idle session bindings were restored only after matching the pre-reload identity and PTY snapshot.
- Live proof: `.tmp/live-release-final.json`; backup: `.tmp/live-before-release-package-20261015-161929`. The comparison treats an unset custom title and an empty string as the same absence of a manual title; original before/after snapshots were retained.
