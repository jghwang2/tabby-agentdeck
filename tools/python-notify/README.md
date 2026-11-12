# Optional local Python notification transport

This is the Python transport used for the local Windows notification experiment.
It sends the existing AgentDeck protocol to the unchanged receiver. It does not
change the plugin's default installer, hook catalog, or release packaging.
Python 3 is required; validation was performed with Python 3.13 on Windows.

Keep `relay.py` and both entry points together in a persistent directory outside
the plugin installation, for example `%USERPROFILE%/.agentdeck/python-notify`.
Use an absolute Python interpreter path in hook commands. Replace only the
existing AgentDeck notification command, retaining its arguments and timeout:

```text
"<python.exe>" "<directory>/agentdeck-notify.py" -Status running
"<python.exe>" "<directory>/agentdeck-codex-notify.py"
```

The Claude entry point preserves the existing `-Status`, `-Subagent`, `-Agent`,
`-Label`, `-SessionId`, and `-MaxLabel` options. The Codex entry point identifies
itself explicitly and lets the receiver interpret the hook event.
Existing Codex compatibility hooks for `SessionStart`, `SubagentStart`, and
`SubagentStop` can use the Claude entry point with `-Agent codex` plus respectively
`-Status idle`, `-Subagent start`, or `-Subagent stop`.

Back up settings before changing them. Do not add a second notification hook or
change other hooks, authentication files, or trust settings. Restore the settings
backup to undo the switch. The plugin's hook management UI does not recognize
these optional Python commands: do not reinstall hooks over this configuration,
as the installer can add its default executable alongside the Python command.
Restore the original configuration before using the plugin's hook installer.

## Verification

From the repository root on Windows:

```text
node tools/python-notify/verify.cjs
```

Set `AGENTDECK_PYTHON` to an interpreter path if `python` is not on PATH.
The test uses an isolated runtime and compares both entry points against the
Node transport. It verifies split UTF-8 replies, parent identity, input filtering,
invalid and oversized input, rejected/malformed/missing acknowledgements, the
failure deadline, durable offline delivery, replay deduplication, profile paths,
and actual receiver state transitions including Codex compatibility events.
Test artifacts are retained in the printed temporary directory.

The original local benchmark alternated 40 executions per implementation against
a dummy acknowledgement server: median 175 ms for the Framework executable and
105 ms for Python. These are observations on one Windows machine, not a latency
guarantee. An isolated Tabby check also verified both providers' running, waiting,
and done transitions and terminal binding. Local configuration, backups and
session identifiers are intentionally excluded from this repository.
