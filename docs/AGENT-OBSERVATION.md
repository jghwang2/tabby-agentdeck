# 에이전트 관측 절차 — Codex·Gemini 의 `patternsProven` 을 켜는 법

**격리 인스턴스에서 그 CLI 를 한 번 띄우고 `tools/probe-agent-observe.js` 를 세 번(유휴 / 작업중 /
승인대기) 돌리면 프로필에 넣을 값이 원문으로 채집된다.** 이 문서는 그 3단계와, 채집값이
`src/agents.ts` 의 어느 필드로 가는지, 값을 넣은 뒤 무엇을 같이 고쳐야 하는지를 적는다.

값을 여기서 **미리 채워 두지 않았다** — 관측 없이 채우면 이 프로젝트가 막으려는 그 퇴행을
스스로 저지르는 것이다(아래 "왜 필요한가"). 마지막 절의 빈 표가 채집값을 붙여 넣는 자리다.

## 왜 필요한가

`src/agents.ts` 의 프로필에는 **실측된 값만 좁게 쓴다**는 규칙이 있고, 그 스위치가
`patternsProven`(`src/agents.ts:58`~`:70`)이다. false 면 상태 판정에 그 프로필 대신
**합집합**의 화면 문구가 쓰인다(`src/agents.ts:273` `detectProfileFor`,
`src/deck.service.ts:1719` `profileForTab`).

왜 그런가 — 프로필을 붙이는 순간 판정은 그 프로필 안으로 좁아진다. 관측이 없는 에이전트에서
그건 개선이 아니라 **퇴행**이다. 0.5.0 은 합집합 하나로 모든 탭을 판정했으니, Codex 가 실제로
`esc to interrupt` 를 찍고 있었다면 그때는 잡혔는데 프로필을 붙인 0.6.0 은 놓치게 된다
(`docs/DEVELOPMENT.md:231`, `docs/ORCHESTRATION.md:74`).

지금 남아 있는 갭:

| 프로필 | 실측된 것 | `근거 미확인` |
|---|---|---|
| `claude` (`agents.ts:99`) | 화면 문구·제목 스피너 9종(`:126`, 2026-08-28)·이미지 키 `ESC v`(`:132`, 2026-08-28)·머리글자 `❯`(`:134`, 2026-09-01) | — (`patternsProven: true`) |
| `codex` (`agents.ts:152`) | 이미지 키 `0x16`(2026-08-28)·프로세스/제목에 `codex` | 대기 문구 · 작업중 문구 · 제목 스피너 · 입력창 모양 |
| `gemini` (`agents.ts:177`) | **없음** (힌트 `gemini` 뿐) | 위 전부 + 이미지 키 |

## 준비

```powershell
powershell -ExecutionPolicy Bypass -File tools/test-instance.ps1     # 격리 인스턴스 (port 9222)
```

그 안의 `TestPS` 탭 프롬프트에서 **직접 띄운다** (작업 폴더는 빈
`%LOCALAPPDATA%\tabby-agentdeck-test\work` — `tools/test-instance.ps1:41`):

```
codex        # 또는 gemini
```

- **config 에 전용 프로필을 넣지 않는다.** `test-instance.ps1` 은 기동마다 `config.yaml` 을
  새로 쓰므로(`:31`, `:63`) 손으로 넣은 프로필은 다음 기동에 사라진다. 셸에서 직접 띄우는 쪽이
  오히려 실사용에 가깝다 — "셸을 먼저 열고 나중에 에이전트를 띄운 탭" 이 출력 기반 재판정
  경로(`src/deck.service.ts:963`, TTL 10초)를 그대로 태운다.
- **자율/yolo 모드로 띄우지 말 것.** 중첩 세션이 스스로 명령을 실행한 사고가 있었다
  (`tools/run-claude-test.cmd:3`, 2026-09-02). 승인 프롬프트를 봐야 하므로 애초에 승인 모드가 맞다.
