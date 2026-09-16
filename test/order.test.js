// 헤더 집계 / sortByStatus 정렬 규칙. 핵심은 두 가지 — 우선순위(waiting→error→running→done→idle)를
// 집계와 정렬이 똑같이 쓰고, 정렬은 같은 상태 안에서 탭 순서를 지키며 원본을 건드리지 않는다.
const { statusRank, countByStatus, sortTabsByStatus, planTabMove, planEdgeScroll, STATUS_ORDER } = require('../.tmp/order.js')

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

check('우선순위 순서', STATUS_ORDER.join(','), 'waiting,error,limited,running,done,idle')
check('waiting 이 맨 앞', statusRank('waiting'), 0)
check('idle 이 맨 뒤', statusRank('idle'), 5)
check('limited 는 error 뒤 running 앞', statusRank('limited') > statusRank('error') && statusRank('limited') < statusRank('running'), true)
check('모르는 값은 idle 뒤로', statusRank('???') > statusRank('idle'), true)

const tabs = [
    { name: 'a', s: 'idle' },
    { name: 'b', s: 'running' },
    { name: 'c', s: 'waiting' },
    { name: 'd', s: 'done' },
    { name: 'e', s: 'running' },
    { name: 'f', s: 'waiting' },
]
const statusOf = t => t.s

const counts = countByStatus(tabs, statusOf)
check('집계는 우선순위 순서, 0 은 생략', counts.map(c => `${c.status}:${c.count}`).join(' '), 'waiting:2 running:2 done:1 idle:1')
check('빈 목록은 빈 집계', countByStatus([], statusOf).length, 0)

const sorted = sortTabsByStatus(tabs, statusOf)
check('상태 우선순위로 정렬', sorted.map(t => t.name).join(''), 'cfbeda')
check('같은 상태끼리는 탭 순서 유지 (c<f, b<e)', sorted.indexOf(tabs[2]) < sorted.indexOf(tabs[5]) && sorted.indexOf(tabs[1]) < sorted.indexOf(tabs[4]), true)
check('원본 배열은 그대로', tabs.map(t => t.name).join(''), 'abcdef')
check('복사본을 돌려준다', sorted !== tabs, true)

const same = [{ name: 'x', s: 'done' }, { name: 'y', s: 'done' }, { name: 'z', s: 'done' }]
check('전부 같은 상태면 순서 불변', sortTabsByStatus(same, statusOf).map(t => t.name).join(''), 'xyz')

// ── planTabMove: 드래그로 탭 순서 바꾸기의 순열 규칙 (deck.service.ts 에서 옮겨 옴) ──
// 실경로(R58)는 이 순열을 그대로 `app.tabs` 에 부어 넣는다 — 빠짐이 있으면 탭이 사라지고
// 중복이 있으면 같은 탭이 두 번 앉는다. 그래서 대표값 몇 개가 아니라 전수로 훑는다.

check('대표값 (5,4,1,before)', String(planTabMove(5, 4, 1, 'before')), '0,4,1,2,3')
check('대표값 (3,1,0,after) 는 항등이라 null', planTabMove(3, 1, 0, 'after'), null)

// before/after 가 어느 쪽에 앉는지를 인덱스로 못 박는다
const movedBefore = planTabMove(6, 0, 3, 'before')
check('before: 순열 전문', String(movedBefore), '1,2,0,3,4,5')
check('before: 옮긴 탭(0)이 대상(3) 바로 앞', movedBefore.indexOf(0) + 1 === movedBefore.indexOf(3), true)
check('before: 위치 인덱스 (옮긴 탭 2, 대상 3)', movedBefore.indexOf(0) + ',' + movedBefore.indexOf(3), '2,3')
const movedAfter = planTabMove(6, 0, 3, 'after')
check('after: 순열 전문', String(movedAfter), '1,2,3,0,4,5')
check('after: 옮긴 탭(0)이 대상(3) 바로 뒤', movedAfter.indexOf(0) - 1 === movedAfter.indexOf(3), true)
check('after: 위치 인덱스 (대상 2, 옮긴 탭 3)', movedAfter.indexOf(3) + ',' + movedAfter.indexOf(0), '2,3')
// 위로 끌어올리는 방향(from > to)도 같은 규칙
check('위로: (6,5,2,before)', String(planTabMove(6, 5, 2, 'before')), '0,1,5,2,3,4')
check('위로: (6,5,2,after)', String(planTabMove(6, 5, 2, 'after')), '0,1,2,5,3,4')

