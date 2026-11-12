# Python notification hooks

AgentDeck 1.3.2 uses Python directly for Claude and Codex notification hooks.
Install Python 3.8 or newer and make python available on PATH on Windows
(python3 on other platforms). Restart Tabby after changing PATH.
No third-party Python packages are required.

In AgentDeck settings, apply the hook update or use install/reapply. The update
recognizes the previously shipped executable, Node and PowerShell commands,
backs up settings, and replaces them with Python. It preserves other hooks and
the original Claude status line. If Python cannot run, installation stops before
changing settings. The status-line and mailbox services continue to use Node.

Both Python entry points and their shared module ship in the hooks directory:
agentdeck-notify.py, agentdeck-codex-notify.py, and agentdeck_relay.py.
Do not move an entry point without its shared module. The notification exe files
are no longer built or packaged. Modified custom registrations are preserved and
may require review before an automatic update can proceed.

For a manually configured Codex compatibility event, the Claude entry point also
accepts -Agent codex with -Status idle, -Subagent start, or -Subagent stop.
These manual adapters are separate from the default seven Codex notifications.

The transport keeps the same receiver protocol, parent identity, filtered input,
UTF-8 responses and 2.2-second acknowledgement budget. An unacknowledged event
is stored atomically for replay under the same event ID.

Run node test/pythonTransport.cjs and node test/pythonHook.cjs from a source
checkout to test transport behavior and settings migration. npm test includes
both tests, plus sustained load through the Python transport. Set
AGENTDECK_PYTHON for transport tests using a specific interpreter; production
hook commands use the interpreter on PATH.
