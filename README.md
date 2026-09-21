# tabby-agentdeck

[![npm](https://img.shields.io/npm/v/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![downloads](https://img.shields.io/npm/dm/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![CI](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/tabby-agentdeck)](LICENSE)

**[Website](https://jghwang2.github.io/tabby-agentdeck/) · [User guide](https://jghwang2.github.io/tabby-agentdeck/guide/) · [Full reference](docs/REFERENCE.md) · [한국어](README.ko.md)**

A [Tabby](https://tabby.sh) plugin for people who keep **Claude Code, Codex and Gemini CLI open in several tabs at once**.
A 4:3 terminal, a session deck with live status, and a preview panel for what the agents produce.

![tabby-agentdeck — terminal, preview panel and session deck](docs/guide/img/00-full.png)

## Keys

| Key | What it does |
|---|---|
| `Ctrl+T` (⌘+T) | New tab in the work root |
| `Ctrl+1` … `Ctrl+9` | Select fixed session slot 1–9 (unchanged by filtering or closing another session) |
| `Ctrl+L` | Focus the session list / same key returns to the terminal. Then `↑↓` walk, `Enter` picks, `Esc` leaves |
| `Ctrl+W` | Close the current tab (the focused row when the list has the keyboard) |
| `Ctrl+O` | Open / close the preview panel |
| `Ctrl+R` | Screen repair (same as `↻`). Rename tabs by double-clicking the row |
| `Ctrl+S` | Split side by side (Tabby's own) |
| `Ctrl+D` | Split top / bottom (Tabby's own) |
| `Ctrl+Q` | Close the focused split pane |
| `Ctrl+Enter` / `Shift+Enter` | Newline without sending |
| `Ctrl+V` | Paste. An image-only clipboard is handed to the agent as an image |
| Right-click | Copy with a selection, paste without one. Hold for the context menu |
| `Ctrl+F` / `Ctrl+S` | Find / save inside the preview panel |

Two actions ship unbound: `agentdeck-toggle` (sidebar / 4:3 on-off) and `agentdeck-view-mode` (Files ↔ Changes).
Change any of them under **Settings → AgentDeck → Shortcuts** — a key already used by Tabby or AgentDeck is flagged before it is applied. Tabby Settings → Hotkeys → `agentdeck-*` works too.
These are the defaults for new installs. Existing AgentDeck shortcuts stay as saved; use **Default** beside an action to adopt its new binding. Stock split shortcuts `Ctrl+Shift+S` / `Ctrl+Shift+D` switch to `Ctrl+S` / `Ctrl+D`; custom split bindings are preserved.

## Search past conversations

Expand **Past sessions** and use its search box to find a function name, error code, file name, or session ID. Search matches literal text without case sensitivity in saved Claude/Codex questions and answers. Select a result to preview the matching conversation; **Resume conversation** continues it. The active-tab filter remains separate.

Search runs locally in a background Node.js process, with a disk cache refreshed when transcripts change. Node.js must be available on PATH. It requires no MCP connection or AI request. Tool output and system instructions are excluded. See [history search](docs/HISTORY-SEARCH.md) for scope and storage.

## Install

Inside Tabby: Settings → Plugins → search `agentdeck` → Install → restart Tabby.
Sessions use reusable fixed slots 1–9; automatic sorting and drag reordering are disabled.
The optional [session communication MCP](docs/SESSION-COMMUNICATION.md) sends and receives by actual session ID only. Human numbers never address the MCP server.

Everything else — status, preview panel, diff and commit, resuming sessions, settings — is in the
[user guide](https://jghwang2.github.io/tabby-agentdeck/guide/) and the [full reference](docs/REFERENCE.md).

Built and verified on Windows. MIT.
