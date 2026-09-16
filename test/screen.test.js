// 화면 깨짐 판정 검증 — `npm test` (screen.ts 를 .tmp 로 컴파일한 뒤 실행)
//
// 케이스는 전부 실측이다. 정상 골든은 2026-09-01 CDP 로 뜬 xterm 버퍼 원문이고
// (사이드바 ON cols=280 / 순정 cols=360 양쪽 동일 구조), 깨진 케이스도 같은 날
// 격리 테스트 인스턴스에서 실제로 잡힌 버퍼다.
const { judgeScreen, sizeInSync } = require('../.tmp/screen.js')
let pass = 0, fail = 0
const t = (name, lines, cols, wantBroken) => {
  const got = judgeScreen(lines, cols)
  if (got.broken === wantBroken) { pass++; console.log(`  ok   ${name} -> ${got.broken ? 'BROKEN ' + got.reasons.join(' / ') : 'OK'}`) }
  else { fail++; console.log(`  FAIL ${name}\n       want broken=${wantBroken}\n       got  broken=${got.broken} ${got.reasons.join(' / ')}`) }
}
const rule = n => '─'.repeat(n)
const L = (text, wrapped = false) => ({ text, wrapped })

// ---- 정상 (골든) ----
t('정상 — Claude Code 2.1.x, cols=280', [
  L(' '.repeat(258) + '● high · /effort'),
  L(rule(280)),
  L('❯', true),
  L(rule(280)),
  L('  ⚠ Transcript saving is off'),
  L('  ⏱ 1s  컨텍스트 사용량: 0%'),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)'),
], 280, false)

t('정상 — 순정 창 cols=360', [
  L(rule(360)),
  L('❯ 지금 또 agentdeck 입력창 깨지잖아', true),
  L(rule(360)),
  L('  ⏵⏵ auto mode on'),
], 360, false)

t('정상 — 상자형 입력창 (옛 Claude Code / Codex)', [
  L('╭' + rule(40) + '╮'),
  L('│ > 결제 모듈 버그 수정해줘' + ' '.repeat(10) + '│'),
  L('╰' + rule(40) + '╯'),
  L('  ? for shortcuts'),
], 44, false)

t('정상 — 일반 셸 (테두리 없음)', [
  L('PS D:\Project\tabby-agentdeck> claude'),
  L(''),
], 280, false)

t('정상 — 선택지 커서는 머리로 세지 않는다', [
  L(rule(280)),
  L('❯ 1. Yes', true),
  L('  2. No'),
  L(rule(280)),
], 280, true === false ? true : false)

// ---- 깨짐 ----
t('깨짐 — 테두리가 넘쳐 다음 줄에 자투리 (실측: 280 + 2)', [
  L(rule(280)),
  L(rule(2)),
  L(''),
  L('  ⏱ 1s  컨텍스트 사용량: 0%'),
], 280, true)

t('깨짐 — 테두리가 화면보다 좁다 (옛 폭으로 그림)', [
  L(rule(254)),
  L('❯ '),
  L(rule(254)),
], 280, true)

t('정상 — 대화 이력·큐 목록의 `❯` 는 여러 개가 정상 (실측 heads=7 오탐)', [
  L('❯ 줄0'), L('❯ 줄1'), L('❯ 줄2'), L('❯ 줄3'), L('❯ 줄4'), L('❯ 줄5'),
  L(''),
  L(rule(280)),
  L('❯', true),
  L(rule(280)),
  L('  ⏵⏵ auto mode on'),
], 280, false)

t('깨짐 — 입력창 머리가 둘 (옛 프레임 잔상)', [
  L(rule(280)),
  L('> ', true),
  L('❯ Try "how does <filepath> work?"'),
  L(rule(280)),
], 280, true)

t('깨짐 — 가로선과 입력 텍스트가 한 줄에 섞임', [
  L(rule(120) + '❯ 지금 또 agentdeck 입력창 깨지잖아'),
  L(rule(280)),
], 280, true)

