# AgentDeck storage audit — 2026-09-23

Read-only scan of `C:\Users\junggon\.agentdeck`, excluding directory links/junctions.
No account contents, credentials, or conversation bodies were read.

- 423,539 files, 38.976 GiB logical file size; 0 scan errors.
- 14 directory links excluded (shared histories are not counted twice).
- Two accounts contain 24.714 GiB and 13.441 GiB of marketplace staging data.
- 108 staging directories were observed; 105 contain files. Empty directories account for the difference.
- Creation times of the old C-drive staging directories: 2026-09-23 14:44–15:28 KST.
- The E-drive account store also had 41 staging directories at 15:54 KST: relocation does not fix repeated staging creation.
- The reason repeated updates leave their staging copies behind has not been established by this audit.

## Exclusive file categories

Categories are assigned in order: Git metadata, node_modules, then extension.

| Category | Bytes | Files |
|---|---:|---:|
| Git metadata/history | 21,393,211,590 | 2,976 |
| Executables outside node_modules | 10,239,666,312 | 749 |
| DLLs outside node_modules | 3,124,497,584 | 11,556 |
| node_modules outside Git metadata | 2,902,033,264 | 374,187 |
| Source maps | 2,653,311,865 | 1,391 |
| JavaScript outside node_modules | 1,269,819,066 | 3,466 |

Machine-readable per-directory, per-copy and largest-file evidence:
`../.tmp/account-storage-audit.json`.
Reproduce with `python tools/audit-account-storage.py <account-root> <output.json>`.

## Runtime path change

The account storage setting now owns runtime data under
`<accountStorageDir>/runtime/<Tabby-profile-hash>/`:
`status/`, `meta/`, `sessions.json`, `history-search/`, status-line configuration/cache,
and `mailbox/`. Profiles retain independent mailbox writers.
CLI hooks receive the selected runtime root; pre-existing shells can derive the same root
from the account-file environment and Tabby profile directory.
Legacy data is copied once without overwriting existing destinations or deleting originals.
Tabby's own Electron configuration/log/cache directories are outside this setting.

## Verification and deployment

- `npm run typecheck`: passed.
- `npm test`: passed. The hook fixture now explicitly selects an isolated runtime root.
- `test/runtimePaths.cjs`: actual PowerShell hook writes, old-shell fallback, per-profile isolation,
  migration preservation, migration retry, and other-profile exclusion passed.
- Isolated UI runtime probe: status file, bound UI badge, ledger row and mailbox connection files passed.
- Full isolated regression: 166 checks, 144 passed, 0 failed, 22 skipped. Unit/build checks were
  run separately; other skips retain their environment-specific explanations in the report.
- Final regression evidence: `../.tmp/runtime-regression-final.json`.
- Deployed the identical staged bundle, SHA-256
  `A7BA04C0C76E6AA27F24F13126684E3774058C9CB6F182162D679C38797D16DD`.
- Previous bundle retained in `../.tmp/runtime-before-dist/`; no commit or push performed.
- Live runtime root: `E:\AIData\AgentDeck\.agentdeck\runtime\8c3537740c9563cc`.
- Live validation at 16:33 KST: navigation TCP response received, current Codex session found
  in the ledger, 54 ledger records retained, 61 mailbox session records (3 active at inspection).
- An invalid mailbox credential received the expected rejection response.
- Earlier 5-second requests timed out during live reload recovery; the later request succeeded.
  Main Tabby PID remained 16368. Seven of eight sampled CLI PIDs were still present;
  the missing Claude PID's exit cause was not established, so full preservation of all processes
  is not claimed. The active task session continued successfully.
- At the post-deployment scan, neither legacy C-drive runtime directory had any file modified
  after 16:27 KST; the new E-drive runtime directory had eight updated files.
- Live evidence: `../.tmp/runtime-live-verification.json`.
- Subsequent inspection found both old C-drive staging directories empty. This task did not
  delete those copies; the size breakdown above records the earlier observation.
