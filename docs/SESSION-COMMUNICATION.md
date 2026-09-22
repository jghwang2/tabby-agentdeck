# Session communication and fixed navigation slots

AgentDeck assigns human navigation slots 1–9. Closing a session leaves a hole;
the next session uses the lowest free number. Filtering, status changes and tab
reordering cannot change an assigned number. Ctrl+1…9 selects the fixed slot,
even when a filter hides its row. The sidebar no longer groups/reorders rows by
project or status and no longer supports drag-to-reorder. Settings tabs do not
consume a slot. A split root shares its human slot; its individual AI sessions
still have different actual session IDs. Existing external/recovered tabs beyond
nine remain open without shortcuts; AgentDeck's new/resume controls enforce nine.

Numbers are never mailbox addresses. Every prompt hook requests a live UI snapshot
of the current slot-to-session mapping. A sender resolves the user's target once
and sends to that exact session ID. Open tabs without a registered session remain
in the snapshot as not addressable; registration and MCP connection are distinct.
The snapshot includes the caller's exact session ID and is delivered even without
an MCP client. It is fetched from the running receiver, not a stale file; an offline
receiver is reported as unavailable. If a split contains several sessions, ask
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
`AGENTDECK_MAILBOX_ROOT` (scoped to the Tabby configuration when present; otherwise
`%LOCALAPPDATA%/tabby-agentdeck`). Credentials are session-specific, never supplied
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

The existing `UserPromptSubmit` hook always supplies the live UI snapshot inside
AgentDeck. Both prompt and `PostToolUse` hooks check pending messages after their
session registration report, even without MCP. They ask the model to read its
mailbox using MCP or the authenticated CLI fallback. The hooks never inject
terminal input, answer approval prompts, or force an idle agent to execute.
For a running CLI without an MCP adapter, use `node <installed hooks/agentdeck-mailbox.mjs>
--cli <your actual session ID> receive`. The same entry point supports `sessions`,
`send`, and `acknowledge`; mutations accept a UTF-8 JSON argument file as the last
argument, with the same fields as the MCP tools. Credentials are loaded internally
from the caller's pane and must match its explicit session ID. No global CLI
configuration or credential file edits are needed. A queued send does not prove
that the receiving model has read it; obtain acknowledgement or a reply.

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
TCP path plus hook context output.
`tools/probe-session-context.js` verifies the actual isolated Tabby DOM against
prompt snapshots, no-MCP CLI request/reply, closed targets, and reused slots.
Run it with `node tools/cdp.js 9222 tools/probe-session-context.js` after starting
the isolated instance; it refuses the real user instance.

`tools/probe-group.js` and
`tools/probe-reorder.js` exercise fixed slots in the isolated app. Unit/protocol
tests alone do not establish that a real CLI model followed the hook instruction.