- 계정·토큰이 실제로 쓰인다. 아래 절차는 **명령 하나**로 세 국면을 다 만든다.

### 실사용 Tabby 에서 하면 안 되는 이유

1. 프로브 AO8 이 판정을 강제로 바꾸려고 **탭 제목을 잠깐 위조**한다(원복하지만, 실사용 탭이
   흔들릴 이유가 없다).
2. 진단 로그는 `~/.agentdeck-diag.log` **한 개를 공유하고, 기동해도 비워지지 않는다**
   (2MB 를 넘길 때 `.1` 로 밀린다 — `src/diag.ts`). 세션 경계는 `===== agentdeck session <ISO> =====`
   머리말로 가른다. 그래도 실사용 인스턴스와 동시에 띄우면
   두 프로세스의 줄이 섞여 AO8 의 근거 대조가 흐려진다 — 관측하는 동안은 실사용 Tabby 를
   내려 두는 편이 정확하다.
3. 격리 인스턴스는 `ud` 폴더를 매번 새로 만들어(`tools/test-instance.ps1:28`) 지난 실행의 탭을
   되살리지 않는다. 매번 같은 초기 상태에서 채집된다.

## 절차 — 세 국면에서 각각 프로브

에이전트를 띄운 뒤, 그 탭이 **활성 탭인 상태로** 아래를 돌린다(프로브는 활성 탭의 첫 pane 을 본다).

```bash
mkdir -p /tmp/observe    # 또는 %TEMP%\agentdeck-observe
node tools/cdp.js 9222 tools/probe-agent-observe.js > /tmp/observe/codex-1-idle.json
```

| 국면 | 만드는 방법 | 파일명 |
|---|---|---|
| ① 유휴 | 에이전트를 띄우고 아무것도 시키지 않은 상태 | `<agent>-1-idle.json` |
| ② 작업중 | 아래 명령을 시키고 **승인한 뒤** 도는 동안 | `<agent>-2-busy.json` |
| ③ 승인대기 | 아래 명령을 시키고 **승인 프롬프트가 떠 있는 동안** | `<agent>-3-waiting.json` |
| ④ 한도 도달 | **만들 수 없다** — 계정 사용량을 일부러 소진해야 한다. 우연히 만나면 그 화면에서 프로브를 돌려 둘 것 | `<agent>-4-limited.json` |

②③ 를 만드는 명령은 하나로 족하다 — 승인이 필요하고 오래 도는 것:

```
ping -n 30 127.0.0.1 을 실행해줘
```

승인 프롬프트가 뜬 상태에서 프로브를 돌리면 ③, 승인하고 도는 동안 돌리면 ②다.
**프로브는 3초 이상 걸린다**(AO4 가 제목을 300ms×10 표본한다) — 국면이 그 동안 유지돼야 하므로
`ping -n 30`(30초)처럼 여유 있는 명령을 쓴다. 짧은 명령이면 ② 표본이 유휴와 섞인다.

세 국면을 다 뜨면 `codex` 를 종료하고 `gemini` 로 같은 것을 반복한다.

## 읽는 법 — 채집값이 가는 자리

