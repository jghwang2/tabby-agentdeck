# Alias number reuse (2026-10-06)

New tabs reserve aliases only against open tab identities, including identities
in restored pane profiles that have not yet been visited by the renderer.
Existing open tabs keep their names. Reusing a closed tab's name clears its old
reservation so restoring it cannot rename the current owner.

Validation:
- `npm run test:sessions`, `npm run typecheck`, `npm test`: passed.
- Isolated staged build: `tools/probe-identity.js` passed all 10 checks.
- Actual close/open: `[1,2,3]` -> `[2,3,1]`; another open gave `[2,3,1,4]`.
- Isolated reload: all four aliases and terminal session IDs unchanged.
- Final full UI regression: 169 passed, 0 failed, 7 skipped for unavailable
  environment conditions. Report: `.tmp/alias-final-regression/report/regression.json`.
- An earlier run overlapped a staging rebuild; its results were discarded and
  the full suite rerun against the final unchanged artifact.

Validated bundle SHA256:
`1683965D35CA94537021D1FF7BE7ADBF27F5F97A822672DF5B8762E50D84C48D`.
The identical bundle was copied to repository dist and the local Tabby plugin
installation. Previous installed bundle: `.tmp/alias-installed-backup/index.js`.
The running installed app has no reachable CDP endpoint or development watcher;
live reload is not verified. Restarting Tabby is still needed for that process
to load the installed change. No commit or remote publication was performed.