// 제자리 이동은 null — 호출부(applyReorder)가 재배열과 emitTabsChanged 를 건너뛰어
// 아무것도 안 바뀐 채로 순정 탭바를 다시 그리지 않게 하는 유일한 게이트다
check('자기 자신 앞 = null', planTabMove(5, 2, 2, 'before'), null)
check('자기 자신 뒤 = null', planTabMove(5, 2, 2, 'after'), null)
check('바로 앞 줄의 뒤 = null (항등)', planTabMove(5, 2, 1, 'after'), null)
check('바로 뒤 줄의 앞 = null (항등)', planTabMove(5, 2, 3, 'before'), null)
check('바로 앞 줄의 앞은 실제로 옮긴다', String(planTabMove(5, 2, 1, 'before')), '0,2,1,3,4')

// 경계 — 범위 밖 인덱스, 탭이 0~1개, 정수가 아닌 값
check('from 범위 밖 (-1)', planTabMove(5, -1, 2, 'before'), null)
check('from 범위 밖 (count)', planTabMove(5, 5, 2, 'before'), null)
check('to 범위 밖 (-1)', planTabMove(5, 2, -1, 'before'), null)
check('to 범위 밖 (count)', planTabMove(5, 2, 5, 'after'), null)
check('count 0', planTabMove(0, 0, 0, 'before'), null)
check('count 1', planTabMove(1, 0, 0, 'before'), null)
check('count 음수', planTabMove(-3, 0, 1, 'before'), null)
check('count NaN', planTabMove(NaN, 0, 1, 'before'), null)
check('from NaN', planTabMove(5, NaN, 1, 'before'), null)
check('to NaN', planTabMove(5, 0, NaN, 'before'), null)
check('정수 아닌 from', planTabMove(5, 1.5, 3, 'before'), null)
check('정수 아닌 count', planTabMove(5.5, 1, 3, 'before'), null)

// 전수 검사 — count 2~7 의 모든 from × to × before/after (278 조합).
// 판정은 구현을 다시 쓰지 않고 성질로 한다: ①순열 유효성 ②나머지 탭의 상대순서 보존
// ③요청한 쪽에 인접 ④null 은 항등 조합(자기 자신 / before 이면서 대상 바로 앞 /
// after 이면서 대상 바로 뒤)일 때만.
let sweepCombos = 0
let sweepMoves = 0
let sweepNulls = 0
const badPerm = []
const badNull = []
const badPlace = []
const badRest = []
for (let count = 2; count <= 7; count++) {
    for (let from = 0; from < count; from++) {
        for (let to = 0; to < count; to++) {
            for (const place of ['before', 'after']) {
                sweepCombos++
                const tag = `count=${count} from=${from} to=${to} ${place}`
                const got = planTabMove(count, from, to, place)
                const wantNull = from === to
                    || (place === 'before' && from === to - 1)
                    || (place === 'after' && from === to + 1)
                if (got === null) {
                    sweepNulls++
                    if (!wantNull) {
                        badNull.push(`${tag}: null 인데 옮겨야 하는 조합`)
                    }
                    continue
                }
                sweepMoves++
                if (wantNull) {
                    badNull.push(`${tag}: 항등인데 순열을 돌려줬다 -> ${got.join(',')}`)
                }
                const seen = new Array(count).fill(0)
                let permOk = got.length === count
                if (permOk) {
                    for (const v of got) {
                        if (!Number.isInteger(v) || v < 0 || v >= count) {
                            permOk = false
                            break
                        }
                        seen[v]++
                    }
                }
                if (permOk) {
                    permOk = seen.every(n => n === 1)
                }
                if (!permOk) {
                    badPerm.push(`${tag}: ${got.join(',')}`)
                }
                const mi = got.indexOf(from)
                const ti = got.indexOf(to)
                const adjacent = place === 'before' ? mi + 1 === ti : mi - 1 === ti
                if (!adjacent) {
                    badPlace.push(`${tag}: ${got.join(',')} (옮긴 탭 ${mi}, 대상 ${ti})`)
                }
                const rest = got.filter(v => v !== from).join(',')
                const wantRest = []
                for (let i = 0; i < count; i++) {
                    if (i !== from) {
                        wantRest.push(i)
                    }
                }
                if (rest !== wantRest.join(',')) {
                    badRest.push(`${tag}: 나머지 순서 ${rest}`)
                }
            }
        }
    }
}
check('전수: 조합 수 (count 2~7 x from x to x before/after)', sweepCombos, 278)
check('전수: 0..count-1 을 정확히 한 번씩 (빠짐/중복 없음)', badPerm.length ? badPerm[0] : 0, 0)
check('전수: 옮긴 탭 빼면 나머지 상대순서 보존', badRest.length ? badRest[0] : 0, 0)
check('전수: 요청한 쪽(before/after)에 인접', badPlace.length ? badPlace[0] : 0, 0)
check('전수: null 은 항등 조합에서만', badNull.length ? badNull[0] : 0, 0)
check('전수: 제자리(null) 조합 개수', sweepNulls, 96)
check('전수: 실제로 옮기는 조합 개수', sweepMoves, 182)

