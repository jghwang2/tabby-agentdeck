/**
 * 사이드바 **순서**의 순수 규칙 — 상태 정렬·집계, 드래그 재배열(`planTabMove`), 그리고 드래그 중 가장자리 자동 스크롤 속도(`planEdgeScroll`) — Angular/Tabby 에 기대지 않아 단위 테스트가 된다.
 *
 * 헤더 집계와 `sortByStatus` 정렬이 같은 우선순위를 써야 하므로 한 곳에 둔다.
 * 순서는 "사람이 지금 손대야 하는 것" 부터다 —
 *  waiting(승인대기) → error(오류) → limited(한도 도달) → running(진행중) → done(완료) → idle(대기)
 * 한도 도달은 사람이 풀 수 있는 일은 아니지만 "이 세션은 멈춰 있다" 를 알아야 하므로 진행중보다 앞에 둔다.
 * 세션을 여섯 개쯤 띄워 두면 어느 탭이 나를 기다리는지 한눈에 봐야 한다 (2026-09-02 요청).
 */
import { WorkStatus } from './api'

/** 표시·정렬 우선순위. 앞이 더 급하다 */
export const STATUS_ORDER: readonly WorkStatus[] = ['waiting', 'error', 'limited', 'running', 'done', 'idle']

/** 우선순위 숫자 — 작을수록 앞. 모르는 값은 맨 뒤로 보낸다 */
export function statusRank (status: WorkStatus | string): number {
    const i = STATUS_ORDER.indexOf(status as WorkStatus)
    return i < 0 ? STATUS_ORDER.length : i
}

/**
 * 상태별 개수. `STATUS_ORDER` 순서로, 0 인 상태는 빼고 돌려준다 — 헤더에 그대로 그리면 된다.
 */
