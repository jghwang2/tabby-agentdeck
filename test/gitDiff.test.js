// `변경` 탭의 파싱 규칙. 근거를 에이전트 훅이 아니라 `git diff` 에 두었으므로(누가 고쳤든
// 작업트리에는 같은 모양으로 남는다) 여기서 고정해야 하는 것은 세 가지다 —
// ① 줄번호를 양쪽 다 맞게 세는가 ② 헤더줄(`+++`/`---`)이 ± 카운트에 섞이지 않는가
// ③ 경로에 공백·한글이 있어도, 헝크 본문에 diff 글자가 들어 있어도 어긋나지 않는가.
const {
    parseUnifiedDiff, formatStat, statusLabel, unquotePath, parseUntracked,
    refLineNo, refPathFrom, joinRefPath, formatLineRef, filterTouched,
} = require('../.tmp/gitDiff.js')

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

// ---------- 단일 파일 수정: 줄번호 계산 ----------
const one = lf([
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,4 @@ export function boot () {',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' return a',
])
const f1 = parseUnifiedDiff(one)
check('파일 하나', f1.length, 1)
check('경로', f1[0].path, 'src/a.ts')
check('상태는 수정', f1[0].status, 'modified')
check('옛 경로는 없다', f1[0].oldPath, undefined)
check('바이너리 아님', f1[0].binary, false)
// 헤더 `+++`/`---` 가 섞이면 3/2 가 된다 — 이게 이 파서에서 가장 흔한 버그다
check('추가 줄 수', f1[0].added, 2)
check('삭제 줄 수', f1[0].removed, 1)
check('줄 개수 (헝크머리 포함)', f1[0].lines.length, 6)
check('헝크 머리줄은 꼬리 함수명까지 보존',
    f1[0].lines[0].text, '@@ -10,3 +10,4 @@ export function boot () {')
check('헝크 종류', f1[0].lines[0].kind, 'hunk')
check('문맥줄 양쪽 번호', `${f1[0].lines[1].oldNo}/${f1[0].lines[1].newNo}`, '10/10')
check('문맥줄 본문 (앞 공백 제거)', f1[0].lines[1].text, 'const a = 1')
check('삭제줄 종류', f1[0].lines[2].kind, 'del')
check('삭제줄은 구 번호만', `${f1[0].lines[2].oldNo}/${f1[0].lines[2].newNo}`, '11/undefined')
check('추가줄 종류', f1[0].lines[3].kind, 'add')
check('추가줄은 신 번호만', `${f1[0].lines[3].oldNo}/${f1[0].lines[3].newNo}`, 'undefined/11')
check('둘째 추가줄 번호', f1[0].lines[4].newNo, 12)
check('삭제 뒤 문맥줄은 양쪽이 어긋난다',
    `${f1[0].lines[5].oldNo}/${f1[0].lines[5].newNo}`, '12/13')

// ---------- CRLF 입력 ----------
const crlf = parseUnifiedDiff(one.replace(/\n/g, '\r\n'))
check('CRLF 도 같은 결과', crlf[0].added, 2)
check('CRLF 에서 \\r 이 본문에 남지 않는다', crlf[0].lines[2].text, 'const b = 2')

// ---------- 신규 파일 ----------
const added = parseUnifiedDiff(lf([
    'diff --git a/docs/NEW.md b/docs/NEW.md',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/docs/NEW.md',
    '@@ -0,0 +1,2 @@',
    '+첫 줄',
    '+둘째 줄',
]))
check('신규 파일 상태', added[0].status, 'added')
check('신규 파일 경로', added[0].path, 'docs/NEW.md')
check('신규 파일 추가 수', added[0].added, 2)
check('신규 파일 삭제 수', added[0].removed, 0)
check('신규 파일 첫 줄 번호', added[0].lines[1].newNo, 1)

// ---------- 삭제 파일 ----------
const deleted = parseUnifiedDiff(lf([
    'diff --git a/old.txt b/old.txt',
    'deleted file mode 100644',
    'index 3333333..0000000',
    '--- a/old.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-a',
    '-b',
]))
check('삭제 파일 상태', deleted[0].status, 'deleted')
check('삭제 파일 경로', deleted[0].path, 'old.txt')
check('삭제 파일 삭제 수', deleted[0].removed, 2)

// ---------- 이름 변경 (옛 경로에 공백) ----------
const renamed = parseUnifiedDiff(lf([
    'diff --git a/old name.md b/docs/new.md',
    'similarity index 95%',
    'rename from old name.md',
    'rename to docs/new.md',
    'index 1111111..2222222 100644',
    '--- a/old name.md',
    '+++ b/docs/new.md',
    '@@ -1 +1 @@',
    '-hi',
    '+hello',
]))
check('이름변경 상태', renamed[0].status, 'renamed')
check('이름변경 새 경로', renamed[0].path, 'docs/new.md')
check('이름변경 옛 경로', renamed[0].oldPath, 'old name.md')
// `@@ -1 +1 @@` 처럼 개수가 생략된 헝크(=1줄)도 먹어야 한다
check('개수 생략 헝크 추가 수', renamed[0].added, 1)
check('개수 생략 헝크 삭제 수', renamed[0].removed, 1)

// ---------- 바이너리 ----------
const bin = parseUnifiedDiff(lf([
    'diff --git a/img/shot.png b/img/shot.png',
    'index 1111111..2222222 100644',
    'Binary files a/img/shot.png and b/img/shot.png differ',
]))
check('바이너리 표시', bin[0].binary, true)
check('바이너리는 줄이 없다', bin[0].lines.length, 0)
check('바이너리 카운트는 0', `${bin[0].added}/${bin[0].removed}`, '0/0')
const binNew = parseUnifiedDiff(lf([
    'diff --git a/img/new.png b/img/new.png',
    'new file mode 100644',
    'index 0000000..2222222',
    'Binary files /dev/null and b/img/new.png differ',
]))
check('신규 바이너리 상태', binNew[0].status, 'added')
check('신규 바이너리 경로', binNew[0].path, 'img/new.png')

// ---------- 공백 든 경로 (따옴표 없이) ----------
const spaced = parseUnifiedDiff(lf([
    'diff --git a/my notes.md b/my notes.md',
    'index 1111111..2222222 100644',
    '--- a/my notes.md',
    '+++ b/my notes.md',
    '@@ -1 +1 @@',
    '-a',
    '+b',
]))
check('공백 든 경로', spaced[0].path, 'my notes.md')
check('공백 든 경로는 이름변경이 아니다', spaced[0].oldPath, undefined)

// ---------- 한글 경로 (git 이 8진 이스케이프로 감싼다) ----------
// core.quotePath 기본값 때문에 실제 출력이 이 모양이다. 바이트 단위 이스케이프를 모아서
// UTF-8 로 읽지 않으면 한글이 전부 깨진다
const KO = '"a/docs/\\355\\225\\234\\352\\270\\200 \\355\\214\\214\\354\\235\\274.md"'
const KO_B = '"b/docs/\\355\\225\\234\\352\\270\\200 \\355\\214\\214\\354\\235\\274.md"'
check('따옴표 경로 풀기', unquotePath(KO), 'a/docs/한글 파일.md')
const korean = parseUnifiedDiff(lf([
    'diff --git ' + KO + ' ' + KO_B,
    'index 1111111..2222222 100644',
    '--- ' + KO,
    '+++ ' + KO_B,
    '@@ -1 +1 @@',
    '-옛 줄',
    '+새 줄',
]))
check('한글 경로', korean[0].path, 'docs/한글 파일.md')
check('한글 경로는 이름변경이 아니다', korean[0].oldPath, undefined)
check('한글 본문 보존', korean[0].lines[2].text, '새 줄')

// ---------- 개행 없음 표시 ----------
const noNl = parseUnifiedDiff(lf([
    'diff --git a/a.txt b/a.txt',
    'index 1111111..2222222 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-a',
    '\\ No newline at end of file',
    '+b',
    '\\ No newline at end of file',
]))
// 줄로 세면 뒤 번호가 한 칸씩 밀린다 — 그래서 버린다
check('개행없음 표시는 줄로 세지 않는다', noNl[0].lines.length, 3)
check('개행없음이 있어도 카운트는 그대로', `${noNl[0].added}/${noNl[0].removed}`, '1/1')

// ---------- 헝크 본문에 diff 글자가 들어 있는 경우 ----------
// 앞머리 기호만 보고 헤더/본문을 가르면 여기서 파일이 두 개로 쪼개진다.
// 헝크가 선언한 줄 수를 세면서 먹기 때문에 어긋나지 않는다
const nested = parseUnifiedDiff(lf([
    'diff --git a/patch.diff b/patch.diff',
    'index 1111111..2222222 100644',
    '--- a/patch.diff',
    '+++ b/patch.diff',
    '@@ -1,2 +1,3 @@',
    ' diff --git a/x b/x',
    '-+++ b/x',
    '++++ b/y',
    '+@@ -1 +1 @@',
]))
check('중첩 diff 도 파일 하나', nested.length, 1)
check('중첩 diff 문맥줄 보존', nested[0].lines[1].text, 'diff --git a/x b/x')
check('중첩 diff 카운트', `${nested[0].added}/${nested[0].removed}`, '2/1')

// ---------- 여러 파일 + 요약 문구 ----------
const many = parseUnifiedDiff(lf([
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,5 +1,6 @@',
    ' one',
    '-two',
    '-three',
    '-four',
    '-five',
    '+2',
    '+3',
    '+4',
    '+5',
    '+six',
    'diff --git a/README.md b/README.md',
    'index 3333333..4444444 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -7,4 +7,6 @@ intro',
    ' x',
    '-y',
    '-z',
    '+Y',
    '+Z',
    '+W',
    '+V',
    ' tail',
]))
check('파일 두 개', many.length, 2)
check('첫 파일 카운트', `${many[0].added}/${many[0].removed}`, '5/4')
check('둘째 파일 카운트', `${many[1].added}/${many[1].removed}`, '4/2')
check('둘째 파일 둘째 헝크 시작 번호', many[1].lines[1].oldNo, 7)
check('요약 문구', formatStat(many), '2개 파일 · +9 -6')

// ---------- 경계 ----------
check('빈 입력', parseUnifiedDiff('').length, 0)
check('공백만 있는 입력', parseUnifiedDiff('\n \n').length, 0)
check('null 입력', parseUnifiedDiff(null).length, 0)
check('변경 없음 문구', formatStat([]), '변경 없음')
check('한 파일 요약', formatStat(f1), '1개 파일 · +2 -1')
check('상태 딱지 수정', statusLabel(f1[0]), '수정')
check('상태 딱지 신규', statusLabel(added[0]), '신규')
check('상태 딱지 삭제', statusLabel(deleted[0]), '삭제')
check('상태 딱지 이름변경', statusLabel(renamed[0]), '이름변경')

// ---------- 추적되지 않는 파일 ----------
const untracked = parseUntracked([
    ' M src/a.ts',
    '?? new.txt',
    '?? "docs/\\355\\225\\234.md"',
    'A  staged.ts',
].join('\n'))
check('?? 항목만 뽑는다', untracked.length, 2)
check('추적안됨 첫 항목', untracked[0], 'new.txt')
check('추적안됨 한글 경로', untracked[1], 'docs/한.md')

// ---------- `파일:라인` 참조: 어느 줄번호를 쓰는가 ----------
// 참조를 받는 에이전트는 **지금 디스크에 있는 파일**을 열어 본다 — 그래서 신(新) 번호만 맞다.
// 삭제줄은 그 파일에 없으므로 참조 불가(null)이고, 그걸 "직전 번호" 로 때우면 엉뚱한 줄을 고친다.
check('문맥줄은 신 번호', refLineNo(f1[0].lines[1]), 10)
check('삭제줄은 참조 불가', refLineNo(f1[0].lines[2]), null)
check('추가줄은 신 번호', refLineNo(f1[0].lines[3]), 11)
check('둘째 추가줄', refLineNo(f1[0].lines[4]), 12)
// 삭제 뒤 문맥줄 — 구 12 / 신 13 인 자리다. 구 번호를 쓰면 한 줄 위를 가리킨다
check('삭제 뒤 문맥줄은 신 번호(13)', refLineNo(f1[0].lines[5]), 13)
check('헝크 머리줄은 참조 불가', refLineNo(f1[0].lines[0]), null)
check('null 줄', refLineNo(null), null)
check('undefined 줄', refLineNo(undefined), null)
check('신 번호 없는 문맥줄(비정상 입력)', refLineNo({ kind: 'ctx', text: 'x' }), null)
// 삭제만 있는 파일(삭제된 파일)은 참조할 줄이 하나도 없다 — 그 파일이 이제 없으니 맞는 결과다
check('삭제 파일은 참조 가능 줄 0개',
    deleted[0].lines.filter(l => refLineNo(l) !== null).length, 0)
check('신규 파일 첫 줄 참조', refLineNo(added[0].lines[1]), 1)

// ---------- 헝크 경계 · 여러 파일이 섞인 diff ----------
// 헝크가 둘이면 번호가 이어지지 않고 **헝크 머리가 선언한 값으로 튄다.** 그 지점에서 한 칸
// 밀리는 것이 참조 기능의 가장 큰 위험이라 여기서 못 박는다.
const mixed = parseUnifiedDiff(lf([
    'diff --git a/src/one.ts b/src/one.ts',
    'index 1111111..2222222 100644',
    '--- a/src/one.ts',
    '+++ b/src/one.ts',
    '@@ -1,3 +1,3 @@',
    ' head',
    '-old',
    '+new',
    ' tail',
    '@@ -50,4 +50,5 @@ func () {',
    ' a',
    '-b',
    '-c',
    '+B',
    '+C',
    '+D',
    ' d',
    'diff --git a/docs/두 번째.md b/docs/두 번째.md',
    'index 3333333..4444444 100644',
    '--- a/docs/두 번째.md',
    '+++ b/docs/두 번째.md',
    '@@ -7 +7 @@',
    '-지운 줄',
    '+넣은 줄',
]))
check('섞인 diff 파일 두 개', mixed.length, 2)
const refs = f => f.lines.map(l => refLineNo(l)).join(',')
// 첫 헝크: hunk(null) head(1) -old(null) +new(2) tail(3)
// 둘째 헝크: hunk(null) a(50) -b(null) -c(null) +B(51) +C(52) +D(53) d(54)
check('헝크 경계에서 신 번호가 튄다', refs(mixed[0]), ',1,,2,3,,50,,,51,52,53,54')
check('둘째 파일 신 번호', refs(mixed[1]), ',,7')
check('둘째 파일 경로(공백·한글)', mixed[1].path, 'docs/두 번째.md')

// ---------- 참조 경로: cwd 기준으로 줄인다 ----------
check('cwd 안이면 상대경로', refPathFrom('D:/Project/deck/src/a.ts', 'D:/Project/deck'), 'src/a.ts')
check('윈도우 cwd 는 `\\` 로 온다', refPathFrom('D:/Project/deck/src/a.ts', 'D:\\Project\\deck'), 'src/a.ts')
check('윈도우는 대소문자를 가리지 않는다',
    refPathFrom('D:/Project/Deck/src/a.ts', 'd:\\project\\deck'), 'src/a.ts')
check('cwd 끝의 슬래시', refPathFrom('D:/Project/deck/src/a.ts', 'D:/Project/deck/'), 'src/a.ts')
// cwd 가 하위 폴더면 위쪽 파일은 `../` 로 올리지 않고 절대경로로 준다 (에이전트가 cwd 밖을
// 못 여는 경우가 있고, 그때 원인이 보이지 않는다)
check('cwd 밖은 절대경로', refPathFrom('D:/Project/deck/docs/x.md', 'D:/Project/deck/src'),
    'D:/Project/deck/docs/x.md')
check('다른 드라이브도 절대경로', refPathFrom('E:/tmp/x.md', 'D:/Project/deck'), 'E:/tmp/x.md')
check('cwd 를 모르면 절대경로', refPathFrom('D:/Project/deck/src/a.ts', null), 'D:/Project/deck/src/a.ts')
check('cwd 가 그 파일과 같은 문자열', refPathFrom('D:/Project/deck', 'D:/Project/deck'), 'D:/Project/deck')
// POSIX 에서는 대소문자가 정말 다른 폴더다 — 드라이브 접두가 없으면 무시하지 않는다
check('POSIX 는 대소문자를 가린다', refPathFrom('/home/A/src/a.ts', '/home/a'), '/home/A/src/a.ts')
check('POSIX 상대경로', refPathFrom('/home/a/src/a.ts', '/home/a'), 'src/a.ts')
check('빈 경로', refPathFrom('', 'D:/x'), '')
check('접두가 같아도 폴더 경계가 아니면 안 자른다',
    refPathFrom('D:/Project/deck2/src/a.ts', 'D:/Project/deck'), 'D:/Project/deck2/src/a.ts')

check('루트 + git 경로', joinRefPath('D:/Project/deck', 'src/a.ts'), 'D:/Project/deck/src/a.ts')
check('루트가 `\\` 여도 `/` 로', joinRefPath('D:\\Project\\deck', 'src/a.ts'), 'D:/Project/deck/src/a.ts')
check('루트 끝 슬래시', joinRefPath('D:/Project/deck/', 'src/a.ts'), 'D:/Project/deck/src/a.ts')
check('루트를 모르면 그대로', joinRefPath(null, 'src/a.ts'), 'src/a.ts')
check('이미 절대경로면 그대로', joinRefPath('D:/x', 'E:/y/z.ts'), 'E:/y/z.ts')
check('빈 상대경로', joinRefPath('D:/x', ''), '')

// ---------- 참조 문자열 ----------
check('한 줄', formatLineRef('src/a.ts', 12), 'src/a.ts:12')
check('범위', formatLineRef('src/a.ts', 12, 20), 'src/a.ts:12-20')
check('같은 줄 범위는 한 줄로', formatLineRef('src/a.ts', 12, 12), 'src/a.ts:12')
check('뒤집힌 범위도 오름차순으로', formatLineRef('src/a.ts', 20, 12), 'src/a.ts:12-20')
// 공백이 든 경로는 따옴표로 감싼다 — 셸이 두 인자로 쪼갠다 (drop 붙여넣기와 같은 규칙)
check('공백 든 경로는 따옴표', formatLineRef('docs/두 번째.md', 7), '"docs/두 번째.md:7"')
check('공백 든 경로 범위', formatLineRef('my notes.md', 3, 5), '"my notes.md:3-5"')
check('한글만 있으면 따옴표 없음', formatLineRef('docs/한글.md', 3), 'docs/한글.md:3')
check('번호가 없으면 경로만', formatLineRef('src/a.ts'), 'src/a.ts')
check('0 번은 경로만', formatLineRef('src/a.ts', 0), 'src/a.ts')
check('NaN 은 경로만', formatLineRef('src/a.ts', NaN), 'src/a.ts')
check('빈 경로는 빈 문자열', formatLineRef('', 12), '')
check('절대경로 참조', formatLineRef('D:/Project/deck/src/a.ts', 4), 'D:/Project/deck/src/a.ts:4')

// 실제 흐름 한 벌 — git 경로 → 절대 → cwd 상대 → 참조 문자열
// lines[9] = `+B`(신 51), lines[11] = `+D`(신 53) — 둘째 헝크의 추가줄 세 개 중 처음과 끝
const flowNo = refLineNo(mixed[0].lines[9])
check('흐름: 고른 줄 번호', flowNo, 51)
check('흐름: 참조 문자열',
    formatLineRef(refPathFrom(joinRefPath('D:/Project/deck', mixed[0].path), 'D:\\Project\\deck'),
        flowNo, refLineNo(mixed[0].lines[11])),
    'src/one.ts:51-53')

// ---------- 세션 범위 좁히기 ----------
// `변경` 탭이 "이 세션이 만진 것만" 을 그릴 때 쓰는 규칙. 훅이 주는 절대경로와 git 이 주는
// 루트 기준 경로를 맞춰야 하고, **근거가 없으면(빈 목록) 좁히지 않아야** 한다.
const ROOT = 'D:/Project/deck'
const FILES = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'docs/한글.md' }]
const pathOf = f => f.path
check('만진 것만 남긴다',
    filterTouched(FILES, pathOf, ROOT, ['D:/Project/deck/src/b.ts']).map(pathOf).join(','), 'src/b.ts')
