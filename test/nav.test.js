// 사이드바 키보드 내비게이션(Ctrl+Shift+L → ↑↓/Home/End → Enter)의 순수 규칙.
// 계약은 두 가지 — ①줄 목록은 **화면에 보이는 순서 그대로**(헤더 → 그 그룹 탭들 → 다음 헤더)이고
// ②커서는 그 줄을 하나도 건너뛰지 않는다. 헤더를 건너뛰면 그룹 A 끝에서 B 첫 줄로 점프해
// "보이는 순서대로 훑는다" 가 깨지고, 훑는 동안 활성 탭이 바뀌지 않는다는 기능 자체가 무의미해진다.
// 두 함수는 `deck.service.ts` 에서 옮겨 왔다(그 파일은 Angular import 때문에 테스트 컴파일 대상이 아니었다).
const { navRowsOf, pickCloseTarget, pickJumpTarget, stepNavIndex } = require('../.tmp/nav.js')

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

/** 구획 하나 — 탭 객체는 참조 동일성으로 포커스를 비교하므로 매번 새로 만든다 */
function sect (key, n, head, collapsed) {
    const tabs = []
    for (let i = 0; i < n; i++) {
        tabs.push({ key, i, name: `${key}${i}` })
    }
    return { key, tabs, head, collapsed }
}

/** 줄 목록을 눈으로 볼 수 있는 문자열로 — 헤더는 `head:키`, 탭은 `tab:이름` */
function desc (rows) {
    return rows.map(r => r.kind === 'head' ? `head:${r.key === null ? '-' : r.key}` : `tab:${r.tab.name}`).join(' ')
}

// ── navRowsOf: 화면을 줄 목록으로 펼치기 ──

check('빈 구획 목록 -> 0행', navRowsOf([]).length, 0)
check('탭 없는 그룹도 헤더 1행', desc(navRowsOf([sect('a', 0, true, false)])), 'head:a')
check('접힌 그룹은 헤더만', desc(navRowsOf([sect('a', 3, true, true)])), 'head:a')
check('펴진 그룹은 헤더 + 탭들', desc(navRowsOf([sect('a', 3, true, false)])), 'head:a tab:a0 tab:a1 tab:a2')
check('withHeads:false 는 헤더 없는 평면 목록', desc(navRowsOf([sect('a', 2, false, false), sect('b', 1, false, false)])), 'tab:a0 tab:a1 tab:b0')
check('그룹 키 null(미분류)도 헤더 한 줄', desc(navRowsOf([sect(null, 1, true, false)])), 'head:- tab:null0')

// 여러 그룹 — 행 순서가 화면 순서(헤더 → 그 그룹 탭들 → 다음 헤더)와 같은지를 문자열로 못 박는다
const mixed = navRowsOf([
    sect('a', 2, true, false),
    sect('b', 0, true, false),
    sect('c', 2, true, true),
    sect('d', 1, true, false),
])
check('여러 그룹: 화면 순서 전문', desc(mixed), 'head:a tab:a0 tab:a1 head:b head:c head:d tab:d0')
check('여러 그룹: 접힌 c 의 탭은 한 줄도 없다', mixed.some(r => r.kind === 'tab' && r.tab.key === 'c'), false)
check('여러 그룹: 헤더는 구획 순서대로', mixed.filter(r => r.kind === 'head').map(r => r.key).join(''), 'abcd')

// 접힘은 헤더 유무와 무관하게 적용된다 — 호출부(`navPlan`)가 `collapsed: withHeads && ...` 로
// 막아 주기 때문에 실경로에서는 이 조합이 오지 않는다. 규칙을 여기 고정해 둔다.
check('head:false + collapsed:true 는 그 그룹이 통째로 사라진다', navRowsOf([sect('a', 3, false, true)]).length, 0)

