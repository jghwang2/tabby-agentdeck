# Changelog

Released entries have a `vX.Y.Z` tag in this repository; unreleased entries are marked explicitly.
The tag points at the commit that first introduced that version, and `test/tags.test.js` keeps that true.

Korean release notes for the current version are at the top of [`docs/REFERENCE.ko.md`](docs/REFERENCE.ko.md).

## 1.3.0 — 2026-10-30

- Reduce Windows hook startup overhead with a dedicated Claude/Codex notification executable, preserving durable offline delivery and UTF-8 context responses.
- Detect hook updates and ask before applying them. On acceptance, clean up recognized historical AgentDeck registrations and install current hooks in one backed-up transaction. Hook history ships with the package; no remote history lookup is required.
- Preserve user hooks, custom registrations and original Claude status lines. Show only AgentDeck hooks in the hook viewer, with dark code panels and clearer installation/removal controls.
- Preserve session aliases across windows. Release reservations after 24 hours without a new hook, and recover the prior alias when that session returns if it is still available.
- Add account usage refresh and remove redundant availability and refresh-success messages.

**한국어**

- Windows에서 Claude·Codex 알림 훅을 전용 실행 파일로 전달해 시작 비용을 줄였습니다. 전송 실패 시 보관·재처리와 한글·이모지 문맥 응답을 유지합니다.
- 훅 변경을 감지하면 적용 여부를 묻습니다. 동의하면 과거 AgentDeck 등록을 이력으로 정리한 뒤 새 훅을 설치하며, 백업과 실패 시 복구를 함께 처리합니다. 훅 이력은 패키지에 포함되므로 외부 조회가 필요 없습니다.
- 사용자 훅·직접 수정한 등록·기존 Claude 상태줄을 보존합니다. 훅 보기에는 AgentDeck 항목만 표시하고, 코드 배경을 어둡게 바꾸고 설치·제거 버튼을 정리했습니다.
- 여러 창에서 세션 별명을 서로 보존합니다. 24시간 새 훅이 없으면 별명 예약을 정리하고, 같은 세션이 돌아오면 사용 가능한 기존 별명을 우선 복원합니다.
- 계정 사용량 새로고침을 추가하고, 사용 가능·갱신 성공 등 불필요한 문구를 숨겼습니다.

## 1.2.13 — 2026-10-28

- Fix Claude conversation resume after account switching, including returning to a previously used account and transferring subagent history.
- Wait for the previous process to exit before transferring its final history. Stop on conflicting histories and restore the original account terminal if transfer fails after shutdown.
- Apply Claude statusLine and hook installation changes to saved accounts while preserving user settings and each account's original statusLine.

**한국어**

- Claude 계정 전환 후 대화를 이어받지 못하는 문제를 수정했습니다. 이전 계정으로 돌아갈 때 추가된 대화와 하위 에이전트 기록도 전달합니다.
- 이전 프로세스가 종료된 뒤 마지막 기록까지 전달합니다. 기록이 충돌하면 전환을 중단하고, 종료 후 전달에 실패하면 원래 계정의 터미널을 복원합니다.
- Claude 상태줄·훅 설치와 해제를 저장 계정에도 반영하며, 사용자 설정과 계정별 기존 상태줄을 보존합니다.

## 1.2.12 — 2026-10-23

- Keep tab icons and session identity attached to the registered parent CLI when it launches another CLI. Reuse tab/session and native subagent identities without adding process enumeration to hook handling.
- Fix account switching in existing Windows tabs when global terminal environment settings override the selected account directory.
- Preserve the actual reported account and usage together, show account-switch mismatches, and discard potentially misattributed usage caches.
- Resume history with its original Claude/Codex CLI using the default login environment. Show all non-hidden history, including archived Codex sessions, without moving or migrating session files.
- Add recurring regression gates for hook count, command/context length, execution time and zero process creation during parent authorization.

**한국어**

- 부모 CLI 안에서 다른 CLI를 실행해도 탭 아이콘과 세션 연결은 부모를 유지합니다. 기존 탭·세션·서브에이전트 정보를 재사용하며 훅 처리에 프로세스 전체 조회를 추가하지 않습니다.
- Windows 기존 탭에서 계정을 전환할 때 전역 터미널 환경 설정 때문에 선택한 계정 경로가 누락되는 문제를 수정했습니다.
- 실제 보고된 계정과 사용량을 함께 유지하고 전환 대상과 다르면 경고합니다. 잘못 연결됐을 수 있는 사용량 캐시는 다시 수집합니다.
- 지난 세션은 원래 Claude/Codex CLI와 기본 로그인 환경으로 엽니다. 숨기지 않은 기록과 Codex 보관 기록을 모두 표시하며, 세션 파일을 이동하거나 마이그레이션하지 않습니다.
- 훅 개수·명령 및 안내 길이·실행 시간과 부모 판별 중 프로세스 생성 여부를 매번 회귀 검사합니다.