// ── planEdgeScroll: 드래그 중 목록 가장자리 자동 스크롤 속도 램프 (deck.service.ts 에서 옮겨 옴) ──
// 실경로(R73)의 rAF 루프는 이 값에 dt 를 곱해 `scrollTop` 에 그대로 붓는다 — 부호가 뒤집히면
// 목록이 반대로 흐르고, 0 을 못 주면 끝에 닿은 채로 매 프레임 헛돌고, 앞·뒤 띠가 겹치면
// 어디에 놓아도 화면이 흘러 드롭 자체가 불가능해진다. 그래서 대표값 몇 개가 아니라 목록
// 좌표를 촘촘히 훑어 **성질**로 판정한다(구현식을 테스트에 다시 쓰지 않는다).
const BAND = 32
const MINP = 150
const MAXP = 800
// 기본 스크롤 상태 = 위아래 양쪽으로 갈 데가 남은 목록 (cur 250 / maxScroll 500)
function sp (o) {
    return planEdgeScroll({
        pos: o.pos,
        near: o.near,
        far: o.far,
        cur: 'cur' in o ? o.cur : 250,
        maxScroll: 'maxScroll' in o ? o.maxScroll : 500,
        bandPx: 'bandPx' in o ? o.bandPx : BAND,
        minPps: 'minPps' in o ? o.minPps : MINP,
        maxPps: 'maxPps' in o ? o.maxPps : MAXP,
    })
}

// 대표값 — 긴 목록(300px)이면 띠는 상한 32px 그대로
check('가운데는 안 흐른다', sp({ pos: 150, near: 0, far: 300 }), 0)
check('맨 위 끝에 붙이면 -MAX', sp({ pos: 0, near: 0, far: 300 }), -800)
check('맨 아래 끝에 붙이면 +MAX', sp({ pos: 300, near: 0, far: 300 }), 800)
check('위쪽 띠 안쪽 경계(near+band)에서 -MIN', sp({ pos: 32, near: 0, far: 300 }), -150)
check('아래쪽 띠 안쪽 경계(far-band)에서 +MIN', sp({ pos: 268, near: 0, far: 300 }), 150)
check('띠 한 칸 밖은 0 (경계 바로 안쪽에서 끊긴다)', sp({ pos: 33, near: 0, far: 300 }), 0)
check('띠 한 칸 밖은 0 (아래쪽)', sp({ pos: 267, near: 0, far: 300 }), 0)
check('띠 절반 깊이는 MIN/MAX 의 중간', sp({ pos: 16, near: 0, far: 300 }), -475)
check('띠 절반 깊이 (아래쪽) 는 부호만 반대', sp({ pos: 284, near: 0, far: 300 }), 475)
check('목록 밖(위) 은 0 — 빼는 손짓은 취소다', sp({ pos: -1, near: 0, far: 300 }), 0)
check('목록 밖(아래) 은 0', sp({ pos: 301, near: 0, far: 300 }), 0)
check('목록 밖 아주 멀리도 0', sp({ pos: -9999, near: 0, far: 300 }), 0)
check('near 가 0 이 아니어도 같다 (오프셋 무관)', sp({ pos: 116, near: 100, far: 400 }), -475)