// head 가 구획마다 다르면 헤더 없는 그룹의 탭이 앞 그룹 헤더 밑에 붙는다.
// 실경로는 `head: withHeads` 로 전 구획에 같은 값을 주므로 이 조합이 오지 않는다 — 규칙만 고정.
check('head 가 섞이면 헤더 없는 그룹 탭이 앞 헤더에 붙어 보인다', desc(navRowsOf([sect('a', 1, true, false), sect('b', 1, false, false)])), 'head:a tab:a0 tab:b0')

const src = sect('a', 2, true, false)
const srcRows = navRowsOf([src])
check('원본 tabs 배열은 그대로', src.tabs.length, 2)
check('탭 줄은 같은 탭 객체를 가리킨다 (포커스 비교가 객체 동일성)', srcRows[1].tab === src.tabs[0] && srcRows[2].tab === src.tabs[1], true)
check('줄 목록은 새 배열', Array.isArray(srcRows) && srcRows !== src.tabs, true)

// ── stepNavIndex: ↑↓ 의 경계 규칙 ──

check('빈 목록은 -1 (아래로)', stepNavIndex(0, -1, 1, false), -1)
check('빈 목록은 -1 (위로, 감김)', stepNavIndex(0, -1, -1, true), -1)
check('count 음수는 -1', stepNavIndex(-2, 0, 1, false), -1)
check('count NaN 은 -1', stepNavIndex(NaN, 0, 1, false), -1)
check('count 비정수는 -1', stepNavIndex(2.5, 0, 1, false), -1)

check('행 1개: 포커스 없음 + 아래로 -> 0', stepNavIndex(1, -1, 1, false), 0)
check('행 1개: 포커스 없음 + 위로 -> 0', stepNavIndex(1, -1, -1, false), 0)
check('행 1개: 아래로 눌러도 제자리 (멈춤)', stepNavIndex(1, 0, 1, false), 0)
check('행 1개: 감김이어도 제자리', stepNavIndex(1, 0, 1, true), 0)

// 포커스가 없거나(-1) 목록에서 사라졌으면 **손이 간 방향의 끝**에서 들어온다
check('포커스 없음(-1) + ↓ -> 첫 줄', stepNavIndex(5, -1, 1, false), 0)
check('포커스 없음(-1) + ↑ -> 마지막 줄', stepNavIndex(5, -1, -1, false), 4)
check('범위 밖(count) + ↓ -> 첫 줄', stepNavIndex(5, 5, 1, false), 0)
check('범위 밖(count) + ↑ -> 마지막 줄', stepNavIndex(5, 5, -1, false), 4)
check('범위 밖(큰 값) + ↑ -> 마지막 줄', stepNavIndex(5, 99, -1, true), 4)
check('index 비정수는 포커스 없음과 같은 취급', stepNavIndex(5, 1.5, 1, false), 0)
check('index NaN 은 포커스 없음과 같은 취급', stepNavIndex(5, NaN, -1, false), 4)

// 양 끝에서 멈춤(기본) vs 감김
check('맨 아래 + ↓ + wrap:false -> 제자리', stepNavIndex(5, 4, 1, false), 4)
check('맨 위 + ↑ + wrap:false -> 제자리', stepNavIndex(5, 0, -1, false), 0)
check('맨 아래 + ↓ + wrap:true -> 첫 줄', stepNavIndex(5, 4, 1, true), 0)
check('맨 위 + ↑ + wrap:true -> 마지막 줄', stepNavIndex(5, 0, -1, true), 4)
check('가운데는 wrap 과 무관', stepNavIndex(5, 2, 1, false) === 3 && stepNavIndex(5, 2, 1, true) === 3, true)

// step 이 0·정수 아님·NaN 이면 제자리 (키가 안 눌린 것과 같다)
check('step 0 -> 제자리', stepNavIndex(5, 2, 0, false), 2)
check('step 0 + wrap -> 제자리', stepNavIndex(5, 2, 0, true), 2)
check('step 1.5 -> 제자리', stepNavIndex(5, 2, 1.5, false), 2)
check('step -0.5 -> 제자리', stepNavIndex(5, 2, -0.5, false), 2)
check('step NaN -> 제자리', stepNavIndex(5, 2, NaN, false), 2)
check('step Infinity -> 제자리', stepNavIndex(5, 2, Infinity, true), 2)
check('step -Infinity -> 제자리', stepNavIndex(5, 2, -Infinity, true), 2)

