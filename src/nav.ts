/**
 * 사이드바 **키보드 내비게이션**의 순수 규칙 — 보이는 줄 펼치기(`navRowsOf`)와 그 위의
 * 커서 이동(`stepNavIndex`). Angular/Tabby/DOM 에 기대지 않아 단위 테스트가 된다.
 *
 * 이 기능의 계약은 딱 하나다 — **훑는 동안 활성 탭이 바뀌지 않는다.** 지나가는 탭의 출력이
 * 화면을 덮으면 훑어보기 자체가 불가능해지므로, ↑↓ 는 `navFocus`(포커스 링)만 옮기고
 * 선택은 Enter 에서만 일어난다. 그래서 "어느 줄로 가는가" 는 화면을 흔들지 않고 확인할 수
 * 있어야 하는 값이고, 펼치기와 이동을 한 곳에 둔 이유도 그것이다 — 줄 목록의 순서와
 * 커서의 경계 규칙이 같은 계약(화면에 보이는 순서)을 지켜야 한다.
 *
 * **`deck.service.ts` 에서 여기로 옮겨 왔다** — 그 파일은 Angular/Tabby 를 import 해서
 * `package.json` 의 test 스크립트가 컴파일하는 순수 모듈 목록에 들어갈 수 없고, 그래서 이 두
 * 함수엔 유닛 테스트가 한 개도 없었다(사람이 손으로 떼어내 돌려보는 것이 전부였다).
 * `planTabMove` 를 `order.ts` 로 옮긴 것과 같은 이유·같은 방식이며, 구현은 한 줄도 바꾸지
 * 않았다(실경로에서 이미 도는 코드다). 옮기자마자 `test/nav.test.js` 의 전수 검사가 붙었다.
 */

/**
 * 키보드가 훑는 줄 하나 — **화면에 실제로 보이는 것만** 담는다.
 *
 * 그룹 헤더는 그룹 키로, 탭 줄은 탭 객체로 가리킨다. 인덱스로 들고 있으면 안 된다 —
 * 탭이 하나 닫히거나 검색이 걸리면 같은 인덱스가 **다른 줄**을 가리키게 되고
 * (`dropTargetAt` 이 드래그 중에 겪은 것과 같은 함정), 그 사이 사람은 다른 세션을 열게 된다.
 */
/**
 * `Ctrl-1` … `Ctrl-N` 으로 바로 갈 수 있는 줄 수.
 *
 * 선언(`hotkeys.ts`)·기본 묶기(`config.ts`)·처리(`deck.service.ts`) 세 곳이 같은 값을 봐야 해서
 * 한 곳에 둔다 — 한쪽만 늘리면 **묶이지 않은 핫키**나 **처리되지 않는 선언**이 생기고 둘 다 조용하다
 * (세 곳의 일치는 `test/hotkeys.test.js` 가 소스로 대조한다).
 *
 * **이 파일에 두는 이유는 순환 의존이다.** `hotkeys.ts` 에 두면 `deck.service` 가 그것을 가져오면서
 * deck → hotkeys → devReload.service → reload.service → deck 고리가 생긴다. 이 모듈은 import 가
 * 하나도 없어서(Angular·Tabby·DOM 어느 것도 안 쓴다) 누가 가져가도 고리가 안 생기고, 이 값을
 * 쓰는 규칙(`pickJumpTarget`)도 바로 아래 있다.
 */
export const JUMP_SLOTS = 9

export type NavRow<T> = { kind: 'head', key: string | null } | { kind: 'tab', tab: T }

/**
 * 렌더 계획을 키보드 이동 순서로 펼친다 — `render()` 의 루프와 **같은 순서**여야 한다.
 *
 * 순서의 출처는 `renderPlan()` 하나뿐이다. 여기서 정렬·필터·그룹 규칙을 다시 적으면 그 사본이
 * 낡는다(`deck.service.ts` 가 `renderPlan` 을 뽑은 이유 자체가 그것이다). 그래서 이 함수는
 * **받은 구획을 그대로 펼치기만** 하고, 무엇이 보이는지는 판단하지 않는다.
 *
 * 접힌 그룹은 헤더만 남고 줄이 없다 — 화면과 같다. 헤더를 안 그리는 화면(`withHeads: false`)은
 * `head: false` 로 들어오므로 평면 목록이 된다.

 *
 * **전제 — 구획마다 `head`·`collapsed` 가 일관되어야 한다.** 지금 유일한 호출부(`navPlan`)
 * 는 둘을 화면 전체의 `withHeads` 에서 파생시키므로 어긋날 수 없다. 손으로 섞어 넣으면 규칙이
 * 이상해진다 — `head: false` + `collapsed: true` 인 구획은 **통째로 사라지고**(줄 0개), 구획마다
 * `head` 가 섞이면 헤더 없는 구획의 탭이 **앞 구획 헤더 밑에 붙어** 보인다.
 * 그 조합을 함수가 막지 않는 이유는, 막는 분기가 지금 도달 불가라 검증되지 않는 코드로 남기
 * 때문이다. 새 호출부를 만들 사람이 읽을 곳은 여기다. */
export function navRowsOf<T> (
    sections: ReadonlyArray<{ key: string | null, tabs: readonly T[], head: boolean, collapsed: boolean }>,
): Array<NavRow<T>> {
    const rows: Array<NavRow<T>> = []
    for (const s of sections) {
        if (s.head) {
            rows.push({ kind: 'head', key: s.key })
        }
        if (s.collapsed) {
            continue
        }
        for (const tab of s.tabs) {
            rows.push({ kind: 'tab', tab })
        }
    }
    return rows
}

