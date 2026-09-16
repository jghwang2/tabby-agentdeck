// 스테이지·커밋의 "무엇을 실행할지" 를 고정한다. 실행은 viewPanel 이 사람의 클릭에만 반응해서
// 하고, 여기서는 **인자 배열**까지만 본다 — 그래서 이 테스트는 어떤 저장소도 건드리지 않는다.
//
// 고정해야 하는 것 네 가지 —
// ① 두 글자 상태코드(XY)를 스테이지/작업트리로 옳게 갈랐는가 (충돌·부분 스테이지 포함)
// ② 경로가 따옴표·공백·한글·이름변경이어도 어긋나지 않는가 (`-z` 는 순서가 뒤집힌다)
// ③ 인자 순서 — 메시지는 `-m` 의 **원소 하나**, 경로 앞에는 `--` (주입 경로가 없다는 것)
// ④ 빈 메시지·빈 경로는 **빈 배열**을 낸다 (우발 실행 시에도 커밋이 안 만들어지는 두 번째 잠금)
const {
    parseStatus, stageStateOf, stageLabel, stageArgs, unstageArgs, unstageFallbackArgs,
    validateMessage, commitArgs, hasStaged, formatStageSummary,
} = require('../.tmp/gitCommit.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name} -> ${got}`)
        pass++
    } else {
        console.log(`  FAIL ${name} -> ${got} (기대: ${want})`)
        fail++
    }
}

/** 픽스처는 줄 배열로 둔다 — 이 파일이 CRLF 로 저장돼도 입력은 LF 로 고정된다 */
const lf = lines => lines.join('\n') + '\n'
/** 소스에 리터럴 NUL 을 넣으면 파일이 바이너리로 취급된다 — 이스케이프로만 적는다 */
const NUL = '\u0000'

// ---------- 상태코드 (XY) ----------
check('XY 스테이지만', stageStateOf('M', ' '), 'staged')
check('XY 작업트리만', stageStateOf(' ', 'M'), 'unstaged')
check('XY 양쪽 = 부분 스테이지', stageStateOf('M', 'M'), 'both')
check('XY 신규 스테이지', stageStateOf('A', ' '), 'staged')
check('XY 삭제 스테이지', stageStateOf('D', ' '), 'staged')
check('XY 이름변경 스테이지', stageStateOf('R', ' '), 'staged')
check('XY 추적안됨', stageStateOf('?', '?'), 'untracked')
// 충돌을 먼저 걸러야 한다 — AA·UU 는 "양쪽에 값이 있다" 도 만족해서 both 로 샌다
check('XY 충돌 UU', stageStateOf('U', 'U'), 'conflict')
check('XY 충돌 AA', stageStateOf('A', 'A'), 'conflict')
check('XY 충돌 DD', stageStateOf('D', 'D'), 'conflict')
check('XY 충돌 AU', stageStateOf('A', 'U'), 'conflict')
check('XY 충돌 UA', stageStateOf('U', 'A'), 'conflict')
check('XY 충돌 DU', stageStateOf('D', 'U'), 'conflict')
check('XY 충돌 UD', stageStateOf('U', 'D'), 'conflict')
check('딱지 올림', stageLabel('staged'), '올림')
check('딱지 안올림', stageLabel('unstaged'), '안올림')
check('딱지 일부', stageLabel('both'), '일부')
check('딱지 새파일', stageLabel('untracked'), '새파일')
check('딱지 충돌', stageLabel('conflict'), '충돌')

// ---------- 줄 형식 파싱 ----------
const st = parseStatus(lf([
    ' M src/a.ts',
    'M  src/b.ts',
    'MM src/c.ts',
    'A  src/new.ts',
    ' D src/gone.ts',
    'UU src/conflict.ts',
    '?? out.log',
    '!! ignored.log',
    '## main...origin/main',
]))
check('무시(!!)·머리줄(##)은 버린다', st.length, 7)
check('첫 항목 경로', st[0].path, 'src/a.ts')
check('첫 항목 상태', st[0].state, 'unstaged')
check('첫 항목 코드 보존', `${st[0].index}|${st[0].work}`, ' |M')
check('둘째 항목 상태', st[1].state, 'staged')
check('둘째 항목 코드', `${st[1].index}|${st[1].work}`, 'M| ')
check('부분 스테이지', st[2].state, 'both')
check('신규 스테이지', st[3].state, 'staged')
check('작업트리 삭제', st[4].state, 'unstaged')
check('충돌', st[5].state, 'conflict')
check('추적안됨', `${st[6].state}/${st[6].path}`, 'untracked/out.log')
check('옛 경로는 없다', st[0].oldPath, undefined)

