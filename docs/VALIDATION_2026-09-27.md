# 2026-09-27 validation

Test selection came from the current source and call paths, not earlier PASS
records. Production files, installed plugins and user sessions were not replaced
or reloaded during this validation.

## Coverage derived from code

| Source path | Observable behavior checked |
| --- | --- |
| `repair → repairPane → syncPtySize/nudgePtyRedraw` | Burst requests, subsequent requests, layout/pane exceptions, hidden terminals, Windows Codex row-only redraw, replacement PTYs and superseded resize timers |
| `repairPane → delayed sendRedrawKey` | A pending Ctrl+L must not reach a replacement session; the original active session still receives an explicitly enabled redraw |
| `activateResume → openResumeTab → trackResumeStart` | Concurrent opens, the interval before the first hook, existing-tab focus, profile/open errors, startup error output, wrapper/inner terminal identity, closed/replaced sessions and subscription cleanup |
| Sidebar creation and stylesheet | Installed package version appears in the header; existing layout regression covers width, docking and overflow |
| Hook runtime paths and migration | `npm test` runs live PowerShell hooks, provider/storage isolation, old-shell fallback, idempotent migration, failure tracing and mailbox transport fixtures |
| Output detection and performance | Existing behavioral/unit suites plus the actual performance probe, including render cost, output handling, OS lookup activity and supported slot capacity |
| CWD and changed-file filtering | Disposable Git repository with two changed files; hook-selected CWD, session-specific filtering and full repository view |
| Subagent status to DOM | Dedicated test tab, synthetic transcript growth/truncation, UTF-8 split boundaries, counts, tooltips, disabled state and cleanup |

## Defects found during this run

- A delayed repair Ctrl+L could reach a replacement session. A failing behavioral
  test reproduced this; the callback now checks session identity and open state.
- CWD regression depended on an old computer's absolute path and uncommitted
  user files. It now creates its own repository and releases the panel before
  retrying Windows directory cleanup.
- Subagent regression depended on earlier probes leaving an unbound tab. It now
  creates and closes its own test tab through the product UI.
- The old grouped-navigation test was inapplicable to fixed slots. It now checks
  that the current UI has no collapsible group headers.
- The runner's performance step called the default main probe instead of
  `probe-perf.js`. It now invokes the performance probe and obtains the supported
  session capacity from the product instead of projecting to unsupported 30 tabs.
- Image clipboard SKIP text claimed a failed image write even though the current
  probe never attempted one. It now states exactly what was not exercised.

## Evidence

Local evidence root: `E:/project/agentdeck-validation-20260927`.

- `final-typecheck.log`: `npm run typecheck`, exit 0.
- `final-unit.log`: `npm test`, exit 0, including repair lifecycle cases.
- `final-build.log`: production webpack build to an isolated staging folder,
  exit 0; existing Sass legacy API warning.
- `final-regression.log` and `final-app/report/regression.json`: isolated app run.
- `performance-recheck.json`: all nine performance measurements ran after waiting
  for the newly created terminal's output channel; seven assertions passed, two
  measurements have no acceptance threshold.
- `main-recheck.json`: main probe rerun, including R28's Git numstat comparison.
- `reconciled.json`: final per-ID results with explicit evidence sources.
- `final-stage/dist/index.js` SHA-256:
  `C146D809DD5D8420455442217E99BBB510D6BBCFF262F06E4F1CB3F3E0CEEA4D`.

The UI runner uses `-SkipBuild -SkipUnit` because those steps were executed and
recorded separately against the same product source. Its SKIP rows are not
automatically counted as PASS. Measurements with no acceptance threshold and
unexercised OS/CLI integration are also kept distinct from passing assertions.

## Final results and limits

176 report entries: **171 PASS, 0 FAIL, 5 ungraded/unexercised**. This reconciles
the separate successful build/unit checks and the actual performance/main probe
reruns by case ID; raw reports are retained unchanged.

- PF4 and PF6: measured, with no defined pass/fail threshold. These are not failed
  or omitted measurements. Nine-tab render p50 was 2.3 ms; closed tabs left zero
  retained status entries.
- R6 and IN6: OS image clipboard and actual CLI image attachment were not exercised.
- RS8: existing live Claude session `.open` styling was not exercised. RL5 separately
  verified pending Codex resume deduplication and focus in the real app; this is
  not presented as equivalent to the untested Claude case.
