# 검증 도구

`docs/REGRESSION.md` 의 체크리스트를 실제로 재는 도구들이다. **눈으로 판정하지 않는다** —
"깨졌다/멀쩡하다" 를 감으로 정하다 같은 사고를 반복한 것이 이 도구들이 생긴 이유다.

## 전수 — 한 명령

```powershell
powershell -ExecutionPolicy Bypass -File tools/run-all.ps1
```

`docs/REGRESSION.md` 의 **R1~R51 전부**를 돌린다. 맨 앞에서 **`npm run build` 를 돌리고(B0)**,
그 뒤 인스턴스 기동·창 리사이즈·재기동·훅 실발화까지 러너가 하고 결과를 한 리포트로 합친다
(`%TEMP%` 아래 `agentdeck-regression/regression.json`). 실패가 있으면 종료코드 1.

**빌드 단계를 함부로 건너뛰지 말 것.** 플러그인은 junction 으로 `dist/` 를 로드하므로, 소스만
고치고 돌리면 **낡은 번들을 재게 된다** — 2026-09-08 에 "고쳤는데 그대로 FAIL" 로 두 번 헛돌았다.
빌드가 실패하면 러너는 낡은 dist 로 재지 않고 그 자리에서 멈춘다(종료코드 1, `build.txt`).

- `-SkipBuild` : `npm run build` 를 건너뛴다 (직전에 빌드했음이 확실할 때만)
- `-SkipUnit` : `npm test` 를 건너뛴다 (이미 돌렸을 때)
- `-KeepAlive` : 끝나고 격리 인스턴스를 남긴다 (수동으로 더 볼 때)

## 부분만 돌리기

```powershell
powershell -ExecutionPolicy Bypass -File tools/test-instance.ps1   # 격리 인스턴스 (실사용 Tabby 안 죽음)
```
```bash
node tools/cdp.js 9222 tools/verdict.js     # 화면 판정 (R1·R3 계열)
node tools/cdp.js 9222 tools/probe-all.js   # 렌더러 안에서 잴 수 있는 전 항목
node tools/cdp.js 9222 tools/probe.js       # 신규 기능만 (R22~R35)
```

끝나면 `powershell -File tools/test-instance.ps1 -Kill`.

## 파일