// ---- 깨짐: 입력할 자리가 없다 (2026-09-02 실측) ----
//
// 폭은 완전히 정상이다 — 테두리 둘 다 cols 를 꽉 채운다. 그런데 그 둘이 맞붙어
// `❯` 가 들어갈 행이 사라졌다. 사람 눈으로도(폭만 보고 "정상") 옛 판정 규칙으로도
// 놓쳤던 케이스라 골든으로 박아 둔다. 근거는 스크린샷 픽셀 스캔 —
// 가로선 y=59 / y=76 이 행높이 17px 기준 1행 간격, 커서 글리프가 아래 선을 관통.
t('깨짐 — 입력창에 자리가 없다 (테두리 두 줄이 맞붙음)', [
  L(' '.repeat(258) + '● high · /effort'),
  L(rule(280)),
  L(rule(280), true),
  L('  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'),
], 280, true)

t('깨짐 — 자리 없음 + 앞에 대화 이력의 옛 테두리가 있어도 잡는다', [
  L(rule(280)),
  L('❯ 지난 프롬프트', true),
  L(rule(280)),
  L('  ⏱ 1s'),
  L(rule(280)),
  L(rule(280), true),
  L('  ⏵⏵ auto mode on'),
], 280, true)

t('정상 — 여러 줄 입력창(Shift+Enter)은 테두리 간격이 넉넉하다', [
  L(rule(280)),
  L('❯ 첫 줄', true),
  L('  둘째 줄'),
  L('  셋째 줄'),
  L(rule(280)),
  L('  ⏵⏵ auto mode on'),
], 280, false)

t('정상 — 대화 이력에 옛 입력창 테두리가 남아 있어도 오탐 없음', [
  L(rule(280)),
  L('❯ 지난 프롬프트', true),
  L(rule(280)),
  L('  ⏱ 2s'),
  L(rule(280)),
  L('❯', true),
  L(rule(280)),
  L('  ⏵⏵ auto mode on'),
], 280, false)

// 아래 4개는 ~/.agentdeck-screen.log 2026-09-02 00:55~00:58 의 실제 버퍼다.
// 앞 둘이 복구 전/후 짝(정상 골든), 뒤 둘은 복구가 5회 실패하는 동안 찍힌 화면.
t('정상 — 복구 직후 골든 (screen.log 00:55:04 auto-after 복구됨, cols=280 rows=80)', [
  L(' '.repeat(280)),
  L(rule(280), true),
  L('❯', true),
  L(rule(280)),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)', true),
], 280, false)

t('깨짐 — 테두리 두 줄 밀착 (screen.log 00:55:03 auto-before)', [
  L(' '.repeat(280)),
  L(rule(280), true),
  L(rule(280)),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)', true),
], 280, true)

t('깨짐 — 두 폭이 공존한다 (screen.log 00:58:27, 279 와 280 이 섞임)', [
  L(rule(279)),
  L(rule(280)),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)'),
], 280, true)

t('깨짐 — 아래 테두리가 없고 statusline 조각만 남았다 (screen.log 00:58:45)', [
  L(rule(279)),
  L('❯'),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)'),
  L(''),
  L('                                       · ← for agents'),
], 280, true)

// ---- 아래 테두리 소실 (2026-09-02 실사용 실측) ----
// 창 캡처 픽셀 행 스캔으로 확정한 모양 — 가로선이 y=1295 하나뿐이고, 프롬프트 글리프
// (y≈1304~1320) 아래 y≈1329 에 있어야 할 두 번째 가로선이 없었다(행높이 17px).
// 이 모양은 기존 규칙이 전부 통과한다: 남은 테두리 하나는 폭을 꽉 채우고(폭 규칙 통과),
// 테두리가 하나뿐이라 자리 규칙(fullRules >= 2)도 섞임 규칙(rules > 1)도 건너뛴다.
t('깨짐 — 입력창 아래 테두리가 통째로 사라졌다', [
  L(' '.repeat(258) + '● high · /effort'),
  L(rule(280)),
  L('❯', true),
  L('  ⏱ 2m  컨텍스트 사용량: 10%'),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)'),
], 280, true)

t('정상 — 대화 이력의 옛 테두리 아래 프롬프트가 있어도 오탐 없음', [
  L(rule(280)),
  L('❯ 지난 번에 보낸 말', true),
  L(rule(280)),
  L('  결과 요약'),
  L(rule(280)),
  L('❯', true),
  L(rule(280)),
  L('  ⏵⏵ auto mode on'),
], 280, false)

