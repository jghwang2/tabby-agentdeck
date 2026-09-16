/**
 * 레이아웃·외형 회귀 프로브 — 이 플러그인이 **화면을 직접 배치**하는 부분만 잰다.
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스
 *   node tools/cdp.js 9222 tools/probe-layout.js
 *
 * `probe-all.js` 가 R1~R37 을 보지만, 도킹 **드래그**(마우스로 방향/크기 바꾸기)·화면비
 * 자동계산·최소폭 보장·투명도·배경 클리핑·`enabled` off/on 은 회귀 항목이 아예 없었다.
 * 레이아웃은 깨지면 사용자가 즉시 "화면이 깨졌다" 로 체감하는 자리라 눈 대신 좌표로 잰다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary` (`probe-all.js` 와 같은 규약).
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(환경이 조건을 못 만듦 — 실패와 섞지 않는다)
 *
 * **자기가 바꾼 것은 되돌린다.** 이 프로브가 만지는 값(도킹 방향·폭·높이·화면비·투명도·
 * `enabled`)은 전부 사용자가 화면으로 보는 상태다. 게다가 투명도는 agentdeck 설정이 아니라
 * **Tabby 전역 설정**(`terminal.colorScheme.background` / `terminal.background`)까지 바꾸므로
 * 스냅샷을 떠 두고 finally 에서 원복 + `config.save()` + `relayout()` 한다.
 */
