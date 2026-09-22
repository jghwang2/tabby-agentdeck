# Local account configuration

`accounts.example.json` contains the shared format with empty fields only.
Copy it to `~/.agentdeck/accounts.json` and fill in that local copy, or select a
local path using `AGENTDECK_ACCOUNTS_FILE`. Never fill in the tracked example.

After cloning, enable the repository's commit checks:

```sh
git config core.hooksPath .githooks
```

The hook rejects private account files even when staged with `git add -f`, and
rejects non-empty account examples. It also checks staged content against IDs,
passwords and encrypted authentication values in the registered account list,
without opening the native token stores belonging to running sessions.
CI checks private file paths and empty examples independently of local hooks.
