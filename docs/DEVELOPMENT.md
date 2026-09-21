# 개발 노트 (tabby-agentdeck)

사용자에게 알릴 필요는 없지만 고칠 때 다시 필요한 것들 — 개발 절차, 구조, 검증 도구, 설계 근거, 실측으로 확인한 함정. 사용자용 설명은 `README.md`, 회귀 체크리스트는 `REGRESSION.md`.

## 개발

### 실사용 핫리로드 전 필수 게이트 (2026-09-18)

- 개발 빌드는 실사용 앱이 감시하는 `dist/`에 출력하지 않는다. 별도 staging 디렉터리로 빌드한다. 실사용 설치가 저장소 junction이면 `npm run build`/`watch`도 즉시 핫리로드를 유발하므로 검증 전에 실행하지 않는다.
- `tools/test-instance.ps1 -PluginRoot <staging 경로>`로 빌드 산출물·사용자 데이터·설정이 분리된 격리 앱을 실행한다. 기존 실사용 앱을 종료하거나 테스트 대상으로 사용하지 않는다.
- 변경 동작의 정상·예외 경로를 격리 앱에서 실행하고 실제 DOM/화면·상태 결과를 확인한다. 단위 테스트, 타입 검사, 빌드 성공만으로 UI 테스트 성공을 보고하지 않는다. 필요한 회귀 검사도 통과해야 한다.
- 테스트 결과와 사용한 산출물을 기록한다. 실패·미검증이면 실사용 반영과 핫리로드를 하지 않는다. 통과한 동일 산출물만 실사용 `dist/`에 반영하여 핫리로드한다. 검증 후 재빌드하거나 코드가 달라지면 다시 검증한다.
- 실패·환경 미충족을 보고하고 작업을 종료하지 않는다. 원인과 테스트 환경을 수정하고 재검증하는 루프를 계속 수행하며, 검증 통과 후 실사용 반영·핫리로드와 적용 확인까지 완료한다. 사용자 입력이나 외부 권한 없이는 해결할 수 없는 실제 차단만 명시한다.
- 완료 보고에는 코드 검사와 격리 앱 검증을 구분하고, 실제 반영·핫리로드 여부를 명시한다.

```powershell
npx webpack --mode production --output-path <staging 경로>/dist
```

고친 뒤에는 **`docs/REGRESSION.md` 의 체크리스트를 전부 돌린다.** 한 곳을 고치면 다른 곳이
깨지는 일이 반복됐고, 그것을 끊는 유일한 방법이 매번 전부 재는 것이었다.
그 문서에는 **정상 입력창의 골든 스냅샷**도 들어 있다 — "깨졌다" 를 감으로 판정하지 않기 위해서다.

```bash
node tools/cdp.js 9222 tools/verdict.js          # 모든 pane 판정 + 폭·버튼 순서
node tools/cdp.js 9222 --keys "text:안녕,Enter"   # 진짜 키 이벤트 (sendInput 은 키 경로를 안 탄다)
```

Tabby 를 `--remote-debugging-port=9222` 로 띄우면 CDP 로 내부 상태를 들여다볼 수 있다.
플러그인이 `window.__agentdeck` 에 `app` / `config` / `status` / `relayout()` / `render()` 를 노출한다.

```js
window.__agentdeck.status.debug   // { attached, outputs, oscHits, titleHits }
window.__agentdeck.debug()        // { outputHits, decorator }  이 서비스 쪽 출력 구독이 도는지
window.__agentdeck.agentOf()      // { id, probedAt }  활성 탭의 에이전트 판정 상태
window.__agentdeck.probeAgent()   // TTL 무시하고 지금 다시 판정
window.__agentdeck.openFile(path) // 미리보기 패널에 파일 띄우기
```

## 구조

| 파일 | 역할 |
|---|---|
| `src/index.ts` | NgModule — provider 등록, 서비스 기동 |
| `src/deck.service.ts` | 사이드바 DOM, 4:3 레이아웃, 세션·제목 감시 |
| `src/detect.ts` | 출력·제목에서 상태를 읽어내는 규칙 |
| `src/status.service.ts` | 탭별 상태 보관 |
| `src/decorator.ts` | Tabby 공식 확장점(TerminalDecorator) 경유 출력 구독 |
| `src/profile.service.ts` | 작업 루트 프로필 등록 |
| `src/notify.service.ts` | Claude Code 훅이 남긴 상태 파일을 읽어 탭에 반영 |
| `src/bind.ts` | 훅 보고를 어느 탭에 붙일지 고르는 순수 규칙 (`pickTabByPids` — 훅이 보낸 조상 PID 와 탭 셸 PID 를 맞춘다. 활성 탭 추측은 폐기) |
| `src/screen.ts` | 화면이 깨졌는지 판정하는 순수 함수 (`judgeScreen`) |
| `src/viewPanel.ts` | 결과물 미리보기 패널 — DOM·파일 읽기·감시. 위치와 폭은 `deck.service` 의 relayout 이 정한다 |
| `src/viewer.ts` | 그 패널의 순수 로직 (파일 종류 분류, PTY 출력에서 경로 줍기, 최근 목록 MRU, CSV 파싱) |
| `src/markdown.ts` | 자체 마크다운 렌더러 — HTML 을 우리가 만들므로 새니타이즈가 필요 없다 |
| `src/gitDiff.ts` | `git diff` 유니파이드 출력 파서 (순수) — 파일별 ±카운트·줄번호·헝크 |
| `src/ime.ts` | 한글 조합 상태 판정 (순수) — pty 에 바이트를 써도 되는 시점인지 가른다 |
| `src/agents.ts` | 에이전트 프로필 (순수) — 어느 CLI 인지 알아내고(`identifyAgent`) 그 규칙을 준다. 상태 문구·스피너·이미지 키·입력창 머리글자의 단일 출처 |
| `src/config.ts` | 기본 설정값 |
| `tools/cdp.js` | Tabby 안을 CDP 로 들여다보는 검증 도구 (`--keys` 로 진짜 키 이벤트) |
| `tools/verdict.js` | 모든 pane 의 화면을 판정해 찍는다 |
| `tools/probe.js` | R22~R35 회귀 프로브 (미리보기·`변경` 탭·IME 순서·프로필). 사용법은 `tools/README.md` |
| `docs/REGRESSION.md` | 회귀 체크리스트 + **정상 입력창 골든** |
| `src/hotkeys.ts` | 핫키 선언 |


## 설계 근거

### 왜 작업 이름을 탭 제목이나 훅이 아니라 입력창에서 읽나


- **키 입력이 아니라 화면을 읽는다.** 붙여넣기·↑ 히스토리·자동완성·IME 로 들어온 글자는 키 이벤트로
  안 오거나 원문과 다르다. 화면에 실제로 그려진 것이 곧 보낼 내용이다.
- **Enter 만 잡는다.** Shift+Enter / Ctrl+Enter 는 줄바꿈이라 아직 전송이 아니고, 그때 라벨을 바꾸면
  쓰다 만 문장이 박힌다. IME 조합 확정용 Enter 도 제외한다. 이벤트는 관측만 하고 막지 않는다.
- **머리글자는 앱·버전마다 다르다.** Claude Code 2.1.x 는 테두리 상자 대신 가로선 두 줄 사이에
  `❯`(U+276F) 한 줄을 그린다. `>`(ASCII) 만 찾으면 라벨이 한 번도 안 바뀐다 — `src/prompt.ts` 는
  `> ❯ › ❭ ➜` 를 모두 받고, 같은 꺾쇠를 쓰는 선택지 커서(`❯ 1. Yes`, `❯ No, exit`)는 배제한다.