| 파일 | 하는 일 |
|---|---|
| `cdp.js` | 전송 계층. 표현식 파일을 Tabby 안에서 실행(`Runtime.evaluate`)하고, `--keys "text:안녕,Enter"` 로 **진짜 키 이벤트**를 넣는다. `sendInput` 은 키 경로를 타지 않으므로 라벨·핫키 검증에는 반드시 `--keys` 를 쓴다 |
| `verdict.js` | 열려 있는 모든 pane 의 화면을 판정 — 폭 일치, 테두리 길이, 입력창 자리 |
| `run-all.ps1` | **전수 러너.** 빌드 → 유닛 → 프로브 → 리사이즈 → 재기동 → 훅까지 묶어 한 리포트로 |
| `probe-all.js` | 렌더러 안에서 잴 수 있는 전 항목 (R1~R51 중 창 안의 일. 한도·승인 이유 판정 R50·R51 포함) |
| `probe-status.js` | **상태 배지** (`ST*`) — ST1 훅 고정이 화면에 온다 · **ST2 기척이 끊긴 `진행중` 고정이 유예 뒤 풀린다** · ST3 풀린 뒤 자동 감지가 다시 먹는다 · ST4 `승인대기`·`한도` 는 유예에 안 걸린다 · ST5 보고가 이어지면 안 내려온다 · ST6 `staleAfterMs: 0` 이면 옛 동작 · **ST7·ST8 `Ctrl+N`**(사이드바에 보이는 순서로 N 번째, 범위 밖은 무동작). **시계를 조작하지 않는다** — 유예를 2초로 줄여 실제 `tick()` 이 판정하게 두고 기다린다. 유닛(`test/status.service.test.js`)이 상태기계를 전수로 보지만 **그 값이 화면까지 오는지**와 **매초 타이머가 그 판정을 부르는지**는 여기서만 잰다 |
| `probe-input.js` | 입력 경로 (`IN*`) — 우클릭 · 이중 붙여넣기 · 이미지 키 · 줄바꿈 · IME 대기 · 진단줄 |
| `probe-layout.js` | 레이아웃·외형 (`LY*`) — 도킹 드래그 4방향 · 클램프 · 화면비 · 투명도 · 배경 클리핑 · off/on · **LY9 상/하 도킹 줄 폭 220px 격자 · LY10 좌/우는 그 격자가 아니다**. LY9 는 **폭만 재면 회귀를 놓친다** — 제목이 짧은 탭은 버그 상태에서도 220px 이라, 120자 제목 줄을 목록에 붙여 재고 즉시 뗀다 |
| `probe-profile.js` | 프로필·복구 (`PR*`) — 루트 프로필 · `noTabRecovery` · 화면 감시 · 자동복구 streak/쿨다운/상한 |
| `probe-viewer.js` | 미리보기 심화 (`VW*`) — 드래그앤드롭 · follow · MRU · 탭별 분리 · 자동갱신 · 상한 · 이미지 상한 · **터미널 드롭 확인 배너(VW10)** · **VW12 열려 있을 때만 따라온다(`show`)** — 닫힌 패널을 스스로 열지 않고 칩만 쌓이는지, 열어 두면 따라오는지, `manual` 은 열려 있어도 안 바뀌는지 |
| `probe-group.js` | 세션 그룹 (`GR*`) — GR1~GR5 단일 그룹(**순서 유지** · `data-ad-index` · 낡은 접힘 키 · 끈 경로 · 구성요소) + **GR6~GR14 다중 그룹 실화면**(임시 프로필로 cwd 다른 탭 2개를 실제로 띄운다) + GR15 정리 확인 + **GR16 검색×접힘**(접힌 그룹이 임시로 펴지고 저장값은 그대로인지) |
| `probe-nav.js` | 키보드 내비게이션 (`NV*`) — NV1 진입·해제 · NV2 **포커스≠선택** · NV3 Home/End · NV4 링=focused · NV5 Enter 로 전환 + 키 반납 · NV6 **키가 pty 로 안 새는지**(`sendInput` 을 랩해 `0x0D`/`0x0A` 바이트로 판정 + `enter-label` 진단줄 불변) · NV7 터미널 포커스 무개입 · NV8 Esc 순서 · NV9 검색창↔목록(검색창 `↑` 는 안 가로챈다) · NV10 렌더·필터에서 포커스 생존 · NV11 닫힌 탭 정리 · NV12 감김 설정 · NV13 끈 경로 · NV14 헤더 Enter. 이동 산술은 베끼지 않는다 — 키를 `.ad-list` 에 합성해 실경로에 태우고 상태는 `focusNav()` 가 말한 값으로만 판정한다(규칙 전수 검증은 `test/nav.test.js` 3165 조합 몫) |
| `probe-hooks.js` | 훅 실제 실행 (`HK*`) — HK1 상태 파일 규격 · HK2 이벤트별 상태 매핑(`StopFailure` 의 `overloaded`/`rate_limit` 갈림 포함) · HK3 중복 생략·라벨 · HK4 완료 뒤 가드 · HK5 깨진 입력(JSON 아님·빈 stdin·탭 env 없음) · HK6 한글 왕복 + `.ps1` BOM · HK7 TCP 통보가 파일과 같은 JSON · **HK8 그것을 플러그인이 받아 배지가 바뀐다** · HK9 정리 확인. **그전까지 회귀는 훅이 설치됐는지만 봤다** — 실행해 보지 않아 훅이 깨져도 초록이었다. 훅은 **격리 `LOCALAPPDATA`**(`<TEMP>/ad-hk-*/localappdata`)로 돌리고 접두 `agentdeck-probe-hk-`·`ad-hk-` 로만 지운다 — 안 그러면 상태 파일이 실사용 폴더에 생겨 사용자 세션 상태를 덮는다. 훅 경로는 `<TEMP>/agentdeck-regression/hk-params.json` 으로 갈아 끼울 수 있다(고장 주입 검증에 쓴다) |
| `probe-subagent.js` | 서브에이전트 개수 (`SA*`) — SA1 상태파일→탭 묶기→폴더 훑기→전량 읽기 · SA2 증분(파일이 자라면 따라온다) · SA3 화면 칩=제품 상태(형제 순서까지) · SA4 0 이면 노드 없음 · SA5 끄면 읽기·표시 둘 다 멈춤 · SA6 크기 감소 리셋 · SA7 UTF-8 멀티바이트 경계 · SA8 `data-ad-index` 불변 · SA9 정리 확인. **이 프로브만 사용자의 실제 대화기록 폴더**(`~/.claude/projects`)와 공유 상태 폴더에 파일을 만든다 — 접두 `agentdeck-probe-sa-` 검사를 통과할 때만 지운다. 2초 스캔을 기다려 느리다(실측 22초) |
| `probe-reorder.js` | 순서 드래그 (`RO*`) — RO1 진단구 경로 · RO2 `data-ad-index` 불변 · RO3 합성 드래그(임계치·삽입선·드롭) · RO4 취소 3경로(Esc·pointercancel·놓을 자리 없음) · RO5 `sortByStatus` 게이트(진단구·드래그 양쪽) · RO6 다른 그룹엔 안 놓인다 · RO7 헤더 있는 화면 · RO8 클릭과의 공존 · **RO9 자동 스크롤(띠 진입/이탈) · RO10 스크롤 뒤 삽입선 재계산(두 축) · RO11 손 뗀 뒤 잔여 0 · RO12 화면 밖 줄로 이동 · RO13 끌지 않을 때·게이트 off**. 넘치는 화면을 만들려고 **하단 도킹 + 사이드바 높이**를 재서 바꾸고 탭을 몇 개 연다(finally 에서 `cleanup.dockRestored` + `relayout()` — 설정만 되돌리면 다음 프로브가 옆으로 눕은 사이드바를 잰다). **`app.tabs` 를 실제로 흔들어서** 러너 목록 맨 뒤에 두고, finally 에서 원래 순서로 되돌린 것을 `cleanup.orderRestored` 로 보고한다 |
| `probe-perf.js` | 성능 (`PF*`) — 렌더 비용·조각 처리량·OS 호출 횟수·탭 수 기울기·누수. 탭을 최대 10개 열므로 러너가 **새 인스턴스**에서 따로 돌린다(2-d 단계) |
| `probe-cwd.js` | 탭 작업 폴더 (`CW*`) — CW1 훅 보고의 `cwd` 가 탭에 반영 · CW2 그 값이 Tabby 추정에 안 덮인다 · CW3 훅 없는 탭에서 **폴더 아닌 추정값 거부** · CW4 그 cwd 로 `변경` 탭이 실제 git 을 돈다 · CW5 설정 파일은 자동으로 안 띄운다 · **CW6 `변경` 이 이 세션이 만진 파일만 그린다**(훅 `file` 보고 → 목록 1줄 → `전체` 로 복귀) · **CW7 git 없는 폴더에서도 만진 파일 목록이 나온다**(저장소 밖 폴더를 직접 고른다 — `%TEMP%` 는 홈 저장소 안이라 못 쓴다) · **CW8 서브에이전트 `❖N` 이 훅 스냅샷을 따라온다**(3→2→중복 stop 무해→0). CW2·CW3 은 `session.getWorkingDirectory` 를 파일 경로로 스텁해 실사고(윈도우 cwd 추정)를 그대로 재현한다. **판정을 본문 글자로 하지 말 것** — 이 저장소의 diff 안에 실패 문구가 소스로 들어 있어 오탐이 난다(구조 `.ad-view-empty` 로 본다) |
| `probe-meta.js` | 하단 "지금 이 탭" 줄 + 훅이 말하는 에이전트 정체 (`ML*`) — ML1·ML2 훅 `agent` 가 추측을 이긴다 · ML3 보고 없으면 줄 접힘 · ML4~ML7 모델·계정·한도 칸·리셋 툴팁 · **ML8 탭 전환하면 그 탭 값으로 다시 그린다** · ML9 토글 · ML11 다른 에이전트 프로세스(`codex.exe` = ping 복사본)가 뜨면 훅 값을 버린다 · **ML12 Codex 탭**(격리 `CODEX_HOME` 에 rollout 픽스처를 만들어 모델·계정·한도와 "기록이 자라면 따라오는지" 까지) · ML10 정리. 세션 id 는 실행마다 새로 뽑고, ML11 은 **처음 연 터미널 탭에서 맨 마지막에** 재고 그 탭을 닫는다(뒤 탭은 `getChildProcesses` 가 늘 `[]` · codex 로 식별된 탭을 남기면 다음 프로브가 오염된다) |
| `probe-meta-shot.js` | 스크린샷용 — 하단 줄을 실제로 띄워 둔다(판정 안 함). `shot.ps1 -Test` 로 찍어 200px 폭 레이아웃을 눈으로 본다 |
| `probe.js` | 신규 기능만 (R22~R35). 아래 표 참조 |
| `test-instance.ps1` | 격리 인스턴스 기동/종료. `--user-data-dir` 로 실사용과 갈린다 |
| `shot.ps1` | 창을 PNG 로 (가려져 있어도 `PrintWindow` 로 찍는다) |
| `fakebox.js` | 합성 TUI. 실물 `claude` 없이 입력창 모양을 만든다 (토큰 0) |