// 한 칸보다 큰 이동 (PageUp/PageDown 류를 붙여도 규칙이 같아야 한다)
check('여러 칸 아래로', stepNavIndex(5, 1, 3, false), 4)
check('여러 칸이 끝을 넘으면 wrap:false 는 제자리', stepNavIndex(5, 1, 9, false), 1)
check('여러 칸이 끝을 넘으면 wrap:true 는 감긴다', stepNavIndex(5, 1, 9, true), 0)
check('음수로 크게 넘어가도 감긴다', stepNavIndex(5, 1, -3, true), 3)
check('한 바퀴(step=count)는 감겨도 제자리', stepNavIndex(5, 3, 5, true), 3)

// 포커스 없음(-1)에 비정수 step 이 들어오면 부호만 본다 — 제자리가 아니라 끝에서 들어온다.
// (실경로는 ±1 만 넣으므로 문제되지 않지만, 규칙이 두 갈래인 지점이라 고정해 둔다)
check('포커스 없음 + step NaN -> 첫 줄 (NaN<0 이 false)', stepNavIndex(5, -1, NaN, false), 0)
check('포커스 없음 + step -0.5 -> 마지막 줄', stepNavIndex(5, -1, -0.5, false), 4)

// ── 전수 1: stepNavIndex — count 0~8 × index -2~count+1 × step -3~+3 × wrap (1008 조합) ──
// 판정은 ①항상 실제로 존재하는 줄을 돌려주는지(빈 목록만 -1) ②문서화된 세 규칙과 일치하는지.
let sweep1 = 0
const bad1Range = []
const bad1Rule = []
for (let count = 0; count <= 8; count++) {
    for (let index = -2; index <= count + 1; index++) {
        for (const step of [-3, -2, -1, 0, 1, 2, 3]) {
            for (const wrap of [false, true]) {
                sweep1++
                const tag = `count=${count} index=${index} step=${step} wrap=${wrap}`
                const got = stepNavIndex(count, index, step, wrap)
                if (count <= 0) {
                    if (got !== -1) {
                        bad1Range.push(`${tag}: 빈 목록인데 ${got}`)
                    }
                    continue
                }
                if (!Number.isInteger(got) || got < 0 || got >= count) {
                    bad1Range.push(`${tag}: 없는 줄 ${got}`)
                    continue
                }
                const inList = index >= 0 && index < count
                let want
                if (!inList) {
                    want = step < 0 ? count - 1 : 0
                } else if (step === 0) {
                    want = index
                } else {
                    const next = index + step
                    if (next >= 0 && next < count) {
                        want = next
                    } else {
                        want = wrap ? ((next % count) + count) % count : index
                    }
                }
                if (got !== want) {
                    bad1Rule.push(`${tag}: ${got} (기대 ${want})`)
                }
            }
        }
    }
}
check('전수1: 조합 수 (count 0~8 x index x step x wrap)', sweep1, 1008)
check('전수1: 빈 목록만 -1, 나머지는 존재하는 줄', bad1Range.length ? bad1Range[0] : 0, 0)
check('전수1: 세 규칙(끝에서 진입 / 멈춤 / 감김)과 일치', bad1Rule.length ? bad1Rule[0] : 0, 0)

// ── 전수 2: 정수가 아닌 step 은 언제나 커서를 흔들지 않는다 (240 조합) ──
let sweep2 = 0
const bad2 = []
for (const step of [NaN, 1.5, -1.5, Infinity, -Infinity, -0.5]) {
    for (let count = 1; count <= 5; count++) {
        for (const index of [-1, 0, count - 1, count]) {
            for (const wrap of [false, true]) {
                sweep2++
                const tag = `count=${count} index=${index} step=${step} wrap=${wrap}`
                const got = stepNavIndex(count, index, step, wrap)
                const inList = index >= 0 && index < count
                const want = inList ? index : (step < 0 ? count - 1 : 0)
                if (got !== want) {
                    bad2.push(`${tag}: ${got} (기대 ${want})`)
                }
            }
        }
    }
}
check('전수2: 조합 수 (비정수 step x count x index x wrap)', sweep2, 240)
check('전수2: 포커스가 있으면 제자리, 없으면 방향 끝', bad2.length ? bad2[0] : 0, 0)