t('정상 — 테두리 없는 셸 프롬프트는 건드리지 않는다', [
  L('PS D:\\Project> claude'),
  L('> 입력 중'),
], 120, false)

// 실물 claude 골든 (2026-09-02, 격리 인스턴스 + CDP 로 xterm 버퍼를 직접 덤프).
// cols=271 에서 테두리도 271 — **테두리는 cols 를 꽉 채운다.** 꽉 찼기 때문에 autowrap 이
// 걸려 ❯ 가 다음 행으로 넘어간다(wrap=1). 이 골든이 "Claude Code 는 cols-1 로 그린다" 는
// 오진을 못 박는다 — 그 오진 때문에 자동복구를 통째로 꺼던 적이 있다(항목 26/30).
t('정상 — 실물 claude 덤프 골든 (cols=271, 테두리 271)', [
  L(rule(271)),
  L('❯ ', true),
  L(rule(271)),
  L('  Transcript saving is off'),
  L('  1s'),
  L('  auto mode on (shift+tab to cycle)'),
], 271, false)

// 같은 화면에서 앱만 한 칸 좁게 그리면 autowrap 이 안 걸려 ❯ 가 윗줄에 붙는다 —
// 실사용에서 계속 재현되던 모양이다 (screen.log rule@73 len=276 != cols=277).
t('깨짐 — 앱이 한 칸 좁게 그려 ❯ 자리가 사라졌다 (cols=277, 테두리 276)', [
  L(rule(276)),
  L(rule(276)),
  L('  auto mode on (shift+tab to cycle)'),
], 277, true)

