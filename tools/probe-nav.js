/**
 * 사이드바 **키보드 내비게이션** 회귀 프로브 — `tools/run-all.ps1` 의 확장 프로브로 돈다.
 *
 * id 는 `NV1`~`NV17`(`NV15`~`NV17` = `Ctrl+W` 탭 닫기). **왜 별도 파일인가** — 이 기능(핫키 `Ctrl+Shift+L` · ↑↓ · Home/End ·
 * Enter · Esc · 검색창 왕복)이 방금 들어왔는데 회귀 항목이 **한 개도 없다.** 이동 규칙 자체는
 * `test/nav.test.js` 가 순수 함수(`navRowsOf`·`stepNavIndex`)로 전수 검사하므로, 여기서 재는
 * 것은 **실화면에서 그 규칙이 실제로 돌고 부수효과가 없다는 것**이다. 특히 셋이 위험하다:
 *
 *  1) **포커스 ≠ 선택** — ↑↓ 로 `index` 는 움직이는데 `activeTabIndex` 는 그대로여야 한다
 *     (`nav.ts` 머리주석의 그 계약). 줄마다 탭이 바뀌면 지나가는 탭의 출력이 화면을 덮어
 *     "훑어보기" 자체가 불가능해진다. 선택은 Enter 한 지점에서만 일어난다(NV2·NV5).
 *  2) **키가 터미널로 새지 않는다** — 목록이 포커스를 가진 동안 누른 Enter·Shift+Enter·문자키가
 *     pty 로 나가면 남의 세션에 명령이 박힌다. 캡처 단계에 걸린 우리 리스너들
 *     (`claimEnterLabel`·`claimShiftEnterKey`·`claimCtrlVKey`·`guardHomeEndComposition`)이
 *     `isDeckUiKey` 로 비켜 주는 것이 유일한 방어이고, 그것이 깨졌는지는 **바이트로만** 보인다(NV6).
 *  3) **포커스가 터미널일 때 무개입** — 리스너를 `.ad-list` 엘리먼트에 건 것이 그 보증인데
 *     (`wireListKeys` 주석), 누가 document 리스너 + 플래그로 바꾸면 조용히 터미널 입력을 먹는다(NV7).
 *
 * ## 규칙을 베끼지 않는다
 *
 * "어느 줄로 가야 하나" 를 프로브가 계산하면 그것은 `stepNavIndex`(src/nav.ts)의 사본이고,
 * 사본은 낡는다 — `probe-all.js` 의 화면 판정 사본이 낡아 R2·R14 가 거짓 실패한 사고가 진단구를
 * 열게 만들었다. 그래서 두 가지만 쓴다:
 *   - **키는 합성 이벤트로 실제 경로에 태운다** (`.ad-list` 에 리스너가 걸려 있다):
 *     `L.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`
 *   - **상태는 제품에게 묻는다** (`__agentdeck.focusNav()` — mode·index·count·focused·rows·
 *     activeTabIndex·ring·owner·searchVisible·wrap·enabled). 화면 순서의 정답도 제품 몫이다.
 * 그리고 `dispatchEvent` 의 반환값(false = `preventDefault` 가 걸렸다)으로 **그 키를 우리가
 * 먹었는지**까지 본다 — "안 새어나간다" 의 반쪽 증거가 그것이다.
 *
 * ## 되돌리기 (가장 중요한 정리)
 *
 * 이 프로브는 **포커스를 옮긴다.** 목록에 포커스를 남기고 끝나면 뒤 프로브·러너 단계가 키를
 * 쓸 수 없고(모든 키가 사이드바로 간다), 라벨·IME·붙여넣기 검증이 통째로 어긋난다. 그래서
 * finally 에서 `focusNav('off')` 로 터미널에 돌려주고 그 결과를 `cleanup.focusReleased` 에 남긴다.
 * 설정(`keyboardNav`·`keyboardNavWrap`·`enterAsLabel`·
 * `collapsedGroups`·`sortByStatus`) · 검색 필터 · 랩한 `sendInput` · 작업 라벨 · 임시 탭/프로필/
 * 폴더도 모두 되돌린다. 임시 이름은 `probe-group.js` 와 **같은 접두**(`agentdeck-probe-grp` /
 * `ad-grp-`)를 쓴다 — 러너의 GR15(정리 확인)가 그 이름으로 잔여를 찾으므로 내가 흘린 것도
 * 같은 그물에 걸린다.
 *
 * `pass: null` = **판정 불가**(환경이 조건을 못 만듦)이고 실패와 섞어 세지 않는다.
 * "조건을 못 만들었는데 나머지가 통과했다" 를 PASS 로 적는 것이 이 저장소가 가장 경계하는
 * 거짓 초록이다.
 */