// ---------- 경로: 따옴표 · 공백 · 한글 ----------
const paths = parseStatus(lf([
    '?? "a b.md"',
    ' M "docs/\\355\\225\\234.md"',
    '?? plain space.md',
    'A  "with\\"quote.md"',
]))
check('따옴표 벗기고 공백 보존', paths[0].path, 'a b.md')
check('8진 이스케이프 한글 경로', paths[1].path, 'docs/한.md')
check('따옴표 없는 공백 경로', paths[2].path, 'plain space.md')
check('경로 안의 따옴표', paths[3].path, 'with"quote.md')

// ---------- 이름변경 (줄 형식: ORIG -> PATH) ----------
const ren = parseStatus(lf([
    'R  src/old.ts -> src/new.ts',
    'RM "a b.md" -> "docs/\\355\\225\\234.md"',
    'C  src/base.ts -> src/copy.ts',
]))
check('이름변경 새 경로', ren[0].path, 'src/new.ts')
check('이름변경 옛 경로', ren[0].oldPath, 'src/old.ts')
check('이름변경은 스테이지 상태', ren[0].state, 'staged')
check('이름변경 + 작업트리 수정 = 부분', ren[1].state, 'both')
check('따옴표 이름변경 새 경로', ren[1].path, 'docs/한.md')
check('따옴표 이름변경 옛 경로', ren[1].oldPath, 'a b.md')
check('복사도 경로 두 개', `${ren[2].oldPath} -> ${ren[2].path}`, 'src/base.ts -> src/copy.ts')

// ---------- -z 형식 ----------
// 실측: `git status --porcelain -z` → `b' M docs/ORCHESTRATION.md\x00'` (XY 뒤 공백 한 칸,
// 레코드마다 NUL, 따옴표 없음)
const z = parseStatus(' M src/a.ts' + NUL + '?? "quoted".md' + NUL + 'MM src/c.ts' + NUL)
check('-z 항목 수', z.length, 3)
check('-z 경로', z[0].path, 'src/a.ts')
check('-z 상태', z[0].state, 'unstaged')
// -z 는 git 이 따옴표를 쓰지 않으므로 벗기면 안 된다 (이름이 실제로 그런 파일이 망가진다)
check('-z 는 따옴표를 벗기지 않는다', z[1].path, '"quoted".md')
check('-z 부분 스테이지', z[2].state, 'both')
// git-status(1): `-z` 에서는 `->` 가 사라지고 **순서가 뒤집힌다** (PATH 먼저, ORIG 뒤)
const zr = parseStatus('R  src/new.ts' + NUL + 'src/old.ts' + NUL + ' M src/tail.ts' + NUL)
check('-z 이름변경 새 경로', zr[0].path, 'src/new.ts')
check('-z 이름변경 옛 경로', zr[0].oldPath, 'src/old.ts')
check('-z 이름변경 뒤 항목이 밀리지 않는다', zr.length, 2)
check('-z 이름변경 뒤 항목 경로', zr[1].path, 'src/tail.ts')

// ---------- 경계 ----------
check('빈 입력', parseStatus('').length, 0)
check('공백만', parseStatus('\n \n').length, 0)
check('null 입력', parseStatus(null).length, 0)
check('CRLF 입력', parseStatus(' M a.ts\r\nM  b.ts\r\n').length, 2)
check('CRLF 경로에 CR 이 안 붙는다', parseStatus(' M a.ts\r\n')[0].path, 'a.ts')
check('부스러기 줄(3글자 미만)', parseStatus('M\n').length, 0)