## `probe.js` 가 재는 것

| id | REGRESSION | 판정 기준 |
|---|---|---|
| R22 | 미리보기 레이아웃 | 도킹 5조합에서 `터미널+패널+사이드바 == 창폭`, 셋이 겹치지 않음 |
| R23 | 폭 일치 | 패널이 열린 상태에서 `xterm.cols == pane.size.columns` |
| R24 | 종류별 렌더 | md(제목·표·인라인 이미지) / png(`naturalWidth>0`) / csv(따옴표 안 쉼표 보존) / 코드 |
| R25 | 주입 차단 | `script` 노드 0, `[onerror]` 0, `img` 는 문서가 명시한 것만, 원문은 글자로 남음 |
| R28 | `변경` 탭 | 패널 요약·파일별 ±카운트가 `git diff --numstat` 과 일치 |
| R31 | 한글 조합 순서 | 조합 중/확정예약 중 Shift+Enter 에서 **음절이 먼저** 나감. 조합 없을 때는 불변 |
| R32 | 에이전트 판정 | `probeAgent()` 후 `probedAt` 이 갱신되는가 (판정 경로 생존) |
| R35 | 입력창 라벨 | 골든 프레임을 그린다 (판정은 아래 참조) |

### 결과 읽는 법

```json
{ "summary": { "pass": 7, "fail": 0, "skipped": 1 }, "results": [ … ] }
```