- 입력창 머리를 못 찾으면(일반 셸, y/n 확인 등) 라벨을 그대로 둔다 — 엉뚱한 문자열이 박히느니 낫다.
- `labelAsTitle`(기본 true)이면 사이드바 제목 줄에 탭 제목 대신 이 라벨이 뜬다.

> **왜 탭 제목을 쓰지 않나.** Claude Code 는 세션의 첫 작업을 요약해 콘솔 제목에 한 번 박고 그 뒤로
> 갱신하지 않는다(2026-08-28 실측 — 작업이 네 번 바뀌는 동안 제목은 `◑ sendInput 한 줄 vs 두 줄 원인 파악`
> 그대로였다). 제목만 보여주면 사이드바가 옛 작업 이름에, 셸이 붙인 엉뚱한 문자열에 박혀 있게 된다.

> **왜 에이전트 훅을 쓰지 않나.** 훅으로 받으면 쓰는 사람이 `~/.claude/settings.json` 을 손봐야 하고
> 플러그인이 그걸 대신 깔아줄 수도 없다. 게다가 훅 경로는 에이전트마다 규약이 다르다.
> 설정이 하나도 없는 상태에서 도는 경로를 기본으로 둔다.


### 화면 복구가 네 단계인 이유

창을 복원→최대화로 흔들어 고치던 것을 대신하며, 네 가지를 순서대로 한다.

1. 사이드바 폭 재계산 → `fitAddon.fit()` → pty 크기 강제 동기화 — **크기 정합**
2. `xterm.reset()` — 옛 폭으로 그려진 **셀 잔상**과 스크롤 영역·속성 같은 터미널 상태를 비운다
3. pty 크기를 한 칸 줄였다 되돌려 **SIGWINCH** 두 번 — 앱이 새 폭을 받아들이게
4. `Ctrl+L`(0x0C) 전송 — 앱에게 **전체 재렌더**를 명시로 지시

> 3번(흔들기)만으로는 안 고쳐지는 경우가 있다(2026-09-01 확인). 흔들기가 푸는 건 "앱이 폭을 잘못
> 알고 있다" 하나뿐인데, 깨진 화면에는 **xterm 셀에 남은 잔상**과 **터미널 상태**가 같이 얹혀 있기
> 때문이다. 앱이 다시 그려도 자기가 쓰는 자리만 덮으므로 옛 프레임의 바깥은 지워지지 않는다.

`repairHard: false` 로 두면 2번을 건너뛴다(스크롤백 보존). `repairSendRedrawKey: false` 면 4번을 건너뛴다.

> `Ctrl+V` 는 플러그인이 기동할 때 `agentdeck-paste` 에 자동으로 넣는다(`claimCtrlV`).
> 동시에 Tabby 순정 `hotkeys.paste` 에서는 `Ctrl-V` 를 **뺀다** — 둘 다 걸려 있으면 한 번 눌러 두 번 붙는다.
>
> **왜 이미지는 `Ctrl+V` 가 아니라 `Alt+V` 였나**: 터미널의 붙여넣기는 "클립보드 *텍스트* 를 키 입력처럼
> PTY 에 써넣는" 동작이다. PTY 는 바이트 스트림이라 이미지가 지나갈 길이 없고, 터미널 안에서 도는 앱은
> OS 클립보드에 손댈 수 없다. Claude Code 는 자기가 클립보드를 직접 읽어서 이 문제를 푸는데,
> `Alt+V` 가 그 "지금 클립보드를 읽어라" 신호다. 즉 두 키는 *붙여넣는 주체* 가 다르다
> (`Ctrl+V` = 터미널이 넣어줌 / `Alt+V` = 앱이 직접 읽음). 사용자가 그걸 구분할 이유는 없으므로
> agentdeck 이 클립보드를 미리 보고 갈라준다. 텍스트가 같이 들어 있으면(엑셀·워드 복사 등) 텍스트를 우선한다.
> config.yaml 을 손으로 고쳐도 되지만, Tabby 는 종료할 때 메모리에 있던 설정을 다시 써서 손댄 값을 되돌린다.
> 대가로 터미널 앱에 리터럴 `Ctrl+V`(0x16, quoted-insert)를 보낼 수 없다 — 필요하면 `claimCtrlV: false`.


### 폭이 정해지는 순서

0. 미리보기 패널이 열려 있으면 **그 폭을 먼저 뗀다** (`viewerWidth`, 아래 참고).
1. 터미널 폭을 `창 높이 × 4/3` 으로 잡는다.
2. 남는 폭을 사이드바에 주되 `sidebarMin`~`sidebarMax` 로 자른다.
3. **그러고도 폭이 남으면 4:3 을 포기하고 터미널이 흡수한다** — 오른쪽에 빈 띠를 남기지 않기 위해서다.

그래서 넓은 모니터에서는 실제 비율이 4:3 보다 옆으로 길어진다.
정확히 4:3 을 원하면 `sidebarMax` 를 `창 너비 − 창 높이 × 4/3` 으로 맞춘다.
예를 들어 2560×1440 창(터미널 높이 약 1370)이라면 `2560 − 1827 ≈ 730`.

```yaml
agentDeck:
  sidebarMax: 730
```

### 미리보기 패널을 열면 4:3 이 완화되는 이유

패널·사이드바·터미널이 한 창을 나눠 쓰는데, 셋 중 하나는 양보해야 한다. 세 가지 안을 놓고
**"패널을 열면 터미널이 좁아진다"** 로 정했다 (2026-09-08 사용자 결정).

- 4:3 을 엄수하면 좁은 창에서는 패널이 열릴 자리가 아예 없다 (1920 창이면 터미널만 1400을 먹는다).
- 오버레이로 띄우면 터미널이 가려져 "옆에 놓고 본다" 가 안 된다.
- 사이드바를 줄이면 세션 목록이 못 읽게 된다.

대신 셋의 최소치는 지킨다 — 패널이 쓸 수 있는 폭은 `창폭 − MIN_TERM_W(320) − MIN_SIDEBAR_W(140)`
까지고(`relayout` 의 `viewRoom`), 사이드바 폭은 패널 몫을 뺀 나머지를 기준으로 계산한다.
울트라와이드에서는 패널을 열어도 터미널이 4:3 을 유지한다 (2560 창 = 1827 + 420 + 300).

**패널 방향도 메모(memo) 비교에 들어가야 한다.** relayout 은 값이 그대로면 DOM 을 건드리지 않는데,
좌↔우만 바뀌면 폭·사이드바·터미널이 전부 그대로여서 조기 return 에 걸려 패널이 옛 자리에 남았다
(2026-09-08 실측: `viewerDock` 을 바꿔도 안 움직였다).

### 왜 마크다운 라이브러리를 안 쓰나

`marked` 를 넣으면 런타임 의존성이 처음으로 생기고(지금은 devDependencies 뿐이다), 그 출력을
`innerHTML` 에 넣으려면 새니타이저가 하나 더 붙는다. 원문 HTML 을 통째로 버리고 **태그를 우리만
붙이면** 그 계층이 사라진다 — 이스케이프를 먼저 하므로 문서 안의 `<script>` 나 `onerror=` 는
태그가 될 기회가 없다(`test/markdown.test.js` 가 고정, 실측으로도 `querySelectorAll('[onerror]')` = 0).
대가는 참조 링크·각주·원문 HTML 미지원인데, 문서를 눈으로 확인하는 자리에서는 문제되지 않는다.