// ---------- 스테이지 인자 ----------
check('add 인자 순서', stageArgs(['a.ts', 'b.ts']).join('|'), 'add|--|a.ts|b.ts')
check('reset 인자 순서', unstageArgs(['a.ts']).join('|'), 'reset|-q|--|a.ts')
check('첫 커밋 전 대체 인자', unstageFallbackArgs(['a.ts']).join('|'), 'rm|--cached|-q|--|a.ts')
// 경로가 없으면 빈 배열 — 인자 없는 `git add` 는 저장소 전체, `git reset` 은 스테이지 전체다
check('빈 목록 add', stageArgs([]).length, 0)
check('빈 목록 reset', unstageArgs([]).length, 0)
check('빈 문자열만', stageArgs(['']).length, 0)
check('null 목록', stageArgs(null).length, 0)
check('중복 제거', stageArgs(['a.ts', 'a.ts']).join('|'), 'add|--|a.ts')
check('NUL 든 경로는 버린다', stageArgs(['a' + NUL + 'b']).length, 0)
// `--` 뒤라서 옵션처럼 보이는 파일명도 그대로 경로다
check('옵션처럼 보이는 파일명', stageArgs(['-f']).join('|'), 'add|--|-f')
check('공백 든 경로는 다듬지 않는다', stageArgs([' a b.md ']).join('|'), 'add|--| a b.md ')

// ---------- 메시지 검증 ----------
check('빈 메시지 거부', validateMessage('').ok, false)
check('빈 메시지 이유가 있다', /비어 있다/.test(validateMessage('').reason), true)
check('공백만 거부', validateMessage('   ').ok, false)
check('개행만 거부', validateMessage('\n\n').ok, false)
check('개행만 이유', /공백·줄바꿈만/.test(validateMessage('\n').reason), true)
check('탭만 거부', validateMessage('\t').ok, false)
check('null 거부', validateMessage(null).ok, false)
check('NUL 든 메시지 거부', validateMessage('a' + NUL + 'b').ok, false)
check('너무 긴 메시지 거부', validateMessage('x'.repeat(8001)).ok, false)
check('정상 메시지', validateMessage('fix: 스테이지 토글').ok, true)
check('정상 메시지는 이유가 없다', validateMessage('ok').reason, undefined)
check('여러 줄 메시지도 정상', validateMessage('제목\n\n본문').ok, true)

// ---------- 커밋 인자 ----------
const c1 = commitArgs('스테이지 토글 추가')
check('커밋 인자 개수', c1.length, 3)
check('커밋 인자 순서', `${c1[0]}|${c1[1]}`, 'commit|-m')
check('메시지는 원소 하나', c1[2], '스테이지 토글 추가')
// 셸을 거치지 않는다 — 메시지에 무엇이 들어와도 배열 원소 하나이고 인자 개수가 늘지 않는다
const inj = commitArgs('a" && rm -rf / #$(whoami) `id`')
check('주입 시도도 원소 하나', inj.length, 3)
check('주입 시도 원문 보존', inj[2], 'a" && rm -rf / #$(whoami) `id`')
const am = commitArgs('고침', { amend: true })
check('amend 인자 순서', am.join('|'), 'commit|--amend|-m|고침')
// 검증에 걸린 메시지는 인자 자체가 없다 (버튼 잠금과 별개인 두 번째 안전장치)
check('빈 메시지는 인자 없음', commitArgs('').length, 0)
check('공백 메시지는 인자 없음', commitArgs('  \n ').length, 0)
check('null 메시지는 인자 없음', commitArgs(null).length, 0)

// ---------- 요약 ----------
check('요약 문구', formatStageSummary(st), '3개 스테이지 · 3개 미스테이지 · 1개 추적안됨 · 1개 충돌')
check('빈 요약', formatStageSummary([]), '변경 없음')
check('null 요약', formatStageSummary(null), '변경 없음')
check('부분 스테이지는 양쪽에 센다',
    formatStageSummary(parseStatus(lf(['MM a.ts']))), '1개 스테이지 · 1개 미스테이지')
check('스테이지만', formatStageSummary(parseStatus(lf(['M  a.ts']))), '1개 스테이지')
check('스테이지 있음', hasStaged(st), true)
check('부분도 스테이지 있음', hasStaged(parseStatus(lf(['MM a.ts']))), true)
check('스테이지 없음', hasStaged(parseStatus(lf([' M a.ts', '?? b.ts']))), false)
check('빈 목록은 스테이지 없음', hasStaged([]), false)
check('null 도 스테이지 없음', hasStaged(null), false)

console.log(`\ngitCommit: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
