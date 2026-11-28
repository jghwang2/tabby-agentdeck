# Antigravity CLI (`agy`) status integration

AgentDeck can identify Antigravity CLI and display `running`, `waiting`, `idle`,
`done`, and `error` states. Process detection works through the PTY's operating
system process tree; shell-specific prompt or title formats are not required.

## Install the lifecycle hooks

From the installed `tabby-agentdeck` package directory, run:

- macOS / Linux: `python3 scripts/agentdeck-agy-setup.py install`
- Windows: `python scripts\agentdeck-agy-setup.py install`

The installer updates `~/.gemini/config/hooks.json` (override with `--file` for
testing). It preserves unrelated hook groups, keeps a unique backup before each
write, and preserves the existing file mode on POSIX. On Windows it rewrites the
existing file so its ACL is retained. Restart running `agy` sessions afterwards.
The `/hooks` command in `agy` should list these five events with one hook each:
`PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, and `Stop`.

To remove only AgentDeck's hook group and leave other groups intact:

- macOS / Linux: `python3 scripts/agentdeck-agy-setup.py uninstall`
- Windows: `python scripts\agentdeck-agy-setup.py uninstall`

## Permission behavior

The adapter does not enable automatic approval. `PreToolUse` returns `allow`,
which delegates to the next hook or AGY's default policy; it never returns
`auto_approve`. A `Stop` event with `fullyIdle=false` remains `running`, not
`done`. User prompts and tool arguments are not forwarded, except the working
directory, tool name, and `TargetFile` used for file previews.