// 짧은 목록 — 띠가 길이의 1/3 로 깎인다. 60px 목록이면 20px 씩, 가운데 20px 는 조용하다
check('짧은 목록(60px): 띠는 20px', sp({ pos: 20, near: 0, far: 60 }), -150)
check('짧은 목록(60px): 21px 는 이미 띠 밖', sp({ pos: 21, near: 0, far: 60 }), 0)
check('짧은 목록(60px): 가운데', sp({ pos: 30, near: 0, far: 60 }), 0)
check('짧은 목록(60px): 아래쪽 띠 경계', sp({ pos: 40, near: 0, far: 60 }), 150)
check('짧은 목록(60px): 아래 끝', sp({ pos: 60, near: 0, far: 60 }), 800)
check('96px 이면 띠가 딱 상한 32 와 같아진다', sp({ pos: 32, near: 0, far: 96 }), -150)
check('96px: 가운데 한 점만 조용', sp({ pos: 48, near: 0, far: 96 }), 0)

// 띠가 성립하지 않는 길이 — 목록 12px 미만이면 띠가 4px 아래라 아무 일도 없다
check('12px 목록: 띠 4px 로 겨우 성립 (위 끝)', sp({ pos: 0, near: 0, far: 12 }), -800)
check('12px 목록: 띠 안쪽 경계', sp({ pos: 4, near: 0, far: 12 }), -150)
check('11px 목록: 띠 미성립 -> 0', sp({ pos: 0, near: 0, far: 11 }), 0)
check('11px 목록: 아래 끝도 0', sp({ pos: 11, near: 0, far: 11 }), 0)
check('길이 0 목록: 0', sp({ pos: 0, near: 0, far: 0 }), 0)
check('far < near (뒤집힌 목록): 0', sp({ pos: 5, near: 10, far: 0 }), 0)

// 더 갈 데가 없으면 0 — rAF 루프를 헛돌게 두지 않는 갈래
check('맨 위까지 스크롤됨 + 위로 끌기 = 0', sp({ pos: 0, near: 0, far: 300, cur: 0 }), 0)
check('맨 위까지 스크롤됨 + 아래로 끌기는 흐른다', sp({ pos: 300, near: 0, far: 300, cur: 0 }), 800)
check('맨 아래까지 스크롤됨 + 아래로 끌기 = 0', sp({ pos: 300, near: 0, far: 300, cur: 500 }), 0)
check('맨 아래까지 스크롤됨 + 위로 끌기는 흐른다', sp({ pos: 0, near: 0, far: 300, cur: 500 }), -800)
check('스크롤할 것이 아예 없는 목록 = 0 (위)', sp({ pos: 0, near: 0, far: 300, cur: 0, maxScroll: 0 }), 0)
check('스크롤할 것이 아예 없는 목록 = 0 (아래)', sp({ pos: 300, near: 0, far: 300, cur: 0, maxScroll: 0 }), 0)
check('남은 거리 0.5px 는 0 (임계 포함)', sp({ pos: 0, near: 0, far: 300, cur: 0.5 }), 0)
check('남은 거리 0.6px 는 흐른다', sp({ pos: 0, near: 0, far: 300, cur: 0.6 }), -800)
check('아래쪽도 남은 거리 0.5px 는 0', sp({ pos: 300, near: 0, far: 300, cur: 499.5 }), 0)
check('아래쪽 남은 거리 0.6px 는 흐른다', sp({ pos: 300, near: 0, far: 300, cur: 499.4 }), 800)