(async () => {
    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const sb = () => document.getElementById('agentdeck-sidebar')
    const listEl = () => (sb() ? sb().querySelector('.ad-list') : null)
    const searchEl = () => (sb() ? sb().querySelector('.ad-search-input') : null)
    /** 줄은 **오직** 이 방법으로 찾는다 — "n 번째 줄 = n 번째 탭" 가정이 R16·R19 를 거짓 실패시켰다 */
    const rowOf = i => (listEl() ? listEl().querySelector('.ad-tab[data-ad-index="' + i + '"]') : null)
    /** 링은 목록 안에 **하나만** 있어야 한다 — 여러 개면 어느 줄이 포커스인지 화면이 거짓말한다 */
    const ringCount = () => (listEl() ? listEl().querySelectorAll('.ad-nav-focus').length : 0)
    const headCount = () => (sb() ? sb().querySelectorAll('.ad-group-head').length : 0)
    const tabRowCount = () => (listEl() ? listEl().querySelectorAll('.ad-tab').length : 0)
    const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })

    /** 케이스 이름을 한 곳에만 둔다 — 판정할 때와 `판정 불가`로 채울 때 이름이 갈리지 않게 */
    const CASES = [
        ['NV1', '목록 진입·해제 (focusNav list/off)'],
        ['NV2', '포커스 ≠ 선택 (↑↓ 로 활성 탭이 바뀌지 않는다)'],
        ['NV3', 'Home · End (첫 줄 · 마지막 줄)'],
        ['NV4', '링이 그려진 줄 = focused (mode 가 list 일 때만)'],
        ['NV5', 'Enter 로 비로소 전환 + 키를 터미널에 반납'],
        ['NV6', '키가 터미널로 새지 않는다 (pty 바이트 · 작업 라벨)'],
        ['NV7', '포커스가 터미널일 때 무개입'],
        ['NV8', 'Esc 순서 (필터를 먼저 지우고, 지울 게 없을 때 나간다)'],
        ['NV9', '검색창 ↔ 목록 (↓ · 첫 줄 ↑ · Tab / 검색창 ↑ 는 비가로채기)'],
        ['NV10', '렌더 왕복·필터 숨김에서 포커스 생존'],
        ['NV11', '닫힌 탭은 포커스에서 빠진다'],
        ['NV12', 'keyboardNavWrap 끔/켬 (켜도 맨 위 ↑ 는 검색창)'],
        ['NV13', 'keyboardNav: false 면 진입·검색창 ↓ 가 no-op'],
        ['NV14', '그룹 헤더 Enter = 접기/펴기 (포커스는 헤더에 남는다)'],
        ['NV15', 'Ctrl+W = 활성 탭 닫기 (터미널 포커스)'],
        ['NV16', 'Ctrl+W = 포커스 줄의 탭 닫기 (목록 포커스 / 활성 탭은 그대로)'],
        ['NV17', '게이트 — 끈 설정·입력창에서는 Ctrl+W 를 가로채지 않는다'],
    ]
    const nameOf = id => (CASES.find(c => c[0] === id) || [id, id])[1]
    /** 아직 안 매긴 케이스를 `판정 불가`(pass:null)로 — 실패와 섞지 않는다 */
    const skipCases = (ids, reason, ev) => {
        for (const id of ids) {
            if (!results.some(r => r.id === id)) { add(id, nameOf(id), null, reason, ev || null) }
        }
    }
    const ALL_IDS = CASES.map(c => c[0])
    /** 줄이 2개 이상이어야 "움직였다/끝에서 멈췄다" 를 관찰할 수 있는 케이스들 */
    const MULTI_ROW_IDS = ['NV2', 'NV3', 'NV10', 'NV12']
    /** 검색창이 화면에 있어야 재는 케이스들 (searchBox: false 면 경계가 아예 다르다) */
    const SEARCH_IDS = ['NV8', 'NV9']

    const NO_DIAG = '진단구 __agentdeck.focusNav() 가 없다'
        + ' (낡은 dist 를 재고 있을 수 있다 — npm run build 후 재기동)'

    // ---------------------------------------------------------------- 상태 읽기 / 키 넣기
    /**
     * 지금 키보드 상태 — **제품에게 묻는다.** 인자를 주면 진입/해제까지 시킨다
     * (`list` = `focusList('keep')`, `search` = `focusSearch()`, `off` = `releaseKeyboard()`).
     * 인자 없이 부르면 부수효과가 없다.
     */
    const nav = op => {
        try {
            return ad.focusNav(op)
        } catch (e) {
            return { error: String((e && e.message) || e) }
        }
    }
    /**
     * 키 하나를 **실제 경로로** 넣는다.
     *
     * 돌려주는 `notPrevented` 는 `dispatchEvent` 의 반환값이다 — false 면 누군가
     * `preventDefault` 를 불렀다는 뜻이고, 그것이 곧 "우리가 이 키를 먹었다(터미널로 안 보낸다)".
     * 이 값을 판정에 쓰는 이유: 순서만 맞아도 키가 뒤로 새면 터미널에 글자가 박힌다.
     */
    const press = async (el, k, init, ms) => {
        const code = k.length === 1 ? 'Key' + k.toUpperCase() : k
        const ev = new KeyboardEvent('keydown', Object.assign({
            key: k, code, keyCode: k === 'Enter' ? 13 : 0,
            bubbles: true, cancelable: true,
        }, init || {}))
        const notPrevented = el.dispatchEvent(ev)
        await sleep(ms || 90)
        return { key: k, notPrevented }
    }
    const pressList = (k, init, ms) => press(listEl(), k, init, ms)

    // ---------------------------------------------------------------- pty 바이트 가로채기
    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    const sent = []
    const wrapped = []
    /**
     * 모든 터미널 pane 의 `sendInput` 을 감싼다 — **바이트로 판정하기 위한 것**이다.
     *
     * `tools/README.md` 의 함정: Tabby 는 `onData → sendInput` 으로 이으므로 사람이 xterm 에서
     * 맨 Enter 를 누르면 `0x0D` 가 기록되는 것이 **정상**이다. "우리가 아무것도 안 썼다" 로
     * 판정하면 거짓 실패한다. 그래서 우리 키는 `.ad-list`/`document` 에만 넣고(xterm 경로를
     * 타지 않는다) 판정은 **특정 바이트**(`0x0D` 개행확정 · `0x0A` 줄바꿈)의 유무로 한다.
     */
    const wrapSend = () => {
        for (const p of panes()) {
            if (wrapped.some(w => w.pane === p)) { continue }
            const orig = p.sendInput.bind(p)
            wrapped.push({ pane: p, orig })
            p.sendInput = d => { sent.push(String(d)) }
        }
        return wrapped.length
    }
    const unwrapSend = () => {
        const n = wrapped.length
        for (const w of wrapped) {
            try { w.pane.sendInput = w.orig } catch { /* 탭이 닫혔다 */ }
        }
        wrapped.length = 0
        return n
    }
    const bytesOf = () => sent.join('').split('').map(c => c.charCodeAt(0))
    const hexOf = () => bytesOf().map(b => b.toString(16)).join(',')

    // ---------------------------------------------------------------- 진단 로그 (라벨 경로)
    let nodeFs = null
    try {
        nodeFs = require('fs')
    } catch {
        // nodeIntegration 이 없는 창 — 로그도 임시 폴더도 못 쓴다 (해당 케이스는 판정 불가)
    }
    /**
     * 진단 로그 경로는 **제품에게 묻는다**(`diagPaths()`). `os.homedir()` 로 만들면 실사용
     * Tabby 의 파일을 읽어 "아무 줄도 안 남았다" 로 거짓 실패한다 — 2026-09-09 에 IN9·PR4·PR5
     * 가 한꺼번에 그렇게 뒤집혔다(`tools/README.md`).
     */
    const diagPath = () => {
        try {
            return ad.diagPaths ? ad.diagPaths().diag : null
        } catch {
            return null
        }
    }
    /** 그 문구가 로그에 몇 번 찍혔나 — 못 읽으면 `null`(판정에 쓰지 않는다) */
    const countDiag = needle => {
        const p = diagPath()
        if (!nodeFs || !p) { return null }
        try {
            const text = nodeFs.readFileSync(p, 'utf8')
            let n = 0
            let i = 0
            for (;;) {
                const j = text.indexOf(needle, i)
                if (j < 0) { break }
                n++
                i = j + needle.length
            }
            return n
        } catch {
            return null
        }
    }

    // ---------------------------------------------------------------- 되돌릴 것들
    // finally 가 보려면 try **밖에서** 선언해야 한다 (probe-group.js 의 그 함정과 같다)
    const cfg = ad.config.store.agentDeck
    const saved = {
        keyboardNav: cfg.keyboardNav,
        keyboardNavWrap: cfg.keyboardNavWrap,
        keyboardCloseTab: cfg.keyboardCloseTab,
        enterAsLabel: cfg.enterAsLabel,
        collapsedGroups: (cfg.collapsedGroups || []).slice(),
        sortByStatus: cfg.sortByStatus,
    }
    const origActive = ad.app.activeTab
    /** 라벨은 Enter 경로(`enterAsLabel`)가 건드릴 수 있는 값이다 — 손대면 되돌린다 */
    const origLabels = ad.app.tabs.map(t => {
        let label = null
        try { label = ad.status.get(t).label } catch { /* 상태가 없다 */ }
        return { tab: t, label }
    })
    const madeTabs = []
    const addedProfileIds = []
    const cleanup = {}
    let tmpBase = null
    let tabIndexTouched = false
    let tabIndexBefore = null
    const prevProfileId = ad.config.store.terminal ? ad.config.store.terminal.profile : undefined

    try {
        if (typeof ad.focusNav !== 'function') {
            skipCases(ALL_IDS, NO_DIAG, { hasFocusNav: typeof ad.focusNav })
            throw new Error('ad-nav-prereq')
        }
        if (!sb() || !listEl()) {
            skipCases(ALL_IDS, '사이드바/.ad-list 가 없다 (agentDeck.enabled 확인)',
                { sidebar: !!sb(), list: !!listEl() })
            throw new Error('ad-nav-prereq')
        }

        // 판정 조건을 못박는다 — 기능이 꺼져 있으면(`keyboardNav: false`) 진입 자체가 안 되고,
        // 감기(`keyboardNavWrap`)는 NV12 에서 **일부러** 켠다. 나머지는 기본값으로 잰다.
        cfg.keyboardNav = true
        cfg.keyboardNavWrap = false
        await ad.config.save()
        ad.setFilter('', null)
        ad.render()
        await sleep(250)

        const first = nav()
        if (!first || first.error || typeof first.count !== 'number') {
            skipCases(ALL_IDS, `focusNav() 가 상태를 주지 못했다: ${first ? first.error : 'null'}`, { first })
            throw new Error('ad-nav-prereq')
        }
        if (first.count < 1) {
            skipCases(ALL_IDS, '보이는 줄이 0개다 — 키보드로 훑을 화면이 아니다',
                { count: first.count, tabs: ad.app.tabs.length })
            throw new Error('ad-nav-prereq')
        }
        if (first.count < 2) {
            skipCases(MULTI_ROW_IDS, `보이는 줄이 ${first.count}개다 — 이동·경계를 관찰할 수 없다`,
                { count: first.count, tabs: ad.app.tabs.length })
        }
        if (!first.searchVisible) {
            skipCases(SEARCH_IDS, '검색창이 화면에 없다 (searchBox: false) — 검색 왕복·Esc 순서를 잴 수 없다',
                { searchVisible: first.searchVisible })
        }

        // ============================================================ NV1 진입·해제
        // `focusNav('list'/'off')` 는 핫키(`toggleKeyboardNav`)가 부르는 **같은 함수**를 탄다
        // (`focusList('keep')` / `releaseKeyboard()`). 핫키 자체는 Tabby HotkeysService 를 거쳐야
        // 하는데 CDP 로 그 경로를 태우기 번거로워 제품이 이 문을 열어 뒀다(`focusNav` 독스트링).
        // 여기서 보는 것 셋 — ① 주인이 목록이 됐다 ② 포커스 줄이 생겼다 ③ 링이 하나 그려졌다.
        {
            nav('off')
            await sleep(150)
            const before = nav()
            const l = nav('list')
            await sleep(150)
            const inList = nav()
            const ringN = ringCount()
            const o = nav('off')
            await sleep(200)
            const off = nav()

            const enterOk = inList.mode === 'list' && inList.owner === 'list'
                && !!inList.focused && inList.index >= 0 && !!inList.ring && ringN === 1
            const exitOk = off.mode === 'off' && off.owner !== 'list' && off.owner !== 'search'
                && off.ring === null && ringCount() === 0
            const pass1 = enterOk && exitOk
            add('NV1', nameOf('NV1'), pass1,
                pass1
                    ? `진입하면 키의 주인이 목록이 되고(owner=list, index=${inList.index}) 링이 1개 그려지며,`
                        + ` 해제하면 주인이 터미널 쪽(owner=${off.owner})으로 돌아가고 링이 사라진다`
                    : `진입·해제가 어긋난다 (진입 mode=${inList.mode} owner=${inList.owner}`
                        + ` focused=${JSON.stringify(inList.focused)} 링=${ringN}개`
                        + ` / 해제 mode=${off.mode} owner=${off.owner} ring=${JSON.stringify(off.ring)})`,
                { before, inList, off, ringN, calls: { list: l, off: o } })
        }

        // ============================================================ NV2 포커스 ≠ 선택
        // **이 기능의 핵심 계약이다.** ↑↓ 로 `index` 는 움직이는데 `activeTabIndex` 는 그대로여야
        // 한다 — 줄마다 탭이 바뀌면 그 탭 출력이 화면을 덮어 훑어보기가 불가능해진다(`nav.ts`).
        // 어느 줄로 가는지의 **정확한 산술**은 베끼지 않는다(test/nav.test.js 가 전수로 본다).
        // 여기서는 "아래로 눌렀으면 아래로 갔다(단조 증가)" 와 "선택은 안 움직였다" 만 본다.
        if (!results.some(r => r.id === 'NV2')) {
            nav('list')
            await sleep(150)
            const home = await pressList('Home')
            const a = nav()
            const steps = []
            const downs = []
            const k = Math.min(3, a.count - 1)
            for (let i = 0; i < k; i++) {
                downs.push(await pressList('ArrowDown'))
                const st = nav()
                steps.push({ index: st.index, activeTabIndex: st.activeTabIndex, focused: st.focused })
            }
            const ups = []
            for (let i = 0; i < k; i++) {
                ups.push(await pressList('ArrowUp'))
            }
            const b = nav()

            let increasing = steps.length > 0
            let prev = a.index
            for (const s of steps) {
                if (!(s.index > prev)) { increasing = false }
                prev = s.index
            }
            const activeConst = steps.every(s => s.activeTabIndex === a.activeTabIndex)
            const backOk = b.index === a.index && b.activeTabIndex === a.activeTabIndex
            const consumed = [home].concat(downs, ups).every(r => r.notPrevented === false)
            const pass2 = increasing && activeConst && backOk && consumed
            add('NV2', nameOf('NV2'), pass2,
                pass2
                    ? `↓ ${k}번으로 포커스가 ${a.index}→${steps[steps.length - 1].index} 로 내려갔는데`
                        + ` 활성 탭은 ${a.activeTabIndex} 그대로였고(전 구간), ↑ 로 제자리에 돌아왔다.`
                        + ' 누른 키는 모두 목록이 먹었다(preventDefault) — 터미널로 새지 않았다'
                    : `포커스와 선택이 갈리지 않는다 (내려감=${increasing} 활성불변=${activeConst}`
                        + ` 복귀=${backOk} 키소비=${consumed})`
                        + (activeConst ? '' : ' — ↑↓ 가 탭을 전환시키면 훑어보기가 불가능해진다'),
                { start: a, steps, end: b, keys: { home, downs, ups } })
        }

        // ============================================================ NV3 Home · End
        if (!results.some(r => r.id === 'NV3')) {
            nav('list')
            await sleep(150)
            const kEnd = await pressList('End')
            const e = nav()
            const kHome = await pressList('Home')
            const h = nav()
            const endOk = e.index === e.count - 1 && e.count > 0
            const homeOk = h.index === 0
            const consumed = kEnd.notPrevented === false && kHome.notPrevented === false
            const activeConst = e.activeTabIndex === h.activeTabIndex
            const pass3 = endOk && homeOk && consumed && activeConst
            add('NV3', nameOf('NV3'), pass3,
                pass3
                    ? `End 로 마지막 줄(${e.index}/${e.count - 1}), Home 으로 첫 줄(0) 로 갔고`
                        + ' 그 사이 활성 탭은 바뀌지 않았다'
                    : `Home/End 가 어긋난다 (End→${e.index} (count=${e.count}) Home→${h.index}`
                        + ` 키소비=${consumed} 활성불변=${activeConst})`,
                { end: e, home: h, keys: { kEnd, kHome } })
        }

        // ============================================================ NV4 링 = focused
        // 화면이 상태를 따라왔나 — `focused` 와 **링이 실제로 그려진 줄**(`ring`)을 대조한다.
        // 탭 줄이면 `ring.adIndex` 가 그 `app.tabs` 인덱스여야 하고(줄 찾기의 유일한 근거),
        // 그룹 헤더면 `ad-tab` 이 아니므로 `tab:false`·`adIndex:null` 이다.
        {
            nav('list')
            await sleep(150)
            await pressList('Home')
            const s1 = nav()
            const n1 = ringCount()
            const judgeRing = s => {
                if (!s.focused || !s.ring) { return false }
                return s.focused.kind === 'tab'
                    ? (s.ring.tab === true && s.ring.adIndex === String(s.focused.tabIndex))
                    : (s.ring.tab === false && s.ring.adIndex === null)
            }
            const ok1 = judgeRing(s1) && n1 === 1
            let s2 = null
            let ok2 = null
            let n2 = null
            if (s1.count > 1) {
                await pressList('ArrowDown')
                s2 = nav()
                n2 = ringCount()
                ok2 = judgeRing(s2) && n2 === 1
            }
            nav('off')
            await sleep(200)
            const off = nav()
            const offOk = off.ring === null && ringCount() === 0
            const pass4 = ok1 && offOk && ok2 !== false
            add('NV4', nameOf('NV4'), pass4,
                pass4
                    ? `링이 focused 줄에 정확히 1개 그려졌다 (${JSON.stringify(s1.ring)}`
                        + ` = focused ${JSON.stringify(s1.focused)})`
                        + (ok2 === null ? ' — 줄이 1개라 한 줄에서만 대조' : ' / 한 칸 내려도 링이 따라왔다')
                        + ', 포커스를 놓으면 링이 사라진다(mode!==list 에서는 안 그린다)'
                    : `링과 포커스가 어긋난다 (첫줄=${ok1} (ring=${JSON.stringify(s1.ring)}`
                        + ` focused=${JSON.stringify(s1.focused)} 링개수=${n1})`
                        + ` 두번째줄=${ok2} 해제후=${offOk})`,
                { s1, n1, s2, n2, off })
        }

        // ============================================================ NV5 Enter 로 비로소 전환
        // 포커스와 선택이 만나는 **유일한 지점**이다(`activateNav`). 탭을 골랐으면 이어서 할 일은
        // 그 터미널에 치는 것이므로 키보드도 같이 넘어가야 한다(mode 가 off).
        {
            nav('list')
            await sleep(150)
            await pressList('Home')
            let st = nav()
            const hops = []
            let guard = 0
            const isTarget = s => !!s.focused && s.focused.kind === 'tab'
                && s.focused.tabIndex !== s.activeTabIndex
            while (!isTarget(st) && guard < st.count) {
                await pressList('ArrowDown')
                st = nav()
                hops.push({ index: st.index, focused: st.focused })
                guard++
            }
            if (!isTarget(st)) {
                skipCases(['NV5'], '활성 탭이 아닌 탭 줄을 찾지 못했다 — "전환됐다" 를 관찰할 수 없다',
                    { count: st.count, activeTabIndex: st.activeTabIndex, rows: st.rows, hops })
            } else {
                const want = st.focused.tabIndex
                const wantTab = ad.app.tabs[want]
                const kEnter = await pressList('Enter', { keyCode: 13 }, 500)
                const after = nav()
                const switched = after.activeTabIndex === want && ad.app.activeTab === wantTab
                const released = after.mode === 'off' && after.ring === null
                const pass5 = switched && released && kEnter.notPrevented === false
                add('NV5', nameOf('NV5'), pass5,
                    pass5
                        ? `${want} 번 탭 줄에서 Enter 를 눌렀더니 활성 탭이 그 줄로 갔고(activeTabIndex`
                            + `=${after.activeTabIndex}) 키가 터미널로 반납됐다(mode=off, 링 없음)`
                        : `Enter 전환이 어긋난다 (목표=${want} 결과=${after.activeTabIndex}`
                            + ` 전환=${switched} 반납=${released} (mode=${after.mode}) 키소비=${kEnter.notPrevented === false})`,
                    { want, before: st, after, hops, kEnter })
            }
        }

        // ============================================================ NV6 키가 터미널로 새지 않는다
        // **바이트로 판정한다.** 목록이 포커스를 가진 동안의 Enter·Shift+Enter·문자키가 pty 로
        // 나가면 남의 세션에 명령이 박힌다. 캡처 단계의 우리 리스너들이 `isDeckUiKey` 로 비켜
        // 주는 것이 방어이고(`deck.service.ts:2134`), 그것이 깨지면 Shift+Enter 는 `0x0A` 를,
        // Enter 는 화면을 읽어 **작업 라벨을 엉뚱하게 바꾼다** — 그래서 라벨과 진단줄도 같이 본다.
        {
            const nWrap = wrapSend()
            if (!nWrap) {
                skipCases(['NV6'], '터미널 pane 이 없다 — pty 로 나간 바이트를 잴 수 없다',
                    { panes: panes().length, tabs: ad.app.tabs.length })
            } else {
                const labelsBefore = ad.app.tabs.map(t => ad.status.get(t).label)
                const d0 = countDiag('enter-label')
                sent.length = 0

                nav('list')
                await sleep(150)
                await pressList('Home')
                // ⓐ 맨 Enter — 탭을 고르고 키를 반납한다. `claimEnterLabel`(캡처)이 먼저 도는
                //    자리라, 비켜 주지 않으면 여기서 라벨이 박힌다
                const k1 = await pressList('Enter', { keyCode: 13 }, 350)
                nav('list')
                await sleep(150)
                await pressList('Home')
                // ⓑ Shift+Enter — `claimShiftEnterKey` 가 비켜 주지 않으면 0x0A 가 나간다
                const k2 = await pressList('Enter', { keyCode: 13, shiftKey: true }, 300)
                nav('list')
                await sleep(150)
                // ⓒ 문자키 — 우리가 처리하지 않는 키다. 그래도 pty 로 새면 안 된다
                const k3 = await pressList('a', {}, 250)

                const bytes = bytesOf()
                const hex = hexOf()
                unwrapSend()
                const hasCR = bytes.indexOf(13) >= 0
                const hasLF = bytes.indexOf(10) >= 0
                const labelsAfter = ad.app.tabs.map(t => ad.status.get(t).label)
                const labelOk = sameJson(labelsBefore, labelsAfter)
                const d1 = countDiag('enter-label')
                const diagOk = (d0 === null || d1 === null) ? null : d1 === d0

                const pass6 = !hasCR && !hasLF && labelOk && diagOk !== false
                add('NV6', nameOf('NV6'), pass6,
                    pass6
                        ? `목록 포커스에서 Enter · Shift+Enter · 문자키를 눌러도 pty 로 0x0D/0x0A 가`
                            + ` 나가지 않았고(보낸 바이트 ${bytes.length}개: ${hex || '없음'})`
                            + ` 작업 라벨도 그대로였다`
                            + (diagOk === null
                                ? ' (진단줄 대조는 불가 — 로그를 못 읽었다)'
                                : ` (enter-label 진단줄도 ${d0}→${d1} 로 안 늘었다 = 라벨 경로가 비켜 줬다)`)
                        : `키가 터미널로 샜다 (0x0D=${hasCR} 0x0A=${hasLF} 바이트=[${hex}]`
                            + ` 라벨불변=${labelOk} enter-label진단줄=${d0}→${d1})`
                            + ' — isDeckUiKey 가 캡처 리스너에서 비켜 주는지 볼 것',
                    { bytes, hex, labelsBefore, labelsAfter, diag: { before: d0, after: d1, path: diagPath() },
                        keys: { k1, k2, k3 }, wrappedPanes: nWrap })
            }
        }

        // ============================================================ NV7 터미널 포커스일 때 무개입
        // 리스너를 `.ad-list` **엘리먼트에** 건 것이 "포커스가 없으면 이벤트가 아예 오지 않는다"
        // 의 보증이다(`wireListKeys` 주석). document 리스너 + 플래그로 바꾸면 플래그가 어긋나는
        // 순간 터미널 입력을 먹는다 — 그 회귀를 여기서 잡는다.
        //
        // `enterAsLabel` 을 잠시 끈다: document 로 쏜 Enter 는 **터미널의 Enter** 와 같아서
        // 라벨 경로가 정상적으로 화면을 읽는다(그건 R35 의 몫이다). 여기서 재려는 것은
        // 키보드 내비게이션의 무개입이므로 그 정상 동작을 섞지 않는다.
        {
            cfg.enterAsLabel = false
            await ad.config.save()
            nav('off')
            await sleep(200)
            const b = nav()
            const q0 = searchEl() ? searchEl().value : null
            wrapSend()
            sent.length = 0
            const k1 = await press(document, 'ArrowDown')
            const k2 = await press(document, 'Enter', { keyCode: 13 })
            const k3 = await press(document, 'Escape')
            const a = nav()
            const bytes = bytesOf()
            const hex = hexOf()
            unwrapSend()
            const q1 = searchEl() ? searchEl().value : null

            const stillOff = a.mode === 'off' && a.ring === null
            const nothingMoved = a.index === b.index && a.count === b.count
                && a.activeTabIndex === b.activeTabIndex && sameJson(a.focused, b.focused)
            const filterKept = q1 === q0
            const notClaimed = [k1, k2, k3].every(r => r.notPrevented === true)
            const noBytes = bytes.indexOf(13) < 0 && bytes.indexOf(10) < 0
            const pass7 = stillOff && nothingMoved && filterKept && notClaimed && noBytes
            add('NV7', nameOf('NV7'), pass7,
                pass7
                    ? 'document 에 ↓ · Enter · Esc 를 쏴도 mode 는 off 이고 포커스·활성 탭·검색어가'
                        + ' 하나도 움직이지 않았으며, 세 키 모두 우리가 가로채지 않았다'
                        + ' (preventDefault 없음 = 터미널 몫으로 흘렀다)'
                    : `터미널 포커스인데 개입했다 (mode=${a.mode} 포커스불변=${nothingMoved}`
                        + ` 검색어유지=${filterKept} 비가로채기=${notClaimed} 바이트=[${hex}])`,
                { before: b, after: a, keys: { k1, k2, k3 }, query: { before: q0, after: q1 }, hex })
            cfg.enterAsLabel = saved.enterAsLabel
            await ad.config.save()
        }

        // ============================================================ NV8 Esc 순서
        // **보이는 것부터 되돌린다** — 걸린 검색어/필터를 먼저 지우고, 지울 게 없을 때 나간다.
        // 이 순서는 이 기능 밖에서 이미 약속돼 있다: `✕` 버튼 title 이 `검색·필터 지우기 (Esc)`,
        // 빈 목록 안내가 `Esc 또는 ✕ 로 전체 목록으로 돌아간다` 다(R52 가 그 계약을 본다).
        // 순서가 뒤집히면 좁혀진 목록을 남긴 채 포커스만 빠져 **필터가 감춰진다**.
        if (!results.some(r => r.id === 'NV8')) {
            nav('list')
            await sleep(150)
            await pressList('Home')
            const q = 'zzz-nav-probe'
            ad.setFilter(q, null)
            ad.render()
            await sleep(250)
            const mid = nav()
            const filterOn = searchEl().value === q
                && (ad.groups ? ad.groups().filter.query === q : true)
            const kEsc1 = await pressList('Escape', {}, 300)
            const afterClear = nav()
            const cleared = searchEl().value === ''
                && (ad.groups ? ad.groups().filter.query === '' : true)
            const stayed = afterClear.mode === 'list'
            const kEsc2 = await pressList('Escape', {}, 400)
            const out = nav()
            const exited = out.mode === 'off' && out.ring === null
            const consumed = kEsc1.notPrevented === false && kEsc2.notPrevented === false
            const pass8 = filterOn && cleared && stayed && exited && consumed
            add('NV8', nameOf('NV8'), pass8,
                pass8
                    ? `검색어가 걸린 상태의 첫 Esc 는 필터만 지우고 포커스를 사이드바에 남겼고`
                        + ` (mode=list), 지울 게 없어진 두 번째 Esc 에서 터미널로 나갔다(mode=off)`
                    : `Esc 순서가 어긋난다 (필터걸림=${filterOn} 지워짐=${cleared}`
                        + ` 첫Esc후 mode=${afterClear.mode} 두번째Esc후 mode=${out.mode} 키소비=${consumed})`
                        + ' — 먼저 나가 버리면 좁혀진 목록이 감춰진다(R52 계약)',
                { mid, afterClear, out, keys: { kEsc1, kEsc2 } })
        }

        // ============================================================ NV9 검색창 ↔ 목록
        // 검색창 ↓ = 결과 첫 줄 / 목록 첫 줄 ↑ = 검색창 / Tab·Shift+Tab = 검색창.
        // **검색창의 ↑ 는 일부러 남겨 둔다** — 한 줄 입력에서 커서를 맨 앞으로 보내는 편집
        // 동작이고, 검색창 위에는 갈 곳이 없다(`wireSearch` 주석). 그래서 그 키는
        // `preventDefault` 가 걸리지 않아야 한다 — 여기서 그것까지 본다.
        if (!results.some(r => r.id === 'NV9')) {
            nav('search')
            await sleep(200)
            const inSearch = nav()
            const kDown = await press(searchEl(), 'ArrowDown', {}, 250)
            const toList = nav()
            const kUp = await pressList('ArrowUp', {}, 250)
            const backSearch = nav()
            // 검색창의 ↑ — 가로채지 않아야 한다 (커서 이동은 브라우저 기본 동작)
            const kSearchUp = await press(searchEl(), 'ArrowUp', {}, 200)
            const stillSearch = nav()

            nav('list')
            await sleep(150)
            await pressList('Home')
            const kTab = await pressList('Tab', {}, 250)
            const afterTab = nav()
            nav('list')
            await sleep(150)
            await pressList('Home')
            const kShiftTab = await pressList('Tab', { shiftKey: true }, 250)
            const afterShiftTab = nav()

            const downOk = kDown.notPrevented === false && toList.mode === 'list' && toList.index === 0
            const upOk = kUp.notPrevented === false && backSearch.mode === 'search'
            const searchUpOk = kSearchUp.notPrevented === true && stillSearch.mode === 'search'
            const tabOk = kTab.notPrevented === false && afterTab.mode === 'search'
                && kShiftTab.notPrevented === false && afterShiftTab.mode === 'search'
            const pass9 = inSearch.mode === 'search' && downOk && upOk && searchUpOk && tabOk
            add('NV9', nameOf('NV9'), pass9,
                pass9
                    ? '검색창에서 ↓ 로 결과 첫 줄(index 0)로 들어가고, 첫 줄에서 ↑ 로 검색창으로'
                        + ' 돌아왔다. Tab·Shift+Tab 도 검색창으로 갔고, **검색창의 ↑ 는 가로채지'
                        + ' 않았다**(preventDefault 없음 = 커서를 맨 앞으로 보내는 편집 동작이 살아 있다)'
                    : `검색창↔목록 왕복이 어긋난다 (진입=${inSearch.mode} ↓=${downOk}`
                        + ` 첫줄↑=${upOk} 검색창↑비가로채기=${searchUpOk} Tab=${tabOk})`,
                { inSearch, toList, backSearch, stillSearch, afterTab, afterShiftTab,
                    keys: { kDown, kUp, kSearchUp, kTab, kShiftTab } })
        }

        // ============================================================ NV10 렌더 왕복·필터 숨김 생존
        // 포커스를 DOM 이 아니라 `navFocus`(탭 객체/그룹 키)가 들고 있고, 포커스를 받는 것은
        // 매 렌더에 새로 만들지 않는 `.ad-list` 엘리먼트다(`focusList` 주석). 그래서 렌더를
        // 왕복해도 살아야 한다. **필터로 숨은 줄도 버리지 않는다** — 검색을 지우면 같은 줄로
        // 돌아와야 하기 때문이다(`pruneNavFocus` 주석: 판정 기준은 `app.tabs` 에 있는지 하나뿐).
        if (!results.some(r => r.id === 'NV10')) {
            nav('list')
            await sleep(150)
            await pressList('Home')
            await pressList('ArrowDown')
            const a = nav()
            ad.render()
            await sleep(150)
            ad.render()
            await sleep(250)
            const r = nav()
            const survived = r.mode === 'list' && r.index === a.index && sameJson(r.focused, a.focused)
                && ringCount() === 1

            ad.setFilter('zzz-nav-probe-hide', null)
            ad.render()
            await sleep(300)
            const hid = nav()
            const hiddenKept = sameJson(hid.focused, a.focused) && hid.count < a.count
            ad.setFilter('', null)
            ad.render()
            await sleep(300)
            const back = nav()
            const returned = back.mode === 'list' && back.index === a.index
                && sameJson(back.focused, a.focused)

            const pass10 = survived && hiddenKept && returned
            add('NV10', nameOf('NV10'), pass10,
                pass10
                    ? `render() 를 두 번 왕복해도 mode=list·index=${a.index}·포커스 줄이 그대로였고,`
                        + ` 필터로 줄이 ${a.count}→${hid.count} 개로 줄어도 포커스를 버리지 않아`
                        + ' 검색을 지우자 같은 줄로 돌아왔다'
                    : `렌더/필터에서 포커스가 흔들린다 (렌더왕복=${survived} 숨김중유지=${hiddenKept}`
                        + ` 복귀=${returned} / index ${a.index}→${r.index}→${hid.index}→${back.index})`,
                { a, afterRender: r, hidden: hid, back })
        }

        // ============================================================ NV11 닫힌 탭은 포커스에서 빠진다
        // 닫힌 탭은 영영 돌아오지 않으므로 붙들고 있으면 ↑↓ 가 "없는 줄" 에서 시작한다.
        // 임시 탭을 하나 열어 그 줄로 포커스를 옮긴 뒤 닫는다 — 포커스 이동도 **제품 경로**로
        // 한다(줄 클릭이 `navFocus` 를 그 탭으로 놓는다, `renderTab` 의 click 리스너).
        {
            const btn = sb() ? sb().querySelector('.ad-new') : null
            if (!btn) {
                skipCases(['NV11'], '사이드바 + 새 탭 버튼이 없다 — 닫을 임시 탭을 만들 수 없다', null)
            } else {
                const was = ad.app.tabs.slice()
                btn.click()
                const t0 = Date.now()
                while (ad.app.tabs.length <= was.length && Date.now() - t0 < 9000) {
                    await sleep(250)
                }
                const opened = ad.app.tabs.find(t => was.indexOf(t) < 0)
                if (!opened) {
                    skipCases(['NV11'], '+ 새 탭 을 눌러도 9초 안에 탭이 늘지 않았다',
                        { tabs: ad.app.tabs.length, was: was.length })
                } else {
                    madeTabs.push(opened)
                    ad.render()
                    await sleep(500)
                    const idx = ad.app.tabs.indexOf(opened)
                    const row = rowOf(idx)
                    if (!row) {
                        skipCases(['NV11'], `새 탭(${idx}번)의 줄을 화면에서 못 찾았다`
                            + ' (필터·그룹 접힘 확인)', { idx, rows: tabRowCount() })
                    } else {
                        row.click()
                        await sleep(300)
                        nav('list')
                        await sleep(200)
                        const before = nav()
                        const focusedIsNew = !!before.focused && before.focused.kind === 'tab'
                            && before.focused.tabIndex === idx
                        if (!focusedIsNew) {
                            skipCases(['NV11'], '줄을 클릭했는데 포커스가 그 탭으로 가지 않았다'
                                + ' — 닫힘 정리를 관찰할 준비가 안 됐다',
                            { idx, before })
                        } else {
                            try { await ad.app.closeTab(opened, false) } catch { /* 이미 닫혔다 */ }
                            const i0 = madeTabs.indexOf(opened)
                            if (i0 >= 0) { madeTabs.splice(i0, 1) }
                            await sleep(500)
                            ad.render()
                            await sleep(300)
                            const after = nav()
                            const gone = ad.app.tabs.indexOf(opened) < 0
                            const pass11 = gone && after.focused === null
                            add('NV11', nameOf('NV11'), pass11,
                                pass11
                                    ? `임시 탭(${idx}번) 줄에 포커스를 둔 채 닫았더니 포커스가 비워졌다`
                                        + ' (focused=null) — 없는 줄을 붙들고 있지 않다'
                                    : `닫힌 탭이 포커스에 남았다 (탭제거=${gone}`
                                        + ` focused=${JSON.stringify(after.focused)})`,
                                { idx, before, after })
                        }
                    }
                }
            }
        }

        // ============================================================ NV12 keyboardNavWrap
        // 끄면(기본) 끝에서 **제자리**다 — 감싸면 "맨 아래에 왔다" 는 신호가 사라진다.
        // 켜면 감긴다. 단 **켜도 맨 위의 ↑ 는 검색창**이다(`moveNav` 가 감기보다 이 경계를 먼저
        // 본다): 그 한 칸을 감기에 내주면 검색창으로 돌아갈 키가 아예 없어진다.
        if (!results.some(r => r.id === 'NV12')) {
            if (!nav().searchVisible) {
                skipCases(['NV12'], '검색창이 없어 "감기를 켜도 맨 위 ↑ 는 검색창" 경계를 잴 수 없다', null)
            } else {
                cfg.keyboardNavWrap = false
                await ad.config.save()
                nav('list')
                await sleep(150)
                await pressList('End')
                const bottom = nav()
                await pressList('ArrowDown')
                const stay = nav()
                const stopOk = bottom.wrap === false && bottom.index === bottom.count - 1
                    && stay.index === bottom.index

                cfg.keyboardNavWrap = true
                await ad.config.save()
                nav('list')
                await sleep(150)
                await pressList('End')
                const bottom2 = nav()
                await pressList('ArrowDown')
                const wrappedTo = nav()
                const wrapOk = wrappedTo.wrap === true && bottom2.index === bottom2.count - 1
                    && wrappedTo.index === 0

                await pressList('Home')
                await pressList('ArrowUp', {}, 250)
                const top = nav()
                const exitOk = top.mode === 'search'

                cfg.keyboardNavWrap = false
                await ad.config.save()
                ad.render()
                await sleep(150)

                const pass12 = stopOk && wrapOk && exitOk
                add('NV12', nameOf('NV12'), pass12,
                    pass12
                        ? `끄면 마지막 줄(${bottom.index})에서 ↓ 를 눌러도 제자리였고, 켜면 첫 줄(0)로`
                            + ' 감겼다. 켠 상태에서도 맨 위의 ↑ 는 검색창으로 나갔다(mode=search)'
                        : `감기 경계가 어긋난다 (끔:멈춤=${stopOk} (${bottom.index}→${stay.index})`
                            + ` 켬:감김=${wrapOk} (${bottom2.index}→${wrappedTo.index})`
                            + ` 켠상태 맨위↑=${top.mode} (검색창이어야 한다))`,
                    { off: { bottom, stay }, on: { bottom2, wrappedTo }, top })
            }
        }

        // ============================================================ NV13 keyboardNav: false
        // 끄면 진입 자체를 하지 않는다(`navReady`). **`tabindex` 를 진입 함수가 붙이는 것**이
        // 그 설계의 핵심이다 — 배선 때 붙여 두면 기능을 끈 사람이 목록 빈 자리를 클릭했을 때
        // 키가 사이드바에 갇힌다(`focusList` 주석). 그래서 "한 번도 진입하지 않은 상태" 를
        // 만들려고 앞 케이스가 붙여 둔 `tabindex` 를 걷고 재고, finally 에서 되돌린다.
        {
            nav('off')
            await sleep(200)
            tabIndexBefore = listEl().getAttribute('tabindex')
            listEl().removeAttribute('tabindex')
            tabIndexTouched = true
            cfg.keyboardNav = false
            await ad.config.save()
            ad.render()
            await sleep(200)

            const call = nav('list')
            await sleep(200)
            const afterList = nav()
            const noEnter = afterList.mode === 'off' && afterList.enabled === false
                && listEl().getAttribute('tabindex') === null
                && document.activeElement !== listEl()
                && afterList.ring === null

            let searchNoop = null
            let kSearchDown = null
            if (afterList.searchVisible) {
                nav('search')
                await sleep(200)
                kSearchDown = await press(searchEl(), 'ArrowDown', {}, 250)
                const st = nav()
                searchNoop = kSearchDown.notPrevented === true && st.mode === 'search'
            }

            const b = nav()
            const kList = await press(listEl(), 'ArrowDown', {}, 200)
            const afterKey = nav()
            const keyNoop = kList.notPrevented === true && afterKey.index === b.index
                && sameJson(afterKey.focused, b.focused)

            cfg.keyboardNav = true
            await ad.config.save()
            if (tabIndexBefore !== null) { listEl().setAttribute('tabindex', tabIndexBefore) }
            tabIndexTouched = false
            // 여기서 이미 되돌렸다는 것을 정리 보고에도 남긴다 — finally 의 안전망은 이 케이스가
            // 도중에 멈춘 판에서만 돌므로, 정상 판에서는 `cleanup` 에 아무 흔적이 없어진다
            cleanup.tabIndexRestored = listEl().getAttribute('tabindex')
            ad.render()
            await sleep(150)

            const pass13 = noEnter && keyNoop && searchNoop !== false
            add('NV13', nameOf('NV13'), pass13,
                pass13
                    ? '끈 상태에서 진입을 시켜도 목록이 포커스를 받지 않았고(tabindex 도 안 붙었다)'
                        + ' 목록에 직접 쏜 ↓ 도 no-op 이었다'
                        + (searchNoop === null
                            ? ' (검색창이 없어 검색창 ↓ 는 못 쟀다)'
                            : ' — 검색창 ↓ 도 가로채지 않고 그대로 흘렸다')
                    : `끈 상태인데 반응한다 (진입막힘=${noEnter} (mode=${afterList.mode}`
                        + ` enabled=${afterList.enabled} tabindex=${listEl().getAttribute('tabindex')})`
                        + ` 검색창↓no-op=${searchNoop} 목록키no-op=${keyNoop})`,
                { call, afterList, searchNoop, keyNoop, keys: { kSearchDown, kList },
                    tabIndexBefore })
        }

        // ==================================================================== NV14 그룹 헤더 Enter
        // 헤더에서 Enter 는 접기/펴기이고 **포커스는 헤더에 남는다** — 접었다 펴 보는 것은 아직
        // 목록을 훑는 중이라 키를 반납하지 않는다(`activateNav`). 접힌 그룹은 줄이 사라진다.
        //
        // 그 화면을 만드는 방법은 `probe-group.js` GR6~ / `probe-reorder.js` RO6~ 과 **같다**:
        // 그룹 키의 원천인 `cwdCache` 는 탭 출력이 흐를 때 `touchCwd` 가 채우므로 프로브가 심을
        // 수 없다. 그래서 cwd 가 다른 임시 폴더에서 탭을 실제로 띄운다. 이름은 그 프로브들과 같은
        // 접두를 쓴다 — 러너의 GR15(정리 확인)가 그 이름으로 잔여를 찾는다.
        if (!nodeFs) {
            skipCases(['NV14'], 'renderer 에서 require("fs") 를 못 잡았다 — cwd 가 다른 임시 폴더를'
                + ' 만들 수 없다 (그룹 헤더 화면 불가)', null)
        } else {
            let dirs = null
            try {
                const os = require('os')
                const path = require('path')
                // realpath 로 시작한다 — pty 쪽이 realpath 를 한 번 더 걸어서 원본이 링크면
                // 그룹 키와 폴더명이 어긋난다 (probe-group.js 와 같은 이유)
                tmpBase = nodeFs.mkdtempSync(path.join(nodeFs.realpathSync(os.tmpdir()), 'ad-grp-nv-'))
                dirs = { a: path.join(tmpBase, 'aaa'), z: path.join(tmpBase, 'zzz') }
                nodeFs.mkdirSync(dirs.a)
                nodeFs.mkdirSync(dirs.z)
                // 그룹 경계는 자동 탐지(`project-root.ts`)라 마커를 심어야 갈림이 확정된다
                // — 없으면 "위쪽에 우연히 `.git` 이 없다" 에 기대게 된다 (probe-group.js 와 같은 이유)
                nodeFs.mkdirSync(path.join(dirs.a, '.git'))
                nodeFs.mkdirSync(path.join(dirs.z, '.git'))
            } catch (e) {
                dirs = null
                skipCases(['NV14'], `임시 폴더를 만들지 못했다: ${String((e && e.message) || e)}`, { tmpBase })
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

                const rz = await openTabAt(dirs.z, 'local:agentdeck-probe-grp-nv-z')
                const ra = rz.ok
                    ? await openTabAt(dirs.a, 'local:agentdeck-probe-grp-nv-a')
                    : { ok: false, why: rz.why }
                if (!rz.ok || !ra.ok) {
                    skipCases(['NV14'], `cwd 가 다른 탭을 못 열었다 — ${rz.ok ? ra.why : rz.why}`,
                        { tabs: ad.app.tabs.length, dirs })
                } else {
                    /** 제품 계산과 화면을 층으로 나눠 본다 — `probe-group.js` 가 같은 이유로 나눴다 */
                    const look = () => {
                        let g = null
                        try { g = ad.groups ? ad.groups() : null } catch { g = null }
                        if (!g) { return null }
                        const iz = ad.app.tabs.indexOf(rz.tab)
                        const ia = ad.app.tabs.indexOf(ra.tab)
                        const gz = g.plan.find(p => p.tabIndexes.indexOf(iz) >= 0) || null
                        const ga = g.plan.find(p => p.tabIndexes.indexOf(ia) >= 0) || null
                        return {
                            g, iz, ia, gz, ga,
                            withHeads: !!g.withHeads,
                            split: !!(gz && ga && gz !== ga),
                            heads: headCount(),
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
                        skipCases(['NV14'], '진단구 __agentdeck.groups() 가 없다 (낡은 dist)', lkDump)
                    } else if (!(lk.withHeads && lk.split && lk.heads > 1 && lk.rowsThere)) {
                        // 헤더 있는 화면이 안 만들어졌다 = **이 케이스의 전제 미충족**.
                        // 그룹핑 자체의 판정은 GR6~GR14 몫이라 여기서는 실패로 세지 않는다
                        skipCases(['NV14'],
                            `다중 그룹(헤더) 화면을 만들지 못했다 (제품 헤더=${lk.withHeads}`
                                + ` 그룹분리=${lk.split} 화면헤더=${lk.heads}개 두줄존재=${lk.rowsThere},`
                                + ` ${waitedMs}ms 대기) — 그룹 계산·cwd 쪽 판정은 GR6~GR14 가 한다`, lkDump)
                    } else {
                        // 헤더 줄까지 키로 내려간다 — 줄 목록의 정답은 제품이 준다(`rows`)
                        nav('list')
                        await sleep(200)
                        await pressList('Home')
                        let st = nav()
                        let hops = 0
                        while (!(st.focused && st.focused.kind === 'head') && hops < st.count) {
                            await pressList('ArrowDown')
                            st = nav()
                            hops++
                        }
                        if (!(st.focused && st.focused.kind === 'head')) {
                            skipCases(['NV14'], `줄 ${st.count}개를 다 훑어도 그룹 헤더 줄에 닿지 못했다`,
                                Object.assign({ rows: st.rows, hops }, lkDump))
                        } else {
                            const key = st.focused.key
                            const planOf = k => {
                                let g = null
                                try { g = ad.groups() } catch { g = null }
                                return g ? (g.plan.find(p => p.key === k) || null) : null
                            }
                            const beforePlan = planOf(key)
                            const rowsBefore = tabRowCount()
                            const countBefore = st.count
                            wrapSend()
                            sent.length = 0

                            // ⓐ 접기 — 줄이 사라지고, 포커스는 헤더에 남고, 키는 반납하지 않는다
                            const k1 = await pressList('Enter', { keyCode: 13 }, 400)
                            const folded = nav()
                            const foldedPlan = planOf(key)
                            const rowsFolded = tabRowCount()
                            const foldOk = !!foldedPlan && foldedPlan.collapsed === true
                                && folded.count < countBefore
                                && rowsFolded < rowsBefore
                                && !!folded.focused && folded.focused.kind === 'head'
                                && folded.focused.key === key
                                && folded.mode === 'list' && !!folded.ring
                                && k1.notPrevented === false

                            // ⓑ 다시 펴기 — 줄이 돌아온다
                            const k2 = await pressList('Enter', { keyCode: 13 }, 400)
                            const open = nav()
                            const openPlan = planOf(key)
                            const rowsOpen = tabRowCount()
                            const openOk = !!openPlan && openPlan.collapsed === false
                                && open.count === countBefore && rowsOpen === rowsBefore
                                && !!open.focused && open.focused.kind === 'head' && open.focused.key === key
                                && open.mode === 'list'
                                && k2.notPrevented === false

                            const bytes = bytesOf()
                            const hex = hexOf()
                            unwrapSend()
                            const noBytes = bytes.indexOf(13) < 0 && bytes.indexOf(10) < 0

                            const pass14 = foldOk && openOk && noBytes
                            add('NV14', nameOf('NV14'), pass14,
                                pass14
                                    ? `헤더 ${lk.heads}개인 화면에서 헤더(${key}) 줄의 Enter 가 접기/펴기로`
                                        + ` 동작했다 — 줄 ${countBefore}→${folded.count}→${open.count} 개,`
                                        + ' 접힌 동안 그 그룹의 탭 줄이 화면에서 사라졌고, 포커스는 헤더에'
                                        + ' 남고 키도 반납하지 않았다(mode=list, pty 바이트 없음)'
                                    : `헤더 Enter 가 어긋난다 (접기=${foldOk} 펴기=${openOk}`
                                        + ` 줄 ${countBefore}→${folded.count}→${open.count}`
                                        + ` 접힘(제품)=${foldedPlan ? foldedPlan.collapsed : null}`
                                        + `→${openPlan ? openPlan.collapsed : null}`
                                        + ` mode=${folded.mode} 바이트=[${hex}])`,
                                Object.assign({
                                    key, hops, countBefore, folded, open,
                                    plan: { before: beforePlan, folded: foldedPlan, open: openPlan },
                                    domRows: { before: rowsBefore, folded: rowsFolded, open: rowsOpen },
                                    hex, keys: { k1, k2 },
                                }, lkDump))
                        }
                    }
                }
            }
        }
        // ============================================================ NV15~NV17 Ctrl+W 로 탭 닫기
        // 이 키는 **가로채는 것 자체가 비용**이다 — 셸·에이전트 CLI 에서 `Ctrl+W` 는 앞 단어
        // 지우기(0x17)라 우리가 먹어 놓고 아무 일도 안 하면 그게 곧 회귀다. 그래서 세 가지를
        // 나눠 잰다: 먹었을 때 실제로 닫히는가(NV15·NV16), 안 먹어야 할 자리에서 흘리는가(NV17).
        //
        // **NV17 을 먼저** 돌린다 — 게이트가 깨져 있으면 그 판이 탭을 닫아버려서, 뒤 케이스가
        // "이미 닫힌 탭" 을 재게 된다(원인이 뒤섞인다). 게이트 판에서는 탭이 살아 있어야 한다.
        {
            const CW_IDS = ['NV15', 'NV16', 'NV17']
            const btn = sb() ? sb().querySelector('.ad-new') : null
            if (!btn) {
                skipCases(CW_IDS, '사이드바 + 새 탭 버튼이 없다 — 닫아 볼 임시 탭을 만들 수 없다', null)
            } else {
                /** 임시 탭 하나를 **제품 경로로** 연다 (NV11 과 같은 방식) */
                const openTmp = async () => {
                    const was = ad.app.tabs.slice()
                    btn.click()
                    const t0 = Date.now()
                    while (ad.app.tabs.length <= was.length && Date.now() - t0 < 9000) {
                        await sleep(250)
                    }
                    const opened = ad.app.tabs.find(t => was.indexOf(t) < 0) || null
                    if (opened) { madeTabs.push(opened) }
                    return opened
                }
                /** 이 탭은 케이스가 스스로 닫았다 — finally 의 정리 목록에서 뺀다 */
                const forget = tab => {
                    const i = madeTabs.indexOf(tab)
                    if (i >= 0) { madeTabs.splice(i, 1) }
                }
                /** 닫힘은 비동기다(`closeTab` → canClose → destroy) — 사라질 때까지 기다린다 */
                const waitGone = async tab => {
                    const t0 = Date.now()
                    while (ad.app.tabs.indexOf(tab) >= 0 && Date.now() - t0 < 5000) {
                        await sleep(200)
                    }
                    return ad.app.tabs.indexOf(tab) < 0
                }
                const ctrlW = el => press(el, 'w', { ctrlKey: true }, 250)

                cfg.keyboardNav = true
                cfg.keyboardCloseTab = true
                await ad.config.save()

                // ── NV17 게이트 세 판 (탭이 살아 있어야 통과다)
                const gateTab = await openTmp()
                if (!gateTab) {
                    skipCases(CW_IDS, '+ 새 탭 을 눌러도 9초 안에 탭이 늘지 않았다',
                        { tabs: ad.app.tabs.length })
                } else {
                    ad.app.selectTab(gateTab)
                    nav('off')
                    await sleep(250)
                    const n0 = ad.app.tabs.length

                    cfg.keyboardCloseTab = false
                    await ad.config.save()
                    const gOff = await ctrlW(document)
                    const aliveOff = ad.app.tabs.indexOf(gateTab) >= 0

                    cfg.keyboardCloseTab = true
                    cfg.keyboardNav = false
                    await ad.config.save()
                    const gNav = await ctrlW(document)
                    const aliveNav = ad.app.tabs.indexOf(gateTab) >= 0

                    cfg.keyboardNav = true
                    await ad.config.save()
                    // 보통 입력 필드(검색창)에서는 켜져 있어도 손대지 않는다 (`isPlainInput`)
                    const sEl = searchEl()
                    const gInput = sEl ? await ctrlW(sEl) : null
                    const aliveInput = ad.app.tabs.indexOf(gateTab) >= 0
                    if (sEl) { try { sEl.blur() } catch { /* 무시 */ } }
                    nav('off')
                    await sleep(200)

                    const n1 = ad.app.tabs.length
                    const pass17 = gOff.notPrevented === true && aliveOff
                        && gNav.notPrevented === true && aliveNav
                        && (gInput === null || (gInput.notPrevented === true && aliveInput))
                        && n1 === n0
                    add('NV17', nameOf('NV17'), pass17,
                        pass17
                            ? 'keyboardCloseTab: false · keyboardNav: false · 검색창 세 자리에서'
                                + ` Ctrl+W 가 preventDefault 없이 흘렀고 탭 수도 ${n0} 그대로였다`
                                + ' — 끈 사람의 터미널에서 앞 단어 지우기가 살아 있다'
                                + (gInput === null ? ' (검색창은 화면에 없어 뺐다)' : '')
                            : `게이트가 샌다 (closeTab끔: 흘림=${gOff.notPrevented} 생존=${aliveOff} /`
                                + ` keyboardNav끔: 흘림=${gNav.notPrevented} 생존=${aliveNav} /`
                                + ` 검색창: 흘림=${gInput ? gInput.notPrevented : 'n/a'} 생존=${aliveInput}`
                                + ` / 탭 ${n0}→${n1})`,
                        { keys: { gOff, gNav, gInput }, tabs: { before: n0, after: n1 } })

                    // ── NV15 터미널 포커스 — 활성 탭이 닫힌다
                    const before15 = ad.app.tabs.length
                    ad.app.selectTab(gateTab)
                    nav('off')
                    await sleep(250)
                    const activeWas = ad.app.activeTab === gateTab
                    const k15 = await ctrlW(document)
                    const closed15 = await waitGone(gateTab)
                    if (closed15) { forget(gateTab) }
                    const after15 = ad.app.tabs.length
                    const pass15 = activeWas && k15.notPrevented === false && closed15
                        && after15 === before15 - 1
                    add('NV15', nameOf('NV15'), pass15,
                        pass15
                            ? `터미널 포커스에서 Ctrl+W 를 쏘자 활성 탭이 닫혔다 (탭 ${before15}→${after15},`
                                + ' preventDefault 걸림 = 터미널로 흘리지 않았다)'
                            : `활성 탭이 안 닫힌다 (활성이었나=${activeWas} 가로챔=${k15.notPrevented === false}`
                                + ` 닫힘=${closed15} 탭 ${before15}→${after15})`,
                        { key: k15, tabs: { before: before15, after: after15 } })

                    // ── NV16 목록 포커스 — **포커스 줄**의 탭이 닫히고 활성 탭은 그대로다
                    const rowTab = await openTmp()
                    if (!rowTab) {
                        skipCases(['NV16'], '두 번째 임시 탭을 못 열었다', { tabs: ad.app.tabs.length })
                    } else {
                        ad.render()
                        await sleep(400)
                        const idx = ad.app.tabs.indexOf(rowTab)
                        const row = rowOf(idx)
                        // 포커스는 제품 경로로 옮긴다 — 줄 클릭이 `navFocus` 를 그 탭에 놓는다
                        if (row) { row.click() }
                        await sleep(300)
                        // 활성 탭은 **다른 탭**으로 돌려놓는다: "포커스 줄 ≠ 활성 탭" 이어야
                        // 어느 쪽이 닫혔는지 갈린다 (둘이 같으면 이 케이스가 NV15 의 사본이 된다)
                        const other = ad.app.tabs.find(t => t !== rowTab) || null
                        if (other) { ad.app.selectTab(other) }
                        nav('list')
                        await sleep(250)
                        const b16 = nav()
                        const focusIsRow = !!b16.focused && b16.focused.kind === 'tab'
                            && b16.focused.tabIndex === ad.app.tabs.indexOf(rowTab)
                        const activeIsOther = ad.app.activeTab === other && other !== null
                        if (!row || !focusIsRow || !activeIsOther) {
                            skipCases(['NV16'], '포커스 줄 ≠ 활성 탭 상태를 못 만들었다'
                                + ` (줄=${!!row} 포커스=${focusIsRow} 활성분리=${activeIsOther})`,
                            { idx, before: b16 })
                        } else {
                            const before16 = ad.app.tabs.length
                            const k16 = await ctrlW(listEl())
                            const closed16 = await waitGone(rowTab)
                            if (closed16) { forget(rowTab) }
                            const otherAlive = ad.app.tabs.indexOf(other) >= 0
                            const after16 = ad.app.tabs.length
                            const pass16 = k16.notPrevented === false && closed16 && otherAlive
                                && after16 === before16 - 1
                            add('NV16', nameOf('NV16'), pass16,
                                pass16
                                    ? '목록이 키보드를 가진 상태에서 Ctrl+W 가 **포커스 줄의 탭**을 닫았고'
                                        + ` 활성 탭은 살아 있다 (탭 ${before16}→${after16})`
                                    : `포커스 줄이 아니라 엉뚱한 것이 닫혔다 (가로챔=${k16.notPrevented === false}`
                                        + ` 포커스탭닫힘=${closed16} 활성탭생존=${otherAlive}`
                                        + ` 탭 ${before16}→${after16})`,
                                { key: k16, idx, before: b16, tabs: { before: before16, after: after16 } })
                        }
                        nav('off')
                        await sleep(150)
                    }
                }
            }
        }
    } catch (e) {
        if (String((e && e.message) || e) !== 'ad-nav-prereq') {
            add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
        }
        // 예외가 났어도 **안 매긴 케이스는 판정 불가로 채운다** — 결과에서 통째로 빠지면
        // 요약만 조용히 짧아져 "그 케이스는 재지도 않았다" 를 아무도 모른다
        skipCases(ALL_IDS, `프로브가 도중에 멈췄다: ${String((e && e.message) || e)}`, null)
    } finally {
        // 안전망 — 흐름이 어떤 이유로 그 케이스에 닿지 못했으면 `판정 불가`로 남긴다
        // (예외 판은 catch 가 더 구체적인 사유로 이미 채운다 — 여기서 덮지 않는다)
        skipCases(ALL_IDS, '프로브 흐름이 이 케이스에 닿지 못했다 (앞 단계의 사유를 볼 것)', null)

        // ---------------------------------------------------------------- 정리
        // **포커스 되돌리기가 이 프로브의 가장 중요한 정리다.** 목록에 포커스를 남기면 뒤
        // 프로브·러너 단계의 모든 키가 사이드바로 가고 라벨·IME·붙여넣기 검증이 어긋난다.
        cleanup.sendInputRestored = unwrapSend()

        // 임시 탭을 먼저 닫는다 (프로필/폴더 정리보다 앞이어야 깨끗하다)
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

        // 진입 함수가 붙이는 `tabindex` 를 우리가 걷었으면 되돌린다 (NV13)
        if (tabIndexTouched) {
            try {
                if (tabIndexBefore === null) {
                    listEl().removeAttribute('tabindex')
                } else {
                    listEl().setAttribute('tabindex', tabIndexBefore)
                }
                cleanup.tabIndexRestored = listEl().getAttribute('tabindex')
            } catch (e) {
                cleanup.tabIndexRestored = String((e && e.message) || e)
            }
        }

        // 라벨은 Enter 경로가 건드릴 수 있는 값이다 — 바뀌었으면 되돌린다
        const relabeled = []
        for (const rec of origLabels) {
            if (ad.app.tabs.indexOf(rec.tab) < 0 || rec.label === null) { continue }
            try {
                const st = ad.status.get(rec.tab)
                if (st.label !== rec.label) {
                    relabeled.push({ from: st.label, to: rec.label })
                    st.label = rec.label
                }
            } catch { /* 무시 */ }
        }
        cleanup.labelsRestored = relabeled

        Object.assign(cfg, saved)
        try { await ad.config.save() } catch { /* 무시 */ }
        cleanup.configRestored = {
            keyboardNav: cfg.keyboardNav,
            keyboardNavWrap: cfg.keyboardNavWrap,
            keyboardCloseTab: cfg.keyboardCloseTab,
            enterAsLabel: cfg.enterAsLabel,
            collapsedGroups: (cfg.collapsedGroups || []).slice(),
            sortByStatus: cfg.sortByStatus,
        }
        try { ad.setFilter('', null) } catch { /* 무시 */ }
        cleanup.filtersCleared = !!searchEl() && searchEl().value === ''
        try { ad.render() } catch { /* 무시 */ }

        if (origActive && ad.app.tabs.indexOf(origActive) >= 0) {
            try { ad.app.selectTab(origActive) } catch { /* 무시 */ }
        }
        cleanup.activeRestored = ad.app.activeTab === origActive
        // **맨 마지막에** 키를 터미널로 돌려준다 (selectTab 이 포커스를 옮기므로 그 뒤여야 한다)
        try { nav('off') } catch { /* 무시 */ }
        await sleep(250)
        const endState = nav()
        cleanup.focusReleased = endState.mode === 'off'
        cleanup.endMode = endState.mode
        cleanup.endOwner = endState.owner
        cleanup.ringLeft = ringCount()

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
