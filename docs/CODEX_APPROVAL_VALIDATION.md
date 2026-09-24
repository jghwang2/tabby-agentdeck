# Codex approval detection — 2026-09-23

## Change

- `src/agents.ts`: recognize the observed MCP trust dialog and native `[ ! ] Action Required | ...` title.
- `src/detect.ts`: allow that explicit approval to interrupt hook-pinned `running`; preserve labels and other pinned states. Keep approval waiting across footer redraws and both output subscribers. Resume on the native busy title or busy output.
- The fallback union includes Gemini's `esc to cancel` busy signal. Codex prints it in an approval footer, so this signal is excluded while a Codex approval is active, including the decorator's unidentified-agent path.
- Preserve split output lines and strip ANSI formatting before matching. Bound retained data to 1,024 characters and discard it on detach.

## Validation

- `npm test`: passed in the complete isolated staging copy, exit 0. The detection suite includes every split point of the observed prompt, ANSI, pinned states, ordinary prose, auto-detection disabled, footer replay by both subscribers, and resume.
- Type check and staging webpack build: passed. Existing Sass legacy API deprecation warning remains.
- `node tools/cdp.js 9222 tools/probe-codex-approval.js`: 10/10 passed. Synthetic dialog replay uses the isolated application's actual output/title subscriptions and asserts the rendered sidebar badge and state; no live MCP request was approved.
- Full `tools/run-all.ps1 -SkipBuild -KeepAlive` against the staged plugin: final consolidated result 146 passed, 0 failed, 20 skipped. The first unit step failed because the staging copy lacked supporting files; after copying those files, the full unit suite passed. The original result is retained separately.
- Skips include separately tested build/unit/restart items, unavailable clipboard image injection, unbound synthetic subagent sessions, no live Claude session, and a multi-group navigation fixture that could not be formed. They are not reported as passes.

Evidence: `.tmp/approval-evidence/` contains `staged-unit.log`, `typecheck.log`, `build.log`, `ui-approval.json`, `regression-original.json`, and `regression-final.json`.

## Deployment

- Copied the tested bundle and source map from `.tmp/approval-stage/dist/` into `dist/`, without rebuilding.
- Bundle SHA-256: `4C989FF48088B0A3700431044ADA6E6AD8B862BD0B4CFF534FB76DFEE8AD09B5`.
- Live reload log: `2026-09-23T02:32:48.651Z reload restored tabs=5 dead=0 ms=14337`.
- Tabby main process 24032 and all five pre-existing CLI processes remained alive. The loaded bundle watcher points to `D:\Project\tabby-agentdeck\dist\index.js`.
- No commit or push performed.

## Repeat the focused UI check

Build to a staging plugin root, launch it using `tools/test-instance.ps1 -PluginRoot <staging>`, then run `node tools/cdp.js 9222 tools/probe-codex-approval.js`. The probe refuses to run outside the isolated test instance.