// 이상값 — 실경로에서 오지 않아야 하는 값이 와도 루프를 이상하게 만들지 않아야 한다
check('pos NaN -> 0', sp({ pos: NaN, near: 0, far: 300 }), 0)
check('near NaN -> 0', sp({ pos: 10, near: NaN, far: 300 }), 0)
check('far NaN -> 0', sp({ pos: 10, near: 0, far: NaN }), 0)
check('bandPx NaN -> 0', sp({ pos: 0, near: 0, far: 300, bandPx: NaN }), 0)
check('bandPx 0 -> 0', sp({ pos: 0, near: 0, far: 300, bandPx: 0 }), 0)
check('bandPx 음수 -> 0', sp({ pos: 0, near: 0, far: 300, bandPx: -5 }), 0)
check('bandPx 가 목록보다 커도 1/3 로 깎인다', sp({ pos: 100, near: 0, far: 300, bandPx: 1e9 }), -150)
check('maxScroll 음수 + 아래로 끌기 = 0', sp({ pos: 300, near: 0, far: 300, cur: 0, maxScroll: -10 }), 0)
check('minPps > maxPps 면 램프가 뒤집힌다 (구현식 그대로)', sp({ pos: 0, near: 0, far: 300, minPps: 800, maxPps: 150 }), -150)
check('minPps > maxPps: 띠 경계에서는 큰 값', sp({ pos: 32, near: 0, far: 300, minPps: 800, maxPps: 150 }), -800)
check('minPps == maxPps 면 어디서나 같은 속도', sp({ pos: 16, near: 0, far: 300, minPps: 200, maxPps: 200 }), -200)
// cur/maxScroll 이 NaN 이면 "더 갈 데 없음" 가드가 지나가 버린다 — 구현 그대로 기록해 둔다
check('cur NaN 은 끝 판정을 통과해 속도가 난다 (실경로에서는 올 수 없는 값)', sp({ pos: 0, near: 0, far: 300, cur: NaN }), -800)
check('maxScroll NaN 도 같다', sp({ pos: 300, near: 0, far: 300, cur: 0, maxScroll: NaN }), 800)