### 조합(IME) 확정과 우리 전송의 순서 — 왜 핫키를 놓아주는 것만으로는 부족했나

xterm 의 조합 확정에는 **동기·비동기 두 경로**가 있다
(`node_modules/tabby-terminal/dist/index.js` 의 CompositionHelper — `grep -n "compositionstart()" ` 로 찾는다):

```js
keydown(t)        → 조합 중이면 _finalizeComposition(false)  // 지금 바로 triggerDataEvent
compositionend()  → _finalizeComposition(true)               // setTimeout(…, 0) 에서 triggerDataEvent
```

방향키가 멀쩡한 이유가 이 표에 다 있다 — 방향키는 xterm 키 경로를 타므로 `keydown()` 이 먼저 동기
확정을 하고 그 뒤에 키를 보낸다. 반대로 **xterm 을 거치지 않고 pty 에 직접 쓰는 경로**
(Tabby 핫키의 `sendInput('\x1b[H')`, 우리 `sendNewline()`)는 그 확정을 트리거하지 않는다.
확정이 `setTimeout` 으로 밀린 사이(`_isSendingComposition === true`) 우리 바이트가 먼저 나가고
음절이 한 틱 뒤에 붙는다 → **음절이 커서를 따라간다.**

0.3.0 의 대책(`releaseHomeEndHotkey`)은 "그 키를 Tabby 핫키에서 빼서 xterm 에게 돌려준다" 였고,
실사용 config 에 반영돼 있는데도(`%APPDATA%\tabby\config.yaml` `home: []` / `end: []`) 재발했다.
그래서 0.5.0 은 키 소유권이 아니라 **쓰기 시점**을 잡는다 — `sendToPane()` 이 pty 직접 쓰기 전부를
받아 `ime.ts` 의 판정으로 갈라 준다(조합 중 → 동기 확정 후 쓰기 / 확정 예약 중 → 한 틱 뒤 / 그 외 → 그냥).

**측정법**: OS IME 는 CDP 로 구동할 수 없지만 xterm 의 조합 처리는 textarea 의 DOM 조합 이벤트에
붙어 있어 `compositionstart`/`compositionupdate`/`compositionend` 를 직접 쏘면 내부 상태를 실제와
같게 만들 수 있다. 그 상태에서 키를 눌러 **`session.write` 로 나간 데이터의 순서**를 보면 판정이 끝난다.
0.5.0 실측 —

| 시나리오 | 0.4.0 | 0.5.0 |
|---|---|---|
| 조합중 + Shift+Enter | `\n` 만 (음절 유실) | `한` → `\n` |
| 확정예약중 + Shift+Enter | `\n` → `글` | `글` → `\n` |
| 조합중/예약중 + Home | `문` → `ESC[H` (정상) | 동일 |
| 조합 없음 + Shift+Enter | `\n` | `\n` (회귀 없음) |

### 0.6.3 — "남은 것" 이 실제 증상이었다: 확정을 재촉하면 음절이 두 번 나간다

0.5.0 은 조합 중이면 **동기 확정을 시키고 바로** 우리 바이트를 썼다(`flush-then-now`). 그때
"IME 가 `compositionend` 를 또 쏘면 한 번 더 보낼 여지가 있다" 를 남은 위험으로만 적어 뒀는데,
그게 사용자가 신고한 그 증상이었다 — **조합 중 Shift+Enter 로 문자가 새 줄로 내려간다.**

기전: 우리가 확정시켜도 IME 는 자기 일정대로 `compositionend` 를 쏜다 → xterm 이
`_finalizeComposition(true)` 로 음절을 **한 번 더** 보낸다 → 그 두 번째가 우리 개행 뒤에 나가
새 줄에 붙는다. 실측(2026-09-08, 실사용 순서로 이벤트 주입): `한` → `ESC[H` → `한`.

그래서 0.6.3 은 **확정을 재촉하지 않는다**(`planSend('composing') === 'after-composition'`).
IME 의 생애주기를 그대로 두고 `compositionend` 를 기다렸다가, 그 안에서 예약된 전송이 나가도록
한 틱 더 양보한 뒤 우리 바이트를 쓴다(`writeAfterComposition`). 음절은 자기 경로로 **한 번만**
나가고 개행은 그 뒤다. 조합이 끝나지 않는 경우(IME 가 이벤트를 안 냄·포커스 이탈)를 위해
`IME_WAIT_MS`(400ms) 뒤에는 동기 확정 후 쓴다 — 입력이 영영 안 나가는 것이 최악이다.

Home/End 쪽 안전판에서도 flush 를 뺐다. 그 키는 이미 핫키에서 놓아줬으므로(0.3.0
`releaseHomeEndHotkey`) xterm 이 방향키와 같은 경로에서 **자기가** 동기 확정을 한다 —
우리가 할 일은 방해하지 않는 것뿐이고, 남길 것은 진단 한 줄이다.

**측정 결과 (0.6.3)** — 조합 → 키 → `compositionend` 순으로 주입하고 pty 로 나간 것을 기록:

| 시나리오 | 순서 | 개행 뒤 음절 | 실제 전송 |
|---|---|---|---|
| 조합중 + Shift+Enter | `한` → `\n` | **없음** | 음절 1회 |
| 조합중 + Home | `글` → `ESC[H` → `글` | 있음 | 2회 |
| 조합중 + ArrowLeft (순정 참조) | `방` → `ESC[D` → `방` | — | 2회 |

Home 의 중복은 **순정 방향키와 완전히 같은 패턴**이다. 방향키는 실사용에서 멀쩡하다는 것이
사용자 실측이므로 그 중복은 하네스가 `compositionend` 를 인위로 쏜 산물이다(아래 함정 참고).
Shift+Enter 만 방향키와 다른 결과 — 우리 대기 경로가 개행을 뒤로 미뤄 중복이 아예 없다.

회귀 R31 은 이 판정을 5케이스로 고정한다: 조합 중에는 개행이 새지 않는다 / 확정예약중에는
음절이 먼저 / Home 순서 / 조합 없을 때 불변 / **개행 뒤에 음절이 붙지 않는다**.

### 에이전트 프로필 — "관측된 값만 좁게 쓴다"

0.6.0 에서 상태 문구·스피너·이미지 키·입력창 머리글자를 `src/agents.ts` 의 프로필로 모았다.
`detect.ts` / `prompt.ts` / `screen.ts` 는 이제 **패턴을 주입받는다**(안 주면 지금까지의 동작):

```
identifyAgent(procNames, title) -> AgentId      // 프로세스 우선, claude 는 맨 뒤(경로에 섞여 나오므로)
detectProfileFor(id)            -> AgentProfile  // 판정용. 실측 없는 프로필은 패턴만 합집합으로
extractPrompt(lines, shape?)                     // PromptShape — heads/choiceWords/ruleChars
judgeScreen(lines, cols, shape?)                 // ScreenShape — ruleChars/heads/choiceWords
```

**핵심 규칙은 `patternsProven`** 이다. 프로필을 붙이는 순간 판정은 그 프로필 안으로 좁아지는데,
관측이 없는 에이전트에서 그건 개선이 아니라 **퇴행**이다 — 0.5.0 은 합집합 하나로 모든 탭을
판정했으므로, Codex 가 실제로 `esc to interrupt` 를 찍고 있었다면 그때는 잡혔다. 그래서
실측이 있는 프로필만 자기 패턴을 쓰고, 나머지는 합집합으로 떨어진다.

**2026-09-08 현재: Claude·Gemini 는 켜져 있고 Codex 는 꺼져 있다.**

