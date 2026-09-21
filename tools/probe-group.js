/**
 * 세션 그룹핑(0.7.0~0.8.0) 회귀 프로브 — `tools/run-all.ps1` 의 확장 프로브로 돈다.
 *
 * id 는 `GR1`~`GR16`. 왜 별도 파일인가 — 그룹핑은 **사이드바 렌더 순서를 바꿀 수 있는** 유일한
 * 기능이라, 다른 항목(배지·상태)이 "n 번째 줄 = n 번째 탭" 을 가정하면 조용히 거짓 판정이 난다.
 * 실제로 2026-09-08 에 R16·R19 가 그 가정으로 다른 탭의 배지를 읽어 FAIL 이 났다.
 *
 *  - `GR1`~`GR5`: 그룹이 **하나뿐인** 화면 — 순서 유지·줄 식별자·낡은 접힘 키·끈 경로·줄 구성요소
 *  - `GR6`~`GR16`: 그룹이 **둘 이상인** 화면 — 헤더 등장·클릭 접기/펴기·접힘 저장(폴딩 키·디스크)
 *    ·접힌 그룹의 개수·그룹 정렬·기타 맨 뒤·줄 구성요소(다중판)
 *
 * ## 규칙을 다시 적지 않는다 (2026-09-09 개정)
 *
 * 정렬(라벨 사전순·대소문자 무시)·`기타` 를 맨 뒤로·키 폴딩은 **제품 규칙**이다. 검증 도구가
 * 그것을 사본으로 들고 있으면 그 사본이 낡는다 — `tools/probe-all.js` 의 화면 판정 사본이
 * 낡아 R2·R14 가 거짓 실패한 사고가 `__agentdeck.judge()`·`profiles()` 를 열게 만들었다.
 * 그래서 "제품이 무엇을 계산했나" 는 오직 진단구 `__agentdeck.groups()`(`deck.service.ts:472`)
 * 에서 받는다:
 *   - `list[]`   = `groupsFor()` 결과 그대로. **정렬·`기타` 맨 뒤·접힘 판정이 이미 적용**돼 있다
 *   - `fold(k)`  = 제품의 `foldGroupKey`. 프로브는 소문자화를 흉내내지 않는다
 *   - `cwdCache[]` = 탭별 작업 폴더 캐시 = 그룹 키의 원천
 *
 * ## 그래도 DOM 을 본다
 *
 * 진단구는 "제품이 무엇을 계산했나" 만 말하고 **"화면에 그대로 그려졌나" 는 말하지 않는다.**
 * 이 프로브의 값어치는 둘을 대조하는 것이다 — 모든 케이스가 `list[].tabIndexes` 와 실제
 * `.ad-tab[data-ad-index]` 배치, `list[].collapsed` 와 헤더의 `collapsed` 클래스·사라진 줄,
 * 헤더 개수 칩과 `tabIndexes.length` 를 서로 맞춰 본다. 한쪽만 보는 판정으로 후퇴하지 않는다.
 *
 * DOM 섹션과 제품 그룹을 맞추는 **조인 키는 라벨**이다. 순서로 맞추면 "순서가 어긋났다"(GR12)를
 * 아예 검사할 수 없고, 탭 인덱스로 맞추면 **접힌 그룹**은 줄이 없어 맞출 수 없다. 라벨은
 * `groupLabelOf` 가 그룹마다 유일해지도록 만들고(겹치면 상위를 붙인다) 제품이 `.ad-group-label`
 * 에 textContent 로 그린다.
 *
 * cwd 는 `cwdCache`(탭 출력이 흐를 때 `touchCwd` 가 채움)만 보므로 프로브가 임의로 심을 수 없다.
 * GR6~ 는 그래서 **cwd 가 다른 임시 폴더에서 탭을 실제로 띄워** 다중 그룹 화면을 만든다
 * (캐시 직접 주입은 배선을 안 태우므로 회귀가 되지 못한다). 만든 탭·프로필·폴더는 finally 에서 되돌린다.
 *
 * `pass:null` = **판정 불가**(환경이 조건을 못 만듦)이고 실패와 섞어 세지 않는다.
 * 진단구가 없는 낡은 dist 에서도 예외로 죽지 않고 전 케이스를 `판정 불가`로 떨어뜨린다 —
 * 예외로 죽으면 그 뒤 케이스가 결과에서 통째로 사라져 요약이 조용히 짧아진다.
 */