// ── 전수 3: 한 방향으로 계속 누르면 모든 줄을 빠짐없이 한 번씩 지난다 (32 회) ──
// 헤더를 건너뛰는 구현이 되면 여기서 줄이 빠지거나 중복된다.
function walk (count, step, wrap, times) {
    let cur = -1
    const seen = []
    for (let k = 0; k < times; k++) {
        cur = stepNavIndex(count, cur, step, wrap)
        seen.push(cur)
    }
    return seen
}
let sweep3 = 0
const bad3Cover = []
const bad3Stop = []
const bad3Cycle = []
for (let count = 1; count <= 8; count++) {
    const down = []
    const up = []
    for (let i = 0; i < count; i++) {
        down.push(i)
        up.push(count - 1 - i)
    }
    for (const wrap of [false, true]) {
        for (const step of [1, -1]) {
            sweep3++
            const tag = `count=${count} step=${step} wrap=${wrap}`
            const seen = walk(count, step, wrap, count)
            const want = (step > 0 ? down : up).join(',')
            if (seen.join(',') !== want) {
                bad3Cover.push(`${tag}: ${seen.join(',')} (기대 ${want})`)
            }
            const more = walk(count, step, wrap, count + 2)
            if (wrap) {
                // 한 바퀴 돌면 출발점으로 돌아온다
                if (more[count] !== more[0] || more[count + 1] !== more[1]) {
                    bad3Cycle.push(`${tag}: ${more.join(',')}`)
                }
            } else {
                // 끝에 닿으면 그 자리에서 멈춘다
                const last = more[count - 1]
                if (more[count] !== last || more[count + 1] !== last) {
                    bad3Stop.push(`${tag}: ${more.join(',')}`)
                }
            }
        }
    }
}
check('전수3: 순회 횟수 (count 1~8 x 방향 x wrap)', sweep3, 32)
check('전수3: 모든 줄을 화면 순서대로 정확히 한 번씩', bad3Cover.length ? bad3Cover[0] : 0, 0)
check('전수3: wrap:false 는 끝에서 멈춘다', bad3Stop.length ? bad3Stop[0] : 0, 0)
check('전수3: wrap:true 는 한 바퀴 뒤 출발점', bad3Cycle.length ? bad3Cycle[0] : 0, 0)