| 프로브 항목 | evidence 키 | 가는 필드 (`src/agents.ts`) | 고르는 규칙 |
|---|---|---|---|
| AO1 | `panes[].procs` | `processHints` | 실행 파일 이름 조각을 소문자로. **경로 조각을 넣지 말 것** — `claude` 가 `~/.claude/...` 로 섞여 나오는 그 문제 때문에 판정 순서가 있다(`agents.ts:194` `MATCH_ORDER`) |
| AO1 | `panes[].title` / `customTitle` | `titleHints` | 제목은 셸이 아무 문자열이나 넣으므로 **보조 근거**다. 프로세스에서 잡히면 그것만으로 충분 |
| AO3 | `candidates` (국면③ ∖ 국면①) | `waitingPatterns` | 승인 프롬프트에만 있고 유휴에는 없는 줄. **차집합을 반드시 취한다** |
| AO3 | `candidates` (국면② ∖ 국면①) | `busyPatterns` | 작업 중에만 뜨고 끝나면 사라지는 줄 (아래 주의 참조) |
| AO4 | `varying` | `busyTitleMarks` | 표본마다 바뀌는 비ASCII 문자만. 국면① 표본에도 있으면 고정 장식이므로 제외 |
| AO5 | `heads` 중 `inDefault:false` | `promptHeads` + `promptShape.heads` | 코드포인트로 확인해 옮긴다(`esc` 값을 그대로 쓰면 리터럴 사고를 피한다) |
| AO5 | `rules` 중 `inDefault:false` | `promptShape.ruleChars` / `screenShape.ruleChars` | `screenShape` 쪽에 ASCII `-` 를 넣지 말 것 — 화면 전체를 훑기 때문에 코드·마크다운의 `-----` 이 테두리로 세어져 오탐이 쏟아진다(`src/screen.ts:77`) |
| AO3 | `choice-cursor` 트리거가 붙은 줄 | `promptShape.choiceWords` | `Yes`/`No` 가 아닌 언어를 쓰면 그 단어. 번호 목록(`1.`)은 앱과 무관하게 이미 배제된다(`src/prompt.ts:153`) |
| AO6 | `profiles[].imagePasteKey` | `imagePasteKey` | **프로브로 판정 못 한다** — 사용자 실사용만 (아래 "판정 불가") |
| AO3 | `candidates` (국면④ ∖ 국면①) | `limitedPatterns` | **국면④ = 사용량 한도**. 한도 화면에만 뜨는 짧은 조각을 잡는다. 안내문 뒷토막(`Increase your limits`)·`■` 접두·`limit`/`usage` 단독은 **넣지 말 것** — 앞의 둘은 다른 오류 화면에도 붙고 뒤는 아무 로그에나 걸린다 |

값이 안 나온 필드는 **빈 배열로 남긴다.** 없는 것을 채우는 것이 이 문서가 막으려는 그 실수다.
제목이 아예 안 변하는 에이전트라면 `busyTitleMarks: []` 가 정답이다.

### 정규식으로 만들 때의 주의

- **그 국면에만 있는 조각을 짧게 잡는다.** `applyOutput` 은 누적 버퍼가 아니라 **출력 조각
  하나**(`data`)에 `test` 한다(`src/detect.ts:66`). 긴 문구는 청크 경계나 화면 폭에서 갈려
  영영 안 맞을 수 있다. Claude 값이 `/esc to interrupt/i` 처럼 짧은 이유다.
- **가변 구간에는 상한을 준다.** `/\btokens?\b.{0,20}\besc\b/i`(`agents.ts:120`) — `.*` 로 열어두면
  화면 아무 곳의 `esc` 와 붙어 상시 매칭된다.
- **선택지 커서는 묶어서.** `/❯\s*1\.\s*Yes/`(`agents.ts:107`) — 머리글자만 보면 평시 입력창과
  구별되지 않는다.
- **금지 예**: `/\?/` · `/\benter\b/i` 단독 · `/y/i`. 힌트 줄(`? for shortcuts`)과 상태줄에 상시
  존재해서 탭이 영구 "승인대기" 로 박힌다. 판정 우선순위가 `대기 > busy`(`src/detect.ts:66`~`:88`)라
  대기 오탐의 비용이 가장 크다.
- **`busyPatterns` 는 끝나면 사라지는 문구여야 한다**(`src/detect.ts:112`). 항상 있는 상태줄
  문구를 넣으면 진행중에서 내려오지 못한다 — Claude Code 가 유휴에도 상태줄을 매초 다시 그려서
  "출력이 있다 = 진행중" 갈래를 막아 둔 것이 그 사고다(`src/detect.ts:90`, 2026-09-01 실측).
- **제목 스피너를 대기 판정에 쓰지 말 것.** 승인 대화상자가 떠 있는 동안에도 제목에 남을 수
  있어서 승인→진행중 복귀 판정이 그것을 근거로 삼지 않는다(`src/detect.ts:75`).