- `pass: true` 통과 / `false` 실패
- **`pass: null` = 판정 불가** — 환경이 조건을 못 만든 것이지 실패가 아니다(저장소가 아님,
  터미널 탭 없음, 진단구 없음 등). `detail` 에 사유가 있다. **실패와 섞어 세지 말 것.**
  이 리포가 "근거 미확인" 을 실패와 구분하는 것과 같은 규칙이다.

프로브는 바꾼 것(설정·랩한 함수·임시 파일)을 스스로 되돌린다. 오염된 인스턴스는 다음 프로브를
거짓말하게 만든다.

## 사람이 해야 하는 것 (도구로 못 재는 것)

전수 러너를 돌리면 남는 것은 아래 둘뿐이다. 나머지는 자동으로 판정된다.

| 무엇 | 왜 |
|---|---|
| **클립보드 이미지(R6)** | 격리 환경에서 `clipboard.writeImage()` 후 `readImage().isEmpty()` 가 true 다 — 사용자 실사용으로만 판정된다 |
| **OS IME 실제 조합** | CDP 로 IME 를 구동할 수 없다. R31 은 DOM 조합 이벤트로 xterm 내부 상태를 같게 만들어 **순서**를 재므로 기전은 확인되지만, 실제 한글 타이핑은 사람이 하고 `~/.agentdeck-diag.log` 의 `ime send=…` / `ime home-end …` 줄로 분기를 확인한다 |
| **실물 에이전트 승격** | 새 탭에 곧바로 입력하면 pty 준비 전이라 유실된다. R32 는 판정 경로가 도는지까지 본다 (프로필 자체는 유닛이 판정) |

## 하네스가 거짓말하는 지점 (실측)