// ---- shape 주입 (테두리·머리글자를 밖에서 넣는다) ----
//
// 위 케이스들은 전부 `judgeScreen(lines, cols)` — shape 없이 부른다. 그것이 기본값
// (Claude Code 2.1.x 실측 골든)으로 지금과 똑같이 판정돼야 한다는 회귀 방어다.
// 아래는 "다른 모양의 TUI 도 같은 규칙으로 판정된다" 쪽.
const { DEFAULT_SCREEN_SHAPE } = require('../.tmp/screen.js')
const ts = (name, lines, cols, shape, wantBroken) => {
  const got = judgeScreen(lines, cols, shape)
  if (got.broken === wantBroken) { pass++; console.log(`  ok   ${name} -> ${got.broken ? 'BROKEN ' + got.reasons.join(' / ') : 'OK'}`) }
  else { fail++; console.log(`  FAIL ${name}\n       want broken=${wantBroken}\n       got  broken=${got.broken} ${got.reasons.join(' / ')}`) }
}
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       want ${b}\n       got  ${a}`) }
}
/** 아무 글자로나 가로선 만들기 (테두리 문자를 바꿔 끼우는 케이스용) */
const fill = (c, n) => c.repeat(n)

// ① 기본값 == DEFAULT_SCREEN_SHAPE
const goldenLines = [
  L(fill(' ', 258) + '● high · /effort'),
  L(rule(280)),
  L('❯', true),
  L(rule(280)),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)'),
]
ts('shape 를 명시로 넘겨도 기본값과 같다 (정상 골든)', goldenLines, 280, DEFAULT_SCREEN_SHAPE, judgeScreen(goldenLines, 280).broken)
eq('DEFAULT_SCREEN_SHAPE 값이 여태 쓰던 그것', DEFAULT_SCREEN_SHAPE, {
  ruleChars: ['─', '━', '═'],
  heads: ['>', '❯', '›', '❭', '➜'],
  choiceWords: ['Yes', 'No'],
})

// ② 다른 모양의 TUI — 테두리가 `=`, 머리가 `$`.
// 짝을 이뤄 둔다: 커스텀 shape 로는 잡히고 기본 shape 로는 **아무 것도 안 보이는** 화면.
// 그래야 "shape 가 실제로 판정에 쓰인다" 가 증명된다 (둘 다 false 면 증명이 안 된다).
const eqBox = { ruleChars: ['='], heads: ['$'] }
ts('커스텀 shape — `=` 테두리 정상 화면', [
  L(fill('=', 280)),
  L('$', true),
  L(fill('=', 280)),
  L('  hint line'),
], 280, eqBox, false)
ts('커스텀 shape — `=` 테두리 두 줄이 맞붙었다 (입력할 자리 없음)', [
  L(fill('=', 280)),
  L(fill('=', 280), true),
  L('  hint line'),
], 280, eqBox, true)
t('같은 화면은 기본 shape 에는 안 보인다 (대비)', [
  L(fill('=', 280)),
  L(fill('=', 280), true),
  L('  hint line'),
], 280, false)
ts('커스텀 shape — `=` 테두리가 화면보다 좁다', [
  L(fill('=', 254)),
  L('$ '),
  L(fill('=', 254)),
], 280, eqBox, true)
ts('커스텀 shape — 테두리와 입력 텍스트가 한 줄에 섞임', [
  L(fill('=', 120) + '$ 결제 모듈 배포 스크립트 고쳐줘'),
  L(fill('=', 280)),
], 280, eqBox, true)
ts('커스텀 shape — 입력창 안 머리가 둘 (옛 프레임 잔상)', [
  L(fill('=', 280)),
  L('$ ', true),
  L('$ Try "how does <filepath> work?"'),
  L(fill('=', 280)),
], 280, eqBox, true)
ts('커스텀 shape — 아래 테두리가 통째로 사라졌다', [
  L(fill('=', 280)),
  L('$', true),
  L('  hint line'),
], 280, eqBox, true)

// 선택지 단어 — 한글 확인창(`예`/`아니오`)을 머리로 세면 "머리가 둘" 오탐이 난다.
// `choiceWords` 를 ScreenShape 에 둔 이유가 이 케이스다 (기본값 `Yes`/`No` 는 Claude 문구).
const koChoice = [
  L(rule(280)),
  L('❯ 예', true),
  L('❯ 아니오'),
  L(rule(280)),
]
ts('커스텀 choiceWords — 한글 선택지 커서는 머리로 세지 않는다', koChoice, 280, { choiceWords: ['예', '아니오'] }, false)
t('기본 shape 는 그 한글 선택지를 머리 둘로 본다 (대비)', koChoice, 280, true)
ts('choiceWords 를 안 준 shape 는 기본 `Yes`/`No` 를 그대로 쓴다', [
  L(rule(280)),
  L('❯ 1. Yes', true),
  L('  2. No'),
  L(rule(280)),
], 280, { ruleChars: ['─'], heads: ['❯'] }, false)

// ③ 이스케이프 사고 방지 — `-`·`]`·`\` 를 테두리·머리로 줘도 정규식 조립이 안 깨진다.
// 조립이 깨지면 `new RegExp` 가 던져서 이 케이스들이 통과 자체를 못 한다.
const backslash = { ruleChars: ['\\'], heads: [']'] }
ts('이스케이프 — 테두리가 `\\`, 머리가 `]` 인 정상 화면', [
  L(fill('\\', 280)),
  L('] ', true),
  L(fill('\\', 280)),
], 280, backslash, false)
ts('이스케이프 — 테두리가 `\\` 인데 한 칸 좁게 그렸다', [
  L(fill('\\', 276)),
  L(fill('\\', 276)),
], 277, backslash, true)
ts('이스케이프 — 머리에 `-` `]` `\\` 를 다 줘도 판정이 산다', [
  L(fill('=', 280)),
  L('- 하이픈 머리', true),
  L('  hint'),
], 280, { ruleChars: ['='], heads: ['-', ']', '\\'] }, true)
ts('이스케이프 — 테두리 문자에 `]` `^` `-` 가 섞여도 조립이 산다', [
  L(fill('^', 280)),
  L('❯', true),
  L(fill('^', 280)),
], 280, { ruleChars: [']', '^', '-'] }, false)

// ④ 빈 shape·필드 누락·이상값 — 죽지 않고 기본값으로 떨어진다
const brokenGolden = [
  L(rule(280)),
  L(rule(280), true),
  L('  ⏵⏵ auto mode on (shift+tab to cycle)'),
]
ts('빈 shape 는 기본값 (정상 골든)', goldenLines, 280, {}, false)
ts('빈 shape 는 기본값 (깨진 골든)', brokenGolden, 280, {}, true)
ts('null shape 는 기본값', brokenGolden, 280, null, true)
ts('undefined shape 는 기본값', brokenGolden, 280, undefined, true)
ts('빈 배열 필드는 기본값', brokenGolden, 280, { ruleChars: [], heads: [], choiceWords: [] }, true)
ts('문자열 아닌 값·빈 문자열만 든 필드도 기본값', brokenGolden, 280, { ruleChars: [null, '', 3], heads: [''] }, true)
ts('배열 아닌 값도 기본값', brokenGolden, 280, { ruleChars: 'x', heads: 7 }, true)
ts('필드 하나만 준 shape — 테두리는 기본 `─`, 머리만 `$`', [
  L(rule(280)),
  L('$ 첫 머리', true),
  L('$ 둘째 머리'),
  L(rule(280)),
], 280, { heads: ['$'] }, true)
t('그 화면은 기본 heads 로는 머리가 0 이라 정상 (대비)', [
  L(rule(280)),
  L('$ 첫 머리', true),
  L('$ 둘째 머리'),
  L(rule(280)),
], 280, false)

// shape 별 캐시가 서로를 오염시키지 않는다 (조립 결과를 Map 에 넣어 두므로)
ts('캐시 — 커스텀 → 기본 → 커스텀 순으로 불러도 판정이 안 흔들린다 (1)', brokenGolden, 280, eqBox, false)
t('캐시 — 그 사이 기본 shape 호출', brokenGolden, 280, true)
ts('캐시 — 커스텀 → 기본 → 커스텀 순으로 불러도 판정이 안 흔들린다 (2)', brokenGolden, 280, eqBox, false)

// ---- 잔상이 얹힌 테두리 행 (2026-09-09 실사용 스샷 픽셀 복원) ----
//
// Ctrl+Enter 로 입력창이 여러 줄이 된 뒤 화면이 한 줄 밀려, **위 테두리 행에 옛 프레임의
// 전각 글자가 남았다.** 채증은 387x157 스샷의 잉크 구간(셀폭 7px·행높이 17px) —
//   테두리 행: `19-46`(가로선) `49-57 63-71 77-85`(전각 3개) `89-385`(가로선)
//   그 아래  : `❯`(20-25) + 전각 3개 / 전각 3개 / 전각 1개
// 이 모양은 0.10.0 까지 **정상으로 통과했다** (rules 에 안 들어가고 머리도 없어 전 규칙을 비껴간다).
//
// `mid` 는 전각이라 **한 글자가 두 칸**을 먹는다. xterm 의 `translateToString` 은 그 둘째 칸을
// 돌려주지 않으므로 읽어온 문자열 길이는 cols 보다 짧다 — 그래서 판정은 길이가 아니라
// 가로선 비율로 한다. 여기 케이스도 실제와 같게 **칸 수로** 채운다.
const ghost = (cols, mid) => rule(4) + mid + rule(cols - 4 - mid.length * 2)

t('깨짐 — 테두리 행에 옛 글자가 남았다 (Ctrl+Enter 여러 줄 입력창)', [
  L('  ⏺ 앞선 대화'),
  L(ghost(60, 'ㅇㅇㅇ')),
  L('❯ ㅇㅇㅇ'),
  L('  ㅇㅇㅇ'),
  L('  ㅇ'),
  L(rule(60)),
  L('  ⏵⏵ auto mode on'),
], 60, true)

t('정상 — 순수 테두리 두 줄 + 여러 줄 입력 (대비군)', [
  L('  ⏺ 앞선 대화'),
  L(rule(60)),
  L('❯ 첫 줄'),
  L('  둘째 줄'),
  L('  셋째 줄'),
  L(rule(60)),
  L('  ⏵⏵ auto mode on'),
], 60, false)

t('정상 — 상자형 입력창이 폭을 꽉 채워도 모서리로 시작·끝나면 잔상이 아니다', [
  L('╭' + rule(58) + '╮'),
  L('│ > 결제 모듈 버그 수정해줘' + ' '.repeat(30) + '│'),
  L('╰' + rule(58) + '╯'),
], 60, false)

t('정상 — 대화 출력의 구분선은 폭을 꽉 채우지 않는다', [
  L('  ── 요약 ──'),
  L(rule(60)),
  L('❯', true),
  L(rule(60)),
], 60, false)

t('정상 — 잔상 모양이어도 화면 위쪽(대화 이력)이면 손대지 않는다', [
  L(ghost(60, 'ㅇㅇㅇ')),
  ...Array.from({ length: 16 }, (_, i) => L(`  대화 ${i}`)),
  L(rule(60)),
  L('❯', true),
  L(rule(60)),
], 60, false)

// ---- 자동복구를 켤 수 있나 — 채증 8건 리플레이 ----
//
// `~/.agentdeck-screen.log` 에 남은 `detect 깨짐` 8건을 그대로 되돌린다.
// 판정(`judgeScreen`)은 8건 다 **맞았다**(오탐 0). 갈린 것은 "우리가 손댈 일인가" 였고,
// 그 답이 `xterm.cols == pty(sent)` 하나로 정확히 나뉘었다:
//
//   크기 어긋남 4건 = 리사이즈 중간 프레임, 0~3초 만에 **스스로** 복구 → 손대면 안 된다
//   크기 일치  4건 = 자식 프로세스 stdout 이 TUI 를 덮어씀, 26초 지속 → 손대야 한다
//
// 라이브 프로브로는 못 잰다 — Tabby 가 `pane.size` 를 1초 안에 되돌려 놓아서(실측: 78 로
// 넣고 3초 뒤 80) 크기 불일치를 붙들 수 없다. 그래서 실측값을 여기 고정한다.
const FIELD = [
  { at: '00:46:54', tab: '탭 A', xterm: [280, 78], pty: [283, 78], heal: 2, repair: false },
  { at: '01:13:20', tab: '탭 A', xterm: [281, 78], pty: [279, 63], heal: 0, repair: false },
  { at: '01:59:08', tab: '탭 B', xterm: [221, 78], pty: [281, 78], heal: 3, repair: false },
  { at: '02:34:21', tab: '탭 C', xterm: [282, 78], pty: [280, 78], heal: 2, repair: false },
  { at: '02:07:45', tab: '탭 C', xterm: [281, 78], pty: [281, 78], heal: 26, repair: true },
  { at: '02:07:47', tab: '탭 C', xterm: [281, 78], pty: [281, 78], heal: 26, repair: true },
  { at: '02:07:59', tab: '탭 C', xterm: [281, 78], pty: [281, 78], heal: 26, repair: true },
  { at: '02:08:01', tab: '탭 C', xterm: [281, 78], pty: [281, 78], heal: 10, repair: true },
]
for (const f of FIELD) {
  const got = sizeInSync(f.xterm[0], f.xterm[1], f.pty[0], f.pty[1])
  const label = `실측 ${f.at} ${f.tab} — xterm ${f.xterm.join('x')} vs pty ${f.pty.join('x')}`
    + ` (${f.heal}초 지속) → ${f.repair ? '복구' : '보류'}`
  if (got === f.repair) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; console.log(`  FAIL ${label}\n       sizeInSync=${got} 기대=${f.repair}`) }
}

// 경계 — 크기를 모를 때는 막지 않는다 (모른다는 이유로 기능이 죽으면 안 된다)
const tb = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ok   ${name} -> ${got}`) }
  else { fail++; console.log(`  FAIL ${name}\n       want ${want} got ${got}`) }
}
tb('pty 크기를 못 읽었다 → 맞다고 본다', sizeInSync(280, 78, undefined, undefined), true)
tb('xterm 이 아직 1열 (숨은 탭) → 맞다고 본다', sizeInSync(1, 78, 280, 78), true)
tb('행만 어긋나도 어긋난 것', sizeInSync(280, 78, 280, 63), false)
tb('열만 어긋나도 어긋난 것', sizeInSync(280, 78, 279, 78), false)
tb('둘 다 같으면 맞다', sizeInSync(280, 78, 280, 78), true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { process.exit(1) }
