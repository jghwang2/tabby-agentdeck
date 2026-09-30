# Mouse navigation and session messaging introduction — 2026-09-30

## Mouse navigation

The sidebar rebuilt its rows on status updates, including between pointerdown and
pointerup. Chromium then had no original click target. Keyboard navigation used
session objects directly and continued working.

`deck.service.ts` now defers list rendering during a primary pointer gesture.
Document pointerup/pointercancel and window blur release the guard after the
browser's click dispatch and schedule a fresh render. This also protects close
buttons without changing their click handlers or enabling drag reordering.

`node tools/probe-mouse.cjs 9237` uses real Chromium mouse input in the isolated
`mouse-ui` instance. It covers normal clicks, an intervening render, release
outside the list, pointer cancellation, window blur, and closing during a render.
The original installed bundle reproduced the lost click; the fixed bundle passes.
Tab closing is asynchronous, so the probe waits for tab removal rather than
assuming it completes within 300 ms.

## Validation

- TypeScript check and `npm test` passed.
- Full isolated regression: 159 passed, 1 failed, 16 skipped out of 176.
- The failed RL2 repair measurement failed identically in the original bundle:
  selecting the tab briefly resized its columns before repair. Waiting for that
  selection to settle before collecting repair samples made all 7 repair checks
  pass. This changes the probe setup, not the repair implementation or assertions.
- Final targeted results: `.tmp/mouse-click-results.json` and
  `.tmp/mouse-repair-results.json`; full report:
  `.tmp/mouse-regression/report/regression.json`.
- Verified staging artifact: `.tmp/mouse-stage/dist/index.js`.
- Applied that same artifact to the live installation; SHA-256:
  `B8A6B957AD07D1D6133D13707E4BDF26E021F835CE50E6F49D9AAB848334FA89`.
- Live diagnostic log at 2026-09-30T03:25:02.526Z:
  `reload restored tabs=5 dead=0 ms=2691`.

Live reload restored all five tabs, but the navigation snapshot assigned numbers
1–5 again (the previous open slots were 1, 2, 3, 4, 7). Reload persistence of slot
numbers is a separate observed limitation. Idle sessions also await their next
hook to register their message address again; the UI snapshot keeps those tabs
visible as open/unregistered. Do not equate mailbox active counts with restored
terminal counts.

The skipped full-suite checks remain unverified; they are not counted as passes.

## Introduction

English/Korean READMEs and website feature cards now describe fixed numbers,
cross-session request/reply examples, resolving numbers to actual session IDs,
slot reuse, setup requirements, and acknowledgement versus queued delivery.
Package description and website search/share descriptions also mention messaging.
`npm pack --dry-run --ignore-scripts` confirms both READMEs are included.

Public npm and GitHub publication is a separate step from local documentation
changes. The repository publishes npm packages through its version-tag workflow.