> **훅이 설치됐다는 것은 훅이 돈다는 뜻이 아니다.** 0.15.0 까지 회귀는 `settings.json` 에
> 훅 명령줄이 있는지만 봤다 — 그래서 훅 스크립트가 깨져도(인코딩·경로·JSON 파싱) 전수가
> 초록으로 남았다. 0.16.0 의 `probe-hooks.js` 가 그것을 실제로 실행한다. 검출력 확인:
> 훅 사본의 상태 폴더 이름 한 곳만 틀리게 하니 **9개 중 7개가 FAIL** 로 뒤집혔다.
> 특히 `.ps1` 은 **UTF-8 BOM** 이어야 한다 — 없으면 PS5.1 이 한글을 CP949 로 읽어 조용히
> 오작동하고, 그 상태로도 exit 0 이라 아무 신호가 안 뜬다.


> **`flex-basis` 가 이겨도 폭이 그 값이 아닐 수 있다.** `.ad-tab` 의 `flex: 0 0 220px` 는
> 캐스케이드에서 이기고 있었는데(computed `flexBasis: 220px`) 실제 폭은 384.7px 였다 —
> flex 아이템은 `min-width: auto` + `overflow: visible` 이면 **자동 최소 크기**가 걸려
> `flex-basis` 보다 작아지지 않는다. 0.1.0 부터 아무도 몰랐고, 제목이 짧은 탭은 220 이라
> **부분적으로는 맞아 보였다.** 레이아웃을 잴 때 `getComputedStyle` 의 `flexBasis` 만 보지 말고
> `getBoundingClientRect().width` 를 함께 봐야 한다.


> **`test-instance.ps1` 은 공유 자원이다 — 병렬로 재면 서로를 죽인다.** 그 스크립트는
> 커맨드라인에 `tabby-agentdeck-test` 가 든 Tabby 를 **전부** 죽이므로 두 유닛이 동시에 쓸 수
> 없다. 2026-09-09 병렬 프로브 라운드에서 한쪽이 기동하자 다른 쪽 인스턴스가 `ECONNRESET`
> (15.9초)으로 끊기고 임시 폴더가 남았다 — 프로브의 `finally` 는 CDP 가 끊기면 아예 돌지 않는다.
> 병렬로 재려면 이름에 `test` 가 없는 전용 user-data-dir 과 별도 포트를 쓴다
> (예: `tabby-agentdeck-sa` + 9333). **그리고 프로브가 만든 잔여는 접두로만 지운다** —
> `probe-subagent.js` 는 사용자의 실제 대화기록 폴더(`~/.claude/projects`)에 픽스처를 만들기
> 때문에, 접두 검사를 통과하지 않는 삭제 코드는 아예 두지 않는다.
>
> 그 잔여를 러너가 판 끝에 한 번 센다(R79, 2-c-0 단계). **접두는 `ad-*` 하나다** — 처음에는
> 아는 이름 셋(`ad-grp*`·`ad-hk*`·`ad-doc*`)만 셌는데 그 목록이 곧바로 낡아,
> `ad-drop-`(probe-viewer 가 지금도 만든다)·`ad-sim-`·`ad-refd-` 25개가 `%TEMP%` 에 며칠
> 남아 있었는데도 검사가 **0개** 라고 답했다. 열거식 검사는 프로브가 늘 때마다 조용히 눈을 감는다.
> 러너는 세기만 하고 **지우지 않는다**(`%TEMP%` 는 사용자 것이다).