| 프로필 | `patternsProven` | 근거 |
|---|---|---|
| Claude | true | 2026-08-28·09-01 실측 (이 리포의 원래 값들) |
| **Gemini** | **true** | 2026-09-08 3국면 실채집 — 제목으로 상태를 말한다(`◇`/`✋`/`✦`), 화면은 `Allow execution of`·`esc to cancel`. 입력창 테두리가 반블록(`▄`/`▀`)이라 shape 를 줬다 |
| Codex | false | 국면① 만 채집됐다. 업데이트된 codex 의 기본 모델이 계정에서 거부되어 작업·승인 화면을 못 만들었다 |

Gemini 에서 배운 것은 **상태 근거가 화면에만 있는 게 아니라는 것**이다. 이 CLI 는 콘솔 제목을
상태 문구로 바꾼다(`◇ Ready` → `✋ Action Required` → `✦ Working…`). 그래서 `busyTitleMarks` 에
`✦` 하나만 넣는다 — `◇`(유휴)나 `✋`(대기)를 넣으면 상시 진행중이 되거나 대기를 덮어쓴다.

**식별은 이름만으로는 안 된다.** npm 전역 래퍼로 띄운 CLI 의 자식 프로세스는 `node.exe` 하나뿐이고
제목에도 이름이 없다(gemini 는 `◇ Ready (work)`). 그래서 `detectAgentApp` 이 **프로세스 이름 →
pid 의 명령줄 → 제목** 3단으로 떨어진다. 명령줄에는 `…/@google/gemini-cli/bundle/gemini.js` 가
그대로 있다. 비용이 있는 호출이라 이름으로 잡히는 경우(claude)에는 아예 돌지 않고, 빈도는
`probeAgent` 의 TTL 이 잡는다.

### 한도 도달·승인 이유 (0.10.0)

`limited`(한도 도달)와 승인 이유는 **훅 전용이었다.** 그래서 훅이 없는 CLI 는 사용량 한도에
걸려도 배지가 `진행중`/`오류` 로 남고, 화면 판정으로 `승인대기` 가 된 탭은 이유가 비어 있어
**어느 탭이 무엇을 기다리는지 사이드바만 보고 알 수 없었다.**

- 한도 문구는 프로필의 새 필드 `limitedPatterns` 에 둔다. 값은 실측한 프로필에만 —
  Codex 는 `Usage limit reached` 계열 2개(2026-09-08 실측), Claude·Gemini 는 빈 배열이다
  (Claude 는 훅 경로로 오고 그 문구는 PTY 화면이 아니다. Gemini 는 미관측).
  합집합이 모든 프로필의 값을 품으므로 `patternsProven: false` 인 codex 도 자기 실측 문구로
  판정된다 — **프로필 규칙을 깨지 않고** 한도만 얻는 배치다.
- 판정 순서는 **대기 > 한도 > busy**. 대기를 앞에 둔 것은 대기 오탐 비용이 가장 크다는 원칙
  그대로고, 한도를 busy 앞에 둔 것은 한도 화면도 상태줄을 계속 다시 그려서 먼저 "진행중" 으로
  읽히면 왜 멈췄는지 알 수 없기 때문이다.
- **한도는 sticky 다** — "출력이 있다 = 진행중" 으로는 풀지 않는다. 그렇게 풀면 배지가 한 조각만
  떴다 사라진다. 대신 풀리는 길을 넷 남겼다: ① 작업중 문구·스피너 복귀 ② **사용자가 새 프롬프트
  Enter**(`releaseLimited`) ③ 훅의 다음 보고 ④ 사이드바에서 직접 지정·unpin. 영구 lock 을 만들지
  않는다는 이 저장소 원칙 그대로다.
- `releaseLimited` 호출은 `claimEnterLabel` 의 keydown 리스너 안에 있는데 **`enterAsLabel`
  가드보다 위**에 둬야 한다. 아래로 내려가면 라벨 기능을 끈 사용자에게는 해제 경로가 통째로
  죽는다 — 한도는 라벨과 무관한 기능이다.
- 이유는 판정 조각 전체가 아니라 **줄 단위**로 다시 찾아 뽑고, 축약은 기존 `reason.ts` 를
  재사용한다(사본을 만들지 않는다). 선택지 줄(`● 1. Allow once`)은 **빈 이유**로 규정했다 —
  화살표로 커서만 옮긴 재그리기 조각이 그 줄만 담고 오는 경우가 있어서, 그러지 않으면 배지에
  `1. Allow once` 가 박힌다.
- **상태가 바뀔 때는 빈 이유라도 덮어쓴다.** `waiting`·`limited` 둘 다 이유를 표시하는 상태라,
  그냥 두면 `Bash 권한` 이 한도 배지에 남아 "지금 승인 대기" 로 읽힌다.
- 알림(`alert.service.ts` 의 `ALERT_STATUSES`)에 `limited` 가 있어 이제 화면 판정만으로도 울린다.
  오탐 경로는 사용자가 그 문구를 스스로 출력하는 경우(로그 grep 등) 하나뿐이고, 그때도 새 프롬프트
  Enter 로 풀리므로 그대로 뒀다.

이미지 키는 반대다 — **실측이 있으므로** 프로필 값을 그대로 쓴다(Claude=`ESC v`, Codex=`0x16`).
Gemini 는 이것만 아직 관측이 없어 `'config'`(사용자 설정 폴백) 로 두었다. 격리 환경에서는
클립보드에 이미지를 넣을 수 없어서(R6·IN6) 사용자 실사용만이 판정한다.

## 구현하며 부딪힌 것들

- **캐시에 "빈 값" 을 넣고 TTL 을 걸면 그 탭은 영영 모른다.** `touchCwd` 는 작업 폴더를 3초
  TTL 로 캐시하는데, 첫 조회가 `null` 로 끝나도 그 빈 값에 TTL 을 걸고 있었다. 출력이 계속
  흐르는 탭은 3초 뒤 재시도되지만, **아무것도 찍지 않는 탭은 재시도 계기가 없다** — 열어 두고
  안 쓰는 셸이 영영 `기타` 그룹에 남았다(2026-09-09 실측: 탭 둘을 연달아 열면 먼저 연 쪽이
  25초 뒤에도 `dir: null`). TTL 은 **이미 아는 값**에만 걸어야 한다. 그리고 값이 늦게 도착하면
  `scheduleRender()` 를 불러야 한다 — 캐시만 바꾸면 다음 상태 변화 때까지 옛 그룹이 보인다.

- **드롭을 가로챌 때 `defaultPrevented` 는 우리 개입의 증거가 아니다.** 순정 Tabby 도 파일
  드롭을 처리하려면 `preventDefault` 를 하므로, 우리가 손을 뗀 `never` 모드에서도 그 값은
  true 다. "우리가 개입했는가" 는 **우리 UI 가 떴는가 + 상태가 바뀌었는가** 로 판정한다.

- **직접 `xterm.write` 로 그린 화면은 pty 쪽 앱이 지운다.** 화면 판정 검증은 우리가 테두리를
  직접 그려 "깨진 화면" 을 만드는데, 그 사이 SIGWINCH 가 한 번 가면(우리 `nudgePtyRedraw` 가
  `resize(cols-1)` → 원복으로 두 번 낸다) pty 쪽 앱이 절대 좌표로 프롬프트를 다시 그리며 우리
  줄을 덮는다. **고정 대기 후 1회 샘플링**하면 그 창에 겹쳐 "만들지 못했다" 가 된다 — PR8 이
  그래서 흔들렸다. `debug().outputHits` 가 조용해진 뒤 주입하고, 판정은 폴링 + 재주입으로 한다.
  같은 이유로 주입은 **화면 맨 아래**에 해야 한다: 제품의 잔상 지우기는 하단 16행만 훑으므로
  위쪽에 그리면 그 단계가 조용히 no-op 이 되어 검증이 앱의 Ctrl+L 처리에 얹혀 통과한다.

