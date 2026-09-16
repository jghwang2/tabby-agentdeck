// 미리보기 패널의 판정 규칙. 핵심은 두 가지 —
// ① 화면 출력에서 주운 것이 "정말 파일 경로처럼 보이는 것" 뿐인가 (에이전트 종류와 무관하게)
// ② 최근 목록이 MRU 로 굴러가고 원본을 건드리지 않는가.
const {
    classify, extensionOf, isKnownExt, stripAnsi, extractPaths, pushRecent,
    parseDelimited, delimiterFor, formatBytes, followModeOf, migrateFollow, planFollow,
    isAutoFollowable,
} = require('../.tmp/viewer.js')

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

// ---------- 분류 ----------
check('md 는 마크다운', classify('D:/a/README.md'), 'markdown')
check('png 는 이미지', classify('shot.PNG'), 'image')
check('csv 는 표', classify('/tmp/data.csv'), 'table')
check('cs 는 글자', classify('src\\Foo.cs'), 'text')
check('xlsm 은 미지원', classify('Item.xlsm'), 'binary')
check('확장자 없는 Dockerfile 도 글자', classify('Dockerfile'), 'text')
check('확장자 추출은 소문자', extensionOf('A/B/C.MD'), 'md')
check('아는 확장자 판정', isKnownExt('a/b.ts'), true)
check('모르는 확장자 판정', isKnownExt('a/b.zip'), false)

// ---------- ANSI / 테두리 제거 ----------
check('SGR 제거', stripAnsi('\x1b[32mEdited\x1b[0m a.ts'), 'Edited a.ts')
check('OSC 제거', stripAnsi('\x1b]0;title\x07x'), 'x')
check('박스문자는 공백으로', stripAnsi('│ a.ts │').trim(), 'a.ts')

// ---------- 경로 줍기 ----------
// Claude Code / Codex / Gemini 가 공통으로 찍는 형태를 그대로 넣어 본다
check('Windows 절대경로', extractPaths('Wrote D:\\Project\\a\\b.md ok')[0], 'D:\\Project\\a\\b.md')
check('POSIX 상대경로', extractPaths('Edited src/hero.tsx +16 -6')[0], 'src/hero.tsx')
check('파일명만 찍은 경우', extractPaths('Read build.py')[0], 'build.py')
check('./ 접두는 떼어낸다', extractPaths('Edited ./tools/shot.ps1')[0], 'tools/shot.ps1')
check('색이 낀 줄에서도 줍는다', extractPaths('\x1b[1m│\x1b[0m Edited \x1b[36msrc/a.ts\x1b[0m')[0], 'src/a.ts')
check('여러 개는 중복 없이 순서대로', extractPaths('Read a.md, then a.md and b.png').join('|'), 'a.md|b.png')
check('URL 안의 파일은 제외', extractPaths('see https://x.io/logo.png').length, 0)
check('버전 문자열은 제외', extractPaths('tabby-agentdeck v0.3.0 ready').length, 0)
check('모르는 확장자는 제외', extractPaths('unpacked bundle.zip').length, 0)
check('잘린 경로(…)는 제외', extractPaths('Edited src/…/a.ts').length, 0)
check('문장부호는 떼어낸다', extractPaths('(see docs/소개.md).')[0], 'docs/소개.md')
check('경로가 없으면 빈 배열', extractPaths('esc to interrupt · 3.2k tokens').length, 0)

// ---------- 최근 목록 ----------
const r1 = pushRecent([], 'a.md', 3)
const r2 = pushRecent(r1, 'b.md', 3)
const r3 = pushRecent(r2, 'a.md', 3)
check('새것이 앞으로', r2.join(','), 'b.md,a.md')
check('있던 것은 위로 올린다 (중복 없음)', r3.join(','), 'a.md,b.md')
check('원본은 그대로', r2.join(','), 'b.md,a.md')
check('상한을 넘으면 뒤를 버린다',
    pushRecent(['a', 'b', 'c'], 'd', 3).join(','), 'd,a,b')

// ---------- CSV/TSV ----------
const rows = parseDelimited('a,b,c\n1,"x,y",3\n')
check('행 수', rows.length, 2)
check('따옴표 안의 구분자 보존', rows[1][1], 'x,y')
check('따옴표 이스케이프', parseDelimited('"a""b"')[0][0], 'a"b')
check('CRLF 도 한 행', parseDelimited('a,b\r\n1,2')[1].join('|'), '1|2')
check('tsv 는 탭 구분', delimiterFor('x.tsv'), '\t')
check('csv 는 쉼표 구분', delimiterFor('x.csv'), ',')

// ---------- 크기 표기 ----------
check('바이트', formatBytes(512), '512 B')
check('킬로바이트', formatBytes(2048), '2.0 KB')
check('메가바이트', formatBytes(3 * 1024 * 1024), '3.0 MB')
check('이상한 값', formatBytes(-1), '?')

