# Session communication and fixed navigation slots

AgentDeck assigns human navigation slots 1–9. Closing a session leaves a hole;
the next session uses the lowest free number. Filtering, status changes and tab
reordering cannot change an assigned number. Ctrl+1…9 selects the fixed slot,
even when a filter hides its row. The sidebar no longer groups/reorders rows by
project or status and no longer supports drag-to-reorder. Settings tabs do not
consume a slot. A split root shares its human slot; its individual AI sessions
still have different actual session IDs. Existing external/recovered tabs beyond
nine remain open without shortcuts; AgentDeck's new/resume controls enforce nine.

Numbers are never mailbox addresses. The UI publishes a prompt-time snapshot
of the current slot-to-session mapping. A sender resolves the user's target once
and sends to that exact session ID. If a split contains several sessions, ask
which one rather than choosing the last active session. A row's context menu can
copy each exact message target. Reusing a slot cannot redirect queued messages.

## MCP connection

Add a stdio MCP server named `agentdeck` to each participating CLI, with command
`node` and one argument: the absolute installed path to
`hooks/agentdeck-mailbox.mjs`. Start the CLI inside an AgentDeck terminal so its
MCP child inherits `AGENTDECK_TAB`. Enable AgentDeck's existing status hooks.
Configuration remains user-controlled: installing this plugin does not rewrite
global Claude/Codex configuration. The server advertises MCP revision 2025-11-25.

The stdio adapter forwards authenticated requests to AgentDeck's existing local
TCP hook receiver. The receiver is the single writer of `mailbox.json` under
`%LOCALAPPDATA%/tabby-agentdeck`. Credentials are session-specific, never supplied
as model-visible tool arguments. A fresh adapter must receive hook-confirmed
credentials for its process before it can send; an old adapter stays bound to its
original session ID. Local processes running as the same OS user are trusted.

Tools:

- `agentdeck_sessions`: actual IDs, names, projects and active status.
- `agentdeck_send`: `toSessionId`, `body`, stable retry `requestKey`, optional `replyTo` message ID.
- `agentdeck_receive`: up to 50 incomplete messages belonging to the caller.
- `agentdeck_acknowledge`: received `messageId`, optionally `completed: true`.

Receive does not delete messages. Acknowledge records read/completed timestamps.
Repeating a send with the same sender/request key returns the original message;
reusing that key for different contents is an error. A reply must reference a
message received from the target. Closed recipients are rejected. Disk state
survives reload/restart; sessions become active again only after hook registration.

## Notification and execution

Only when a pane has an initialized MCP adapter do the existing
`UserPromptSubmit` and `PostToolUse` hooks produce optional `additionalContext`.
The prompt hook supplies the UI address snapshot; either hook can report pending
messages and ask the model to call `agentdeck_receive`. The hooks never inject
terminal input, answer approval prompts, or force an idle agent to execute.
Models still decide when to call tools. Waiting/idle recipients read messages on
their next supported hook/task boundary. Clients without those hooks can poll
the same receive tool explicitly. Message bodies are other-session input, not
system instructions. Past-conversation search is a separate AgentDeck feature;
there is no search tool in this MCP server.

Protocol references: [MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex hooks](https://learn.chatgpt.com/docs/hooks).

## Verification

`test/sessionCommunication.cjs` covers numbering, authentication, send/receive,
replies, acknowledgements, retries, disk restart, closed targets and slot reuse.
`test/mailboxBridge.cjs` starts two actual stdio child processes and exercises the
TCP path plus hook context output. `tools/probe-group.js` and
`tools/probe-reorder.js` exercise fixed slots in the isolated app. Unit/protocol
tests alone do not establish that a real CLI model followed the hook instruction.