check('윈도우 구분자·대소문자 무시',
    filterTouched(FILES, pathOf, ROOT, ['d:\\project\\DECK\\src\\a.ts']).map(pathOf).join(','), 'src/a.ts')
check('한글 경로도 맞는다',
    filterTouched(FILES, pathOf, ROOT, ['D:/Project/deck/docs/한글.md']).map(pathOf).join(','), 'docs/한글.md')
check('빈 목록이면 좁히지 않는다 (= 근거가 없다는 뜻)',
    filterTouched(FILES, pathOf, ROOT, []).length, 3)
check('저장소 밖 파일은 아무것도 안 남긴다',
    filterTouched(FILES, pathOf, ROOT, ['C:/tmp/x.ts']).length, 0)
check('루트를 모르면 상대경로끼리도 맞는다',
    filterTouched(FILES, pathOf, null, ['src/a.ts']).map(pathOf).join(','), 'src/a.ts')
check('문자열 목록(추적 안 됨)도 같은 규칙',
    filterTouched(['new.md', 'old.md'], p => p, ROOT, ['D:/Project/deck/new.md']).join(','), 'new.md')
check('같은 이름 다른 폴더는 안 걸린다',
    filterTouched([{ path: 'src/a.ts' }], pathOf, ROOT, ['D:/other/src/a.ts']).length, 0)

console.log(`\ngitDiff: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
