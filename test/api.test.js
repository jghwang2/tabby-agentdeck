// api.ts 의 STATUS_STYLES — 상태 6종의 표시 규칙.
//
// 상수 하나를 되읽는 테스트는 값어치가 없다. 여기서 보는 것은 **TypeScript 가 못 잡는
// 파일 사이의 일치**다: `STATUS_STYLES` 는 `Record<WorkStatus, StatusStyle>` 라 컴파일러가
// 빠짐을 잡아 주지만, order.ts 의 `STATUS_ORDER` 는 `readonly WorkStatus[]` 라서
// **한 상태를 빼먹어도 컴파일이 통과한다.**
//
// 어긋나면 —
//  ① STATUS_ORDER 에만 있는 상태: deck.service 가 `STATUS_STYLES[status].icon` 을 그대로
//     읽으므로(deck.service.ts:4009,4035,5091) undefined 참조로 사이드바 그리기가 죽는다.
//  ② STATUS_STYLES 에만 있는 상태: statusRank 가 맨 뒤로 보내고 countByStatus 가 세지 않아
//     그 상태의 탭이 헤더 집계에서 사라진다.
const { STATUS_STYLES } = require('../.tmp/api.js')
const { STATUS_ORDER } = require('../.tmp/order.js')

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

const styleKeys = Object.keys(STATUS_STYLES)

check('상태는 6종', styleKeys.length, 6)
check('정렬 순서도 6종', STATUS_ORDER.length, 6)
check(
    'STATUS_ORDER 의 모든 상태에 표시 규칙이 있다',
    STATUS_ORDER.filter(s => !STATUS_STYLES[s]).join(',') || 0,
    0,
)
check(
    'STATUS_STYLES 의 모든 상태가 정렬 순서에 있다',
    styleKeys.filter(s => !STATUS_ORDER.includes(s)).join(',') || 0,
    0,
)

// 배지·컬러바에 그대로 들어가는 값이라 빈 문자열이면 조용히 안 보인다.
// 색은 CSS 와 alert.service 의 캔버스 fillStyle 로 같이 들어가므로 #rrggbb 만 안전하다
const badShape = []
for (const [key, style] of Object.entries(STATUS_STYLES)) {
    if (!style.icon) {
        badShape.push(`${key}: 아이콘 없음`)
    }
    if (!style.label) {
        badShape.push(`${key}: 라벨 없음`)
    }
    if (!/^#[0-9a-f]{6}$/i.test(style.color)) {
        badShape.push(`${key}: 색이 #rrggbb 가 아니다 (${style.color})`)
    }
}
check('모든 상태에 아이콘·라벨·#rrggbb 색이 있다', badShape.length ? badShape[0] : 0, 0)

// 좌측 컬러바는 색이 유일한 단서다 — 두 상태가 같은 색이면 구분할 방법이 없다
const colors = styleKeys.map(k => STATUS_STYLES[k].color.toLowerCase())
check('색이 상태마다 다르다', new Set(colors).size, 6)
const labels = styleKeys.map(k => STATUS_STYLES[k].label)
check('라벨이 상태마다 다르다', new Set(labels).size, 6)

console.log(`\napi: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