- **회귀 러너가 빌드를 안 하면 낡은 `dist/` 를 잰다.** 프로브는 실행 중인 번들을 보는데
  플러그인은 junction 으로 `dist/` 를 로드한다 — 소스만 고치고 러너를 돌리면 **고친 것이 화면에
  닿지 않은 채 판정된다**. 2026-09-08 에 이걸로 두 번 헛돌았다("고쳤는데 그대로 FAIL").
  `run-all.ps1` 0) 단계에 `npm run build` 를 넣고, 실패하면 거기서 멈추게 했다(B0).
  `tsc --noEmit` 은 타입만 보므로 대체가 되지 않는다.

- **"n 번째 줄 = n 번째 탭" 을 가정하면 안 된다.** 사이드바 순서는 `sortByStatus` 와
  그룹핑으로 바뀐다. 회귀 프로브가 `sidebar().querySelector('.ad-badge')` 로 첫 배지를 집고
  `app.tabs[0]` 의 것이라 믿었더니, 그룹핑이 `기타`(cwd 미상) 그룹을 맨 뒤로 밀면서
  다른 탭의 `● 진행중` 을 읽어 R16·R19 가 거짓 실패했다. 지금은 `renderTab` 이 각 줄에
  `data-ad-index` 를 남기고 프로브가 그것으로 대상 줄을 찾는다(R41).

- **헤더를 안 그리기로 했으면 순서도 건드리지 않는다.** 위 사고의 반대쪽 절반은 제품 결함이었다.
  그룹이 하나뿐이면 헤더를 생략하는데, 그때도 `groupTabs` 의 정렬(`기타` 를 맨 뒤로)은 적용되고
  있었다. 구분선이 없는 화면에서 순서만 바뀌면 사용자는 이유를 알 수 없고 순정 탭바와의 대응도
  깨진다 — `render()` 가 `withHeads === false` 일 때 원래 순서의 평면 목록을 그린다.

- **"설정을 꺼도 도는 정리" 가 다 갭인 것은 아니다.** `ensurePasteHotkey` 가 `claimCtrlV` 와
  무관하게 순정 `paste` 에서 Ctrl-V 를 걷어내는 것을 갭으로 보고 게이트를 넣었다가 **되돌렸다**.
  그 설정의 목적은 리터럴 `0x16`(quoted-insert)을 앱에 흘리는 것인데, 핫키에 Ctrl-V 가 남으면
  HotkeysService 가 붙여넣기를 먼저 발화해 **0x16 이 PTY 에 영영 닿지 않는다** — 게이트를 넣는
  순간 그 설정이 아무 일도 못 하게 된다. 꺼둔 상태의 붙여넣기는 순정 `Ctrl+Shift+V`·`Shift+Insert`·
  우클릭이라고 README `키` 절이 이미 규정하고 있었다. 되돌려도 잃는 것은 없다: 다시 켜면
  붙여넣기는 캡처 경로가 처리하므로 핫키가 비어 있어도 Ctrl+V 가 동작한다.
  교훈은 **"이상해 보이는 무조건 실행"을 고치기 전에 그 설정이 무엇을 위해 있는지 문서에서
  먼저 확인** 하는 것이다. 지금은 그 이유가 코드 주석과 IN10 에 잠겨 있다.

- **탭은 래퍼에 싸여 있다.** `app.tabs` 의 원소는 `SplitTabComponent` 이고 터미널은 그 자식이다.
  상태 키를 정규화하지 않으면 자식에 쓰고 부모를 읽어 영영 매칭되지 않는다.
- **래퍼가 자식보다 먼저 목록에 들어온다.** 한 번 훑고 "감시 완료" 로 표시하면 빈 래퍼만 잡고 끝난다.
  pane 은 호출될 때마다 다시 훑는다.
- **`HotkeysService` 는 `HotkeyProvider` 들을 주입받는다.** provider 생성자에서 그것을 다시 주입하면
  순환 의존으로 부분 초기화된 인스턴스가 넘어온다(`Cannot read properties of undefined`). 핫키 구독은 다른 서비스에서.
- **CSS 로만 폭을 바꾸면 pty 가 따라오지 않을 수 있다.** Tabby 의 xterm 은 `attach()` **맨 끝**에서야
  `ResizeObserver` 를 건다(`tabby-terminal/dist/index.js:40979`). 그 앞에는 `await` 가 여러 개 있어서,
  탭이 붙는 도중(`tabOpened$`/`tabsChanged$`)에 `.content.main` 폭을 바꾸면 그 변경이 아무에게도 관측되지 않고
  유실된다. 결과: xterm 은 넓은데 pty 는 옛 폭 그대로 → Claude Code 같은 전체화면 TUI 가 화면보다 좁게 그리고
  오른쪽에 지워지지 않은 옛 프레임이 박혀 있다. 창을 복원→최대화로 흔들면 OS 리사이즈 경로를 타서 즉시 복구된다
  (2026-08-28 실측). 그래서 `relayout()` 은 폭이 바뀔 때마다, 그리고 `frontendReady$` 때
  `frontend.fitAddon.fit()` 을 직접 호출한다. 숨겨진 탭은 컨테이너 폭이 0 이라 건너뛴다.

- **입력창 머리글자를 `>` 로 가정한 것이 라벨이 안 바뀌던 진짜 원인이다.** 앞서 "화면 아래 14줄만
  읽어서" 로 진단해 스캔 기준을 커서 줄로 옮겼는데도 증상이 그대로였다. 실제 원인은 정규식 —
  Claude Code 2.1.252 의 입력창은 `❯`(U+276F) 로 시작해서 `/^>\s*/` 에 절대 걸리지 않았다.
  CDP 로 읽은 xterm 버퍼 원문이 증거다(2026-09-01):
  `"────────…"`, `"❯ "`, `"────────…"`, `"  ⏵⏵ auto mode on (shift+tab to cycle)"`.
  같은 실수를 반복하지 않으려면 `readPromptLine` 이 빈손일 때 남기는
  `enter-label miss ... tail=` 진단 라인(커서 주변 4줄 원문)을 먼저 볼 것 —
  "버퍼를 못 읽음" 과 "머리를 못 찾음" 을 이 줄 하나로 가른다.

- **`session.resize()` 는 보냈다고 도착한 것이 아니다 — 이것이 "입력창 깨짐" 의 진짜 원인이었다.**
  세션이 막 열린 직후의 resize 는 pty 에 닿지 못하고 유실된다. 2026-09-01 실측:
  `size fix 254x78 -> 280x78` + `pty resize` + `redraw nudge` 가 모두 돌고 `pane.size` 에도
  280 이 남았는데, 같은 탭 셸에 물어보니 `PTYW=254 xtermCols=280` 이었다. 같은 호출을 몇 초 뒤에
  CDP 로 하면 그때는 정상 반영된다 — 초기화 경합이다.
  그런데 `pane.size` 에 **낙관적으로** 280 을 적어 두므로 크기 감시(`watchSize`)는 "이제 맞다" 고
  보고 손을 뗀다. 그 뒤에 뜨는 Claude Code 는 254 폭으로 첫 화면을 그리고, 오른쪽 26칸에는
  옛 프레임(`Try "how do I …"` 힌트)이 남는다. 이것이 사용자가 본 그 화면이다.
  고친 방법은 두 겹 —
  ① `syncPtySize` 가 크기를 고친 뒤 **같은 값을 150/400/900/1800/3000ms 에 다시 보낸다**
     (pty 가 이미 그 크기면 SIGWINCH 도 안 나므로 무해하다). 이것으로 첫 화면부터 정상이 됐다.
  ② 그래도 새는 경우를 위해 **화면 자체를 판정**해(`screen.ts`) 깨졌으면 조용히 복구한다.
     원인이 무엇이든 결과를 보고 고치므로, 원인 하나를 쫓다 다른 것이 깨지는 일이 없다.

