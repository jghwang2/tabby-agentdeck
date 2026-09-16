/**
 * 줄 드래그로 탭 순서 바꾸기(R58) 회귀 프로브 — `tools/run-all.ps1` 의 확장 프로브로 돈다.
 *
 * id 는 `RO1`~`RO13`. **왜 별도 파일인가** — 0.12.0 에서 들어간 이 기능은 실경로 확인이
 * 딱 한 번이었고 회귀 항목이 없었다. 다음에 누가 렌더(`renderTab`·`render`)나 포인터 처리
 * (`armRowDrag`·`dragMove`·`endRowDrag`)를 건드리면 조용히 깨진다. 특히 두 계약이 위험하다:
 *
 *  1) **`data-ad-index` 는 `app.tabs` 인덱스다** — "보이는 순서" 로 바뀌는 순간
 *     R16·R19·R41·GR2 가 전부 **거짓 실패**한다(줄을 그 값으로 찾기 때문이다). 그 계약을
 *     여기서 지킨다(RO2).
 *  2) **드래그는 클릭·더블클릭·우클릭과 한 줄 위에 공존한다** — 임계치(5px) 전에는 아무 일도
 *     없어야 하고, 드래그로 끝난 손짓의 click 은 삼켜야 하지만 **그 다음 클릭은 살아야** 한다(RO8).
 *  3) **자동 스크롤은 삽입선을 데리고 가야 한다**(RO9~RO13). 목록이 흐르는데 삽입선이 옛 자리에
 *     남으면 "어디에 떨어질지 모르는 드래그" 가 되어, 이 기능이 없애려던 문제로 되돌아간다.
 *     그리고 **끌지 않을 때는 아무 일도 없어야** 한다 — 목록 끝에 커서를 얹기만 해도 화면이
 *     흐르면 사이드바를 눈으로 훑는 것 자체가 불가능해진다.
 *
 * ## 규칙을 베끼지 않는다
 *
 * "옮긴 뒤 순서가 무엇이 되어야 하나" 를 프로브가 계산하면 그것은 `planTabMove`(src/order.ts)의
 * 사본이고, 사본은 낡는다 — `probe-all.js` 의 화면 판정 사본이 낡아 R2·R14 가 거짓 실패한 사고가
 * 진단구를 열게 만들었다. 그래서 두 가지만 본다:
 *   - 제품이 말한 결과(`__agentdeck.reorder()` 의 `order`)와 **실제 `app.tabs`** 가 같은가
 *   - `before/after` 의 **정의**만 확인한다 — A 를 B 의 뒤에 놓았으면 A 는 B 바로 뒤에 있고,
 *     A 를 뺀 나머지의 상대 순서는 그대로다. (순열 공식을 다시 적지 않아도 이것으로 충분하다)
 * 화면 순서의 정답도 제품에게 묻는다 — `groups().plan` 의 펴진 그룹 `tabIndexes` 를 이어붙인 것이
 * 곧 "그려져야 하는 줄과 그 순서" 다.
 *
 * ## 드래그를 흉내내는 방법 (실측)
 *
 * 제품이 `setPointerCapture` 를 **일부러 쓰지 않는다**(합성 포인터에 그것이 던져서 프로브가
 * 못 쓰게 된다 — `tools/README.md` 함정 목록, `deck.service.ts:3915-3919`). 뒤 이벤트는
 * `document` 의 **캡처 단계** 리스너가 받으므로 아래 순서로 실제 경로가 전부 돈다:
 *   `row` 에 `pointerdown` → `document` 에 `pointermove`(5px 초과) → `document` 에 `pointerup`
 * `button: 0` 이 없으면 `armRowDrag` 가 첫 줄에서 되돌아간다. 좌표는 실제 `getBoundingClientRect`
 * 값을 쓴다 — `dropTargetAt` 이 `document.elementFromPoint` 로 대상 줄을 짚기 때문에 가짜 좌표로는
 * 아무 자리도 안 나온다. 삽입선(`.ad-reorder-line`)은 `pointer-events: none` 이라 자기 자신을
 * 짚는 일은 없다(`styles.scss:1505`).
 *
 * ## 되돌리기 (가장 중요한 정리)
 *
 * 이 프로브는 **`app.tabs` 를 실제로 흔든다.** 순서를 원래대로 돌려놓지 않으면 뒤 프로브
 * (R10·PR1·GR*)가 다른 순서의 화면을 재게 되고 그 결과가 흔들린다. 그래서 finally 에서
 * 제품 경로(`__agentdeck.reorder`)로 원래 순서를 복원하고, 복원 성공 여부를 `cleanup` 에 남긴다.
 * 만든 탭·심은 프로필·임시 폴더 이름은 `probe-group.js` 와 **같은 접두**(`agentdeck-probe-grp`
 * / `ad-grp-`)를 쓴다 — 러너의 GR15(정리 확인)가 그 이름으로 잔여를 찾으므로, 내가 흘린 것도
 * 같은 그물에 걸린다. **창 폭도 되돌린다** — RO9~RO13 이 목록을 넘치게 만들려고 창을 좁히고
 * (`narrowWindow`, 그 방법을 고른 이유가 거기 적혀 있다), finally 가 되돌린 결과를
 * `cleanup.winRestored` 에 남긴다.
 *
 * `pass: null` = **판정 불가**(환경이 조건을 못 만듦)이고 실패와 섞어 세지 않는다.
 */