(async () => {
    const ad = window.__agentdeck
    // Fixed slots replace grouping; retain the legacy probe below for old releases.
    if (ad.jump(1).slots) {
        const cfg = ad.config.store.agentDeck, results = []
        const wait = () => new Promise(resolve => setTimeout(resolve, 200))
        const rows = () => [...document.querySelectorAll('#agentdeck-sidebar .ad-tab')]
        const snapshot = () => rows().map(row => ({ slot: row.dataset.adSlot, index: row.dataset.adIndex }))
        const add = (id, name, pass, evidence) => results.push({ id, name, pass, evidence })
        const saved = { sortByStatus: cfg.sortByStatus, collapsedGroups: cfg.collapsedGroups }
        try {
            ad.setFilter('', null); ad.render(); await wait()
            const before = snapshot()
            add('GR1', 'Fixed slots render in numeric order', before.every((row, i) => !i || !row.slot || Number(row.slot) > Number(before[i - 1].slot)), before)
            add('GR2', 'Rows identify actual Tabby tabs', before.every(row => !!ad.app.tabs[Number(row.index)]), before)
            cfg.collapsedGroups = ['stale/project', 'STALE/PROJECT']; ad.render(); await wait()
            add('GR3', 'Old group collapse cannot hide fixed slots', JSON.stringify(snapshot()) === JSON.stringify(before), snapshot())
            add('GR5', 'Rows retain labels, badges and close controls', rows().every(row => row.querySelector('.ad-label') && row.querySelector('.ad-badge') && row.querySelector('.ad-close')), {})
            add('GR6', 'Project grouping cannot reorder fixed slots', document.querySelectorAll('#agentdeck-sidebar .ad-group-head').length === 0, {})
            cfg.sortByStatus = true; ad.render(); await wait()
            add('GR12', 'Status sort setting cannot renumber rows', JSON.stringify(snapshot()) === JSON.stringify(before), snapshot())
            ad.setFilter('___no_matching_session___', null); await wait()
            const filtered = ad.jump(1)
            add('GR16', 'Hidden session retains its shortcut', filtered.activeTabIndex === filtered.slots[0].tabIndex, filtered)
            ad.setFilter('', null); await wait()
            add('GR14', 'Clearing filter restores original numbers', JSON.stringify(snapshot()) === JSON.stringify(before), snapshot())
        } finally { Object.assign(cfg, saved); ad.setFilter('', null); ad.render() }
        return JSON.stringify({ results, summary: { pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length, skipped: 0 }, cleanup: {} })
    }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const sb = () => document.getElementById('agentdeck-sidebar')
    const heads = () => Array.from(sb().querySelectorAll('.ad-group-head'))
    const rowEls = () => Array.from(sb().querySelectorAll('.ad-tab'))
    /** 화면에 그려진 순서를 `app.tabs` 인덱스 배열로 — 제품이 각 줄에 남기는 `data-ad-index` */
    const order = () => rowEls().map(n => Number(n.dataset.adIndex))

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })

    /** 케이스 이름을 한 곳에만 둔다 — 판정할 때와 `판정 불가`로 채울 때 이름이 갈리지 않게 */
    const CASES = [
        ['GR1', '헤더 없는 화면은 순서 유지'],
        ['GR2', '줄마다 data-ad-index'],
        ['GR3', '낡은 접힘 키에 렌더가 죽지 않는다'],
        // GR4('끄면 평면 목록')는 없앴다 — 끄는 설정(`groupByProject`) 자체가 사라졌다.
        // 그 화면(헤더 0 + 전 탭이 원래 순서)은 그룹이 하나뿐일 때 그대로 나오고 GR1 이 본다.
        ['GR5', '회귀 — 줄 구성요소'],
        ['GR6', '다중 그룹 헤더 등장'],
        ['GR7', '헤더 클릭으로 접기/펴기'],
        ['GR8', '접힘이 config 에 폴딩된 키로 남는다'],
        ['GR9', '대소문자만 다른 키로도 접힘 유지'],
        ['GR10', '접힘이 디스크 config 에 남는다'],
        ['GR11', '접힌 그룹도 개수 칩은 그대로'],
        ['GR12', '이름 있는 그룹의 정렬'],
        ['GR13', '기타 그룹은 맨 뒤'],
        ['GR14', '다중 그룹에서도 줄 구성요소 온전'],
        ['GR16', '검색이 접힌 그룹을 임시로 펴고, 지우면 복귀한다'],
    ]
    const nameOf = id => (CASES.find(c => c[0] === id) || [id, id])[1]
    /** 아직 안 매긴 케이스를 `판정 불가`(pass:null)로 — 실패와 섞지 않는다. 이미 매긴 것은 건드리지 않는다 */
    const skipCases = (ids, reason, ev) => {
        for (const id of ids) {
            if (!results.some(r => r.id === id)) { add(id, nameOf(id), null, reason, ev || null) }
        }
    }
    const ALL_IDS = CASES.map(c => c[0])
    const MULTI_IDS = ['GR6', 'GR7', 'GR8', 'GR9', 'GR10', 'GR11', 'GR12', 'GR13', 'GR14', 'GR16']
    const skipMulti = (reason, ev) => skipCases(MULTI_IDS, reason, ev)

    /**
     * 제품이 계산한 그룹 구성을 그때그때 받아 온다 — 캐시하지 않는다.
     *
     * `list` 는 **호출 시점의** 계산 결과이고 우리는 접기/펴기 전후를 비교하기 때문이다.
     * 진단구가 없거나 던지면 null 을 준다 — 여기서 예외가 새면 뒤 케이스가 결과에서 사라진다.
     */
    const snap = () => {
        try {
            return typeof ad.groups === 'function' ? ad.groups() : null
        } catch {
            return null
        }
    }
    const NO_DIAG = '진단구 __agentdeck.groups() 가 없다 (낡은 dist 를 재고 있을 수 있다 — npm run build 후 재기동)'

    const cfg = ad.config.store.agentDeck
    const saved = {
        collapsedGroups: (cfg.collapsedGroups || []).slice(),
        sortByStatus: cfg.sortByStatus,
    }
    /**
     * GR6~ 이 만드는 것들 — **try 밖에서** 선언해야 finally 가 볼 수 있다.
     * (try 안에서 const 로 잡으면 finally 에서 ReferenceError 가 나고, 그러면 임시 프로필·탭·폴더가
     *  격리 인스턴스에 남아 다음 프로브를 거짓말하게 만든다.)
     */
    const madeTabs = []
    const addedProfileIds = []
    const cleanup = {}
    let tmpBase = null
    let nodeFs = null
    const prevProfileId = ad.config.store.terminal ? ad.config.store.terminal.profile : undefined
    const prevActiveTab = ad.app.activeTab
    try {
        const G0 = snap()
        if (!G0) {
            // 진단구가 없으면 **제품이 무엇을 계산했나** 를 알 수 없다. DOM 만으로 내리는 판정은
            // 규칙 사본을 다시 들고 오는 길이라 그 길로 후퇴하지 않고 전부 판정 불가로 남긴다.
            skipCases(ALL_IDS, NO_DIAG, { hasGroupsFn: typeof ad.groups })
        } else {
            /** 제품의 키 폴딩 그대로 (`foldGroupKey`) — 순수 함수라 한 번 잡아 써도 안전하다 */
            const fold = k => G0.fold(String(k === null || k === undefined ? '' : k))
            /**
             * 경로 두 개를 "같은 폴더인가" 로 볼 때만 쓰는 느슨한 접기 — 폴딩(제품 규칙) + 구분자 통일.
             * 그룹 **키를 계산**하는 데는 쓰지 않는다(그러면 `groupKeyOf` 깊이 규칙 사본이 된다).
             * 셸이 알려주는 cwd 는 `D:\x` 처럼 역슬래시로 올 수 있어 비교 전에 통일해야 한다.
             */
            const sepFold = s => fold(s).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/(.)\/+$/, '$1')
            /** 경로의 마지막 조각 — "우리가 만든 폴더에서 태어난 탭인가" 확인용 */
            const tailOf = s => {
                const parts = sepFold(s).split('/')
                return parts[parts.length - 1] || ''
            }

            /** 제품이 이 탭을 넣은 그룹 (`list` 에서 인덱스로 찾는다 — 접혀 있어도 들어 있다) */
            const prodOf = (g, i) => (g ? g.list.find(e => e.tabIndexes.indexOf(i) >= 0) || null : null)
            /** 제품이 아는 그 탭의 작업 폴더 (`cwdCache`) */
            const cwdOf = (g, i) => (g ? g.cwdCache.find(c => c.index === i) || null : null)
            /** 제품이 배정한 전체 탭 인덱스 (접힌 그룹까지 — 화면과 달리 하나도 빠지지 않는다) */
            const prodIdxAll = g => g.list.reduce((a, e) => a.concat(e.tabIndexes), [])
            const sameArr = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])
            const sameSet = (a, b) => {
                const x = a.slice().sort((p, q) => p - q)
                const y = b.slice().sort((p, q) => p - q)
                return sameArr(x, y)
            }

            // ---------------------------------------------------------- GR1 순서 유지
            // 헤더를 그리지 않는 화면에서는 순서도 건드리지 않아야 한다. 구분선이 없으니 "그룹으로
            // 묶여서 옮겨졌다" 를 알 방법이 없고, 순정 탭바와의 대응만 깨진다.
            //
            // **기준선을 `app.tabs` 로 잡는다.** 예전에는 `groupByProject` 를 껐다 켜서 두 화면을
            // 비교했는데, 그 설정이 없어졌다(항상 켜짐). 그래서 "묶지 않은 화면" 을 만들 수 없고
            // 만들 필요도 없다 — 지켜야 할 성질은 처음부터 "줄 순서 == 순정 탭 순서" 였다.
            //
            // **전제는 제품에게 묻는다.** "헤더를 그리지 않는 화면" = 이름 있는 그룹이 1개 이하인
            // 화면인데(renderPlan `withHeads`), 실사용 인스턴스에는 프로젝트가 여럿일 수 있다.
            // 그때는 이 케이스가 재려는 화면이 아니므로 **판정 불가**여야 한다 — 순서가 정당하게
            // 바뀌는 화면이라 FAIL 로 세면 거짓 실패다.
            cfg.sortByStatus = false
            cfg.collapsedGroups = []
            ad.config.save(); ad.render(); await sleep(250)
            const grouped = order()
            const natural = ad.app.tabs.map((_, i) => i)
            const g1 = snap()
            const named1 = g1 ? g1.list.filter(e => e.key !== null).length : null
            const same = grouped.length === natural.length && grouped.every((v, i) => v === natural[i])
            const noHead = heads().length === 0
            if (named1 === null) {
                add('GR1', nameOf('GR1'), null, NO_DIAG, { natural, grouped })
            } else if (named1 > 1) {
                add('GR1', nameOf('GR1'), null,
                    `이름 있는 그룹이 ${named1}개인 화면 — 헤더를 그리는 화면이라 "순서 유지" 전제가 성립하지 않는다`,
                    { named: named1, labels: g1.list.map(e => e.label), natural, grouped })
            } else {
                add('GR1', nameOf('GR1'), same && noHead,
                    same && noHead ? '줄 순서가 순정 탭 순서 그대로다 (제품이 센 이름 있는 그룹 ' + named1 + '개, 헤더도 없다)'
                        : '헤더 없이 순서가 바뀌었다 — 사용자는 이유를 알 수 없다',
                    { natural, grouped, headCount: heads().length, namedGroups: named1 })
            }

            // ---------------------------------------------------------- GR2 줄마다 탭 식별자
            // 여기에 **제품 대조**를 붙인다: 화면에 그려진 인덱스 집합이 제품이 배정한 집합과
            // 같아야 한다(지금은 접힌 그룹이 없다). 식별자만 세면 "제품은 아는데 화면에서 빠진 탭"
            // 이나 "제품 목록 밖의 유령 줄"(-1 = app.tabs 에 없는 탭, renderTab:3141)을 못 잡는다.
            {
                const g = snap()
                const idx = order()
                const allKnown = idx.length > 0 && idx.every(n => Number.isInteger(n) && n >= 0)
                const unique = new Set(idx).size === idx.length
                const pIdx = g ? prodIdxAll(g) : null
                const covers = !!pIdx && sameSet(idx, pIdx)
                if (!g) {
                    add('GR2', nameOf('GR2'), null, NO_DIAG, { idx })
                } else {
                    const pass2 = allKnown && unique && covers
                    add('GR2', nameOf('GR2'), pass2,
                        pass2 ? '모든 줄이 자기 탭 인덱스를 들고 있고, 중복 없이 제품이 배정한 탭 전부를 덮는다'
                            : `식별자·배치가 어긋난다 (유효=${allKnown} 중복없음=${unique} 제품집합일치=${covers})`,
                        { idx, prodIdx: pIdx, tabs: ad.app.tabs.length })
                }
            }

            // ---------------------------------------------------------- GR3 없는 그룹 키가 남아 있어도
            // 렌더가 죽지 않는 것 + **없는 키가 아무 그룹도 접지 못하는 것**을 같이 본다.
            // 후자는 제품 판정(`isGroupCollapsed`)을 진단구로 되읽어 확인한다.
            cfg.collapsedGroups = ['d:/nonexistent-project', '']
            ad.config.save(); ad.render(); await sleep(250)
            {
                const g = snap()
                const idx = order()
                if (!g) {
                    add('GR3', nameOf('GR3'), null, NO_DIAG, { rows: idx.length })
                } else {
                    const noneCollapsed = g.list.every(e => !e.collapsed)
                    const covers = sameSet(idx, prodIdxAll(g))
                    const pass3 = idx.length > 0 && noneCollapsed && covers
                    add('GR3', nameOf('GR3'), pass3,
                        pass3 ? '없는 키는 아무 그룹도 접지 못하고 목록이 그대로 그려진다'
                            : `낡은 키가 화면을 흔들었다 (줄=${idx.length} 접힌그룹없음=${noneCollapsed} 제품집합일치=${covers})`,
                        { rows: idx.length, collapsed: cfg.collapsedGroups.slice(),
                            list: g.list.map(e => ({ label: e.label, collapsed: e.collapsed, n: e.tabIndexes.length })) })
                }
            }

            // ---------------------------------------------------------- GR5 회귀 — 배지·라벨·닫기
            cfg.collapsedGroups = []
            ad.config.save(); ad.render(); await sleep(250)
            {
                const g = snap()
                const n = rowEls().length
                const badges = sb().querySelectorAll('.ad-badge').length
                const labels = sb().querySelectorAll('.ad-label').length
                const closes = sb().querySelectorAll('.ad-close').length
                const expected = g ? prodIdxAll(g).length : null
                if (!g) {
                    add('GR5', nameOf('GR5'), null, NO_DIAG, { rows: n, badges, labels, closes })
                } else {
                    // 접힌 그룹이 없는 구간이므로 제품이 배정한 탭 수 = 줄 수여야 한다.
                    const pass5 = n > 0 && badges === n && closes === n && n === expected
                    add('GR5', nameOf('GR5'), pass5,
                        pass5 ? `줄마다 배지·닫기가 하나씩 있고 줄 수가 제품 배정(${expected})과 같다`
                            : `줄 구성요소 수가 어긋난다 (줄=${n} 배지=${badges} 닫기=${closes} 제품배정=${expected})`,
                        { rows: n, badges, labels, closes, prodTabs: expected })
                }
            }

            // ==================================================================== GR6~GR14
            // 여기까지(GR1~GR5)는 **그룹이 하나뿐인 화면**만 봤다. 헤더 등장·헤더 클릭 접기·접힘 저장·
            // 그룹 순서는 그룹이 둘 이상일 때만 존재하는 화면이라 아무도 판정하지 않고 있었다.
            //
            // 그룹 키의 원천은 `cwdCache` 이고, 그 캐시는 **탭 출력이 흐를 때** `touchCwd` 가
            // `session.getWorkingDirectory()` 로만 채운다 (`deck.service.ts:1090` · `:2863`).
            // 그래서 캐시에 값을 써넣는 우회를 쓰지 않고 **cwd 가 다른 탭을 실제로 띄운다** —
            // 임시 폴더 둘을 만들고 그 폴더를 `options.cwd` 로 갖는 임시 프로필을 config 에 심어
            // 사이드바 `+ 새 탭` 을 누른다. 그 버튼이 곧 제품 경로다:
            // `openNewTab()`(:2895) → `terminal.profile` → `profiles.openNewTabForProfile()`.
            // pty 는 spawn cwd 를 `guessedCWD` 로 들고 있어
            // (`node_modules/tabby-local/dist/index.js:1194`, `:1306`) Windows 에서도
            // `getWorkingDirectory()` 가 그 값을 돌려준다. 이 배선을 전부 태워야 "그룹 키가 실제
            // 작업 폴더에서 온다" 를 판정했다고 말할 수 있다.
            //
            // 판정에 못 쓰는 것 — **"n 번째 줄 = n 번째 탭"**. 줄은 제품이 남기는
            // `data-ad-index`(`renderTab`:3141)로만 찾는다.
            try {
                nodeFs = require('fs')
            } catch {
                // nodeIntegration 이 없는 창 — 임시 폴더를 만들 방법이 없다 (판정 불가)
            }

            /** 조건이 참이 될 때까지 폴링 — 참이 된 시각(ms), 시간초과면 -1 (probe-profile.js 와 같은 규약) */
            const waitFor = async (fn, timeoutMs, stepMs) => {
                const t0 = Date.now()
                for (;;) {
                    let hit = false
                    try { hit = !!fn() } catch { hit = false }
                    if (hit) { return Date.now() - t0 }
                    if (Date.now() - t0 >= timeoutMs) { return -1 }
                    await sleep(stepMs || 250)
                }
            }

            const listEl = () => (sb() ? sb().querySelector('.ad-list') : null)
            const textOf = (host, sel) => {
                const el = host.querySelector(sel)
                return el ? (el.textContent || '') : ''
            }
            /**
             * 화면을 **문서 순서대로** 섹션(헤더 + 그 아래 탭줄들)으로 자른다.
             *
             * 헤더와 탭줄은 감싸는 div 없이 **형제로** 그려진다(`renderGroupHead` 주석:3077-3079).
             * 그래서 DOM 트리로는 소속을 알 수 없고, 순서로만 읽어야 한다.
             *
             * 여기서 하는 일은 **읽기뿐**이다 — 키를 cwd 로 계산하거나 순서를 다시 정렬하지 않는다.
             * 제품 그룹과의 대응은 라벨로 맞추고(`compare()`), 헤더 `title` 은 "제품이 계산한 키가
             * 화면에도 적혔나" 를 보는 대조 재료로만 쓴다(`${key} (탭 N개) — …`, :3097-3099).
             */
            const sections = () => {
                const out = []
                const host = listEl()
                if (!host) { return out }
                let cur = null
                for (const node of Array.from(host.children)) {
                    if (node.classList.contains('ad-group-head')) {
                        const title = node.title || ''
                        const m = /\(탭 (\d+)개\)/.exec(title)
                        cur = {
                            head: node,
                            title,
                            titleCount: m ? Number(m[1]) : null,
                            label: textOf(node, '.ad-group-label'),
                            chip: textOf(node, '.ad-group-count'),
                            caret: textOf(node, '.ad-group-caret'),
                            collapsed: node.classList.contains('collapsed'),
                            idx: [],
                        }
                        out.push(cur)
                    } else if (node.classList.contains('ad-tab')) {
                        if (!cur) {
                            // 헤더보다 먼저 나온 탭줄 = 헤더 없는 평면 목록. 다중 그룹 화면에서는 없어야 한다
                            cur = { head: null, title: '', titleCount: null, label: '', chip: '', caret: '', collapsed: false, idx: [] }
                            out.push(cur)
                        }
                        cur.idx.push(Number(node.dataset.adIndex))
                    }
                }
                return out
            }
            const sectionByLabel = label => (label === null || label === undefined
                ? null
                : sections().filter(s => s.head && s.label === label)[0] || null)

            /**
             * **제품 계산(`groups().list`) ↔ 화면(DOM 섹션)** 을 라벨로 맞춰 한 번에 대조한다.
             *
             * 이 함수가 이 프로브의 심장이다. 진단구만 보면 "계산은 맞는데 화면이 옛것" 을 놓치고,
             * DOM 만 보면 규칙 사본을 들게 된다 — 그래서 항목마다 양쪽 값을 나란히 남긴다.
             *
             * 주의: `groups()` 는 `app.tabs` 를 그대로 쓰고 `render()` 는 `sortByStatus` 가 켜져
             * 있으면 **정렬한 복사본**을 쓴다(render:2985 vs 진단구:473). 그러면 그룹 안의 탭 순서가
             * 정당하게 어긋날 수 있으므로 이 프로브는 `sortByStatus` 를 꺼 놓고 잰다.
             */
            const compare = () => {
                const g = snap()
                if (!g) { return null }
                const secs = sections()
                const domLabels = secs.map(s => s.label)
                const prodLabels = g.list.map(e => e.label)
                const groupRows = g.list.map(e => {
                    const hits = secs.filter(s => s.head && s.label === e.label)
                    const s = hits.length === 1 ? hits[0] : null
                    return {
                        label: e.label,
                        key: e.key,
                        prodCollapsed: e.collapsed,
                        prodIdx: e.tabIndexes.slice(),
                        matched: !!s,
                        domIdx: s ? s.idx.slice() : null,
                        domCollapsed: s ? s.collapsed : null,
                        chip: s ? s.chip : null,
                        titleCount: s ? s.titleCount : null,
                        caret: s ? s.caret : null,
                        // 개수 칩은 **접혀도** 제품이 배정한 탭 수여야 한다 (GR11 의 근거)
                        chipOk: !!s && Number(s.chip) === e.tabIndexes.length
                            && (s.titleCount === null || s.titleCount === e.tabIndexes.length),
                        // 접힌 그룹은 줄이 없어야 하고, 펴진 그룹은 제품이 배정한 탭이 **그 순서로** 있어야 한다
                        idxOk: !!s && (e.collapsed
                            ? s.idx.length === 0
                            : sameArr(s.idx, e.tabIndexes)),
                        collapsedOk: !!s && s.collapsed === e.collapsed,
                        // 이름 있는 그룹은 헤더 title 에 제품이 계산한 키가 적혀 있어야 한다
                        titleOk: !!s && (e.key === null || s.title.indexOf(e.key) >= 0),
                    }
                })
                const shownIdx = secs.reduce((a, s) => a.concat(s.idx), [])
                return {
                    g,
                    secs,
                    groupRows,
                    domLabels,
                    prodLabels,
                    // 제품이 정한 그룹 순서가 화면 순서와 같은가 — 정렬·`기타` 맨 뒤가 화면에 반영됐다는 뜻
                    orderSame: domLabels.length === prodLabels.length && domLabels.every((l, i) => l === prodLabels[i]),
                    dupLabels: new Set(domLabels).size !== domLabels.length,
                    allHeaded: secs.length > 0 && secs.every(s => !!s.head),
                    allMatched: groupRows.every(r => r.matched),
                    chipOk: groupRows.every(r => r.chipOk),
                    idxOk: groupRows.every(r => r.idxOk),
                    collapsedOk: groupRows.every(r => r.collapsedOk),
                    titleOk: groupRows.every(r => r.titleOk),
                    noDup: new Set(shownIdx).size === shownIdx.length,
                    covers: shownIdx.length === rowEls().length,
                    shownIdx,
                    named: g.list.filter(e => e.key !== null).length,
                }
            }
            /** 리포트에 싣는 증거 — 제품값과 화면값을 항목마다 나란히 */
            const dumpOf = c => (c ? c.groupRows.map(r => ({
                label: r.label, key: r.key,
                prodIdx: r.prodIdx, domIdx: r.domIdx,
                prodCollapsed: r.prodCollapsed, domCollapsed: r.domCollapsed,
                chip: r.chip, titleCount: r.titleCount, caret: r.caret,
            })) : null)
            /** 사이드바 헤더의 상태 칩 — title 이 `탭 N개` 다(`renderHeadCount`:3115). 접어도 안 줄어야 한다 */
            const headCountTitle = () => {
                const el = sb() ? sb().querySelector('.ad-head-count') : null
                return el ? el.title : null
            }

            /**
             * cwd 가 `dir` 인 탭을 **제품 경로로** 하나 연다.
             *
             * 프로필을 config 에 심고 기본 프로필로 지정한 뒤 `+ 새 탭` 을 누른다 — `openNewTab()` 이
             * `terminal.profile` 을 보므로(:2896) 이 조합이 "지정한 cwd 로 태어난 탭" 의 유일한 실경로다.
             * `openNewTabForProfile` 을 직접 부를 수는 없다: `ProfilesService` 는 `__agentdeck` 에
             * 노출돼 있지 않다(진단구 목록 :446-591).
             */
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
                if (!btn) { return { ok: false, why: '사이드바 + 새 탭 버튼이 없다 (agentDeck.enabled 확인)' } }
                const before = ad.app.tabs.slice()
                btn.click()
                const waited = await waitFor(() => ad.app.tabs.length > before.length, 9000, 250)
                const opened = ad.app.tabs.find(t => before.indexOf(t) < 0)
                if (!opened) {
                    return { ok: false, why: `+ 새 탭 을 눌러도 9초 안에 탭이 늘지 않았다 (profile=${profId})` }
                }
                madeTabs.push(opened)
                return { ok: true, tab: opened, waitedMs: waited }
            }

            if (!nodeFs) {
                skipMulti('renderer 에서 require("fs") 를 못 잡았다 — cwd 가 다른 임시 폴더를 만들 수 없다', null)
            } else {
                let dirs = null
                try {
                    const os = require('os')
                    const path = require('path')
                    // realpath 로 시작한다 — pty 쪽이 realpath 를 한 번 더 걸기 때문에
                    // (tabby-local/dist/index.js:1297) 원본이 링크면 키와 폴더명이 어긋난다
                    tmpBase = nodeFs.mkdtempSync(path.join(nodeFs.realpathSync(os.tmpdir()), 'ad-grp-'))
                    dirs = { a: path.join(tmpBase, 'aaa'), z: path.join(tmpBase, 'zzz') }
                    nodeFs.mkdirSync(dirs.a)
                    nodeFs.mkdirSync(dirs.z)
                    // **각 폴더를 저장소로 만든다.** 그룹 경계는 이제 자동 탐지이므로
                    // (`project-root.ts`), 마커가 없으면 두 폴더가 갈리는 근거가 "우연히 위쪽에
                    // `.git` 이 없다" 가 되어 판정이 환경에 기댄다. 마커를 심으면 갈림이 확정되고
                    // 탐지 경로 자체도 회귀 대상이 된다.
                    nodeFs.mkdirSync(path.join(dirs.a, '.git'))
                    nodeFs.mkdirSync(path.join(dirs.z, '.git'))
                } catch (e) {
                    dirs = null
                    skipMulti(`임시 폴더를 만들지 못했다: ${String((e && e.message) || e)}`, { tmpBase })
                }
                if (dirs) {
                    // 판정 조건을 못박는다 — 상태 정렬이 켜져 있으면 줄 순서가 매초 뛰고 진단구
                    // (`app.tabs` 순)와 화면(정렬된 복사본)의 순서가 정당하게 어긋난다.
                    // 두 탭이 갈리는 근거는 위에서 심은 `.git` 이다 — 각 폴더가 자기 자신을
                    // 프로젝트 루트로 갖게 되고, 다른 탭(홈·저장소)은 다른 루트라 합쳐지지 않는다.
                    cfg.sortByStatus = false
                    cfg.collapsedGroups = []
                    await ad.config.save()

                    // **zzz 를 먼저 연다.** 삽입순(app.tabs 순)과 그려질 순서(제품 정렬)를 일부러
                    // 어긋나게 만들어야 GR12 가 "정렬이 실제로 돈다" 를 증명할 수 있다.
                    const rz = await openTabAt(dirs.z, 'local:agentdeck-probe-grp-z')
                    const ra = rz.ok
                        ? await openTabAt(dirs.a, 'local:agentdeck-probe-grp-a')
                        : { ok: false, why: rz.why }
                    if (!rz.ok || !ra.ok) {
                        skipMulti(`cwd 가 다른 탭을 못 열었다 — ${rz.ok ? ra.why : rz.why}`,
                            { tabs: ad.app.tabs.length, dirs })
                    } else {
                        const idxZ = ad.app.tabs.indexOf(rz.tab)
                        const idxA = ad.app.tabs.indexOf(ra.tab)

                        /**
                         * 두 탭이 갈렸는지를 **세 층으로 나눠** 본다 — 이 구분이 진단구를 연 이유다.
                         *
                         *  ① `cwdKnown` : 제품이 그 탭의 작업 폴더를 아는가 (`cwdCache[].dir`)
                         *  ② `prodSplit`: 그 cwd 로 **그룹을 갈라냈는가** (`list` 에서 두 탭의 키가 다른가)
                         *  ③ `domSplit` : 그 그룹이 **화면에 헤더로 그려졌는가**
                         *
                         * 예전에는 셋이 뭉쳐 있어 실패 원인을 "환경 문제일 수 있다" 로만 말했다.
                         * 2026-09-08 에 GR6~GR14 9종이 한꺼번에 판정 불가로 빠졌고 원인은 제품 결함
                         * (`touchCwd` 가 첫 조회의 null 에도 TTL 을 걸어 조용한 탭이 영영 cwd 를 몰랐다,
                         * R47 로 수정)이었는데 프로브는 그것을 가려내지 못했다.
                         */
                        const look = () => {
                            const g = snap()
                            if (!g) { return null }
                            const cz = cwdOf(g, idxZ)
                            const ca = cwdOf(g, idxA)
                            const ez = prodOf(g, idxZ)
                            const ea = prodOf(g, idxA)
                            const cwdKnown = !!(cz && cz.dir && ca && ca.dir)
                            const tails = { z: cz && cz.dir ? tailOf(cz.dir) : null, a: ca && ca.dir ? tailOf(ca.dir) : null }
                            return {
                                cz, ca, ez, ea, cwdKnown, tails,
                                // 셸이 우리가 지정한 폴더를 알려줬는가 (홈 등 엉뚱한 cwd 면 우리가 만들려던 화면이 아니다)
                                oursOk: cwdKnown && tails.z === 'zzz' && tails.a === 'aaa',
                                cwdDistinct: cwdKnown && sepFold(cz.dir) !== sepFold(ca.dir),
                                prodSplit: !!(ez && ea && ez.key && ea.key && fold(ez.key) !== fold(ea.key)),
                                domSplit: (() => {
                                    const sz = ez ? sectionByLabel(ez.label) : null
                                    const sa = ea ? sectionByLabel(ea.label) : null
                                    return !!(sz && sa && sz.head && sa.head && sz !== sa)
                                })(),
                                named: g.list.filter(e => e.key !== null).length,
                            }
                        }

                        // cwd 캐시가 채워지는 것은 그리기를 예약… **하기는 한다**(`touchCwd` 가
                        // `scheduleRender`, :2886). 그래도 폴링마다 `ad.render()` 를 직접 부른다 —
                        // 창이 가려져 있으면 rAF 가 멈추고, 그 상태에서 "화면에 안 그려졌다" 는
                        // 거짓 판정이 나기 때문이다.
                        const t0 = Date.now()
                        let lk = look()
                        for (;;) {
                            if (!lk || (lk.prodSplit && lk.domSplit && lk.named > 1)) { break }
                            if (Date.now() - t0 >= 25000) { break }
                            await sleep(500)
                            ad.render()
                            lk = look()
                        }
                        const waitedMs = Date.now() - t0
                        const lkDump = lk ? {
                            cwdZ: lk.cz, cwdA: lk.ca, tails: lk.tails,
                            groupZ: lk.ez ? { key: lk.ez.key, label: lk.ez.label, tabIndexes: lk.ez.tabIndexes } : null,
                            groupA: lk.ea ? { key: lk.ea.key, label: lk.ea.label, tabIndexes: lk.ea.tabIndexes } : null,
                            named: lk.named, waitedMs, dirs, idxZ, idxA,
                        } : { waitedMs, dirs, idxZ, idxA }

                        if (!lk) {
                            skipMulti(NO_DIAG, lkDump)
                        } else if (!lk.cwdKnown) {
                            // **환경/타이밍** — 제품이 애초에 작업 폴더를 모른다. 그룹 계산을 재려는
                            // 화면이 만들어지지 않았으므로 판정 불가다. (제품 결함일 수도 있지만
                            // 그 판정은 R47 = 러너의 "조용한 탭도 작업 폴더를 안다" 항목 몫이다.)
                            //
                            // **한쪽만 비었으면 R47 의 서명이다** — `touchCwd` 가 첫 조회의 null 에도
                            // TTL 을 걸면 연달아 연 탭 중 먼저 연 쪽만 영영 cwd 를 모른다(2026-09-08
                            // 실측: 25초 뒤에도 `dir: null`). 둘 다 비었으면 셸/세션 쪽(환경)이다.
                            const oneSided = !!((lk.cz && lk.cz.dir) || (lk.ca && lk.ca.dir))
                            skipMulti(`제품이 두 탭의 작업 폴더를 아직 모른다 (cwdCache dir=${JSON.stringify([lk.cz && lk.cz.dir, lk.ca && lk.ca.dir])})`
                                + (oneSided
                                    ? ' — **한쪽만** 비었다: 조용한 탭이 cwd 를 못 채우는 R47 회귀가 의심된다 (touchCwd 의 TTL 이 null 에도 걸리는 패턴). 그룹 계산 자체는 판정 불가'
                                    : ' — 둘 다 비었다: getWorkingDirectory 가 cwd 를 안 돌려주는 환경/타이밍. 그룹 계산은 판정 불가 (R47 참조)'), lkDump)
                        } else if (!lk.oursOk) {
                            skipMulti(`셸이 우리가 지정한 폴더가 아닌 cwd 를 알려줬다 (끝 조각=${JSON.stringify(lk.tails)})`
                                + ' — 우리가 만들려던 화면이 아니라 판정 불가', lkDump)
                        } else if (!lk.cwdDistinct) {
                            skipMulti('두 탭의 cwd 가 같다고 나온다 — 서로 다른 폴더로 띄웠는데도 같은 값이면'
                                + ' 우리가 만들려던 화면이 아니라 판정 불가', lkDump)
                        } else if (!lk.prodSplit) {
                            // **제품 결함으로 판정한다.** 작업 폴더를 아는데(서로 다른데) 그룹을
                            // 갈라내지 못했다 = `groupKeyOf`/프로젝트 루트 탐지/폴딩 쪽 문제다.
                            // 예전 판본은 이것도 "환경일 수 있다" 로 뭉개 SKIP 이었다.
                            add('GR6', nameOf('GR6'), false,
                                `제품이 두 탭의 cwd 를 아는데(${lk.cz.dir} / ${lk.ca.dir}) 그룹을 갈라내지 않았다`
                                    + ` (키 z=${lk.ez ? String(lk.ez.key) : 'null'} a=${lk.ea ? String(lk.ea.key) : 'null'},`
                                    + ` 탐지한 루트=${JSON.stringify(((snap() || {}).projectRoots || []))})`
                                    + ' — groupKeyOf / project-root 탐지 / 키 폴딩 쪽 결함이다 (환경 문제 아님)',
                                lkDump)
                            skipMulti('제품이 그룹을 갈라내지 않아 다중 그룹 화면이 없다 (원인은 GR6 결과)', lkDump)
                        } else if (!lk.domSplit) {
                            // 계산은 갈렸는데 화면에 없다 = **렌더 결함**. 진단구만 보는 프로브라면
                            // 이걸 통과로 셌을 자리다.
                            add('GR6', nameOf('GR6'), false,
                                `제품 계산은 그룹 ${lk.named}개로 갈렸는데(z=${String(lk.ez.key)} a=${String(lk.ea.key)})`
                                    + ` 화면에는 두 그룹의 헤더가 없다 (헤더 ${heads().length}개)`
                                    + ' — render()/renderGroupHead 쪽 결함이다',
                                Object.assign({ headTitles: heads().map(h => h.title), sections: sections().map(s => ({ label: s.label, idx: s.idx })) }, lkDump))
                            skipMulti('화면에 다중 그룹이 그려지지 않아 이후 화면 판정이 불가 (원인은 GR6 결과)', lkDump)
                        } else {
                            // ------------------------------------------------------ GR6 헤더 등장
                            // 판정 — ① 제품이 정한 그룹 **순서·개수가 화면과 같다** ② 각 그룹의
                            // `tabIndexes` 가 그 헤더 아래 줄들과 **순서까지 같다** ③ 개수 칩·title 의
                            // `탭 N개` 가 제품 배정 수와 같다 ④ 접힘 클래스가 제품 판정과 같다
                            // ⑤ 헤더 title 에 제품이 계산한 키가 적혀 있다 ⑥ 줄 인덱스가 중복 없이
                            // 화면 전체 줄을 덮는다 ⑦ 우리 두 탭이 서로 다른 키의 그룹에 있고
                            // ⑧ 그 키가 그 탭의 **실제 cwd 의 조상(또는 자기 자신)** 이다
                            //    — 키가 cwd 에서 왔다는 증거다. 깊이 규칙(`root` 직하 한 단계)을 다시
                            //    적으면 사본이 되므로 "조상인가" 라는 더 약한 불변식만 본다.
                            const c6 = compare()
                            const keyZ = lk.ez.key
                            const keyA = lk.ea.key
                            // 문자열 접두 비교만 하면 `…/a` 가 `…/ab` 의 조상으로 잡힌다 —
                            // 조각 경계까지 맞춘다 (같은 폴더이거나, 바로 뒤가 구분자여야 한다)
                            const ancestorOf = (key, dir) => {
                                const k = sepFold(key)
                                const d = sepFold(dir)
                                return d === k || d.indexOf(k.endsWith('/') ? k : k + '/') === 0
                            }
                            const cwdLinked = ancestorOf(keyZ, lk.cz.dir) && ancestorOf(keyA, lk.ca.dir)
                            const distinct = fold(keyZ) !== fold(keyA)
                            const headsMatch = !!c6 && heads().length === c6.secs.filter(s => s.head).length
                            const pass6 = !!c6 && c6.named > 1 && c6.orderSame && !c6.dupLabels && c6.allHeaded
                                && c6.allMatched && c6.idxOk && c6.chipOk && c6.collapsedOk && c6.titleOk
                                && c6.noDup && c6.covers && headsMatch && distinct && cwdLinked
                            add('GR6', nameOf('GR6'), pass6,
                                pass6
                                    ? `제품이 계산한 그룹 ${c6.g.list.length}개(이름 있는 ${c6.named}개)가 그 순서·구성 그대로 화면에 그려졌다`
                                        + ` (${waitedMs}ms 대기). 칩·title 개수 = tabIndexes 수, 두 탭은 각자 cwd 의 그룹에 있고 키는 그 cwd 의 조상이다`
                                    : '제품 계산과 화면이 어긋난다'
                                        + ` (순서일치=${c6 ? c6.orderSame : null} 라벨중복=${c6 ? c6.dupLabels : null}`
                                        + ` 전부헤더아래=${c6 ? c6.allHeaded : null} 라벨매칭=${c6 ? c6.allMatched : null}`
                                        + ` 줄배치=${c6 ? c6.idxOk : null} 칩=${c6 ? c6.chipOk : null}`
                                        + ` 접힘=${c6 ? c6.collapsedOk : null} title키=${c6 ? c6.titleOk : null}`
                                        + ` 중복없음=${c6 ? c6.noDup : null} 전부덮음=${c6 ? c6.covers : null}`
                                        + ` 다른키=${distinct} cwd조상=${cwdLinked})`,
                                {
                                    prodLabels: c6 ? c6.prodLabels : null,
                                    domLabels: c6 ? c6.domLabels : null,
                                    groups: dumpOf(c6),
                                    rows: rowEls().length,
                                    idxZ, idxA, keyZ, keyA,
                                    cwdZ: lk.cz.dir, cwdA: lk.ca.dir,
                                    projectRoots: c6 ? c6.g.projectRoots : null,
                                    waitedMs, dirs,
                                })

                            // ------------------------------------------------------ GR14 줄 구성요소 (GR5 다중판)
                            // GR5 는 그룹이 하나인 화면에서만 셌다. 헤더가 끼어들면 줄이 헤더와 형제로
                            // 그려지므로(:3077) 셀 대상이 섞일 수 있다 — 배지·닫기·컬러바가 줄마다
                            // 하나씩인지 다시 센다. `.ad-label` 은 라벨 편집 중 input 으로 바뀌므로
                            // 판정에 넣지 않고 증거로만 남긴다. 기대 줄 수는 **제품에게 묻는다**
                            // (펴져 있는 그룹의 tabIndexes 합).
                            {
                                const c = compare()
                                const n = rowEls().length
                                const badges = sb().querySelectorAll('.ad-badge').length
                                const closes = sb().querySelectorAll('.ad-close').length
                                const bars = sb().querySelectorAll('.ad-bar').length
                                const labels = sb().querySelectorAll('.ad-label').length
                                const expectRows = c
                                    ? c.g.list.filter(e => !e.collapsed).reduce((a, e) => a + e.tabIndexes.length, 0)
                                    : null
                                // 캐럿은 접힘/펴짐 표식 두 글자 중 하나여야 한다(글자 대응 자체는 GR7 이 본다)
                                const headsOk = !!c && c.secs.length > 1 && c.secs.every(s => !!s.head
                                    && ['▾', '▸'].indexOf(s.caret) >= 0
                                    && s.label.length > 0
                                    && /^[0-9]+$/.test(s.chip))
                                const pass14 = n > 0 && badges === n && closes === n && bars === n
                                    && headsOk && n === expectRows
                                add('GR14', nameOf('GR14'), pass14,
                                    pass14
                                        ? `헤더 ${c.secs.length}개가 있는 화면에서도 줄마다 배지·닫기·컬러바가 하나씩이고`
                                            + ` 줄 수가 제품이 펴 둔 탭 수(${expectRows})와 같다`
                                        : `줄 구성요소가 어긋난다 (줄=${n} 배지=${badges} 닫기=${closes} 컬러바=${bars}`
                                            + ` 헤더구성=${headsOk} 제품기대줄=${expectRows})`,
                                    { rows: n, badges, closes, bars, labels, expectRows, groups: dumpOf(c) })
                            }

                            // ------------------------------------------------ GR16 검색 × 접힘
                            // 접힌 그룹에만 검색어가 걸리면 예전에는 **줄이 하나도 안 보였다** —
                            // 사용자에게는 "검색했는데 아무것도 없다" 로 읽힌다. 지금은 그 그룹만
                            // 임시로 펴진다(`group.ts` 의 `resolveGroupCollapse`).
                            //
                            // **가장 중요한 판정은 저장값 불변이다.** 임시로 펴 보이는 것과 사용자
                            // 설정(`collapsedGroups`)을 바꾸는 것은 달라야 한다 — 검색 한 번에
                            // 접어 둔 그룹이 영구히 펴지면 그건 설정을 몰래 뒤집는 것이다.
                            {
                                const c0 = compare()
                                const named0 = c0 ? c0.g.list.filter(e => e.key !== null) : []
                                const target = named0.length ? named0[0] : null
                                const headOf = key => heads().find(h => (h.title || '').indexOf(String(key)) >= 0)
                                if (!target || typeof ad.setFilter !== 'function') {
                                    add('GR16', nameOf('GR16'), null,
                                        target ? '`setFilter` 진단구가 없다 (낡은 dist)' : '이름 있는 그룹이 없다',
                                        { named: named0.length, hasSetFilter: typeof ad.setFilter })
                                } else {
                                    const key16 = target.key
                                    // 검색어는 그 그룹 탭의 **제목 조각**에서 뽑는다 — 그룹 라벨은
                                    // 폴더 이름이라 다른 그룹에도 걸릴 수 있다
                                    const ti = target.tabIndexes && target.tabIndexes.length ? target.tabIndexes[0] : -1
                                    const tab16 = ti >= 0 ? ad.app.tabs[ti] : null
                                    const token16 = tab16
                                        ? (String(tab16.title || '').replace(/[^\w가-힣.]+/g, ' ').trim().split(/\s+/).pop() || '')
                                        : ''
                                    const h16 = headOf(key16)
                                    if (!h16 || !token16) {
                                        add('GR16', nameOf('GR16'), null,
                                            h16 ? '검색어로 쓸 제목 조각이 없다' : '그 그룹의 헤더를 못 찾았다',
                                            { key: key16, token: token16, hasHead: !!h16 })
                                    } else {
                                        // ⓐ 접는다 (설정에 저장된다)
                                        h16.click()
                                        await sleep(400)
                                        const gA = ad.groups()
                                        const eA = (gA.list || []).find(e => e.key === key16)
                                        const storedA = (cfg.collapsedGroups || []).slice()
                                        const rowsA = order()

                                        // ⓑ 검색 — 임시로 펴져야 하고 저장값은 그대로여야 한다
                                        ad.setFilter(token16)
                                        await sleep(500)
                                        const gB = ad.groups()
                                        const eB = (gB.list || []).find(e => e.key === key16)
                                        const storedB = (cfg.collapsedGroups || []).slice()
                                        const hB = headOf(key16)
                                        const rowsB = order()
                                        const shown = ti >= 0 && rowsB.indexOf(ti) >= 0

                                        // ⓒ 지우면 복귀
                                        ad.setFilter('', null)
                                        await sleep(500)
                                        const gC = ad.groups()
                                        const eC = (gC.list || []).find(e => e.key === key16)
                                        const storedC = (cfg.collapsedGroups || []).slice()

                                        const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
                                        const ok16 = !!eA && !!eB && !!eC
                                            && eA.collapsed === true && eA.collapsedEffective === true
                                            && eA.collapseReason === 'stored'
                                            && eB.collapsed === true && eB.collapsedEffective === false
                                            && eB.collapseReason === 'filter-open'
                                            && same(storedB, storedA)
                                            && shown
                                            && eC.collapsedEffective === true && eC.collapseReason === 'stored'
                                            && same(storedC, storedA)
                                        add('GR16', nameOf('GR16'), ok16,
                                            ok16
                                                ? `접은 그룹에 검색어(${token16})가 걸리자 임시로 펴져 줄이 보이고`
                                                    + ' (`filter-open`), 저장된 collapsedGroups 는 그대로였고,'
                                                    + ' 검색을 지우니 다시 접혔다'
                                                : '임시 펴짐·저장값 불변·복귀 중 어긋난 것이 있다',
                                            {
                                                key: key16, token: token16,
                                                collapsed: { a: eA && eA.collapsed, b: eB && eB.collapsed, c: eC && eC.collapsed },
                                                effective: {
                                                    a: eA && eA.collapsedEffective,
                                                    b: eB && eB.collapsedEffective,
                                                    c: eC && eC.collapsedEffective,
                                                },
                                                reason: { a: eA && eA.collapseReason, b: eB && eB.collapseReason, c: eC && eC.collapseReason },
                                                stored: { a: storedA, b: storedB, c: storedC },
                                                rows: { a: rowsA, b: rowsB }, shownTab: ti, shown,
                                                headClass: hB ? hB.className : null,
                                                headWhy: hB ? (hB.title || '').indexOf('임시로 펴') >= 0 : false,
                                            })
                                        // 접힘을 원복한다 — 뒤 케이스가 접힌 화면을 재지 않게
                                        const hEnd = headOf(key16)
                                        if (hEnd && hEnd.className.indexOf('collapsed') >= 0) {
                                            hEnd.click()
                                            await sleep(300)
                                        }
                                    }
                                }
                            }

                            // ------------------------------------------------------ GR12 그룹 순서
                            // **정렬 규칙을 다시 적지 않는다.** 예전 판본은 `compareGroups`
                            // (group.ts:180-189)를 프로브에 베껴 두고 그것과 맞춰봤다 — 규칙이 바뀌면
                            // 사본이 낡아 거짓 판정이 난다. 지금은 두 가지만 본다:
                            //  ① 제품이 정한 순서(`list`)가 화면 순서와 같다 (= 정렬 결과가 그려졌다)
                            //  ② 그 순서가 **삽입순과 다르다** (= 정렬이 실제로 돌았다. 우연히 맞은 게 아니다)
                            {
                                const c = compare()
                                const posZ = c ? c.g.list.findIndex(e => e.tabIndexes.indexOf(idxZ) >= 0) : -1
                                const posA = c ? c.g.list.findIndex(e => e.tabIndexes.indexOf(idxA) >= 0) : -1
                                const insertZFirst = idxZ < idxA
                                const bothThere = posZ >= 0 && posA >= 0
                                const reordered = bothThere && posA < posZ
                                const pass12 = !!c && c.orderSame && !c.dupLabels && bothThere
                                    && (!insertZFirst || reordered)
                                add('GR12', nameOf('GR12'), pass12,
                                    (c && c.orderSame
                                        ? '제품이 정한 그룹 순서가 화면에 그대로 그려졌다'
                                        : '제품 순서와 화면 순서가 다르다')
                                        + (insertZFirst
                                            ? ` / 삽입순은 zzz 가 먼저(app.tabs ${idxZ}<${idxA})인데 제품 순서는 aaa(${posA}) → zzz(${posZ})`
                                                + `${reordered ? ' — 정렬이 실제로 돌았다' : ' 가 아니다 — 정렬이 안 돌았다'}`
                                            : ' / 삽입순 전제(zzz 먼저)가 깨져 재정렬 증거는 못 남겼다'),
                                    { prodLabels: c ? c.prodLabels : null, domLabels: c ? c.domLabels : null,
                                        prodKeys: c ? c.g.list.map(e => e.key) : null, posA, posZ, idxZ, idxA })
                            }

                            // ------------------------------------------------------ GR13 기타 그룹은 맨 뒤
                            // `기타`(cwd 미상)는 정렬 뒤에 **push** 된다 — 제품이 그렇게 계산했는지
                            // (`list` 의 마지막이 key null 인가)와 **화면의 마지막 섹션이 그것인가**를
                            // 같이 본다. 화면에 기타 그룹이 없으면(모든 탭의 cwd 가 잡힘) 판정 불가로
                            // 둔다 — "없으니까 통과" 는 거짓 PASS 다.
                            {
                                const c = compare()
                                const keyless = c ? c.g.list.filter(e => e.key === null) : []
                                if (!c) {
                                    add('GR13', nameOf('GR13'), null, NO_DIAG, null)
                                } else if (!keyless.length) {
                                    add('GR13', nameOf('GR13'), null,
                                        '제품 그룹 목록에 기타(cwd 미상) 그룹이 없었다 — 모든 탭의 작업 폴더가 잡혔다. 순서는 판정 불가',
                                        { prodLabels: c.prodLabels, groups: dumpOf(c) })
                                } else {
                                    const lastProd = c.g.list[c.g.list.length - 1]
                                    const lastSec = c.secs[c.secs.length - 1]
                                    const prodLast = keyless.length === 1 && lastProd.key === null
                                    const domLast = !!lastSec && !!lastSec.head && lastSec.label === lastProd.label
                                    const pass13 = prodLast && domLast
                                    add('GR13', nameOf('GR13'), pass13,
                                        pass13
                                            ? `기타 그룹(라벨 "${lastProd.label}", 탭 ${lastProd.tabIndexes.length}개)이 제품 목록과 화면 모두에서 맨 뒤다`
                                            : `기타 그룹이 맨 뒤가 아니다 (기타 ${keyless.length}개, 제품 마지막 키=${String(lastProd.key)},`
                                                + ` 화면 마지막 라벨="${lastSec ? lastSec.label : '?'}")`,
                                        { prodLabels: c.prodLabels, domLabels: c.domLabels, groups: dumpOf(c) })
                                }
                            }

                            // ------------------------------------------------------ 접기 구간 (GR7·GR8·GR9·GR10·GR11)
                            // 접을 대상은 **제품이 말한 그룹**으로 잡는다 (aaa 탭이 들어 있는 그룹).
                            const targetKey = keyA
                            const targetLabel = lk.ea.label
                            const prodTarget = () => {
                                const g = snap()
                                return g ? g.list.find(e => e.key && fold(e.key) === fold(targetKey)) || null : null
                            }
                            const domTarget = () => sectionByLabel(targetLabel)
                            const cBefore = compare()
                            const headCountBefore = headCountTitle()
                            const rowsBefore = lk.ea.tabIndexes.length

                            // 헤더를 **클릭**한다 (`renderGroupHead` 이 건 click 리스너:3100).
                            // 설정을 직접 고쳐서 접으면 클릭 배선은 한 번도 안 태운다.
                            //
                            // 대상 헤더를 못 찾으면 클릭에서 예외가 나고, 그러면 **GR7~GR11 이 결과
                            // 목록에서 통째로 사라진다** — 실패도 아니고 SKIP 도 아닌 채 요약만 조용히
                            // 짧아지는 것이 최악이라 갈라서 판정 불가로 남긴다 (어긋남은 GR6 가 보고한다).
                            const t1 = domTarget()
                            if (!t1 || !t1.head) {
                                skipMulti(`접기 대상 그룹 헤더(라벨 "${targetLabel}")를 화면에서 다시 찾지 못했다 — 어긋남 자체는 GR6 결과를 볼 것`,
                                    { targetKey, targetLabel, domLabels: cBefore ? cBefore.domLabels : null, groups: dumpOf(cBefore) })
                            } else {
                                // **접기 전에 그 줄들이 화면에 있었는지** 먼저 붙잡는다.
                                // 이게 없으면 "이미 비어 있던 그룹" 과 "접어서 비운 그룹" 을 구별할 수
                                // 없다 — 시뮬레이션에서 실제로 그렇게 통과했다(줄을 안 그리는 렌더
                                // 결함을 심었는데 GR7·GR11 이 PASS). 제품 배정 수와도 맞춰 본다.
                                const domRowsBefore = t1.idx.length
                                const preOk = rowsBefore > 0 && domRowsBefore === rowsBefore
                                t1.head.click()
                                await sleep(400)
                                ad.render()
                                const pt2 = prodTarget()
                                const dt2 = domTarget()
                                const cAfter = compare()
                                // 접힘의 판정은 **양쪽**을 본다 — 제품이 접혔다고 계산했는가
                                // (`isGroupCollapsed`) + 화면에서 그 줄들이 실제로 사라졌는가.
                                // 한쪽만 보면 "설정엔 적혔는데 화면은 그대로" 를 통과로 센다.
                                const prodCollapsed = !!pt2 && pt2.collapsed
                                const prodKeptTabs = !!pt2 && pt2.tabIndexes.length === rowsBefore
                                const domCollapsed = !!dt2 && dt2.collapsed && dt2.idx.length === 0
                                const collapsedNow = preOk && prodCollapsed && prodKeptTabs && domCollapsed
                                // 다른 그룹은 그대로여야 한다 — 제품 배정과 화면 배치 둘 다
                                const othersKept = !!cBefore && !!cAfter && cBefore.groupRows
                                    .filter(r => r.key === null || fold(r.key) !== fold(targetKey))
                                    .every(r => {
                                        const now = cAfter.groupRows.find(x => x.label === r.label)
                                        return !!now && sameArr(now.prodIdx, r.prodIdx) && sameArr(now.domIdx, r.domIdx)
                                    })

                                // GR11 — 숨긴 탭이 개수에서도 사라지면 "몇 개가 접혀 있는지" 를 알 수 없다.
                                // 헤더 칩(`renderGroupHead`:3096)과 사이드바 총계(`renderHeadCount`:3115) 둘 다 본다.
                                // 기대값은 제품이 그 그룹에 여전히 배정하고 있는 탭 수다(`tabIndexes`).
                                {
                                    const chipKept = !!dt2 && !!pt2 && Number(dt2.chip) === pt2.tabIndexes.length
                                    const titleKept = !!dt2 && !!pt2 && (dt2.titleCount === null || dt2.titleCount === pt2.tabIndexes.length)
                                    const headKept = headCountTitle() === headCountBefore
                                    const pass11 = rowsBefore > 0 && collapsedNow && prodKeptTabs && chipKept && titleKept && headKept
                                    add('GR11', nameOf('GR11'), pass11,
                                        pass11
                                            ? `화면에 있던 탭 ${domRowsBefore}개를 접었는데 제품은 여전히 그 그룹에 ${pt2.tabIndexes.length}개를 배정하고 있고`
                                                + ` 헤더 칩도 ${dt2.chip} 로 유지, 사이드바 총계도 "${headCountBefore}" 그대로다`
                                            : `접은 뒤 개수가 어긋난다 (접기전화면줄=${domRowsBefore} 전제=${preOk}`
                                                + ` 화면줄=${dt2 ? dt2.idx.length : '?'} 칩=${dt2 ? dt2.chip : '?'}`
                                                + ` 제품배정=${pt2 ? pt2.tabIndexes.length : '?'} 접힘전제품=${rowsBefore}`
                                                + ` title=${dt2 ? dt2.titleCount : '?'} 총계 "${headCountBefore}" → "${headCountTitle()}")`,
                                        { rowsBefore, domRowsBefore, preOk,
                                            chip: dt2 ? dt2.chip : null, titleCount: dt2 ? dt2.titleCount : null,
                                            prodTabIndexes: pt2 ? pt2.tabIndexes : null,
                                            headCountBefore, headCountAfter: headCountTitle() })
                                }

                                // GR8 — 접힘은 재기동에도 남아야 하므로 설정에 적히는데, 적을 때 **폴딩한 키**로
                                // 적어야 한다(`collapsedKeys`:3047-3050 은 읽을 때도 폴딩한다). 셸이 알려주는
                                // 경로의 대소문자는 기동마다 다를 수 있고, 원문 대소문자로 적으면 다음 기동에
                                // 접힘이 조용히 풀린다 — group.ts:65-72 이 이 함정을 적어 둔 이유다.
                                //
                                // 기대값은 **제품의 fold() 를 통과시킨 제품의 키**다 — 프로브가 소문자화를
                                // 흉내내지 않는다. 구분자까지 이 한 줄로 덮인다(제품 키는 이미 `/` 로 정규화돼 있다).
                                const folded = fold(targetKey)
                                {
                                    const stored = (cfg.collapsedGroups || []).slice()
                                    const hit = stored.filter(k => fold(k) === folded)
                                    const onlyOne = stored.length === 1 && hit.length === 1
                                    const exact = hit.length === 1 && hit[0] === folded
                                    const pass8 = onlyOne && exact
                                    add('GR8', nameOf('GR8'), pass8,
                                        pass8
                                            ? `collapsedGroups = ["${folded}"] — 제품이 fold() 한 키 그대로 하나만 남았다`
                                            : `저장된 키가 규칙과 다르다 (stored=${JSON.stringify(stored)} 기대=${JSON.stringify([folded])})`,
                                        { stored, expected: folded, targetKey })
                                }

                                // GR9 — 위 규칙이 말뿐이 아닌지 **동작으로** 확인한다: 대소문자만 뒤집은 키를
                                // 설정에 넣어도 같은 그룹이 접혀 있어야 한다(다음 기동에 셸이 다른 대소문자로
                                // cwd 를 알려주는 상황과 같다).
                                {
                                    const flipped = folded.split('')
                                        .map(c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('')
                                    if (flipped === folded) {
                                        add('GR9', nameOf('GR9'), null,
                                            `그룹 키에 대소문자가 바뀌는 글자가 없어 판정할 수 없다 (key=${folded})`, { folded })
                                    } else {
                                        cfg.collapsedGroups = [flipped]
                                        await ad.config.save()
                                        ad.render()
                                        await sleep(200)
                                        // **접힘 판정(제품)과 접힘 표식(화면 class)만** 본다 — 줄이 실제로
                                        // 숨는지는 GR7 의 판정이다. 여기서 줄 수까지 조건에 넣으면
                                        // "숨기기가 깨졌다" 를 "폴딩 규칙이 깨졌다" 로 잘못 보고한다.
                                        const p1 = prodTarget()
                                        const d1 = domTarget()
                                        const keptCase = !!p1 && p1.collapsed && !!d1 && d1.collapsed
                                        // 구분자는 폴딩 대상이 아니다(`fold` 는 소문자화만 한다).
                                        // 제품이 저장하는 키는 이미 `/` 로 정규화돼 있어 역슬래시 키는 실사용에
                                        // 생기지 않는다 — 그래서 **판정하지 않고 증거로만** 남긴다.
                                        cfg.collapsedGroups = [folded.replace(/\//g, '\\')]
                                        await ad.config.save()
                                        ad.render()
                                        await sleep(200)
                                        const p2 = prodTarget()
                                        const sepVariantCollapsed = !!p2 && p2.collapsed
                                        // 클릭이 만든 상태로 되돌린다 — GR7 의 펴기 클릭이 그 자리에서 이어져야 한다
                                        cfg.collapsedGroups = [folded]
                                        await ad.config.save()
                                        ad.render()
                                        await sleep(200)
                                        const p3 = prodTarget()
                                        const d3 = domTarget()
                                        const restored = !!p3 && p3.collapsed && !!d3 && d3.collapsed
                                        add('GR9', nameOf('GR9'), keptCase && restored,
                                            (keptCase
                                                ? '대소문자를 뒤집은 키를 넣어도 제품이 같은 그룹을 접힘으로 판정하고 화면도 접힌 표식이다 (기동마다 달라지는 경로 표기에 안전)'
                                                : '대소문자만 다른 키로는 접힘이 살아나지 않았다 — 재기동하면 접힘이 풀린다')
                                                + ` / 역슬래시 변형은 ${sepVariantCollapsed ? '접혔다' : '안 접혔다'}(판정 대상 아님)`,
                                            { folded, flipped, keptCase, sepVariantCollapsed, restored,
                                                prodCollapsedWhileFlipped: p1 ? p1.collapsed : null,
                                                domCollapsedWhileFlipped: d1 ? d1.collapsed : null,
                                                rowsWhileFlipped: d1 ? d1.idx.length : null })
                                    }
                                }

                                // GR10 — 재기동 복원의 **전제**는 접힘이 디스크 config 에 적히는 것이다.
                                // 프로브는 재기동을 할 수 없으므로(러너의 일) 여기서는 파일까지만 확인한다.
                                {
                                    const platform = ad.config.platform
                                    const cfgPath = platform && typeof platform.getConfigPath === 'function'
                                        ? platform.getConfigPath()
                                        : null
                                    if (!cfgPath) {
                                        add('GR10', nameOf('GR10'), null,
                                            'config 파일 경로를 알 수 없다 (platform.getConfigPath 없음) — 파일 확인 불가', null)
                                    } else {
                                        await ad.config.save()
                                        // js-yaml 은 긴 스칼라를 80칼럼에서 접을 수 있으므로 공백을 걷어내고 찾는다
                                        const squeeze = s => s.replace(/\s+/g, '')
                                        const needle = squeeze(folded)
                                        let found = false
                                        let size = 0
                                        const tf = Date.now()
                                        for (;;) {
                                            try {
                                                const text = nodeFs.readFileSync(cfgPath, 'utf8')
                                                size = text.length
                                                found = squeeze(text).indexOf(needle) >= 0
                                            } catch {
                                                found = false
                                            }
                                            if (found || Date.now() - tf > 3000) { break }
                                            await sleep(300)
                                        }
                                        add('GR10', nameOf('GR10'), found,
                                            found
                                                ? `config.yaml 에 접힌 키가 적혔다 (${cfgPath})`
                                                : `config.yaml 에서 접힌 키를 찾지 못했다 — 재기동하면 접힘이 사라진다 (${cfgPath})`,
                                            { cfgPath, folded, bytes: size })
                                    }
                                }

                                // GR7 — 다시 클릭하면 **정확히 원래 줄들**이 돌아와야 한다. 줄 비교는
                                // `data-ad-index` 집합으로 한다 ("n 번째 줄" 가정이 R16·R19 를 거짓 실패시켰다).
                                // 접힘/펴짐 판정은 제품(`list[].collapsed`)과 화면(줄 유무)을 함께 본다.
                                {
                                    const t3 = domTarget()
                                    let reopened = false
                                    let prodReopened = false
                                    let cReopen = null
                                    if (t3 && t3.head) {
                                        t3.head.click()
                                        await sleep(400)
                                        ad.render()
                                        cReopen = compare()
                                        const pt3 = prodTarget()
                                        prodReopened = !!pt3 && !pt3.collapsed
                                        reopened = !!cBefore && !!cReopen
                                            && cReopen.groupRows.length === cBefore.groupRows.length
                                            && cBefore.groupRows.every(r => {
                                                const now = cReopen.groupRows.find(x => x.label === r.label)
                                                return !!now && sameArr(now.prodIdx, r.prodIdx) && sameArr(now.domIdx, r.domIdx)
                                            })
                                    }
                                    const pass7 = collapsedNow && othersKept && prodReopened && reopened
                                    add('GR7', nameOf('GR7'), pass7,
                                        pass7
                                            ? `헤더 클릭으로 화면에 있던 탭 ${domRowsBefore}개가 사라졌고(제품은 접힘으로 판정하면서 배정은 유지, 다른 그룹 불변)`
                                                + ' 다시 클릭하니 제품·화면 양쪽이 원래 배치로 돌아왔다'
                                            : `접기/펴기가 어긋난다 (접기전화면줄=${domRowsBefore}/제품${rowsBefore} 전제=${preOk}`
                                                + ` 접힘=${collapsedNow} 제품접힘=${prodCollapsed} 화면접힘=${domCollapsed}`
                                                + ` 배정유지=${prodKeptTabs} 타그룹불변=${othersKept} 제품펴짐=${prodReopened} 복귀=${reopened})`,
                                        {
                                            before: dumpOf(cBefore),
                                            collapsed: dumpOf(cAfter),
                                            after: dumpOf(cReopen),
                                            targetKey, targetLabel,
                                        })
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
        // 예외가 났어도 **안 매긴 케이스는 판정 불가로 채운다** — 결과에서 통째로 빠지면
        // 요약만 조용히 짧아져 "그 케이스는 재지도 않았다" 를 아무도 모른다.
        skipCases(ALL_IDS, `프로브가 도중에 예외로 멈췄다: ${String((e && e.message) || e)}`, null)
    } finally {
        // 오염된 인스턴스는 **다음 프로브를 거짓말하게 만든다** — 만든 탭·심은 프로필·바꾼 기본
        // 프로필·임시 폴더를 전부 되돌린다. 특히 임시 프로필을 남기면 그 뒤 `+ 새 탭` 이 임시
        // 폴더에서 열려 R10·R11(러너의 재기동 단계)까지 다른 화면을 재게 된다.
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
        Object.assign(cfg, saved)
        try { await ad.config.save() } catch { /* 무시 */ }
        try { ad.render() } catch { /* 무시 */ }
        if (prevActiveTab && ad.app.tabs.indexOf(prevActiveTab) >= 0) {
            try { ad.app.selectTab(prevActiveTab) } catch { /* 무시 */ }
        }
        // 셸이 아직 그 폴더를 잡고 있으면 지우기가 실패한다 — 탭을 닫은 뒤 한 박자 기다리고 한 번 재시도
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
    // 여기 실린 정리 결과는 요약 수치를 흔들지 않고 사람이 사후에 볼 증거로만 남는다.
    return JSON.stringify({ summary, results, cleanup }, null, 1)
})()
