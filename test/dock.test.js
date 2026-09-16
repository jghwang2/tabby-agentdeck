// dock.ts 의 순수 규칙 — ① 설정값 판정(isDockSide/isHorizontalDock) ② 헤더를 끌어다 놓을 때
// 커서 위치로 도킹 방향을 정하는 hitTest ③ 놓기 전에 그리는 미리보기 박스 geometry.
//
// dock.ts 는 import 가 하나도 없다(순수). DockController 는 install() 에서만 document 를 만지고
// hitTest/drawPreview 는 `host.windowEl.getBoundingClientRect()` 와 자기 필드만 읽으므로,
// 가짜 host 하나로 DOM 없이 그대로 돌 수 있다 — 그래서 여기 붙인다.
// (TS 의 private 은 컴파일된 JS 에 남지 않으므로 메서드를 직접 부를 수 있다)
const { DOCK_SIDES, isDockSide, isHorizontalDock, DockController } = require('../.tmp/dock.js')

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

// ── 방향 목록/판정 ────────────────────────────────────────────────────────────
// isDockSide 는 config.yaml 에서 손으로 적은 값이 레이아웃 코드로 들어가기 전의 유일한 문지기다.
// 통과시켜 버리면 sidebarDock 이 'Left' 인 채로 relayout 에 들어가 사이드바가 어디에도 안 붙는다.

check('방향은 네 개, 순서 고정', DOCK_SIDES.join(','), 'left,right,top,bottom')
check('네 방향 모두 자기 자신을 통과', DOCK_SIDES.every(s => isDockSide(s)), true)
check('대문자는 거부 (yaml 오타)', isDockSide('Left'), false)
check('빈 문자열 거부', isDockSide(''), false)
check('null 거부', isDockSide(null), false)
check('undefined 거부 (키가 없는 낡은 config)', isDockSide(undefined), false)
check('숫자 0 거부 (includes 라 느슨한 비교에 안 걸려야 한다)', isDockSide(0), false)
check('공백 섞인 값 거부', isDockSide(' left'), false)
check('좌/우는 폭', isHorizontalDock('left') && isHorizontalDock('right'), true)
check('상/하는 높이', isHorizontalDock('top') || isHorizontalDock('bottom'), false)

// ── hitTest: 커서 위치 -> 붙일 방향 ──────────────────────────────────────────
// 실경로에서 이 값이 곧 `host.setDock(side)` 다 — 틀리면 사용자가 끌어다 놓은 곳과
// 다른 가장자리에 사이드바가 붙는다. 그래서 대표값 + 전수로 훑는다.

function rectOf (left, top, width, height) {
    return { left, top, width, height, right: left + width, bottom: top + height }
}

function ctlFor (rect, size) {
    const host = {
        sidebar: null,
        windowEl: { getBoundingClientRect: () => rect },
        getDock: () => 'right',
        setDock () { },
        getSize: () => (size === undefined ? 0 : size),
        setSize () { },
        commit () { },
        relayout () { },
    }
    return new DockController(host)
}

const r1 = rectOf(0, 0, 1000, 800)
const c1 = ctlFor(r1)

check('왼쪽 가장자리', c1.hitTest(10, 400), 'left')
check('오른쪽 가장자리', c1.hitTest(990, 400), 'right')
check('위쪽 가장자리', c1.hitTest(500, 10), 'top')
check('아래쪽 가장자리', c1.hitTest(500, 790), 'bottom')
check('가운데는 null (놓아도 아무 일 없다)', c1.hitTest(500, 400), null)
// 띠 경계는 25% — 249px 는 안, 251px 는 밖
check('좌측 띠 안(24.9%)', c1.hitTest(249, 400), 'left')
check('좌측 띠 밖(25.1%)', c1.hitTest(251, 400), null)
check('상단 띠 안(24.9%)', c1.hitTest(500, 199), 'top')
check('상단 띠 밖(25.1%)', c1.hitTest(500, 201), null)
// 모서리는 "더 가까운 가장자리" — 대각선 조건(dx <= dy && dx <= 1-dy)이 그것을 만든다
check('좌상 모서리에서 x 가 더 가까우면 left', c1.hitTest(10, 100), 'left')
check('좌상 모서리에서 y 가 더 가까우면 top', c1.hitTest(100, 10), 'top')
check('우하 모서리에서 x 가 더 가까우면 right', c1.hitTest(995, 700), 'right')
check('우하 모서리에서 y 가 더 가까우면 bottom', c1.hitTest(800, 795), 'bottom')

// 존 버튼(드롭 가이드) 위에 있으면 띠 계산을 건너뛰고 그 방향이다.
// showOverlay 가 만드는 엘리먼트 대신 getBoundingClientRect 만 가진 가짜를 넣는다.
function zoneAt (left, top, right, bottom) {
    return { getBoundingClientRect: () => ({ left, top, right, bottom }) }
}
const cz = ctlFor(r1)
cz.zones = new Map([['bottom', zoneAt(480, 380, 520, 420)]])
check('존 버튼이 띠보다 우선 (가운데인데 bottom)', cz.hitTest(500, 400), 'bottom')
check('존 경계는 포함 (좌상 꼭짓점)', cz.hitTest(480, 380), 'bottom')
check('존 경계는 포함 (우하 꼭짓점)', cz.hitTest(520, 420), 'bottom')
check('존 밖 1px 이면 다시 띠 계산 (여기선 null)', cz.hitTest(521, 421), null)
const cz2 = ctlFor(r1)
cz2.zones = new Map([['top', zoneAt(0, 0, 40, 40)]])
check('존과 띠가 겹치면 존이 이긴다 (좌측 띠 안인데 top)', cz2.hitTest(10, 10), 'top')