// ── 전수 ① 좌표 x 스크롤상태 스윕 ──
// 목록 길이·위치·포인터 좌표·스크롤 상태의 모든 조합에서 성질 여섯 —
//  ①유한한 수 ②부호는 어느 띠에 있는지와 일치 ③|속도| 는 [MIN,MAX] 안
//  ④좌표를 위->아래로 훑으면 부호가 (-)*0*(+)* 순서 (= 앞뒤 띠가 절대 겹치지 않는다)
//  ⑤각 띠 안에서 가장자리에 가까울수록 |속도| 가 크다 (단조)
//  ⑥그 방향으로 갈 데가 없으면 그 부호가 아예 안 나온다
const SWEEP_LENS = [0, 6, 11, 12, 13, 24, 48, 96, 97, 200, 400]
const SWEEP_NEARS = [0, 100, -50, 37.5]
// [cur, maxScroll] — 끝에 닿은 상태와 0.5px 임계를 양쪽으로 끼워 둔다
const SWEEP_STATES = [[0, 0], [0, 500], [0.5, 500], [0.6, 500], [250, 500], [499.4, 500], [499.5, 500], [500, 500]]
const SWEEP_STEPS = 48
let scrollCalls = 0
let scrollNonZero = 0
const badFinite = []
const badBound = []
const badSignZone = []
const badRunOrder = []
const badMono = []
const badBlocked = []
const badOutside = []
for (const len of SWEEP_LENS) {
    for (const near of SWEEP_NEARS) {
        const far = near + len
        for (const [cur, maxScroll] of SWEEP_STATES) {
            const tag = `len=${len} near=${near} cur=${cur}/${maxScroll}`
            const canUp = cur > 0.5
            const canDown = maxScroll - cur > 0.5
            // 목록 밖 네 점 — 언제나 0 이어야 한다
            for (const pos of [near - 10, near - 0.5, far + 0.5, far + 10]) {
                scrollCalls++
                const v = sp({ pos, near, far, cur, maxScroll })
                if (v !== 0) {
                    badOutside.push(`${tag} pos=${pos}: ${v}`)
                }
            }
            // 목록 안을 위에서 아래로 훑는다
            const seq = []
            for (let k = 0; k <= SWEEP_STEPS; k++) {
                const pos = len === 0 ? near : near + len * k / SWEEP_STEPS
                scrollCalls++
                const v = sp({ pos, near, far, cur, maxScroll })
                if (!Number.isFinite(v)) {
                    badFinite.push(`${tag} pos=${pos}: ${v}`)
                    continue
                }
                if (v !== 0) {
                    scrollNonZero++
                    const mag = Math.abs(v)
                    if (mag < MINP - 1e-9 || mag > MAXP + 1e-9) {
                        badBound.push(`${tag} pos=${pos}: ${v}`)
                    }
                    // 위쪽 띠는 목록의 앞 절반, 아래쪽 띠는 뒤 절반에만 있을 수 있다
                    const mid = near + len / 2
                    if (v < 0 && pos > mid) {
                        badSignZone.push(`${tag} pos=${pos}: 음수인데 아래 절반`)
                    }
                    if (v > 0 && pos < mid) {
                        badSignZone.push(`${tag} pos=${pos}: 양수인데 위 절반`)
                    }
                    if (v < 0 && !canUp) {
                        badBlocked.push(`${tag} pos=${pos}: 위로 갈 데가 없는데 ${v}`)
                    }
                    if (v > 0 && !canDown) {
                        badBlocked.push(`${tag} pos=${pos}: 아래로 갈 데가 없는데 ${v}`)
                    }
                }
                seq.push(v)
            }
            // ④ 부호 순서 (-)*0*(+)*
            let phase = 0
            for (let i = 0; i < seq.length; i++) {
                const s = seq[i] < 0 ? 0 : seq[i] === 0 ? 1 : 2
                if (s < phase) {
                    badRunOrder.push(`${tag}: 부호가 되돌아갔다 (${seq.map(x => Math.sign(x)).join('')})`)
                    break
                }
                phase = s
            }
            // ⑤ 단조 — 음수 구간은 아래로 갈수록 약해지고, 양수 구간은 강해진다
            for (let i = 1; i < seq.length; i++) {
                const a = seq[i - 1]
                const b = seq[i]
                if (a < 0 && b < 0 && Math.abs(b) > Math.abs(a) + 1e-9) {
                    badMono.push(`${tag}: 위쪽 띠에서 가장자리에서 멀어졌는데 빨라졌다 ${a} -> ${b}`)
                }
                if (a > 0 && b > 0 && b < a - 1e-9) {
                    badMono.push(`${tag}: 아래쪽 띠에서 가장자리에 가까워졌는데 느려졌다 ${a} -> ${b}`)
                }
            }
        }
    }
}
check('전수①: 호출 수 (길이 11 x 위치 4 x 스크롤상태 8 x 좌표 53)', scrollCalls, 18656)
check('전수①: 흐른 조합이 실제로 있었다', scrollNonZero > 3000, true)
check('전수①: 언제나 유한한 수', badFinite.length ? badFinite[0] : 0, 0)
check('전수①: |속도| 는 MIN..MAX 안', badBound.length ? badBound[0] : 0, 0)
check('전수①: 부호는 그 띠 쪽에서만', badSignZone.length ? badSignZone[0] : 0, 0)
check('전수①: 앞뒤 띠가 겹치지 않는다 ((-)*0*(+)*)', badRunOrder.length ? badRunOrder[0] : 0, 0)
check('전수①: 깊이에 단조', badMono.length ? badMono[0] : 0, 0)
check('전수①: 갈 데 없는 방향은 0', badBlocked.length ? badBlocked[0] : 0, 0)
check('전수①: 목록 밖은 언제나 0', badOutside.length ? badOutside[0] : 0, 0)