(async () => {
    const ad = window.__agentdeck
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const sb = () => document.getElementById('agentdeck-sidebar')
    const listEl = () => (sb() ? sb().querySelector('.ad-list') : null)
    const rowEls = () => (sb() ? Array.from(sb().querySelectorAll('.ad-tab')) : [])
    /** 화면에 그려진 순서를 `app.tabs` 인덱스로 — 제품이 각 줄에 남기는 `data-ad-index` */
    const domSeq = () => rowEls().map(n => Number(n.dataset.adIndex))
    /** 줄은 **오직** 이 방법으로 찾는다. "n 번째 줄 = n 번째 탭" 가정이 R16·R19 를 거짓 실패시켰다 */
    const rowOf = i => (listEl() ? listEl().querySelector('.ad-tab[data-ad-index="' + i + '"]') : null)
    const lineCount = () => document.querySelectorAll('.ad-reorder-line').length
    const noteCount = () => (sb() ? sb().querySelectorAll('.ad-reorder-note').length : 0)

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })

    /** 케이스 이름을 한 곳에만 둔다 — 판정할 때와 `판정 불가`로 채울 때 이름이 갈리지 않게 */
    const CASES = [
        ['RO1', '진단구 경로로 실제 순서가 바뀐다'],
        ['RO2', 'data-ad-index 는 계속 app.tabs 인덱스'],
        ['RO3', '합성 드래그 — 임계치·삽입선·드롭'],
        ['RO4', '취소 3경로 (Esc · pointercancel · 놓을 자리 없음)'],
        ['RO5', 'sortByStatus 게이트 (진단구·드래그 양쪽)'],
        ['RO6', '다른 그룹에는 놓이지 않는다'],
        ['RO7', '헤더 있는 화면에서 같은 그룹 안 이동'],
        ['RO8', '클릭과의 공존 (드래그 뒤 전환 없음 · 다음 클릭은 살아 있다)'],
        ['RO9', '자동 스크롤 — 끝에 대면 목록이 흐르고 띠를 벗어나면 멈춘다'],
        ['RO10', '스크롤 뒤 삽입선이 지금 대상 줄을 가리킨다'],
        ['RO11', '손을 떼면 스크롤이 멈추고 잔여가 없다'],
        ['RO12', '화면 밖 줄로 실제로 옮겨진다 (이 기능의 목적)'],
        ['RO13', '끌지 않으면 흐르지 않는다 · 게이트를 끄면 0.12.0 과 같다'],
    ]
    const nameOf = id => (CASES.find(c => c[0] === id) || [id, id])[1]
    /** 아직 안 매긴 케이스를 `판정 불가`(pass:null)로 — 실패와 섞지 않는다 */
    const skipCases = (ids, reason, ev) => {
        for (const id of ids) {
            if (!results.some(r => r.id === id)) { add(id, nameOf(id), null, reason, ev || null) }
        }
    }
    const ALL_IDS = CASES.map(c => c[0])
    const MULTI_IDS = ['RO6', 'RO7']
    /** 목록이 실제로 넘치는 화면이 필요한 케이스들 (탭을 여러 개 띄운다) */
    const SCROLL_IDS = ['RO9', 'RO10', 'RO11', 'RO12', 'RO13']

    const NO_DIAG = '진단구 __agentdeck.reorder()/reorderDrag() 가 없다'
        + ' (낡은 dist 를 재고 있을 수 있다 — npm run build 후 재기동)'

    // ---------------------------------------------------------------- 공용 도구
    const sameArr = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])
    const sameSet = (a, b) => {
        const x = a.slice().sort((p, q) => p - q)
        const y = b.slice().sort((p, q) => p - q)
        return sameArr(x, y)
    }
    /** 지금 `app.tabs` 를 기준 배열 `ref` 의 인덱스로 적는다 (탭 객체 동일성으로 추적) */
    const seqRel = ref => ad.app.tabs.map(t => ref.indexOf(t))

    /**
     * "A 를 B 의 앞/뒤로 옮긴 결과인가" — `planTabMove` 를 베끼지 않고 **before/after 의 정의**만 본다.
     *
     *  - `adjacent` : A 가 B 바로 뒤(after) / 바로 앞(before) 에 있다
     *  - `othersKept`: A 를 뺀 나머지의 상대 순서가 그대로다 (끼워넣기이지 뒤섞기가 아니다)
     *  - `setOk`    : 탭이 없어지거나 늘지 않았다
     */
    const judgeMove = (beforeSeq, afterSeq, a, b, place) => {
        const ia = afterSeq.indexOf(a)
        const ib = afterSeq.indexOf(b)
        const drop = arr => arr.filter(v => v !== a)
        return {
            adjacent: ia >= 0 && ib >= 0 && (place === 'after' ? ia === ib + 1 : ia === ib - 1),
            othersKept: sameArr(drop(beforeSeq), drop(afterSeq)),
            setOk: sameSet(beforeSeq, afterSeq),
            ia, ib,
        }
    }
    const moveOk = m => m.adjacent && m.othersKept && m.setOk

    const safeGroups = () => {
        try {
            return typeof ad.groups === 'function' ? ad.groups() : null
        } catch {
            return null
        }
    }
    /**
     * **제품이 말한 "그려져야 하는 줄과 그 순서"** — 펴진 plan 그룹의 `tabIndexes` 를 이어붙인 것.
     * 이 값을 프로브가 계산하면 그룹 정렬·헤더 생략·접힘 규칙의 사본이 된다.
     */
    const drawnExpect = g => (g && g.plan
        ? g.plan.filter(p => !p.collapsed).reduce((acc, p) => acc.concat(p.tabIndexes), [])
        : null)

    // ---------------------------------------------------------------- 포인터 합성
    /**
     * `dock.ts` 와 같은 규약 — **pointer 이벤트**이고 `button: 0` 이 필수다.
     * `mousedown` 을 쏘면 리스너가 없어 아무 일도 일어나지 않는다(`tools/README.md`).
     */
    const ptr = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: (type === 'pointerup' || type === 'pointercancel') ? 0 : 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
    }))
    /**
     * 제품은 `setPointerCapture` 를 쓰지 않지만, 같은 pointerdown 을 받는 **다른** 리스너
     * (Tabby 쪽)가 그것을 부르면 합성 포인터에서 NotFoundError 를 던져 우리 손짓이 중간에 끊긴다.
     * 드래그 구간에서만 no-op 으로 바꾸고 finally 에서 되돌린다 (`probe-layout.js` 와 같은 처리).
     */
    const protoEl = Element.prototype
    const origSetCapture = protoEl.setPointerCapture
    const origRelCapture = protoEl.releasePointerCapture
    let capStubbed = false
    const stubCapture = () => {
        if (capStubbed) { return }
        protoEl.setPointerCapture = function () { /* 합성 포인터라 잡을 것이 없다 */ }
        protoEl.releasePointerCapture = function () { /* 위와 같은 이유 */ }
        capStubbed = true
    }
    const unstubCapture = () => {
        if (!capStubbed) { return }
        protoEl.setPointerCapture = origSetCapture
        protoEl.releasePointerCapture = origRelCapture
        capStubbed = false
    }

    const cfg = ad.config.store.agentDeck
    /** 목록이 가로로 흐르나 (상/하 도킹) — 중점 판정 축이 여기서 갈린다 (`listFlowsSideways`) */
    /**
     * 목록이 가로로 흐르나 — **제품에게 묻는다.** `sidebarDock` 으로 여기서 다시 계산하면
     * 제품이 규칙을 바꿔도(도킹이 늘거나 판정이 뒤집혀도) 프로브는 옛 규칙으로 계속 초록이 된다.
     * 진단구가 없는 판에서만 옛 방식으로 물러난다.
     */
    const sideways = () => {
        const d = ad.lastDrag ? ad.lastDrag() : null
        return d && typeof d.flowsSideways === 'boolean'
            ? d.flowsSideways
            : cfg.sidebarDock === 'top' || cfg.sidebarDock === 'bottom'
    }
    /** 마지막 드래그의 종료 사유. 진단구가 없으면 `undefined` = 판정 불가 */
    const endReason = () => (ad.lastDrag ? (ad.lastDrag().end || null) : undefined)
    const centerOf = el => {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    }
    /** 그 줄의 앞쪽(before) / 뒤쪽(after) 절반을 노리는 좌표 — 중점을 넘겨야 place 가 갈린다 */
    const pointIn = (el, place) => {
        const r = el.getBoundingClientRect()
        if (sideways()) {
            const x = place === 'after' ? r.left + r.width * 0.75 : r.left + r.width * 0.25
            return { x: Math.round(x), y: Math.round(r.top + r.height / 2) }
        }
        const y = place === 'after' ? r.top + r.height * 0.75 : r.top + r.height * 0.25
        return { x: Math.round(r.left + r.width / 2), y: Math.round(y) }
    }
    /**
     * 그 줄이 목록 안에 온전히 보이나 — 스크롤로 잘린 줄을 짚으면 좌표가 목록 밖이라
     * `dropTargetAt` 이 "목록 밖" 취소로 판정해 **거짓 실패**가 난다.
     */
    const insideList = el => {
        const host = listEl()
        if (!el || !host) { return false }
        const l = host.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return r.height > 8 && r.width > 8
            && r.top >= l.top - 1 && r.bottom <= l.bottom + 1
            && r.left >= l.left - 1 && r.right <= l.right + 1
    }
    /**
     * 같은 plan 그룹에서 **온전히 보이는** 줄 두 개를 고른다 (app.tabs 인덱스).
     * 후보 집합을 제품(`groups().plan`)에게 묻는 이유 — 드롭 후보는 `dropTargetAt` 도
     * `renderPlan()` 에서 받으므로(deck.service:4020) 같은 출처를 써야 판정이 어긋나지 않는다.
     */
    const pickPair = () => {
        const g = safeGroups()
        if (!g || !g.plan) { return null }
        for (const grp of g.plan) {
            if (grp.collapsed) { continue }
            const shown = grp.tabIndexes.filter(i => insideList(rowOf(i)))
            if (shown.length >= 2) {
                return { key: grp.key, label: grp.label, a: shown[0], b: shown[1], groupSize: grp.tabIndexes.length }
            }
        }
        return null
    }
    /** 목록 밖이면서 창 안인 좌표 — "놓을 자리 없음" 취소 경로용 */
    const outsidePoint = () => {
        const host = listEl()
        if (!host) { return null }
        const l = host.getBoundingClientRect()
        const W = window.innerWidth
        const H = window.innerHeight
        const cx = Math.round((l.left + l.right) / 2)
        const cy = Math.round((l.top + l.bottom) / 2)
        const cands = [
            { x: Math.round(l.right + 60), y: cy },
            { x: Math.round(l.left - 60), y: cy },
            { x: cx, y: Math.round(l.bottom + 60) },
            { x: cx, y: Math.round(l.top - 60) },
        ]
        for (const p of cands) {
            const inWin = p.x > 2 && p.y > 2 && p.x < W - 2 && p.y < H - 2
            const outList = p.x < l.left || p.x > l.right || p.y < l.top || p.y > l.bottom
            if (inWin && outList) { return p }
        }
        return null
    }
    const pressEsc = () => document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
    }))
    const clickOn = el => el.dispatchEvent(new MouseEvent('click', {
        button: 0, bubbles: true, cancelable: true,
    }))
    const dragState = () => {
        try {
            return typeof ad.reorderDrag === 'function' ? ad.reorderDrag() : undefined
        } catch {
            return undefined
        }
    }
    /**
     * 앞 케이스가 드래그를 걸어 둔 채 끝났으면 여기서 끊는다 — 남으면 `armRowDrag` 가
     * 첫 줄에서 되돌아가고(`this.drag` 가 이미 있다) 다음 케이스가 통째로 거짓 실패한다.
     * 삽입선·커서 클래스도 같이 걷는다 — 삽입선 개수를 판정에 쓰므로 잔여가 있으면 오판이 된다.
     */
    const clearDrag = () => {
        if (dragState()) { pressEsc() }
        unstubCapture()
        document.querySelectorAll('.ad-reorder-line').forEach(n => n.remove())
        document.body.classList.remove('ad-reordering')
    }

    // ------------------------------------------------- 자동 스크롤 (RO9~RO13) 공용 도구
    /**
     * 목록이 **실제로 스크롤되는 축** — 제품에게 묻는다(`lastDrag().scrollAxis`).
     *
     * 여기서 도킹으로 다시 계산하면 규칙 사본이 된다. 그리고 그 사본은 지금 당장 틀린다:
     * 상/하 도킹은 줄이 **가로로 흐르지만**(`flowsSideways`) `flex-wrap: wrap` +
     * `overflow-x: hidden` 이라 넘치면 **세로로** 스크롤된다. 흐름축과 스크롤축은 다른 것이다.
     * `undefined` = 진단구가 없다(낡은 dist), `null` = 넘치지 않는 화면(= 판정 불가).
     */
    const scrollAxis = () => {
        const d = ad.lastDrag ? ad.lastDrag() : null
        return d && 'scrollAxis' in d ? d.scrollAxis : undefined
    }
    const scrollPos = axis => {
        const el = listEl()
        return el ? (axis === 'y' ? el.scrollTop : el.scrollLeft) : NaN
    }
    /** 가로지르는 축의 스크롤 자리 — 엉뚱한 축이 흐르지 않았음을 보는 데 쓴다 */
    const crossPos = axis => scrollPos(axis === 'y' ? 'x' : 'y')
    const setScrollPos = (axis, v) => {
        const el = listEl()
        if (!el) { return }
        if (axis === 'y') { el.scrollTop = v } else { el.scrollLeft = v }
    }
    const scrollRoom = axis => {
        const el = listEl()
        if (!el) { return 0 }
        return axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    }
    /** 지금 드래그의 자동 스크롤 상태 (`reorderDrag().scroll`) — 없으면 undefined = 낡은 dist */
    const dragScroll = () => {
        const d = dragState()
        return d ? d.scroll : undefined
    }
    /** 줄 하나의 스크롤축 두께 (px) — 몇 px 를 흘려야 "한 줄 넘김" 인지의 기준 */
    const rowExtent = axis => {
        const el = rowEls()[0]
        if (!el) { return 40 }
        const r = el.getBoundingClientRect()
        return Math.round((axis === 'y' ? r.height : r.width) + 3)
    }
    /**
     * 그 줄을 잡을 수 있는 좌표 — 줄 중앙을 목록 안으로 가둔 뒤 **정말 그 줄이 짚히는지**
     * `elementFromPoint` 로 확인한다. `insideList` 를 쓰지 않는 이유: 스크롤되는 화면에서는
     * 줄이 목록 경계에 반쯤 걸려 있는 것이 정상이고, 그걸 전부 제외하면 잡을 줄이 없어진다.
     */
    const grabPoint = el => {
        const host = listEl()
        if (!el || !host) { return null }
        const l = host.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        const x = Math.round(Math.min(Math.max(r.left + r.width / 2, l.left + 2), l.right - 2))
        const y = Math.round(Math.min(Math.max(r.top + r.height / 2, l.top + 2), l.bottom - 2))
        const hit = document.elementFromPoint(x, y)
        return hit && hit.closest('.ad-tab') === el ? { x, y } : null
    }
    /**
     * 목록 **가장자리 안쪽 2px** 좌표 (`dir` 1 = 뒤쪽/아래, -1 = 앞쪽/위).
     *
     * 띠 두께를 프로브가 알 필요가 없게 가장자리에 최대한 붙인다 — 두께가 4px 이상이면
     * 어떤 값이어도 이 점은 띠 안이다. 그 점이 정말 띠 안인지는 **제품에게 묻는다**
     * (`reorderDrag().scroll.speed`). 임계 폭을 여기 베껴 두면 제품이 값을 바꿔도 프로브는
     * 옛 값으로 계속 초록이 된다.
     * 가로지르는 축은 기준 줄의 중앙에서 가져온다 — `dropTargetAt` 이 `elementFromPoint` 로
     * 대상을 짚으므로 줄이 없는 자리를 겨누면 놓을 자리가 안 나온다.
     */
    const edgePoint = (axis, dir, refEl) => {
        const host = listEl()
        if (!host) { return null }
        const l = host.getBoundingClientRect()
        const r = refEl ? refEl.getBoundingClientRect() : l
        if (axis === 'y') {
            const y = dir > 0 ? l.bottom - 2 : l.top + 2
            const x = Math.min(Math.max(r.left + r.width / 2, l.left + 2), l.right - 2)
            return { x: Math.round(x), y: Math.round(y) }
        }
        const x = dir > 0 ? l.right - 2 : l.left + 2
        const y = Math.min(Math.max(r.top + r.height / 2, l.top + 2), l.bottom - 2)
        return { x: Math.round(x), y: Math.round(y) }
    }
    /** 목록 한가운데 (띠 밖) — "여기서는 흐르지 않는다" 를 재는 좌표 */
    const midPoint = () => {
        const host = listEl()
        if (!host) { return null }
        const l = host.getBoundingClientRect()
        return { x: Math.round((l.left + l.right) / 2), y: Math.round((l.top + l.bottom) / 2) }
    }
    /**
     * **탭을 하나 더 연다** — 목록을 넘치게 만드는 **보조** 수단이다(주 수단은 `narrowWindow`).
     *
     * 탭을 세는 대신 **넘침을 재서** 필요한 만큼만 연다 — 창 크기·도킹·줄 높이가 달라지면
     * 필요한 탭 수도 달라진다. 못 만들면 그 사실을 그대로 돌려준다
     * (호출부가 `pass: null` 로 적는다).
     */
    const openPlainTab = async () => {
        const btn = sb() ? sb().querySelector('.ad-new') : null
        if (!btn) { return { ok: false, why: '사이드바 + 새 탭 버튼이 없다' } }
        const was = ad.app.tabs.slice()
        btn.click()
        const t0 = Date.now()
        while (ad.app.tabs.length <= was.length && Date.now() - t0 < 9000) { await sleep(200) }
        const opened = ad.app.tabs.find(t => was.indexOf(t) < 0)
        if (!opened) { return { ok: false, why: '+ 새 탭 을 눌러도 9초 안에 탭이 늘지 않았다' } }
        // `madeTabs` 에 넣어야 finally 가 닫고, 러너의 GR15(정리 확인)에도 걸린다
        madeTabs.push(opened)
        return { ok: true, tab: opened }
    }
    /**
     * 창을 이보다 좁히지 않는다. Electron 이 이 창에 준 최소 크기는 실측 400x300 이지만
     * 그 턱까지 붙이면 사이드바 헤더·검색줄이 접혀 목록 높이 보정(`cal`)이 흔들린다.
     * 520px 이면 한 줄에 2칸이 들어가므로 탭 3개로도 넘치는 화면이 된다.
     */
    const MIN_WIN_W = 520
    /**
     * **창 폭을 좁혀 목록을 넘치게 만든다** — 탭을 늘리는 대신 *한 줄에 들어가는 칸 수*를 줄인다.
     *
     * ## 왜 이 방법인가
     *
     * 하단 도킹의 줄은 폭이 220px 로 못박혀 있고(`styles.scss` `.ad-tab { flex: 0 0 220px }`,
     * 0.15.0 의 `min-width: 0` 이 그것을 지킨다) 사이드바는 창 폭을 다 쓴다(`deck.service`
     * `relayout` — 하단 도킹은 `left`/`right` 를 0 으로 둔다). 그래서 **한 줄 칸 수가 창 폭에
     * 정비례**하고, 넘치게 만들려면 "한 줄 칸 수 + 1" 개의 탭이 든다. 2026-09-10 실측
     * (격리 인스턴스, 하단 도킹, 줄 높이 65px):
     *
     *   창폭 1700 → 한 줄 7칸 → 8탭 / 2560 → 11칸 → 12탭 / 3840 → 16칸 → 17탭 / 4200 → 18탭
     *
     * 탭 상한(`CAP`)이 12 라 **4200px 창에서는 RO9~RO13 다섯 개가 통째로 판정 불가로 뒤집혔다**
     * (같은 날 실측 사유: `탭을 12개 더 열어도 목록이 한 줄 넘치지 않았다`). 개발자 모니터가
     * 4K·울트라와이드인 경우는 흔하므로 실제로 밟는 길이고, 그때 이 기능(RO12 = 화면 밖 줄로
     * 옮겨진다)은 그 환경에서 **검증되지 않은 채로 초록**이 된다.
     *
     * 상한을 올려서 해결하지 않는다 — 탭 하나가 pty 하나다. 3840px 판은 탭 17개로 21초였고
     * (1700px 판은 8개로 17초) 그 무게가 러너의 "앱 소실" 판정을 흔든다. 상한이 있는 이유가
     * 그것이다. 창을 좁히면 **탭을 하나도 더 열지 않고** 같은 화면이 만들어지고, 결과가
     * 창 폭에 의존하지 않게 된다.
     *
     * ## 기각한 다른 방법
     *
     *  - **좌/우 도킹으로 바꾸기** — 세로 목록은 줄 하나가 한 줄이라 적은 탭으로 넘칠 것 같지만,
     *    좌/우 도킹의 사이드바는 **창 높이를 다 쓴다**: `sidebarExtent` 는 세로 도킹에서만
     *    `sidebarHeight` 를 보고 가로 도킹에서는 폭만 정한다. 목록 높이를 줄일 설정이 없어
     *    1050px 창에서 15탭이 필요하다 — 지금보다 나쁘다.
     *  - **그룹 헤더로 줄을 끊기** — 헤더는 `flex: 0 0 100%` 라 창 폭과 무관하게 한 줄을 먹으므로
     *    탭 3개로도 여러 줄이 만들어진다. 그런데 제품은 **다른 그룹 줄에는 놓지 않는다**
     *    (RO6 이 재는 그 규칙). RO12 의 목표 줄은 화면 밖의 다른 줄인데 그것이 다른 그룹이면
     *    드롭이 거부돼 RO12 를 아예 못 잰다. 같은 그룹 안에서 줄을 넘기려면 그 그룹에만
     *    "한 줄 칸 수 + 1" 개가 필요해 원래 문제로 되돌아온다.
     *  - **CSS 로 줄 폭을 덮어쓰기** — 프로브가 제품 CSS 를 바꾸면 그 뒤 판정은 제품 화면이
     *    아니라 프로브가 만든 화면을 잰 것이 된다. 이 저장소가 가장 경계하는 거짓 초록이다.
     *
     * 창 크기는 러너도 단계마다 바꾼다(`run-all.ps1` 의 `Set-TestWindow`, 2-c 는 1200x800 으로
     * 줄여서 잰다) — 환경으로 조건을 만드는 것은 이미 이 회귀의 방식이다. 여기서는 **폭만**
     * 줄이고 높이·좌표는 그대로 두며, 원래 크기는 `savedBounds` 에 담아 finally 가 되돌린다
     * (`cleanup.winRestored`).
     *
     * 칸 폭·칸 간격은 **재서** 안다 — 220px/gap 6px 을 여기 적으면 CSS 사본이 되고, 제품이
     * 폭을 바꾸는 순간 프로브가 조용히 낡는다(이 파일이 `planTabMove` 를 안 베낀 것과 같은 이유).
     */
    const narrowWindow = async () => {
        let remote = null
        try {
            remote = require('@electron/remote')
        } catch {
            // nodeIntegration·remote 가 없는 판 — 아래 탭 늘리기로 물러난다
        }
        if (!remote || typeof remote.getCurrentWindow !== 'function') {
            return { ok: false, why: 'renderer 에서 @electron/remote 를 못 잡았다' }
        }
        let win = null
        try {
            win = remote.getCurrentWindow()
        } catch (e) {
            return { ok: false, why: `getCurrentWindow 실패: ${String((e && e.message) || e)}` }
        }
        if (!win || typeof win.setBounds !== 'function' || typeof win.getBounds !== 'function') {
            return { ok: false, why: '창 객체에 setBounds/getBounds 가 없다' }
        }
        if (typeof win.isResizable === 'function' && !win.isResizable()) {
            return { ok: false, why: '창 크기를 바꿀 수 없다 (resizable=false)' }
        }
        if (!savedBounds) { savedBounds = win.getBounds() }
        /**
         * 지금 화면에서 재는 값들.
         *
         * **한 줄에 들어갈 수 있는 칸 수(`cap`)는 "첫 줄에 서 있는 칸 수" 로 못 잰다** — 탭이
         * 모자라면 그 값이 탭 수에서 멈춰(4200px 창·5탭에서 5 로 읽혔다) 아무리 좁혀도 목표에
         * 닿지 않는다. 그래서 목록의 **내용 폭**과 칸 간격으로 용량을 계산한다:
         * 칸 k 개가 서려면 `k*칸폭 + (k-1)*간격 <= 내용폭` 이므로 `cap = floor((내용폭+간격)/간격포함칸폭)`.
         */
        const geo = () => {
            const el = listEl()
            const rows = rowEls()
            if (!el || !rows.length) { return null }
            const cs = getComputedStyle(el)
            const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
            const r0 = rows[0].getBoundingClientRect()
            const first = rows.filter(n => Math.abs(n.getBoundingClientRect().top - r0.top) <= 1)
            // 간격 포함 칸 폭 — 같은 줄의 두 칸 사이 거리로 잰다. 한 칸만 보이면 간격을 못 재므로
            // 칸 폭으로 대신한다(간격만큼 과소평가 = 한 번에 덜 좁힌다 = 반복이 한 번 더 돈다)
            const pairStep = first.length >= 2
                ? Math.round(first[1].getBoundingClientRect().left - r0.left)
                : 0
            const rowW = Math.round(r0.width)
            const step = pairStep > 8 ? pairStep : rowW
            const content = Math.round(el.clientWidth - pad)
            return {
                rows: rows.length,
                onFirstLine: first.length,
                rowW,
                step,
                content,
                // 목록 내용 폭 밖에서 창이 쓰는 몫 (창 테두리·목록 padding·세로 스크롤바)
                chrome: Math.round(window.innerWidth - content),
                cap: Math.max(1, Math.floor((content + (step - rowW)) / step)),
            }
        }
        const tries = []
        // 목표는 "한 줄 용량 = 지금 탭 수 - 1" — 그러면 지금 탭만으로 둘째 줄이 생긴다.
        // 한 번에 맞아야 정상이지만(실측 1회) 창 최소 폭·스크롤바 등장으로 값이 바뀔 수 있어
        // 매번 다시 재며 최대 3번 좁힌다
        for (let i = 0; i < 3; i++) {
            const g = geo()
            if (!g) { return { ok: false, why: '줄이 하나도 안 그려져 폭을 잴 수 없다', tries } }
            const want = Math.max(1, g.rows - 1)
            if (g.cap <= want) {
                tries.push({ rows: g.rows, cap: g.cap, want, winW: window.innerWidth, done: true })
                break
            }
            const cur = win.getBounds()
            // 내용 폭이 `want * 간격포함칸폭` 이면 용량이 정확히 `want` 가 된다
            // (간격이 칸 폭보다 작으므로 내림에서 한 칸이 더 들어오지 않는다)
            const target = g.chrome + want * g.step
            const next = Math.max(MIN_WIN_W, Math.min(cur.width - 1, target))
            tries.push({ rows: g.rows, cap: g.cap, want, step: g.step, from: cur.width, to: next })
            if (next >= cur.width) { break }
            win.setBounds({ x: cur.x, y: cur.y, width: next, height: cur.height })
            // 창 크기 변화는 이벤트로 따라오므로 폭이 실제로 줄어들 때까지 기다린다 (실측 110ms)
            const t0 = Date.now()
            while (window.innerWidth > next + 8 && Date.now() - t0 < 3000) { await sleep(80) }
            ad.relayout()
            ad.render()
            await sleep(300)
        }
        const after = geo()
        return {
            ok: true,
            from: savedBounds.width,
            now: window.innerWidth,
            geo: after,
            tries,
        }
    }
    const makeScrollable = async () => {
        cfg.sortByStatus = false
        // 평면에 가까운 화면으로 잰다 — 그룹 경계(RO6)·헤더 화면(RO7)은 이미 따로 판정하고,
        // 여기서 겹쳐 재면 실패했을 때 그것이 자동 스크롤 결함인지 그룹 결함인지 갈리지 않는다.
        // 그룹핑을 끄는 설정은 없어졌으므로(항상 켜짐) 대신 **아래에서 원래 기본 프로필로만**
        // 탭을 연다 — 같은 cwd = 한 그룹 = 헤더 없음이다. 판정은 줄(`.ad-tab`)만 세므로
        // 인스턴스에 다른 프로젝트 탭이 섞여 헤더가 생겨도 결과는 달라지지 않는다.
        cfg.collapsedGroups = []
        cfg.dragAutoScroll = true
        // 새 탭은 **원래 기본 프로필**로 연다 — RO6/RO7 이 임시 cwd 프로필로 바꿔 뒀을 수 있고,
        // 그러면 임시 폴더에 탭이 생겨 그룹·정리가 뒤엉킨다
        if (prevProfileId !== undefined && ad.config.store.terminal) {
            ad.config.store.terminal.profile = prevProfileId
        }
        /**
         * **목록 높이를 줄 하나로 맞춘다** — 하단 도킹 + 사이드바 높이 조절 (둘 다 제품 설정이다).
         *
         * 하단 도킹은 줄이 가로로 흐르고 넘치면 아래로 감기므로, 한 줄만 보이게 두면
         * **둘째 줄 전체가 화면 밖**이 된다 (RO12 가 필요한 "화면 밖 줄" 이 그것이다).
         * 목록을 세로로 길게 두고 탭을 늘려 넘치게 하면 pty 가 그만큼 늘어 인스턴스가 휘청거린다
         * (probe-perf 가 탭 10개 때문에 따로 인스턴스를 받는 이유).
         *
         * 높이는 상수로 박지 않고 **재서 정한다**: 사이드바 높이 중 목록이 못 쓰는 몫
         * (헤더·검색줄·바닥줄, 실측 106px)이 바뀌어도 따라오게 하려는 것이다.
         *
         * 곁수확 하나 — 하단 도킹은 `flowsSideways` 가 true 라, 삽입선의 **가로 흐름 갈래**와
         * "흐름축(x) ≠ 스크롤축(y)" 이 같이 검증된다.
         */
        cfg.sidebarDock = 'bottom'
        cfg.sidebarHeight = 260
        await ad.config.save()
        ad.relayout()
        ad.render()
        await sleep(400)
        /**
         * **줄 하나 높이만으로는 부족하다** — 한 줄에 들어가는 칸 수가 창 폭에 정비례하므로
         * 넓은 창에서는 지금 탭으로 둘째 줄이 안 생긴다. 창 폭을 줄여 한 줄 칸 수를 지금
         * 탭 수보다 작게 만든다 (왜 탭을 늘리지 않나 = `narrowWindow` 주석).
         *
         * 높이 보정(`cal`)은 **이 다음에** 한다 — 폭이 바뀌면 사이드바 헤더·검색줄이 접혀
         * 목록이 못 쓰는 몫이 달라지고, 먼저 보정하면 그 값이 낡는다.
         */
        const narrow = await narrowWindow()
        const cal = { overhead: null, want: null, rowExtent: null }
        {
            const s = sb()
            const el = listEl()
            if (s && el) {
                cal.overhead = s.clientHeight - el.clientHeight
                cal.rowExtent = rowExtent('y')
                cal.want = cal.overhead + cal.rowExtent + 2
                cfg.sidebarHeight = cal.want
                await ad.config.save()
                ad.relayout()
                ad.render()
                await sleep(400)
            }
        }
        /**
         * 탭 늘리기는 **보조 수단**이다 — `narrowWindow` 가 성공하면 더 열 필요가 없다(실측 0개).
         * remote 가 없는 판에서만 여기까지 오는데, 그때는 창 폭만큼 탭이 필요하므로 상한이
         * 곧 판정 불가 사유가 된다. 상한을 올리지 않는 이유는 `narrowWindow` 주석에 있다.
         */
        const CAP = 12
        let opened = 0
        let why = null
        let need = 0
        for (;;) {
            const axis = scrollAxis()
            if (axis === undefined) { why = NO_DIAG; break }
            // "한 줄 넘침" 이 기준이다 — 그만큼이면 화면 밖 줄이 하나는 있고(RO12),
            // 커서 아래 줄이 스크롤로 바뀐다(RO10)
            need = rowExtent(axis || 'y')
            if (axis && scrollRoom(axis) >= need) { break }
            if (opened >= CAP) { why = `탭을 ${CAP}개 더 열어도 목록이 한 줄 넘치지 않았다`; break }
            const r = await openPlainTab()
            if (!r.ok) { why = r.why; break }
            opened++
            ad.render()
            await sleep(250)
        }
        const axis = scrollAxis()
        const el = listEl()
        return {
            ok: !!axis && need > 0 && scrollRoom(axis) >= need,
            axis: axis === undefined ? 'no-diag' : axis,
            room: axis ? scrollRoom(axis) : 0,
            need, opened, why, cal, narrow,
            winW: window.innerWidth,
            dock: cfg.sidebarDock,
            sidebarHeight: cfg.sidebarHeight,
            drawnSidebarH: sb() ? sb().clientHeight : null,
            tabs: ad.app.tabs.length,
            rows: rowEls().length,
            rowExtent: rowExtent(axis || 'y'),
            sideways: sideways(),
            metrics: el ? { clientH: el.clientHeight, scrollH: el.scrollHeight, clientW: el.clientWidth, scrollW: el.scrollWidth } : null,
        }
    }

    // ---------------------------------------------------------------- 되돌릴 것들
    const orig = ad.app.tabs.slice()
    const origActive = ad.app.activeTab
    const saved = {
        sortByStatus: cfg.sortByStatus,
        dragAutoScroll: cfg.dragAutoScroll,
        // RO9~RO13 이 목록을 **넘치게 만들려고** 도킹과 사이드바 높이를 바꾼다 (makeScrollable)
        sidebarDock: cfg.sidebarDock,
        sidebarHeight: cfg.sidebarHeight,
        collapsedGroups: (cfg.collapsedGroups || []).slice(),
    }
    // finally 가 보려면 try **밖에서** 선언해야 한다 (probe-group.js 의 그 함정과 같다)
    const madeTabs = []
    const addedProfileIds = []
    const cleanup = {}
    let tmpBase = null
    let nodeFs = null
    let pinnedTab = null
    let pinnedSave = null
    // RO9~RO13 이 목록을 넘치게 만들려고 **창 폭을 줄인다**(`narrowWindow`) — 원래 크기를
    // 여기 담아 두고 finally 가 되돌린다. try 밖에서 선언해야 finally 가 본다
    let savedBounds = null
    const prevProfileId = ad.config.store.terminal ? ad.config.store.terminal.profile : undefined

    /**
     * 원래 순서로 되돌린다 — **제품 경로(`__agentdeck.reorder`)로만** 한다.
     *
     * `app.tabs` 를 직접 흔들면 `emitTabsChanged()`·`zone.run` 을 건너뛰어 순정 탭바가
     * 옛 순서로 남는다(그게 곧 다음 프로브가 재는 화면이다). 한 번의 reorder 는 한 원소 이동이라,
     * 앞에서부터 제자리에 밀어넣으면 최대 n-1 번에 끝난다.
     */
    const restoreOrder = () => {
        const want = orig.filter(t => ad.app.tabs.indexOf(t) >= 0)
        const moves = []
        if (typeof ad.reorder !== 'function') {
            return { ok: sameArr(seqRel(orig), want.map((_, i) => i)), moves, why: '진단구 없음' }
        }
        for (let i = 0; i < want.length; i++) {
            const j = ad.app.tabs.indexOf(want[i])
            if (j < 0 || j === i) { continue }
            const r = ad.reorder(j, i, 'before')
            moves.push({ from: j, to: i, ok: !!(r && r.ok), reason: r ? r.reason : null })
        }
        const head = ad.app.tabs.slice(0, want.length)
        return { ok: head.every((t, i) => t === want[i]), moves, tabs: ad.app.tabs.length, want: want.length }
    }

    try {
        if (typeof ad.reorder !== 'function' || typeof ad.reorderDrag !== 'function') {
            skipCases(ALL_IDS, NO_DIAG, { hasReorder: typeof ad.reorder, hasDrag: typeof ad.reorderDrag })
            throw new Error('ad-reorder-prereq')
        }
        if (!sb() || !listEl()) {
            skipCases(ALL_IDS, '사이드바/.ad-list 가 없다 (agentDeck.enabled 확인)',
                { sidebar: !!sb(), list: !!listEl() })
            throw new Error('ad-reorder-prereq')
        }
        if (ad.app.tabs.length < 2) {
            skipCases(ALL_IDS, `탭이 ${ad.app.tabs.length}개다 — 순서를 바꿀 화면이 아니다`,
                { tabs: ad.app.tabs.length })
            throw new Error('ad-reorder-prereq')
        }

        // 판정 조건을 못박는다 — `sortByStatus` 가 켜져 있으면 순서 변경 자체가 막히고(게이트),
        // 그 상태는 RO5 에서 **일부러** 만든다. 나머지 케이스는 꺼 놓고 잰다.
        cfg.sortByStatus = false
        await ad.config.save()
        ad.render()
        await sleep(250)

        // ============================================================ RO1 진단구 경로
        // 드래그와 **같은 경로**(`applyReorder`)를 좌표 없이 타 본다. 여기서 보는 것 셋 —
        //  ① `app.tabs` 의 실제 순서가 바뀐다 (탭 객체 동일성으로 추적한다. 제목은 중복될 수 있어
        //     식별자로 쓸 수 없다 — powershell 탭 둘이면 제목이 같다)
        //  ② 진단구가 돌려준 `order`(옛 인덱스 기준 새 순서)가 **실제 배열과 일치**한다
        //     — 이게 어긋나면 회귀가 제품 말을 믿을 수 없게 된다
        //  ③ 되돌리면 정확히 원래 순서로 온다
        {
            const before = ad.app.tabs.slice()
            const r1 = ad.reorder(0, 1, 'after')
            ad.render()
            await sleep(150)
            const after = seqRel(before)
            const m = judgeMove(before.map((_, i) => i), after, 0, 1, 'after')
            const orderMatches = !!r1 && sameArr(r1.order, after)
            const changed = !sameArr(after, before.map((_, i) => i))

            // 되돌리기 — 지금 0번 자리에 있는 것이 원래 1번이므로, 원래 0번(지금 1번)을 그 앞으로
            const back = ad.app.tabs.slice()
            const j = ad.app.tabs.indexOf(before[0])
            const r2 = j > 0 ? ad.reorder(j, 0, 'before') : null
            ad.render()
            await sleep(150)
            const restored = sameArr(seqRel(before), before.map((_, i) => i))
            const backMatches = !!r2 && sameArr(r2.order, seqRel(back))

            // 3탭 이상이면 `place`/거리 조합도 한 번 — 인접 교환만 맞는 구현을 걸러낸다
            let far = null
            if (ad.app.tabs.length >= 3) {
                const b3 = ad.app.tabs.slice()
                const r3 = ad.reorder(0, 2, 'after')
                ad.render()
                await sleep(150)
                const a3 = seqRel(b3)
                far = {
                    ok: !!(r3 && r3.ok) && sameArr(r3.order, a3)
                        && moveOk(judgeMove(b3.map((_, i) => i), a3, 0, 2, 'after')),
                    order: r3 ? r3.order : null, actual: a3,
                }
                const j3 = ad.app.tabs.indexOf(b3[0])
                if (j3 > 0) { ad.reorder(j3, 0, 'before') }
                ad.render()
                await sleep(150)
                far.restored = sameArr(seqRel(b3), b3.map((_, i) => i))
            }

            const pass1 = !!(r1 && r1.ok) && changed && moveOk(m) && orderMatches
                && restored && backMatches && (!far || (far.ok && far.restored))
            add('RO1', nameOf('RO1'), pass1,
                pass1
                    ? '진단구로 옮기면 app.tabs 가 실제로 바뀌고(반환 order 와 일치), 되돌리면 원래 순서로 온다'
                        + (far ? ' (떨어진 자리로 끼워넣기도 확인)' : ' (탭 2개라 인접 이동만 확인)')
                    : `진단구 경로가 어긋난다 (ok=${r1 ? r1.ok : null} 변화=${changed}`
                        + ` 인접=${m.adjacent} 나머지유지=${m.othersKept} 집합=${m.setOk}`
                        + ` order일치=${orderMatches} 복귀=${restored} 복귀order일치=${backMatches}`
                        + ` 원거리=${far ? far.ok + '/' + far.restored : 'n/a'})`,
                { reorder: r1, actual: after, judge: m, back: r2, far, tabs: before.length })
        }

        // ============================================================ RO2 data-ad-index 계약
        // **이 계약이 깨지면 다른 회귀가 무너진다** — 줄을 `data-ad-index` 로 찾는 항목이
        // R16·R19·R41·GR2 다. 값이 "보이는 순서" 로 바뀌면 그 전부가 거짓 실패한다.
        //
        // 두 층으로 본다:
        //  A) 재정렬 직후 — 유효한 정수 · 중복 없음 · **제품이 말한 그려질 줄 순서와 일치**
        //  B) **화면 순서와 app.tabs 순서가 어긋난 화면**을 일부러 만들어 가른다. 둘이 같은
        //     화면에서는 두 구현("app.tabs 인덱스" vs "보이는 순서")이 같은 값을 내므로
        //     아무것도 판정하지 못한다. 마지막 탭을 승인대기로 고정하고 `sortByStatus` 를 켜면
        //     그 탭이 맨 앞으로 와 순서가 갈린다.
        {
            const before = ad.app.tabs.slice()
            const rA = ad.reorder(0, 1, 'after')
            ad.render()
            await sleep(200)
            const gA = safeGroups()
            const seqA = domSeq()
            const wantA = drawnExpect(gA)
            const validA = seqA.length > 0 && seqA.every(n => Number.isInteger(n) && n >= 0)
            const uniqueA = new Set(seqA).size === seqA.length
            const matchA = !!wantA && sameArr(seqA, wantA)
            const okA = !!(rA && rA.ok) && validA && uniqueA && matchA
            // 원래 순서로 (B 는 정렬로 화면을 흔들 것이므로 app.tabs 는 원본이어야 읽기 쉽다)
            const jA = ad.app.tabs.indexOf(before[0])
            if (jA > 0) { ad.reorder(jA, 0, 'before') }
            ad.render()
            await sleep(150)

            // B — 화면 순서 != app.tabs 순서 인 화면 만들기
            pinnedTab = ad.app.tabs[ad.app.tabs.length - 1]
            const st = ad.status.get(pinnedTab)
            pinnedSave = {
                status: st.status, label: st.label, reason: st.reason,
                since: st.since, pinned: st.pinned,
            }
            ad.status.setManual(pinnedTab, 'waiting')
            cfg.sortByStatus = true
            await ad.config.save()
            ad.render()
            await sleep(300)
            const gB = safeGroups()
            const seqB = domSeq()
            const wantB = drawnExpect(gB)
            const identity = wantB ? wantB.every((v, i) => v === i) : true
            const matchB = !!wantB && sameArr(seqB, wantB)
            const uniqueB = new Set(seqB).size === seqB.length
            cfg.sortByStatus = false
            await ad.config.save()
            ad.render()
            await sleep(200)

            if (identity) {
                // 가를 수 없는 화면이었다 — **거짓 PASS 를 만들지 않는다.** A 결과는 증거로 남긴다
                add('RO2', nameOf('RO2'), null,
                    '화면 순서와 app.tabs 순서가 어긋난 화면을 만들지 못해'
                        + ' "인덱스인가 보이는 순서인가" 를 가릴 수 없다 (정렬을 켜도 순서가 그대로였다)',
                    { partA: { ok: okA, dom: seqA, want: wantA }, partB: { dom: seqB, want: wantB } })
            } else {
                const pass2 = okA && matchB && uniqueB
                add('RO2', nameOf('RO2'), pass2,
                    pass2
                        ? '재정렬 후에도 줄마다 유효한 app.tabs 인덱스가 중복 없이 붙고,'
                            + ' 화면 순서가 app.tabs 순서와 어긋난 화면에서도 그 값이 **보이는 순서가 아니라**'
                            + ' 인덱스였다 (제품이 말한 그려질 순서와 일치)'
                        : `data-ad-index 계약이 어긋난다 (재정렬후 유효=${validA} 중복없음=${uniqueA}`
                            + ` 제품순서일치=${matchA} / 어긋난화면 일치=${matchB} 중복없음=${uniqueB})`,
                    {
                        partA: { dom: seqA, want: wantA, reorder: rA },
                        partB: { dom: seqB, want: wantB, pinned: ad.app.tabs.length - 1 },
                    })
            }
        }

        // ============================================================ RO3 합성 드래그
        // 실제 포인터 이벤트로 줄을 끌어 옮긴다. **임계치 전에는 아무 일도 없어야** 한다 —
        // 그게 클릭·더블클릭·우클릭과 한 줄에서 공존하는 근거다(`armRowDrag` 주석).
        {
            const pair = pickPair()
            if (!pair) {
                skipCases(['RO3'], '같은 그룹에 온전히 보이는 줄이 2개 이상인 화면이 아니다',
                    { plan: (safeGroups() || {}).plan || null, rows: rowEls().length })
            } else {
                clearDrag()
                const before = ad.app.tabs.slice()
                const rowA = rowOf(pair.a)
                const rowB = rowOf(pair.b)
                const c = centerOf(rowA)
                stubCapture()
                ptr(rowA, 'pointerdown', c.x, c.y)
                const armed = dragState()

                // ① 임계치 미달 (hypot(3,0)=3 < 5) — 무장만 되고 아무것도 안 일어나야 한다
                ptr(document, 'pointermove', c.x + 3, c.y)
                const d0 = dragState()
                const quiet = {
                    stateThere: !!d0,
                    moved: d0 ? d0.moved : null,
                    target: d0 ? d0.target : undefined,
                    line: d0 ? d0.line : null,
                    lineEls: lineCount(),
                    bodyClass: document.body.classList.contains('ad-reordering'),
                    rowClass: rowA.classList.contains('ad-dragging'),
                    seq: seqRel(before),
                }
                const quietOk = quiet.stateThere && quiet.moved === false && !quiet.target
                    && quiet.line === false && quiet.lineEls === 0 && !quiet.bodyClass
                    && !quiet.rowClass && sameArr(quiet.seq, before.map((_, i) => i))

                // ② 임계치 초과 + 대상 줄의 뒤쪽 절반 — 삽입선이 그 자리를 가리켜야 한다
                const p = pointIn(rowB, 'after')
                ptr(document, 'pointermove', p.x, p.y)
                const d1 = dragState()
                const during = {
                    moved: d1 ? d1.moved : null,
                    from: d1 ? d1.from : null,
                    target: d1 ? d1.target : null,
                    line: d1 ? d1.line : null,
                    lineEls: lineCount(),
                    bodyClass: document.body.classList.contains('ad-reordering'),
                    rowClass: rowA.classList.contains('ad-dragging'),
                }
                const duringOk = !!d1 && d1.moved === true && d1.from === pair.a
                    && !!d1.target && d1.target.index === pair.b && d1.target.place === 'after'
                    && d1.line === true && during.lineEls === 1
                    && during.bodyClass && during.rowClass

                // ③ 놓는다 — 순서가 그 자리로 바뀌고 드래그 상태·삽입선이 걷혀야 한다
                ptr(document, 'pointerup', p.x, p.y)
                unstubCapture()
                await sleep(250)
                const after = seqRel(before)
                const m = judgeMove(before.map((_, i) => i), after, pair.a, pair.b, 'after')
                const post = {
                    drag: dragState(),
                    lineEls: lineCount(),
                    bodyClass: document.body.classList.contains('ad-reordering'),
                }
                const dropOk = post.drag === null && post.lineEls === 0 && !post.bodyClass && moveOk(m)

                const pass3 = quietOk && duringOk && dropOk
                add('RO3', nameOf('RO3'), pass3,
                    pass3
                        ? `합성 포인터로 ${pair.a} 번 줄을 ${pair.b} 번 줄 뒤로 끌어 옮겼다 —`
                            + ' 5px 전에는 삽입선·표식·순서 변화가 전혀 없고, 넘긴 뒤에는 진단구가'
                            + ' 대상과 place 를 말하고 삽입선이 1개, 놓으면 그 자리로 갔다'
                        : `드래그 경로가 어긋난다 (임계전무동작=${quietOk} 끌던중=${duringOk} 드롭=${dropOk})`,
                    { pair, quiet, during, after, judge: m, post })

                // 다음 케이스가 원래 순서를 재도록 되돌린다
                if (!sameArr(seqRel(orig), orig.map((_, i) => i))) {
                    const rest = restoreOrder()
                    cleanup.ro3Restore = rest.ok
                }
                ad.render()
                await sleep(150)
            }
        }

        // ============================================================ RO4 취소 3경로
        // Esc / `pointercancel` / 놓을 자리 없는 곳에서 손 떼기. **셋 다 app.tabs 가 안 바뀌어야** 한다.
        // 놓을 자리 없음은 두 가지로 나눠 본다 — 목록 밖, 그리고 자기 자리(자기 줄 위).
        {
            const pair = pickPair()
            const out = outsidePoint()
            if (!pair) {
                skipCases(['RO4'], '같은 그룹에 온전히 보이는 줄이 2개 이상인 화면이 아니다', null)
            } else {
                const trials = []
                /**
                 * 한 번의 취소 시도 — 끌어서 대상까지 간 뒤 `fin` 으로 끝낸다.
                 *
                 * `want` = 제품이 말해야 하는 종료 사유. 결과(순서 불변)만 보면 **엉뚱한 이유로**
                 * 취소돼도 통과한다 — 예컨대 낡은 `data-ad-index` 로 대상을 잃어 취소된 것과
                 * 사용자가 Esc 를 누른 것이 결과가 같다. 그래서 이유까지 대조한다.
                 */
                const cancelTrial = async (label, movePt, fin, expectTarget, want) => {
                    clearDrag()
                    const before = ad.app.tabs.slice()
                    const rowA = rowOf(pair.a)
                    if (!rowA || !movePt) {
                        trials.push({ label, ok: null, why: '줄이나 좌표를 못 만들었다' })
                        return
                    }
                    const c = centerOf(rowA)
                    stubCapture()
                    ptr(rowA, 'pointerdown', c.x, c.y)
                    ptr(document, 'pointermove', movePt.x, movePt.y)
                    const d = dragState()
                    const mid = {
                        moved: d ? d.moved : null,
                        target: d ? d.target : null,
                        line: d ? d.line : null,
                        lineEls: lineCount(),
                    }
                    fin(movePt)
                    unstubCapture()
                    await sleep(250)
                    const seq = seqRel(before)
                    const unchanged = sameArr(seq, before.map((_, i) => i))
                    const end = endReason()
                    // 제품이 사유를 열지 않는 판이면 이 대조는 **판정 불가**다 — 통과로 세지 않는다
                    const reasonOk = end === undefined
                        ? null
                        : !!(end && end.reason === want.reason && end.drop === want.drop)
                    // 대상이 있어야 하는 취소(Esc·pointercancel)와 없어야 하는 취소(자리 없음)를 가른다
                    const targetOk = expectTarget
                        ? !!(mid.target && mid.moved === true)
                        : (mid.target === null && mid.lineEls === 0)
                    const shapeOk = unchanged && targetOk && dragState() === null && lineCount() === 0
                        && !document.body.classList.contains('ad-reordering')
                    const ok = reasonOk === null ? null : (shapeOk && reasonOk)
                    trials.push({
                        label,
                        ok,
                        why: reasonOk === null ? '제품이 종료 사유를 열지 않는다 (lastDrag 없음)' : undefined,
                        unchanged,
                        targetOk,
                        reasonOk,
                        want,
                        end,
                        mid,
                        seq,
                        drag: dragState(),
                        lineEls: lineCount(),
                    })
                }

                const rowB0 = rowOf(pair.b)
                const onB = rowB0 ? pointIn(rowB0, 'after') : null
                // ⓐ Esc — 대상까지 끌어 놓고 키로 취소
                await cancelTrial('esc', onB, () => pressEsc(), true, { reason: 'esc', drop: null })
                // ⓑ pointercancel — OS 가 손짓을 앗아간 경우 (창 포커스 이동·터치 취소)
                await cancelTrial('pointercancel', rowOf(pair.b) ? pointIn(rowOf(pair.b), 'after') : null,
                    pt => ptr(document, 'pointercancel', pt.x, pt.y), true, { reason: 'cancel', drop: null })
                // ⓒ 목록 밖에서 손 떼기 — 놓을 자리가 없으므로 삽입선도 없어야 한다
                await cancelTrial('목록 밖', out, pt => ptr(document, 'pointerup', pt.x, pt.y), false,
                    { reason: 'no-target', drop: 'outside-list' })
                // ⓓ 자기 자리 — 자기 줄 위에서 5px 를 넘겨 움직인 뒤 놓기. 대상은 자기 자신이라 null
                {
                    const rowA = rowOf(pair.a)
                    let selfPt = null
                    if (rowA) {
                        const r = rowA.getBoundingClientRect()
                        const host = listEl().getBoundingClientRect()
                        const c = centerOf(rowA)
                        // 가로로 흐르지 않는 화면(좌/우 도킹)에서는 줄이 가로로 넓다 — x 로 움직인다
                        const dx = Math.min(24, Math.round(host.right - 4 - c.x))
                        if (!sideways() && dx > 8 && r.width > 40) {
                            selfPt = { x: c.x + dx, y: c.y }
                        } else if (r.height > 20) {
                            selfPt = { x: c.x, y: Math.round(c.y + Math.min(8, r.height / 2 - 3)) }
                        }
                    }
                    await cancelTrial('자기 자리', selfPt, pt => ptr(document, 'pointerup', pt.x, pt.y), false,
                        { reason: 'no-target', drop: 'self' })
                }

                const judged = trials.filter(t => t.ok !== null)
                const pass4 = judged.length === trials.length && judged.every(t => t.ok)
                // 한 경로라도 조건을 못 만들었으면 **판정 불가**다 — 나머지가 통과했다고
                // "취소 3경로 확인" 이라고 적으면 그것이 거짓 PASS 다
                if (judged.length < trials.length) {
                    add('RO4', nameOf('RO4'), null,
                        `취소 경로 ${trials.length}종 중 ${judged.length}종만 조건이 만들어졌다`
                            + ' (좌표·줄을 못 만든 경로: '
                            + trials.filter(t => t.ok === null).map(t => t.label + '(' + t.why + ')').join(', ')
                            + ')',
                        { trials, out })
                } else {
                    add('RO4', nameOf('RO4'), pass4,
                        pass4
                            ? 'Esc · pointercancel · 목록 밖 · 자기 자리 네 경로 모두 app.tabs 가 그대로였고'
                                + ' 드래그 상태·삽입선도 남지 않았으며, **제품이 말한 종료 사유가**'
                                + ' esc / cancel / no-target(outside-list) / no-target(self) 로 각각 맞았다'
                            : '취소가 순서를 건드렸거나 흔적이 남았거나 **다른 이유로** 취소됐다: '
                                + trials.map(t => `${t.label}=${t.ok}`
                                    + (t.reasonOk === false
                                        ? `(사유 ${t.end ? t.end.reason + '/' + t.end.drop : 'null'}`
                                            + ` ≠ ${t.want.reason}/${t.want.drop})`
                                        : '')).join(' '),
                        { trials, out })
                }
            }
        }

        // ============================================================ RO5 sortByStatus 게이트
        // 켜져 있으면 화면 순서를 상태가 정하므로(renderPlan) 옮겨도 다음 렌더에 제자리로 돌아간다.
        // 그래서 **막고 이유를 알린다**. 이 게이트는 처음에 드래그 경로에만 있어서 진단구로는
        // 통과하던 결함이 있었다(R58 비고) — 그 회귀를 여기서 잡는다. **양쪽을 다 잰다.**
        {
            const before = ad.app.tabs.slice()
            cfg.sortByStatus = true
            await ad.config.save()
            ad.render()
            await sleep(250)

            const rg = ad.reorder(0, 1, 'after')
            ad.render()
            await sleep(150)
            const diagBlocked = !!rg && rg.ok === false && typeof rg.reason === 'string' && rg.reason.length > 0
                && sameArr(seqRel(before), before.map((_, i) => i))

            // 드래그 경로 — 임계치를 넘긴 순간 막히고 한 줄 안내가 떠야 한다
            let drag = { ok: null, why: '줄을 못 찾았다' }
            const pair5 = pickPair()
            if (pair5) {
                clearDrag()
                const rowA = rowOf(pair5.a)
                if (rowA) {
                    const c = centerOf(rowA)
                    stubCapture()
                    ptr(rowA, 'pointerdown', c.x, c.y)
                    // 임계치를 확실히 넘긴다 — 게이트는 threshold 판정 **뒤에** 있다
                    ptr(document, 'pointermove', c.x, c.y + 20)
                    const mid = {
                        drag: dragState(), lineEls: lineCount(), notes: noteCount(),
                        bodyClass: document.body.classList.contains('ad-reordering'),
                    }
                    ptr(document, 'pointerup', c.x, c.y + 20)
                    unstubCapture()
                    await sleep(200)
                    const end5 = endReason()
                    // 안내가 떴고 순서가 그대로여도, **게이트가 막은 것**이 아니면 의미가 없다
                    const gateSaid = end5 === undefined ? null : !!(end5 && end5.reason === 'blocked-sort')
                    const shape5 = mid.drag === null && mid.lineEls === 0 && mid.notes >= 1 && !mid.bodyClass
                        && sameArr(seqRel(before), before.map((_, i) => i))
                    drag = {
                        ok: gateSaid === null ? shape5 : (shape5 && gateSaid),
                        gateSaid,
                        end: end5,
                        mid,
                        seq: seqRel(before),
                    }
                }
            }

            cfg.sortByStatus = false
            await ad.config.save()
            ad.render()
            await sleep(200)

            if (drag.ok === null) {
                add('RO5', nameOf('RO5'), null,
                    `진단구 게이트는 ${diagBlocked ? '막혔다' : '막히지 않았다'} 가, 드래그 경로를 재려면 줄이 필요하다 — ${drag.why}`,
                    { diag: rg, drag })
            } else {
                const pass5 = diagBlocked && drag.ok
                add('RO5', nameOf('RO5'), pass5,
                    pass5
                        ? `상태순 정렬이 켜져 있으면 진단구는 {ok:false, reason:"${rg.reason}"} 를 주고,`
                            + ' 드래그는 임계치를 넘긴 자리에서 끊기며 한 줄 안내가 떴다 — 양쪽 다 순서 불변'
                            + (drag.gateSaid ? ' (제품이 종료 사유를 blocked-sort 로 말했다)' : '')
                        : `게이트가 한쪽만 걸린다 (진단구막힘=${diagBlocked} 드래그막힘=${drag.ok})`
                            + ' — 진단구만 통과하면 회귀가 게이트를 검증하지 못한다',
                    { diag: rg, drag, seq: seqRel(before) })
            }
        }

        // ============================================================ RO8 클릭과의 공존
        // 드래그로 끝난 손짓 뒤에 오는 click 은 삼켜야 하고(탭이 바뀌면 터미널 화면까지 튄다),
        // **그 다음 정당한 클릭은 살아야** 한다. 뒤쪽이 없으면 가드가 클릭을 영구히 먹는다.
        //
        // 실제 순서를 그대로 재현한다 — 브라우저는 pointerup **뒤에** click 을 그 줄에 보낸다.
        // `render()` 가 이미 목록을 다시 만들었으므로 그 click 이 닿는 것은 **떼어진 옛 줄**이고,
        // click 리스너는 줄 자신에 붙어 있어 떼어진 뒤에도 발화한다 (그래서 가드가 필요하다).
        {
            const pair = pickPair()
            const active0 = ad.app.activeTab
            let a = pair ? pair.a : -1
            let b = pair ? pair.b : -1
            if (pair && ad.app.tabs[a] === active0) { a = pair.b; b = pair.a }
            const dragTab = a >= 0 ? ad.app.tabs[a] : null
            if (!pair || !dragTab || dragTab === active0) {
                skipCases(['RO8'], pair
                    ? '끌 수 있는 줄이 활성 탭뿐이다 — "전환되지 않았다" 를 관찰할 수 없다'
                    : '같은 그룹에 온전히 보이는 줄이 2개 이상인 화면이 아니다',
                { pair, activeIsCandidate: !!dragTab && dragTab === active0 })
            } else {
                clearDrag()
                const before = ad.app.tabs.slice()
                const rowA = rowOf(a)
                const rowB = rowOf(b)
                const c = centerOf(rowA)
                const p = pointIn(rowB, 'after')
                stubCapture()
                ptr(rowA, 'pointerdown', c.x, c.y)
                ptr(document, 'pointermove', p.x, p.y)
                const promoted = !!(dragState() && dragState().moved)
                ptr(document, 'pointerup', p.x, p.y)
                unstubCapture()
                await sleep(250)
                const movedSeq = seqRel(before)
                const moveHappened = moveOk(judgeMove(before.map((_, i) => i), movedSeq, a, b, 'after'))
                // ⓐ 드래그 부산물 click — 옛 줄에 그대로 보낸다 (브라우저가 하는 그것)
                clickOn(rowA)
                await sleep(150)
                const swallowed = ad.app.activeTab === active0

                // ⓑ 다음 정당한 클릭 — pointerdown → pointerup(움직임 없음) → click
                const rowNow = rowOf(ad.app.tabs.indexOf(dragTab))
                let selected = null
                if (rowNow) {
                    const c2 = centerOf(rowNow)
                    stubCapture()
                    ptr(rowNow, 'pointerdown', c2.x, c2.y)
                    ptr(document, 'pointerup', c2.x, c2.y)
                    unstubCapture()
                    clickOn(rowNow)
                    await sleep(250)
                    selected = ad.app.activeTab === dragTab
                }

                if (!promoted || !moveHappened || selected === null) {
                    add('RO8', nameOf('RO8'), null,
                        `클릭 공존을 재려면 먼저 드래그가 성립해야 한다 (승격=${promoted} 이동=${moveHappened}`
                            + ` 다음줄찾기=${rowNow ? 'ok' : '실패'}) — RO3 결과를 먼저 볼 것`,
                        { promoted, moveHappened, movedSeq, a, b })
                } else {
                    const pass8 = swallowed && selected
                    add('RO8', nameOf('RO8'), pass8,
                        pass8
                            ? '드래그 뒤 따라온 click 은 활성 탭을 바꾸지 않았고(가드), 그 다음 정당한'
                                + ' 클릭에서는 그 탭이 선택됐다 — 가드가 다음 클릭을 삼키지 않는다'
                            : `클릭 가드가 어긋난다 (드래그뒤 전환없음=${swallowed} 다음클릭 선택됨=${selected})`
                                + (swallowed ? ' — 가드가 풀리지 않아 클릭이 영구히 먹힌다' : ' — 드래그가 탭을 전환시켰다'),
                        { a, b, swallowed, selected, movedSeq })
                }
                // 활성 탭과 순서를 되돌린다
                if (origActive && ad.app.tabs.indexOf(origActive) >= 0) {
                    try { ad.app.selectTab(origActive) } catch { /* 무시 */ }
                }
                const rest = restoreOrder()
                cleanup.ro8Restore = rest.ok
                ad.render()
                await sleep(150)
            }
        }

        // ==================================================================== RO6·RO7
        // 헤더가 있는 화면(그룹 2개 이상)에서는 **같은 그룹 안에서만** 옮겨진다. 다른 그룹 줄에
        // 놓으면 무시되고 삽입선도 안 그려진다 — "놓은 곳에 안 간다" 가 가장 나쁜 결과라서
        // 제품이 아예 후보에서 뺀다(`dropTargetAt` 주석 :3999-4004).
        //
        // 그 화면을 만드는 방법은 `probe-group.js` GR6~ 와 **같다**: 그룹 키의 원천인 `cwdCache` 는
        // 탭 출력이 흐를 때 `touchCwd` 가 채우므로 프로브가 심을 수 없다. 그래서 cwd 가 다른
        // 임시 폴더에서 탭을 실제로 띄운다. 이름은 그 프로브와 같은 접두를 쓴다 — 러너의 GR15 가
        // 그 이름으로 잔여를 찾으므로 내가 흘린 것도 같은 그물에 걸린다.
        try {
            nodeFs = require('fs')
        } catch {
            // nodeIntegration 이 없는 창 — 임시 폴더를 만들 방법이 없다 (판정 불가)
        }
        if (!nodeFs) {
            skipCases(MULTI_IDS, 'renderer 에서 require("fs") 를 못 잡았다 — cwd 가 다른 임시 폴더를 만들 수 없다', null)
        } else {
            let dirs = null
            try {
                const os = require('os')
                const path = require('path')
                // realpath 로 시작한다 — pty 쪽이 realpath 를 한 번 더 걸어서
                // 원본이 링크면 그룹 키와 폴더명이 어긋난다 (probe-group.js 와 같은 이유)
                tmpBase = nodeFs.mkdtempSync(path.join(nodeFs.realpathSync(os.tmpdir()), 'ad-grp-ro-'))
                dirs = { a: path.join(tmpBase, 'aaa'), z: path.join(tmpBase, 'zzz') }
                nodeFs.mkdirSync(dirs.a)
                nodeFs.mkdirSync(dirs.z)
                // 그룹 경계는 자동 탐지(`project-root.ts`)라 마커를 심어야 갈림이 확정된다
                nodeFs.mkdirSync(path.join(dirs.a, '.git'))
                nodeFs.mkdirSync(path.join(dirs.z, '.git'))
            } catch (e) {
                dirs = null
                skipCases(MULTI_IDS, `임시 폴더를 만들지 못했다: ${String((e && e.message) || e)}`, { tmpBase })
            }

            /** cwd 가 `dir` 인 탭을 **제품 경로로** 하나 연다 (`+ 새 탭` → terminal.profile) */
            const openTabAt = async (dir, profId) => {
                const list = ad.config.store.profiles || []
                list.push({
                    id: profId,
                    type: 'local',
                    name: profId,
                    options: { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile'], cwd: dir, env: {} },
                })
                ad.config.store.profiles = list
                addedProfileIds.push(profId)
                ad.config.store.terminal.profile = profId
                await ad.config.save()
                const btn = sb() ? sb().querySelector('.ad-new') : null
                if (!btn) { return { ok: false, why: '사이드바 + 새 탭 버튼이 없다' } }
                const was = ad.app.tabs.slice()
                btn.click()
                const t0 = Date.now()
                while (ad.app.tabs.length <= was.length && Date.now() - t0 < 9000) {
                    await sleep(250)
                }
                const opened = ad.app.tabs.find(t => was.indexOf(t) < 0)
                if (!opened) { return { ok: false, why: `+ 새 탭 을 눌러도 9초 안에 탭이 늘지 않았다 (profile=${profId})` } }
                madeTabs.push(opened)
                return { ok: true, tab: opened }
            }

            if (dirs) {
                cfg.sortByStatus = false
                cfg.collapsedGroups = []
                await ad.config.save()

                const rz = await openTabAt(dirs.z, 'local:agentdeck-probe-grp-ro-z')
                const ra = rz.ok
                    ? await openTabAt(dirs.a, 'local:agentdeck-probe-grp-ro-a')
                    : { ok: false, why: rz.why }
                if (!rz.ok || !ra.ok) {
                    skipCases(MULTI_IDS, `cwd 가 다른 탭을 못 열었다 — ${rz.ok ? ra.why : rz.why}`,
                        { tabs: ad.app.tabs.length, dirs })
                } else {
                    // **`zzz` 에 탭을 하나 더 띄운다 (z2)** — RO7 의 전제가 "같은 그룹에 온전히
                    // 보이는 줄이 2개" 인데, 그룹 키는 cwd 라 임시 탭이 폴더마다 1개면 그 전제가
                    // 영영 성립하지 않는다(깨끗한 인스턴스에서 RO7 이 늘 판정 불가였던 이유다.
                    // 실측 2026-09-09: plan 4그룹이 모두 1탭 — aaa[3]·work[1]·zzz[2]·기타[0]).
                    // 같은 cwd 로 열면 제품이 z1·z2 를 한 그룹으로 묶으므로 **그룹 A 에 2줄 +
                    // 그룹 B(aaa) 에 1줄** 이 되고, RO6 이 필요한 "다른 그룹 줄" 도 그대로 남는다.
                    //
                    // 탭은 여기까지만 늘린다(임시 3개) — RO7 은 목록이 **넘칠** 필요가 없고,
                    // 넘침을 탭으로 만들려면 1700x1050 창에서 16탭이 들어 인스턴스가 휘청거린다
                    // (그 몫은 RO9~RO13 이 `makeScrollable` 로 사이드바를 줄여서 해결한다).
                    //
                    // z2 가 안 열려도 **RO6 은 살려 둔다** — 그쪽 전제(다른 그룹 줄 1개)는 이미
                    // 충족돼 있으므로 여기서 MULTI_IDS 를 통째로 접지 않는다.
                    const rz2 = await openTabAt(dirs.z, 'local:agentdeck-probe-grp-ro-z2')
                    /**
                     * 제품 계산과 화면을 층으로 나눠 본다 — `probe-group.js` 가 같은 이유로 나눴다.
                     * "그룹이 안 갈렸다" 를 실패로 적으면 그것은 그룹핑(GR6) 의 판정이지 여기 것이 아니다.
                     */
                    const look = () => {
                        const g = safeGroups()
                        if (!g) { return null }
                        const iz = ad.app.tabs.indexOf(rz.tab)
                        const ia = ad.app.tabs.indexOf(ra.tab)
                        const gz = g.plan.find(p => p.tabIndexes.indexOf(iz) >= 0) || null
                        const ga = g.plan.find(p => p.tabIndexes.indexOf(ia) >= 0) || null
                        return {
                            g, iz, ia, gz, ga,
                            withHeads: !!g.withHeads,
                            split: !!(gz && ga && gz !== ga),
                            heads: sb() ? sb().querySelectorAll('.ad-group-head').length : 0,
                            rowsThere: !!rowOf(iz) && !!rowOf(ia),
                        }
                    }
                    const t0 = Date.now()
                    let lk = look()
                    while (lk && !(lk.withHeads && lk.split && lk.heads > 1 && lk.rowsThere)) {
                        if (Date.now() - t0 >= 20000) { break }
                        await sleep(500)
                        ad.render()
                        lk = look()
                    }
                    const waitedMs = Date.now() - t0
                    const lkDump = lk ? {
                        withHeads: lk.withHeads, split: lk.split, heads: lk.heads,
                        rowsThere: lk.rowsThere, waitedMs,
                        groupZ: lk.gz ? { key: lk.gz.key, label: lk.gz.label, tabIndexes: lk.gz.tabIndexes } : null,
                        groupA: lk.ga ? { key: lk.ga.key, label: lk.ga.label, tabIndexes: lk.ga.tabIndexes } : null,
                        cwd: lk.g.cwdCache.filter(c => c.index === lk.iz || c.index === lk.ia),
                    } : { waitedMs }

                    if (!lk) {
                        skipCases(MULTI_IDS, '진단구 __agentdeck.groups() 가 없다 (낡은 dist)', lkDump)
                    } else if (!(lk.withHeads && lk.split && lk.heads > 1 && lk.rowsThere)) {
                        // 다중 그룹 화면이 안 만들어졌다 = **이 케이스의 전제 미충족**.
                        // 그룹핑 자체의 판정은 GR6~GR14 몫이라 여기서는 실패로 세지 않는다
                        skipCases(MULTI_IDS,
                            `다중 그룹 화면을 만들지 못했다 (제품 헤더=${lk.withHeads} 그룹분리=${lk.split}`
                                + ` 화면헤더=${lk.heads}개 두줄존재=${lk.rowsThere}, ${waitedMs}ms 대기)`
                                + ' — 그룹 계산·cwd 쪽 판정은 GR6~GR14 가 한다', lkDump)
                    } else {
                        // -------------------------------------------------- RO6 그룹 경계
                        const before = ad.app.tabs.slice()
                        clearDrag()
                        const rowZ = rowOf(lk.iz)
                        const rowA = rowOf(lk.ia)
                        const cz = centerOf(rowZ)
                        const pa = pointIn(rowA, 'after')
                        stubCapture()
                        ptr(rowZ, 'pointerdown', cz.x, cz.y)
                        ptr(document, 'pointermove', pa.x, pa.y)
                        const d = dragState()
                        const mid = {
                            moved: d ? d.moved : null,
                            target: d ? d.target : undefined,
                            line: d ? d.line : null,
                            lineEls: lineCount(),
                        }
                        ptr(document, 'pointerup', pa.x, pa.y)
                        unstubCapture()
                        await sleep(300)
                        const seq6 = seqRel(before)
                        const unchanged = sameArr(seq6, before.map((_, i) => i))
                        // 화면 대조도 같이 남긴다 — 다중 그룹 화면은 화면 순서와 app.tabs 순서가
                        // 어긋나므로, `data-ad-index` 가 "보이는 순서" 가 아니라는 증거가 한 번 더 생긴다
                        const g6 = safeGroups()
                        const want6 = drawnExpect(g6)
                        const seqDom = domSeq()
                        const domOk = !!want6 && sameArr(seqDom, want6)
                        const end6 = endReason()
                        // **왜** 거부됐는지까지 본다 — 좌표가 빗나가 목록 밖으로 읽혔어도
                        // 겉모습(순서 불변·삽입선 0)은 똑같다
                        const reject6 = end6 === undefined
                            ? null
                            : !!(end6 && end6.reason === 'no-target' && end6.drop === 'other-group')
                        const shape6 = mid.moved === true && !mid.target && mid.lineEls === 0
                            && mid.line === false && unchanged && dragState() === null
                        const pass6 = reject6 === null ? shape6 : (shape6 && reject6)
                        add('RO6', nameOf('RO6'), pass6,
                            pass6
                                ? `헤더 ${lk.heads}개인 화면에서 다른 그룹(${lk.ga.label}) 줄에 놓았더니`
                                    + ' 삽입선이 아예 그려지지 않고(대상 null) 놓아도 순서가 그대로였다'
                                    + (reject6 ? ' — 거부 이유도 other-group 이었다(좌표가 빗나간 것이 아니다)' : '')
                                : `그룹 경계가 새고 있다 (승격=${mid.moved} 대상=${JSON.stringify(mid.target)}`
                                    + ` 삽입선=${mid.lineEls} 순서불변=${unchanged}`
                                    + ` 거부이유=${end6 ? end6.reason + '/' + end6.drop : 'null'})`
                                    + ' — 다른 그룹에 놓으면 그 줄은 자기 그룹으로 되돌아가 앉는다',
                            Object.assign({ mid, seq: seq6, end: end6, rejectOk: reject6, domSeq: seqDom,
                                drawnExpect: want6, domMatches: domOk }, lkDump))

                        // -------------------------------------------------- RO7 같은 그룹 안 이동
                        // 같은 화면에서 **같은 그룹** 안으로는 옮겨져야 한다 — RO6 만 보면
                        // "드래그가 아예 안 된다" 도 통과로 셀 수 있다.
                        //
                        // 짝은 **우리가 같은 cwd 로 띄운 z1·z2** 에서 고른다 — 아무 그룹이나
                        // 집으면(`pickPair`) `기타`(cwd 미상) 처럼 우연히 2줄이 된 그룹이 잡혀
                        // "cwd 로 묶인 그룹 안 이동" 을 재는 것이 아니게 된다.
                        //
                        // **cwd 는 늦게 배운다** — 조용한 탭은 첫 출력이 흐를 때까지 `cwdCache` 가
                        // 비어 있고(실측: 위 gate 를 통과한 시점에도 방금 연 탭의 dir 이 null 이었다),
                        // 그동안 그 탭은 `기타` 에 앉아 있다. 그래서 `sleep` 한 번으로 때우지 않고
                        // probe-group.js GR6~ 과 같은 방식으로 **폴링**한다 — 고정 대기는 환경에
                        // 따라 초록/회색이 오가서 회귀로 쓸 수 없다. 폴링마다 `ad.render()` 를
                        // 직접 부르는 것도 같은 이유다 (창이 가려지면 rAF 가 멈춘다).
                        const zLook = () => {
                            const g = safeGroups()
                            if (!g || !g.plan || !rz2.ok) { return null }
                            const grpOf = i => g.plan.find(p => p.tabIndexes.indexOf(i) >= 0) || null
                            const dirOfIdx = i => {
                                const c = (g.cwdCache || []).find(x => x.index === i)
                                return c && c.dir ? c.dir : null
                            }
                            const i1 = ad.app.tabs.indexOf(rz.tab)
                            const i2 = ad.app.tabs.indexOf(rz2.tab)
                            const iA = ad.app.tabs.indexOf(ra.tab)
                            const g1 = grpOf(i1)
                            const g2 = grpOf(i2)
                            const gA = grpOf(iA)
                            // `key !== null` 을 요구한다 — 키가 null 이면 `기타`(cwd 미상)라서
                            // "cwd 로 묶였다" 는 근거가 없다
                            const together = !!(g1 && g2 && g1 === g2 && g1.key !== null && !g1.collapsed)
                            return {
                                i1, i2, iA, together,
                                key: g1 ? g1.key : null,
                                label: g1 ? g1.label : null,
                                // RO6 이 쓰는 **다른** 그룹 줄이 여전히 있는가 (구성이 한쪽으로 쏠리지 않았나)
                                otherThere: !!(g1 && gA && gA !== g1),
                                shown: together ? g1.tabIndexes.filter(i => insideList(rowOf(i))) : [],
                                groupSize: g1 ? g1.tabIndexes.length : 0,
                                cwd: { z1: dirOfIdx(i1), z2: dirOfIdx(i2), a: dirOfIdx(iA) },
                            }
                        }
                        const zReady = z => !!z && z.together && z.otherThere && z.shown.length >= 2
                        const zt0 = Date.now()
                        let zl = zLook()
                        while (zl && !zReady(zl)) {
                            if (Date.now() - zt0 >= 15000) { break }
                            await sleep(500)
                            ad.render()
                            zl = zLook()
                        }
                        const zWaited = Date.now() - zt0
                        let pair7 = null
                        if (zReady(zl)) {
                            pair7 = { key: zl.key, label: zl.label, a: zl.shown[0], b: zl.shown[1],
                                groupSize: zl.groupSize, from: 'zzz 탭 2개', waitedMs: zWaited }
                        } else {
                            // 우리가 만든 짝이 안 됐어도 화면에 다른 2줄 그룹이 있으면 그것으로 잰다
                            // (탭이 많은 인스턴스에서는 그쪽이 살아 있다). 느슨하게 만드는 것이
                            // 아니라 **판정 대상을 넓히는** 것뿐이다 — 판정 내용은 같다.
                            const p = pickPair()
                            if (p) { pair7 = Object.assign({ from: 'pickPair(대체)', waitedMs: zWaited }, p) }
                        }
                        if (!pair7) {
                            skipCases(['RO7'], (rz2.ok
                                ? '같은 cwd(zzz) 로 띄운 탭 2개가 한 그룹의 온전히 보이는 2줄이 되지 않았다'
                                    + ` (한그룹=${zl ? zl.together : null} 다른그룹줄=${zl ? zl.otherThere : null}`
                                    + ` 보이는줄=${zl ? zl.shown.length : 0}/${zl ? zl.groupSize : 0}`
                                    + ` 그룹키=${zl ? JSON.stringify(zl.label) : 'null'}`
                                    + ` cwd=${JSON.stringify(zl ? zl.cwd : null)}, ${zWaited}ms 대기)`
                                    + ' — 그룹 계산·cwd 쪽 판정은 GR6~GR14 가 한다'
                                : `같은 cwd 의 둘째 탭(z2)을 못 열었다 — ${rz2.why}`)
                                + ' / 화면의 다른 그룹에도 온전히 보이는 2줄이 없었다',
                            { plan: (safeGroups() || {}).plan || null, zLook: zl, zWaited, z2ok: rz2.ok })
                        } else {
                            clearDrag()
                            const b7 = ad.app.tabs.slice()
                            const keyBefore = pair7.key
                            const r7a = rowOf(pair7.a)
                            const r7b = rowOf(pair7.b)
                            const c7 = centerOf(r7a)
                            const p7 = pointIn(r7b, 'after')
                            stubCapture()
                            ptr(r7a, 'pointerdown', c7.x, c7.y)
                            ptr(document, 'pointermove', p7.x, p7.y)
                            const d7 = dragState()
                            const mid7 = {
                                moved: d7 ? d7.moved : null,
                                target: d7 ? d7.target : null,
                                line: d7 ? d7.line : null,
                                lineEls: lineCount(),
                            }
                            ptr(document, 'pointerup', p7.x, p7.y)
                            unstubCapture()
                            await sleep(300)
                            const seq7 = seqRel(b7)
                            const m7 = judgeMove(b7.map((_, i) => i), seq7, pair7.a, pair7.b, 'after')
                            // 옮긴 뒤에도 그 탭은 **같은 그룹**에 있어야 한다 (그룹 키는 cwd 라 순서와 무관)
                            const g7 = safeGroups()
                            const iNow = ad.app.tabs.indexOf(b7[pair7.a])
                            const grpNow = g7 ? (g7.plan.find(p => p.tabIndexes.indexOf(iNow) >= 0) || null) : null
                            const sameGroup = !!grpNow && grpNow.key === keyBefore
                            const pass7 = mid7.moved === true && !!mid7.target
                                && mid7.target.index === pair7.b && mid7.target.place === 'after'
                                && mid7.lineEls === 1 && moveOk(m7) && sameGroup
                            add('RO7', nameOf('RO7'), pass7,
                                pass7
                                    ? `헤더 있는 화면에서 같은 그룹(${grpNow.label}) 안으로는 끌어 옮겨지고,`
                                        + ' 옮긴 뒤에도 그 탭의 그룹이 바뀌지 않았다'
                                    : `같은 그룹 안 이동이 어긋난다 (승격=${mid7.moved}`
                                        + ` 대상=${JSON.stringify(mid7.target)} 삽입선=${mid7.lineEls}`
                                        + ` 인접=${m7.adjacent} 나머지유지=${m7.othersKept} 같은그룹=${sameGroup})`,
                                { pair: pair7, mid: mid7, seq: seq7, judge: m7,
                                    groupBefore: keyBefore, groupAfter: grpNow ? grpNow.key : null })
                        }
                    }
                }
            }
        }

        // ==================================================================== RO9~RO13
        // **드래그 중 목록 끝에서의 자동 스크롤.** 탭이 많아 목록이 넘치면 화면 밖으로는
        // 한 번에 못 옮기던 것(cycle 10·11 의 "남은 것")이 이 기능이고, 여기서 재는 것은
        // 다섯 가지다 — ① 정말 흐르나 ② 흐른 뒤 삽입선이 옳은 줄을 가리키나 ③ 손을 떼면
        // 멈추고 잔여가 없나 ④ **화면 밖 줄로 실제로 옮겨지나**(목적 그 자체) ⑤ 끌지 않을 때
        // 아무 일도 없나.
        //
        // 규칙(띠 두께·속도·스크롤축)은 **베끼지 않는다.** 좌표는 목록 rect 에서 만들고,
        // "그 좌표가 띠 안인가 / 축이 무엇인가" 는 진단구(`reorderDrag().scroll`,
        // `lastDrag().scrollAxis`)에게 묻는다. 사본을 두면 제품이 값을 바꿔도 옛 값으로
        // 계속 통과한다 — 이 파일이 `planTabMove` 를 안 베낀 것과 같은 이유다.
        {
            const env = await makeScrollable()
            if (!env.ok) {
                skipCases(SCROLL_IDS,
                    env.why || `목록이 넘치지 않는 화면이다 (여유 ${env.room}px < 필요 ${env.need}px)`
                        + ' — 스크롤할 것이 없으면 이 기능은 할 일이 없다', env)
            } else {
                const axis = env.axis
                /**
                 * 줄을 하나 잡아 가장자리 띠까지 끌어다 놓는다 (손은 아직 떼지 않는다).
                 *
                 * 돌려주는 `s` 가 그 좌표에서의 제품 판단이다 — `active` 는 루프가 걸렸나,
                 * `speed` 는 띠 안인가(0 이면 아니다). `ok: null` 은 **판정 불가**다.
                 */
                const startEdgeDrag = async (from, dir) => {
                    clearDrag()
                    setScrollPos(axis, from)
                    await sleep(40)
                    const cands = []
                    for (const el of rowEls()) {
                        const p = grabPoint(el)
                        if (p) { cands.push({ el, p }) }
                    }
                    if (!cands.length) { return { ok: null, why: '잡을 줄의 좌표를 만들지 못했다' } }
                    const ep = edgePoint(axis, dir || 1, cands[0].el)
                    if (!ep) { return { ok: null, why: '목록 가장자리 좌표를 만들지 못했다' } }
                    // **가장자리에 있는 줄을 잡으면 안 된다.** 그러면 커서가 자기 자신을 짚어
                    // `dropTargetAt` 이 `self` 로 거부하고 대상이 null 이 된다 — 삽입선을 대조할
                    // 것이 없어져 판정 불가로 떨어진다 (2026-09-09 실측).
                    const atEdge = (() => {
                        const hit = document.elementFromPoint(ep.x, ep.y)
                        return hit ? hit.closest('.ad-tab') : null
                    })()
                    // 가장자리 줄밖에 없으면 그것을 잡는다 — 그때는 첫 대상이 `self` 로 null 이
                    // 되지만, 스크롤이 다른 줄을 커서 밑으로 데려오면 대상이 생긴다. 호출부가
                    // 그 첫 구간을 기다린다(RO10) 또는 애초에 대상을 폴링한다(RO12).
                    const pick = cands.find(c => c.el !== atEdge) || cands[0]
                    const row = pick.el
                    const grab = pick.p
                    stubCapture()
                    ptr(row, 'pointerdown', grab.x, grab.y)
                    ptr(document, 'pointermove', ep.x, ep.y)
                    const d = dragState()
                    if (!d || d.moved !== true) {
                        unstubCapture()
                        return { ok: null, why: `드래그로 승격하지 않았다 (moved=${d ? d.moved : null})` }
                    }
                    const s = d.scroll
                    if (s === undefined) {
                        unstubCapture()
                        return { ok: null, why: '진단구가 자동 스크롤 상태를 열지 않는다 (낡은 dist)' }
                    }
                    return {
                        ok: true, row, grab, ep, dir: dir || 1, from: d.from, target0: d.target, s,
                        grabbedEdgeRow: row === atEdge, cands: cands.length,
                        startPos: scrollPos(axis),
                    }
                }

                // ------------------------------------------------------------ RO9
                // 흐르는지 + **띠를 벗어나면 멈추는지.** 포인터 이벤트를 한 번만 보내고 기다린다 —
                // 커서가 멈춘 뒤에도 흐르는 것이 이 기능의 조작 방법이고, 그러면 스크롤을 만든
                // 것은 이벤트가 아니라 **타이머**임이 증명된다.
                {
                    const st = await startEdgeDrag(0, 1)
                    if (st.ok !== true) {
                        skipCases(['RO9'], st.why, { env })
                    } else if (!st.s.speed) {
                        clearDrag()
                        add('RO9', nameOf('RO9'), null,
                            '제품이 목록 가장자리 안쪽 2px 를 띠로 보지 않는다 (speed=0)'
                                + ' — 목록이 너무 짧아 띠가 성립하지 않는 화면이다', { env, s: st.s })
                    } else {
                        const p0 = st.startPos
                        const x0 = crossPos(axis)
                        await sleep(400)
                        const p1 = scrollPos(axis)
                        const x1 = crossPos(axis)
                        const armed = st.s
                        // 띠 밖(목록 한가운데)으로 옮기면 멈춰야 한다
                        const mid = midPoint()
                        ptr(document, 'pointermove', mid.x, mid.y)
                        const sMid = dragScroll()
                        const p2 = scrollPos(axis)
                        await sleep(320)
                        const p3 = scrollPos(axis)
                        pressEsc()
                        unstubCapture()
                        await sleep(200)
                        const end = endReason()
                        const flowed = p1 - p0
                        const froze = Math.abs(p3 - p2) < 1
                        const reasonOk = end === undefined ? null : !!(end && end.reason === 'esc')
                        const pass9 = armed.active === true && armed.axis === axis
                            && flowed > 4 && Math.abs(x1 - x0) < 1
                            && !!sMid && sMid.active === false && sMid.speed === 0 && froze
                            && reasonOk !== false
                        add('RO9', nameOf('RO9'), pass9,
                            pass9
                                ? `가장자리에 대고 **포인터를 더 움직이지 않았는데** 목록이 ${Math.round(flowed)}px`
                                    + ` 흘렀다(${axis}축, 반대축 불변) — 이벤트가 아니라 타이머가 한 일이다.`
                                    + ` 커서를 목록 한가운데로 옮기니 제품이 speed 0 으로 루프를 끊고`
                                    + ` 화면이 320ms 동안 ${Math.round(Math.abs(p3 - p2))}px 도 안 움직였다`
                                : `자동 스크롤이 어긋난다 (걸림=${armed.active} 축=${armed.axis}/${axis}`
                                    + ` 흐른거리=${Math.round(flowed)}px 반대축=${Math.round(x1 - x0)}`
                                    + ` 띠밖정지=${sMid ? sMid.active + '/' + sMid.speed : 'n/a'}`
                                    + ` 정지후불변=${froze} 종료사유=${end ? end.reason : 'n/a'})`,
                            { env, armed, sMid, p0, p1, p2, p3, cross: { x0, x1 }, end })
                    }
                }

                // ------------------------------------------------------------ RO10
                // **스크롤 뒤 삽입선.** 목록만 흐르고 삽입선이 옛 자리에 남으면 "어디에 떨어질지
                // 모르는 드래그" 가 되어 이 기능이 없애려던 문제로 되돌아간다.
                // 대상은 **제품이 말한 것**(`reorderDrag().target`)을 쓰고, 프로브는 그 줄의
                // 화면 좌표와 삽입선이 실제로 그려진 자리를 대조한다.
                //
                // 표본을 **흐르는 도중에 두 번** 뜬다. 스크롤 전 표본을 쓰지 않는 이유(실측):
                // 첫 프레임의 대상은 null 일 수 있다 — 커서가 아직 잡은 줄 자신을 짚는다(`self`).
                // 그리고 방향은 **앞쪽(위)** 이다: 뒤쪽 끝에서는 커서가 목록 아래 여백에 얹혀
                // `dropTargetAt` 이 `no-row` → "맨 끝 줄의 뒤" 폴백으로 떨어지고, 그 폴백은
                // 스크롤을 해도 같은 줄이라 삽입선이 움직이는지가 흐려진다.
                {
                    /**
                     * 삽입선이 그 대상의 자리에 그려져 있나 — 제품의 그림 규약(`drawReorderLine`)은
                     * "대상 줄의 앞/뒤 경계, 목록 안으로 가둠" 이다. 그 **관측 가능한 계약**만 본다.
                     */
                    const lineCheck = target => {
                        const el = document.querySelector('.ad-reorder-line')
                        const host = listEl()
                        if (!el || !host || !target) {
                            return { ok: false, why: `삽입선(${!!el})이나 대상(${!!target})이 없다` }
                        }
                        const rowEl = rowOf(target.index)
                        if (!rowEl) { return { ok: false, why: '대상 줄 엘리먼트를 못 찾았다' } }
                        const L = el.getBoundingClientRect()
                        const R = rowEl.getBoundingClientRect()
                        const l = host.getBoundingClientRect()
                        const flow = sideways()
                        const want = flow
                            ? (target.place === 'after' ? R.right : R.left)
                            : (target.place === 'after' ? R.bottom : R.top)
                        const got = flow ? (L.left + L.right) / 2 : (L.top + L.bottom) / 2
                        const clamped = Math.min(Math.max(want, flow ? l.left : l.top), flow ? l.right : l.bottom)
                        const inside = L.top >= l.top - 2 && L.bottom <= l.bottom + 2
                            && L.left >= l.left - 2 && L.right <= l.right + 2
                        const off = Math.abs(got - clamped)
                        // **가로지르는 축도 본다.** 흐름축만 보면 스크롤이 그 축과 다를 때
                        // 옛 자리에 남은 선을 놓친다 — 하단 도킹은 흐름축이 x 인데 스크롤은 y 라,
                        // 재계산을 아예 빼 놓고도 x 는 그대로 맞아서 통과해 버렸다 (2026-09-09
                        // 결함 주입 실측). 제품은 대상 줄의 폭/높이를 목록 안으로 가둬 그린다.
                        const cLo = Math.min(Math.max(flow ? R.top : R.left, flow ? l.top : l.left), flow ? l.bottom : l.right)
                        const cHi = Math.min(Math.max(flow ? R.bottom : R.right, flow ? l.top : l.left), flow ? l.bottom : l.right)
                        const gotLo = flow ? L.top : L.left
                        const gotHi = flow ? L.bottom : L.right
                        const crossOff = Math.max(Math.abs(gotLo - cLo), Math.abs(gotHi - cHi))
                        return {
                            ok: off <= 3 && crossOff <= 3 && inside,
                            off: Math.round(off), crossOff: Math.round(crossOff), inside,
                            got: Math.round(got), want: Math.round(want), clamped: Math.round(clamped),
                            cross: { gotLo: Math.round(gotLo), gotHi: Math.round(gotHi), wantLo: Math.round(cLo), wantHi: Math.round(cHi) },
                            index: target.index, place: target.place,
                            rect: { t: Math.round(L.top), b: Math.round(L.bottom), l: Math.round(L.left), r: Math.round(L.right) },
                        }
                    }
                    const sample = () => {
                        const d = dragState()
                        const t = d ? d.target : null
                        return { pos: scrollPos(axis), target: t, line: lineCheck(t), lineEls: lineCount() }
                    }
                    const st = await startEdgeDrag(scrollRoom(axis), -1)
                    if (st.ok !== true) {
                        skipCases(['RO10'], st.why, { env })
                    } else if (!st.s.speed) {
                        clearDrag()
                        add('RO10', nameOf('RO10'), null, '가장자리 좌표가 띠 안이 아니다 (speed=0)', { env, s: st.s })
                    } else {
                        // 흐르기 시작한 **첫 순간**을 잡는다 — 여유가 77px 이고 가장자리 속도가
                        // 758px/s 이면 100ms 만에 끝까지 간다(실측). 고정 대기로는 두 표본이
                        // 둘 다 끝자리가 되어 아무것도 못 가른다
                        const p0 = st.startPos
                        let s1 = null
                        for (let i = 0; i < 26; i++) {
                            await sleep(16)
                            // **대상이 생긴 뒤** 첫 표본을 뜬다 — 잡은 줄이 곧 커서 밑의 줄이면
                            // 첫 프레임의 대상은 `self` 로 null 이다(위 startEdgeDrag 주석)
                            if (Math.abs(scrollPos(axis) - p0) > 1) {
                                const cand = sample()
                                if (cand.target) { s1 = cand; break }
                            }
                        }
                        await sleep(320)
                        const s2 = sample()
                        pressEsc()
                        unstubCapture()
                        await sleep(180)
                        const flowed = s1 ? Math.abs(s2.pos - s1.pos) : 0
                        if (!s1) {
                            add('RO10', nameOf('RO10'), null,
                                '416ms 안에 "목록이 흐르면서 놓을 자리가 있는" 표본을 뜨지 못했다'
                                    + ` (시작자리 ${p0}, 지금 ${scrollPos(axis)}) — RO9 결과를 먼저 볼 것`,
                                { env, p0, s2, st: { grabbedEdgeRow: st.grabbedEdgeRow, cands: st.cands } })
                        } else if (!s1.target || !s2.target) {
                            add('RO10', nameOf('RO10'), null,
                                '흐르는 동안 놓을 자리가 없는 표본이 있었다 — 대상 없이는 삽입선을'
                                    + ` 대조할 수 없다 (표본1=${JSON.stringify(s1.target)} 표본2=${JSON.stringify(s2.target)})`,
                                { env, s1, s2 })
                        } else {
                            const targetChanged = s1.target.index !== s2.target.index
                            const lineMoved = Math.abs(s2.line.rect.t - s1.line.rect.t) > 2
                                || Math.abs(s2.line.rect.l - s1.line.rect.l) > 2
                            if (!targetChanged && !lineMoved && flowed <= 4) {
                                add('RO10', nameOf('RO10'), null,
                                    '두 표본 사이에 목록도 대상도 삽입선도 그대로라 재계산을 가릴 수 없다',
                                    { env, s1, s2, flowed })
                            } else {
                                const pass10 = s1.line.ok && s2.line.ok && s2.lineEls === 1 && s1.lineEls === 1
                                add('RO10', nameOf('RO10'), pass10,
                                    pass10
                                        ? `흐르는 동안 두 번 떠 본 표본에서 삽입선이 **그때의 대상 줄**`
                                            + `(${s1.target.index}${targetChanged ? '→' + s2.target.index : ''})의`
                                            + ` ${s2.target.place} 경계에 오차 ${s1.line.off}px/${s2.line.off}px`
                                            + ` (가로지르는 축 ${s1.line.crossOff}px/${s2.line.crossOff}px) 으로`
                                            + ` 그려져 있었다 (그 사이 목록 ${Math.round(flowed)}px 이동,`
                                            + ` 선도 ${Math.round(Math.abs(s2.line.rect.t - s1.line.rect.t))}px 따라 움직임,`
                                            + ' 목록 밖으로 삐져나가지 않음, 선은 늘 1개)'
                                        : `삽입선이 스크롤을 따라오지 않는다 (표본1 일치=${s1.line.ok}`
                                            + `/오차 ${s1.line.off}·${s1.line.crossOff}px, 표본2 일치=${s2.line.ok}`
                                            + `/오차 ${s2.line.off}·${s2.line.crossOff}px`
                                            + ` 목록안=${s2.line.inside} 선개수=${s1.lineEls}/${s2.lineEls})`
                                            + ' — 옛 자리에 남은 삽입선은 "어디에 떨어질지 모르는 드래그" 다',
                                    { env, s1, s2, flowed: Math.round(flowed), targetChanged, lineMoved })
                            }
                        }
                    }
                }

                // ------------------------------------------------------------ RO11
                // 손을 떼면 **즉시** 멈춘다. 손 뗀 뒤에도 흐르면 사용자가 방금 놓은 자리가
                // 화면에서 미끄러진다. 타이머 잔여는 "손 뗀 뒤 자리를 다시 심어 놓고 기다렸을 때
                // 아무도 그것을 움직이지 않는다" 로 잰다 — 이 저장소는 타이머 잔여로 값을 치른 적이 있다.
                {
                    const st = await startEdgeDrag(0, 1)
                    if (st.ok !== true) {
                        skipCases(['RO11'], st.why, { env })
                    } else if (!st.s.speed) {
                        clearDrag()
                        add('RO11', nameOf('RO11'), null, '가장자리 좌표가 띠 안이 아니다 (speed=0)', { env, s: st.s })
                    } else {
                        const b11 = ad.app.tabs.slice()
                        await sleep(240)
                        const flowed = scrollPos(axis) - st.startPos
                        ptr(document, 'pointerup', st.ep.x, st.ep.y)
                        unstubCapture()
                        await sleep(200)
                        const post = {
                            drag: dragState(),
                            lineEls: lineCount(),
                            body: document.body.classList.contains('ad-reordering'),
                            dragging: sb() ? sb().querySelectorAll('.ad-tab.ad-dragging').length : -1,
                            pos: scrollPos(axis),
                        }
                        // 자리를 다시 심고 기다린다 — 살아남은 루프가 있으면 이 값이 커진다
                        const seed = Math.round(Math.min(40, scrollRoom(axis) / 2))
                        setScrollPos(axis, seed)
                        const s0 = scrollPos(axis)
                        await sleep(500)
                        const s1 = scrollPos(axis)
                        const end = endReason()
                        const scrolledSaid = end && end.scrolled ? end.scrolled : null
                        const pass11 = flowed > 4 && post.drag === null && post.lineEls === 0
                            && !post.body && post.dragging === 0
                            && Math.abs(s1 - s0) < 1
                            && !!scrolledSaid && scrolledSaid.px > 0 && scrolledSaid.axis === axis
                        add('RO11', nameOf('RO11'), pass11,
                            pass11
                                ? `흐르는 중에(${Math.round(flowed)}px) 손을 뗐더니 드래그 상태·삽입선·`
                                    + `ad-reordering·ad-dragging 이 전부 걷혔고, 자리를 ${seed}px 로 다시`
                                    + ` 심어 500ms 기다려도 아무도 그것을 움직이지 않았다`
                                    + ` (제품이 말한 이 드래그의 스크롤 거리 ${scrolledSaid.px}px/${scrolledSaid.axis}축)`
                                : `손을 뗀 뒤가 깨끗하지 않다 (흐름=${Math.round(flowed)}px`
                                    + ` 드래그잔여=${JSON.stringify(post.drag)} 삽입선=${post.lineEls}`
                                    + ` body=${post.body} 줄표식=${post.dragging}`
                                    + ` 심은뒤이동=${Math.round(Math.abs(s1 - s0))}px`
                                    + ` 제품이말한거리=${JSON.stringify(scrolledSaid)})`,
                            { env, flowed: Math.round(flowed), post, seed, s0, s1, end })
                        // 이 케이스는 커밋으로 끝났다 — 다음 케이스가 원래 순서를 재도록 되돌린다
                        if (!sameArr(seqRel(b11), b11.map((_, i) => i))) {
                            cleanup.ro11Restore = restoreOrder().ok
                        }
                        ad.render()
                        await sleep(150)
                    }
                }

                // ------------------------------------------------------------ RO12
                // **이 기능의 목적 그 자체** — 드래그를 시작할 때 화면에 없던 줄로 옮겨진다.
                // 자동 스크롤이 없으면 손을 떼고 스크롤한 뒤 다시 끄는 왕복이 필요했다.
                //
                // 목표 줄은 **위쪽으로** 숨은 줄에서 고른다(끝까지 스크롤해 둔 자리에서 시작).
                // 아래쪽으로 숨은 마지막 줄을 목표로 삼으면 안 된다 — 커서를 아래 가장자리에
                // 두면 `dropTargetAt` 이 `no-row` → "맨 끝 줄의 뒤" 로 폴백해서 **스크롤이
                // 한 px 도 안 일어나도** 그 줄이 대상이 된다 (2026-09-09 실측: 이동은 성공했지만
                // 제품이 말한 scrolled.px 가 0 이었다 — 자동 스크롤을 검증하지 못하는 통과였다).
                {
                    clearDrag()
                    const room0 = scrollRoom(axis)
                    setScrollPos(axis, room0)
                    await sleep(80)
                    // 지금 **화면 밖**(위로 감긴) 줄들 — 그중 첫 줄을 목표로 삼는다.
                    // 그 줄이 커서 밑에 오려면 목록이 끝에서 끝까지 흘러야 한다
                    const hidden = rowEls().filter(el => !insideList(el)).map(el => Number(el.dataset.adIndex))
                    const goal = hidden.length ? hidden[0] : -1
                    if (goal < 0) {
                        skipCases(['RO12'], `스크롤 자리 ${room0} 에서 화면 밖인 줄이 없다 — 옮길 대상이 없다`,
                            { env, rows: domSeq() })
                    } else {
                        const st = await startEdgeDrag(room0, -1)
                        if (st.ok !== true) {
                            skipCases(['RO12'], st.why, { env })
                        } else if (!st.s.speed) {
                            clearDrag()
                            add('RO12', nameOf('RO12'), null, '가장자리 좌표가 띠 안이 아니다 (speed=0)', { env, s: st.s })
                        } else if (st.from === goal) {
                            clearDrag()
                            add('RO12', nameOf('RO12'), null,
                                `잡힌 줄이 목표 줄(${goal})과 같다 — 자기 자리로는 옮길 수 없다`, { env, st: st.from })
                        } else {
                            const before = ad.app.tabs.slice()
                            // **사람이 하는 그것을 그대로 한다** — 가장자리에 대고 삽입선이 원하는 줄에
                            // 닿을 때까지 기다렸다가 그 자리에서 손을 뗀다. 좌표를 다시 겨누지 않는다:
                            // 실측으로 끝까지 흘러도 마지막 줄은 목록 경계에 7px 걸쳐 있어(내용 여백
                            // 8px 때문에 딱 맞지 않는다) 화면 기하로는 "안 들어왔다" 가 되는데 그 줄은
                            // 이미 놓을 수 있는 자리다. 그래서 **제품이 지금 어디를 가리키나**를 기다린다.
                            const t0 = Date.now()
                            let tgt = null
                            while (Date.now() - t0 < 5000) {
                                const d = dragState()
                                if (!d) { break }
                                if (d.target && d.target.index === goal) { tgt = d.target; break }
                                await sleep(60)
                            }
                            const waited = Date.now() - t0
                            const flowed = Math.abs(scrollPos(axis) - room0)
                            if (tgt) {
                                ptr(document, 'pointerup', st.ep.x, st.ep.y)
                            } else {
                                pressEsc()
                            }
                            unstubCapture()
                            await sleep(300)
                            const end = endReason()
                            if (!tgt) {
                                add('RO12', nameOf('RO12'), null,
                                    `가장자리에 대고 ${waited}ms 를 기다렸는데 삽입선이 목표 줄(${goal})에`
                                        + ` 닿지 않았다 (흐른거리 ${Math.round(flowed)}/${room0}px)`,
                                    { env, goal, hidden, room: room0, drag: dragState(), end })
                            } else {
                                const after = seqRel(before)
                                const judged = judgeMove(before.map((_, i) => i), after, st.from, goal, tgt.place)
                                const said = end === undefined ? null : !!(end && end.reason === 'moved')
                                const scrolledSaid = end && end.scrolled ? end.scrolled.px : null
                                // **자동 스크롤이 실제로 한 일**이어야 한다 — 흐르지 않고 도달했다면
                                // 이 케이스는 이 기능을 검증하지 못한 것이다
                                const byScroll = flowed > 4 && (scrolledSaid === null || scrolledSaid > 4)
                                const pass12 = moveOk(judged) && said !== false && byScroll
                                add('RO12', nameOf('RO12'), pass12,
                                    pass12
                                        ? `드래그를 시작할 때 **화면 밖이던** ${goal} 번 줄(숨은 줄`
                                            + ` ${hidden.length}개)까지 목록이 ${Math.round(flowed)}px 흐르며`
                                            + ` 따라왔고(${waited}ms), 삽입선이 그 줄의 ${tgt.place} 에 닿은 자리에서`
                                            + ' 손을 떼자 잡고 있던 줄이 정말 그리로 갔다'
                                            + ` (제품이 말한 스크롤 거리 ${scrolledSaid}px)`
                                        : `화면 밖 줄로 옮겨지지 않는다 (대상=${JSON.stringify(tgt)}`
                                            + ` 목표=${goal} 인접=${judged.adjacent} 나머지유지=${judged.othersKept}`
                                            + ` 집합=${judged.setOk} 종료사유=${end ? end.reason : 'n/a'}`
                                            + ` 흐른거리=${Math.round(flowed)}px 제품이말한거리=${scrolledSaid}px)`,
                                    { env, goal, hidden, from: st.from, tgt, judge: judged, after, end,
                                        flowed: Math.round(flowed), room: room0, waited })
                            }
                            const rest = restoreOrder()
                            cleanup.ro12Restore = rest.ok
                            ad.render()
                            await sleep(150)
                        }
                    }
                }

                // ------------------------------------------------------------ RO13
                // ⓐ **끌지 않을 때는 아무 일도 없어야 한다.** 마우스가 목록 끝에 얹혀 있어도
                //    화면이 흐르면 사이드바를 눈으로 훑는 것 자체가 불가능해진다. 제품은
                //    hover 리스너를 아예 두지 않는 것으로 이걸 지키는데, 누가 나중에 편의로
                //    document/목록에 pointermove 리스너를 달면 조용히 깨지는 자리다.
                // ⓑ **게이트(`dragAutoScroll`)를 끄면 0.12.0 과 같다.** 같은 좌표에서 제품이
                //    "여기는 띠 안이다"(speed != 0) 라고 말하면서도 루프를 걸지 않는 것으로
                //    본다 — 순서(불변)만 보면 좌표가 빗나가 못 흐른 것과 구별되지 않는다.
                {
                    clearDrag()
                    const seed = Math.round(Math.min(30, scrollRoom(axis) / 2))
                    setScrollPos(axis, seed)
                    const ep = edgePoint(axis, 1, rowEls()[0])
                    for (let i = 0; i < 5; i++) {
                        ptr(document, 'pointermove', ep.x, ep.y)
                        await sleep(40)
                    }
                    const hoverRow = document.elementFromPoint(ep.x, ep.y)
                    if (hoverRow) { ptr(hoverRow, 'pointermove', ep.x, ep.y) }
                    await sleep(400)
                    const idle = { pos: scrollPos(axis), drag: dragState() }
                    const idleOk = Math.abs(idle.pos - seed) < 1 && idle.drag === null

                    cfg.dragAutoScroll = false
                    await ad.config.save()
                    const st = await startEdgeDrag(seed, 1)
                    let gate = { ok: null, why: st.why }
                    if (st.ok === true) {
                        await sleep(400)
                        const posOff = scrollPos(axis)
                        const sOff = dragScroll()
                        pressEsc()
                        unstubCapture()
                        await sleep(150)
                        gate = {
                            ok: st.s.active === false && st.s.speed !== 0 && sOff && sOff.active === false
                                && Math.abs(posOff - seed) < 1,
                            armed: st.s, later: sOff, seed, posOff,
                        }
                    }
                    cfg.dragAutoScroll = true
                    await ad.config.save()
                    clearDrag()

                    if (gate.ok === null) {
                        add('RO13', nameOf('RO13'), null,
                            `게이트를 끈 채로 드래그를 만들지 못했다 — ${gate.why}`
                                + ` (끌지 않을 때 불변은 ${idleOk})`, { env, idle, gate })
                    } else {
                        const pass13 = idleOk && gate.ok
                        add('RO13', nameOf('RO13'), pass13,
                            pass13
                                ? `끌지 않고 목록 끝 좌표로 pointermove 를 6번 보내고 400ms 기다려도`
                                    + ` 자리가 ${seed}px 그대로였고(드래그 상태도 없음),`
                                    + ' 게이트를 끄면 **같은 좌표를 제품이 띠로 인정하면서도**'
                                    + ` (speed=${gate.armed.speed}) 루프를 걸지 않아 400ms 동안 한 px 도 흐르지 않았다`
                                : `끌지 않을 때/껐을 때가 조용하지 않다 (끌지않음불변=${idleOk}`
                                    + ` 게이트=${gate.ok} armed=${JSON.stringify(gate.armed)}`
                                    + ` 자리=${gate.seed}->${gate.posOff})`,
                            { env, idle, gate })
                    }
                }
            }
        }
    } catch (e) {
        if (String((e && e.message) || e) !== 'ad-reorder-prereq') {
            add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
        }
        // 예외가 났어도 **안 매긴 케이스는 판정 불가로 채운다** — 결과에서 통째로 빠지면
        // 요약만 조용히 짧아져 "그 케이스는 재지도 않았다" 를 아무도 모른다
        skipCases(ALL_IDS, `프로브가 도중에 멈췄다: ${String((e && e.message) || e)}`, null)
    } finally {
        // 안전망 — 흐름이 어떤 이유로 그 케이스에 닿지 못했으면 `판정 불가`로 남긴다.
        // 결과에서 통째로 빠지면 요약만 조용히 짧아져 "재지도 않았다" 를 아무도 모른다
        // (예외 판은 catch 가 더 구체적인 사유로 이미 채운다 — 여기서 덮지 않는다)
        skipCases(ALL_IDS, '프로브 흐름이 이 케이스에 닿지 못했다 (앞 단계의 사유를 볼 것)', null)

        // ---------------------------------------------------------------- 정리
        // **순서 복원이 이 프로브의 가장 중요한 정리다.** 이 프로브만 `app.tabs` 를 실제로 흔들고,
        // 다른 순서의 화면을 남기면 뒤 프로브(R10·PR1·GR*)의 판정이 흔들린다.
        try { clearDrag() } catch { /* 무시 */ }
        unstubCapture()
        // 남은 삽입선·안내줄이 있으면 걷는다 (다음 프로브가 목록 자식을 훑는다)
        try {
            document.querySelectorAll('.ad-reorder-line').forEach(n => n.remove())
            document.body.classList.remove('ad-reordering')
        } catch { /* 무시 */ }

        // 임시 탭을 먼저 닫는다 — 순서 복원은 원본 탭들만 대상이므로 그 뒤여야 깨끗하다
        for (const t of madeTabs.slice().reverse()) {
            try { await ad.app.closeTab(t, false) } catch { /* 이미 닫혔다 */ }
        }
        cleanup.closedTabs = madeTabs.length
        madeTabs.length = 0
        if (addedProfileIds.length) {
            try {
                ad.config.store.profiles = (ad.config.store.profiles || [])
                    .filter(p => !p || addedProfileIds.indexOf(p.id) < 0)
            } catch { /* 무시 */ }
        }
        cleanup.removedProfiles = addedProfileIds.slice()
        if (prevProfileId !== undefined) {
            try { ad.config.store.terminal.profile = prevProfileId } catch { /* 무시 */ }
        }
        cleanup.terminalProfile = ad.config.store.terminal ? ad.config.store.terminal.profile : null

        // 순서 복원은 **게이트가 꺼진 상태**에서만 된다 — 설정을 되돌리기 전에 먼저 한다
        try {
            cfg.sortByStatus = false
            const rest = restoreOrder()
            cleanup.orderRestored = rest.ok
            cleanup.restoreMoves = rest.moves
            cleanup.orderNow = seqRel(orig)
        } catch (e) {
            cleanup.orderRestored = false
            cleanup.orderError = String((e && e.message) || e)
        }

        // 승인대기로 고정해 둔 탭의 상태를 되돌린다 (setManual 은 pin 을 건다 — README 의 그 함정)
        if (pinnedTab && pinnedSave && ad.app.tabs.indexOf(pinnedTab) >= 0) {
            try {
                const st = ad.status.get(pinnedTab)
                st.status = pinnedSave.status
                st.label = pinnedSave.label
                st.reason = pinnedSave.reason
                st.since = pinnedSave.since
                st.pinned = pinnedSave.pinned
                cleanup.statusRestored = { status: st.status, pinned: st.pinned }
            } catch (e) {
                cleanup.statusRestored = String((e && e.message) || e)
            }
        }

        // **창 폭을 먼저 되돌린다** — RO9~RO13 이 목록을 넘치게 만들려고 좁혀 뒀다(`narrowWindow`).
        // 좁은 창을 남기면 뒤 단계(2-c·러너의 폭/루트 확인)가 다른 폭의 화면을 재고, 사람 눈에도
        // 창이 쪼그라든 채 남는다. 아래 `relayout` 이 복원된 폭 위에서 도킹까지 되돌린다
        if (savedBounds) {
            try {
                const win = require('@electron/remote').getCurrentWindow()
                win.setBounds(savedBounds)
                const t0 = Date.now()
                while (window.innerWidth < savedBounds.width - 8 && Date.now() - t0 < 3000) { await sleep(80) }
                cleanup.winRestored = { want: savedBounds.width, now: window.innerWidth }
            } catch (e) {
                cleanup.winRestored = String((e && e.message) || e)
            }
        }

        Object.assign(cfg, saved)
        try { await ad.config.save() } catch { /* 무시 */ }
        // **`relayout` 까지 해야 도킹이 실제로 돌아온다** — RO9~RO13 이 하단 도킹으로 바꿔
        // 두고 갔으므로, 설정만 되돌리고 나가면 다음 프로브가 옆으로 눕은 사이드바를 잰다
        try { ad.relayout() } catch { /* 무시 */ }
        try { ad.render() } catch { /* 무시 */ }
        cleanup.dockRestored = cfg.sidebarDock === saved.sidebarDock
            && cfg.sidebarHeight === saved.sidebarHeight
        if (origActive && ad.app.tabs.indexOf(origActive) >= 0) {
            try { ad.app.selectTab(origActive) } catch { /* 무시 */ }
        }
        cleanup.activeRestored = ad.app.activeTab === origActive

        // 셸이 아직 그 폴더를 잡고 있으면 지우기가 실패한다 — 한 박자 기다리고 한 번 재시도
        if (nodeFs && tmpBase) {
            cleanup.tmpBase = tmpBase
            for (let i = 0; i < 2; i++) {
                try {
                    nodeFs.rmSync(tmpBase, { recursive: true, force: true })
                    cleanup.tmpRemoved = true
                    break
                } catch (e) {
                    cleanup.tmpRemoved = false
                    cleanup.tmpError = String((e && e.message) || e)
                    await sleep(800)
                }
            }
        }
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    // `cleanup` 은 케이스가 아니다 — 러너는 `results` 만 집계하므로(run-all.ps1 의 foreach)
    // 여기 실린 정리 결과는 요약 수치를 흔들지 않고 사람이 사후에 볼 증거로만 남는다
    return JSON.stringify({ summary, results, cleanup }, null, 1)
})()