// 전수: 창 네 모양 x 65x65 격자.
// 판정 기준(oracle)은 구현식을 베끼지 않고 성질로 쓴다 —
//  ① 네 가장자리까지의 비율 중 가장 작은 값이 25% 이상이면 null (가운데)
//  ② 아니면 "가장 가까운 가장자리", 같으면 좌/우가 이긴다 (구현이 좌/우를 먼저 본다)
// 격자 좌표는 폭·높이를 64 로 나눠 떨어지게 잡아 dx/dy 가 정확한 2진 분수가 되게 했다 —
// 그래야 정사각형 창의 대각선에서 동률이 오차 없이 동률로 잡힌다.
const RECTS = [
    rectOf(0, 0, 1024, 768),
    rectOf(0, 0, 640, 1280),
    rectOf(120, 64, 1280, 640),
    rectOf(-8, -16, 512, 512),
]
const STEPS = 64
let gridCalls = 0
const gridBad = []
const nullBad = []
let tieHits = 0
for (const rect of RECTS) {
    const ctl = ctlFor(rect)
    for (let i = 0; i <= STEPS; i++) {
        for (let j = 0; j <= STEPS; j++) {
            const x = rect.left + (rect.width * i) / STEPS
            const y = rect.top + (rect.height * j) / STEPS
            const got = ctl.hitTest(x, y)
            gridCalls++
            const dx = (x - rect.left) / rect.width
            const dy = (y - rect.top) / rect.height
            const dist = { left: dx, right: 1 - dx, top: dy, bottom: 1 - dy }
            const near = Math.min(dist.left, dist.right, dist.top, dist.bottom)
            const where = `${rect.width}x${rect.height} (${i}/${STEPS},${j}/${STEPS})`
            if (near >= 0.25) {
                if (got !== null) {
                    nullBad.push(`${where}: ${got}`)
                }
                continue
            }
            const nearest = DOCK_SIDES.filter(s => dist[s] === near)
            if (nearest.length > 1) {
                tieHits++
            }
            if (got !== nearest[0]) {
                gridBad.push(`${where}: ${got} (가장 가까운 쪽 ${nearest.join('|')})`)
            }
            if (got !== null && !DOCK_SIDES.includes(got)) {
                gridBad.push(`${where}: 방향이 아닌 값 ${got}`)
            }
        }
    }
}
check('전수: 격자 호출 수 (창 4 x 65 x 65)', gridCalls, 16900)
check('전수: 가운데(가장 가까운 가장자리가 25% 이상)는 언제나 null', nullBad.length ? nullBad[0] : 0, 0)
check('전수: 그 밖은 가장 가까운 가장자리 (동률이면 좌/우)', gridBad.length ? gridBad[0] : 0, 0)
check('전수: 동률(대각선)도 실제로 밟았다', tieHits > 0, true)

// ── drawPreview: 놓기 전에 보여주는 반투명 박스 ──────────────────────────────
// 틀려도 실제 도킹 결과는 안 바뀌지만(그건 hitTest 가 정한다) 0 폭 실선이 그려지거나
// 창을 덮는 박스가 나오면 어디에 붙을지 못 읽는다. 경계가 셋이라 값만 못 박아 둔다 —
// ① 저장된 크기가 0(=자동)이면 좌/우 320, 상/하 200 ② 최소 180/120 ③ 창의 60% 상한.
function previewFor (rect, size) {
    const ctl = ctlFor(rect, size)
    ctl.preview = { style: {} }
    return ctl
}
function drawn (rect, side, size) {
    const ctl = previewFor(rect, size)
    ctl.drawPreview(side)
    const s = ctl.preview.style
    return `${s.display} ${s.left} ${s.top} ${s.width} x ${s.height}`
}

check('우측, 저장값 0 이면 320 자동', drawn(r1, 'right', 0), 'block 680px 0px 320px x 800px')
check('우측, 최소 180 로 끌어올림', drawn(r1, 'right', 100), 'block 820px 0px 180px x 800px')
check('우측, 창의 60% 상한', drawn(r1, 'right', 900), 'block 400px 0px 600px x 800px')
check('좌측은 창 왼쪽에 붙는다', drawn(r1, 'left', 400), 'block 0px 0px 400px x 800px')
check('상단, 저장값 0 이면 200 자동', drawn(r1, 'top', 0), 'block 0px 0px 1000px x 200px')
check('하단, 최소 120 로 끌어올림', drawn(r1, 'bottom', 50), 'block 0px 680px 1000px x 120px')
check('하단, 창의 60% 상한', drawn(r1, 'bottom', 700), 'block 0px 320px 1000px x 480px')
// 창이 전체화면이 아닐 수 있다 — 좌표는 창 rect 기준이어야 한다
check('창이 옮겨져 있어도 창 기준', drawn(rectOf(200, 100, 1000, 800), 'left', 300), 'block 200px 100px 300px x 800px')
check('창이 옮겨져 있어도 우측 정렬', drawn(rectOf(200, 100, 1000, 800), 'right', 300), 'block 900px 100px 300px x 800px')
check('방향이 null 이면 감춘다', drawn(r1, null, 300).split(' ')[0], 'none')
// preview 가 아직 없으면(오버레이 전) 조용히 넘어가야 한다 — 드래그 시작 전에도 불린다
const cNoPrev = ctlFor(r1, 300)
let threw = false
try {
    cNoPrev.drawPreview('right')
} catch {
    threw = true
}
check('오버레이 전(preview 없음)엔 아무 일도 없다', threw, false)

console.log(`\ndock: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