- 화면 문구는 버전마다 대소문자가 바뀐다 — `i` 플래그를 기본으로 둔다.

## 켜는 법

1. 아래 빈 표에 국면별 채집값을 붙여 넣는다(원문 그대로. 그게 근거다).
2. `src/agents.ts` 의 해당 프로필에 값을 넣고 **근거 주석**을 값과 함께 적는다 —
   날짜 · 국면 · 프로브 파일명. (`claude` 프로필의 주석이 그 형식이다: `agents.ts:124`, `:128`)
3. 그 프로필의 `patternsProven` 을 `true` 로 올린다 (`agents.ts:166` codex / `:188` gemini).
4. **`test/agents.test.js` 를 같은 변경에서 고친다 (필수).** 그 파일은 codex/gemini 의 판정
   패턴이 **합집합과 같은 배열 객체인지**를 동일성(`===`)으로 못 박고 있어서, 플래그를 켜면
   아래가 전부 뒤집힌다:

   | 줄 | 지금 기대 | 켠 뒤 |
   |---|---|---|
   | `test/agents.test.js:123`~`:125` | codex 3필드 `=== union` | 프로필 자기 배열이어야 한다 |
   | `:126` | gemini `busyPatterns === union` | 같음 (gemini 를 켤 때) |
   | `:128`~`:129` | codex 판정이 `esc to interrupt` 를 잡는다 | 실측 문구로 갈아야 한다 |
   | `:130`~`:131` | codex 판정이 Claude 스피너 `◐` 를 잡는다 | 실측 스피너로 갈거나 케이스 삭제 |
   | `:164`~`:165` | `patternsProven=false` 면 shape 를 떨어뜨린다 | 켠 프로필은 shape 를 갖는다 |
   | `:167` | `faked.patternsProven === false` | 켠 프로필로는 성립하지 않는다 — 아직 false 인 다른 프로필로 바꾼다 |

   그리고 **새 케이스를 넣는다**: ① 국면 채집 원문이 그 프로필 패턴에 실제로 매칭되는지
   (`re.test('<채집한 원문 한 줄>')`) ② 합집합이 여전히 그 프로필을 품는지(`:84`~`:91` 형태 —
   합집합이 좁아지면 프로필 없는 탭의 판정이 나빠진다).

   > 참고 — **합집합의 원소 수를 못 박은 케이스는 없다.** `:93`~`:96` 은 중복 여부만 본다
   > (`new Set(...).size === length`). 갱신이 필요한 고정 수치는 `:63`
   > `AGENT_PROFILES.length === 3` 하나이고, 그건 새 에이전트를 **추가**할 때만 해당한다.
5. `npm test` → `powershell -File tools/run-all.ps1` (전수).
6. `docs/REGRESSION.md:125`(R33)와 `docs/DEVELOPMENT.md:231`~`:237` 의 서술은 그 시점에
   사실과 달라진다. 그 두 문서 갱신은 **배리어에서 메인이** 한다.

## 판정 불가로 남는 것