- The first run left `ad-cwd-gStJmz` in the Windows temp folder after a cleanup
  error. Automatic execution policy rejected a subsequent deletion command
  without a more specific reason. The folder was left in place. The final CWD
  probe completed successfully with panel shutdown and asynchronous deletion retries.

The production bundle is from the final product source; later changes only affect
test probes and this report. No npm release or production hot reload is part of
this validation/push task.

## Live integration follow-up (2026-09-27)

The three previously unexercised cases now pass. Combined by case ID with the
earlier evidence: **174 PASS, 0 FAIL, 2 measured without a pass/fail threshold**
(PF4/PF6). No unexercised integration case remains in this report.

`tools/verify-live-integrations.cjs` ran against an isolated Tabby ConPTY instance,
the same validated production bundle, and a real Claude Code 2.1.270 process.
No product code, hook result, transcript or session mapping was stubbed.

- R6: Electron wrote a 64×64 bitmap to the actual Windows clipboard. The probe
  confirmed nonempty image data and empty text, sent Ctrl+V through CDP keyboard
  events, and read `[Image #1]` from the real Claude input draft.
- IN6: with both image and test text on the OS clipboard, Ctrl+V inserted the text
  without attaching `[Image #2]`. Original clipboard text and HTML were held in
  renderer memory, never printed, and restored with equality checks.
- RS8: Claude's real SessionStart hook and persisted conversation produced the
  matching recent-session row, `.open` class and `.re-was.live` badge. Clicking
  the row selected the existing tab without increasing the tab count.

Claude was not authenticated in this isolated launch. A benign submitted prompt
produced a login error and the real persisted conversation needed for RS8; no
successful model inference is claimed or required for these UI integration cases.

Evidence: `E:/project/agentdeck-integration-20260927/live-integration.json` and
`live-integration.png`. The JSON reports all three cases passing and
`clipboardRestored: true`.

Reproduction, after starting a real Claude session in the isolated app with a
SessionStart hook and at least one persisted turn, leaving an empty input draft:

```powershell
node tools/verify-live-integrations.cjs <CDP-port> <test-Claude-session-id> <test-root>
```

The probe checks that the target app uses `<test-root>/cfg`, that the session's
hook CWD is inside that root, and that the selected agent is Claude. It refuses
unsupported clipboard formats instead of losing them. It does not launch an
agent or submit prompts; it leaves the tested image/text draft in the test CLI.

The user explicitly authorized deletion of the earlier `ad-cwd-gStJmz` fixture.
A new path-checked PowerShell deletion attempt was still rejected by automatic
execution policy, with no specific reason returned. It was not bypassed; deletion
remains uncompleted separately from the successful integration verification.

The user subsequently deleted that fixture manually. Before preparing 1.2.2,
`Test-Path C:\Users\power\AppData\Local\Temp\ad-cwd-gStJmz` returned `False`.

## 1.2.2 release verification

Prepared from `359c8bf` in the detached worktree
`E:/project/agentdeck-release-1.2.2`. Release changes are version synchronization
and documentation; product and test code are unchanged from the verification above.

- `npm ci --ignore-scripts`, `npm run typecheck`, full `npm test`, and
  `npm pack --json` all exited 0. Prepack built the release bundle and
  `check-release.js` confirmed that development reload code and sourcemaps are absent.
- The packed `package.json` reports `tabby-agentdeck@1.2.2`. The archive's
  `dist/index.js` and the bundle loaded by the isolated regression app have the
  same SHA-256: `E3574BAF6070D8B137BD262DE057269A24E932C71CF5C91350490FA04951E4A2`.
- `run-all.ps1 -SkipBuild -SkipUnit` on port 9239 returned 168 PASS, 0 FAIL,
  8 SKIP across 176 entries. B0 and R13 were separately verified by the commands
  above. A follow-up `probe-all.js` run in the repository passed R28, matching
  Git's nine changed files and line totals; that follow-up had no failures.
- Thus 171 entries passed in this release run. R6, IN6 and RS8 retain the real
  integration evidence above for unchanged product code; they were not repeated
  against the release bundle. PF4 and PF6 remain measurements without verdicts.
- Release evidence is in `E:/project/agentdeck-release-evidence-1.2.2`, including
  `typecheck.log`, `unit.log`, `pack.log`, `regression.log`, `main-recheck.json`,
  and `app/report/regression.json`. The production Tabby plugin was not replaced.
