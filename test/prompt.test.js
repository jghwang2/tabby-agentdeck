// 입력창 프롬프트 추출 검증 — `npm test` (prompt.ts 를 .tmp 로 컴파일한 뒤 실행)
const { extractPrompt } = require('../.tmp/prompt.js')
let pass=0, fail=0
const t = (name, lines, want) => {
  const got = extractPrompt(lines)
  if (got === want) { pass++; console.log(`  ok   ${name} -> "${got}"`) }
  else { fail++; console.log(`  FAIL ${name}\n       want "${want}"\n       got  "${got}"`) }
}

t('단일 줄', [
  '● 파일을 수정했습니다',
  '',
  '╭──────────────────────────────────────────╮',
  '│ > 결제 모듈 버그 수정해줘                  │',
  '╰──────────────────────────────────────────╯',
  '  ? for shortcuts',
], '결제 모듈 버그 수정해줘')

t('여러 줄', [
  '╭──────────────────────────────────────────╮',
  '│ > 첫 줄이고                               │',
  '│   둘째 줄이다                             │',
  '╰──────────────────────────────────────────╯',
], '첫 줄이고 둘째 줄이다')

t('일반 셸 (상자 없음)', [
  'PS D:\Project> ',
  '',
], '')

t('y/n 확인', [
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. No',
], '')

t('빈 입력창', [
  '╭──────────────────────────────────────────╮',
  '│ >                                        │',
  '╰──────────────────────────────────────────╯',
], '')

t('40자 초과 잘림', [
  '╭────╮',
  '│ > 아주 긴 프롬프트를 넣어서 라벨 길이 제한이 제대로 걸리는지 확인한다 정말로 │',
  '╰────╯',
], '아주 긴 프롬프트를 넣어서 라벨 길이 제한이 제대로 걸리는지 확인한다 정...')

t('상자 아래 힌트는 안 먹음', [
  '╭────╮',
  '│ > 짧은 프롬프트 │',
  '╰────╯',
  '  ⏵⏵ accept edits on (shift+tab to cycle)',
], '짧은 프롬프트')

t('이전 프롬프트 무시하고 마지막 것', [
  '│ > 옛날 프롬프트 │',
  '╰────╯',
  '● 처리했습니다',
  '╭────╮',
  '│ > 지금 프롬프트 │',
  '╰────╯',
], '지금 프롬프트')

t('상자 없는 스타일 (Claude Code 2.1)', [
  '  ⎿ SessionStart:startup says: [이전 세션 미완료]',
  '> agentdeck 기능테스트',
], 'agentdeck 기능테스트')

t('상자 없는 여러 줄', [
  '> 첫 줄이고',
  '  둘째 줄이다',
], '첫 줄이고 둘째 줄이다')

t('상자 없고 내용도 없으면 라벨 없음', [
  '> ',
], '')

// --- 2026-09-01 실측: Claude Code 2.1.252 는 상자 대신 가로선 2줄, 머리는 `❯` ---

t('가로선 스타일 (Claude Code 2.1.252)', [
  '● 파일을 수정했습니다',
  '',
  '────────────────────',
  '❯ 가이드Rag todo 남은거 뭐뭐있지?',
  '────────────────────',
  '  ⏱5s 컨텍스트 사용량: 0%  현재 모델: Opus 5',
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
], '가이드Rag todo 남은거 뭐뭐있지?')

t('가로선 스타일 여러 줄', [
  '────────────────────',
  '❯ 첫 줄이고',
  '  둘째 줄이다',
  '────────────────────',
  '  ? for shortcuts',
], '첫 줄이고 둘째 줄이다')

t('가로선 아래 힌트를 라벨로 삼지 않는다', [
  '────────────────────',
  '❯ 짧은거',
  '────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
], '짧은거')

t('꺾쇠 선택지 커서는 프롬프트가 아니다 (번호)', [
  '❯ 가이드Rag todo 남은거 뭐뭐있지?',
  '',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. No',
], '')

t('꺾쇠 선택지 커서는 프롬프트가 아니다 (무번호)', [
  '❯ 옛 프롬프트',
  'Continue?',
  '❯ Yes',
  '  No',
], '')

t('빈 입력창 (가로선 스타일)', [
  '────────────────────',
  '❯ ',
  '────────────────────',
], '')

// --- shape 주입 (입력창 모양을 밖에서 넣는다) ---
//
// 위 케이스들은 전부 `extractPrompt(lines)` — shape 없이 부른다. 그것이 기본값(Claude Code
// 2.1.x 실측)으로 돌아야 한다는 회귀 방어이고, 아래는 "다른 모양의 TUI 도 판정된다" 쪽이다.
const { DEFAULT_PROMPT_SHAPE } = require('../.tmp/prompt.js')
const ts = (name, lines, shape, want) => {
  const got = extractPrompt(lines, shape)
  if (got === want) { pass++; console.log(`  ok   ${name} -> "${got}"`) }
  else { fail++; console.log(`  FAIL ${name}\n       want "${want}"\n       got  "${got}"`) }
}

const golden = [
  '────────────────────',
  '❯ 가이드Rag todo 남은거 뭐뭐있지?',
  '────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
]