- **`pane.size` 를 pty 의 진짜 폭으로 믿으면 안 된다.** 그건 우리가 보낸 값을 적어 둔 메모다.
  진짜 폭은 셸에 직접 묻는다 (`[Console]::WindowWidth`). claude 가 돌고 있어 물을 수 없을 때는
  **TUI 가 그린 테두리 길이**가 곧 TUI 가 아는 폭이다.

- **정상 화면에도 `❯` 는 여러 개 보인다.** Claude Code 는 지난 사용자 프롬프트를 `❯ 내가 보낸 말`
  로 이력에 남기고 큐에 쌓인 메시지도 같은 모양으로 나열한다. 화면 전체의 머리 수를 세는 판정은
  오탐이다 (실측 `heads=7` 로 자동 복구가 2초마다 헛돌았다) — 테두리 사이 구간에서만 센다.

- **래퍼 탭이 자식보다 먼저 목록에 들어오면 그 탭은 영영 감시 밖에 남는다.**
  `watchTab` 이 `panes=0` 을 보고 물러나면 자식이 붙어도 다시 훑을 계기가 없다. 2026-09-01 실측:
  기동 직후 첫 탭에서 `watchTab panes=0` 만 두 번 찍히고 `session bind` 가 한 번도 없었다 —
  그 탭에서는 상태 감지·Enter 라벨·화면 검사가 전부 돌지 않았다. 비어 있으면 잠시 뒤 다시 본다.

- **훅 보고를 "처음 보고할 때의 활성 탭" 에 묶는 규칙은 끝난 세션의 done 을 새 탭에 박는다 (0.2.1 에서 폐기).**
  못 묶은 보고를 400ms 파일 폴링이 계속 재시도하므로, 사용자가 새 탭을 여는 순간 그 빈 탭을 붙잡는다.
  2026-09-02 실측: 17:52 에 끝난 세션의 done 이 17:55 에 열린 탭에 "완료" 로 찍히고, 그 탭의 진짜 세션이 보낸
  running 은 "주인 있는 탭" 이라며 버려졌다 — status json 은 running 인데 사이드바만 완료였다.
  지금은 훅(`agentdeck-notify.ps1`)이 자기 조상 PID(`claude.exe → 탭 셸 → Tabby.exe`)를 `pids` 로 보내고,
  플러그인이 탭별 `session.pty.getPID()` 와 맞춰 확정한다(`src/bind.ts`). 안 맞으면 추측 없이 다음 폴링을 기다린다.
  `Win32_Process` 전체 조회가 ~450ms 라 세션당 한 번만 계산해 status json 에 캐시한다(홉별 필터 조회는 ~2초).

- **훅 보고는 탭 셸에 심은 `AGENTDECK_TAB` 으로 탭에 직결한다 — 계보(PID)는 폴백이다 (0.2.2).**
  플러그인이 새 탭의 `pane.profile.options.env` 에 `AGENTDECK_TAB=<12 hex>` 를 넣어 두면(`src/tabenv.ts`,
  `notify.service.ts` `stampRoot`) 그 셸에서 뜬 claude 와 훅이 환경을 물려받는다. 훅은 `$env:AGENTDECK_TAB` 을
  `tabId` 로 보내고 `Win32_Process` 조회를 통째로 건너뛰며, 플러그인은 `tabIds` 표(패널의 `profile.options.env` 를
  매 폴링마다 다시 읽는다)에서 바로 찾는다. 심는 자리의 근거(tabby 1.0.231 dist):
  `AppService.openNewTab` 은 `wrapAndAddTab` 에서 `splitTab.addTab(tab)` 의 동기 구간(자식을 `children` 에
  splice, `tabby-core/dist/index.js:2618`)을 지난 뒤 `addTabRaw` 가 `tabOpened.next(splitTab)` 를 낸다(5029) —
  이때 `getAllTabs()` 에 자식이 있고 `session` 은 null 이다. 셸은 그 뒤 `onFrontendReady -> initializeSession` 이
  `session.start({ ...this.profile.options, width, height })` 로 띄우고(`tabby-local/dist/index.js:623-635`),
  자식 env 는 `mergeEnv(process.env, {TERM_PROGRAM…}, substituteEnv(options.env), terminal.environment)` 다(1158-1162).
  `ngOnInit` 의 `sessionOptions = profile.options`(605) 는 spawn 에 쓰이지 않는다. `tab.profile` 은
  `getNewTabParameters` 가 deep clone 한 객체(898)지만 그래도 탭마다 다시 복제해 넣어 저장 프로필을 건드리지 않는다.
  분할로 나중에 붙는 패널은 루트의 `tabAdded$`(`onAfterTabAdded` 의 setImmediate, 2935-2939)에서 심는다.
  복제 탭(`duplicateTab`)과 재시작 복원 탭은 tabOpened 시점에 자식이 없고 `_recoveredState` 토큰만 있다 —
  자식은 `ngAfterViewInit -> recoverContainer` 가 비동기로 만들고(2488-2491, 3093) `tabAdded` 도 내지 않으므로
  토큰의 `profile` 을 직접 고친다: `restoreFromPTYID` 가 없는 잎(복제, `tabsService.duplicate` 는 options 없이
  토큰을 만든다 7819-7830)은 새 id, 있는 잎(재시작 복원, `saveTabs` 의 includeState)은 지난 실행의 id 를 그대로
  둔다 — 살아 있는 pty 의 환경이 그 값이고, 복원이 실패해도 같은 options 로 새 셸이 뜬다.
  같은 id 가 두 루트에 보이면 둘 다 표에서 빼고 계보 폴백에 맡긴다(추측 금지).

- **승인대기에서 진행중으로 돌아올 훅이 없었다 — 승인 자체는 훅 이벤트가 아니다 (0.3.0).**
  Claude Code 훅은 PreToolUse → (권한 대화상자 → Notification `permission_prompt`) → 도구 실행 → PostToolUse 순이라
  "사람이 승인했다" 는 순간에 발화하는 이벤트가 없다. 0.2.2 까지는 UserPromptSubmit/Notification/Stop 만 걸어
  승인 뒤에도 Stop(완료)까지 승인대기가 유지됐다 (2026-09-07 사용자 실측). 지금은 두 겹이다 —
  ① 훅: PostToolUse / PostToolUseFailure / PermissionDenied 를 `-Status running` 으로 추가 (`src/claudeHooks.ts` PLAN).
  스크립트는 직전 상태가 이미 running 이면 파일도 TCP 도 건드리지 않고 끝내므로(계보 조회 전에 `exit 0`) 도구마다 도는 비용은 powershell 기동뿐이다.
  ② 화면: `승인대기` 인 탭에 `esc to interrupt` 류 작업 중 문구가 보이면 `WorkStatusService.resume()` 으로 올린다 (`detect.ts`).
  ①만으로는 승인 뒤 도구가 **끝날 때까지**(긴 빌드) 승인대기가 남기 때문이다. pinned 는 유지하고 waiting 이 아니면 아무것도 안 한다.
  제목 스피너(BUSY_MARKS)는 근거로 쓰지 않는다 — 대화상자가 떠 있는 동안에도 제목에 남을 수 있다.