// ── 전수 4: navRowsOf — 그룹 0~3개 × (탭 0~2 × head × collapsed) 조합 (1885 개) ──
// 판정은 ①줄 수 ②헤더 순서 ③각 탭이 자기 헤더 아래에 있는지 ④접힌 그룹의 탭 부재
// ⑤탭 순서 보존(중복·빠짐 없음) ⑥그 줄 목록을 ↑↓ 로 훑으면 화면 순서 그대로 지나는지.
const specs = []
for (const n of [0, 1, 2]) {
    for (const head of [true, false]) {
        for (const collapsed of [true, false]) {
            specs.push({ n, head, collapsed })
        }
    }
}
let sweep4 = 0
const bad4Count = []
const bad4Heads = []
const bad4Owner = []
const bad4Collapsed = []
const bad4Tabs = []
const bad4Walk = []
function sweepConfigs (groups) {
    const out = []
    if (groups === 0) {
        return [[]]
    }
    for (const rest of sweepConfigs(groups - 1)) {
        for (const s of specs) {
            out.push(rest.concat([s]))
        }
    }
    return out
}
for (let groups = 0; groups <= 3; groups++) {
    for (const config of sweepConfigs(groups)) {
        sweep4++
        const sections = config.map((s, gi) => sect(`g${gi}`, s.n, s.head, s.collapsed))
        const tag = config.map((s, gi) => `g${gi}(n=${s.n},head=${s.head},col=${s.collapsed})`).join(' ') || '(빈 목록)'
        const rows = navRowsOf(sections)

        // ① 줄 수 = 헤더 수 + 펴진 그룹의 탭 수
        let wantCount = 0
        for (const s of sections) {
            wantCount += s.head ? 1 : 0
            wantCount += s.collapsed ? 0 : s.tabs.length
        }
        if (rows.length !== wantCount) {
            bad4Count.push(`${tag}: ${rows.length}행 (기대 ${wantCount})`)
        }

        // ② 헤더는 head:true 인 구획 순서 그대로
        const gotHeads = rows.filter(r => r.kind === 'head').map(r => String(r.key)).join(',')
        const wantHeads = sections.filter(s => s.head).map(s => String(s.key)).join(',')
        if (gotHeads !== wantHeads) {
            bad4Heads.push(`${tag}: ${gotHeads} (기대 ${wantHeads})`)
        }

        // ③ 각 탭 줄은 바로 앞 헤더의 그룹 소속.
        // 구획마다 head 가 뒤섞인 조합은 제외한다 — 실경로(`navPlan`)는 `head: withHeads` 로
        // 전 구획에 같은 값을 넣으므로 섞인 목록이 오지 않고, 섞이면 헤더 없는 그룹의 탭이
        // 앞 그룹 헤더 밑에 붙어 보인다(아래 concrete 검사로 그 규칙을 따로 못 박았다).
        const allHead = sections.length > 0 && sections.every(s => s.head)
        let cur = null
        for (const r of rows) {
            if (r.kind === 'head') {
                cur = r.key
            } else if (allHead && r.tab.key !== cur) {
                bad4Owner.push(`${tag}: ${r.tab.name} 이 ${cur} 헤더 아래`)
                break
            }
        }

        // ④ 접힌 그룹의 탭은 한 줄도 없다
        const collapsedKeys = new Set(sections.filter(s => s.collapsed).map(s => s.key))
        if (rows.some(r => r.kind === 'tab' && collapsedKeys.has(r.tab.key))) {
            bad4Collapsed.push(tag)
        }

        // ⑤ 보이는 탭이 화면 순서대로 정확히 한 번씩
        const gotTabs = rows.filter(r => r.kind === 'tab').map(r => r.tab.name).join(',')
        const wantTabs = []
        for (const s of sections) {
            if (!s.collapsed) {
                for (const t of s.tabs) {
                    wantTabs.push(t.name)
                }
            }
        }
        if (gotTabs !== wantTabs.join(',')) {
            bad4Tabs.push(`${tag}: ${gotTabs} (기대 ${wantTabs.join(',')})`)
        }

        // ⑥ 이 줄 목록을 ↓ 로 훑으면 헤더·탭 구분 없이 화면 순서 그대로 지난다
        if (rows.length) {
            const seen = walk(rows.length, 1, false, rows.length)
            const visited = seen.map(i => rows[i]).map(r => r.kind === 'head' ? `H${r.key}` : `T${r.tab.name}`).join(',')
            const wantVisit = rows.map(r => r.kind === 'head' ? `H${r.key}` : `T${r.tab.name}`).join(',')
            if (visited !== wantVisit) {
                bad4Walk.push(`${tag}: ${visited}`)
            }
        } else if (stepNavIndex(rows.length, -1, 1, false) !== -1) {
            bad4Walk.push(`${tag}: 줄이 없는데 -1 이 아니다`)
        }
    }
}
check('전수4: 조합 수 (그룹 0~3 x 탭수 x head x collapsed)', sweep4, 1885)
check('전수4: 줄 수 = 헤더 + 펴진 그룹 탭', bad4Count.length ? bad4Count[0] : 0, 0)
check('전수4: 헤더 순서 = 구획 순서', bad4Heads.length ? bad4Heads[0] : 0, 0)
check('전수4: 탭은 자기 헤더 아래에만', bad4Owner.length ? bad4Owner[0] : 0, 0)
check('전수4: 접힌 그룹의 탭은 없다', bad4Collapsed.length ? bad4Collapsed[0] : 0, 0)
check('전수4: 보이는 탭을 화면 순서대로 한 번씩', bad4Tabs.length ? bad4Tabs[0] : 0, 0)
check('전수4: 훑기가 모든 줄을 화면 순서대로 (헤더 건너뛰지 않음)', bad4Walk.length ? bad4Walk[0] : 0, 0)