| 무엇 | 왜 |
|---|---|
| **이미지 붙여넣기 키의 실제 반응** | 클립보드에 이미지가 들어 있어야 관측되는데, 격리 환경에서는 `clipboard.writeImage()` 뒤 `readImage().isEmpty()` 가 true 다(`tools/README.md:82`, R6·IN6 선례). 사용자가 실사용에서 이미지를 복사해 붙여넣고 `~/.agentdeck-diag.log` 의 `paste image app=… via=… mode=… bytes=…` 줄(`src/deck.service.ts:1623`)과 실제 삽입 여부를 대조하는 것이 유일한 판정이다 |
| **"스피너를 안 쓴다" 의 증명** | 3초 표본에 안 잡힌 것은 "없다" 가 아니라 "못 봤다" 다. 국면② 를 길게 두고 2~3회 반복해도 `varying` 이 비면 그때 빈 배열로 확정한다 |
| **프로세스 힌트가 안 잡히는 경우** | npm 전역 래퍼를 거치면 명령줄이 node/pwsh 로만 보인다(`src/deck.service.ts:1633`). AO1 의 `procSource` 가 `empty`/`error` 면 그 에이전트는 `titleHints` 만 실측된다 |
| **우리 키가 그 CLI 에서 듣는가** | 프로브는 채집만 하고 화면·입력을 건드리지 않는다(에이전트가 도는 탭에 바이트를 쓰면 다음 국면 채집이 오염된다). 키 검증은 `tools/probe-input.js` 와 사용자 실사용의 몫 |
| **OSC 통보 경로** | `ESC ] 1337 ; AgentDeck=…`(`src/detect.ts:6`)는 **우리 규약**이고 훅이 있는 Claude 전용이다. 관측 대상이 아니다 |

## 채집 결과 (여기에 붙여 넣는다)

프로브 JSON 을 그대로 붙이지 말고, 아래 표에 **골라낸 값과 원문 근거**를 남긴다.
원문이 없으면 그 값은 근거가 아니다.

### Codex CLI — 관측일 `2026-09-08` / 버전 `codex-cli 0.144.1` (배너 표기 `v0.153.4`)

**국면①만 채집됐다.** 벽이 두 번 있었다 —

1. 기본 모델 `gpt-5.4` 가 이 계정에서 거부됐다:
   `■ {"type":"error","status":400,…"The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account."}}`
2. `/model` → `gpt-6-astra low` 로 바꿔 그 벽은 넘었는데, 그 다음이 **계정 사용량 한도**였다:
   `■ Usage limit reached. You've reached your usage limit. Increase your limits to continue using codex.`

둘 다 우리 코드와 무관한 계정 상태다. 작업이 시작되지 않아 승인 프롬프트도 진행중 화면도
못 봤고, `patternsProven` 은 **false 유지**다. 사용량이 회복되면 국면②③ 만 다시 뜨면 된다
(국면① 값은 이미 이 표에 있다).

> **한도 문구는 실측으로 하나 얻었고, 0.10.0 에서 값이 들어갔다** (위 2번).
> 프로필에 `limitedPatterns` 필드가 생겨 `CODEX.limitedPatterns` 에 이 원문이 들어 있다
> (`src/agents.ts`). 즉 codex 는 `patternsProven: false` 인 채로도 **한도만은 화면으로 판정된다** —
> 합집합이 모든 프로필의 `limitedPatterns` 를 품고, `detectProfileFor` 가 unproven 프로필의
> 화면 문구를 합집합으로 갈 때 이 필드도 함께 넘기기 때문이다.

| 항목 | 채집값 | 원문 근거 (국면 · 줄) |
|---|---|---|
| 프로세스 이름 (`processHints`) | **이름으로는 안 잡힌다** — `codex` 유지 + 명령줄 폴백에 의존 | ① `procs: [{ pid, command: "node.exe" }]`, `procSource: "ok"`, `identify: "unknown"` |
| 제목 조각 (`titleHints`) | 근거 없음 (`codex` 유지 — 사용자가 탭 이름을 바꿔 두는 경우만) | ① `title: "junggon"` (10표본 불변) |
| 대기 문구 (`waitingPatterns`) | `(미채집 — 국면③ 못 만듦)` | — |
| 작업중 문구 (`busyPatterns`) | `(미채집 — 국면② 못 만듦)` | — |
| 제목 스피너 (`busyTitleMarks`) | `(미채집)` — 국면① 은 불변이었지만 그것만으로 `[]` 확정 불가 | ① `varying: []`, `titleChanged: false` |
| 입력창 머리글자 | `›` (U+203A) — **기본값에 이미 있다** → shape 불필요 | ① `› Ask Codex to do anything` |
| 입력창 테두리 | **없다** (배너만 `╭─╮│╰╯`) → `screenShape` 안 넣는다 | ① `rules: []` / `│ >_ OpenAI Codex (v0.153.4)  │` |
| 이미지 키 (`imagePasteKey`) | `ctrl-v` (2026-08-28 실측 — 이미 확정) | `docs/DEVELOPMENT.md` |

