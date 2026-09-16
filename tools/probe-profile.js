/**
 * 확장 회귀 프로브 — **프로필 · 탭 복원 · 화면 감시/자동복구** (`PR1`~`PR9`).
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스 (메인이 띄운다)
 *   node tools/cdp.js 9222 tools/probe-profile.js
 *
 * 왜 따로 있나 — `probe-all.js` 가 보는 R1~R37 에는 **설정 창에서 켜고 끄는 기능**이 빠져 있다.
 * 작업 루트 프로필(`rootProfile`), 탭 복원 강제 해제(`noTabRecovery`), 화면 감시/자동복구
 * (`screenWatch`·`autoRepair*`), 수동 복구 4단계(`repairHard`·`repairSendRedrawKey`) 넷은
 * 한 번도 회귀로 잡힌 적이 없다. 그런데 이 넷은 전부 **사용자 config 를 건드리는** 기능이라,
 * 회귀가 없으면 "켜지긴 하나" 조차 아무도 확인하지 않는다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary`.
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(환경이 조건을 못 만듦 — 실패와 섞지 않는다)
 *
 * 판정 규약 세 가지 (전부 실측 사고로 배운 것) —
 *  1. **화면 판정은 제품 함수를 부른다** (`__agentdeck.judge(pane)`). 규칙을 복사한 사본은
 *     제품과 다른 답을 낸다 (2026-09-08: 단순화한 사본이 R2·R14 를 거짓 실패시켰다).
 *  2. **채증은 증분만 본다.** `~/.agentdeck-screen.log` 와 `kickLog` 는 누적이라 과거 실행
 *     기록까지 세면 거짓 판정이 난다 (probe-all.js R2 주석의 그 사고). 시작 시 바이트 오프셋과
 *     배열 길이를 기억해 두고 그 뒤만 읽는다.
 *  3. **설정은 스냅샷 → finally 복원 → `config.save()`.** 이 프로브가 만지는 값은 전부
 *     사용자 설정이다. `autoRepairScreen` 을 켠 채 남기면 실사용 Tabby 가 10초마다 화면을
 *     흔든다(2026-09-02 그 이유로 기본값이 다시 꺼졌다). 만든 탭도 닫고, 더럽힌 화면도 치운다.
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

    /** 조건이 참이 될 때까지 폴링 — 참이 된 시각(ms)을 돌려주고, 시간초과면 -1 */
    const waitFor = async (fn, timeoutMs, stepMs) => {
        const t0 = Date.now()
        for (;;) {
            let hit = false
            try { hit = !!fn() } catch { hit = false }
            if (hit) { return Date.now() - t0 }
            if (Date.now() - t0 >= timeoutMs) { return -1 }
            await sleep(stepMs || 200)
        }
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

    /**
     * 터미널 pane 하나를 **활성 탭으로** 만들고 돌려준다 (probe-all.js 의 `focusTerminal` 과 같은 이유).
     *
     * 이 프로브에서는 이유가 하나 더 있다 — `sweepScreens()` 는 **활성 탭의 pane 만** 검사한다
     * (`deck.service.ts:803-818`). 대상 pane 이 활성 탭이 아니면 감시·자동복구가 아예 돌지 않아
     * PR4~PR6 이 전부 "안 돈다" 는 거짓 실패를 낸다. `judge()`·`readScreen()` 도 숨겨진 탭은
     * 컨테이너 폭 0 이라 읽지 않는다(`deck.service.ts:825-833`).
     */
    const focusTerminal = async () => {
        const list = panes()
        if (!list.length) { return null }
        const pane = list[0]
        const owner = ad.app.tabs.find(t => t === pane
            || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0))
        if (owner) { ad.app.selectTab(owner) }
        if (owner && typeof owner.focus === 'function' && owner !== pane) {
            try { owner.focus(pane) } catch { /* 분할 탭이 아니면 무시 */ }
        }
        await sleep(400)
        return pane
    }

    const sidebar = () => document.getElementById('agentdeck-sidebar')

    // ---- 채증 파일(누적) 을 증분으로 읽는 도구 ----
    // `deck.service.ts:112` 의 SNAP_PATH 와 같은 경로. 파일은 append 만 되므로 시작 크기를
    // 기억해 두고 그 뒤 바이트만 읽는다 (전문을 읽어 과거 기록을 세는 것이 실측 사고였다).
    // 경로는 제품에게 묻는다 — 격리 인스턴스는 자기 폴더에 쓴다(`src/diag.ts` 의 `logDir`).
    // 홈으로 만들면 남의 파일을 읽고 "안 찍혔다" 로 거짓 실패한다(2026-09-09 PR4·PR5).
    const SNAP_PATH = (ad.diagPaths && ad.diagPaths().screen) || path.join(os.homedir(), '.agentdeck-screen.log')
    const snapSize = () => {
        try { return fs.statSync(SNAP_PATH).size } catch { return 0 }
    }
    const snapSince = from => {
        try {
            const size = snapSize()
            if (size <= from) { return '' }
            const fd = fs.openSync(SNAP_PATH, 'r')
            try {
                const buf = Buffer.alloc(size - from)
                fs.readSync(fd, buf, 0, buf.length, from)
                return buf.toString('utf8')
            } finally { fs.closeSync(fd) }
        } catch { return '' }
    }
    const countOf = (text, needle) => {
        let n = 0, i = 0
        for (;;) {
            const at = text.indexOf(needle, i)
            if (at < 0) { return n }
            n++
            i = at + needle.length
        }
    }
    /** 진단 로그 증분 — 파일(`~/.agentdeck-diag.log`)과 같은 줄이 메모리에도 쌓인다(`kickLog`) */
    const kickSince = from => (ad.kickLog || []).slice(from)

    /**
     * 화면을 **일부러 깨뜨린다** — 테두리 두 줄을 맞붙여 그려 `❯` 가 들어갈 행을 없앤다.
     * 폭은 둘 다 `cols` 를 꽉 채우므로 폭 기준 판정은 통과하고, "입력할 자리가 있는가"
     * (테두리 사이 간격 ≥ 2) 규칙만 걸린다 — `src/screen.ts` 머리주석의 그 유형이다.
     * probe-all.js R14 가 쓰는 것과 같은 주입이다.
     */
    const breakScreen = pane => {
        const x = pane.frontend.xterm
        const rule = '─'.repeat(x.cols)
        // 줄을 먼저 지우고(`ESC[2K`) 쓴다 — 옛 프레임 잔여가 우리 줄에 섞이면 판정 이유가
        // "맞붙었다" 가 아니라 "섞임" 으로 바뀌어 무엇을 재는지 흐려진다 (probe-all.js R5 의 그 교훈)
        const K = '\u001b[2K'
        // 커서를 **화면 맨 아래로** 내린 다음에 그린다. 실물 입력창은 늘 화면 맨 아래에 있고
        // (`src/screen.ts`: "입력창은 언제나 화면 맨 아래에 있다"), 제품의 잔상 지우기는
        // **하단 16행 안에서만** 테두리를 찾는다(`deck.service.ts:729-740`). 화면 위쪽에 그리면
        // 그 단계가 조용히 아무것도 하지 않고, 그러면 PR8 의 해소가 제품의 잔상 지우기가 아니라
        // pty 쪽 앱의 Ctrl+L 처리에 얹혀 통과하거나 거짓 실패한다.
        // (`xterm.clear()` 뒤에는 커서가 0행이라 실제로 이 상황이 된다 — PR7·PR8 이 그 순서다)
        let pad = ''
        try {
            pad = '\r\n'.repeat(Math.max(0, (x.rows - 1) - x.buffer.active.cursorY))
        } catch {
            pad = ''
        }
        x.write(`${pad}\r\n${K}${rule}\r\n${K}${rule}\r\n${K}`)
    }
    /**
     * 화면을 **다른 방식으로** 깨뜨린다 — 위 테두리 행 한가운데에 옛 프레임 글자를 남긴다 (PR9).
     *
     * 2026-09-09 실사용 스샷의 모양이다. Ctrl+Enter 로 입력창이 여러 줄이 된 뒤 화면이 한 줄
     * 밀리면 앱은 자기가 아는 자리에 테두리를 다시 그리는데, 그 행에 있던 글자는 앱이 덮지
     * 않는 칸에 그대로 남는다. `breakScreen`(테두리 맞붙이기)과 **다른 유형**이라 따로 둔다 —
     * 폭도 맞고 자리도 있어서 옛 판정은 이 모양을 전부 통과시켰다.
     *
     * 전각 글자를 쓰는 것이 중요하다. 한 글자가 두 칸을 먹으므로 읽어온 문자열 길이가 cols 보다
     * 짧아지고, 그래서 판정을 `length == cols` 로 두면 못 잡는다(그렇게 만들었다가 고쳤다).
     */
    const breakScreenGhost = pane => {
        const x = pane.frontend.xterm
        const cols = x.cols
        const K = '\u001b[2K'
        const rule = '─'.repeat(cols)
        // 잔상 3글자(전각 = 6칸)를 왼쪽에서 4칸 지난 자리에 박는다
        const ghost = '─'.repeat(4) + 'ㅇㅇㅇ' + '─'.repeat(Math.max(0, cols - 10))
        let pad = ''
        try {
            pad = '\r\n'.repeat(Math.max(0, (x.rows - 5) - x.buffer.active.cursorY))
        } catch {
            pad = ''
        }
        // 위 테두리(잔상 얹힘) → 입력 3줄 → 아래 테두리. 실사용 스샷과 같은 배치다.
        x.write(`${pad}\r\n${K}${ghost}\r\n${K}❯ ㅇㅇㅇ\r\n${K}  ㅇㅇㅇ\r\n${K}  ㅇ\r\n${K}${rule}\r\n${K}`)
    }
    /** 내가 더럽힌 화면을 치운다 — 안 치우면 다음 프로브가 잔여를 보고 거짓 실패한다 */
    const cleanScreen = pane => {
        try { pane.frontend.xterm.clear() } catch { /* 지원 안 하는 프론트엔드 */ }
    }
    const verdictOf = pane => (ad.judge ? ad.judge(pane) : null)

    /**
     * 화면 감시·복구 경로를 재기 전에 pane 을 **Claude 로 못 박는다** (`__agentdeck.pinAgent`).
     *
     * 2026-09-13 부터 `checkScreen` 은 Claude pane 에서만 돈다(`canRepairComposer`) — Codex 화면을
     * Claude 테두리로 오판해 자동복구가 끼어들던 사고를 막은 게이트다. 그 뒤로 PR4·PR5 는
     * 격리 인스턴스의 PowerShell pane 에 깨진 화면을 그려 놓고 "감시가 안 돈다" 로 **거짓 실패**했다
     * (2026-09-14 실측: judge=broken 인데 채증 0바이트, effectiveId=unknown).
     *
     * 진짜 `claude` 를 띄워 재는 길은 로그인 상태·기동 시간에 기대므로 회귀로 불안정하다.
     * 대신 제품이 연 창구로 신원만 빌린다 — **끝나면 반드시 푼다**(`unpinAgent`).
     */
    const pinnedPanes = new Set()
    const pinClaude = pane => {
        if (!ad.pinAgent) { return false }
        const r = ad.pinAgent(pane, 'claude')
        if (r && r.pinned) { pinnedPanes.add(pane) }
        return !!(r && r.pinned)
    }
    const unpinAll = () => {
        for (const pane of pinnedPanes) {
            try { ad.pinAgent(pane, null) } catch { /* 이미 닫힌 pane */ }
        }
        pinnedPanes.clear()
    }

    // ---- 주입이 흔들리지 않게 하는 도구 (PR8 이 쓴다) ----
    //
    // **PR8 이 "깨진 화면을 만들지 못했다" 로 자주 비었던 원인** — 우리 주입은 `xterm.write` 로
    // 화면에 **직접** 그리는 것이고 pty 쪽 앱(격리 인스턴스는 PowerShell)은 그것을 모른다.
    // 바로 앞 케이스(PR7)가 `ad.repair('active')` 를 부르면 그 안의 `nudgePtyRedraw` 가
    // `session.resize(cols-1, rows)` → 60ms 뒤 원복(`deck.service.ts:2499-2507`)으로 SIGWINCH 를
    // **두 번** 낸다. 그러면 앱은 자기가 기억하는 **절대 좌표**로 커서를 옮겨 프롬프트를 다시
    // 그리고, 그 출력이 우리가 그린 테두리 두 줄을 지우거나 밀어낸다. PR8 을 켜기 직전의
    // `focusTerminal()`(탭 선택 → Tabby 의 refit)도 같은 일을 한다.
    // 도착 시각은 앱 사정이라 **고정 대기로는 못 맞춘다** — 옛 판본은 `sleep(1200)` 한 번 뒤
    // 단 한 번 `judge()` 를 읽었고(그래서 그 한 샘플이 재그리기 창에 겹치면 그대로 SKIP),
    // PR4·PR5 는 같은 주입인데도 폴링(`waitFor`/12초 루프)이라 살아남았다.
    // 그래서 여기서는 ① pty 가 조용해질 때까지 **상태로** 기다리고 ② 판정이 깨짐이 될 때까지
    // 폴링하고 ③ 그 사이 앱이 덮었으면 다시 주입한다.

    /** 출력이 이만큼 조용하면 pty 쪽이 다 그린 것으로 본다 (제품의 SCREEN_CHECK_DEBOUNCE_MS=700 과 같은 취지) */
    const QUIET_MS = 700
    /** 출력 이벤트 누적 카운터 — `deck.service.ts:1045` 에서 output$ 구독마다 +1 된다 */
    const hitsNow = () => {
        try { return (ad.debug ? ad.debug().outputHits : 0) || 0 } catch { return 0 }
    }
    /**
     * pty 출력이 QUIET_MS 동안 멈출 때까지 기다린다. **전 탭 합계**라 다른 탭이 시끄러우면
     * 필요 이상으로 기다리는데, 늦는 것은 안전하고 이른 것은 흔들림이 된다.
     */
    const quietPty = async (timeoutMs = 6000) => {
        const t0 = Date.now()
        let last = hitsNow()
        let since = Date.now()
        for (;;) {
            await sleep(150)
            const now = hitsNow()
            if (now !== last) {
                last = now
                since = Date.now()
            }
            if (Date.now() - since >= QUIET_MS) { return { quiet: true, hits: now, waitedMs: Date.now() - t0 } }
            if (Date.now() - t0 >= timeoutMs) { return { quiet: false, hits: now, waitedMs: Date.now() - t0 } }
        }
    }
    /**
     * 화면 버퍼 꼬리 — **증거 전용이다. 판정에는 절대 쓰지 않는다**(판정은 제품 `judge()` 만).
     * 제품 `readScreen`(`deck.service.ts:918`)과 같은 구간(baseY..baseY+rows-1)을 읽는다.
     */
    const bufferTail = (pane, n = 6) => {
        try {
            const x = pane.frontend.xterm
            const buf = x.buffer.active
            const out = []
            for (let y = buf.baseY; y <= buf.baseY + x.rows - 1; y++) {
                const line = buf.getLine(y)
                const t = String((line && line.translateToString(false)) || '').replace(/\s+$/, '')
                if (t) { out.push(`${y} len=${t.length} ${JSON.stringify(t.slice(0, 24))}`) }
            }
            return out.slice(-n)
        } catch (e) {
            return ['버퍼를 못 읽었다: ' + String((e && e.message) || e)]
        }
    }
    /**
     * **우리가 쓴** 테두리(폭을 꽉 채운 `─` 줄)가 아직 화면에 남아 있는 수. 증거 전용 —
     * 주입이 지워졌는지("앱이 덮었다")와 남아 있는지("썼는데 판정이 안 났다")를 가른다.
     * 제품의 테두리 규칙을 복사한 것이 아니라 `breakScreen` 이 쓴 글자를 그대로 세는 것이다.
     */
    const rulesAlive = pane => {
        try {
            const x = pane.frontend.xterm
            const buf = x.buffer.active
            const want = '─'.repeat(x.cols)
            let n = 0
            for (let y = buf.baseY; y <= buf.baseY + x.rows - 1; y++) {
                const line = buf.getLine(y)
                const t = String((line && line.translateToString(false)) || '').replace(/\s+$/, '')
                if (t === want) { n++ }
            }
            return n
        } catch { return -1 }
    }
    /**
     * 깨진 화면을 **확실히** 만든다 — 조용해질 때까지 기다렸다 주입하고, 판정이 깨짐이 될 때까지
     * 폴링하고, 안 되면 다시 주입한다. 시간(`sleep`)으로 맞추지 않는 것이 요점이다.
     *
     * 돌려주는 `samples` 에는 시도마다 **그 순간의 실제 관측값**이 들어간다 (판정 결과·출력 카운터
     * 증분·우리 테두리 생존 수·버퍼 꼬리). 조건을 못 만들었을 때 "만들지 못했다" 한 줄로 끝내지
     * 않으려면 이 값들이 있어야 한다.
     */
    const forceBroken = async (pane, attempts = 3, inject = breakScreen) => {
        const samples = []
        for (let i = 1; i <= attempts; i++) {
            const q = await quietPty()
            const hitsBefore = hitsNow()
            inject(pane)
            const waited = await waitFor(() => {
                const v = verdictOf(pane)
                return !!(v && v.broken)
            }, 2500, 100)
            samples.push({
                attempt: i,
                quiet: q.quiet,
                quietWaitMs: q.waitedMs,
                brokenAfterMs: waited,
                hits: [hitsBefore, hitsNow()],
                verdict: verdictOf(pane),
                rulesAlive: rulesAlive(pane),
                tail: bufferTail(pane),
            })
            if (waited >= 0) { return { ok: true, attempts: i, samples } }
        }
        return { ok: false, attempts, samples }
    }

    const cfg = ad.config.store.agentDeck
    // 이 프로브가 만지는 **사용자 설정 전부**. finally 에서 통째로 되돌린다.
    const saved = {
        noTabRecovery: cfg.noTabRecovery,
        screenWatch: cfg.screenWatch,
        autoRepairScreen: cfg.autoRepairScreen,
        autoRepairMinStreak: cfg.autoRepairMinStreak,
        autoRepairCooldownMs: cfg.autoRepairCooldownMs,
        autoRepairMaxPerTab: cfg.autoRepairMaxPerTab,
        repairHard: cfg.repairHard,
        repairSendRedrawKey: cfg.repairSendRedrawKey,
    }
    const savedRecoverTabs = ad.config.store.recoverTabs
    /** finally 에서 되돌릴 것들 — 만든 탭, 랩한 함수, 더럽힌 pane */
    const madeTabs = []
    const unwrap = []
    const dirtyPanes = new Set()
    /** PR5 에서 자동복구가 실제로 돌았나 — PR6(쿨다운·상한)의 전제다 */
    let autoRepairHappened = false

    try {
        // ============================================================ PR1 작업 루트 프로필 존재
        //
        // 판정 수치 — `profile.service.ts` 가 **매 기동 강제하는 세 가지**만 pass 조건으로 둔다:
        //   ① `config.store.profiles` 에 id `agentdeck:root` 가 있고 `type === 'local'`
        //   ② `options.cwd` 가 비어 있지 않다 (서비스가 빈 값이면 채운다 — :56-59)
        //   ③ `options.args.length >= 1` (:63-66) 이고 `rootProfileEnv` 의 키가 **전부** 있다 (:68-74)
        //
        // 이름·command·cwd 의 **값 일치**는 pass 조건이 아니다. 서비스는 프로필을 만들 때만
        // 설정값을 쓰고, 그 뒤에는 "사용자가 설정 UI 에서 손댔을 수 있으므로 비어 있는 값만
        // 보정한다"(:51). 즉 cfg 를 나중에 바꿔도 기존 프로필은 안 덮는 것이 **의도**다.
        // 그래서 불일치는 `drift` 로 증거에만 남긴다 — 여기서 실패로 세면 의도를 회귀로 만든다.
        {
            const profiles = ad.config.store.profiles || []
            const prof = profiles.find(p => p && p.id === 'agentdeck:root')
            if (!cfg.rootProfile || !cfg.rootProfileCwd) {
                // 기본값이 꺼짐이다 — "남의 PC 에 설치되자마자 프로필을 심지 않는다"(config.ts:333-339).
                // 프로브가 여기서 cfg 를 켜도 프로필은 안 생긴다: `ensureProfile()` 은 `app.ready$`
                // 에서 **한 번만** 돈다(profile.service.ts:22). 밖에서 config 에 넣고 재기동해야 판정된다.
                add('PR1', '작업 루트 프로필 존재', null,
                    `기능이 꺼져 있다 (rootProfile=${!!cfg.rootProfile} cwd=${JSON.stringify(cfg.rootProfileCwd || '')})`
                    + ' — 그게 기본이고 정상 상태다. 판정하려면 config 에 rootProfile:true + rootProfileCwd 를 넣고 재기동할 것'
                    + ` (프로필 존재 여부만 참고: ${prof ? '있다' : '없다'})`,
                    { profileIds: profiles.map(p => p && p.id), found: prof || null })
            } else if (!prof) {
                add('PR1', '작업 루트 프로필 존재', false,
                    'rootProfile 이 켜져 있고 cwd 도 채워져 있는데 profiles 에 agentdeck:root 가 없다',
                    { profileIds: profiles.map(p => p && p.id), cwd: cfg.rootProfileCwd })
            } else {
                const opt = prof.options || {}
                const wantEnv = cfg.rootProfileEnv || {}
                const gotEnv = opt.env || {}
                const envMissing = Object.keys(wantEnv).filter(k => gotEnv[k] === undefined)
                const hard = {
                    typeLocal: prof.type === 'local',
                    cwdFilled: !!opt.cwd,
                    argsFilled: Array.isArray(opt.args) && opt.args.length >= 1,
                    envKeysPresent: envMissing.length === 0,
                }
                const drift = {
                    name: prof.name === (cfg.rootProfileName || 'Agent Root') ? null : [prof.name, cfg.rootProfileName],
                    command: opt.command === cfg.rootProfileCommand ? null : [opt.command, cfg.rootProfileCommand],
                    cwd: opt.cwd === cfg.rootProfileCwd ? null : [opt.cwd, cfg.rootProfileCwd],
                    args: JSON.stringify(opt.args) === JSON.stringify(cfg.rootProfileArgs || [])
                        ? null : [opt.args, cfg.rootProfileArgs],
                }
                const driftKeys = Object.keys(drift).filter(k => drift[k])
                const ok = Object.keys(hard).every(k => hard[k])
                add('PR1', '작업 루트 프로필 존재', ok,
                    (ok ? '프로필이 있고 서비스가 강제하는 3항목(type/cwd/args+env) 전부 충족'
                        : `강제 항목 위반: ${Object.keys(hard).filter(k => !hard[k]).join(', ')}`)
                    + (driftKeys.length
                        ? ` / 설정값과 다른 항목 ${driftKeys.length}개 = ${driftKeys.join(',')} (사용자 편집 존중이 의도 — 실패 아님)`
                        : ' / 설정값과도 전부 일치'),
                    { hard, drift, envMissing, profile: prof })
            }
        }

        // ============================================================ PR2 기본 프로필 지정 + 새 탭이 그 프로필로 열리나
        //
        // 판정 수치 —
        //   ① 사이드바 `+ 새 탭` 클릭 → 6초 안에 탭이 1개 늘고, 그 탭의 `profile.id` 가
        //      `config.store.terminal.profile` 과 **같다** (`openNewTab()` 이 그 값을 본다:2568-2575)
        //   ② `rootProfile` 이 켜져 있으면 `terminal.profile === 'agentdeck:root'`
        //      — 단 `rootProfileClaimed` 가 이미 true 인데 값이 다르면 **사용자가 바꾼 것**이고
        //        서비스는 그것을 존중한다(profile.service.ts:78-82) → 실패가 아니라 판정 불가.
        //
        // 열었으면 **닫는다** — 남기면 다음 프로브가 다른 탭 구성을 보고 거짓 판정한다.
        {
            const newBtn = sidebar() && sidebar().querySelector('.ad-new')
            const wanted = ad.config.store.terminal && ad.config.store.terminal.profile
            const known = (ad.config.store.profiles || []).map(p => p && p.id)
            if (!newBtn) {
                add('PR2', '기본 프로필 지정 + 새 탭', null, '사이드바가 없다 (agentDeck.enabled 확인)', null)
            } else {
                const prevActive = ad.app.activeTab
                const before = ad.app.tabs.slice()
                newBtn.click()
                const waited = await waitFor(() => ad.app.tabs.length > before.length, 6000, 250)
                const opened = ad.app.tabs.find(t => before.indexOf(t) < 0)
                if (!opened) {
                    add('PR2', '기본 프로필 지정 + 새 탭', null,
                        `클릭 후 ${6000}ms 안에 탭이 늘지 않았다 (프로필이 하나도 없거나 스폰이 막혔다)`,
                        { wanted, known, tabs: ad.app.tabs.length })
                } else {
                    madeTabs.push(opened)
                    // **프로필은 래퍼가 아니라 자식 터미널 탭에 붙는다.**
                    // `app.tabs` 의 원소는 `SplitTabComponent` 이고 `profile` 은 그 안의
                    // `TerminalTabComponent` 에 있다 — 래퍼에서 읽으면 항상 undefined 다
                    // (2026-09-08 실측: root=null / kid='local:test-ps'. 이 리포가
                    //  docs/DEVELOPMENT.md 에 적어 둔 "탭은 래퍼에 싸여 있다" 함정과 같은 것).
                    const profileOf = t => {
                        if (t && t.profile) { return t.profile.id }
                        const kids = t && typeof t.getAllTabs === 'function' ? t.getAllTabs() : []
                        for (const k of kids) {
                            if (k && k.profile) { return k.profile.id }
                        }
                        return null
                    }
                    const gotId = profileOf(opened)
                    const followed = gotId === wanted
                    // 지정된 프로필이 목록에 없으면 `openNewTab` 은 profiles[0] 로 폴백한다 —
                    // 그건 설계된 동작이라 불일치를 실패로 세지 않는다
                    const wantedExists = known.indexOf(wanted) >= 0
                    // rootProfile 쪽 부가 판정
                    let rootNote = 'rootProfile 이 꺼져 있어 기본 프로필 id 검사는 생략'
                    let rootOk = null
                    if (cfg.rootProfile) {
                        rootOk = wanted === 'agentdeck:root'
                        rootNote = rootOk
                            ? 'terminal.profile 이 agentdeck:root 를 가리킨다'
                            : (cfg.rootProfileClaimed
                                ? '사용자가 기본 프로필을 다른 것으로 바꿨다 — 서비스는 한 번만 지정하고 그 뒤엔 존중한다'
                                : '켜져 있는데도 기본 프로필로 지정되지 않았다')
                        if (!rootOk && cfg.rootProfileClaimed) { rootOk = null }
                    }
                    const pass = !wantedExists ? null : (rootOk === false ? false : followed)
                    add('PR2', '기본 프로필 지정 + 새 탭', pass,
                        (!wantedExists
                            ? `terminal.profile(${wanted}) 이 profiles 에 없어 폴백이 돌았다 — 설계된 동작`
                            : followed
                                ? `+ 새 탭 이 terminal.profile(${wanted}) 로 열렸다 (${waited}ms)`
                                : `열린 탭의 프로필이 ${gotId} — terminal.profile(${wanted}) 과 다르다`)
                        + ` / ${rootNote}`,
                        { wanted, gotId, wantedExists, known, rootProfile: !!cfg.rootProfile, rootProfileClaimed: !!cfg.rootProfileClaimed, waitedMs: waited })
                    // 오염 방지 — 만든 탭을 즉시 닫고 원래 활성 탭으로 돌아온다
                    try { await ad.app.closeTab(opened, false) } catch { /* 이미 닫혔다 */ }
                    madeTabs.length = 0
                    if (prevActive && ad.app.tabs.indexOf(prevActive) >= 0) { ad.app.selectTab(prevActive) }
                    await sleep(500)
                }
            }
        }

        // ============================================================ PR3 noTabRecovery 강제
        //
        // 판정 수치 — `noTabRecovery=true` 인 상태에서 누가 `recoverTabs` 를 켜도
        // `config.changed$` → `enforce()` 가 **1500ms 안에** false 로 되돌린다
        // (`recovery.service.ts:34-35, 53-59`).
        //
        // **함정 (docs/DEVELOPMENT.md)**: yaml 에 키가 없는 것은 "안 써진" 것이 아니라
        // "기본값과 같다" 는 뜻이고, `test-instance.ps1` 은 매 기동마다 config 를 새로 쓴다.
        // 그래서 판정은 **메모리의 `config.store` 실값**으로만 한다 — 파일은 보지 않는다.
        //
        // `localStorage.tabsRecovery` 지우기는 토글 진입점(`setNoTabRecovery`)에만 있는데
        // 그 서비스는 `__agentdeck` 에 노출돼 있지 않아 프로브가 부를 수 없다. 대신 관측 가능한
        // 불변식을 본다 — Tabby 의 `saveTabs()` 는 `config.store.recoverTabs` 가 거짓이면
        // 아무것도 쓰지 않으므로(tabby-core/dist/index.js:7695-7700), 강제가 유지되는 동안
        // `tabsRecovery` 는 다시 생기지 않아야 한다.
        {
            const lsBefore = typeof window.localStorage.tabsRecovery === 'string'
            cfg.noTabRecovery = true
            ad.config.store.recoverTabs = true
            await ad.config.save()
            const flipped = await waitFor(() => ad.config.store.recoverTabs === false, 1500, 100)
            const forced = ad.config.store.recoverTabs === false
            const lsAfter = typeof window.localStorage.tabsRecovery === 'string'
            // 원복 순서가 중요하다 — noTabRecovery 를 먼저 끄지 않으면 enforce 가 다시 뒤집는다
            cfg.noTabRecovery = saved.noTabRecovery
            ad.config.store.recoverTabs = savedRecoverTabs
            await ad.config.save()
            await sleep(200)
            const restored = ad.config.store.recoverTabs === savedRecoverTabs
                && cfg.noTabRecovery === saved.noTabRecovery
            add('PR3', 'noTabRecovery 강제', forced && !(!lsBefore && lsAfter),
                (forced ? `recoverTabs=true 로 되돌려도 ${flipped}ms 안에 false 로 강제됐다`
                    : 'noTabRecovery=true 인데 recoverTabs 가 true 로 남았다 (enforce 가 안 돈다)')
                + ` / tabsRecovery: ${lsBefore ? '있음' : '없음'} → ${lsAfter ? '있음' : '없음'}`
                + ` / 원복 ${restored ? 'OK' : '실패'}`,
                { forced, flippedMs: flipped, lsBefore, lsAfter, restored, savedRecoverTabs })
        }

        // ============================================================ PR4 화면 감시가 돌고 있나
        //
        // 판정 수치 — 깨진 화면을 주입하면 **8초 안에** 채증 파일 증분에 `detect 깨짐` 이 나타난다.
        // 검사는 `SCREEN_SWEEP_MS`(2000ms) 그물이므로 1~2회 안에 잡혀야 한다.
        // 화면을 치우면 다시 5초 안에 `detect 스스로 복구됨` 이 붙는다(부가 관측).
        //
        // 여기서는 `autoRepairScreen` 을 **일부러 끈다** — 감지·채증(`screenWatch`)과 복구는
        // 분리된 기능이고(`screenObservingEnabled()` = `screenWatch !== false || autoRepairScreen`),
        // 복구가 끼어들면 "감시가 돌았나" 가 "복구가 돌았나" 로 섞인다.
        // 파일은 누적이라 **시작 오프셋 이후만** 읽는다 (probe-all.js R2 의 그 사고 방지).
        {
            const pane = await focusTerminal()
            if (!pane) {
                add('PR4', '화면 감시 주기 검사', null, '터미널 pane 이 없다', null)
            } else if (cfg.screenWatch === false) {
                add('PR4', '화면 감시 주기 검사', null,
                    'screenWatch 가 꺼져 있다 — 사용자가 끈 상태라면 정상이다 (감시가 안 도는 것이 맞다)', null)
            } else if (!pinClaude(pane)) {
                add('PR4', '화면 감시 주기 검사', null,
                    'pinAgent 진단구가 없다 (낡은 dist) — 감시는 Claude pane 에서만 돈다', null)
            } else {
                cfg.autoRepairScreen = false
                const from = snapSize()
                dirtyPanes.add(pane)
                breakScreen(pane)
                const detectMs = await waitFor(() => snapSince(from).indexOf('detect 깨짐') >= 0, 8000, 250)
                const brokenSeen = verdictOf(pane)
                cleanScreen(pane)
                const healMs = await waitFor(() => snapSince(from).indexOf('detect 스스로 복구됨') >= 0, 5000, 250)
                dirtyPanes.delete(pane)
                const inc = snapSince(from)
                add('PR4', '화면 감시 주기 검사', detectMs >= 0,
                    (detectMs >= 0
                        ? `주입 ${detectMs}ms 뒤 채증 증분에 'detect 깨짐' 이 찍혔다 (그물 간격 2000ms)`
                        : '8초 동안 채증 증분에 아무 것도 안 찍혔다 — 주기 검사가 돌지 않는다')
                    + ` / 화면 치운 뒤 'detect 스스로 복구됨' ${healMs >= 0 ? healMs + 'ms' : '미관측'}`
                    + ` / judge=${brokenSeen ? (brokenSeen.broken ? 'broken' : 'ok') : 'null'}`,
                    { detectMs, healMs, incBytes: inc.length, autoBefore: countOf(inc, 'auto-before'), verdict: brokenSeen })
            }
        }

        // ============================================================ PR5 자동 복구 — 임계 연속(streak)
        //
        // 판정 수치 두 개를 **동시에** 만족해야 통과다:
        //   ① `judge()` 가 먼저 `broken:true` 를 낸다 (주입이 실제로 깨진 화면이 맞다)
        //   ② `detect 깨짐` 이 찍힌 시점에 `auto-before` 는 **아직 0** 이고,
        //      그 뒤 12초 안에 `auto-before` 가 1 이 된다
        //      → 1회 감지로는 안 돌고 연속 판정(`autoRepairMinStreak`)을 채운 뒤에 돈다.
        //
        // 왜 이 게이트가 있나 — 2초 그물이라 TUI 가 한 프레임을 여러 write 로 그리는 도중을
        // 잡으면 멀쩡한 화면도 한 번은 깨져 보인다. 그 중간 프레임에 키를 쏘면 타이핑 중에
        // 화면이 흔들린다 (2026-09-02 항목 27 이 이 조건이 없어서 생긴 일이다).
        //
        // 값은 **일시 조정**한다: minStreak=2(기본값), cooldown=1000, maxPerTab=0(무제한).
        // 쿨다운·상한이 이 케이스의 실패 원인이 되면 streak 판정이 오염된다 — 그 둘은 PR6 이 본다.
        // "복구가 판정을 해소하나" 는 PR8 이 소유한다. 여기서는 `auto-after` 를 증거로만 남긴다.
        {
            const pane = await focusTerminal()
            if (!pane) {
                add('PR5', '자동 복구 — 임계 연속(streak)', null, '터미널 pane 이 없다', null)
            } else if (!ad.judge) {
                add('PR5', '자동 복구 — 임계 연속(streak)', null, 'judge 진단구가 없다 (구버전 빌드)', null)
            } else if (!pinClaude(pane)) {
                add('PR5', '자동 복구 — 임계 연속(streak)', null,
                    'pinAgent 진단구가 없다 (낡은 dist) — 복구는 Claude pane 에서만 돈다', null)
            } else {
                const minStreak = cfg.autoRepairMinStreak
                cfg.screenWatch = true
                cfg.autoRepairScreen = true
                cfg.autoRepairMinStreak = 2
                cfg.autoRepairCooldownMs = 1000
                cfg.autoRepairMaxPerTab = 0
                const from = snapSize()
                dirtyPanes.add(pane)
                breakScreen(pane)
                await sleep(900)
                const vBefore = verdictOf(pane)
                let gateHeld = false
                let repairedMs = -1
                const t0 = Date.now()
                while (Date.now() - t0 < 12000) {
                    const inc = snapSince(from)
                    const autoBefore = countOf(inc, 'auto-before')
                    if (autoBefore === 0 && inc.indexOf('detect 깨짐') >= 0) {
                        // 감지는 됐는데 아직 복구는 안 돌았다 = streak 게이트가 잡고 있다
                        gateHeld = true
                    }
                    if (autoBefore >= 1) { repairedMs = Date.now() - t0; break }
                    await sleep(200)
                }
                // 복구 뒤 채증(`auto-after`)은 SNAP_AFTER_MS(1500ms) 뒤에 붙는다
                const afterMs = await waitFor(() => snapSince(from).indexOf('auto-after') >= 0, 3000, 200)
                const vAfter = verdictOf(pane)
                const inc = snapSince(from)
                autoRepairHappened = repairedMs >= 0
                cleanScreen(pane)
                dirtyPanes.delete(pane)
                const broken = !!(vBefore && vBefore.broken)
                add('PR5', '자동 복구 — 임계 연속(streak)',
                    !broken ? null : (gateHeld && repairedMs >= 0),
                    !broken
                        ? '깨진 화면을 만들지 못했다 (judge 가 broken 을 안 낸다 — 앱이 곧바로 다시 그렸을 수 있다)'
                        : (repairedMs < 0
                            ? '12초 안에 자동 복구가 돌지 않았다 (auto-before 증분 0)'
                            : gateHeld
                                ? `감지 시점에는 안 돌고 ${repairedMs}ms 뒤(연속 2회 충족) 복구가 돌았다`
                                : `복구는 돌았지만(${repairedMs}ms) 첫 감지와 같은 순간이었다 — streak 게이트가 없다`)
                    + ` / auto-after ${afterMs >= 0 ? afterMs + 'ms' : '미관측'}`
                    + ` / judge broken ${broken} → ${vAfter ? vAfter.broken : 'null'}`,
                    {
                        cfgMinStreakOriginal: minStreak, gateHeld, repairedMs, afterMs,
                        autoBefore: countOf(inc, 'auto-before'), autoAfterText: (inc.match(/auto-after[^\n]*/g) || []).slice(-2),
                        vBefore, vAfter,
                    })
            }
        }

        // ============================================================ PR6 자동 복구 — 쿨다운 · 상한
        //
        // 판정 수치 (두 단계 모두 통과해야 pass) —
        //   ① 쿨다운: `autoRepairCooldownMs = 60000` 으로 올려 두고 깨진 화면을 다시 주입 →
        //      7초(그물 3회 = streak 충족) 동안 `auto-before` 증분이 **0** 이어야 한다.
        //   ② 상한: cooldown=1000 으로 내리고 `autoRepairMaxPerTab = 1` →
        //      PR5 에서 이미 1회 썼으므로 `count >= max` 로 막혀야 한다. 7초 동안 증분 0 +
        //      진단 증분에 `한도 도달` 이 있으면 확정 증거다(`diagOnce('auto-repair-cap')`).
        //
        // 전제 — PR5 에서 자동복구가 **실제로 한 번 돌았어야** 쿨다운/상한을 잴 수 있다
        // (`autoRepairAt`·`autoRepairCount` 는 서비스 내부 Map 이라 프로브가 읽거나 지울 수 없다).
        // 안 돌았으면 판정 불가로 둔다 — "안 돌았다" 를 "쿨다운이 막았다" 로 읽으면 거짓 통과다.
        {
            const pane = await focusTerminal()
            if (!pane) {
                add('PR6', '자동 복구 — 쿨다운·상한', null, '터미널 pane 이 없다', null)
            } else if (!autoRepairHappened) {
                add('PR6', '자동 복구 — 쿨다운·상한', null,
                    'PR5 에서 자동 복구가 한 번도 돌지 않았다 — 쿨다운·상한의 전제(직전 복구 1회)가 없다', null)
            } else {
                // ---- ① 쿨다운 ----
                cfg.autoRepairScreen = true
                cfg.autoRepairMinStreak = 2
                cfg.autoRepairCooldownMs = 60000
                cfg.autoRepairMaxPerTab = 0
                const from1 = snapSize()
                dirtyPanes.add(pane)
                breakScreen(pane)
                await sleep(7000)
                const inc1 = snapSince(from1)
                const cool = { detected: inc1.indexOf('detect 깨짐') >= 0, repairs: countOf(inc1, 'auto-before') }
                cleanScreen(pane)
                await sleep(1200)

                // ---- ② 상한 ----
                const kickFrom = (ad.kickLog || []).length
                cfg.autoRepairCooldownMs = 1000
                cfg.autoRepairMaxPerTab = 1
                const from2 = snapSize()
                breakScreen(pane)
                await sleep(7000)
                const inc2 = snapSince(from2)
                const capLine = kickSince(kickFrom).filter(l => l.indexOf('한도 도달') >= 0)
                const cap = { detected: inc2.indexOf('detect 깨짐') >= 0, repairs: countOf(inc2, 'auto-before'), capLine: capLine.slice(-1) }
                cleanScreen(pane)
                dirtyPanes.delete(pane)

                const ok = cool.repairs === 0 && cap.repairs === 0
                add('PR6', '자동 복구 — 쿨다운·상한', ok,
                    `쿨다운 60000ms: 7초간 복구 ${cool.repairs}회 (감지 ${cool.detected ? 'O' : 'X'})`
                    + ` / 상한 maxPerTab=1(이미 1회 사용): 7초간 복구 ${cap.repairs}회`
                    + `${cap.capLine.length ? " + 진단에 '한도 도달' 찍힘" : " (진단 '한도 도달' 줄은 못 봤다 — diagOnce 라 이미 찍혔을 수 있다)"}`
                    + (ok ? '' : ' — 게이트가 안 잡는다'),
                    { cool, cap })
            }
        }

        // ============================================================ PR7 수동 복구 4단계 (repairHard · repairSendRedrawKey)
        //
        // 판정 수치 — 조합 두 개로 갈리는 것 넷:
        //   A) hard=false, redrawKey=true  → `sendInput` 에 `0x0C`(Ctrl+L) 가 **1회 이상** 나가고,
        //                                     스크롤백은 남는다 (`baseY > 0` 유지)
        //   B) hard=true,  redrawKey=false → Ctrl+L 이 **0회**, `xterm.reset()` 으로
        //                                     스크롤백이 날아가 `baseY === 0`
        //
        // `sendInput` 은 랩해서 **기록만 하고 pty 로는 보내지 않는다** — 실제로 Ctrl+L 을 셸에
        // 넣으면 화면이 지워져 같은 케이스에서 재는 스크롤백 측정과 섞인다.
        // 범위는 `repair('active')` — `all` 은 다른 탭까지 hard 리셋해 뒤 프로브에 여파가 간다.
        // 그래서 대상 pane 을 **활성 탭으로 먼저 만든다**(active 는 활성 탭만 본다).
        //
        // 자동 경로는 여기서부터 끈다 — 자동복구가 끼어들면 수동 판정이 오염된다.
        {
            cfg.autoRepairScreen = false
            const pane = await focusTerminal()
            const x = pane && pane.frontend.xterm
            if (!pane || !x) {
                add('PR7', '수동 복구 4단계', null, '터미널 pane 이 없다', null)
            } else {
                const orig = pane.sendInput
                const log = []
                pane.sendInput = data => { log.push(String(data)) }
                unwrap.push(() => { pane.sendInput = orig })
                const CTRL_L = '\u000c'
                /** 스크롤백을 만든다 — reset() 이 지우는 대상이 실제로 있어야 판정이 성립한다 */
                const fill = () => {
                    const n = (x.rows || 24) + 20
                    const lines = []
                    for (let i = 0; i < n; i++) { lines.push('ad-probe filler ' + i) }
                    x.write('\r\n' + lines.join('\r\n') + '\r\n')
                }
                dirtyPanes.add(pane)

                // ---- A) hard=false + redrawKey=true ----
                cfg.repairHard = false
                cfg.repairSendRedrawKey = true
                fill()
                await sleep(400)
                const baseA0 = x.buffer.active.baseY
                log.length = 0
                ad.repair('active')
                await sleep(900)   // REPAIR_REDRAW_DELAY_MS(180) + rAF 2회 + 여유
                const a = {
                    ctrlL: log.filter(d => d.indexOf(CTRL_L) >= 0).length,
                    baseYBefore: baseA0,
                    baseYAfter: x.buffer.active.baseY,
                    bufLen: x.buffer.active.length,
                }
                // 스크롤백 보존 판정은 `> 0` 로 둔다 — fit() 이 행수를 바꾸면 baseY 가 몇 칸
                // 움직일 수 있어 동등비교는 하네스 산물로 깨진다
                a.pass = a.ctrlL >= 1 && a.baseYBefore > 0 && a.baseYAfter > 0

                // ---- B) hard=true + redrawKey=false ----
                cfg.repairHard = true
                cfg.repairSendRedrawKey = false
                fill()
                await sleep(400)
                const baseB0 = x.buffer.active.baseY
                log.length = 0
                ad.repair('active')
                await sleep(1000)
                const b = {
                    ctrlL: log.filter(d => d.indexOf(CTRL_L) >= 0).length,
                    baseYBefore: baseB0,
                    baseYAfter: x.buffer.active.baseY,
                    bufLen: x.buffer.active.length,
                }
                b.pass = b.ctrlL === 0 && b.baseYBefore > 0 && b.baseYAfter === 0

                cfg.repairHard = saved.repairHard
                cfg.repairSendRedrawKey = saved.repairSendRedrawKey
                pane.sendInput = orig
                unwrap.length = 0
                cleanScreen(pane)
                dirtyPanes.delete(pane)
                await sleep(300)
                add('PR7', '수동 복구 4단계', a.pass && b.pass,
                    `A(hard=false,redraw=true): Ctrl+L ${a.ctrlL}회, baseY ${a.baseYBefore}→${a.baseYAfter} (스크롤백 보존 기대)`
                    + ` / B(hard=true,redraw=false): Ctrl+L ${b.ctrlL}회, baseY ${b.baseYBefore}→${b.baseYAfter} (0 기대)`
                    + (a.pass && b.pass ? '' : ' — 조합이 동작으로 갈리지 않는다'),
                    { a, b })
            }
        }

        // ============================================================ PR8 복구가 판정을 실제로 해소하나
        //
        // 판정 수치 — 깨진 화면을 **확실히** 만든 뒤(`forceBroken`: 조용해질 때까지 대기 → 주입 →
        // `judge().broken` 이 될 때까지 폴링 → 안 되면 재주입, 최대 3회) `repair('all')` 을 부르고
        // `judge().broken === false` 가 될 때까지 5초 폴링. 해소되면 그 시각(ms)을 증거에 남긴다.
        //
        // **R14 와 중복이 아니다 — 재는 것이 다르다.**
        //   R14(`probe-all.js:290-291`)는 판정 전에 `cfg.repairHard = true` 로 **바꿔** 놓고 잰다.
        //   그 경로는 `xterm.reset()`(`deck.service.ts:656-662`)으로 화면을 통째로 날리므로
        //   "복구했다" 가 사실상 보장된다. R14 주석 자체가 그 이유를 적어 뒀다 —
        //   hard=false 면 우리가 써 넣은 줄이 스크롤백에 남아 첫 판본이 거짓 실패를 냈다.
        //   PR8 은 반대로 **사용자 기본값(hard=false, redrawKey=true)** 그대로 둔다. 그러면
        //   실제로 도는 것은 `clearInputArea`(`deck.service.ts:723-755`, 입력창 블록 첫 행부터
        //   `ESC[J`) + `nudgePtyRedraw` + `Ctrl+L` 이고, 이것이 실사용 ↻ 경로다.
        //   즉 R14 = hard 갈래, PR8 = soft(기본) 갈래. 지우면 기본 경로가 무회귀 상태가 된다.
        //
        // `repair('active')` 가 아니라 `'all'` 인 이유 — active 는 활성 탭만 본다(실측 함정,
        // probe-all.js R14 주석). 대상 pane 을 활성 탭으로 만들어 두고 'all' 로 확실히 태운다.
        // 실패했을 때 원인을 가를 수 있게 진단 증분에서 4단계 흔적(`clear input area`,
        // `repair redraw-key`)을 같이 남긴다 — "경로가 안 돌았다" 와 "돌았는데 안 풀렸다" 는 다른 버그다.
        {
            // 자동 경로를 여기서 **다시** 못박는다 — 자동복구가 먼저 해소하면 우리 `repair()` 가
            // 한 일이 아닌데 통과가 난다. PR7 이 끄고 나오지만 PR7 이 일찍 빠져나갈 수도 있다.
            cfg.autoRepairScreen = false
            const pane = await focusTerminal()
            if (!pane || !ad.judge) {
                add('PR8', '복구가 판정을 해소하나', null,
                    !pane ? '터미널 pane 이 없다' : 'judge 진단구가 없다 (구버전 빌드)', null)
            } else {
                const kickFrom = (ad.kickLog || []).length
                const from = snapSize()
                dirtyPanes.add(pane)
                const made = await forceBroken(pane, 3)
                const last = made.samples[made.samples.length - 1] || {}
                if (!made.ok) {
                    // **"만들지 못했다" 한 줄로 끝내지 않는다.** 못 만든 이유는 셋 중 하나이고
                    // 관측값으로 갈린다:
                    //  ① judge 가 null = 화면을 읽지 못했다 (숨은 탭이라 컨테이너 폭 0, 또는 cols<=1.
                    //     제품이 그 조건에서 판정을 거부한다 — `deck.service.ts:909-916`)
                    //  ② 우리 테두리가 사라졌다(rulesAlive=0) = pty 쪽 앱이 덮어 그렸다.
                    //     출력 카운터 증분(hits)이 그 증거다
                    //  ③ 테두리는 남아 있는데 broken 이 아니다 = 판정 규칙이 이 모양을 안 잡는다
                    //     (제품 회귀일 수 있다 — 그때는 tail 을 그대로 리포트에 남겨 사람이 본다)
                    const host = (() => {
                        try {
                            const p = pane.frontend.xterm.element.parentElement
                            return { w: p.clientWidth, h: p.clientHeight }
                        } catch { return null }
                    })()
                    cleanScreen(pane)
                    dirtyPanes.delete(pane)
                    const why = !last.verdict
                        ? '화면을 읽지 못했다 (judge=null — 숨은 탭이거나 xterm 폭이 1)'
                        : (last.rulesAlive === 0
                            ? '주입한 테두리가 사라졌다 — pty 쪽 앱이 그 자리를 다시 그렸다'
                            : '테두리는 남아 있는데 broken 판정이 나지 않았다 (판정 규칙 확인 필요)')
                    add('PR8', '복구가 판정을 해소하나', null,
                        `깨진 화면을 만들지 못했다 (${made.attempts}회 시도) — ${why}`
                        + ` / 마지막 관측: judge=${last.verdict ? JSON.stringify(last.verdict.reasons) : 'null'}`
                        + ` cols=${last.verdict ? last.verdict.cols : '?'}`
                        + ` 테두리 생존=${last.rulesAlive} 출력카운터=${JSON.stringify(last.hits)}`
                        + ` 대기중 조용함=${last.quiet}`,
                        { attempts: made.attempts, samples: made.samples, host, tail: last.tail })
                } else {
                    const vBefore = last.verdict
                    ad.repair('all')
                    // 고정 대기 대신 **상태로** 기다린다. `repair()` 는 rAF 두 번 뒤에 돌고
                    // (`deck.service.ts:591`) 그 안에서 Ctrl+L 은 180ms 뒤에 나가므로
                    // (`REPAIR_REDRAW_DELAY_MS`), 해소 시각은 앱 사정이다. 풀리면 즉시 나오니
                    // 통과일 때는 5초를 다 쓰지 않는다
                    const clearedMs = await waitFor(() => {
                        const v = verdictOf(pane)
                        return !!(v && !v.broken)
                    }, 5000, 100)
                    const vAfter = verdictOf(pane)
                    // 꼬리는 **치우기 전에** 뜬다 — cleanScreen 뒤에 읽으면 빈 화면이 증거로 남는다
                    const tailAfter = bufferTail(pane)
                    // 채증 짝(`manual-before`/`manual-after`)이 파일에 붙는 것은 복구 1.5초 뒤다
                    // (`SNAP_AFTER_MS`). 판정이 먼저 풀리면 그 줄이 아직 없어 증거가 비므로
                    // **증거만** 기다린다 — 판정은 위에서 끝났고 이 대기는 결과를 바꾸지 않는다
                    const snapMs = await waitFor(() => snapSince(from).indexOf('manual-after') >= 0, 2500, 200)
                    const inc = snapSince(from)
                    const kick = kickSince(kickFrom)
                    const steps = {
                        clearInputArea: kick.some(l => l.indexOf('clear input area') >= 0),
                        redrawKey: kick.some(l => l.indexOf('repair redraw-key') >= 0),
                        manualAfter: (inc.match(/manual-after[^\n]*/g) || []).slice(-1),
                    }
                    const ok = clearedMs >= 0 && !!(vAfter && !vAfter.broken)
                    // 더럽힌 화면은 반드시 치운다 — 안 치우면 다음 실행의 PR4·R2 가 잔여를 보고
                    // 거짓 실패한다 (probe-all.js R14 주석의 실측 사고)
                    cleanScreen(pane)
                    dirtyPanes.delete(pane)
                    await sleep(300)
                    add('PR8', '복구가 판정을 해소하나', ok,
                        (ok ? `repair(all) 후 ${clearedMs}ms 에 judge 가 broken:false 로 돌아왔다`
                            : '복구 후 5초 동안 깨진 상태가 유지됐다')
                        + ` / 주입 ${made.attempts}회로 조건 성립 (테두리 생존=${last.rulesAlive})`
                        + ` / 설정: repairHard=${cfg.repairHard} repairSendRedrawKey=${cfg.repairSendRedrawKey}`
                        + ` (PR7 이 원복한 사용자 값 그대로 — 기본값은 hard=false, 즉 soft 갈래.`
                        + ` hard 갈래는 R14 가 본다)`
                        + ` / 4단계 흔적: clearInputArea=${steps.clearInputArea} redrawKey=${steps.redrawKey}`,
                        {
                            vBefore, vAfter, steps, clearedMs, snapMs,
                            attempts: made.attempts, samples: made.samples, tailAfter,
                            repairHard: cfg.repairHard, repairSendRedrawKey: cfg.repairSendRedrawKey,
                        })
                }
            }
        }
        // ============================================================ PR9 테두리 행 잔상 — 감지 + 복구
        //
        // PR8 과 재는 것이 다르다. PR8 의 주입은 "테두리 두 줄이 맞붙었다"(자리 없음) 유형이고,
        // 여기는 **위 테두리 행에 옛 글자가 남은** 유형이다 (2026-09-09 실사용 스샷).
        // 이 모양은 0.10.0 까지 판정을 통째로 비껴갔다 — 테두리 행이 순수 가로선이 아니라
        // `rules` 에 안 들어가고, 머리글자가 없어 `mixed` 도 아니고, 그래서 `아래 테두리가 없다`·
        // `lens 섞임` 까지 전부 지나간다. 그러니 **감지 자체를 먼저 재고**, 그 다음에 복구를 잰다.
        //
        // 복구 쪽도 같은 이유로 못 고쳤다 — `clearInputArea` 가 순수 가로선만 테두리로 쳐서
        // 시작행을 아래 테두리로 잡고 **입력창 아래**를 지웠다(잔상은 그대로). 그래서 증거에
        // `clear input area row=` 의 행번호를 남긴다: 위 테두리 행이어야 맞다.
        {
            cfg.autoRepairScreen = false
            const pane = await focusTerminal()
            if (!pane || !ad.judge) {
                add('PR9', '테두리 행 잔상 — 감지 + 복구', null,
                    !pane ? '터미널 pane 이 없다' : 'judge 진단구가 없다 (구버전 빌드)', null)
            } else {
                const kickFrom = (ad.kickLog || []).length
                dirtyPanes.add(pane)
                const made = await forceBroken(pane, 3, breakScreenGhost)
                const last = made.samples[made.samples.length - 1] || {}
                const vBefore = verdictOf(pane)
                const sawGhostReason = !!(vBefore && (vBefore.reasons || [])
                    .some(r => r.indexOf('옛 글자가 남았다') >= 0))
                if (!made.ok) {
                    cleanScreen(pane)
                    dirtyPanes.delete(pane)
                    add('PR9', '테두리 행 잔상 — 감지 + 복구', null,
                        '잔상 화면을 만들지 못했다 (pty 쪽 앱이 그 자리를 다시 그렸을 수 있다)',
                        { samples: made.samples })
                } else {
                    ad.repair('all')
                    const clearedMs = await waitFor(() => {
                        const v = verdictOf(pane)
                        return !!(v && !v.broken)
                    }, 5000, 150)
                    const kick = kickSince(kickFrom).join('\n')
                    const clearRow = (/clear input area row=(\d+)\/(\d+)/.exec(kick) || [])[1]
                    const vAfter = verdictOf(pane)
                    cleanScreen(pane)
                    dirtyPanes.delete(pane)
                    await sleep(300)
                    const ok = sawGhostReason && clearedMs >= 0
                    add('PR9', '테두리 행 잔상 — 감지 + 복구', ok,
                        (sawGhostReason
                            ? '감지: `테두리 행에 옛 글자가 남았다` 로 잡았다'
                            : '**감지 실패** — 잔상을 그렸는데 그 이유가 나오지 않았다')
                        + (clearedMs >= 0
                            ? ` / 복구: ${clearedMs}ms 만에 해소`
                            : ' / **복구 실패** — 5초 동안 깨진 채로 있었다')
                        + ` / clearInputArea 대상 행=${clearRow === undefined ? '없음' : clearRow}`,
                        { vBefore, vAfter, clearedMs, clearRow, sawGhostReason,
                            attempts: made.attempts, samples: made.samples })
                }
            }
        }
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
    } finally {
        // 원복이 이 유닛의 핵심이다 — 여기서 남기면 실사용 Tabby 가 이상해진다.
        for (const f of unwrap) { try { f() } catch { /* 이미 되돌렸다 */ } }
        for (const t of madeTabs) { try { await ad.app.closeTab(t, false) } catch { /* 이미 닫혔다 */ } }
        for (const p of dirtyPanes) { cleanScreen(p) }
        // 빌린 신원을 돌려준다 — 안 풀면 그 pane 의 에이전트 판정이 계속 claude 로 고정된다
        try { unpinAll() } catch { /* 진단구가 없는 낡은 dist */ }
        try {
            // noTabRecovery 를 먼저 끄고 recoverTabs 를 되돌린다 (순서가 뒤집히면 enforce 가 뒤집는다)
            Object.assign(cfg, saved)
            ad.config.store.recoverTabs = savedRecoverTabs
            await ad.config.save()
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