> **러너가 실패의 종류를 갈라 말한다 (0.12.0).** 예전에는 아래 넷이 전부 `출력 파싱 실패` 로
> 적혀 **앱이 죽은 것처럼 읽혔다** — 플러그인 미로드(앱은 살아 있다) · 앱 소실 · 프로브 예외 ·
> 진짜 파싱 실패. 지금은 각각 다른 문구와 `pass` 값을 쓰고, 소실이면 증거를
> `%TEMP%\agentdeck-regression\evidence\<단계>\` 에 모은 뒤(진단로그 꼬리 두 세대 ·
> Crashpad 리포트 개수 · 프로세스 유무 · cdp 원문) **그 자리에서 멈춘다.** 멈추는 이유는
> 다음 단계가 `test-instance.ps1` 을 부르면 `ud` 가 지워져 증거가 사라지기 때문이다.

넷 다 실제로 밟아서 오판할 뻔했던 것들이다. 상세는 `docs/DEVELOPMENT.md` 의 함정 목록에 있다.

- **`fakebox.js` 는 타이핑을 에코하지 않는다** — 라벨 검증은 키로 못 만든다. xterm 버퍼에
  프레임을 직접 그려야 하고, 그때 **줄 지우기(`ESC[2K`)를 빼면** 옛 프레임 잔여가 라벨 끝에 붙는다.
- **진단 로그는 값이 바뀔 때만 찍힌다** — "조회가 안 돌았다" 와 "돌았는데 결과가 같다" 가
  구별되지 않는다. `__agentdeck.agentOf().probedAt` / `debug().outputHits` 로 가른다.
- **조합 이벤트를 흉내낼 때 `compositionend` 를 직접 쏘면 음절이 두 번 나간다** — 하네스 산물이다
  (방향키도 똑같이 두 번 나온다). **순서만** 보고 개수는 방향키와 대조할 것.
- **`session.emitOutput(문자열)` 은 조용히 삼켜진다.** 그건 `middleware.feedFromSession(data)` 로
  들어가고 시그니처가 **Buffer** 다(`tabby-terminal/typings/session.d.ts:30`). 문자열을 넘기면
  미들웨어에서 사라져 출력 구독이 **0회** 발화한다(2026-09-08 실측: `outputSubscribed: 0`,
  `__agentdeck.debug().outputHits` 34→34 불변). 경로 줍기를 재려면 `session.output.next(문자열)`
  또는 `emitOutput(Buffer.from(…))` 를 써라 — 둘 다 실측으로 구독을 태운다(hits 34→36).
- **`pane.sendInput` 을 랩하면 xterm 의 정상 전송까지 잡힌다.** Tabby 는 `onData → sendInput` 으로
  이으므로, 맨 Enter 를 눌렀을 때 `0x0D` 가 기록되는 것은 **정상**이다. "우리가 아무것도 안 썼다" 로
  판정하면 거짓 실패한다 — 우리 것만 보려면 **바이트를 특정**하라(줄바꿈이면 `0x0A`).
- **프로필은 래퍼가 아니라 자식 터미널 탭에 붙는다.** `app.tabs` 의 원소는 `SplitTabComponent` 이고
  `profile` 은 그 안의 `TerminalTabComponent` 에 있다(실측: root=null / kid=`local:test-ps`).
- **`dock.ts` 는 mouse 가 아니라 pointer 이벤트를 쓴다**(`pointerdown`/`pointermove`/`pointerup`,
  `button:0` 필수). `mousedown` 을 쏘면 리스너가 없어 아무 일도 일어나지 않는다. 합성 포인터에는
  `setPointerCapture` 가 던지므로 그 구간만 no-op 으로 바꿔야 드래그가 끝까지 간다.
- **사이드바의 "첫 줄" 이 `app.tabs[0]` 이라는 보장은 없다.** 순서는 `sortByStatus` 와 그룹핑이
  바꾼다. `sidebar().querySelector('.ad-badge')` 로 첫 배지를 집어 놓고 대상 탭의 것이라 믿었더니,
  그룹핑이 `기타`(cwd 미상) 그룹을 맨 뒤로 밀어 다른 탭의 `● 진행중` 을 읽었다 — R16·R19 가
  그렇게 거짓 실패했다(2026-09-08). 대상 줄은 제품이 남기는 `data-ad-index` 로 찾아라:
  `.ad-tab[data-ad-index="<app.tabs 인덱스>"]` (`probe-all.js` 의 `rowOf`/`badgeOf`).
- **직접 `xterm.write` 로 그린 화면은 pty 쪽 앱이 덮어 지운다.** SIGWINCH 가 한 번 가면(우리
  `nudgePtyRedraw` 가 `resize(cols-1)`→원복으로 두 번 낸다) pty 쪽 앱이 절대 좌표로 프롬프트를
  다시 그리며 우리 줄을 밀어낸다. **고정 대기 후 1회 샘플링은 그 창에 겹친다** — PR8 이 그래서
  자주 SKIP 이었다. `__agentdeck.debug().outputHits` 가 조용해진 뒤 주입하고, 판정은 폴링 +
  재주입으로 하라. 주입은 **화면 맨 아래**에 — 제품의 잔상 지우기가 하단 16행만 훑으므로 위쪽에
  그리면 그 단계가 조용히 no-op 이 되어 검증이 앱의 Ctrl+L 처리에 얹혀 거짓 통과한다.
- **없는 키 이름을 `--keys` 에 주면 조용히 한 글자 키로 폴백된다.** 2026-09-08 에 `Down` 이
  없는 줄 모르고 `--keys "Down,Enter"` 를 보냈다가, 커서가 안 내려간 채 Enter 만 먹어 codex 의
  `1. Update now` 가 실행돼 **전역 npm 패키지가 올라갔다**. 쓸 키가 `KEYS` 테이블에 있는지
  먼저 확인할 것(`cdp.js` 의 `keyCommands`). 지금은 방향키·Home·End·Backspace 가 들어 있다.
- **Bash 도구의 heredoc 안에서 `\\` 는 한 겹으로 접힌다.** 2026-09-09 에 `/[\\/]/` 를
  heredoc python 으로 써 넣었더니 소스에 `/[\/]/` 가 박혀 Windows 경로에서 파일명이 안
  잘렸다(드롭 배너 제목에 전체 경로가 찍혔다). 백슬래시가 든 코드는 **스크립트를 파일로 써서**
  실행할 것. 넣은 뒤 `grep` 으로 실제로 두 겹인지 확인하는 것이 가장 확실하다.
- **재기동 직후 프로브를 돌리면 `__agentdeck` 이 아직 없다.** 그러면 프로브가
  `{"error":"__agentdeck 이 없다 — 플러그인이 안 떴다"}` 를 돌려주고, 러너는 `results` 가
  없다는 이유로 `출력 파싱 불가` 로 적는다 — **앱이 죽은 것처럼 읽힌다**(2026-09-09 에
  이걸로 크래시 추적에 오래 헤맸다). 고정 `Start-Sleep` 로 맞추려 하지 말고 상태를 폴링하라
  (러너의 `Wait-ForPlugin`). 손으로 돌릴 때도 `window.__agentdeck && __agentdeck.app` 를
  먼저 확인할 것.
- **로그 경로를 프로브가 만들지 말 것.** 격리 인스턴스는 자기 폴더에 로그를 쓴다
  (`AGENTDECK_DIAG_DIR`, `src/diag.ts` 의 `logDir`). `os.homedir()` 로 경로를 만들면 실사용
  Tabby 의 파일을 읽고 **"아무 줄도 안 남았다" 로 거짓 실패**한다 — 2026-09-09 에 IN9·PR4·PR5
  가 한꺼번에 그렇게 뒤집혔다. `__agentdeck.diagPaths()` 가 지금 쓰는 경로를 돌려준다.
- ~~진단 로그는 기동할 때 비워진다~~ — **지금은 회전한다**(`.log.1`, `src/diag.ts` 의 `rotate`).
  단 회전만으로는 부족했다: 파일이 실사용 Tabby 와 공유되면 남의 줄에 밀려난다(위 항목).
- **화면 판정을 재려면 `unpin` 을 잊지 말 것.** `status.setManual()` 은 **pin 을 건다**
  (`src/status.service.ts`). pinned 상태는 자동 감지가 덮지 않으므로, 출력을 흘려 넣어도 배지가
  꿈쩍하지 않는다 — 2026-09-09 에 이걸 빼먹어 한도·이유 검증 7종이 한꺼번에 거짓 실패했다.
  `setManual(tab, s)` 뒤에 `unpin(tab)` 을 부르고, 출력은 `session.output.next(문자열)` 로 넣는다.
- **낡은 `dist/` 를 재고 있을 수 있다.** 플러그인은 junction 으로 `dist/` 를 로드한다 — 소스만
  고치고 프로브를 돌리면 고친 것이 화면에 없다. `run-all.ps1` 은 0) 단계에서 빌드하지만,
  프로브를 손으로 돌릴 때는 `npm run build` 를 먼저 하고 인스턴스를 재기동해야 한다.
- **`git` 은 상위로 올라가며 저장소를 찾는다** — 홈 디렉토리가 저장소면 아무 폴더에서나 그것이
  잡힌다. 그리고 커밋이 0개인 저장소는 `diff HEAD` 가 실패하므로 `diff` 폴백이 필요하다.
  프로브가 패널과 **다른 저장소**를 보면 조용히 거짓 실패가 난다(실제로 한 번 냈다).