// ── 전수 ② 경계 대칭 ──
// 위쪽 띠와 아래쪽 띠는 같은 깊이에서 크기가 같고 부호만 반대여야 한다.
// 어긋나면 위로 끌 때와 아래로 끌 때 손맛이 달라진다 — 눈으로는 못 잡는 종류의 결함이다.
const SYM_LENS = [12, 13, 20, 60, 96, 97, 200, 400]
const SYM_NEARS = [0, 100, -50]
const SYM_XS = [0, 0.5, 1, 2, 3, 4, 8, 16, 31, 32, 33, 50]
let symPairs = 0
const badSym = []
for (const len of SYM_LENS) {
    for (const near of SYM_NEARS) {
        const far = near + len
        for (const x of SYM_XS) {
            symPairs++
            const up = sp({ pos: near + x, near, far })
            const down = sp({ pos: far - x, near, far })
            if (Math.abs(up + down) > 1e-9) {
                badSym.push(`len=${len} near=${near} x=${x}: 위 ${up} 아래 ${down}`)
            }
        }
    }
}
check('전수②: 대칭 짝 수 (길이 8 x 위치 3 x 깊이 12)', symPairs, 288)
check('전수②: 위/아래 같은 깊이 = 크기 같고 부호 반대', badSym.length ? badSym[0] : 0, 0)

// ── 전수 ③ 띠 두께 x 속도 상하한 스윕 ──
// 상수를 인자로 받게 뽑아 둔 덕에 조합을 만들 수 있다. min>max 처럼 뒤집힌 설정까지
// 넣어 두는 이유는 "속도가 준 두 값 사이를 벗어나지 않는다" 가 램프의 유일한 계약이라서다.
const BAND_PXS = [0, 3, 4, 12, 32, 64, 1e9, -5]
const PPS_PAIRS = [[150, 800], [800, 150], [0, 0], [150, 150], [-100, 100]]
const PPS_LENS = [0, 12, 96, 300]
const PPS_FRACS = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]
let ppsCalls = 0
const badPpsBound = []
const badPpsFinite = []
for (const bandPx of BAND_PXS) {
    for (const [minPps, maxPps] of PPS_PAIRS) {
        const lo = Math.min(minPps, maxPps)
        const hi = Math.max(minPps, maxPps)
        for (const len of PPS_LENS) {
            for (const frac of PPS_FRACS) {
                ppsCalls++
                const v = sp({ pos: len * frac, near: 0, far: len, bandPx, minPps, maxPps })
                if (!Number.isFinite(v)) {
                    badPpsFinite.push(`band=${bandPx} ${minPps}..${maxPps} len=${len} frac=${frac}: ${v}`)
                    continue
                }
                const mag = Math.abs(v)
                const cap = Math.max(Math.abs(lo), Math.abs(hi))
                if (mag > cap + 1e-9) {
                    badPpsBound.push(`상한 band=${bandPx} ${minPps}..${maxPps} len=${len} frac=${frac}: ${v}`)
                }
                // 하한은 달라진다 — 두 속도가 **부호가 같을 때만** 램프가 0 을 지나지 않으므로
                // 최소속도가 보장된다. 섞여 있으면(-100..100) 램프가 도중에 0 을 가로지러
                // "움직이는드 말드 생기지 않는다" — 실제 설정(150..800)은 전자다.
                const sameSign = lo >= 0 || hi <= 0
                if (sameSign && mag !== 0 && mag < Math.min(Math.abs(lo), Math.abs(hi)) - 1e-9) {
                    badPpsBound.push(`하한 band=${bandPx} ${minPps}..${maxPps} len=${len} frac=${frac}: ${v}`)
                }
            }
        }
    }
}
check('전수③: 호출 수 (띠 8 x 속도쌍 5 x 길이 4 x 깊이 7)', ppsCalls, 1120)
check('전수③: 언제나 유한한 수', badPpsFinite.length ? badPpsFinite[0] : 0, 0)
check('전수③: 속도는 준 다 값 사이 (상한 항상, 하한은 부호가 같을 때)', badPpsBound.length ? badPpsBound[0] : 0, 0)
check('전수: planEdgeScroll 총 호출 수', scrollCalls + symPairs * 2 + ppsCalls, 20352)

console.log(`\norder: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