/**
 * 보이는 줄이 `count` 개일 때 `index` 에서 `step` 칸 움직인 자리. 줄이 없으면 -1.
 *
 * 화면도 DOM 도 모르는 순수 규칙으로 뽑아 둔 이유는 `planTabMove` 와 같다 — 경계에서
 * 무엇이 일어나는지(멈추나 감싸나)를 좌표·포커스 없이 확인할 수 있어야 한다.
 * 규칙 세 가지 —
 *  1) 포커스가 없거나(-1) 목록에서 사라졌으면(닫힘·필터) **방향에 맞는 끝**에서 새로 시작한다.
 *     아래로 눌렀으면 첫 줄, 위로 눌렀으면 마지막 줄이다. 손이 간 방향으로 들어와야
 *     "아무 일도 안 일어났다" 가 되지 않는다.
 *  2) `wrap` 이 false 면 끝에서 **제자리**다(기본). 감싸면 "맨 아래에 왔다" 는 신호가 사라진다.
 *  3) `wrap` 이 true 면 반대쪽 끝으로 — 음수 나머지를 쓰지 않게 두 번 접는다.
 *
 * 돌려주는 값은 **줄 인덱스일 뿐 선택이 아니다** — 호출부(`moveNav`)는 이 값으로 `navFocus`
 * 만 옮기고 활성 탭은 건드리지 않는다. 그리고 헤더 줄을 건너뛰지 않는다: 건너뛰면 그룹 A 의
 * 마지막 탭에서 B 의 첫 탭으로 점프해 "보이는 순서대로 훑는다" 는 계약이 깨진다.
 */
/**
 * `Ctrl+W` 가 닫을 탭 — **키보드가 어디에 있느냐로 갈린다.**
 *
 * 터미널에서 눌렀으면 활성 탭이다(사람이 보고 있는 화면 = 닫으려는 것). 목록이 키보드를
 * 갖고 있을 때(`inList`)는 **포커스 링이 얹힌 줄**이다 — 그때 활성 탭을 닫으면 링을 옮겨
 * 놓고 엉뚱한 탭이 사라진다. ↑↓ 로 훑다가 "이건 버리자" 하는 자리가 곧 이 키의 쓰임새다.
 *
 * 두 경우에 `null`(아무것도 하지 않는다)을 돌려준다 —
 *  1) 목록에서 포커스가 **그룹 헤더**에 있다. 헤더는 탭이 아니고, "이 그룹을 통째로 닫는다"
 *     는 되돌릴 수 없는 조작이라 키 하나에 매달 것이 아니다.
 *  2) 고른 탭이 `tabs` 에 없다 — 이미 닫혔거나(포커스가 낡았다) 다른 창의 것이다.
 *     `navFocus` 는 렌더마다 정리되지만(`pruneNavFocus`) 그 사이 키가 들어올 수 있다.
 *
 * 호출부(`claimCtrlWKey`)는 `null` 이면 **키를 막지 않고 흘린다** — 터미널의 `Ctrl+W`
 * (앞 단어 지우기)를 우리가 먹어 놓고 아무 일도 안 하는 것이 가장 나쁘다.
 */
export function pickCloseTarget<T> (opts: {
    inList: boolean,
    focus: NavRow<T> | null,
    active: T | null,
    tabs: readonly T[],
}): T | null {
    const { inList, focus, active, tabs } = opts
    if (inList) {
        if (!focus || focus.kind !== 'tab') {
            return null
        }
        return tabs.includes(focus.tab) ? focus.tab : null
    }
    return active && tabs.includes(active) ? active : null
}

export function stepNavIndex (count: number, index: number, step: number, wrap: boolean): number {
    if (!Number.isInteger(count) || count <= 0) {
        return -1
    }
    if (!Number.isInteger(index) || index < 0 || index >= count) {
        return step < 0 ? count - 1 : 0
    }
    if (!Number.isInteger(step) || step === 0) {
        return index
    }
    const next = index + step
    if (next >= 0 && next < count) {
        return next
    }
    if (!wrap) {
        return index
    }
    return ((next % count) + count) % count
}

/**
 * `Ctrl-N` 이 고를 탭 — **보이는 줄 중 탭 줄만 세어** N 번째(1부터).
 *
 * 헤더를 빼고 세는 이유: 사람이 "위에서 세 번째 세션" 이라고 할 때 그룹 제목은 세지 않는다.
 * 헤더를 세면 그룹이 하나 생기거나 접히는 것만으로 같은 키가 다른 세션을 연다 — 그룹 구성은
 * 폴더가 바뀔 때마다 저절로 움직이는 값이라(`group.ts`) 사람 머릿속의 번호와 곧 어긋난다.
 *
 * **접힌 그룹 안의 탭은 애초에 `rows` 에 없다**(`navRowsOf`). 화면에 안 보이는 줄에 번호를
 * 주면 그 번호로 간 사람은 자기가 어디로 왔는지 알 수 없다 — 이 목록이 "보이는 순서" 라는
 * 계약(`navRowsOf` 주석)을 그대로 따른다.
 *
 * 범위 밖(줄이 모자람 · slot 이 0 이하거나 정수가 아님)은 `null` 이고, 호출부는 **아무 일도
 * 하지 않는다** — 없는 자리를 눌렀을 때 가장 가까운 탭으로 보내면, 목록이 줄어든 줄 모르고
 * 누른 사람이 엉뚱한 세션에 입력하게 된다.
 */
export function pickJumpTarget<T> (rows: ReadonlyArray<NavRow<T>>, slot: number): T | null {
    if (!Number.isInteger(slot) || slot < 1) {
        return null
    }
    let n = 0
    for (const row of rows) {
        if (row.kind !== 'tab') {
            continue
        }
        if (++n === slot) {
            return row.tab
        }
    }
    return null
}