export function countByStatus<T> (tabs: readonly T[], statusOf: (tab: T) => WorkStatus): Array<{ status: WorkStatus, count: number }> {
    const counts = new Map<WorkStatus, number>()
    for (const tab of tabs) {
        const s = statusOf(tab)
        counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const out: Array<{ status: WorkStatus, count: number }> = []
    for (const s of STATUS_ORDER) {
        const n = counts.get(s) ?? 0
        if (n > 0) {
            out.push({ status: s, count: n })
        }
    }
    return out
}

/**
 * 상태 우선순위로 정렬한 **복사본**. 같은 상태끼리는 원래 탭 순서를 지킨다(안정 정렬).
 * 원본 배열(`app.tabs`)은 건드리지 않는다 — Tabby 의 탭 순서는 사용자의 것이다.
 */
export function sortTabsByStatus<T> (tabs: readonly T[], statusOf: (tab: T) => WorkStatus): T[] {
    return tabs
        .map((tab, index) => ({ tab, index, rank: statusRank(statusOf(tab)) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(x => x.tab)
}

/** 드롭이 대상 줄의 앞에 붙나 뒤에 붙나 */
export type DropPlace = 'before' | 'after'

/**
 * `from` 번째를 `to` 번째의 앞/뒤로 옮긴 **인덱스 순열**. 옮길 이유가 없으면 null.
 *
 * 배열도 탭도 모르는 순수 규칙으로 뽑아 둔 이유 둘 —
 *  1) `app.tabs` 를 흔드는 것은 되돌릴 수 없는 조작이다. "어디로 가는가" 를 DOM·포인터 없이
 *     확인할 수 있어야 한다.
 *  2) **제자리로 놓는 드래그를 걸러내는 곳**이 여기 하나여야 한다. 자기 바로 앞 줄의 뒤에
 *     놓는 것은 순열이 항등이므로 null 이 되고, 그러면 호출부가 `emitTabsChanged()` 를
 *     부르지 않는다 — 아무것도 안 바뀐 재배열로 순정 탭바를 다시 그리게 하지 않는다.
 *
 * **`deck.service.ts` 에서 여기로 옮겨 왔다** — 그 파일은 Angular/Tabby 를 import 해서
 * `package.json` 의 test 스크립트가 컴파일하는 순수 모듈 목록에 들어갈 수 없고, 그래서 이 함수엔
 * 유닛 테스트가 한 개도 없었다(손으로 떼어내 돌려보는 것이 전부였다). 순서를 다루는 순수 규칙이라
 * 정렬 규칙과 같은 자리가 맞고, 옮기자마자 위 1) 이 말한 "DOM·포인터 없이 확인" 이
 * `test/order.test.js` 의 전수 검사가 됐다. 구현은 한 줄도 바꾸지 않았다(실경로 R58 통과 상태).
 */
export function planTabMove (count: number, from: number, to: number, place: DropPlace): number[] | null {
    if (!Number.isInteger(count) || count < 2) {
        return null
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
        return null
    }
    if (from < 0 || from >= count || to < 0 || to >= count || from === to) {
        return null
    }
    const order: number[] = []
    for (let i = 0; i < count; i++) {
        order.push(i)
    }
    order.splice(from, 1)
    // 뽑아낸 뒤의 자리를 다시 찾는다 — `to` 는 뽑기 전의 인덱스라 그대로 쓰면 한 칸 밀린다
    const at = order.indexOf(to) + (place === 'after' ? 1 : 0)
    order.splice(at, 0, from)
    for (let i = 0; i < count; i++) {
        if (order[i] !== i) {
            return order
        }
    }
    return null
}

/** 드래그 자동 스크롤 한 프레임의 입력 — 좌표와 숫자만. DOM 은 호출부가 읽는다 */
export type EdgeScrollInput = {
    /** 포인터의 축 좌표 (viewport px) */
    pos: number
    /** 목록의 앞쪽 경계 — 세로면 `top`, 가로면 `left` */
    near: number
    /** 목록의 뒤쪽 경계 — 세로면 `bottom`, 가로면 `right` */
    far: number
    /** 지금 스크롤 위치 (`scrollTop`/`scrollLeft`) */
    cur: number
    /** 스크롤할 수 있는 최대값 (`scrollHeight - clientHeight` 등) */
    maxScroll: number
    /** 가장자리 띠 두께의 **상한** (px) — 짧은 목록에서는 이보다 얇아진다 */
    bandPx: number
    /** 띠의 안쪽 경계에서의 속도 (px/s) */
    minPps: number
    /** 가장자리에 완전히 붙였을 때의 속도 (px/s) */
    maxPps: number
}

/**
 * 드래그 중 목록 가장자리 **자동 스크롤 속도** (px/s). 0 이면 스크롤할 이유가 없다.
 * 음수 = 목록 앞쪽(위/왼쪽), 양수 = 뒤쪽(아래/오른쪽).
 *
 * 0 을 주는 갈래 넷 —
 *  1) **목록 밖**: 목록 밖에서 손을 떼는 것은 취소 손짓이다(`dropTargetAt` 의
 *     `outside-list`). 취소하려고 커서를 빼는 사람의 목록을 흘려 보내면 안 된다.
 *  2) 띠 밖(목록 가운데): 평범한 드롭을 방해하지 않는다.
 *  3) 그 방향으로 **더 갈 데가 없다**: 루프를 살려 두면 아무 일도 없이 매 프레임 돈다.
 *  4) 목록이 너무 짧아 띠가 성립하지 않는다.
 *
 * 띠를 `bandPx` 그대로 쓰지 않고 목록 길이의 1/3 로 깎는 것이 이 규칙의 핵심이다 —
 * 그래서 앞·뒤 띠는 **어떤 길이에서도 겹치지 않고**(각 1/3, 가운데 1/3 은 조용하다) 짧은
 * 목록에서 "어디에 놓아도 화면이 흘러 놓기 자체가 불가능" 해지는 일이 생기지 않는다.
 * 목록이 12px 보다 짧으면 띠가 4px 아래로 내려가 아예 성립하지 않는다(갈래 4).
 *
 * 상수(32 / 150 / 800)를 안으로 들이지 않고 **인자로 받는다** — 그 세 값의 근거는
 * 줄 높이(`.ad-tab`)와 모니터 주사율이라 `deck.service.ts` 의 상수 주석에 적혀 있고,
 * 사본을 여기 두면 둘 중 하나가 낡는다. 인자로 받으면 테스트가 띠·속도 조합을 직접
 * 만들어 경계 대칭·단조·상하한을 전수로 훑을 수 있다는 이득도 같이 온다.
 *
 * **`deck.service.ts` 의 `dragScrollSpeed` 에서 여기로 옮겨 왔다** — 그 파일은 Angular/Tabby
 * 를 import 해서 `package.json` 의 test 스크립트가 컴파일하는 순수 모듈 목록에 들어갈 수 없고,
 * 그래서 이 속도 램프는 실경로 프로브(RO9·RO13 의 `speed` 진단구)로만 검증됐다.
 * `planTabMove`·`stepNavIndex` 를 옮긴 것과 같은 이유·같은 방식이며, 구현은 이름만 인자로
 * 바꿨을 뿐 산술은 한 줄도 손대지 않았다(실경로 R73 통과 상태). 남은 `dragScrollSpeed` 는
 * rect·`scrollTop` 을 읽어 이 함수에 넘기는 껍데기다 — 경계를 그렇게 그은 이유는 DOM 을
 * 읽는 줄과 속도를 정하는 줄이 한 함수에 있으면 후자를 검사할 방법이 없어서다.
 */
export function planEdgeScroll (input: EdgeScrollInput): number {
    const { pos, near, far, cur, maxScroll, bandPx, minPps, maxPps } = input
    if (pos < near || pos > far) {
        return 0
    }
    // 앞·뒤 띠가 겹치면 목록 어디에 커서를 두어도 화면이 흘러 **놓기 자체가 불가능**해진다
    const band = Math.min(bandPx, (far - near) / 3)
    if (band < 4) {
        return 0
    }
    let dir = 0
    let depth = 0
    if (pos <= near + band) {
        dir = -1
        depth = (near + band - pos) / band
    } else if (pos >= far - band) {
        dir = 1
        depth = (pos - (far - band)) / band
    } else {
        return 0
    }
    const left = dir < 0 ? cur : maxScroll - cur
    if (left <= 0.5) {
        return 0
    }
    const t = Math.min(1, Math.max(0, depth))
    return dir * (minPps + (maxPps - minPps) * t)
}
