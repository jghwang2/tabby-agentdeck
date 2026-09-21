/**
 * 미리보기 패널 확장 회귀 프로브 — R22~R30 이 **덮지 않는** 동작만 잰다 (VW1~VW13).
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스 (메인이 배리어에서 띄운다)
 *   node tools/cdp.js 9222 tools/probe-viewer.js
 *
 * R22~R30 이 이미 보는 것(레이아웃 5조합·폭 일치·md/이미지/표/코드 렌더·주입 차단·경로 줍기 1건·
 * 경로 입력창·`변경` 수치·실패 경로·모드 왕복)은 **여기서 다시 재지 않는다.** 이 파일이 보는 공백은
 * 드래그앤드롭 · 따라가기(`viewerPreload`/`viewerAutoOpen`) · 최근 목록 MRU/상한 · 탭별 분리 ·
 * 파일 감시 자동갱신 · 상한(줄/열) · 표·코드 경계 · 패널 폭 드래그 · 패널 숨김(setVisible) ·
 * 터미널 드롭 확인 배너 · 닫힌 패널의 자동 열림(VW11) · 열려 있을 때만 따라오기(VW12) ·
 * 닫아 두고 일하다 열면 최신이 보이기(VW13)다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary` (probe-all.js 와 같은 모양).
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(환경이 조건을 못 만듦 — 실패와 섞지 않는다)
 *
 * **자기가 바꾼 것은 되돌린다** — viewerOpen·viewerPreload·viewerAutoOpen·viewerRecentMax·viewerWidth·viewerScrape·
 * enabled 는 전부 사용자 설정이다. 임시 픽스처도 지우고, 마지막에 패널을 닫아 **파일 감시를 끊는다**
 * (지운 파일에 fs.watchFile 이 남으면 다음 실행이 '파일이 사라졌다' 로 흔들린다).
 *
 * 렌더러 안에서 도는 코드다. 창 밖의 일(실제 탐색기 드래그 등)은 못 하므로 그 항목은
 * null 로 두고 `detail` 에 밖에서 무엇을 하면 되는지 적는다.
 * 이미지 상한(VW6I)은 렌더러 안에서 판정한다 — 판단이 `statSync().size` 만 보므로 길이만 늘린
 * 픽스처로 충분하고(실측 1ms), 25MB 를 실제로 쓰지 않는다. VW6I 머리주석 참조.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')

    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    // ---------- 선택자 (전부 src/viewPanel.ts install() 이 만드는 것) ----------
    const el = () => document.getElementById('agentdeck-view')          // VIEW_ID (viewPanel.ts:59)
    const sidebar = () => document.getElementById('agentdeck-sidebar')
    const mainEl = () => document.querySelector('.content.main')
    const windowEl = () => document.querySelector('.window')
    const bodyEl = () => el() && el().querySelector('.ad-view-body')     // viewPanel.ts:270
    const titleOf = () => ((el() ? el().querySelector('.ad-view-title') : null) || {}).textContent || ''
    const bodyText = () => ((bodyEl() || {}).textContent || '')
    /** 최근 파일 칩 — chip.textContent = basename (viewPanel.ts:663) */
    const chips = () => Array.from((el() || document).querySelectorAll('.ad-view-tab')).map(c => c.textContent)
    const btn = label => Array.from((el() || document).querySelectorAll('button'))
        .find(b => (b.textContent || '').trim() === label)
    const view = () => (ad.view ? ad.view() : null)

    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    /**
     * leaf pane 을 감싼 **root 탭**. 최근 목록의 키가 root 탭이라서 필요하다 —
     * deck.service.ts:971 이 `this.view.noteOutput(root, data)` 로 넣고,
     * viewPanel.ts:658 이 `activeTab`(= app.activeTab) 것으로 칩을 그린다.
     */
    const rootOf = pane => ad.app.tabs.find(t => t === pane
        || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0)) || null

    /** 출력 구독을 실제로 태우는 채널 — 이 중 하나로 찍혔을 때만 경로 줍기를 판정할 수 있다 */
    const SCRAPE_OK = ['output.next', 'emitOutput(Buffer)']

    /**
     * 화면에 한 줄 찍어 **출력 구독을 태운다**(`deck.service.ts` 가 `session.output$` 를 구독해
     * 거기서 `noteOutput` 을 부른다). `xterm.write` 는 화면에만 그려지고 구독을 못 태운다.
     *
     * **`emitOutput(문자열)` 은 조용히 삼켜진다.** 그건 `middleware.feedFromSession(data)` 로
     * 들어가고 시그니처가 `Buffer` 다(`tabby-terminal/typings/session.d.ts:30`,
     * `dist/index.js` 의 `emitOutput(data) { this.middleware.feedFromSession(data) }`).
     * 문자열을 넘기면 미들웨어에서 사라져 **구독이 0회 발화**한다 — 2026-09-08 실측:
     * `outputSubscribed: 0`, `__agentdeck.debug().outputHits` 34→34 불변이었고 그 때문에
     * VW2·VW3·VW4 가 거짓 실패했다.
     *
     * 그래서 ① `output` Subject 직접 발화 ② `emitOutput(Buffer)` 순으로 시도한다.
     * 실측으로 둘 다 구독을 태운다(각 1회, hits 34→36).
     */
    const emit = (pane, text) => {
        const s = pane && pane.session
        if (s && s.output && typeof s.output.next === 'function') {
            s.output.next(text)
            return 'output.next'
        }
        if (s && typeof s.emitOutput === 'function') {
            try {
                s.emitOutput(require('buffer').Buffer.from(text, 'utf8'))
                return 'emitOutput(Buffer)'
            } catch (e) {
                // 미들웨어가 거부했다 — 아래 폴백으로
            }
        }
        if (pane && pane.frontend && pane.frontend.xterm) {
            pane.frontend.xterm.write(text)
            return 'xterm.write'
        }
        return null
    }
    /** 경로 한 줄을 찍고 훑기(SCRAPE_DEBOUNCE_MS=400, viewPanel.ts:80)가 돌 때까지 기다린다 */
    const scrapeLine = async (pane, file, wait = 900) => {
        const chan = emit(pane, '\r\nEdited ' + file + '\r\n')
        await sleep(wait)
        return chan
    }

    const openAndWait = async (file, sel, tries = 60) => {
        ad.openFile(file)
        for (let i = 0; i < tries; i++) {
            if (el() && el().querySelector(sel)) { return true }
            await sleep(100)
        }
        return false
    }

    const cfg = ad.config.store.agentDeck
    const saved = {
        enabled: cfg.enabled,
        viewerOpen: cfg.viewerOpen,
        viewerPreload: cfg.viewerPreload,
        viewerAutoOpen: cfg.viewerAutoOpen,
        viewerRecentMax: cfg.viewerRecentMax,
        viewerWidth: cfg.viewerWidth,
        viewerScrape: cfg.viewerScrape,
        viewerDock: cfg.viewerDock,
    }
    /**
     * 따라가기를 세운다. 0.18.0 부터 설정은 **토글 두 개**이고(`viewerPreload`/`viewerAutoOpen`)
     * 안쪽 세 모드는 `followModeOf` 가 접는다 — 프로브는 그 접기를 그대로 흉내낸다.
     * (옛 `viewerFollowMode` 를 여기서 쓰면 안 된다. 그 값은 기동 때 한 번만 읽힌다)
     */
    const setFollow = mode => {
        cfg.viewerPreload = mode !== 'manual'
        cfg.viewerAutoOpen = mode === 'open'
    }
    const firstActiveTab = ad.app.activeTab ?? null

    // 픽스처는 실행마다 다른 이름을 쓴다 — 최근 목록은 탭 WeakMap 에 남으므로(viewPanel.ts:172)
    // 같은 인스턴스에서 두 번 돌리면 "처음 본 파일" 조건(VW2)이 성립하지 않는다
    const stamp = Date.now().toString(36)
    const tmpDir = path.join(process.env.AGENTDECK_PROBE_TMP || os.tmpdir(), 'agentdeck-probe-viewer')
    const made = []
    const fx = (name, text) => {
        const p = path.join(tmpDir, name)
        fs.writeFileSync(p, text, 'utf8')
        made.push(p)
        return p
    }

    try {
        fs.mkdirSync(tmpDir, { recursive: true })

        // ---------- 전제 맞추기 (패널 열림 · 경로 줍기 on · `파일` 모드) ----------
        const v = view()
        if (!v) {
            add('VW0', '미리보기 진단구', null, 'ad.view() 가 없다 (구버전 빌드) — 이후 전 항목 판정 불가', null)
        }
        if (v && !v.isOpen) { v.setOpen(true) }
        cfg.viewerScrape = true
        setFollow('manual')
        if (v) { v.setMode('file') }
        await sleep(300)

        const pane0 = panes()[0]
        const root0 = pane0 ? rootOf(pane0) : null
        if (root0) { ad.app.selectTab(root0) }
        await sleep(400)

        // ============================================================ VW1 드래그앤드롭
        // 판정 수치 — dragover 로 `ad-view-dropping` 이 붙고(viewPanel.ts:353) dragleave·drop 뒤
        // 사라지며, text/plain 에 실린 경로가 열려 제목이 그 파일 basename 이 된다.
        // 탐색기가 붙이는 **따옴표**까지 같이 본다 (viewPanel.ts:363 이 앞뒤 `"` 를 뗀다).
        {
            const seed = fx('drop-seed-' + stamp + '.md', '# 씨앗\n')
            const dropped = fx('drop-text-' + stamp + '.md', '# 드롭 텍스트\n')
            const panel = el()
            let filePathCase = { pass: null, reason: '' }
            if (!panel) {
                add('VW1', '미리보기 — 드래그앤드롭', null, '패널 DOM 이 없다', null)
                add('VW1P', '드롭 — dataTransfer.files[0].path 갈래', null, '패널 DOM 이 없다', null)
            } else if (typeof DataTransfer !== 'function' || typeof DragEvent !== 'function') {
                add('VW1', '미리보기 — 드래그앤드롭', null,
                    '이 렌더러에 DataTransfer/DragEvent 생성자가 없다 — 실사용 드롭으로만 판정', null)
                add('VW1P', '드롭 — dataTransfer.files[0].path 갈래', null, '같은 이유', null)
            } else {
                const seedOk = await openAndWait(seed, '.ad-view-md')
                const fire = (type, dt) => panel.dispatchEvent(new DragEvent(type,
                    { bubbles: true, cancelable: true, dataTransfer: dt }))

                fire('dragover', new DataTransfer())
                const marked = panel.classList.contains('ad-view-dropping')
                fire('dragleave', new DataTransfer())
                const clearedOnLeave = !panel.classList.contains('ad-view-dropping')

                fire('dragover', new DataTransfer())
                const dt = new DataTransfer()
                dt.setData('text/plain', '"' + dropped + '"')
                fire('drop', dt)
                await sleep(400)
                const openedByText = titleOf() === path.basename(dropped)
                const clearedOnDrop = !panel.classList.contains('ad-view-dropping')

                const ok = seedOk && marked && clearedOnLeave && openedByText && clearedOnDrop
                add('VW1', '미리보기 — 드래그앤드롭 (표시 + text/plain)', ok,
                    ok ? 'dragover 에 ad-view-dropping 붙고 dragleave·drop 뒤 사라짐, 따옴표 경로가 열림'
                        : '드롭 표시나 열기가 기대와 다르다',
                    { marked, clearedOnLeave, clearedOnDrop, title: titleOf(), want: path.basename(dropped) })

                // 두 번째 갈래 — `dataTransfer.files[0].path`. 렌더러에서 File 에 path 를 심을 수
                // 있는지가 **도구 쪽 조건**이라, 못 심으면 실패가 아니라 판정 불가다
                const target = fx('drop-file-' + stamp + '.md', '# 드롭 파일\n')
                try {
                    await openAndWait(seed, '.ad-view-md')
                    const dt2 = new DataTransfer()
                    const f = new File(['x'], path.basename(target), { type: 'text/markdown' })
                    Object.defineProperty(f, 'path', { value: target })
                    dt2.items.add(f)
                    const carried = !!(dt2.files && dt2.files[0] && dt2.files[0].path === target)
                    if (!carried) {
                        filePathCase = {
                            pass: null,
                            reason: 'DataTransfer.files 가 path 를 실어 주지 않는다 (렌더러에서 File.path 를 만들 수 없다)'
                                + ' — 실사용 탐색기/VS Code 드롭으로만 판정',
                        }
                    } else {
                        fire('drop', dt2)
                        await sleep(400)
                        filePathCase = {
                            pass: titleOf() === path.basename(target),
                            reason: 'files[0].path 로 열렸는지 (viewPanel.ts:359)',
                        }
                    }
                } catch (e) {
                    filePathCase = { pass: null, reason: 'File.path 주입 자체가 막혔다: ' + String((e && e.message) || e) }
                }
                add('VW1P', '드롭 — dataTransfer.files[0].path 갈래', filePathCase.pass,
                    filePathCase.reason, { title: titleOf(), want: path.basename(target) })
            }
        }

        // ============================================================ VW2 viewerFollow
        // 판정 수치 — ① 처음 본 A 를 찍으면 A 가 뜬다 ② 처음 본 B 를 찍으면 B 가 뜬다
        // ③ **이미 최근 목록에 있는 A** 를 다시 찍으면 화면은 B 그대로다.
        // ③ 이 0.4.0 회귀 지점이다 — 옛 경로 재판독으로 직전 파일이 다시 떴다
        // (docs/DEVELOPMENT.md, viewPanel.ts:511 "따라가기의 대상은 처음 본 파일뿐이다").
        {
            const A = fx('follow-a-' + stamp + '.md', '# 팔로우 A\n')
            const B = fx('follow-b-' + stamp + '.md', '# 팔로우 B\n')
            if (!pane0) {
                add('VW2', '미리보기 — 따라가기는 처음 본 파일만', null, '터미널 pane 이 없다', null)
            } else {
                setFollow('open')
                if (view()) { view().setMode('file') }
                const chan = await scrapeLine(pane0, A, 1400)
                const t1 = titleOf()
                await scrapeLine(pane0, B, 1400)
                const t2 = titleOf()
                await scrapeLine(pane0, A, 1400)
                const t3 = titleOf()
                setFollow('manual')
                const wantA = path.basename(A)
                const wantB = path.basename(B)
                const ok = t1 === wantA && t2 === wantB && t3 === wantB
                add('VW2', '미리보기 — 따라가기는 처음 본 파일만',
                    SCRAPE_OK.indexOf(chan) >= 0 ? ok : null,
                    SCRAPE_OK.indexOf(chan) >= 0
                        ? (ok ? '새 파일만 띄우고, 이미 아는 경로 재판독은 화면을 바꾸지 않는다'
                            : '따라가기 대상이 기대와 다르다')
                        : 'session.emitOutput 이 없어 출력 구독을 태울 수 없다 (xterm.write 는 noteOutput 을 못 부른다)',
                    { channel: chan, titles: [t1, t2, t3], want: [wantA, wantB, wantB], chips: chips() })
            }
        }

        // ============================================================ VW3 최근 목록 MRU·상한
        // 판정 수치 — viewerRecentMax=3 으로 낮추고 4개를 순서대로 찍는다.
        // ① 칩 3개(상한) ② 맨 앞이 마지막에 찍은 것 ③ 이미 있는 것을 다시 찍으면
        // 중복 없이 맨 앞으로 (pushRecent, viewer.ts:149).
        {
            if (!pane0) {
                add('VW3', '미리보기 — 최근 목록 MRU·상한', null, '터미널 pane 이 없다', null)
            } else {
                setFollow('manual')
                cfg.viewerRecentMax = 3
                if (view()) { view().setMode('file') }
                const list = [1, 2, 3, 4].map(n => fx('mru-' + n + '-' + stamp + '.md', '# MRU ' + n + '\n'))
                let chan = null
                for (const f of list) { chan = await scrapeLine(pane0, f, 900) }
                const afterFour = chips()
                await scrapeLine(pane0, list[1], 900)
                const afterRepeat = chips()
                cfg.viewerRecentMax = saved.viewerRecentMax

                const names = list.map(f => path.basename(f))
                const dupFree = new Set(afterRepeat).size === afterRepeat.length
                const capOk = afterFour.length === 3 && afterRepeat.length === 3
                const newestFirst = afterFour[0] === names[3]
                const movedFront = afterRepeat[0] === names[1]
                const ok = capOk && newestFirst && movedFront && dupFree
                add('VW3', '미리보기 — 최근 목록 MRU·상한',
                    SCRAPE_OK.indexOf(chan) >= 0 ? ok : null,
                    SCRAPE_OK.indexOf(chan) >= 0
                        ? (ok ? '상한 3 유지, 최신이 맨 앞, 재등장은 중복 없이 앞으로'
                            : '칩 순서·개수가 기대와 다르다')
                        : 'session.emitOutput 이 없어 경로 줍기를 태울 수 없다',
                    { channel: chan, afterFour, afterRepeat, want: [names[3], names[1]], max: 3 })
            }
        }

        // ============================================================ VW4 탭별 분리
        // 판정 수치 — 탭1 에서 찍은 파일은 탭2 칩에 없고, 탭을 되돌리면 다시 탭1 것이 보인다
        // (recent 는 탭 WeakMap, viewPanel.ts:172 / setActiveTab viewPanel.ts:561).
        {
            const byRoot = []
            for (const p of panes()) {
                const r = rootOf(p)
                if (r && !byRoot.some(x => x.root === r)) { byRoot.push({ root: r, pane: p }) }
            }
            if (byRoot.length < 2) {
                add('VW4', '미리보기 — 최근 목록은 탭마다 따로', null,
                    '터미널 탭이 하나뿐이다 — 배리어에서 탭을 2개 열어 주면 판정 가능하다 (현재 '
                    + byRoot.length + '개)', { roots: byRoot.length })
            } else {
                setFollow('manual')
                if (view()) { view().setMode('file') }
                const fa = fx('tabA-' + stamp + '.md', '# 탭 A\n')
                const fb = fx('tabB-' + stamp + '.md', '# 탭 B\n')
                const nameA = path.basename(fa)
                const nameB = path.basename(fb)

                ad.app.selectTab(byRoot[0].root)
                await sleep(500)
                const chanA = await scrapeLine(byRoot[0].pane, fa, 1200)
                const chips1 = chips()

                ad.app.selectTab(byRoot[1].root)
                await sleep(600)
                const chanB = await scrapeLine(byRoot[1].pane, fb, 1200)
                const chips2 = chips()

                ad.app.selectTab(byRoot[0].root)
                await sleep(600)
                const chips3 = chips()

                const chan = SCRAPE_OK.indexOf(chanA) >= 0 && SCRAPE_OK.indexOf(chanB) >= 0
                const ok = chips1.indexOf(nameA) >= 0
                    && chips2.indexOf(nameB) >= 0 && chips2.indexOf(nameA) < 0
                    && chips3.indexOf(nameA) >= 0 && chips3.indexOf(nameB) < 0
                add('VW4', '미리보기 — 최근 목록은 탭마다 따로', chan ? ok : null,
                    chan ? (ok ? '탭을 바꾸면 칩이 그 탭 것으로 갈린다' : '탭 사이에 칩이 섞였다')
                        : 'session.emitOutput 이 없어 경로 줍기를 태울 수 없다',
                    { chips1, chips2, chips3, wantA: nameA, wantB: nameB, channels: [chanA, chanB] })
            }
        }

        // ============================================================ VW5 열어 둔 파일 자동 갱신
        // 판정 수치 — WATCH_INTERVAL_MS=1000 (viewPanel.ts:84) 폴링이라 최대 6초까지 기다린다.
        // ① 파일을 고치면 본문 마커가 v1→v2 로 바뀐다
        // ② `변경` 모드에서 또 고쳐도 diff 본문을 덮지 않는다 (viewPanel.ts:634 `mode === 'file'` 가드)
        // ③ `파일` 로 돌아오면 그때 최신(v3)을 읽는다 (viewPanel.ts:463)
        {
            const wf = fx('watch-' + stamp + '.md', '# 감시 v1\n\n마커 ALPHA\n')
            const opened = await openAndWait(wf, '.ad-view-md')
            await sleep(300)
            fs.writeFileSync(wf, '# 감시 v2\n\n마커 BRAVO\n', 'utf8')
            let reread = false
            for (let i = 0; i < 30; i++) {
                await sleep(200)
                if (bodyText().indexOf('BRAVO') >= 0) { reread = true; break }
            }
            const changeBtn = btn('변경')
            let inDiff = null
            let diffKept = null
            let backFresh = null
            if (changeBtn) {
                changeBtn.click()
                for (let i = 0; i < 30; i++) {
                    await sleep(200)
                    if (bodyEl() && bodyEl().querySelector('.ad-view-diff')) { break }
                }
                inDiff = !!(bodyEl() && bodyEl().querySelector('.ad-view-diff'))
                fs.writeFileSync(wf, '# 감시 v3\n\n마커 CHARLIE\n', 'utf8')
                await sleep(3500)
                diffKept = !!(bodyEl() && bodyEl().querySelector('.ad-view-diff'))
                    && bodyText().indexOf('CHARLIE') < 0
                const fileBtn = btn('파일')
                if (fileBtn) {
                    fileBtn.click()
                    await sleep(600)
                    backFresh = bodyText().indexOf('CHARLIE') >= 0
                }
            }
            const ok = opened && reread && inDiff === true && diffKept === true && backFresh === true
            add('VW5', '미리보기 — 열어 둔 파일 자동 갱신 + `변경` 보호',
                changeBtn ? ok : (opened && reread),
                changeBtn
                    ? (ok ? '고치면 스스로 다시 읽고, `변경` 본문은 덮이지 않고, 되돌아오면 최신을 읽는다'
                        : '자동 갱신이나 diff 보호가 기대와 다르다')
                    : '`변경` 버튼이 없어 가드는 못 봤다 (자동 갱신만 판정)',
                { opened, reread, inDiff, diffKept, backFresh, watchIntervalMs: 1000 })
        }

        // ============================================================ VW6 큰 파일 상한 (줄 수)
        // 판정 수치 — MAX_TEXT_LINES = 4000 (viewPanel.ts:71). 4200줄 + 끝 개행 = 4201줄 파일에서
        // 그려지는 줄이 정확히 4000, 줄번호 마지막이 4000, 안내에 `4000줄까지만` 과 전체 4201 이 뜬다.
        {
            const total = 4200
            const rows = []
            for (let i = 1; i <= total; i++) { rows.push('line ' + i) }
            const big = fx('cap-' + stamp + '.log', rows.join('\n') + '\n')
            const ok0 = await openAndWait(big, '.ad-view-code', 80)
            // **코드 보기 구조가 0.11.0 에 바뀌었다.** 예전에는 `<pre>` 두 장(`.ad-view-gutter`
            // 줄번호 + `.ad-view-src` 본문)을 좌우로 놓았는데, 줄 참조(`파일:라인`)가 생기면서
            // "어느 줄을 눌렀나" 를 알아야 해서 **줄마다 한 칸**(`.ad-cl`)이 됐다.
            // 옛 선택자로 세면 `drawn: 0` 이 나오고, 안내 문구는 정상인데 판정만 실패한다
            // (2026-09-09 실측: 그렇게 VW6 이 거짓 실패했다).
            const codeRows = el() ? Array.from(el().querySelectorAll('.ad-cl')) : []
            const drawn = codeRows.length
            const lastNo = codeRows.length
                ? Number(String((codeRows[codeRows.length - 1].querySelector('.ad-cl-no') || {}).textContent || '').trim())
                : 0
            const note = ((bodyEl() && bodyEl().querySelector('.ad-view-dim')) || {}).textContent || ''
            const ok = ok0 && drawn === 4000 && lastNo === 4000
                && note.indexOf('4000줄까지만') >= 0 && note.indexOf(String(total + 1)) >= 0
            add('VW6', '미리보기 — 글자 파일 줄 수 상한', ok,
                ok ? '4000줄만 그리고 안내에 전체 줄 수가 붙는다' : '상한 처리나 안내가 기대와 다르다',
                { drawn, lastNo, note: note.slice(0, 80), fileLines: total + 1, cap: 4000 })
        }

        // ============================================================ VW6I 이미지 상한 (두 갈래 + 대조군)
        //
        // 판정 수치 — `dataUrl()` 하나가 두 상한을 다 본다 (viewPanel.ts:132-142):
        //   `statSync(file).size > limit` 이면 **읽지 않고 null**. 그 null 이 갈래를 만든다.
        //   ① limit=MAX_IMAGE_BYTES(25,000,000, viewPanel.ts:76) → `renderImage` 가 null 을 받으면
        //      `renderMessage('이미지가 너무 크다', formatBytes(size) + ' — ' + file)` (viewPanel.ts:856-859).
        //      renderMessage 는 제목까지 그 문장으로 덮고(viewPanel.ts:793-800) 본문은
        //      `.ad-view-empty` 두 문단(제목 / `.ad-view-dim` 상세)만 남긴다 → `.ad-view-image` 가 없다.
        //   ② limit=MAX_INLINE_IMAGE_BYTES(4,000,000, viewPanel.ts:78) → md 안의 `![alt](경로)` 는
        //      `resolveImage` 가 null 을 내면 `<span class="ad-md-noimg">🖼 alt</span>` 로 떨어진다
        //      (markdown.ts:67-72). `img` 노드가 생기지 않는다.
        //   ③ **대조군**(작은 png) — 둘 다 "안 그려짐" 일 때 그게 상한 때문인지 이미지 경로가
        //      죽은 것인지 갈라야 한다. 대조군이 `.ad-view-image img` + `naturalWidth>0` 로
        //      그려지면 경로는 살아 있고, 위 두 갈래의 부재는 상한 때문이다.
        //
        // **원래 SKIP 사유(회귀 1회당 25MB 쓰기)는 성립하지 않는다.** 판단이 `statSync().size`
        // 만 보고 **파일을 읽지 않으므로**(위 ①② 둘 다 그 한 줄에서 끝난다) 내용이 필요 없다.
        // 그래서 png 머리 8바이트만 쓰고 `truncateSync` 로 길이를 늘린다 — 실측(이 리포 밖
        // node 로 같은 코드): 4,000,001B / 25,000,001B 각 **1ms**, `statSync().size` 는 늘린
        // 길이 그대로, 삭제 1ms. 데이터 25MB 를 실제로 밀어 넣는 일은 일어나지 않는다.
        // 그러니 러너에 `-SkipHeavy` 같은 갈래도 필요하지 않다.
        //
        // 픽스처는 `%TEMP%/agentdeck-probe-viewer` 아래에만 만들고 finally 에서 지운다(made[]).
        {
            // 대조군 png — probe-all.js R24 가 쓰는 것과 **같은 1x1 base64** 다.
            // 검증된 표본을 그대로 쓴다 (직접 만든 png 가 깨져 있으면 대조군이 거짓 실패한다)
            const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
            /**
             * 길이만 큰 png 를 만든다 — 머리 8바이트만 쓰고 나머지는 truncate 로 늘린다.
             * 크기가 원하는 값이 아니면(파일시스템이 sparse 확장을 거부) **판정 불가**로 돌린다:
             * 픽스처를 못 만든 것을 제품 회귀로 세면 안 된다.
             */
            const fxSized = (name, bytes) => {
                const p = path.join(tmpDir, name)
                fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
                fs.truncateSync(p, bytes)
                made.push(p)
                return { path: p, size: fs.statSync(p).size, want: bytes }
            }
            const imgOf = () => (el() ? el().querySelector('.ad-view-image img') : null)
            const waitDecode = async img => {
                for (let i = 0; i < 30; i++) {
                    if (img && img.complete && img.naturalWidth > 0) { return true }
                    await sleep(100)
                }
                return !!(img && img.naturalWidth > 0)
            }

            let fixtures = null
            let fxError = ''
            try {
                fixtures = {
                    small: (() => {
                        const p = path.join(tmpDir, 'img-ok-' + stamp + '.png')
                        fs.writeFileSync(p, Buffer.from(PNG_1X1, 'base64'))
                        made.push(p)
                        return { path: p, size: fs.statSync(p).size, want: fs.statSync(p).size }
                    })(),
                    // 상한 + 1 바이트. "경계 바로 위" 라서 상한 값이 바뀌면 이 케이스가 먼저 깨진다
                    inline: fxSized('img-inline-' + stamp + '.png', 4_000_001),
                    huge: fxSized('img-huge-' + stamp + '.png', 25_000_001),
                }
            } catch (e) {
                fxError = String((e && e.message) || e)
            }

            if (!fixtures || Object.keys(fixtures).some(k => fixtures[k].size !== fixtures[k].want)) {
                add('VW6I', '미리보기 — 이미지 상한', null,
                    '픽스처를 만들지 못했다 (파일시스템이 길이 확장을 거부했거나 공간이 없다)'
                    + (fxError ? ' — ' + fxError : ''),
                    { fixtures, error: fxError })
            } else {
                const md = fx('inline-' + stamp + '.md',
                    '# 인라인 이미지 상한\n\n'
                    // 상한 초과 → alt 로 떨어져야 하는 것
                    + '![큰그림](' + path.basename(fixtures.inline.path) + ')\n\n'
                    // 정상 크기 → img 로 남아야 하는 것 (같은 md 안에 둬서 md 렌더 자체가
                    // 죽은 경우와 "큰 것만 떨어졌다" 를 한 화면에서 가른다)
                    + '![작은그림](' + path.basename(fixtures.small.path) + ')\n')

                // ---- ③ 대조군: 작은 png 는 그려진다 ----
                const okShown = await openAndWait(fixtures.small.path, '.ad-view-image img')
                const ctlImg = imgOf()
                const ctlDecoded = await waitDecode(ctlImg)
                const ctlSrc = ctlImg ? String(ctlImg.getAttribute('src') || '').slice(0, 22) : ''
                const control = {
                    shown: okShown,
                    dataUrl: ctlSrc === 'data:image/png;base64,',
                    naturalWidth: ctlImg ? ctlImg.naturalWidth : 0,
                    decoded: ctlDecoded,
                    bytes: fixtures.small.size,
                }
                control.pass = control.shown && control.dataUrl && control.decoded

                // ---- ① MAX_IMAGE_BYTES 초과: 문장으로 끝난다 ----
                const hugeShown = await openAndWait(fixtures.huge.path, '.ad-view-empty')
                const emptyEl = bodyEl() ? bodyEl().querySelector('.ad-view-empty') : null
                const paras = emptyEl ? Array.from(emptyEl.querySelectorAll('p')).map(p => p.textContent) : []
                const dim = ((emptyEl || document).querySelector('.ad-view-dim') || {}).textContent || ''
                const huge = {
                    shown: hugeShown,
                    title: titleOf(),
                    firstLine: paras[0] || '',
                    // 상세줄은 `formatBytes(size) + ' — ' + file` 이다. **문구를 여기서 다시
                    // 계산하지 않는다**(viewer.ts formatBytes 를 복사하면 사본이 낡는다) —
                    // 모양(`… MB — `)과 경로 포함만 본다
                    detailHasPath: dim.indexOf(fixtures.huge.path) >= 0,
                    detailHasSize: /\d+(?:\.\d+)? MB — /.test(dim),
                    noImageNode: !(bodyEl() && bodyEl().querySelector('.ad-view-image')),
                    dim: dim.slice(0, 120),
                    bytes: fixtures.huge.size,
                }
                huge.pass = huge.shown && huge.title === '이미지가 너무 크다'
                    && huge.firstLine === '이미지가 너무 크다'
                    && huge.detailHasPath && huge.detailHasSize && huge.noImageNode

                // ---- ② MAX_INLINE_IMAGE_BYTES 초과: alt 로 떨어진다 ----
                const mdShown = await openAndWait(md, '.ad-view-md')
                const mdEl = el() ? el().querySelector('.ad-view-md') : null
                const noimg = mdEl ? Array.from(mdEl.querySelectorAll('.ad-md-noimg')).map(n => n.textContent) : []
                const imgs = mdEl ? Array.from(mdEl.querySelectorAll('img')) : []
                const inline = {
                    shown: mdShown,
                    noimgCount: noimg.length,
                    noimgText: noimg,
                    imgCount: imgs.length,
                    imgAlt: imgs.length ? imgs[0].getAttribute('alt') : '',
                    imgSrcHead: imgs.length ? String(imgs[0].getAttribute('src') || '').slice(0, 22) : '',
                    imgNaturalWidth: imgs.length ? imgs[0].naturalWidth : 0,
                    bytes: fixtures.inline.size,
                }
                inline.pass = inline.shown
                    && inline.noimgCount === 1 && noimg[0].indexOf('큰그림') >= 0
                    && inline.imgCount === 1 && inline.imgAlt === '작은그림'
                    && inline.imgSrcHead === 'data:image/png;base64,'

                const ok = control.pass && huge.pass && inline.pass
                add('VW6I', '미리보기 — 이미지 상한', ok,
                    (ok
                        ? '25MB 초과는 `이미지가 너무 크다` 로 끝나고, 4MB 초과 인라인은 alt 로 떨어지며,'
                            + ' 정상 크기 png 는 그대로 그려진다'
                        : '어긋난 갈래: '
                            + [!control.pass && '대조군(작은 png)', !huge.pass && '25MB 상한',
                                !inline.pass && '4MB 인라인 상한'].filter(v => v).join(', '))
                    + ` / 픽스처는 truncate 로 길이만 늘린 것이다 (판단이 statSync().size 만 본다 — 25MB 실쓰기 없음)`,
                    { control, huge, inline, caps: { image: 25_000_000, inlineImage: 4_000_000 } })
            }
        }

        // ============================================================ VW7 표·코드 경계
        // 판정 수치 — ① 열 70개 CSV 는 MAX_TABLE_COLS=60 (viewPanel.ts:74) 으로 잘려 th 61개(#+60)
        // ② 빈 CSV 는 `빈 파일` ③ 헤더만 있는 CSV 는 tbody 0행 ④ BOM md 는 h1 이 그려진다
        // (readTextHead 가 BOM 을 뗀다, viewPanel.ts:145 — 안 떼면 `#` 이 줄머리가 아니라 h1 이 안 나온다)
        // ⑤ 지원하지 않는 확장자는 문장으로 끝난다.
        {
            const cols = 70
            const head = []
            const row = []
            for (let i = 1; i <= cols; i++) { head.push('c' + i); row.push('v' + i) }
            const wide = fx('wide-' + stamp + '.csv', head.join(',') + '\n' + row.join(',') + '\n')
            const wideOk = await openAndWait(wide, '.ad-view-table table')
            const table = el() && el().querySelector('.ad-view-table table')
            const thCount = table ? table.querySelectorAll('thead th').length : 0
            const tdCount = table && table.querySelector('tbody tr')
                ? table.querySelector('tbody tr').children.length : 0

            const emptyCsv = fx('empty-' + stamp + '.csv', '')
            const emptyOk = await openAndWait(emptyCsv, '.ad-view-empty')
            const emptyTitle = titleOf()

            const headOnly = fx('headonly-' + stamp + '.csv', 'a,b,c\n')
            const headOk = await openAndWait(headOnly, '.ad-view-table table')
            const t2 = el() && el().querySelector('.ad-view-table table')
            const headRows = t2 ? t2.querySelectorAll('tbody tr').length : -1
            const headCols = t2 ? t2.querySelectorAll('thead th').length : -1

            // BOM 을 앞에 붙인다 (이 리포의 .md/.cs 는 BOM 이 흔하다)
            const bom = fx('bom-' + stamp + '.md', '\ufeff# BOM 제목\n\n본문\n')
            const bomOk = await openAndWait(bom, '.ad-view-md')
            const h1 = el() && el().querySelector('.ad-view-md h1')
            const bomHeading = h1 ? String(h1.textContent).trim() : ''

            // 지원하지 않는 확장자. **여기서 관측된 실제 동작** — `.zip` 은 renderBinary 에 닿지 못하고
            // isKnownExt(viewer.ts:59) 에서 걸려 `파일을 찾지 못했다` 로 끝난다(openFile → resolve).
            // 회귀 판정은 "예외 없이 문장으로 끝나고 패널이 살아 있다" 로 고정한다 — 문구가
            // renderBinary 의 `미리보기를 지원하지 않는 형식` 으로 바뀌어도 통과한다
            const zip = fx('nope-' + stamp + '.zip', 'PK\u0003\u0004 not a real zip')
            ad.openFile(zip)
            await sleep(500)
            const zipTitle = titleOf()
            const zipText = bodyText()
            const zipGraceful = (zipTitle.indexOf('찾지 못했다') >= 0
                || zipText.indexOf('지원하지 않는 형식') >= 0)
                && !!(view() && view().isOpen)

            const ok = wideOk && thCount === 61 && tdCount === 61
                && emptyOk && emptyTitle.indexOf('빈 파일') >= 0
                && headOk && headRows === 0 && headCols === 4
                && bomOk && bomHeading === 'BOM 제목'
                && zipGraceful
            add('VW7', '미리보기 — 표·코드 경계', ok,
                ok ? '열 60개로 자름 / 빈·헤더만 CSV 안 죽음 / BOM md 는 h1 정상 / 미지원 확장자는 문장으로 끝남'
                    : '경계 처리 중 하나가 기대와 다르다',
                {
                    wide: { th: thCount, td: tdCount, want: 61, maxCols: 60 },
                    empty: { title: emptyTitle },
                    headOnly: { tbodyRows: headRows, th: headCols, want: { tbodyRows: 0, th: 4 } },
                    bom: { heading: bomHeading, want: 'BOM 제목' },
                    unsupported: { title: zipTitle, graceful: zipGraceful },
                })
        }

        // ============================================================ VW8 패널 폭 드래그
        // 판정 수치 — `.ad-view-resize` 에 mousedown → window mousemove → mouseup.
        // ① **잡자마자 튀지 않는다** — mousedown 후 커서를 그대로 둔 mousemove 에 폭이 안 변한다
        // ② 목표 폭으로 끌면 그 폭이 된다 (MouseEvent.clientX 가 정수로 잘려 ±2 허용)
        // ③ MIN_VIEW_W=260 (viewPanel.ts:78) 아래로 끌면 **정확히 260** 으로 클램프
        // ④ 그 뒤에도 `터미널 + 패널 + 사이드바 == 창폭` (R3 와 같은 규칙)
        // ⑤ 드래그가 끝나면 body 의 `ad-resizing` 이 떨어진다
        //
        // **①이 이 케이스의 핵심이다** (2026-09-11 추가). 제품이 폭을 "창 가장자리 ~ 커서" 로
        // 재던 판본에서는 사이드바와 패널이 같은 쪽일 때 잡는 순간 사이드바 폭만큼 커졌다
        // (실측 +198px = 사이드바 200 − 손잡이 반폭 2). 사용자에게는 "한 번 커지고 나서 줄여야
        // 한다" 로 보인다. 옛 공식이 내놓을 값을 증거에 함께 남겨 회귀 시 원인이 바로 보이게 한다.
        //
        // 좌표는 **손잡이 위치와 실제 렌더 폭**에서 뽑는다 — `xFor(cfg.viewerWidth)` 처럼 창
        // 가장자리에서 역산하면 프로브가 제품의 옛 버그와 같은 가정을 들고 있게 되고, 창이 좁아
        // 폭이 `extent()` 로 깎인 상황(설정값 ≠ 렌더 폭)에서 거짓 실패한다.
        {
            const handle = el() && el().querySelector('.ad-view-resize')
            if (!handle || !view() || !view().isOpen) {
                add('VW8', '미리보기 — 패널 폭 드래그', null,
                    handle ? '패널이 닫혀 있다' : '.ad-view-resize 를 못 찾았다', null)
            } else {
                const side = cfg.viewerDock === 'left' ? 'left' : 'right'
                const domW = () => Math.round(el().getBoundingClientRect().width)
                const hr = () => handle.getBoundingClientRect()
                const yMid = Math.round(hr().top + 60)
                /** 잡은 뒤 목표 폭까지 끈다. 없으면 잡기만 하고 제자리 move 를 한 번 흘린다 */
                const drag = async (want, opts) => {
                    const base = domW()
                    const from = Math.round(hr().left + hr().width / 2)
                    handle.dispatchEvent(new MouseEvent('mousedown',
                        { bubbles: true, cancelable: true, clientX: from, clientY: yMid, buttons: 1 }))
                    // 제자리 move — 튐이 있으면 여기서 드러난다
                    window.dispatchEvent(new MouseEvent('mousemove',
                        { bubbles: true, clientX: from, clientY: yMid, buttons: 1 }))
                    await sleep(150)
                    const held = domW()
                    const to = side === 'right' ? from - (want - base) : from + (want - base)
                    window.dispatchEvent(new MouseEvent('mousemove',
                        { bubbles: true, clientX: to, clientY: yMid, buttons: 1 }))
                    await sleep(200)
                    window.dispatchEvent(new MouseEvent('mouseup',
                        { bubbles: true, clientX: to, clientY: yMid, buttons: 0 }))
                    await sleep(300)
                    return { base, held, jump: held - base, width: cfg.viewerWidth, dom: domW(), ...(opts || {}) }
                }
                // **정확도는 "줄이기" 로 잰다.** 늘리기는 `extent()` 가 `room`(창폭 − 터미널 최소
                // − 사이드바 최소)으로 깎으므로 창이 좁으면 목표에 못 미치는 것이 정상이고,
                // 그걸 실패로 세면 좁은 창에서 거짓 실패가 난다(2026-09-11 실측: base 340 이 이미
                // 상한이라 +80 이 안 먹었다). 줄이기는 260 까지 언제나 가능하고 **코드 경로가 같다**
                // (부호만 다른 한 줄, `viewPanel.ts` installResize) — 그래서 이것만으로 충분하다.
                const target = Math.max(260, domW() - 40)
                const shrunk = await drag(target, { target })
                // 늘리기는 증거로만 남긴다 — 상한에 걸렸는지를 사람이 보고 판단할 수 있게
                const grown = await drag(shrunk.dom + 40, { asked: shrunk.dom + 40 })
                const clamped = await drag(60)
                const win = windowEl().clientWidth
                const sum = Math.round(mainEl().clientWidth + sidebar().clientWidth
                    + (el().style.display !== 'none' ? el().getBoundingClientRect().width : 0))
                const resizingLeft = document.body.classList.contains('ad-resizing')
                // 옛 공식(창 가장자리 ~ 손잡이)이 첫 move 에 내놓았을 값 — 튐 폭의 근거
                const wr = windowEl().getBoundingClientRect()
                const hx = Math.round(hr().left + hr().width / 2)
                const oldWould = Math.round(side === 'right' ? wr.right - hx : hx - wr.left)
                const noJump = shrunk.jump === 0 && grown.jump === 0 && clamped.jump === 0
                const shrankExact = Math.abs(shrunk.dom - shrunk.target) <= 2
                const ok = noJump && shrankExact && clamped.width === 260
                    && Math.abs(sum - win) <= 2 && !resizingLeft
                add('VW8', '미리보기 — 패널 폭 드래그', ok,
                    ok ? `잡을 때 튀지 않고(제자리 move 3회 모두 폭 불변) 끈 만큼만 움직이며 260 에서 클램프, 폭 합계도 유지된다`
                        + ` (옛 공식이라면 잡는 순간 ${oldWould - domW()}px 튀었다)`
                        : `튐·폭 반영·클램프·합계 중 하나가 어긋난다`
                        + ` (튐없음=${noJump} 줄이기정확=${shrankExact} 클램프=${clamped.width})`,
                    { shrunk, grown, clamped, minViewW: 260, sum, win, resizingLeft, side,
                        oldFormulaWouldBe: oldWould, oldFormulaJump: oldWould - domW() })
                cfg.viewerWidth = saved.viewerWidth
                ad.relayout()
                await sleep(300)
            }
        }

        // ============================================================ VW9 패널 숨김 (setVisible)
        // 판정 수치 — `enabled=false` → 패널 display:none, `enabled=true` → 다시 flex.
        // 그 사이 **viewerOpen 과 isOpen 은 그대로여야 한다** (applyEnabled 는 setVisible 만 부른다,
        // deck.service.ts:1960 / viewPanel.ts:228 "열림 상태는 건드리지 않는다").
        {
            const vv = view()
            if (!vv) {
                add('VW9', '미리보기 — 레이아웃 off 시 숨김', null, 'ad.view() 가 없다', null)
            } else {
                if (!vv.isOpen) { vv.setOpen(true) }
                await sleep(200)
                const openBefore = { cfgOpen: !!cfg.viewerOpen, isOpen: vv.isOpen }
                cfg.enabled = false
                ad.config.save()
                await sleep(700)
                // applyEnabled 가 실제로 돌았는지부터 가른다 — 이 프로브는 `config.changed$` 발화에
                // 기대고 있고(deck.service.ts:376), 그게 안 오면 "숨지 않았다" 가 제품 회귀가 아니라
                // **도구가 조건을 못 만든 것**이다. BODY_CLASS 토글(deck.service.ts:1955)이 그 증거다
                const applied = !document.body.classList.contains('agentdeck-active')
                const hidden = !!el() && el().style.display === 'none'
                const keptWhileOff = !!cfg.viewerOpen && vv.isOpen === true
                cfg.enabled = true
                ad.config.save()
                await sleep(900)
                ad.relayout()
                await sleep(300)
                const shown = !!el() && el().style.display === 'flex'
                const keptAfterOn = !!cfg.viewerOpen && vv.isOpen === true
                const ok = openBefore.isOpen && hidden && keptWhileOff && shown && keptAfterOn
                add('VW9', '미리보기 — 레이아웃 off 시 숨김', applied ? ok : null,
                    applied
                        ? (ok ? '숨었다 다시 나오고 열림 상태(viewerOpen)는 보존된다'
                            : '숨김/복귀나 열림 상태 보존이 기대와 다르다')
                        : 'enabled=false 로 바꿔도 applyEnabled 가 돌지 않았다 (config.changed$ 미발화)'
                            + ' — 설정 창에서 손으로 껐다 켜 판정한다',
                    { applied, openBefore, hidden, keptWhileOff, shown, keptAfterOn })
            }
        }

        // ============================================================ VW10 드롭 확인 배너
        // 터미널 위에 파일을 끌어다 놓았을 때. 순정 Tabby 는 경로를 터미널에 붙여넣는데, 패널이
        // 닫혀 있으면 그것만 되고 아무것도 열리지 않았다(0.9.0 이전). 지금은 캡처 단계에서
        // 가로채 `패널에 띄우기` / `경로 붙여넣기` 를 고르게 한다.
        //
        // **`files` 는 합성할 수 없다** — `DataTransfer.files` 는 읽기 전용이라 프로브는
        // `text/plain` 경로만 넣는다. 제품이 `file.path || getData('text/plain')` 순으로 읽으므로
        // 뒤쪽 갈래가 태워진다(앞쪽은 실제 탐색기 드래그 = VW1P 가 본다).
        {
            const dropDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-drop-'))
            made.push(dropDir)
            const dropMd = path.join(dropDir, '드롭확인.md')
            fs.writeFileSync(dropMd, '# 드롭 확인\n\n본문 한 줄.\n', 'utf8')
            const card = () => document.getElementById('agentdeck-drop-ask')
            const pick = cls => (card() ? card().querySelector(cls) : null)
            const fire = target => {
                const dt = new DataTransfer()
                dt.setData('text/plain', dropMd)
                const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
                target.dispatchEvent(ev)
                return ev.defaultPrevented
            }
            const term = document.querySelector('.content.main')
            const vv = view()
            if (!term || !vv) {
                add('VW10', '드롭 확인 배너', null,
                    term ? 'ad.view() 가 없다' : '.content.main 을 못 찾았다 (레이아웃이 꺼져 있다)', null)
            } else {
                const sub = []
                cfg.viewerDropOpen = 'ask'
                vv.setOpen(false, false)
                await sleep(200)

                // ① 배너가 뜨고, 순정 붙여넣기는 막히고, 화면은 아직 그대로다
                const prevented = fire(term)
                await sleep(300)
                const msg = pick('.ad-drop-ask-msg')
                sub.push({
                    step: '① 배너 등장 + 순정 차단',
                    prevented,
                    // 제목은 **파일명**이어야 한다 (경로 전체를 쓰면 카드가 넘친다).
                    // 2026-09-09: 정규식의 백슬래시가 한 겹 접혀 전체 경로가 찍힌 적이 있다
                    text: msg ? msg.textContent : null,
                    titleIsFullPath: msg ? msg.title === dropMd : false,
                    buttons: card() ? Array.from(card().querySelectorAll('button')).map(b => b.textContent.trim()) : [],
                    hasDontAsk: !!pick('.ad-drop-ask-again-box'),
                    panelStillClosed: vv.isOpen === false,
                    ok: prevented && !!msg
                        // Localized prompts can put the filename after the question prefix.
                        && msg.textContent.includes('드롭확인.md')
                        && msg.title === dropMd
                        && !!pick('.ad-drop-ask-again-box')
                        && vv.isOpen === false,
                })

                // ② `패널에 띄우기` → 패널이 열리고 그 파일이 그려진다. 설정은 그대로(ask)
                pick('.ad-drop-ask-view').click()
                await sleep(1200)
                const h1 = el() ? (el().querySelector('.ad-view-body h1') || {}).textContent : null
                sub.push({
                    step: '② 패널에 띄우기',
                    cardGone: !card(), open: vv.isOpen, h1, pref: cfg.viewerDropOpen,
                    ok: !card() && vv.isOpen === true && h1 === '드롭 확인' && cfg.viewerDropOpen === 'ask',
                })

                // ③ 패널·사이드바 위 드롭은 그쪽 핸들러 몫이다 — 우리 배너가 뜨면 이중 처리다
                fire(el())
                await sleep(400)
                sub.push({ step: '③ 패널 위 드롭엔 배너 없음', card: !!card(), ok: !card() })

                // ④ `다시 묻지 않기` + `경로 붙여넣기` → 설정이 paste 로 저장된다
                vv.setOpen(false, false)
                fire(term)
                await sleep(300)
                pick('.ad-drop-ask-again-box').checked = true
                pick('.ad-drop-ask-paste').click()
                await sleep(500)
                sub.push({
                    step: '④ 다시 묻지 않기 → paste 저장',
                    pref: cfg.viewerDropOpen, cardGone: !card(),
                    ok: cfg.viewerDropOpen === 'paste' && !card(),
                })

                // ⑤ 저장된 뒤에는 묻지 않는다
                fire(term)
                await sleep(400)
                sub.push({ step: '⑤ paste 모드는 묻지 않는다', card: !!card(), ok: !card() })

                // ⑥ never 는 우리가 아예 개입하지 않는다.
                //    `defaultPrevented` 로는 판정할 수 없다 — 순정 Tabby 도 파일 드롭을 처리하려면
                //    preventDefault 를 하기 때문이다(2026-09-09 실측: never 에서도 true). 우리가
                //    손을 뗐다는 증거는 **배너가 없고 패널 상태가 그대로인 것**이다.
                cfg.viewerDropOpen = 'never'
                const openBefore = vv.isOpen
                const prevented6 = fire(term)
                await sleep(300)
                sub.push({
                    step: '⑥ never = 개입 안 함',
                    preventedByOthers: prevented6, card: !!card(), openChanged: vv.isOpen !== openBefore,
                    ok: !card() && vv.isOpen === openBefore,
                })

                card() && card().remove()
                const allOk = sub.every(x => x.ok)
                add('VW10', '드롭 확인 배너', allOk,
                    allOk
                        ? '터미널 드롭에 배너가 뜨고(순정 차단), 두 버튼이 각자 동작하며, `다시 묻지 않기` 가 저장되고 never 는 개입하지 않는다'
                        : '드롭 갈래 중 기대와 다른 것이 있다',
                    { sub })
            }
        }

        // ============================================================ VW11 닫혀 있어도 열린다
        // 0.6.4 이전에는 `scrape` 가 `!this.opened` 에서 곧장 돌아섰다 — 결과물이 나와도
        // 사람이 `▤` 를 눌러야 보였고, 그 왕복이 이 패널이 없애려던 것이었다.
        // 판정 수치 — ① 닫힌 상태에서 처음 본 파일을 찍으면 **열리면서** 그 파일이 뜬다
        // ② `읽어두기`(viewerPreload)를 끄면 닫힌 채로 남는다 = 옛 `manual`.
        {
            const C = fx('autoopen-c-' + stamp + '.md', '# 자동 열림 C\n')
            const D = fx('autoopen-d-' + stamp + '.md', '# 자동 열림 D\n')
            const vv = view()
            if (!pane0 || !vv) {
                add('VW11', '미리보기 — 닫혀 있어도 새 파일이면 열린다', null,
                    pane0 ? 'ad.view() 가 없다' : '터미널 pane 이 없다', null)
            } else {
                vv.setMode('file')
                setFollow('open')
                vv.setOpen(false, false)
                await sleep(200)
                const closedBefore = vv.isOpen === false
                const chan = await scrapeLine(pane0, C, 1400)
                const openedNow = vv.isOpen === true
                const titleC = titleOf()

                // 끄면 자동으로 열리지 않아야 한다
                setFollow('manual')
                vv.setOpen(false, false)
                await sleep(200)
                await scrapeLine(pane0, D, 1400)
                const stayedClosed = vv.isOpen === false
                setFollow('open')

                const wantC = path.basename(C)
                const ok = closedBefore && openedNow && titleC === wantC && stayedClosed
                add('VW11', '미리보기 — 닫혀 있어도 새 파일이면 열린다',
                    SCRAPE_OK.indexOf(chan) >= 0 ? ok : null,
                    SCRAPE_OK.indexOf(chan) >= 0
                        ? (ok ? '닫힌 패널이 새 파일을 주우면 열리고, manual 이면 닫힌 채로 남는다'
                            : '자동 열림이나 옵트아웃이 기대와 다르다')
                        : 'session.emitOutput 이 없어 출력 구독을 태울 수 없다',
                    { channel: chan, closedBefore, openedNow, title: titleC, want: wantC, stayedClosed })
            }
        }

        // ============================================================ VW12 열려 있을 때만 따라온다
        // 기본 상태(`읽어두기` ON + `자동으로 열기` OFF) = 안쪽 모드 `show`. 옛 boolean 으로는 낼 수 없던 상태다 —
        // 끄면 열려 있어도 안 바뀌고, 켜면 닫힌 패널까지 열렸다. **"여닫기는 내가, 따라가기는 네가"**
        // 판정 수치 — ① `show` + 닫힘: 새 파일을 찍어도 **닫힌 채로 남는다**(칩에는 쌓인다)
        // ② `show` + 열림: 새 파일로 화면이 바뀐다 ③ 그 뒤 `manual` 은 열려 있어도 안 바뀐다.
        {
            const E = fx('showmode-e-' + stamp + '.md', '# 보기 모드 E');
            const F = fx('showmode-f-' + stamp + '.md', '# 보기 모드 F');
            const G = fx('showmode-g-' + stamp + '.md', '# 보기 모드 G');
            const vv = view()
            if (!pane0 || !vv) {
                add('VW12', '미리보기 — 열려 있을 때만 따라온다 (show)', null,
                    pane0 ? 'ad.view() 가 없다' : '터미널 pane 이 없다', null)
            } else {
                vv.setMode('file')
                // ① 닫혀 있으면 스스로 열지 않는다
                setFollow('show')
                vv.setOpen(false, false)
                await sleep(200)
                const chan = await scrapeLine(pane0, E, 1400)
                const stayedClosed = vv.isOpen === false
                const chipHasE = chips().indexOf(path.basename(E)) >= 0

                // ② 열어 두면 따라온다
                vv.setOpen(true, false)
                await sleep(200)
                await scrapeLine(pane0, F, 1400)
                const titleF = titleOf()

                // ③ manual 은 열려 있어도 안 바뀐다
                setFollow('manual')
                await scrapeLine(pane0, G, 1400)
                const titleAfterG = titleOf()
                setFollow('open')

                const wantF = path.basename(F)
                const ok = stayedClosed && chipHasE && titleF === wantF && titleAfterG === wantF
                add('VW12', '미리보기 — 열려 있을 때만 따라온다 (show)',
                    SCRAPE_OK.indexOf(chan) >= 0 ? ok : null,
                    SCRAPE_OK.indexOf(chan) >= 0
                        ? (ok ? 'show 는 닫힌 패널을 열지 않고(칩만 쌓임) 열어 두면 따라온다. manual 은 열려 있어도 안 바뀐다'
                            : '세 갈래 중 기대와 다른 것이 있다')
                        : 'session.emitOutput 이 없어 출력 구독을 태울 수 없다',
                    { channel: chan, stayedClosed, chipHasE, titleF, want: wantF, titleAfterG })
            }
        }

        // ============================================================ VW13 닫아 두고 일하다 열면
        // 0.18.0 기본값(`문서 패널에 읽어두기` ON / `패널 자동으로 열기` OFF)의 요점이다 —
        // **닫아 두고 일하다 사람이 열면 그때까지 만진 것이 보여야 한다.**
        // 0.17.0 까지 이 자리는 `planFollow`=`none` 이라 `lastViewed` 가 멈춰 있었고, 나중에 열면
        // **아까 보던 옛 파일**이 떠 있었다(그래서 "지금 뭘 만졌나" 를 패널로 알 수 없었다).
        // 판정 수치 — ① 열어서 H 를 보고 닫는다 ② 닫힌 채 I·J 를 찍는다(열리지 않는다)
        // ③ 사람이 열면 제목이 **J**(마지막에 만진 것)이고 칩에 I 도 남아 있다
        // ④ 닫힌 동안 그 파일이 고쳐졌으면 **여는 김에 다시 읽는다** (닫으면 감시가 끊기므로).
        {
            const H = fx('preload-h-' + stamp + '.md', '# 미리적재 H\n')
            const I = fx('preload-i-' + stamp + '.md', '# 미리적재 I\n')
            const J = fx('preload-j-' + stamp + '.md', '# 미리적재 J\n')
            const vv = view()
            if (!pane0 || !vv) {
                add('VW13', '미리보기 — 닫아 두고 일하다 열면 최신이 보인다', null,
                    pane0 ? 'ad.view() 가 없다' : '터미널 pane 이 없다', null)
            } else {
                vv.setMode('file')
                setFollow('show')
                // ① 사람이 H 를 열어 본 상태 — 이게 "옛 파일" 이 된다
                const openedH = await openAndWait(H, '.ad-view-md')
                vv.setOpen(false, false)
                await sleep(200)

                // ② 닫힌 채로 두 개를 만진다
                const chan = await scrapeLine(pane0, I, 1200)
                await scrapeLine(pane0, J, 1200)
                const stayedClosed = vv.isOpen === false

                // ③ 사람이 연다 — 마지막에 만진 J 가 보여야 한다
                vv.setOpen(true, false)
                await sleep(500)
                const titleAfterOpen = titleOf()
                const chipsNow = chips()

                // ④ 닫힌 동안 고쳐진 것도 여는 김에 다시 읽는다 (같은 파일이라 대상은 안 바뀐다)
                vv.setOpen(false, false)
                await sleep(150)
                fs.writeFileSync(J, '# 미리적재 J 고침\n', 'utf8')
                vv.setOpen(true, false)
                await sleep(600)
                const reread = bodyText().indexOf('고침') >= 0
                setFollow('open')

                const wantJ = path.basename(J)
                const chipHasI = chipsNow.indexOf(path.basename(I)) >= 0
                const ok = openedH && stayedClosed && titleAfterOpen === wantJ && chipHasI && reread
                add('VW13', '미리보기 — 닫아 두고 일하다 열면 최신이 보인다',
                    SCRAPE_OK.indexOf(chan) >= 0 ? ok : null,
                    SCRAPE_OK.indexOf(chan) >= 0
                        ? (ok ? '닫힌 동안 읽어 둔 최신 파일이 여는 순간 뜨고(칩에 이전 것도 남는다), 닫힌 사이 고쳐진 내용도 다시 읽는다'
                            : '읽어두기 결과가 기대와 다르다 — 옛 파일이 떠 있거나 내용이 낡았다')
                        : 'session.emitOutput 이 없어 출력 구독을 태울 수 없다',
                    { channel: chan, openedH, stayedClosed, titleAfterOpen, want: wantJ, chipHasI, reread, chips: chipsNow })
            }
        }

    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
    } finally {
        // ① 감시부터 끊는다 — 아래에서 픽스처를 지우므로, 감시가 살아 있으면 폴링 콜백이
        //    지워진 파일을 읽고 '파일이 사라졌다' 를 그린다 (viewPanel.ts:631 fs.watchFile)
        try {
            const vv = view()
            if (vv) {
                vv.setMode('file')
                vv.setOpen(false, false)
            }
        } catch { /* 패널이 이미 없다 */ }
        // ② 설정 원복 (사용자 값이다)
        try {
            Object.assign(cfg, saved)
            ad.config.save()
        } catch { /* 복원 실패는 치명적이지 않다 */ }
        // ③ 열림 상태는 설정에 되쓰지 않고 되돌린다 (remember=false)
        try {
            const vv = view()
            if (vv && saved.viewerOpen) { vv.setOpen(true, false) }
        } catch { /* 무시 */ }
        // ④ 활성 탭도 처음 것으로 (probe-all 의 R12 와 같은 이유 — 다음 시나리오가 엉뚱한 탭으로 간다)
        try {
            if (firstActiveTab) { ad.app.selectTab(firstActiveTab) }
        } catch { /* 무시 */ }
        try {
            ad.relayout()
            ad.render()
        } catch { /* 무시 */ }
        // ⑤ 픽스처 정리
        // 파일이 아니라 **폴더**를 넣는 케이스도 있다 (VW10 의 드롭 픽스처) — unlink 는 폴더를
        // 못 지우므로 실패하면 재귀 삭제로 한 번 더 시도한다. 안 그러면 %TEMP% 에 계속 쌓인다
        for (const f of made) {
            try {
                fs.unlinkSync(f)
            } catch {
                try { fs.rmSync(f, { recursive: true, force: true }) } catch { /* 이미 없음 */ }
            }
        }
        try { fs.rmdirSync(tmpDir) } catch { /* 비어 있지 않으면 남긴다 */ }
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    return JSON.stringify({ summary, results }, null, 1)
})()
