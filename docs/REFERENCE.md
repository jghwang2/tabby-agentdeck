# tabby-agentdeck — full reference

> The short front page is [`README.md`](../README.md). This file keeps every detail.

[![npm](https://img.shields.io/npm/v/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![downloads](https://img.shields.io/npm/dm/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![CI](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/tabby-agentdeck)](../LICENSE)

**[Website](https://jghwang2.github.io/tabby-agentdeck/) · [User guide](https://jghwang2.github.io/tabby-agentdeck/guide/) · [한국어 README](REFERENCE.ko.md) · [한국어 사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html)**

A [Tabby](https://tabby.sh) terminal plugin for **people who keep Claude Code, Codex and Gemini CLI open in several tabs at once**.

It pins the terminal viewport to **4:3** and spends the leftover space on a **session deck with live status**.
You see which agent is running and which one is waiting for you without clicking through tabs.
Documents and images the agents produce open in a **preview panel** beside the terminal.
On top of that it fixes the things agent CLIs get wrong inside a terminal — image paste, newline keys, pty width drift.

```
┌────────────────────┬──────────────────┬──────────────────┐
│                    │ note.md   ＋ ⟳ ✕ │ AGENT DECK    4  │
│  terminal (4:3)    ├──────────────────┼──────────────────┤
│                    │ note.md  shot.png│ ● running refactor│
│  Tabby's own tab   ├──────────────────┤ ⏸ waiting rebuild │
│  bar is hidden     │ # Title          │ ✔ done    tests   │
│                    │ body is rendered │ ○ idle            │
│                    │ [image]          ├──────────────────┤
│                    │ 742 B · just now │ + new tab │ config│
└────────────────────┴──────────────────┴──────────────────┘
      terminal           preview panel      session deck
```

Built and verified on Windows. The status-notification hook is a PowerShell script and is therefore Windows-only;
everything else is platform-agnostic but has not been exercised elsewhere.
If you run Tabby on macOS or Linux, an [issue](https://github.com/jghwang2/tabby-agentdeck/issues) saying what broke is genuinely useful.

## Features

| | What it does |
|---|---|
| **4:3 width** | Derives terminal width from window height and fixes it. Leftover width goes to the sidebar; whatever is still left is absorbed by the terminal |
| **Sidebar tab management** | Click to select, `×` to close, double-click to rename the task, right-click to set status by hand |
| **Search · status filter** | The search box narrows by title, task name and working folder; status chips keep only one state. `Esc` clears |
| **Reordering** | Drag a row to move it (Tabby's own tab order follows). Hold at the edge and the list **scrolls by itself**, so off-screen positions are one gesture away. Blocked with an explanation while status sorting is on |
| **Keyboard control** | `Ctrl+L` enters the list; `↑↓` walks it and Enter picks. **The tab does not change while you walk** — focus and selection are separate so passing output does not flood the screen. `Ctrl+W` closes the current tab (the focused row when the list has the keyboard) |
| **Output preview** | Markdown, images, tables (csv/tsv) and code the agent touched, in a panel beside the terminal. It picks up paths printed on screen, so Claude Code, Codex and Gemini all work |
| **Drag and drop** | Drop a file on the panel and it opens. **Drop it on the terminal** and you are asked: open in panel / paste the path |
| **Diff view** | The `Changes` tab of the same panel shows `git diff` for the working tree — file list, `+N -M`, unified diff with line numbers. It holds regardless of who made the change |
| **`file:line` reference** | Click a line in a diff or code view and that position is typed into the terminal (Shift+click for a range). "Fix this line" without typing it out |
| **Stage · commit** | Click a file tag to `git add`/unstage, write a message and commit. **It takes two presses** (the first one asks to confirm) |
| **Session groups** | Tabs group by project. The boundary is found by walking up for a repository root (`.git` and friends), so there is nothing to configure. With a single group no header is drawn and order is left alone |
| **Resume a past session** | `⟲ Past sessions` in a group lists **closed Claude Code sessions by the prompt you typed**. Click one and the conversation comes back with `claude --resume` in its own working folder |
| **IME composition guard** | Waits for composition to settle before writing to the pty, so a half-composed syllable no longer follows the cursor or drops onto a new line |
| **Agent profiles** | Works out which CLI is running in a tab (process → title) and applies that agent's rules. Supporting a new CLI is one profile block |
| **Mouse docking** | Drag the header to any edge (left/right/top/bottom); drag the divider to resize |
| **Status** | running / waiting / rate limited / done / error / idle, as colour, badge and elapsed time. It judges from screen text even with no hook, and a badge says **why** it stopped (what needs approval, which limit) |
| **Per-status counts** | The header shows counts in urgency order — `⏸ 2 ● 3 ○ 1`. Turn on `sortByStatus` and tabs sort the same way |
| **Subagent count** | How many background agents that session is running, as `❖3`. Counted by **matching launches against completions** in the transcript, so it is right even when no hook reports |
| **Task names** | The moment you press Enter, the text in the input box becomes the row's label |
| **Claude Code hook** | Install once from the settings window and the agent reports status directly (optional) |
| **Root profile** | Always open new tabs in a chosen working root |
| **Auto-update** | On startup it asks npm for a newer version, and with your consent installs it **while Tabby stays open**, then reloads the window — your tabs and sessions survive. Development installs (source links) are left alone |
| **Input fixes** | `Ctrl+V` image paste, `Ctrl+Enter`/`Shift+Enter` newline, right-click copy/paste |
| **Screen repair** | Clears **only the input-box remnant** of a broken TUI and re-syncs the size — the conversation you were reading is untouched. Sidebar `↻`, tab right-click, or the `agentdeck-repair` hotkey |

## Install

**Inside Tabby**: Settings → Plugins → search `agentdeck` → Install → restart Tabby.

**From source**:

```powershell
npm install
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

`install.ps1` puts a junction in Tabby's plugin directory (`%APPDATA%\tabby\plugins\node_modules\tabby-agentdeck`)
pointing at this folder. Edit the source and run `npm run build` — **no restart needed**.
Developer options watch `dist/index.js` and reload the window only, keeping your tabs and sessions
(`Settings → AgentDeck → Developer options`).

### Auto-update

Eight seconds after startup it asks the npm registry for the latest `tabby-agentdeck`.
If there is a newer one it **asks** — `Update now` / `Later` / `Skip this version`.
Say yes and it goes:

```
(outside) npm install  →  the window reloads  →  tabs and sessions stay
```

**The only human step is that first click, and Tabby never closes.**
Running tabs reattach to the same pty through a recovery token (`src/reload.service.ts`).
If the install fails the window is not reloaded either — you simply keep running the old version.
The record is in `%LOCALAPPDATA%\tabby-agentdeck\update.log`.

| Setting | Default | |
|---|---|---|
| `autoUpdate` | `true` | Off means it does not even check |
| `updateCheckIntervalHours` | `6` | So it does not ask on every startup |
| `updateRegistry` | `https://registry.npmjs.org` | Change for an internal mirror |
| `updateSkipVersion` | — | The version you pressed `Skip` on. **Only that one** is skipped; the next release asks again |

> **Why close Tabby to install.** Two reasons. ① A running plugin cannot swap itself out — Tabby reads
> `dist/index.js` once at startup, so changing the disk leaves the running code as it was. ② Windows holds
> loaded files open, so an npm install against that folder while Tabby is up can fail half-deleted — a
> broken plugin is the worst outcome. So the install is done by `updater/agentdeck-update.ps1`, copied out
> to a temp folder, **after it confirms Tabby has exited**. It waits on the main process PID of the instance
> that started the update — counting by name would let one other Tabby window block updates forever.

> **Development installs are left alone.** When `tabby-agentdeck` in the plugin folder is a link to a source
> tree (an `install.ps1` setup), running `npm install` there would **overwrite the source you are working on**.
> If `src/`, `.git` or `webpack.config.js` is visible, or the entry is a link, it only reports that a new
> version exists (the check is `canSelfUpdate` in `update.ts`).

## Task names and status

A sidebar row is a **task name (label)** and a **status badge**.
Both work **with the plugin alone, no configuration**. Install the Claude Code hook to make them exact.

### Task names

The moment you press Enter, it reads the input box drawn on screen (`❯ ...`, `> ...`) and takes 40 characters as the label.
Text that arrived by paste, `↑` history or IME is caught as drawn.
Shift+Enter / Ctrl+Enter are newlines and do not change the label; if no input-box head is found (a plain shell, a y/n prompt) the label is left as it was.

### Status

- **Auto-detection (default)**: PTY output flowing means `running`; silence for `idleAfterMs` (2.5s default) means `idle`.
  Patterns like `Do you want to`, `❯ 1. Yes` and `(y/n)` mean `waiting`. The spinner Claude Code puts in the title also reads as running.
  If a `waiting` tab shows working text again (`esc to interrupt`), it is taken as approved and lifted back to `running` —
  this applies to hook-pinned tabs too, because the first hook after an approval only arrives when the tool finishes, so approving a long build used to leave the row stuck on waiting.
- **Claude Code hook (recommended)**: Settings → AgentDeck → "status notification hook". It wires a notify script into
  UserPromptSubmit / Notification / PostToolUse / PostToolUseFailure / PermissionDenied / Stop / StopFailure in `~/.claude/settings.json`.
  Other hooks are untouched and a backup is written first. The event set grew in 0.3.0, so older installs read as "not installed" — press install again.
  The agent then states directly that it was given an instruction, is waiting for approval, ran a tool (= was approved), finished, or failed — so the reading never wobbles. "Remove" in the settings window reverts it.
  Waiting rows carry the reason: `⏸ waiting · Bash permission`. The reason disappears when the status changes.
- **A stale pin is released (`staleAfterMs`, 5 min default)**: a hook-reported status is pinned so auto-detection cannot overwrite it.
  But hooks have **no "session ended" event** — Ctrl+C, closing the window or a CLI crash leaves the last `running` behind, and a pinned
  row had no way back down (the sidebar says working while nothing is happening). So the clock runs from the **most recent of the three
  signs of life** — hook report, PTY output, working marker — and after five minutes of complete silence the pin is dropped and the row
  falls to `idle`. Any one of the three keeps it alive, so long builds are never cut. `waiting` and `limited` are exempt: being quiet is
  normal for them, and dropping them would remove **the rows a human still has to answer**. Set `staleAfterMs: 0` for the old behaviour.
- **Rate limited**: when Claude Code hits a session or weekly usage limit the turn is cut short, `StopFailure` reports `error: rate_limit`,
  and the sidebar shows the reset time — `⛔ rate limited · resets 12pm`. There is nothing to approve, so it is kept distinct from waiting.
  Other failures (overloaded, server_error …) show as `✖ error · overloaded`. When the limit lifts and the session continues, it returns to running.
  Hook reports are tied to a tab by the `AGENTDECK_TAB` environment variable the plugin plants in the tab's shell
  (tabs opened before 0.2.2, and tabs restored on restart, fall back to the process ancestry).

### Working out which agent is running

For each tab it works out **which CLI is running** and applies that agent's rules.
It knows Claude Code, Codex CLI and Gemini CLI; a new CLI is one more profile block.

Order: ① a child process name that **clearly** names an agent → ② **what the hook says**
(`agentdeck-notify.ps1 -Agent claude|codex|gemini` puts `agent` in every report) → ③ command line → ④ tab title.
The hook knows who it is, so it beats guessing. Hooks have no "session ended", though: close claude in a tab and start a
hook-less codex, and the old value would stick — so the hook value is dropped only when a process name clearly names a
different agent (①). **An empty child-process list is not treated as evidence** — Tabby returned an empty list for every
terminal tab except the first one opened, even with a child running (measured).

A profile decides: status phrases (idle/working), the title spinner, the **image-paste key**
(Claude = `ESC v`, Codex = `0x16`), and the input-box head character.
A tab with only a shell in it is `unknown`, and there every known rule is combined.

> **Only observed values are used narrowly.** Codex and Gemini screen phrases have not been observed in this
> repository, so those two agents use the union (= the old rules) for status. Attaching a profile must not make
> detection worse than it was. When real measurements exist, turn on `patternsProven` for that profile.

### Setting it by hand

- In the sidebar, **right-click → pick a status**, **double-click → rename**.
- From inside a shell script, set the console title to `[AD:<status>] <label>`. The prefix is stripped from the display.

  ```powershell
  $host.UI.RawUI.WindowTitle = "[AD:waiting] waiting for deploy approval"
  ```

  `status` is one of `running` / `waiting` / `done` / `error` / `idle`.
  A status set this way is **pinned** and auto-detection will not overwrite it (the badge gets a dotted underline).
  Right-click → `↺ back to auto` releases it.
  This route only works when run directly in the shell — console titles from agent hooks never reach the terminal.

### How many subagents are running

When Claude Code launches background agents, the count appears on the row as `❖3`.
Hover the row for the list and how long the oldest has been going.

It counts by **matching launches against completions in that session's transcript**
(`~/.claude/projects/*/<session id>.jsonl`). The evidence is the transcript, not what a hook says,
so the count stays right while no hook is reporting. The session-to-tab link is the hook's status file, so
**without the hook installed this indicator does not appear** either (the same holds if `notifyChannel` is off).

Transcripts grow to tens of megabytes, so it reads **only the growth** — it checks the size every two seconds
and reads the tail only when it grew. A session being picked up for the first time has to be scanned once,
so its count can appear a few seconds late.

One thing to know: if you cancel an agent with Esc, or the CLI dies, **no completion is recorded** and the
count may not come down. That is not hidden with a timeout (that would erase genuinely long-running ones).
The elapsed time in the tooltip keeps climbing instead, which is how you spot it.

### The "this tab" line — model, account, limits

Pinned at the bottom of the sidebar (just above the buttons): **the active tab's model, effort, account, context % and
5h/7d limit %**. Switching tabs redraws it for that tab. Limit chips turn yellow at 60% and red at 85%; hover for time to reset.

**Codex gets the same line.** Codex has no statusLine, but it writes the same values into its own session log
(`~/.codex/sessions/…/rollout-*.jsonl`): model and effort in `turn_context`, `rate_limits` in `token_count`
(300 minutes = 5h, 10080 = 7d), the context window in `session_meta`. The plugin reads **only the growth** every two
seconds. The account comes from the `id_token` in `~/.codex/auth.json` — the email only, no signature check (this is a
label, not authentication; the token itself is never carried anywhere). The session-to-tab link is the **Codex hook**
(same condition as the subagent count), so install `Codex status hook` in settings and trust it in Codex's `/hooks`.
A limit window that is not 5h or 7d is left out rather than drawn in the wrong slot.

The rest of this section is the Claude side. These values **only arrive through Claude Code's `statusLine` input** (hook JSON has none of them), so they show up after
Settings → AgentDeck → **`Connect statusLine`**. Connecting **keeps running your existing statusLine** and copies its input on
the way — what you see in the statusLine does not change. The original command is moved to
`%LOCALAPPDATA%\tabby-agentdeck\statusline-inner.json` (the settings page shows what is wrapped) and put back on disconnect.
`settings.json` is backed up before any write.

- If the wrapper (`hooks/agentdeck-statusline.mjs`) fails, **the original statusLine output still goes out**, with its exit code.
- If someone else's wrapper puts us inside itself and forms a loop, it stops at depth two (`AGENTDECK_SL_DEPTH`).
- The account is not in the statusLine input; it is read from `.claude.json` under `CLAUDE_CONFIG_DIR` (or home) — i.e. **who is
  logged in in that config right now**, not necessarily the owner of the token an already-running session holds.
- Before connecting, or before the first report, the line is collapsed entirely. The `"this tab" line` toggle turns it off.

### Alerts

When the window is behind another app (unfocused) and a tab moves to `waiting`, `error` or `rate limited`, the OS is told —
the taskbar icon flashes (`alertFlash`) and a badge with the count of such tabs is drawn on it (`alertBadge`).
The badge follows the real count and disappears at zero. Flashing stops when you bring the window forward.
OS toasts (`alertToast`) are off by default — turn them on and clicking one jumps straight to that tab.
When the window is in front, all three do nothing: the sidebar is already visible.

## Resuming past sessions

**Claude Code conversations survive on disk** even when Tabby is closed (`~/.claude/projects/<project>/<session id>.jsonl`).
`claude --resume <session id>` picks one back up — but what actually blocks you is not the command,
it is **finding your work in a list of UUIDs**.

agentdeck already holds the answer: the prompt text it picked out of the input box when you pressed Enter.
So there is a drawer at the end of each group:

```
▾ Root                          ⏸1 ●2
   ● Agent Root      running ❖2
     rework season pass payout path     3m
   ⟲ Past sessions  5              ▸        ← collapsed by default
```

Expanded:

```
   ⟲ Past sessions  5              ▾
      what is that thing running in the background
        done                        14:12
      move unclaimed season pass rewards to mail
        rate limited                yesterday
```

| Action | What it does |
|---|---|
| Click | Opens a new tab **in that session's working folder** and sends `claude --resume <session id>` |
| Right-click → `resume as a branch` | `--fork-session`. Leaves the original transcript at that point and continues in a **copy** — for trying a different direction from the same spot. Used every time, it just multiplies transcripts |
| Right-click → `copy session id` · `hide from list` | Hides it from the list only. The transcript file is untouched |

Worth knowing:

- **A different working folder means it is not in the list.** `--resume` keys sessions by cwd, so resuming opens there too.
- **Already-open sessions** show as `● open` and clicking goes to that tab instead of resuming —
  resuming the same session in two tabs would have two processes appending to one transcript.
- **Only the conversation comes back.** Local servers and background processes you had running do not.
- Dead rows are distinguished by **shape** (dotted bar + dimmed), not colour. The six status colours are already
  spoken for by live tabs, and a seventh would blur what a badge means.
- Labels come from two places: the prompt picked up while it was alive (the ledger,
  `%LOCALAPPDATA%\tabby-agentdeck\sessions.json`) and the first prompt read from the head of the transcript.
  The former wins; sessions from before the plugin was installed, or started in another terminal, get the latter.
- Sessions whose transcript is gone are dropped from both the list and the ledger — there is nothing left to resume.

This exists as a pair with `noTabRecovery` below — Tabby's own restore brings back **only the shell**, and the
session inside it is already dead, leaving a row of empty prompts. So that is turned off and the real restore lives here.

## Preview panel

If what an agent produced is a document or an image, you cannot check it inside the terminal. So you go out to the
file explorer, and because of that round trip you end up not looking at the output at all. This panel fills that gap —
open it with the **▤** button in the sidebar or the `agentdeck-view` shortcut. Its open/closed state is restored on next start.

**What it renders**

| Kind | How |
|---|---|
| `md` `markdown` `mdx` | Headings, tables, lists, code, quotes, checkboxes and images. Images inside the document render too |
| `png` `jpg` `gif` `webp` `svg` `bmp` `ico` `avif` | At original size (fit to width when larger than the panel) |
| `csv` `tsv` | As a table. A quoted cell (`"a,b"`) is read as one cell |
| Code and text (`.ts` `.cs` `.py` `.json` `.log` …) | With line numbers |

**Three ways a file gets into the panel**

1. **Paths printed on screen are picked up** — `Edited src/hero.tsx`, `Wrote D:\a\b.md`, `Read build.py`.
   Whatever the agent touched is stacked into the recent list (the chips at the top). **This works for any agent** —
   Codex and Gemini print paths just like Claude Code, hook or no hook.
   Relative paths are resolved against that tab's working folder, and only files that actually exist are shown.
   The recent list is **per tab**.
2. **Drag and drop** — from the file explorer or your editor onto the panel.
3. **Type a path** — press **＋** and enter one (`Enter` opens, `Esc` collapses).
   **If the file does not exist it is created** — press `Enter` once more and it is created (parent folders included)
   and opened for editing. No trip to the file explorer to start a note. It takes two presses because a typo'd path
   silently creating an empty file costs more later than the extra keystroke does now.

An open file that changes is **re-read by itself** — the panel follows along while the agent edits.
Even while closed it **still reads** (`preload into the panel`, on by default) — it does not draw, but it keeps the
recent chips and "the file to show next time" current, so pressing `▤` mid-task gives you **the files touched so far
as chips with the most recent one in the body** (if you were on `Changes`, the diff is re-read in place).
The same file is re-read on open, because file watching is off while the panel is closed.
**Opening and closing is yours to do by default** — if you want the panel to open by itself the moment output appears,
turn on **Settings → Preview panel → `open the panel automatically`** (off by default).
Turn `preload` off instead and nothing happens automatically: paths only stack as chips and you choose what to look at.
Links inside a document open in the browser if they are web links, in this panel if they are local files.

**Switching tabs switches the panel** — not just the recent chips and the `Changes` tab, but **the body**, back to
the file that session last had open. A tab that has looked at nothing shows an empty panel. Otherwise another
session's document sitting open beside you reads as if it belonged to this one. Switching tabs alone does **not open**
the panel — if it is closed, it is brought up to date the next time you open it.

**Edit and save — `✎`**

Read-only means a single typo sends you to a separate editor, and that round trip is exactly what this panel was meant to remove.
Press `✎` and the body becomes an editor. `Save` (`Ctrl+S`) · `Cancel` (`Esc`).

- Only text files (`md`, code, text, `csv`) are editable. The button dims on images and binaries.
- **Very large files are not opened** (over 1.5 MB). Viewing can read just the head, but saving rewrites the whole
  file — saving while holding only the head would drop the tail. So it opens only when it can read all of it.
- **BOM and line endings (CRLF/LF) are restored exactly as they were.** Otherwise a one-line edit makes P4 and git
  diff see the whole file as changed.
- **Nothing overwrites the screen while you edit** — neither the watcher's re-read nor following a new file.
  If the file changed outside in the meantime, saving asks once more (the second press overwrites).
- **Read-only files are announced on open** (a `read-only` marker). Finding out at save time wastes everything you typed.
  Pressing save stops once with `this is read-only (p4 edit first, if P4) — press again to clear the attribute and save`.
  **Why it is not cleared silently** — in this environment read-only usually means a file not checked out from P4,
  and anything written without a checkout is quietly lost on the next `p4 sync`.
- With unsaved edits, it will not move to another file or to the `Changes` tab.

**Find — `🔍` / `Ctrl+F`**

Case-insensitive, highlights matches, `Enter` (next) and `Shift+Enter` (previous) move between them.
`Esc` closes it and only the highlighting goes away. While editing it searches inside the editor and selects in place.
**`Ctrl+F` is heard only inside the panel** — it must not steal the terminal's `Ctrl+F` (less, vim) — so click the body once first.

Panel width is changed by dragging the divider it shares with the terminal. **Opening the panel relaxes the 4:3 rule and
the terminal narrows by that much**; the sidebar does not shrink. On ultrawide displays 4:3 holds even with the panel open.

> Raw HTML inside a document is shown **as text** (never turned into tags). Reference links (`[a][1]`) and footnotes are not supported.

### The `Changes` tab — the working tree's diff

Switch with `Files` / `Changes` under the header. `Changes` reads `git diff HEAD` in that tab's working folder and shows

- a `3 files · +716 -15` summary and the file list (status tag + `+N -M`). Click a filename to scroll to its diff
- per-file unified diff — old and new line numbers on both sides, with additions, deletions, context and hunks coloured apart
- untracked files by name only (no content diff)

**It is agent-agnostic for the same reason the preview is** — the evidence is the git working tree, not a hook, so it
holds no matter who made the change. If this is not a repository, git is missing, or the working folder is not known yet, it says so in one line.

#### Stage · commit

The tag at the left of a file row is its **staging state** — `unstaged` / `staged` / `both` (partially staged) /
`untracked` / `conflict`. Click it to `git add` the file or take it back (`git reset`). Below is a
`staged N · unstaged M` summary, a message box and the commit button.

**Four layers against an accidental commit —**

1. An empty message locks the button
2. Whitespace-only is rejected with a reason
3. The first press does not commit; it turns into `confirm commit` (in a warning colour). The **second press** runs it
4. Editing the message while confirmation is pending cancels that pending state (so it cannot commit under a different message)

With nothing staged it does not commit — it never widens to `git commit -a`.

> The working folder is **the cwd the tab was opened with**. `cd` in the shell does not change what Tabby reports
> (measured on local Windows sessions), so open a new tab in that folder to look at another repository.
> `git` walks up looking for a repository — if your home directory is one, it is found from anywhere.

## Keys

| Key | Action |
|---|---|
| `Ctrl+Enter` / `Shift+Enter` | Newline (sends `0x0A`). `agentdeck-newline` |
| `Ctrl+V` | Paste. If the clipboard holds **only an image**, the image-paste key is handed to the app instead of text — Claude Code and Codex read the clipboard themselves. `agentdeck-paste` |
| Right-click | Copy with a selection, paste without one. Hold (250 ms default) for the context menu |
| `Ctrl+T` (⌘+T) | New tab — same as the sidebar `+ New tab`. Uses the work-root profile and sets `AGENTDECK_TAB`. Overlapping stock bindings are removed when `claimNewTabKey` is enabled. `agentdeck-new-tab` |
| `Ctrl+1` … `Ctrl+9` | Jump straight to the Nth session **in sidebar order** (group headers are not counted; tabs inside a collapsed group have no number). Tabby's own `Alt+1…` (`tab-N`) counts the tab bar, which opens a different tab once sorting, grouping or search is on. `agentdeck-jump-1` … `-9` |
| `Ctrl+L` | Focus the sidebar list / same key returns to the terminal. `agentdeck-focus-list` |
| `Ctrl+W` | Close the current tab — the **active tab** from the terminal, the **focused row** when the list has the keyboard. Only while `keyboardNav` + `keyboardCloseTab` are on; off, it flows through as the shell's delete-previous-word (`0x17`) |
| (unbound) | `agentdeck-toggle` — sidebar / 4:3 on-off |
| `Ctrl+R` | Screen repair — same as the sidebar `↻`. Removes overlapping stock bindings when `claimRepairKey` is enabled. A saved old `Ctrl-Shift-U` is migrated to `Ctrl-R`. `agentdeck-repair` |
| `Ctrl+O` | Open/close the preview panel — same as the sidebar `▤`. `agentdeck-view` |
| `Ctrl+S` / `Ctrl+D` | Split the pane side by side / top-bottom — Tabby's own `split-right` / `split-bottom`, listed here (and in Settings → AgentDeck → Shortcuts) because they pair with the close key below |
| `Ctrl+Q` | Close the focused split pane — Tabby's own `close-pane`, which ships **unbound**. On startup agentdeck fills it with `closePaneKey` only while it is empty; a key you set yourself is left alone, and `closePaneKey: ''` turns the fill off |
| (unbound) | `agentdeck-view-mode` — switch the panel between `Files` and `Changes` |

Change keys under **Settings → AgentDeck → Shortcuts**: press *Change*, then the key. If Tabby or AgentDeck already uses it you are told what it clashes with and can pick again or take the key over (it is removed from the other binding). Tabby Settings → Hotkeys → `agentdeck-*` works too.
`Ctrl+V` is handled **in the capture phase, not as a hotkey**. On startup it is removed from **both** Tabby's own
`hotkeys.paste` and `agentdeck-paste` — leaving it in the hotkey table let Tabby push the same key down two paths,
so one press pasted twice (the cause is written up in `docs/DEVELOPMENT.md`).

If you need a literal `Ctrl+V` (0x16, quoted-insert) to reach the terminal app, set `claimCtrlV: false`.
Then neither we nor the hotkey table claim it and xterm passes 0x16 straight to the PTY —
**but `Ctrl+V` paste stops working in that state** (that is the point of the setting).
Paste with `Ctrl+Shift+V` / `Shift+Insert` (Tabby's own) or right-click instead.

### Driving the sidebar from the keyboard

`Ctrl+1`–`Ctrl+9` do **not** walk — they go. Someone pressing a number has already decided where to land. What is counted is the
**tab rows visible in the sidebar**, so group headers are skipped and tabs inside a collapsed group have no number at all. There is
nothing past nine: counting with your eyes gets slower than pressing a key, so use the list walk below.

`Ctrl+L` enters the list. It exists for looking through tabs without the mouse, and the rules are these.

| Key | What it does |
|---|---|
| `↑` `↓` | Move between rows. **The active tab does not change** |
| `Home` `End` | First row / last row |
| `Enter` | On a tab row, switch to it and hand the keys back to the terminal. On a group header, collapse/expand |
| `Esc` | With a search or filter set, **clear that first**. With nothing to clear, leave for the terminal |
| `Tab` `Shift+Tab` | To the search box |
| `Ctrl+W` | Close the focused row's tab (nothing on a group header). Outside the list — in the terminal — it is the active tab |

**Why focus and selection are separate** — if the tab changed on every row you passed, that tab's output would cover
the screen and the terminal width would be re-applied each time, making the display jump. Looking through your tabs
would be impossible. So `↑↓` move only the outline (keyboard focus) and `Enter` is the single thing that opens a tab.

The search box and the list are joined by `↓` (box → first result) and `↑` (first row → box).
`↑` inside the search box is not intercepted — in a single-line input that key moves the cursor to the start,
and you really do use it when fixing a search term.

While focus is not on the sidebar it **intercepts not one key** (the listener is on the list element, so the events
never arrive). If you want it off anyway, `keyboardNav: false`.

`Ctrl+W` is the one exception — it has to be received from the terminal too, so it is caught in the **document capture phase**.
In exchange it only swallows the key **when there is a tab to close**: on a group header, or in a settings input, it flows through.
That is also why it is not in the hotkey table — a Tabby hotkey swallows the key merely by being registered, so turning the
setting off would still kill the terminal's `Ctrl+W` (delete previous word). To keep that key, set
`keyboardCloseTab: false` (`Close tab with Ctrl+W` in the settings window) and list navigation stays.
Closing goes through the same path as the sidebar `✕`, so Tabby asks as usual when a process is still running.

### IME input — keeping a composing syllable from following the cursor

Typing Korean (or any IME language) and pressing `Home`, `End` or `Shift+Enter` used to make **the last composing
syllable follow the cursor to its new position**. Arrow keys were fine, and that difference is the cause — xterm
**commits the composition first** for keys that come through its own key path, but when bytes are written straight
to the pty without that path (terminal hotkeys, our newline), the commit is deferred by a `setTimeout`, so
**the bytes go first and the syllable after**.

So every write to the pty is funnelled through one place, and just before writing it looks at the composition state:

- composing → **wait for composition to end**, then write
- a commit is already scheduled → step back one tick
- state unreadable → just write (this guard must never block normal input)

If composition does not end, it is forced after 0.4 s and written — input not going out at all is the worst outcome.

> **Why wait (0.6.3).** It used to force the commit and write immediately. But even after we forced it, the IME
> announced its own commit on its own schedule, and the syllable went out **again** — that second one landed after
> the newline, so **the character dropped to the next line**. Now the IME's ordering is untouched, so the syllable
> goes out once, before the newline.

Turn it off with `imeOrderGuard: false`.

### Screen repair (`↻`)

Press it when the screen is broken — the statusline gone, the input-box divider cut off mid-screen.
It recalculates width → syncs the pty size → clears **only the input box's remnant** → nudges to deliver a SIGWINCH.
The app redraws the cleared area on its own render cycle.

**It does not erase what you were reading.** It used to send `Ctrl+L` at the end to mean "redraw everything", but
Claude Code takes that as **clear screen** and pushed the whole conversation into the scrollback
(captured 2026-09-11: repairing a healthy screen emptied rows 0–72 of 78 and left only the input box).
So `repairSendRedrawKey` is off by default — what actually fixes things is clearing the remnant and matching the size,
and it works without it. `repairHard: true`, which also empties the scrollback, is off by default too.

## Settings

The **settings window (Settings → AgentDeck)** holds only what you would actually change — layout on/off, resetting a
mouse-dragged arrangement, disabling tab restore on startup, the preview panel (open · path scraping · follow new files),
installing/removing the Claude Code hook, and the working-root profile. The rest live under `agentDeck` in Tabby's
config file (`%APPDATA%\tabby\config.yaml`).

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Sidebar + 4:3 layout on/off |
| `aspectW` / `aspectH` | `4` / `3` | Terminal viewport ratio |
| `sidebarDock` | `right` | Sidebar position `left` / `right` / `top` / `bottom`. Also changed by dragging the header |
| `sidebarWidth` | `0` | Width in px when docked left/right. 0 = derived from the aspect ratio |
| `sidebarHeight` | `200` | Height in px when docked top/bottom |
| `sidebarMin` / `sidebarMax` | `200` / `560` | Range for the derived width (px). For exactly 4:3 on a wide monitor, set `sidebarMax` to `window width − window height × 4/3` |
| `sortByStatus` | `false` | Sort by urgency (waiting → error → rate limited → running → done → idle). Turning it on **blocks drag reordering** — a moved row would snap back on the next render |
| `collapsedGroups` | `[]` | Keys of collapsed groups. Clicking a header adds one here. `Expand all` in the settings window empties it |
| `viewerOpen` | `false` | Whether the preview panel is open. Toggled by `▤` / `agentdeck-view`, or set when **it opens itself on a new file**, and restored on next start. Not a value you set by hand |
| `viewerDock` | `right` | Which side the panel attaches to, `left` / `right`. On the same side as the sidebar, the sidebar takes the outer edge |
| `viewerWidth` | `420` | Panel width in px. Changed by dragging the divider. In a narrow window, capped at `window width − 320 − 140` |
| `searchBox` | `true` | Show the search row in the sidebar. Turning it off also clears any active filter (no hidden filters) |
| `keyboardNav` | `true` | `Ctrl+L` into the list, then `↑↓`/Enter/Esc. Nothing is intercepted while focus is elsewhere, so leaving it on costs nothing |
| `keyboardCloseTab` | `true` | `Ctrl+W` closes a tab — the active one from the terminal, the focused row when the list has the keyboard. Off (or with `keyboardNav` off) `Ctrl+W` goes to the terminal as delete-previous-word |
| `keyboardNavWrap` | `false` | `↑↓` wrap around at the ends. Off, they stop — you can see you are at the bottom and the list does not jump wholesale. End-to-end is Home/End |
| `viewerScrape` | `true` | Pick up file paths printed on screen into the recent list. Off, only drag-drop and typed paths |
| `viewerDropOpen` | `ask` | When a file is dropped on the terminal — `ask` / `always` open in panel / `paste` the path / `never` (stock behaviour) |
| `viewerPreload` | `true` | Keep files the agent touched loaded **even while the panel is closed** (recent chips + what to show on next open). Off, nothing happens automatically. `Preload into the panel` in the settings window |
| `viewerAutoOpen` | `false` | **Open the closed panel by itself** on a new file. Off by default — opening is yours to do, and the contents are kept current by `viewerPreload` above. `Open the panel automatically` in the settings window |
| `viewerFollowMode` | `''` | (old value) Split into the two toggles above in 0.18.0. An `open`/`show`/`manual` left here is migrated once on startup and cleared |
| `viewerFollow` | `true` | (older value) Moved to `viewerFollowMode` in 0.17.0. A `false` is read as `viewerPreload: false` by the migration and reset to the default |
| `viewerRecentMax` | `12` | How many files stay in the recent list |
| `imeOrderGuard` | `true` | Commit a composing syllable before writing bytes to the pty (see "IME input") |
| `releaseHomeEnd` | `true` | Take Home / End out of Tabby's hotkeys and hand them back to xterm's own path |
| `idleAfterMs` | `2500` | No output for this long means `idle` |
| `staleAfterMs` | `300000` | A **hook-pinned `running`** row with no sign of life (hook report, output, working marker) for this long (ms) loses its pin and falls to `idle`. Hooks have no session-end event, so a dead session used to stay "working" forever. `0` turns it off (old behaviour). `waiting` and `limited` are exempt |
| `autoDetect` | `true` | Infer status from output and title patterns |
| `showElapsed` | `true` | Show elapsed time |
| `dragAutoScroll` | `true` | The list scrolls by itself at the edges while dragging. Off, you have to drop, scroll and drag again — but **dropping past the last row stops slipping** |
| `keepRenderingWhenHidden` | `true` | Keep the sidebar updating while the window is covered. Off, a status change can show up to a minute late |
| `subagentCount` | `true` | Show the running subagent count on a row. Nothing is drawn at zero, so leaving it on costs nothing. Off, transcripts are **not read at all** |
| `enterAsLabel` | `true` | Take the input box text as the task label when Enter sends a prompt |
| `labelAsTitle` | `true` | Use the task label instead of the tab title on the sidebar title row. Tabby's own tab title is untouched |
| `noTabRecovery` | `false` | Do not restore previous tabs on startup — forces Tabby's `recoverTabs` to false. Only the shell is restored and the Claude session inside it is dead, so it is meaningless (turn it on in the settings window) |
| `notifyChannel` | `true` | The channel hook reports arrive on (local TCP + status file). Installing the hook turns it on automatically |
| `notifyPort` | `47500` | That TCP port (127.0.0.1 only). If taken, it falls back to a random port and the real number is written to `%LOCALAPPDATA%\tabby-agentdeck\port` |
| `hookPromptDismissed` | `false` | Do not show the hook-install prompt on startup again |
| `claimCtrlV` | `true` | Handle `Ctrl+V` in the capture phase. On startup, `Ctrl-V` is removed from **both** `hotkeys.paste` and `agentdeck-paste` (this is what stops the double paste). `false` sends a literal 0x16 to the app and **paste stops working** |
| `pasteImageWithCtrlV` | `true` | With only an image on the clipboard, send the image-paste key instead of pasting text |
| `imagePasteKey` | `alt-v` | Which key that is. `ctrl-v` (0x16) covers Claude Code and Codex; `alt-v` (ESC v) is Claude Code only |
| `claimRightClick` | `true` | The plugin handles right-click (Tabby's `terminal.rightClick` is set to `off`) |
| `rightClickMenuMs` | `250` | Hold longer than this for the context menu instead of paste |
| `terminalOpacity` | `75` | Terminal background opacity (%). Below 100 lets a `tabby-background` image show through. 100 = stock |
| `sidebarOpacity` | `75` | Sidebar / window margin opacity (%) |
| `clipBackgroundToTerminal` | `true` | Clip the `tabby-background` image to the terminal area so it does not show under the sidebar |
| `screenWatch` | `true` | Judge every two seconds whether the screen is broken and **only record** it to `~/.agentdeck-screen.log` (no repair). Rolls to `.1` past 4 MB |
| `autoRepairScreen` | `false` | Quietly run screen repair when it is judged broken |
| `autoRepairMinStreak` | `2` | Require this many consecutive broken readings before repairing (so a half-drawn frame is not mistaken for one) |
| `autoRepairCooldownMs` | `10000` | Do not repair again for this long after an automatic repair |
| `autoRepairMaxPerTab` | `3` | Maximum automatic repairs per tab. 0 = unlimited |
| `repairHard` | `false` | Screen repair also runs `xterm.reset()` (which clears the scrollback) |
| `repairSendRedrawKey` | `false` | Send `Ctrl+L` at the end of a repair. **Off is the default** — Claude Code takes it as a **screen clear**, not a redraw, and pushes the conversation you were reading into the scrollback (captured 2026-09-11). On, it applies to automatic repairs too |
| `rootProfile` | `false` | Create a working-root profile and make it the default (turn it on in the settings window) |
| `rootProfileName` | `Agent Root` | That profile's name |
| `rootProfileCwd` | `''` | Where new tabs open. Empty means the profile is not created. Write it with forward slashes (e.g. `D:/Project`) |
| `rootProfileCommand` | `powershell.exe` | The shell |
| `rootProfileArgs` | `-NoLogo -ExecutionPolicy Bypass` | Shell arguments. `Bypass` keeps global npm `.ps1` wrappers (`claude` and friends) from being blocked by execution policy — for that session only |
| `rootProfileEnv` | `TERM=xterm-256color`, `COLORTERM=truecolor` | Shell environment variables (only missing ones are filled in) |
| `alertFlash` | `true` | Flash the taskbar icon when a tab moves to `waiting`/`error`/`rate limited` while the window is behind. Stops when the window is focused |
| `alertBadge` | `true` | Draw a badge (circle + number) on the taskbar icon with the count of `waiting` + `error` + `rate limited` tabs. Cleared at zero |
| `alertToast` | `false` | Also raise an OS toast. Clicking it brings the window forward and selects that tab |

## Reporting a problem

**[Open an issue](https://github.com/jghwang2/tabby-agentdeck/issues/new/choose)** — a bug report or a feature request.

Before you write it up, press **Settings → AgentDeck → Report a problem → `collect`**.
It bundles the diagnostics into a single zip and opens the folder it is in, so you can attach that zip to the issue.

What goes in

| File | Contents |
|---|---|
| `report.txt` | Plugin/Tabby/Electron version, OS, settings (docking, aspect ratio, `useConPTY` …), the last 200 diagnostic lines of this session |
| `agentdeck-diag.log` | `~/.agentdeck-diag.log` — session header, batching/input/pty decisions, uncaught exceptions with stacks, swallowed failures (`CATCH …`) |
| `agentdeck-diag.log.1` | The previous rollover (pushed aside past 2 MB) |
| `agentdeck-screen.log` | **Only when "include screen contents" is on.** The terminal screen, verbatim, at the moment it broke |

Worth knowing

- Logs **are not cleared on startup.** They roll one generation to `.1` past 2 MB, so yesterday's problem is usually still there.
- The logs contain **tab titles and the paths of files you opened**. Read it before sending if you like; screen contents are excluded by default.
- Too broken to open the settings window? From the devtools console, `__agentdeck.collectDiag()` builds the same zip and returns its path.
  For just the recent diagnostic lines, `__agentdeck.kickLog`.

## Known issues

### New tabs will not open on Tabby 1.0.235

```
Error: ENOENT, node_modules\node-pty\lib\conpty_console_list_agent not found in ...\resources\app.asar
```

A packaging bug in the Tabby build, unrelated to this plugin. Turning ConPTY off avoids that path.

```yaml
# %APPDATA%\tabby\config.yaml
terminal:
  useConPTY: false
```

## Development

```powershell
npm install
npm run build      # runs tools/sync-version.js first (prebuild)
npm test           # unit tests + Codex regression
npm run typecheck
```

**`version` in `package.json` is the single source of truth** — `package-lock.json` and the four web pages under
`docs/` are derived from it by `tools/sync-version.js`, and `test/version.test.js` fails on drift.
Releases go through one command (`npm run release -- 1.1.4`), which stamps the version, derives, tests, commits and tags.
`test/tags.test.js` checks that every committed version has a matching tag.

Development procedure, architecture, design rationale and the measured pitfalls are in
[`docs/DEVELOPMENT.md`](DEVELOPMENT.md); the regression checklist is in [`docs/REGRESSION.md`](REGRESSION.md);
npm publishing is in [`docs/NPM-PUBLISH.md`](NPM-PUBLISH.md).

## License

MIT