// ── pickCloseTarget: Ctrl+W 가 닫을 탭 ──
// 계약 — 터미널에서 누르면 활성 탭, 목록이 키보드를 가졌으면 포커스 줄의 탭.
// `null` 은 "키를 흘린다"(터미널의 앞 단어 지우기를 우리가 먹고 아무 일도 안 하는 것이 최악).

const t0 = { name: 't0' }
const t1 = { name: 't1' }
const t2 = { name: 't2' }
const allTabs = [t0, t1, t2]
const nameOf = tab => tab ? tab.name : 'null'

check('터미널 포커스: 활성 탭을 닫는다',
    nameOf(pickCloseTarget({ inList: false, focus: null, active: t1, tabs: allTabs })), 't1')
check('터미널 포커스: 링이 다른 줄에 있어도 활성 탭이다',
    nameOf(pickCloseTarget({ inList: false, focus: { kind: 'tab', tab: t2 }, active: t0, tabs: allTabs })), 't0')
check('터미널 포커스: 활성 탭이 없으면 아무것도 안 한다',
    nameOf(pickCloseTarget({ inList: false, focus: null, active: null, tabs: allTabs })), 'null')
check('터미널 포커스: 활성 탭이 목록에 없으면(닫힌 뒤) 안 한다',
    nameOf(pickCloseTarget({ inList: false, focus: null, active: { name: 'gone' }, tabs: allTabs })), 'null')

check('목록 포커스: 포커스 줄의 탭을 닫는다 (활성 탭이 아니다)',
    nameOf(pickCloseTarget({ inList: true, focus: { kind: 'tab', tab: t2 }, active: t0, tabs: allTabs })), 't2')
check('목록 포커스: 그룹 헤더에서는 아무것도 안 한다',
    nameOf(pickCloseTarget({ inList: true, focus: { kind: 'head', key: 'a' }, active: t0, tabs: allTabs })), 'null')
check('목록 포커스: 포커스가 없으면 활성 탭으로 새지 않는다',
    nameOf(pickCloseTarget({ inList: true, focus: null, active: t0, tabs: allTabs })), 'null')
check('목록 포커스: 낡은 포커스(이미 닫힌 탭)는 안 한다',
    nameOf(pickCloseTarget({ inList: true, focus: { kind: 'tab', tab: { name: 'gone' } }, active: t0, tabs: allTabs })), 'null')
check('탭이 하나도 없으면 어느 쪽이든 안 한다',
    nameOf(pickCloseTarget({ inList: false, focus: null, active: t0, tabs: [] }))
    + nameOf(pickCloseTarget({ inList: true, focus: { kind: 'tab', tab: t0 }, active: t0, tabs: [] })), 'nullnull')