- **한도 도달(`limited`)은 `StopFailure` 훅의 `error: rate_limit` 로 받는다 (0.3.0).**
  사용량 한도(429 `You've hit your session limit · resets 12pm (Asia/Seoul)`)에 걸리면 Claude Code 는 Stop 대신
  `StopFailure` 를 쏘고 입력 JSON 에 `error`(rate_limit / overloaded / server_error / authentication_failed /
  max_output_tokens …, 2.1.263 exe 문자열에서 확인)와 `last_assistant_message`(화면 문구)를 싣는다. Notification 훅에는
  한도 유형이 없다(`permission_prompt`·`idle_prompt`·`auth_success`·`elicitation_dialog` 등만). 훅은 `-Status error` 로
  걸되 스크립트가 `hook_event_name == StopFailure` 이면 error 코드를 보고 rate_limit → `limited`, 그 밖 → `error` 로 가른다
  (이벤트 하나에 matcher 두 개를 거는 대신). 부연은 limited 면 `last_assistant_message` 를 실어 `reason.ts` 가 리셋 시각만 남기고(`12pm 리셋`),
  그 밖의 오류는 코드만 싣는다(`✖ 오류 · overloaded`).
  화면 문구로 한도를 잡지는 않는다 — 화면 복구(Ctrl+L)·리사이즈 때 옛 프레임이 다시 출력돼 지난 한도 문구를 또 읽는 오탐이 있다.
  `-p` 모드에서도 훅이 돌아 `claude -p hi --model bogus` 로 StopFailure(model_not_found → error) 발화를 실물 확인했다.

- **한글 조합 중의 Shift+Enter 는 Shift 가 지워진 Enter 로 도착한다 (0.3.0).**
  사용자 체감 "50% 는 그냥 enter 로 들어가 메시지가 전송된다". 증거는 `.agentdeck-diag.log` —
  오발신 순간 `enter-label text="지금도 그랬"` 이 찍혔는데, 그 핸들러는 수식키가 하나라도 눌려 있으면
  맨 앞에서 빠져나간다. 즉 그 Enter 의 `shiftKey` 가 false 였다. Shift 가 없으니 `Shift-Enter` 핫키에
  매칭될 리 없고 xterm 이 0x0D 를 그대로 PTY 에 흘린다. 핫키 경로 자체도 이 용도로는 약하다 —
  `tabby-core` `matchActiveHotkey(partial=true)` 는 단일 키스트로크 시퀀스에서 `lastIndex > 0` 이
  성립하지 않아 xterm 쪽 swallow 가 안 걸릴 수 있다.
  해결 = `claimShiftEnterKey()` (Ctrl+V 와 같은 document 캡처 방식). 이벤트의 수식키를 믿지 않고
  Shift 눌림을 직접 세고(`shiftDownAt`, 5s staleness + blur/평문키 자가복구), 조합 중(`isComposing`/229)
  Enter 는 건너뛴다 — 확정 뒤 Enter 가 한 번 더 오고 그때 잡아야 글자 순서가 안 어긋난다.
  검증(CDP 실키 주입, 2026-09-08): `text:world,Shift-Enter,Ctrl-Enter` → `sendInput=["world","0a","0a"]`,
  xterm 경로에는 `0d` 없음. 맨 Enter 는 `0d` 그대로 통과(회귀 없음). **IME 조합 경로는 CDP 로
  OS IME 를 구동할 수 없어 실측 못 했다** — `tracked` 폴백은 미검증이다.

- **Tabby 핫키로 가로챈 키는 IME 조합 확정 경로를 통째로 건너뛴다 — Home/End 가 그 예다 (0.3.0).**
  증상: 한글 마지막 음절이 조합 중일 때 Home/End 를 누르면 그 음절이 커서를 따라간다. 방향키는 멀쩡하다.
  차이가 곧 원인 — 방향키는 핫키가 아니라 xterm 키 경로를 타고, 거기서 `CompositionHelper.keydown` 이
  `_finalizeComposition(false)` 로 조합을 **동기 전송**한 뒤 키를 보낸다(`tabby-terminal/dist/index.js:44098`, `:44120`).
  Home/End 는 Tabby 가 `hotkeys.home`/`end` 로 선점해 `tabby-local/dist/index.js:613` 의 `sendInput('[H')` 가
  즉시 나간다. xterm 을 안 거치니 조합 확정이 `compositionend` 경로로 밀리는데 그쪽
  `_finalizeComposition(true)` 는 `setTimeout(..., 0)` **비동기**다(`:44110`). 커서 이동 먼저, 음절이 한 틱 뒤.
  해결 = 핸들러를 얹는 게 아니라 **핫키를 놓아주는 것**. `releaseHomeEndHotkey()` 가 기동 시
  `hotkeys.home`/`end` 에서 Home/End 를 뺀다(`agentDeck.releaseHomeEnd`). 검증: 격리 인스턴스 기동 후
  `config.store.hotkeys` 가 `home: [] / end: []`.

- **`package.json` 에 `author` 가 없으면 플러그인이 조용히 로드되지 않는다.**
  Tabby 의 `parsePluginInfo` 가 `author.name` 을 읽다가 예외를 삼킨다.

- **PTY 출력에서 경로를 주울 때 꼬리를 길게 남기면 최근 목록이 흔들린다 (0.4.0).**
  조각(chunk)이 경계에서 잘려 경로가 반토막 나는 것을 막으려고 직전 버퍼의 끝 256자를 남겼는데,
  그 꼬리에 든 경로가 다음 훑기에서 **또** 잡혀 최근 목록의 맨 앞으로 올라왔다. 증상은
  "따라가기(viewerFollow)를 켜면 새로 만든 파일 대신 직전 파일이 다시 뜬다" (2026-09-08 실측:
  `follow2.md` 를 만들었는데 `pic.png` 가 떴다). 경로는 줄바꿈을 넘지 못하므로 **마지막 줄의
  미완성 부분만** 남기면 재판독이 사라진다. 더해서 따라가기의 대상은 "처음 본 파일"로 좁혔다 —
  TUI 가 화면을 다시 그릴 때 옛 경로가 또 잡히는데, 그걸 열면 방금 만든 파일을 덮기 때문이다.

- **`data:` URL 로 넣은 이미지는 innerHTML 직후에 `naturalWidth` 가 0 이다.**
  디코드가 비동기라서다. "이미지가 안 뜬다(CSP?)" 로 오판하기 쉽다 — `load` 이벤트를 기다려 재봐야
  한다(실측: 기다리면 `64x64`, 바로 재면 `0x0`). Tabby 렌더러에서 `data:image/*` 자체는 막히지 않는다.