### Gemini CLI — 관측일 `2026-09-08` / 버전 `v0.58.0` (vertex-ai 인증, 80x33)

**3국면 전부 채집. `patternsProven: true` 로 올렸다.** 파일:
`%TEMP%\agentdeck-observe\gemini-{1-idle,2-busy,3-waiting}.json`

이 CLI 는 **상태를 콘솔 제목으로 말한다** — 이것이 가장 강한 근거다.

| 국면 | 제목 (10표본 전부 동일) |
|---|---|
| ① 유휴 | `◇  Ready (work)` |
| ③ 승인대기 | `✋  Action Required (work)` |
| ② 작업중 | `✦  Working… (work)` |

| 항목 | 채집값 | 원문 근거 (국면 · 줄) |
|---|---|---|
| 프로세스 이름 (`processHints`) | **이름으로는 안 잡힌다** — `gemini` 유지 + 명령줄 폴백 | ① `procs: [{ pid: 76948, command: "node.exe" }]` → 그 pid 의 명령줄 `"…\node.exe" C:\Users\…\npm/node_modules/@google/gemini-cli/bundle/gemini.js` |
| 제목 조각 (`titleHints`) | 제목에 `gemini` 없음 (힌트는 유지 — 해가 없다) | ① `◇  Ready (work)` |
| 대기 문구 (`waitingPatterns`) | `/Allow execution of\b/i` · `/●\s*\d+\.\s*Allow once/` | ③ `│ Allow execution of [Shell]?   │` / `│ ● 1. Allow once   │` |
| 작업중 문구 (`busyPatterns`) | `/esc to cancel/i` | ② ` ⠇ Thinking... (esc to cancel, 6s)` (다음 표본은 `⠦ … 4s`) |
| 제목 스피너 (`busyTitleMarks`) | `✦` (U+2726) **하나만** | ② 제목 10표본 전부 `✦`. ①은 `◇`, ③은 `✋` 라 그 둘은 넣지 않는다 |
| 입력창 머리글자 | `>` — 기본값에 있다 | ① `>   Type your message or @path/to/file` |
| 입력창 테두리 | **반블록** 위 `▄`(U+2584) / 아래 `▀`(U+2580), 폭 80 꽉 → `promptShape`·`screenShape` 에 추가 | ①②③ `rules: [{ch:"▀",lens:[80]},{ch:"▄",lens:[80]}]`, `inDefault: false` |
| 이미지 키 (`imagePasteKey`) | `(미채집 — config 폴백 유지)` | 격리 환경에서 클립보드 이미지 생성 불가 (R6·IN6 선례) |

#### 넣지 않은 것 (오탐 후보)

| 후보 | 왜 버렸나 |
|---|---|
| `no sandbox` | AO3 이 `yes/no` 트리거로 올렸지만 **상시 상태줄**이다(①에도 있다). 넣으면 탭이 영구 대기로 박힌다 |
| `? for shortcuts` | 세 국면 전부에 있다 — 국면 구분력이 0 |
| `✦` 를 화면 문구로 | `✦ I will run the ping command…` 처럼 **응답 본문 머리**에도 쓰인다. 제목에서만 근거로 쓴다 |
| 브라유 스피너 `⠇`/`⠦` | 화면 문자다. `busyTitleMarks` 는 제목만 보므로 자리가 아니고, `busyPatterns` 는 이미 `esc to cancel` 이 같은 줄을 잡는다 |
| `Ready`/`Working`/`Action Required` 를 `titleHints` 로 | 식별용 힌트에 상태 문구를 넣으면 **상태가 바뀔 때 식별이 흔들린다**. 식별은 명령줄로 한다 |