// ── pickJumpTarget: Ctrl+N — 보이는 순서로 N 번째 **탭 줄** ──
//
// 계약 세 가지 —
//  ① 헤더는 세지 않는다. 그룹은 폴더가 바뀔 때마다 저절로 생겼다 없어지는 값이라(group.ts)
//    헤더를 세면 같은 키가 어제와 다른 세션을 연다.
//  ② 접힌 그룹 안의 탭은 애초에 rows 에 없다(navRowsOf) — 안 보이는 줄에는 번호가 없다.
//  ③ 범위 밖은 null 이고 호출부는 아무 일도 하지 않는다. 가장 가까운 탭으로 보내면
//    목록이 줄어든 줄 모르고 누른 사람이 엉뚱한 세션에 입력하게 된다.
{
    const flat = navRowsOf([sect('a', 3, false, false)])
    check('평면 목록 1번째', nameOf(pickJumpTarget(flat, 1)), 'a0')
    check('평면 목록 3번째', nameOf(pickJumpTarget(flat, 3)), 'a2')
    check('평면 목록 범위 밖', nameOf(pickJumpTarget(flat, 4)), 'null')

    // 헤더가 섞인 화면 — 줄로는 a0 가 2번째지만 **탭으로는 1번째**다
    const grouped = navRowsOf([sect('a', 2, true, false), sect('b', 2, true, false)])
    check('헤더 있는 화면의 줄 구성', desc(grouped), 'head:a tab:a0 tab:a1 head:b tab:b0 tab:b1')
    check('헤더는 안 센다: 1 -> 첫 탭', nameOf(pickJumpTarget(grouped, 1)), 'a0')
    check('헤더는 안 센다: 3 -> 다음 그룹 첫 탭', nameOf(pickJumpTarget(grouped, 3)), 'b0')
    check('헤더는 안 센다: 4 -> 마지막 탭', nameOf(pickJumpTarget(grouped, 4)), 'b1')
    check('헤더는 안 센다: 5 -> 없음', nameOf(pickJumpTarget(grouped, 5)), 'null')

    // 접힌 그룹 — 그 안의 탭은 rows 에 없으므로 번호도 없다
    const collapsed = navRowsOf([sect('a', 3, true, true), sect('b', 2, true, false)])
    check('접힌 그룹의 줄 구성', desc(collapsed), 'head:a head:b tab:b0 tab:b1')
    check('접힌 그룹은 건너뛴다: 1 -> b0', nameOf(pickJumpTarget(collapsed, 1)), 'b0')
    check('접힌 그룹 탭 수만큼 밀리지 않는다: 3 -> 없음', nameOf(pickJumpTarget(collapsed, 3)), 'null')

    check('헤더만 있는 화면은 어느 번호도 없다',
        nameOf(pickJumpTarget(navRowsOf([sect('a', 0, true, false)]), 1)), 'null')
    check('빈 목록', nameOf(pickJumpTarget([], 1)), 'null')

    // 잘못된 slot — 0·음수·정수 아님은 전부 null (호출부가 아무 일도 안 한다)
    const badSlots = [0, -1, 1.5, NaN, Infinity, null, undefined, '1']
    check('0 이하 / 정수 아님은 전부 null',
        badSlots.map(v => nameOf(pickJumpTarget(flat, v))).join(','),
        badSlots.map(() => 'null').join(','))

    // 전수: 헤더 0~2개 x 탭 0~6개 x slot 0~8 — 언제나 "탭 줄만 세어 N 번째" 와 같아야 한다
    const wrong = []
    let jumpCalls = 0
    for (let heads = 0; heads <= 2; heads++) {
        for (let n = 0; n <= 6; n++) {
            const sects = []
            for (let h = 0; h < Math.max(heads, 1); h++) {
                sects.push(sect(`g${h}`, h === 0 ? n : 0, heads > 0, false))
            }
            const rows = navRowsOf(sects)
            const onlyTabs = rows.filter(r => r.kind === 'tab').map(r => r.tab)
            for (let slot = 0; slot <= 8; slot++) {
                jumpCalls++
                const got = pickJumpTarget(rows, slot)
                const want = slot >= 1 && slot <= onlyTabs.length ? onlyTabs[slot - 1] : null
                if (got !== want) {
                    wrong.push(`heads=${heads} n=${n} slot=${slot}: ${nameOf(got)} (기대 ${nameOf(want)})`)
                }
            }
        }
    }
    check('전수: 호출 수 (헤더 0~2 x 탭 0~6 x slot 0~8)', jumpCalls, 189)
    check('전수: 언제나 탭 줄만 세어 N 번째', wrong.length ? wrong[0] : 0, 0)
}


console.log(`\nnav: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