## 1.2.11 — 2026-10-22

- Process tab-bound hook state, subagent activity, metadata and mailbox context directly in the local receiver.
- Separate independent event queues and clean up receipts asynchronously to reduce delays during subagent bursts.
- Register new Claude and Codex hooks with a single Node transport process; keep existing PowerShell registrations compatible. External process ancestry still uses the legacy worker.
- Keep default hook context short as pending messages grow; empty tool-completion hooks emit no context. Concurrent process startup can still exceed one second under load.
- Fix missing Korean text during composition and duplicate text from the IME start key.

**한국어**

- 탭에 연결된 훅의 상태·서브에이전트 활동·메타 정보·메시지 안내를 로컬 수신기 안에서 직접 처리합니다.
- 독립된 이벤트의 대기열을 분리하고 오래된 처리 기록을 비동기로 정리해 서브에이전트가 몰릴 때의 지연을 줄였습니다.
- 새 Claude·Codex 훅은 Node 전달기 하나로 등록합니다. 기존 PowerShell 등록은 계속 호환되며, 외부 프로세스 계보 확인에는 기존 작업자가 남습니다.
- 메시지가 쌓여도 기본 훅 안내는 짧게 유지하며, 메시지가 없는 도구 완료 훅은 안내를 출력하지 않습니다. 동시 프로세스 시작 비용 때문에 부하 상황에서는 여전히 1초를 넘을 수 있습니다.
- 한글 조합 중 글자 누락과 IME 시작 키로 인한 중복 전송을 수정했습니다.

## 1.2.10 — 2026-10-22

- Add a setting to enable or disable cross-session communication without disabling agent status reporting.
- Reduce default hook context to a short on-demand mailbox command; emit no communication context when disabled.
- Move hook processing into the receiver, with durable queuing, duplicate detection and protection against stale events.
- Preserve existing Claude and Codex hook registration commands and the user's original Claude status line.
- Stop repeatedly checking hook registration while settings remain open.

**한국어**

- 에이전트 상태 보고는 유지하면서 탭간 통신을 켜고 끌 수 있습니다.
- 기본 훅 안내를 필요할 때 메시지를 조회하는 짧은 명령으로 줄이고, 통신을 끄면 안내를 출력하지 않습니다.
- 훅 내부 처리를 수신기로 옮기고 이벤트 보관·재처리·중복 방지·오래된 상태 덮어쓰기 방지를 적용했습니다.
- 기존 Claude·Codex 훅 등록 명령과 사용자의 Claude 상태줄 명령을 유지합니다.
- 설정창을 열어 둔 동안 훅 등록 상태를 반복 검사하지 않습니다.

## 1.2.9 — 2026-10-19

- Preserve committed Korean text when a fast Enter, space or cursor key arrives before the IME commit timer, including consecutive syllables.
- Improve Codex mouse-wheel speed and follow terminal scroll sensitivity in the transcript view.
- Preserve fullscreen terminal state and mouse, paste and focus modes when reloading a live session.
- Release expired session history, closed-tab references and unused transcript tracking to reduce retained memory.
- Recover missing or resumed subagent activity, avoid duplicate counts and reconcile activity after missed notifications or reloads. Exclude agents from the display after 15 minutes without activity reports; new activity restores them.
- Expand the user guides and automatically publish release notes after npm publication.

**한국어**

- 한글을 빠르게 입력한 뒤 공백·Enter·방향키를 누르면 확정한 글자가 누락되던 문제를 수정했습니다. 여러 음절을 연달아 확정하는 경우도 보완했습니다.
- Codex의 마우스 휠 스크롤 속도를 개선하고, 대화 기록 보기에서 터미널의 스크롤 감도를 따르도록 했습니다.
- 화면을 다시 불러온 뒤에도 전체 화면과 마우스·붙여넣기·포커스 입력 모드가 유지되도록 수정했습니다.
- 오래된 세션 이력과 종료된 탭 정보를 정리해 불필요한 메모리 누적을 줄였습니다.
- 서브에이전트 활동 표시의 누락·중복을 수정하고 알림 누락이나 리로드 후 자동 복구를 보강했습니다. 15분 동안 활동 알림이 없으면 표시에서 제외하고, 다시 활동하면 복귀합니다.
- 사용 설명서를 보강하고 npm 배포 후 패치노트가 자동 게시되도록 개선했습니다.