(async () => {
    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    /** 조건이 참이 될 때까지 기다린다 — 폭 수렴(fit → session.resize)은 몇 프레임 늦다 */
    const waitFor = async (pred, ms = 3000, step = 200) => {
        for (let waited = 0; waited <= ms; waited += step) {
            if (pred()) { return true }
            await sleep(step)
        }
        return false
    }

    const sidebar = () => document.getElementById('agentdeck-sidebar')
    const viewEl = () => document.getElementById('agentdeck-view')
    const mainEl = () => document.querySelector('.content.main')
    const windowEl = () => document.querySelector('.window')
    /** 지금 화면에 실제로 그려진 미리보기 패널 폭 (닫혀 있으면 0) — probe-all.js R3 과 같은 규칙 */
    const viewW = () => {
        const v = viewEl()
        return v && v.style.display !== 'none' ? v.getBoundingClientRect().width : 0
    }
    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }

    // 제품 상수 사본 — `src/deck.service.ts:24-28`. 여기 값이 소스와 어긋나면 판정이 거짓이 된다.
    const MIN_TERM_W = 320
    const MIN_TERM_H = 160
    const MIN_SIDEBAR_W = 140
    const MIN_SIDEBAR_H = 90
    /**
     * `src/styles.scss` 의 `&.ad-dock-top, &.ad-dock-bottom` 블록 사본 — 줄 폭(`.ad-tab`
     * `flex: 0 0 220px`)과 줄 사이 가로 여백(`.ad-list` `gap: 0 6px`). LY9 가 쓴다.
     */
    const ROW_W = 220
    const ROW_GAP = 6
    /** `src/dock.ts:42` — 이보다 적게 움직이면 드래그로 보지 않는다 */
    const DRAG_THRESHOLD = 5

    const cfg = ad.config.store.agentDeck
    const term = ad.config.store.terminal || {}
    // 이 프로브가 만지는 agentDeck 값 전부 (finally 에서 되돌린다)
    const saved = {
        enabled: cfg.enabled,
        sidebarDock: cfg.sidebarDock, sidebarWidth: cfg.sidebarWidth, sidebarHeight: cfg.sidebarHeight,
        aspectW: cfg.aspectW, aspectH: cfg.aspectH,
        terminalOpacity: cfg.terminalOpacity, sidebarOpacity: cfg.sidebarOpacity,
        clipBackgroundToTerminal: cfg.clipBackgroundToTerminal,
        viewerOpen: cfg.viewerOpen, viewerDock: cfg.viewerDock, viewerWidth: cfg.viewerWidth,
    }
    // Tabby 전역 설정 — applyOpacity 가 컬러스킴 배경색과 배경 모드를 직접 고쳐 쓴다
    // (`deck.service.ts:2050-2052`). agentDeck 값만 되돌리면 터미널 색이 남는다.
    const savedTerm = {
        background: term.background,
        schemeBg: term.colorScheme ? term.colorScheme.background : null,
    }

    /**
     * dock.ts 는 **pointer 이벤트**로 드래그를 받는다 (`dock.ts:84·142·155·195`) —
     * mousedown/mousemove 를 쏘면 아무 일도 일어나지 않는다. 그래서 PointerEvent 를 만든다.
     * pointerdown 은 `ev.button !== 0` 이면 무시되므로 button 0 을 반드시 채운다.
     */
    const ptr = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
    }))

    /**
     * `setPointerCapture(ev.pointerId)` 는 **실재하는 포인터**만 잡을 수 있어서 합성 이벤트로는
     * NotFoundError 를 던진다. dock.ts 는 그 호출을 try 로 감싸지 않으므로(`dock.ts:92·152`)
     * 리스너가 중간에 끊긴다 — resize 는 `ad-resizing` 클래스가 안 붙고, 콘솔에 예외가 쌓인다.
     * 캡처는 **실제 이벤트의 배달 경로**를 바꾸는 장치일 뿐이고 우리는 대상 엘리먼트에 직접
     * dispatch 하므로, 잠시 no-op 으로 바꿔도 판정 대상 로직은 그대로다. finally 에서 되돌린다.
     */
    const protoEl = Element.prototype
    const origSetCapture = protoEl.setPointerCapture
    const origRelCapture = protoEl.releasePointerCapture
    // 드래그 케이스(LY1·LY2) 동안만 no-op 으로 바꾼다 — 그 밖의 시간에 Tabby 자신의 캡처까지
    // 무력화할 이유가 없다
    const stubCapture = () => {
        protoEl.setPointerCapture = function () { /* 합성 포인터라 잡을 것이 없다 */ }
        protoEl.releasePointerCapture = function () { /* 위와 같은 이유 */ }
    }
    const unstubCapture = () => {
        protoEl.setPointerCapture = origSetCapture
        protoEl.releasePointerCapture = origRelCapture
    }

    /**
     * `터미널 + 사이드바(+ 패널) == 창` 이 유지되나 — 가로 도킹이면 폭, 세로 도킹이면 높이.
     * (세로 도킹에서 높이를 보는 이유: 상/하 도킹은 폭을 안 건드리고 `height: calc(100% - extent)`
     *  로 터미널 높이를 깎는다 — `deck.service.ts:2219-2227`)
     */
    const invariant = () => {
        const w = windowEl()
        const m = mainEl().getBoundingClientRect()
        const s = sidebar().getBoundingClientRect()
        const horizontal = cfg.sidebarDock === 'left' || cfg.sidebarDock === 'right'
        if (horizontal) {
            const sum = Math.round(m.width + s.width + viewW())
            return { axis: 'width', sum, win: w.clientWidth, ok: Math.abs(sum - w.clientWidth) <= 2 }
        }
        const sum = Math.round(m.height + s.height)
        return { axis: 'height', sum, win: w.clientHeight, ok: Math.abs(sum - w.clientHeight) <= 3 }
    }

    /** 사이드바가 그 방향 창 가장자리에 붙었나 (±2px) */
    const attachedTo = side => {
        const w = windowEl().getBoundingClientRect()
        const s = sidebar().getBoundingClientRect()
        const gap = side === 'left' ? s.left - w.left
            : side === 'right' ? w.right - s.right
                : side === 'top' ? s.top - w.top
                    : w.bottom - s.bottom
        return { gap: Math.round(gap), ok: Math.abs(gap) <= 2 }
    }

    const dockArtifacts = () => document.querySelectorAll('.ad-dock-overlay, .ad-dock-preview, .ad-dock-zone').length

    const listOf = () => (sidebar() ? sidebar().querySelector('.ad-list') : null)
    const tabEls = () => (listOf() ? Array.from(listOf().querySelectorAll('.ad-tab')) : [])

    /**
     * 이 프로브가 만든 탭 — LY9 는 **둘째 칸의 좌표**로 격자를 판정하므로 줄이 최소 둘은
     * 있어야 한다. 화면에 모자라면 제품 경로(`+ 새 탭`)로 채우고 finally 에서 내가 만든
     * 것만 닫는다 (남기면 뒤 프로브가 다른 탭 수의 화면을 재게 된다).
     */
    const madeTabs = []
    const openPlainTab = async () => {
        const btn = sidebar() ? sidebar().querySelector('.ad-new') : null
        if (!btn) { return { ok: false, why: '`+ 새 탭` 버튼이 없다 (agentDeck.enabled 확인)' } }
        const before = ad.app.tabs.slice()
        btn.click()
        const grew = await waitFor(() => ad.app.tabs.length > before.length, 9000, 200)
        const opened = ad.app.tabs.find(t => before.indexOf(t) < 0)
        if (!grew || !opened) { return { ok: false, why: '`+ 새 탭` 을 눌러도 9초 안에 탭이 늘지 않았다' } }
        madeTabs.push(opened)
        return { ok: true }
    }

    /** 전제 미충족으로 빠져나갈 때 쓰는 표식 — 이걸로 끊긴 것은 **실패가 아니다**(LY0 이 null 로 남는다) */
    const PREREQ = 'ad-layout-prereq'

    try {
        if (!sidebar() || !windowEl() || !mainEl()) {
            add('LY0', '레이아웃 프로브 전제', null,
                '사이드바/.window/.content.main 중 하나가 없다 — 이 프로브는 판정할 수 없다',
                { sidebar: !!sidebar(), window: !!windowEl(), main: !!mainEl() })
            throw new Error(PREREQ)
        }
        // 기하 판정은 패널 유무에 흔들리므로 LY1~LY7 은 **패널을 닫은 상태**로 고정한다.
        // config 로 닫아야 한다 — 드래그 commit 의 `config.save()` 가 changed$ 를 돌려
        // `view.setOpen(cfg.viewerOpen)` 을 다시 부르므로, 설정이 열림이면 중간에 되열린다.
        cfg.enabled = true
        cfg.viewerOpen = false
        ad.config.save()
        await sleep(400)
        stubCapture()

        // ============================================================ LY1 도킹 드래그로 방향 변경
        // 판정: ① cfg.sidebarDock 이 그 방향으로 바뀐다 ② 사이드바가 그 가장자리에 붙는다(±2px)
        //       ③ 합계 == 창폭/창높이(±2·3px) ④ 드래그 중 오버레이가 떴다가 ⑤ 끝나면 0개가 된다
        {
            const head = sidebar().querySelector('.ad-head')
            if (!head) {
                add('LY1', '도킹 드래그 — 방향 변경', null, '`.ad-head` 가 없다 (사이드바 DOM 이 바뀌었다)', null)
            } else {
                // 네 방향을 전부 돌되 **매 단계가 실제 전환**이 되게 지금 방향이 첫 칸에 오지 않도록 회전한다
                // (dock.ts:188 은 같은 방향이면 setDock 을 건너뛰므로 그 단계는 판정이 헛돈다)
                const order = ['left', 'top', 'bottom', 'right']
                for (let i = 0; i < order.length && order[0] === cfg.sidebarDock; i++) { order.push(order.shift()) }
                const rows = []
                for (const side of order) {
                    const from = cfg.sidebarDock
                    const hr = head.getBoundingClientRect()
                    const sx = Math.round(hr.left + hr.width / 2)
                    const sy = Math.round(hr.top + hr.height / 2)
                    ptr(head, 'pointerdown', sx, sy)
                    // 임계값 넘기기 — hypot(8,8) ≈ 11.3 > DRAG_THRESHOLD(5). 여기서 오버레이가 뜬다
                    ptr(head, 'pointermove', sx + 8, sy + 8)
                    const overlayDuring = !!document.querySelector('.ad-dock-overlay')
                    // 존 버튼 정중앙을 노린다 (hitTest 가 먼저 보는 표적 — dock.ts:266).
                    // 오버레이가 안 떴으면 가장자리 띠(EDGE_RATIO 0.25) 좌표로 대신 간다
                    const zone = document.querySelector('.ad-dock-zone-' + side)
                    const wr = windowEl().getBoundingClientRect()
                    let tx, ty
                    if (zone) {
                        const zr = zone.getBoundingClientRect()
                        tx = Math.round(zr.left + zr.width / 2)
                        ty = Math.round(zr.top + zr.height / 2)
                    } else {
                        tx = Math.round(side === 'left' ? wr.left + wr.width * 0.05
                            : side === 'right' ? wr.right - wr.width * 0.05 : wr.left + wr.width / 2)
                        ty = Math.round(side === 'top' ? wr.top + wr.height * 0.05
                            : side === 'bottom' ? wr.bottom - wr.height * 0.05 : wr.top + wr.height / 2)
                    }
                    // 여러 번 움직여 hover 판정이 갱신되는 것까지 확인한다
                    ptr(head, 'pointermove', Math.round((sx + tx) / 2), Math.round((sy + ty) / 2))
                    ptr(head, 'pointermove', tx, ty)
                    const previewEl = document.querySelector('.ad-dock-preview')
                    const zoneActive = !!document.querySelector('.ad-dock-zone-' + side + '.active')
                    const previewShown = !!previewEl && previewEl.style.display === 'block'
                    ptr(head, 'pointerup', tx, ty)
                    await sleep(300)

                    const attach = attachedTo(side)
                    const inv = invariant()
                    const leftover = dockArtifacts()
                    rows.push({
                        drag: from + ' -> ' + side, dock: cfg.sidebarDock,
                        attachGap: attach.gap, axis: inv.axis, sum: inv.sum, win: inv.win,
                        overlayDuring, zoneActive, previewShown, artifactsAfter: leftover,
                        ok: cfg.sidebarDock === side && attach.ok && inv.ok && overlayDuring && leftover === 0,
                    })
                }
                const ok = rows.length === 4 && rows.every(r => r.ok)
                add('LY1', '도킹 드래그 — 방향 변경', ok,
                    ok ? `네 방향 전부: 임계 ${DRAG_THRESHOLD}px 초과 이동 후 존 버튼에 놓으면 sidebarDock 변경`
                        + ' + 그 가장자리 부착(±2px) + 합계=창(폭 ±2 / 높이 ±3) + 오버레이 잔여 0개'
                        : '어긋난 방향이 있다 (dock=설정값, attachGap=가장자리 거리, artifactsAfter>0 이면 오버레이가 화면에 남았다)',
                    rows)
            }
        }

        // ============================================================ LY2 경계선 드래그로 크기 변경
        // 판정 수치 — 드래그한 값은 config 에 **날값**으로 박히고, 클램프는 relayout 이 한다:
        //   가로: 하한 MIN_SIDEBAR_W(140) / 상한 창폭 − MIN_TERM_W(320)  (deck.service.ts:2083-2086)
        //   세로: 하한 MIN_SIDEBAR_H(90)  / 상한 창높이 − MIN_TERM_H(160) (deck.service.ts:2090-2091)
        // sidebarMin/sidebarMax(200/560)는 **드래그 값에는 일부러 안 걸린다** ("마우스가 우선",
        // 같은 자리 주석). 그 두 값은 자동계산(sidebarWidth=0)에서만 의미가 있어 LY3 에서 본다.
        {
            const handle = sidebar().querySelector('.ad-resize')
            if (!handle) {
                add('LY2', '경계선 드래그 — 크기 변경', null, '`.ad-resize` 핸들이 없다', null)
            } else {
                const rows = []
                /** 원하는 크기를 만들려면 커서를 어디에 둬야 하나 — dock.ts:104-112 의 역산 */
                const dragSize = async want => {
                    const wr = windowEl().getBoundingClientRect()
                    const hr = handle.getBoundingClientRect()
                    const horizontal = cfg.sidebarDock === 'left' || cfg.sidebarDock === 'right'
                    const px = horizontal
                        ? Math.round(cfg.sidebarDock === 'right' ? wr.right - want : wr.left + want)
                        : Math.round(hr.left + hr.width / 2)
                    const py = horizontal
                        ? Math.round(hr.top + hr.height / 2)
                        : Math.round(cfg.sidebarDock === 'bottom' ? wr.bottom - want : wr.top + want)
                    ptr(handle, 'pointerdown', Math.round(hr.left + hr.width / 2), Math.round(hr.top + hr.height / 2))
                    const resizingClass = document.body.classList.contains('ad-resizing')
                    ptr(handle, 'pointermove', px, py)
                    ptr(handle, 'pointerup', px, py)
                    await sleep(250)
                    const s = sidebar().getBoundingClientRect()
                    return {
                        resizingDuring: resizingClass,
                        resizingAfter: document.body.classList.contains('ad-resizing'),
                        stored: horizontal ? cfg.sidebarWidth : cfg.sidebarHeight,
                        actual: Math.round(horizontal ? s.width : s.height),
                    }
                }

                cfg.sidebarDock = 'right'
                cfg.sidebarWidth = 0
                ad.relayout()
                await sleep(250)
                const winW = windowEl().clientWidth
                for (const want of [400, winW + 800, 20]) {
                    const r = await dragSize(want)
                    // 기대값 = 제품 클램프 식 그대로 (softMax 는 드래그 값 자체라 안 걸린다)
                    const expect = Math.min(Math.max(want, MIN_SIDEBAR_W), Math.max(winW - MIN_TERM_W, MIN_SIDEBAR_W))
                    const inv = invariant()
                    rows.push({
                        axis: 'width', want, expect, ...r, mainW: mainEl().clientWidth,
                        sum: inv.sum, win: inv.win,
                        ok: Math.abs(r.actual - expect) <= 2 && r.stored === want && r.resizingDuring
                            && !r.resizingAfter && inv.ok,
                    })
                }

                cfg.sidebarDock = 'bottom'
                cfg.sidebarHeight = 200
                ad.relayout()
                await sleep(300)
                const winH = windowEl().clientHeight
                for (const want of [300, winH + 800, 10]) {
                    const r = await dragSize(want)
                    const expect = Math.min(Math.max(want, MIN_SIDEBAR_H), Math.max(winH - MIN_TERM_H, MIN_SIDEBAR_H))
                    const inv = invariant()
                    rows.push({
                        axis: 'height', want, expect, ...r, mainH: mainEl().clientHeight,
                        sum: inv.sum, win: inv.win,
                        ok: Math.abs(r.actual - expect) <= 3 && r.stored === want && r.resizingDuring
                            && !r.resizingAfter && inv.ok,
                    })
                }

                const ok = rows.every(r => r.ok)
                add('LY2', '경계선 드래그 — 크기 변경', ok,
                    ok ? `드래그 값이 그대로 적용되고 창 밖까지 끌면 상한에서 멈춘다`
                        + ` (가로 ${MIN_SIDEBAR_W}~창폭−${MIN_TERM_W} / 세로 ${MIN_SIDEBAR_H}~창높이−${MIN_TERM_H}).`
                        + ' 손 뗄 때 config 에 날값이 박히고 body.ad-resizing 이 걷힌다'
                        : '어긋난 드래그가 있다 (expect=제품 클램프식, actual=실측, stored=config 날값)',
                    rows)
            }
        }
        // 드래그 케이스는 여기서 끝 — 포인터 캡처를 곧바로 원상복구한다
        unstubCapture()

        // ============================================================ LY3 화면비 자동 계산
        // `sidebarWidth=0` 이면 터미널 폭을 `창높이 × aspectW/aspectH` 로 역산하고 남는 폭을
        // 사이드바가 갖는다. 규칙이 세 갈래라(docs/DEVELOPMENT.md "폭이 정해지는 순서")
        // 어느 갈래로 갔는지까지 분류해 판정한다 —
        //   ratio  : 사이드바 = 창폭 − 창높이×비율        (터미널이 정확히 화면비)
        //   maxCap : sidebarMax 에 걸려 남는 폭을 터미널이 흡수 (3번 규칙, absorbed>0)
        //   minWin : 창이 좁아 사이드바 최소폭(sidebarMin)이 이김 (터미널 < ideal)
        //
        // 4:3·16:9 만 재면 창 크기에 따라 둘 다 minWin 으로 떨어져 **비율 계산이 관측되지 않는다**
        // (1200x800 창: 4:3 ideal 1066, 창폭−sidebarMin 1000 → 둘 다 minWin). 그래서 지금 창에서
        // ratio/maxCap 갈래가 반드시 나오도록 **비율을 합성한 두 줄**을 덧붙인다.
        {
            cfg.sidebarDock = 'right'
            cfg.sidebarWidth = 0
            ad.relayout()
            await sleep(250)
            const baseW = windowEl().clientWidth
            // relayout 이 쓰는 높이는 창 높이가 아니라 터미널이 실제로 쓰는 높이다 (deck.service.ts:2112)
            const baseH = mainEl().clientHeight || windowEl().clientHeight
            const minS0 = cfg.sidebarMin || 200
            const maxS0 = Math.max(cfg.sidebarMax || 560, minS0)
            // ideal = baseW − (minS0+100) → 사이드바가 min~max 사이에 떨어져 ratio 갈래가 된다.
            // ideal = baseW − (maxS0+140) → 남는 폭이 max 를 넘어 maxCap 갈래(흡수 140px)가 된다.
            const plans = [[4, 3, 'as-is'], [16, 9, 'as-is']]
            if (baseH > 0 && baseW - (minS0 + 100) >= MIN_TERM_W) {
                plans.push([baseW - (minS0 + 100), baseH, 'ratio'])
            }
            if (baseH > 0 && baseW - (maxS0 + 140) >= MIN_TERM_W) {
                plans.push([baseW - (maxS0 + 140), baseH, 'maxCap'])
            }
            const rows = []
            for (const plan of plans) {
                cfg.aspectW = plan[0]
                cfg.aspectH = plan[1]
                ad.relayout()
                await sleep(280)
                const availW = windowEl().clientWidth
                const availH = mainEl().clientHeight || windowEl().clientHeight
                const minS = cfg.sidebarMin || 200
                const maxS = Math.max(cfg.sidebarMax || 560, minS)
                const ideal = Math.round(availH * (plan[0] / plan[1]))
                let termW = Math.min(ideal, availW - minS)
                termW = Math.max(termW, MIN_TERM_W)
                const expect = Math.min(Math.max(availW - termW, minS), maxS, Math.max(availW - MIN_TERM_W, minS))
                const actual = Math.round(sidebar().getBoundingClientRect().width)
                const mainW = mainEl().clientWidth
                const rule = expect === maxS && availW - termW > maxS ? 'maxCap'
                    : ideal > availW - minS ? 'minWin' : 'ratio'
                // 갈래별 판정 — 한 식으로 뭉치면 창 크기에 따라 거짓 실패가 난다
                const ruleOk = rule === 'ratio' ? Math.abs(mainW - ideal) <= 2
                    : rule === 'maxCap' ? mainW - ideal >= 1 && Math.abs(mainW - (availW - maxS)) <= 2
                        : mainW <= ideal + 2 && mainW >= MIN_TERM_W
                rows.push({
                    aspect: plan[0] + ':' + plan[1], synth: plan[2], availW, availH, idealTermW: ideal,
                    expectSidebar: expect, actualSidebar: actual, mainW, rule,
                    absorbed: mainW - ideal, sidebarMin: minS, sidebarMax: maxS,
                    ok: Math.abs(actual - expect) <= 2 && Math.abs(mainW - (availW - expect)) <= 2 && ruleOk,
                })
            }
            const seen = rows.map(r => r.rule)
            const observed = seen.indexOf('ratio') >= 0 && seen.indexOf('maxCap') >= 0
            const ok = rows.every(r => r.ok)
            add('LY3', '화면비 자동 계산 (sidebarWidth=0)', observed ? ok : (ok ? null : false),
                !observed
                    ? (ok ? `이 창(${baseW}x${baseH})에서는 ratio/maxCap 갈래를 만들지 못했다 — 식은 전부 맞았으나`
                        + ' 화면비 계산 자체는 관측되지 않았다 (판정 불가)'
                        : '어긋난 줄이 있다')
                    : ok ? `사이드바 = clamp(창폭 − 창높이×비율, sidebarMin, sidebarMax) 가 네 줄 전부 일치.`
                        + ' ratio 갈래에서 터미널 폭 == 창높이×비율(±2px), maxCap 갈래에서 남는 폭 140px 를'
                        + ' 터미널이 흡수(absorbed) — 문서의 "폭이 정해지는 순서" 3번'
                        : '어긋난 줄이 있다 (rule=적용된 갈래, idealTermW=창높이×비율, absorbed=흡수량)',
                rows)
        }

        // ============================================================ LY4 최소 폭/높이 보장
        // 창보다 큰 값을 넣어도 터미널은 MIN_TERM_W(320) / MIN_TERM_H(160) 밑으로 안 내려간다.
        {
            const rows = []
            cfg.sidebarDock = 'right'
            cfg.sidebarWidth = windowEl().clientWidth + 800
            ad.relayout()
            await sleep(300)
            {
                const w = windowEl()
                const s = sidebar().getBoundingClientRect()
                const inv = invariant()
                rows.push({
                    axis: 'width', ask: cfg.sidebarWidth, win: w.clientWidth,
                    mainW: mainEl().clientWidth, expectMain: MIN_TERM_W,
                    sidebarW: Math.round(s.width), expectSidebar: w.clientWidth - MIN_TERM_W,
                    sum: inv.sum, ok: Math.abs(mainEl().clientWidth - MIN_TERM_W) <= 2
                        && Math.abs(s.width - (w.clientWidth - MIN_TERM_W)) <= 2 && inv.ok,
                })
            }
            cfg.sidebarDock = 'bottom'
            cfg.sidebarHeight = windowEl().clientHeight + 800
            ad.relayout()
            await sleep(300)
            {
                const w = windowEl()
                const s = sidebar().getBoundingClientRect()
                const inv = invariant()
                rows.push({
                    axis: 'height', ask: cfg.sidebarHeight, win: w.clientHeight,
                    mainH: mainEl().clientHeight, expectMain: MIN_TERM_H,
                    sidebarH: Math.round(s.height), expectSidebar: w.clientHeight - MIN_TERM_H,
                    sum: inv.sum, ok: Math.abs(mainEl().clientHeight - MIN_TERM_H) <= 3
                        && Math.abs(s.height - (w.clientHeight - MIN_TERM_H)) <= 3 && inv.ok,
                })
            }
            const ok = rows.every(r => r.ok)
            add('LY4', '터미널 최소 크기 보장', ok,
                ok ? `창보다 800px 큰 값을 넣어도 터미널은 ${MIN_TERM_W}x(가로) / ${MIN_TERM_H}(세로) 를 지킨다`
                    : '터미널이 최소치 밑으로 내려갔다 (mainW/mainH 대 expectMain 비교)',
                rows)
            cfg.sidebarDock = 'right'
            cfg.sidebarWidth = 0
            cfg.sidebarHeight = saved.sidebarHeight
            ad.relayout()
            await sleep(250)
        }

        // ============================================================ LY5 투명도
        // 판정 수치 — 40% → 사이드바 `rgba(30, 33, 39, 0.4)` / 컬러스킴 배경 알파 `0x66`
        //   (round(40*255/100) = 102 = 0x66), 배경 모드가 `colorScheme` 로 못 박힌다.
        // 100% → `--ad-panel-bg` 제거(폴백으로 복귀) + 알파 제거(6자리 hex).
        // **Tabby 전역 설정을 바꾸는 유일한 케이스다** — 끝에서 스냅샷으로 즉시 되돌린다.
        {
            const scheme = ad.config.store.terminal && ad.config.store.terminal.colorScheme
            const base = scheme && scheme.background
            if (!base || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(String(base).trim())) {
                add('LY5', '투명도 (터미널·사이드바)', null,
                    'colorScheme.background 가 hex 가 아니어서 applyOpacity 가 조기 return 한다'
                    + ' (deck.service.ts:2040-2042) — 이 환경에서는 판정 불가',
                    { background: base === undefined ? null : base })
            } else {
                const panelVar = () => document.documentElement.style.getPropertyValue('--ad-panel-bg').trim()
                cfg.terminalOpacity = 40
                cfg.sidebarOpacity = 40
                ad.config.save()
                await sleep(450)
                const at40 = {
                    panel: panelVar(),
                    schemeBg: ad.config.store.terminal.colorScheme.background,
                    mode: ad.config.store.terminal.background,
                }
                cfg.terminalOpacity = 100
                cfg.sidebarOpacity = 100
                ad.config.save()
                await sleep(450)
                const at100 = {
                    panel: panelVar(),
                    schemeBg: ad.config.store.terminal.colorScheme.background,
                    mode: ad.config.store.terminal.background,
                }
                const ok = /,\s*0\.4\s*\)$/.test(at40.panel)
                    && /^#[0-9a-f]{6}66$/i.test(at40.schemeBg)
                    && at40.mode === 'colorScheme'
                    && at100.panel === ''
                    && /^#[0-9a-f]{6}$/i.test(at100.schemeBg)
                add('LY5', '투명도 (터미널·사이드바)', ok,
                    ok ? '40% → --ad-panel-bg 알파 0.4 + 컬러스킴 배경 알파 0x66 + background=colorScheme,'
                        + ' 100% → 변수 제거 + 알파 제거(6자리)'
                        : '스타일이 설정을 따라오지 않았다 (at40/at100 의 panel·schemeBg·mode 비교)',
                    { base, at40, at100 })
                // 즉시 원복 — finally 까지 미루면 그 사이 케이스들이 남의 색으로 돈다
                cfg.terminalOpacity = saved.terminalOpacity
                cfg.sidebarOpacity = saved.sidebarOpacity
                if (ad.config.store.terminal.colorScheme && savedTerm.schemeBg) {
                    ad.config.store.terminal.colorScheme.background = savedTerm.schemeBg
                }
                ad.config.store.terminal.background = savedTerm.background
                ad.config.save()
                await sleep(400)
            }
        }

        // ============================================================ LY6 배경 클리핑
        // 켜면 body 에 `ad-bg-clip` 이 붙고 `--ad-bg-*` 가 `.content.main` 실좌표와 같아야 한다
        // (styles.scss:7-14 가 그 변수로 배경 이미지 레이어를 자른다). 끄면 클래스·변수 둘 다 사라진다.
        {
            const root = document.documentElement
            const names = ['--ad-bg-left', '--ad-bg-top', '--ad-bg-width', '--ad-bg-height']
            const vars = () => names.map(n => root.style.getPropertyValue(n).trim())
            cfg.clipBackgroundToTerminal = true
            ad.config.save()
            // syncBackgroundClip 은 rAF 한 번 뒤에 잰다 (deck.service.ts:1997)
            await sleep(450)
            const r = mainEl().getBoundingClientRect()
            const want = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
            const on = { cls: document.body.classList.contains('ad-bg-clip'), vars: vars() }
            const got = on.vars.map(v => parseFloat(v))
            const matched = want.every((v, i) => isFinite(got[i]) && Math.abs(v - got[i]) <= 2)
            cfg.clipBackgroundToTerminal = false
            ad.config.save()
            await sleep(450)
            const off = { cls: document.body.classList.contains('ad-bg-clip'), vars: vars() }
            const ok = on.cls && matched && !off.cls && off.vars.every(v => v === '')
            add('LY6', '배경 클리핑 (--ad-bg-*)', ok,
                ok ? '켜면 body.ad-bg-clip + 네 변수가 .content.main 좌표와 ±2px 일치, 끄면 클래스·변수 모두 제거'
                    : '클리핑이 좌표를 못 따라온다 (want=.content.main 실좌표, on.vars=내려간 값)',
                { want, on, off })
            cfg.clipBackgroundToTerminal = saved.clipBackgroundToTerminal
            ad.config.save()
            await sleep(300)
        }

        // ============================================================ LY7 레이아웃 off / on
        // 끄면 **순정으로 돌아가야 한다** — 사이드바 숨김, body 클래스 제거,
        // `.content.main` 인라인 스타일 8종 전부 걷힘 (deck.service.ts:1961-1965).
        // 다시 켜면 복원되고, 그 왕복 뒤에도 `xterm.cols == pane.size.columns` 가 유지돼야 한다.
        {
            cfg.sidebarDock = 'right'
            ad.relayout()
            await sleep(200)
            const props = ['flex', 'width', 'max-width', 'height',
                'margin-left', 'margin-right', 'margin-top', 'margin-bottom']
            const m = mainEl()
            cfg.enabled = false
            ad.config.save()
            await sleep(600)
            const off = {
                sidebarDisplay: sidebar().style.display,
                bodyClass: document.body.classList.contains('agentdeck-active'),
                inlineLeft: props.filter(p => m.style.getPropertyValue(p) !== ''),
                bgClip: document.body.classList.contains('ad-bg-clip'),
                viewDisplay: viewEl() ? viewEl().style.display : null,
            }
            cfg.enabled = true
            ad.config.save()
            await sleep(600)
            // 폭 수렴은 fit → session.resize 를 거쳐 몇 프레임 늦다 — 기다렸다가 판정한다
            const colsOk = await waitFor(() => {
                const list = panes()
                return list.length > 0 && list.every(p => p.frontend.xterm.cols === (p.size && p.size.columns))
            }, 4000)
            const list = panes().map(p => ({ title: p.title, cols: p.frontend.xterm.cols, sent: p.size && p.size.columns }))
            const inv = invariant()
            const on = {
                sidebarDisplay: sidebar().style.display,
                bodyClass: document.body.classList.contains('agentdeck-active'),
                inlineWidth: m.style.getPropertyValue('width'),
                sum: inv.sum, win: inv.win,
            }
            const layoutOk = off.sidebarDisplay === 'none' && !off.bodyClass && off.inlineLeft.length === 0
                && !off.bgClip && on.sidebarDisplay !== 'none' && on.bodyClass
                && on.inlineWidth !== '' && inv.ok
            add('LY7', '레이아웃 off / on 왕복', list.length ? (layoutOk && colsOk) : null,
                !list.length ? '터미널 pane 이 없어 폭 회귀(cols)를 못 잰다 — 레이아웃 부분은 ' + (layoutOk ? '통과' : '실패')
                    : (layoutOk && colsOk)
                        ? 'enabled=false 에서 사이드바 숨김 + agentdeck-active 제거 + .content.main 인라인 8종 전부 걷힘,'
                        + ' 다시 켜면 복원되고 xterm.cols == pane.size.columns 유지'
                        : 'off 에서 순정 복귀가 덜 됐거나(inlineLeft) on 에서 폭이 어긋났다',
                { off, on, colsOk, panes: list })
        }

        // ============================================================ LY8 패널 방향 메모 회귀
        // relayout 은 값이 그대로면 DOM 을 건드리지 않는다. 좌↔우만 바뀌면 폭·사이드바·터미널이
        // 전부 그대로여서 조기 return 에 걸려 **패널이 옛 자리에 남았다** (docs/DEVELOPMENT.md,
        // 2026-09-08 실측). 그래서 메모 비교에 viewSide 가 들어갔다 (deck.service.ts:2155-2156).
        // 판정: 폭이 동일한 채(=옛 버그 조건) 패널 좌표가 실제로 움직이는가.
        {
            cfg.sidebarDock = 'right'
            cfg.viewerOpen = true
            ad.config.save()
            await sleep(500)
            const v = viewEl()
            if (!v || v.style.display === 'none') {
                add('LY8', '패널 방향 전환 (메모 회귀)', null,
                    '미리보기 패널이 열리지 않았다 — viewerOpen 을 켰는데도 display=none 이라 판정 불가',
                    { exists: !!v, display: v ? v.style.display : null })
            } else {
                const rows = []
                for (const side of ['left', 'right', 'left']) {
                    cfg.viewerDock = side
                    ad.relayout()
                    await sleep(250)
                    const wr = windowEl().getBoundingClientRect()
                    const vr = viewEl().getBoundingClientRect()
                    const sr = sidebar().getBoundingClientRect()
                    // 사이드바와 같은 쪽이면 사이드바가 창 가장자리(바깥), 패널이 터미널 쪽(안)이다
                    const expectLeft = side === 'left'
                        ? wr.left + (cfg.sidebarDock === 'left' ? sr.width : 0)
                        : wr.right - vr.width - (cfg.sidebarDock === 'right' ? sr.width : 0)
                    const inv = invariant()
                    const overlap = (a, b) => Math.round(a.right) > Math.round(b.left) && Math.round(b.right) > Math.round(a.left)
                    rows.push({
                        side, left: Math.round(vr.left), right: Math.round(vr.right), width: Math.round(vr.width),
                        expectLeft: Math.round(expectLeft),
                        cls: viewEl().classList.contains('ad-view-' + side),
                        overlapsSidebar: overlap(vr, sr), overlapsMain: overlap(vr, mainEl().getBoundingClientRect()),
                        sum: inv.sum, win: inv.win,
                        ok: Math.abs(vr.left - expectLeft) <= 2 && viewEl().classList.contains('ad-view-' + side)
                            && !overlap(vr, sr) && !overlap(vr, mainEl().getBoundingClientRect()) && inv.ok,
                    })
                }
                // 폭이 그대로인데 자리는 바뀌었나 — 이 두 줄이 옛 버그를 정확히 재현하는 조건이다
                const sameWidth = rows[0].width === rows[1].width && rows[1].width === rows[2].width
                const moved = Math.abs(rows[0].left - rows[1].left) > 20 && Math.abs(rows[1].left - rows[2].left) > 20
                const ok = rows.every(r => r.ok) && sameWidth && moved
                add('LY8', '패널 방향 전환 (메모 회귀)', ok,
                    ok ? `좌→우→좌 전환에서 폭은 ${rows[0].width}px 로 동일(=조기 return 조건)한데`
                        + ' 패널 좌표는 매번 반대편으로 옮겨졌다. 겹침 0, 합계=창폭'
                        : (sameWidth && !moved)
                            ? '패널이 움직이지 않았다 — relayout 메모에서 viewSide 가 빠진 그 회귀다'
                            : '좌표/겹침/합계 중 어긋난 것이 있다',
                    { sameWidth, moved, rows })
            }
        }
        // ============================================================ LY9 상/하 도킹 줄 폭 격자
        // 상/하 도킹은 목록을 가로로 흘리므로 줄 폭을 **220px 로 못박아 격자**를 만든다 —
        // 폭이 제목 길이에 따라 달라지면 한 줄에 몇 개가 들어갈지가 세션마다 달라지고,
        // 제목이 바뀔 때마다(cwd 가 바뀌면 바뀐다) 줄들이 좌우로 밀려 짚어 둔 자리를 놓친다.
        //
        // **폭만 재면 회귀를 놓친다**(2026-09-09 실측). `flex: 0 0 220px` 는 있었는데 안 먹고
        // 있었다 — flex 아이템은 `min-width: auto`(초깃값) + `overflow: visible` 이면 자동
        // 최소 크기가 걸려 최소내용폭 밑으로 줄지 않아, 제목이 긴 탭이 384.7px 로 벌어졌다
        // (1700 창에서 한 줄에 7개 대신 4개, 둘째 줄은 반이 잘림). 제목이 짧은 탭은 그때도
        // 220 이 나왔으므로 **`제목이 말줄임됐나` 를 함께 봐야** 판정이 참이 된다.
        {
            cfg.sidebarDock = 'bottom'
            cfg.sidebarHeight = 200
            ad.config.save()
            ad.relayout()
            ad.render()
            await sleep(400)
            let openWhy = null
            for (let i = 0; tabEls().length < 2 && i < 2; i++) {
                const r = await openPlainTab()
                if (!r.ok) { openWhy = r.why; break }
                ad.render()
                await sleep(350)
            }
            const list = listOf()
            if (!list) {
                add('LY9', '상/하 도킹 — 줄 폭 220px 격자', null, '`.ad-list` 가 없다 (사이드바 DOM 이 바뀌었다)', null)
            } else {
                // 스크롤이 남아 있으면 좌표가 밀려 격자 판정이 거짓이 된다 (앞 케이스가 흘려 놨을 수 있다)
                list.scrollTop = 0
                await sleep(120)
                const lcs = getComputedStyle(list)
                const padL = parseFloat(lcs.paddingLeft) || 0
                const padR = parseFloat(lcs.paddingRight) || 0
                const lr = list.getBoundingClientRect()
                const contentLeft = lr.left + padL
                const contentW = list.clientWidth - padL - padR
                // 한 줄에 들어갈 수 있는 칸 수 — 마지막 칸 뒤에는 여백이 붙지 않는다
                const cap = Math.floor((contentW + ROW_GAP) / (ROW_W + ROW_GAP))
                // 목록의 자식을 **순서대로** 훑어 칸 번호를 예측한다. 그룹 헤더는 한 줄을 다
                // 차지하므로(`flex: 0 0 100%`) 그 뒤부터 칸이 0번으로 돌아간다.
                let col = 0
                const cells = []
                for (const child of Array.from(list.children)) {
                    if (child.classList.contains('ad-group-head')) { col = 0; continue }
                    if (!child.classList.contains('ad-tab')) { continue }
                    const r = child.getBoundingClientRect()
                    const ti = child.querySelector('.ad-title')
                    cells.push({
                        expectLeft: Math.round(contentLeft + (col % cap) * (ROW_W + ROW_GAP)),
                        left: Math.round(r.left), right: Math.round(r.right),
                        top: Math.round(r.top), bottom: Math.round(r.bottom),
                        w: Math.round(r.width * 10) / 10,
                        titleClipped: ti ? ti.scrollWidth > ti.clientWidth + 1 : null,
                    })
                    col++
                }
                const widthOk = cells.length > 0 && cells.every(c => Math.abs(c.w - ROW_W) <= 0.5)
                const gridOk = cells.every(c => Math.abs(c.left - c.expectLeft) <= 1)
                // 목록은 `overflow-x: hidden` 이라 오른쪽으로 넘친 줄은 **보이지도 눌리지도 않는다**
                const insideOk = cells.every(c => c.right <= Math.round(contentLeft + contentW) + 1)
                // 첫 줄은 목록 안에 온전히 들어가야 한다 — 세로로 잘리면 상태·경과시간 줄이 사라진다
                const firstTop = cells.length ? cells[0].top : null
                const firstRow = cells.filter(c => c.top === firstTop)
                const listBottom = Math.round(lr.top + list.clientHeight)
                const rowVisible = firstRow.length > 0 && firstRow.every(c => c.bottom <= listBottom + 1)
                const clipped = cells.filter(c => c.titleClipped === true).length
                const perRow = {}
                cells.forEach(c => { perRow[c.top] = (perRow[c.top] || 0) + 1 })
                /**
                 * 화면의 제목이 다 짧으면 회귀가 **나타나지 않는다** (짧은 제목은 고치기 전에도
                 * 220 이 나왔다 — 실측: 첫 줄 `Welcome` 은 220, 긴 경로 줄만 384.7). 그래서 조건을
                 * 운에 맡기지 않고 **긴 제목 줄을 하나 만들어** 같은 목록에 붙여 잰다. 붙였다 떼는
                 * 사이에 `await` 를 두지 않으므로(한 태스크 안) `render()` 가 끼어들 틈이 없고,
                 * 제품 줄의 좌표는 이미 위에서 다 재 뒀다.
                 */
                let longRow = null
                const sample = tabEls()[0]
                if (sample) {
                    const clone = sample.cloneNode(true)
                    const ct = clone.querySelector('.ad-title')
                    if (ct) {
                        // 220px 로는 절대 안 들어가는 길이 (12.5px 글꼴에 120자)
                        ct.textContent = '0123456789'.repeat(12)
                        clone.removeAttribute('data-ad-index')
                        list.appendChild(clone)
                        const cr = clone.getBoundingClientRect()
                        longRow = {
                            w: Math.round(cr.width * 10) / 10,
                            titleClipped: ct.scrollWidth > ct.clientWidth + 1,
                        }
                        clone.remove()
                    }
                }
                // 긴 제목이 폭을 밀어올리지 못하고 말줄임됐나 — 이 줄이 이 케이스의 검출기다
                const longOk = longRow ? (Math.abs(longRow.w - ROW_W) <= 0.5 && longRow.titleClipped === true) : null
                const ok = widthOk && gridOk && insideOk && rowVisible && longOk === true
                const verdict = cells.length < 2 || longRow === null ? null : ok
                add('LY9', '상/하 도킹 — 줄 폭 220px 격자', verdict,
                    cells.length < 2
                        ? '줄이 2개 미만이라 격자를 못 잰다' + (openWhy ? ' (탭을 못 열었다: ' + openWhy + ')' : '')
                        : longRow === null
                            ? '`.ad-title` 이 없어 긴 제목 줄을 만들 수 없다 (줄 DOM 이 바뀌었다)'
                            : ok
                                ? '줄 ' + cells.length + '개가 모두 ' + ROW_W + 'px 이고 한 줄에 ' + cap + '칸 격자에'
                                + ' 1px 오차 없이 앉았다. 120자 제목을 넣은 줄도 ' + longRow.w + 'px 로 머물며 말줄임됐다'
                                + ' (= `min-width: 0` 이 살아 있다. 화면의 긴 제목 줄 ' + clipped + '개도 같다).'
                                + ' 오른쪽으로 넘친 줄 0개, 첫 줄은 목록 안에 온전히 들어간다'
                                : longOk !== true
                                    ? '120자 제목 줄이 ' + longRow.w + 'px 로 벌어졌다 — `flex: 0 0 ' + ROW_W + 'px` 가'
                                    + ' 자동 최소 크기에 밀렸다(`min-width: 0` 확인)'
                                    : !widthOk
                                        ? '화면의 줄 폭이 ' + ROW_W + 'px 이 아니다'
                                        : !gridOk ? '폭은 맞는데 격자 좌표가 어긋났다 (gap 이나 그룹 헤더 처리 변화)'
                                            : !insideOk ? '줄이 목록 오른쪽 밖으로 넘쳤다 (overflow-x: hidden 이라 안 보인다)'
                                                : '첫 줄이 목록 아래로 잘렸다',
                    { cap, contentW: Math.round(contentW), contentLeft: Math.round(contentLeft), listBottom,
                        widthOk, gridOk, insideOk, rowVisible, longRow, longOk,
                        clippedTitles: clipped, perRow, cells, openWhy })
            }
        }

        // ============================================================ LY10 좌/우 도킹은 220 격자가 아니다
        // 220px 격자는 **상/하 도킹만**의 규칙이다(styles.scss 의 `&.ad-dock-top, &.ad-dock-bottom`
        // 블록 안). 누가 그 규칙을 블록 밖으로 내보내면 좌/우 사이드바 줄이 폭을 못 채우거나
        // 사이드바를 넘친다 — 여기서는 줄 폭이 **목록 내용폭과 같다**(폭을 못박지 않았다)를 본다.
        {
            cfg.sidebarDock = 'right'
            // 내용폭이 220 과 겹치면 두 규칙을 구별할 수 없다 — 300 으로 벌려 놓는다
            cfg.sidebarWidth = 300
            ad.config.save()
            ad.relayout()
            ad.render()
            await sleep(400)
            const list = listOf()
            const cells = tabEls().map(el => {
                const r = el.getBoundingClientRect()
                return { w: Math.round(r.width * 10) / 10, top: Math.round(r.top) }
            })
            if (!list || !cells.length) {
                add('LY10', '좌/우 도킹 — 줄 폭은 사이드바 폭', null,
                    !list ? '`.ad-list` 가 없다' : '줄이 없다 (탭 0개)', { cells })
            } else {
                const lcs = getComputedStyle(list)
                const padL = parseFloat(lcs.paddingLeft) || 0
                const padR = parseFloat(lcs.paddingRight) || 0
                const expectW = Math.round((list.clientWidth - padL - padR) * 10) / 10
                const widthOk = cells.every(c => Math.abs(c.w - expectW) <= 1)
                // 세로 도킹은 줄이 세로로 쌓인다 — 두 줄이 같은 top 이면 가로 흘림이 새어 나온 것이다
                const stacked = cells.length < 2 || new Set(cells.map(c => c.top)).size === cells.length
                const ok = widthOk && stacked
                add('LY10', '좌/우 도킹 — 줄 폭은 사이드바 폭', Math.abs(expectW - ROW_W) <= 2 ? null : ok,
                    Math.abs(expectW - ROW_W) <= 2
                        ? '목록 내용폭이 ' + expectW + 'px 로 ' + ROW_W + 'px 과 겹쳐 두 규칙을 구별할 수 없다'
                        : ok
                            ? '줄 ' + cells.length + '개가 목록 내용폭 ' + expectW + 'px 를 그대로 쓰고 세로로 쌓였다'
                            + ' (= ' + ROW_W + 'px 격자가 상/하 도킹 밖으로 새지 않았다)'
                            : !widthOk ? '줄 폭이 목록 내용폭과 다르다 — 상/하 도킹 규칙이 좌/우까지 먹고 있다'
                                : '줄이 세로로 쌓이지 않았다 (가로 흘림이 좌/우 도킹까지 새어 나왔다)',
                    { expectW, rowW: ROW_W, widthOk, stacked, cells })
            }
        }

    } catch (e) {
        // 전제 미충족(LY0)으로 끊긴 것은 실패로 세지 않는다 — 러너가 종료코드 1 을 내면 안 된다
        if (!e || e.message !== PREREQ) {
            add('EXCEPTION', '레이아웃 프로브 실행 중 예외', false, String((e && e.message) || e), null)
        }
    } finally {
        // 원복 — 이 프로브가 만진 것은 전부 사용자가 화면으로 보는 상태다.
        // 순서: 포인터 캡처 스텁 → agentDeck 설정 → Tabby 전역(터미널 색) → save → relayout/render
        try {
            unstubCapture()
        } catch { /* 프로토타입이 봉인돼 있으면 어쩔 수 없다 */ }
        try {
            // LY9 가 격자를 재려고 채운 탭 — 내가 만든 것만, 만든 역순으로 닫는다
            for (const t of madeTabs.slice().reverse()) {
                try { await ad.app.closeTab(t, false) } catch { /* 이미 닫혔다 */ }
            }
            madeTabs.length = 0
        } catch { /* 무시 */ }
        try {
            // 드래그 중 예외로 끊겼을 때 화면에 남을 수 있는 것들
            document.body.classList.remove('ad-resizing')
            document.querySelectorAll('.ad-dock-overlay').forEach(n => n.remove())
        } catch { /* 무시 */ }
        try {
            Object.assign(cfg, saved)
            if (ad.config.store.terminal) {
                if (ad.config.store.terminal.colorScheme && savedTerm.schemeBg) {
                    ad.config.store.terminal.colorScheme.background = savedTerm.schemeBg
                }
                ad.config.store.terminal.background = savedTerm.background
            }
            ad.config.save()
            ad.relayout()
            ad.render()
        } catch { /* 복원 실패는 치명적이지 않다 */ }
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    return JSON.stringify({ summary, results }, null, 1)
})()