- **`getWorkingDirectory()` 는 셸의 `cd` 를 따라오지 않는다 (Windows 로컬 세션, 0.5.0 실측).**
  `변경` 탭이 저장소를 못 찾아 헤맬 때 처음 의심할 곳이다. 탭에서 `cd D:\Project\tabby-agentdeck` 을
  실행하고 5초를 기다려도 패널은 **탭이 열릴 때의 cwd** 를 계속 봤다(테스트 프로필 cwd = `…\work`).
  그래서 `cwdFor` 는 "탭이 태어난 폴더" 로 읽어야 맞고, 다른 저장소를 보려면 그 폴더에서 새 탭을 연다.
  덤으로 밟은 함정 — **`git` 은 상위로 올라가며 저장소를 찾는다.** 홈 디렉토리(`C:\Users\<나>`)에
  `.git` 이 있으면 아무 폴더에서나 그 저장소가 잡혀 "변경 없음 + 추적 안 됨 69개" 처럼 보인다.
  실측에서 정확히 이걸 먼저 만났고, 저장소 판별은 `rev-parse --show-toplevel` 로 확인해야 한다.

- **CDP 로 IME 를 흉내낼 때 `compositionend` 를 직접 쏘면 음절이 두 번 나간다 — 도구의 문제다.**
  동기 확정(`keydown`)이 이미 텍스트를 보냈는데 이어서 `compositionend` 를 쏘면 xterm 이 비동기
  경로로 한 번 더 보낸다. 하네스에서 **방향키(순정 경로)도 똑같이 두 번** 나오는 것이 그 증거다.
  실사용에서 방향키는 멀쩡하므로 그 중복은 하네스 산물이다 — 순서만 보고 개수는 방향키와 대조할 것.

- **에이전트 판정은 "출력이 흐를 때" 도 다시 해야 한다 (0.6.0 실측).**
  처음 배선은 `session-bind` 와 `제목 변경` 두 시점만 조회했다. 그런데 가장 흔한 흐름이
  **셸을 먼저 열고 나중에 `claude` 를 치는 것**이고, 그때 제목이 안 바뀌면 첫 조회의 `unknown` 이
  영영 굳는다(자식 프로세스가 `codex.exe` 인데 진단은 `id=unknown` 이었다). 그래서 출력 구독에
  "아직 unknown 인 탭만" 조회를 한 줄 더 걸었다 — TTL(10초)이 빈도를 막고, 한 번 알아낸 탭은
  이 갈래를 타지 않는다. `getChildProcesses()` 는 OS 호출이라 출력마다 부르면 안 된다.

- **진단 로그를 "값이 바뀔 때만" 찍으면 "조회가 돌았는지" 를 가릴 수 없다.**
  위 구멍을 쫓는 동안 `agent tab=... id=unknown` 한 줄만 보고 세 번 헛짚었다. 조회는 돌았지만
  결과가 그대로여서 로그가 안 남은 경우와, 조회 자체가 안 돈 경우가 **로그상 구별되지 않는다.**
  그래서 `__agentdeck.agentOf()` / `probeAgent()` / `debug()` 를 열어 두었다 — `probedAt` 이
  올라갔는지로 "조회는 돌았다" 를, `outputHits` 로 "우리 출력 구독이 실제로 도는지" 를 가른다.
  후자가 중요한 이유: `decorator.ts` 도 같은 `output$` 를 구독하므로 상태 감지가 정상으로 보여도
  이 서비스 쪽 구독은 안 돌고 있을 수 있다.

- **`tools/fakebox.js` 는 타이핑을 에코하지 않는다 — Enter 라벨은 이걸로 검증할 수 없다.**
  0.6.0 에서 `prompt.ts` 를 재작성한 뒤 라벨이 비어 나와 회귀로 오판할 뻔했다. 진단이 갈랐다:
  `enter-label miss ... tail="" | "------" | "(head)"` — 골든 구조는 화면에 있는데 머리 줄이
  비어 있으니 타이핑이 앱까지 가지 않은 것이다. 라벨 경로는 **화면 글자**를 읽으므로, 검증은
  xterm 버퍼에 프레임을 직접 그려서 한다(앱이 그리는 것과 같은 조건) — `xterm.write()` 로
  `ESC[2K` + 가로선 / `ESC[2K` + 머리글자와 문장 / `ESC[2K` + 가로선 을 쓰고 `--keys Enter`.
  **줄 지우기(`ESC[2K`)를 빼면** 옛 프레임 잔여가 같은 행에 남아 라벨 끝에 붙는다
  (실측: 문장 뒤에 `tab to cycle)` 가 붙어 나왔다). 실제 앱은 프레임마다 줄을 지운다.

- **소스에 리터럴 NUL(0x00)이 박히면 파일이 "바이너리" 로 취급된다.**
  0.6.0 에서 정규식 dedupe 키의 구분자를 이스케이프 없이 원문으로 써서 `agents.ts` 가 그렇게 됐다
  (`grep` 이 `Binary file matches` 만 내놓아 코드를 읽을 수 없었다). 동작에는 문제가 없지만
  diff·grep·리뷰가 통째로 막히므로 **유니코드 이스케이프로 적는다.**

- **개행은 이 리포가 CRLF/LF 혼재다. 그리고 `grep -c` 로 CR 를 세면 안 된다 — 거짓말한다.**
  Git Bash 에서 `grep -c $'\r$'` 는 **모든 줄에 매칭**돼 LF 파일도 "전부 CRLF" 로 보고한다.
  0.6.0 라운드에서 이걸 믿고 "전 파일 100% CRLF" 라고 두 번 단정했고, 서브에이전트 둘이 각자
  "일부는 LF" 라고 보고한 것을 **오측이라고 이 문서에 적기까지 했다**. 틀린 쪽은 검산한 나였다.
  바이트로 세면 갈린다:

  ```bash
  python -c "d=open(F,'rb').read(); c=d.count(b'\r\n'); print('CRLF',c,'LF',d.count(b'\n')-c)"
  ```

  실측(0.6.0 시점): `deck.service.ts`·`agents.ts`·`ime.ts`·`status.service.ts`·`tools/cdp.js`·
  `test/detect.test.js` 등은 CRLF, `detect.ts`·`prompt.ts`·`screen.ts`·`viewPanel.ts`·`config.ts`·
  `gitDiff.ts`·`README.md` 등은 LF. `core.autocrlf=false`, `.gitattributes` 없음, BOM 없음.
  **파일을 고칠 때는 그 파일의 현재 개행을 따른다** — 뒤집으면 diff 가 전 파일 변경으로 떠서
  리뷰가 불가능해진다. `git diff --stat` 의 줄 수가 곧 판별기다(실제로 `REGRESSION.md` 에
  CRLF 줄을 섞어 넣었다가 이 방법으로 발견해 되돌렸다).

- **`window.__agentdeck` 을 통째로 재할당하면 다른 서비스의 진단구가 조용히 사라진다.**
  `deck.service` 가 `ready$` 뒤에 `__agentdeck = {...}` 로 새 객체를 만들었는데, `notify.service` 는
  `init()` 즉시 자기 것을 붙인다 — 그래서 `tabIds` 가 지워져 R18 이 "진단구가 없다" 로 판정됐다
  (2026-09-08). `alert.service` 는 자기도 `ready$` 안에서 붙어 **우연히** 살아남았을 뿐이다.
  지금은 `Object.assign(g.__agentdeck ?? {}, {...})` 로 합친다. 붙이는 쪽도 `?? {}` 를 쓸 것.

- **PowerShell `($x | Where-Object {…}).Count` 조합이 어긋난 값을 냈다.**
  전수 러너 요약이 `total 37` 인데 `PASS 36 + SKIP 4 = 40` 으로 보고됐다(2026-09-08).
  세는 방법을 파이프라인에 맡기지 말고 `foreach` 로 직접 세면 맞는다. 요약이 틀리면 리포트
  전체를 못 믿으므로, 집계는 가장 단순한 방법으로 쓴다.