## 1.2.8 — 2026-10-15

- Track scheduled tasks separately for each tab; remove fired one-shot tasks and confirm closing tabs with pending work.
- Edit tab titles, aliases, task names, status and scheduled counts in one dialog with Save and Cancel.
- Remove the nine-tab creation limit while keeping numeric navigation shortcuts 1–9.
- Include updater scripts in staged packages and reject incomplete test installations.
- Reuse the lowest available alias number after a tab closes while preserving open tab names through recovery.

## 1.2.7 — 2026-10-14

- Keep retired settings hidden in every language; fix leaked Korean controls and a literal HTML comment terminator in the settings screen (#1, thanks @ZYZ666-RGB).
- Support messaging and replies by session ID for agents running in external terminals.

## 1.2.6 — 2026-10-01

- Preserve original tab titles and show permanent job aliases before status badges.
- Discover project names locally and keep assigned aliases unique and unchanged.
- Follow visible tab order for numeric shortcuts and preserve identities when dragging.
- Resolve messaging targets from live alias-to-session mappings.
- Check for updates immediately when AgentDeck starts.

## 1.2.5 — 2026-09-30

- Restore full-width Windows title-bar dragging without administrator privileges.
- Save multiple work root profiles and choose when opening a tab; open directly
  when only one root is configured.
- Notify idle recipient tabs of queued messages while deferring during work,
  typing and IME composition; keep delivery separate from acknowledgement.
- Treat npm stderr warnings as successful updates when the process exits with 0.
- Drain mailbox responses within the hook deadline and select one Node executable
  when PATH contains multiple installations.
- Expand regression coverage, translations and usage documentation.

## 1.2.4 — 2026-09-30

- Stop launching Codex every minute for account checks. Refresh credentials only
  near expiry and stop automatic checks after five minutes of failures until a
  successful new login, for both Codex and Claude.
- Block Git network access in the temporary Codex authentication helper to avoid
  repeated marketplace downloads and disk consumption.
- Bound mailbox hook execution time so stalled or trickling responses cannot
  hold up the agent's tool hooks.

## 1.2.3 — 2026-09-30

- Keep sidebar click targets alive during status updates so mouse tab switching
  and close buttons work reliably.
- Introduce fixed tab numbers and cross-session messaging in English and Korean
  READMEs, website feature cards, and package descriptions, including setup,
  slot reuse, and delivery acknowledgements.
- Add real Chromium mouse regression coverage and isolate repair measurements
  from tab-selection redraws.

## 1.2.2 — 2026-09-27

- Stabilize Windows Codex screen repair with row-only redraw, duplicate-request
  suppression and guards against stale work reaching replacement sessions.
- Prevent duplicate session resumes while a tab starts; release pending state
  and subscriptions after startup failure, session replacement or tab closure.
- Improve named account management, account verification and CLI discovery when
  Tabby inherits an outdated Windows PATH.
- Add configurable storage locations, runtime migration and Windows environment
  synchronization; protect private account files and populated templates.
- Improve prompt-time session context, mailbox access without MCP, Codex queued
  question shortcuts, approval detection, hook diagnostics and performance.
- Display the installed version in the sidebar. Expand isolated regression
  coverage, including real clipboard attachment and live Claude session navigation.
- Keep PowerShell hook status and diagnostics in the same runtime folder as Node
  when Windows supplies a short (8.3) profile path.

## 1.2.0 — 2026-09-17

- **Shortcuts are editable in the settings window.** Settings → AgentDeck → *Shortcuts* lists the keys
  from the front page; press *Change*, then the key. If Tabby itself or AgentDeck already uses it you are
  told **what it clashes with** and can pick again or take the key over (it is removed from the other
  binding). Names come from every hotkey provider, so stock Tabby actions are named, not just ours.
- **Screen repair is `Ctrl+Shift+R`** (was `Ctrl+Shift+U`). It replaces Tabby's own `rename-tab` the way
  new-tab replaces `Ctrl+Shift+T` — rename by double-clicking the sidebar row. A saved `Ctrl-Shift-U`
  (the old default, untouched) is migrated; `claimRepairKey: false` undoes the takeover.
- **`Ctrl+Shift+Q` closes the focused split pane.** Tabby ships `close-pane` unbound; on startup it is
  filled from `closePaneKey` while empty. Split side by side / top-bottom (`Ctrl+Shift+S` / `D`) are listed
  alongside it.
- The front page (README, npm) is now a full-window screenshot plus the shortcut table; the long
  document moved to `docs/REFERENCE.md` (Korean: `docs/REFERENCE.ko.md`).
- **Stale hook pins expire.** A hook-reported status is pinned so auto-detection cannot overwrite it,
  but hooks have no "session ended" event — Ctrl+C, closing the window or a CLI crash used to leave a
  row stuck on `running` forever. The pin now expires after `staleAfterMs` (5 min default) of no
  hook report, no output and no working marker. `waiting` and `limited` are exempt.
- **`Ctrl+1` … `Ctrl+9` jump to the Nth session in sidebar order** — not the tab bar order that
  Tabby's own `Alt+1…` uses, which differs once sorting, grouping or search is on.
- Guide screenshots are generated by a script, so they can be rebuilt with one command.
- Release builds no longer ship a source map.

## 1.1.3 — 2026-09-14

- Improved the Codex status-notification hook, and session resume/fork handling.
- Fixed cursor display for Codex on Windows, `Shift+Enter` newline, and scrolling the transcript with the mouse wheel.
- Codex detection now survives a child process changing the console title, and recovers by checking the current
  input box, status line and running processes.
- The test run covers the existing suite and the Codex regression suite together.

## 1.1.2 — 2026-09-11

- The updater waits only on **its own instance's PID**. Counting Tabby processes by name meant one other
  open window could block updates indefinitely.

## 1.1.1 — 2026-09-11

- Auto-update: closes Tabby, installs, and starts itself back up. Development installs (a link to a source tree)
  are detected and left untouched.

## 1.1.0 — 2026-09-11

- **Resume a past session.** Closed Claude Code sessions are listed by the prompt you actually typed, and reopen
  with `claude --resume` in their own working folder.
- Version handling unified — `package.json` became the single source and everything else is derived from it.

## 0.17.0 — 2026-09-10

- The preview panel is opened and closed by the user, not by itself. What used to be one follow-mode became
  separate `preload` and `auto-open` toggles.

## 0.16.0 — 2026-09-10

- The status hook is exercised for real in tests; pure modules got their own test path; temp-folder leftovers cleaned up.

## 0.15.0 — 2026-09-10

- Fixed a row-width defect in top/bottom docking that had been there since 0.1.0.

## 0.14.0 — 2026-09-09

- The list scrolls by itself when you hold a dragged row at its edge, so off-screen positions are reachable in one gesture.
- New settings surfaced in the settings window.

## 0.13.0 — 2026-09-09

- Keyboard control for the sidebar (`Ctrl+Shift+L`).
- Subagent count on a row (`❖3`).

## 0.12.0 — 2026-09-09

- Drag to reorder, with Tabby's own tab order following.
- A search result inside a collapsed group opens it temporarily.

## 0.11.0 — 2026-09-09

- Regression suite down to zero failures; isolated logs separated; `file:line` reference finished.

## 0.10.0 — 2026-09-09

- Rate-limited state and approval reasons judged from screen text, so they work without a hook.

## 0.9.0 — 2026-09-09

- Gemini CLI support, verified against the real thing.
- Multi-group regression coverage, and a confirmation step when dropping a file on the terminal.

## 0.8.0 — 2026-09-08

- **Session groups** by project.
- **Stage and commit** from the `Changes` tab.

## 0.7.0 — 2026-09-08

- Regression coverage widened from 37 to 74 items.

## 0.6.3 — 2026-09-08

- Fixed a character dropping onto the next line when `Shift+Enter` was pressed mid-composition.

## 0.6.2 — 2026-09-08

- The full regression suite (R1–R37) runs from one command.

## 0.6.1 — 2026-09-08

- Agent profile wiring completed, plus a regression probe (`tools/probe.js`).

## 0.6.0 — 2026-09-08

- **Agent profiles** (Claude Code · Codex · Gemini) — detection rules gathered into one place.

## 0.5.0 — 2026-09-08

- **`Changes` tab** showing the working tree's `git diff`.
- IME composition ordering fixed when writing to the pty.

## 0.4.0 — 2026-09-08

- **Preview panel** — markdown, images, tables and code.

## 0.3.0 — 2026-09-08

- **Rate-limited status**, and returning to `running` after an approval.
- Fixed Korean IME behaviour with `Shift+Enter`, `Home` and `End`.

## 0.2.2 — 2026-09-02

- Removed the UAC/elevation-related code, tooling and documentation.

## 0.2.1 — 2026-09-02

- Hook reports are matched to a tab by process ancestry (PID). Guessing the active tab is gone —
  it made every restored session pile onto one tab.

## 0.2.0 — 2026-09-02

- First npm publish.

## 0.1.0 — 2026-09-02

- Initial shape: 4:3 terminal, session sidebar, status detection.