// ---------- 따라가기 (읽어두기 / 자동으로 열기) ----------
// 사용자에게는 토글 두 개이고(`viewerPreload`/`viewerAutoOpen`), 안쪽은 세 모드다.
// 사람이 고르는 값이라 이 표가 곧 계약이다 — 조합 전수로 못 박는다.
check('읽어두기만 켜면 읽어두기 모드', followModeOf(true, false), 'show')
check('둘 다 켜면 스스로 연다', followModeOf(true, true), 'open')
check('읽어두기를 끄면 자동열기가 켜져 있어도 수동', followModeOf(false, true), 'manual')
check('둘 다 끄면 수동', followModeOf(false, false), 'manual')
check('값이 없으면 새 기본값 (읽어두기 ON / 자동열기 OFF)', followModeOf(undefined, undefined), 'show')

// 옛 설정 → 토글 두 개 (기동 때 한 번 도는 마이그레이션)
function migrated (raw, legacy) {
    const m = migrateFollow(raw, legacy)
    return m ? `${m.preload}/${m.autoOpen}` : 'null'
}
check('옛 open 은 둘 다 켬', migrated('open', undefined), 'true/true')
check('옛 show 는 읽어두기만', migrated('show', undefined), 'true/false')
check('옛 manual 은 둘 다 끔', migrated('manual', undefined), 'false/false')
check('고른 적 없으면 옮기지 않는다 (새 기본값 그대로)', migrated('', undefined), 'null')
check('그보다 옛 boolean 이 꺼져 있으면 수동으로 옮긴다', migrated('', false), 'false/false')
check('옛 boolean 이 켜져 있으면 옮기지 않는다', migrated('', true), 'null')
check('고른 값이 옛 boolean 을 이긴다', migrated('show', false), 'true/false')
check('모르는 값은 옛 boolean 을 본다', migrated('열기', undefined), 'null')

// [모드, 열려있나, 기대] — 편집 중이 아닐 때의 전수(3 x 2)
const FOLLOW_TABLE = [
    ['open', false, 'open'],
    ['open', true, 'show'],
    // 닫혀 있어도 **읽어는 둔다** — 사람이 여는 순간 방금 만진 파일이 보이게 (stage)
    ['show', false, 'stage'],
    ['show', true, 'show'],
    ['manual', false, 'none'],
    ['manual', true, 'none'],
]
for (const [mode, opened, want] of FOLLOW_TABLE) {
    check(mode + ' / ' + (opened ? '열림' : '닫힘') + ' -> ' + want, planFollow(mode, opened, false), want)
}
// 편집 중에는 모드가 무엇이든 화면을 빼앗지 않는다 — 모드보다 앞서는 규칙이다
let editingBroken = 0
for (const mode of ['open', 'show', 'manual']) {
    for (const opened of [true, false]) {
        if (planFollow(mode, opened, true) !== 'none') {
            editingBroken++
        }
    }
}
check('편집 중이면 전 조합(6)이 아무것도 하지 않는다', editingBroken, 0)
// 닫힌 패널을 스스로 여는 갈래는 하나뿐이다 — `패널 자동으로 열기` 토글이 그 하나를 쥔다
check('닫힌 패널을 여는 모드는 open 뿐',
    ['open', 'show', 'manual'].filter(m => planFollow(m, false, false) === 'open').join(','), 'open')
// 기본값(읽어두기 ON / 자동열기 OFF)에서 닫힌 패널은 **열리지 않지만 비어 있지도 않다**
check('기본값은 닫힌 패널을 열지 않고 읽어만 둔다', planFollow(followModeOf(true, false), false, false), 'stage')
check('읽어두기를 끄면 닫힌 패널에 아무것도 안 한다', planFollow(followModeOf(false, false), false, false), 'none')

// ---------- 스스로 띄울 대상 ----------
// 설정 파일은 칩에는 쌓이되 화면을 가로채지 않는다 (에이전트가 기동하며 찍는 경로)
check('~/.claude/settings.json 은 자동으로 안 띄운다',
    isAutoFollowable('C:\\Users\\me\\.claude\\settings.json'), false)
check('프로젝트 settings.local.json 도 안 띄운다',
    isAutoFollowable('D:/proj/.claude/settings.local.json'), false)
check('.vscode/settings.json 도 같은 규칙', isAutoFollowable('/p/.vscode/settings.json'), false)
check('~/.claude.json 도 안 띄운다', isAutoFollowable('C:\\Users\\me\\.claude.json'), false)
check('작업 파일은 그대로 띄운다', isAutoFollowable('D:/proj/src/deck.service.ts'), true)
check('이름이 비슷해도 다른 파일은 띄운다', isAutoFollowable('D:/proj/settings.md'), true)
check('package.json 은 띄운다', isAutoFollowable('D:/proj/package.json'), true)

console.log(`\nviewer: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