// ① 기본값 == DEFAULT_PROMPT_SHAPE (인자 없이 부른 것과 같아야 한다)
ts('shape 를 명시로 넘겨도 기본값과 같다', golden, DEFAULT_PROMPT_SHAPE, extractPrompt(golden))
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       want ${b}\n       got  ${a}`) }
}
eq('DEFAULT_PROMPT_SHAPE 값이 여태 쓰던 그것', DEFAULT_PROMPT_SHAPE, {
  heads: ['>', '❯', '›', '❭', '➜'],
  choiceWords: ['Yes', 'No'],
  ruleChars: ['─', '━', '═', '-'],
})

// ② 다른 모양의 TUI — 머리가 `$`, 테두리가 `=`, 선택지가 한글
const shellish = { heads: ['$', '|'], choiceWords: ['예', '아니오'], ruleChars: ['='] }
ts('커스텀 shape — 머리 `$`, 테두리 `=`', [
  '========================',
  '$ 결제 모듈 배포 스크립트 고쳐줘',
  '========================',
  '  hint line',
], shellish, '결제 모듈 배포 스크립트 고쳐줘')
t('그 화면은 기본 shape 로는 안 잡힌다 (대비)', [
  '========================',
  '$ 결제 모듈 배포 스크립트 고쳐줘',
  '========================',
], '')
ts('커스텀 shape — 머리 `|`', ['| 파이프 머리도 받는다'], shellish, '파이프 머리도 받는다')
// 한글 선택지 단어. `\b` 로 조립하면 한글은 뒤에 단어경계가 안 생겨 영영 안 맞는다 —
// 그래서 `(?!\w)` 로 잠갔고, 이 케이스가 그 회귀를 잡는다.
ts('커스텀 choiceWords — 한글 선택지는 프롬프트가 아니다', [
  '계속할까요?',
  '❯ 예',
  '  아니오',
], { choiceWords: ['예', '아니오'] }, '')
t('같은 화면을 기본 shape 는 프롬프트로 본다 (대비)', [
  '계속할까요?',
  '❯ 예',
  '  아니오',
], '예 아니오')

// ③ 이스케이프 사고 방지 — `-`·`]`·`\` 를 머리·테두리로 줘도 정규식이 깨지지 않는다
ts('이스케이프 — 머리에 `-` `]` `\\` (`]` 로 입력)', [
  '] 대괄호 머리',
], { heads: ['-', ']', '\\'] }, '대괄호 머리')
ts('이스케이프 — 머리에 `-` `]` `\\` (`\\` 로 입력)', [
  '\\ 백슬래시 머리',
], { heads: ['-', ']', '\\'] }, '백슬래시 머리')
ts('이스케이프 — 머리 `-` (문자클래스 범위로 오해되면 안 된다)', [
  '- 하이픈 머리',
], { heads: ['-'] }, '하이픈 머리')
ts('이스케이프 — 테두리 문자가 `\\` 여도 아래 테두리를 알아본다', [
  '\\\\\\',
  '] 이스케이프 프롬프트',
  '\\\\\\',
  '  hint',
], { heads: [']'], ruleChars: ['\\'] }, '이스케이프 프롬프트')
ts('이스케이프 — 테두리 문자에 `]` `^` 가 섞여도 조립이 산다', [
  '^^^]]]',
  '> 꺾쇠 프롬프트',
  '^^^]]]',
], { ruleChars: [']', '^'] }, '꺾쇠 프롬프트')

// ④ 빈 shape·필드 누락·이상값 — 죽지 않고 기본값으로 떨어진다
ts('빈 shape 는 기본값', golden, {}, '가이드Rag todo 남은거 뭐뭐있지?')
ts('null shape 는 기본값', golden, null, '가이드Rag todo 남은거 뭐뭐있지?')
ts('undefined shape 는 기본값', golden, undefined, '가이드Rag todo 남은거 뭐뭐있지?')
ts('빈 배열 필드는 기본값', golden, { heads: [], choiceWords: [], ruleChars: [] }, '가이드Rag todo 남은거 뭐뭐있지?')
ts('문자열 아닌 값·빈 문자열만 든 필드도 기본값', golden, { heads: [null, '', 3], ruleChars: [''] }, '가이드Rag todo 남은거 뭐뭐있지?')
ts('배열 아닌 값도 기본값', golden, { heads: 'x', choiceWords: 7 }, '가이드Rag todo 남은거 뭐뭐있지?')
ts('필드 하나만 준 shape — 나머지는 기본값 (테두리는 기본 `─` 로 끊는다)', [
  '────────────────────',
  '$ 부분 shape 도 돈다',
  '────────────────────',
  '  ⏵⏵ auto mode on',
], { heads: ['$'] }, '부분 shape 도 돈다')

// shape 별 캐시가 서로를 오염시키지 않는다 (조립 결과를 Map 에 넣어 두므로)
ts('캐시 — 커스텀 → 기본 → 커스텀 순으로 불러도 결과가 안 흔들린다 (1)', [
  '$ 캐시 확인용',
], shellish, '캐시 확인용')
t('캐시 — 그 사이 기본 shape 호출', golden, '가이드Rag todo 남은거 뭐뭐있지?')
ts('캐시 — 커스텀 → 기본 → 커스텀 순으로 불러도 결과가 안 흔들린다 (2)', [
  '$ 캐시 확인용',
], shellish, '캐시 확인용')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
