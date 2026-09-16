/**
 * 성능 프로브 (PF1~PF9) — **숫자를 뽑는 것이 목적이다.** 동작 회귀는 다른 프로브가 본다.
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스 (메인이 배리어에서 띄운다)
 *   node tools/cdp.js 9222 tools/probe-perf.js
 *
 * 왜 필요한가 — 94개 회귀가 전부 "동작이 맞나" 만 본다. 실사용에서 탭이 10~30개가 되면
 * 비용이 어디서 나는지 아무도 재 본 적이 없다. 이 파일은 네 곳을 잰다:
 *   ① 렌더 1회 비용과 탭 수 대비 증가 추세 (PF1 · PF8)
 *   ② 출력 조각 1개 처리 비용과 그 분해 (PF3 · PF4)
 *   ③ 탭 수 대비 OS 호출 횟수 — cwd · 프로세스 트리 · 명령줄(PowerShell 기동) (PF5 · PF6 · PF7)
 *   ④ 유휴 재렌더 빈도와 탭을 닫은 뒤의 잔여 (PF2 · PF9)
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary` (다른 프로브와 같은 모양).
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(기준을 정할 근거가 없거나 환경이 조건을
 *   못 만듦 — 실패와 섞지 않는다). 측정값은 null 이어도 항상 `evidence` 에 남긴다.
 *
 * 아래 주석의 `파일:줄` 은 0.10.0 시점 값이다. `deck.service.ts` 는 계속 자라므로 줄은 밀린다 —
 * **찾을 때는 줄이 아니라 심볼 이름**(`scheduleRender` · `touchCwd` · `commandLinesOf` 등)을 써라.
 *
 * ── 판정 기준의 근거 (임의의 숫자를 박지 않으려고 여기 적는다) ──────────────────
 *  * **한 프레임 = 16.7ms (60Hz).** `render()` 는 `scheduleRender()` 가 rAF 안에서 부르고
 *    (deck.service.ts:3210) 1초 tick 도 부른다(:502). 한 프레임을 넘기면 그 프레임을 놓치므로
 *    사용자가 체감한다. 같은 프레임에 Tabby·Angular 의 일이 함께 들어가니 **우리 몫은 절반(8ms)**
 *    까지를 통과선으로 둔다 (p50 ≤ 8ms, p90 ≤ 16.7ms).
 *  * **TTL 상한은 계산으로 나온다.** cwd 는 `CWD_TTL_MS=3000`, 에이전트 판정은
 *    `AGENT_PROBE_TTL_MS=10000` (deck.service.ts:94,108). 창 W(ms) 동안의 호출은
 *    `ceil(W/TTL)+1` 을 넘을 수 없다 — 이건 임의의 숫자가 아니라 코드에서 유도한 값이다.
 *  * **명령줄 조회는 0.9.0 설계상 "이름·제목으로 못 가렸을 때만"** 돈다
 *    (deck.service.ts:2054 주석). 이름으로 잡히는 탭에서 1회라도 PowerShell 이 뜨면 설계 위반이다.
 *  * 기준을 못 정한 항목(PF4 분해 비중, PF6 조회 폭발의 허용선)은 **pass=null + 숫자만** 남긴다.
 *    "얼마까지 괜찮은가" 는 사용자 체감·전력 예산의 문제라 이 프로브가 정할 수 없다.
 *
 * ── 무엇에 속을 수 있는가 (측정 코드가 거짓말하는 지점) ─────────────────────────
 *  1. **첫 실행(JIT)** — 첫 몇 회는 인터프리터로 돌아 3~10배 느리다. 그래서 매 측정마다
 *     버리는 워밍업을 먼저 돌리고, 통계는 평균이 아니라 **중앙값(p50)** 으로 낸다.
 *  2. **GC·다른 탭 활동** — 표본 하나가 통째로 튄다. 그래서 max 는 참고로만 쓰고 판정은 p50·p90 으로
 *     한다. `max` 를 통과 기준에 넣으면 남의 탭이 출력한 순간에 거짓 실패가 난다.
 *  3. **렌더 비용은 두 조각이다** — `innerHTML=''`+`appendChild` 는 동기지만 **스타일·레이아웃은
 *     프레임 시점에 따로 계산된다.** 스크립트 시간만 재면 실제 비용의 일부만 본다. 그래서
 *     `offsetHeight` 를 읽어 레이아웃을 강제로 흘린 값도 같이 낸다(`+layout`).
 *  4. **접힌 그룹은 렌더를 건너뛴다**(deck.service.ts:3337 `if (collapsed) continue`). 접힘이
 *     남아 있으면 탭이 20개여도 줄을 3개만 그려 **거짓 PASS** 가 난다. 그래서 재는 동안
 *     접힘을 풀고 경과시간 표시를 켠다(가장 비싼 구성). 둘 다 메모리에서만 바꾸고 되돌린다.
 *  5. **연속 발화는 렌더를 합친다** — 조각을 동기 루프로 흘리면 rAF 가 한 번도 못 돌아
 *     렌더가 마지막에 1회만 난다. 그래서 PF3 의 숫자에는 **렌더 비용이 안 들어 있다.**
 *     실사용 비용은 `PF3 + (조각당 렌더 횟수 × PF1)` 로 봐야 한다.
 *  6. **`output.next` 는 우리 코드만 태우지 않는다** — 같은 Subject 를 xterm(화면 쓰기)과
 *     `decorator.ts` 도 구독한다. 그래서 PF3 의 절대값은 **상한**이고, 우리 몫은 설정 토글로
 *     빼 보는 차분(PF4)으로만 가른다.
 *  7. **`session.emitOutput(문자열)` 은 조용히 삼켜진다**(`tools/README.md` 함정 목록 —
 *     미들웨어 시그니처가 Buffer 다). 구독을 태우는 채널은 `session.output.next(문자열)` 뿐이므로
 *     그것으로 못 넣었으면 **재지 않고 null** 로 둔다. 안 그러면 "0회 = 싸다" 로 거짓 PASS 가 난다.
 *  8. **진단 로그는 값이 바뀔 때만 찍힌다** — "조회가 안 돌았다" 와 "돌았는데 결과가 같다" 를
 *     로그로는 못 가른다. 그래서 OS 호출은 로그를 세지 않고 **세션 메서드를 랩해서 직접 센다**
 *     (랩한 것은 finally 에서 원복한다).
 *
 * ── 부작용과 정리 ────────────────────────────────────────────────────────────
 *  * 설정은 **메모리(`config.store`)만** 바꾸고 `config.save()` 를 **부르지 않는다** — 렌더는
 *    store 를 직접 읽으므로 저장이 필요 없고, 저장하면 CDP 가 중간에 끊길 때 사용자 파일에
 *    남는다(접힌 그룹이 풀린 채로 남는 것이 가장 아프다).
 *  * 출력 조각은 **우리가 만든 임시 탭에만** 흘린다. 화면에 글자가 남지만 그 탭을 닫으면 함께
 *    사라진다 — 활성 탭에 쓰면 그 뒤 단계(R11 재측정, R10·PR1 재기동)가 우리 글자를 보게 된다.
 *  * 랩한 세션 메서드·`child_process.execFile` 은 finally 에서 원래 것으로 되돌린다.
 *  * PF7 은 PowerShell 을 **한 번** 실제로 띄운다(그 비용을 재는 것이 목적이다). `windowsHide`
 *    로 창은 안 뜨고, 하는 일은 자기 pid 하나에 대한 `Get-CimInstance` 조회뿐이다.
 */
(async () => {
    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    /**
     * 케이스 하나를 매긴다.
     *
     * **같은 id 를 두 번 넣으면 안 된다** — 러너는 먼저 온 것만 집계하므로(run-all.ps1 의
     * `if ($report.id -contains $r.id) { continue }`) 앞서 채운 SKIP 이 뒤에 온 실측 PASS 를
     * 조용히 가린다. 그래서 이미 있는 자리는 **덮는다**(2026-09-09 목 하네스에서 PF8·PF9 가
     * 실제로 두 번 들어가 그 사고를 재현했다).
     */
    const add = (id, name, pass, detail, evidence) => {
        const rec = { id, name, pass, detail, evidence }
        const i = results.findIndex(r => r.id === id)
        if (i >= 0) { results[i] = rec } else { results.push(rec) }
    }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const now = () => performance.now()
    /** 모든 케이스 id — 예외로 멈춰도 안 매긴 것을 판정 불가로 채우려고 (probe-group 과 같은 규칙) */
    const ALL_IDS = [
        ['PF1', '렌더 1회 비용'],
        ['PF2', '유휴 재렌더 빈도'],
        ['PF3', '출력 조각 1개 처리 비용'],
        ['PF4', '출력 경로 비용 분해'],
        ['PF5', 'OS 호출 횟수 대 TTL 상한'],
        ['PF6', 'cwd 미상 탭의 조회 폭발'],
        ['PF7', '명령줄 조회(PowerShell) 발화 조건'],
        ['PF8', '탭 수 대비 렌더 증가'],
        ['PF9', '탭 닫은 뒤 잔여'],
    ]
    /** 아직 안 매긴 케이스를 판정 불가로 채운다 (ids 를 주면 그 목록만) */
    const skipRest = (why, ev, ids) => {
        for (const [id, name] of ALL_IDS) {
            if (ids && ids.indexOf(id) < 0) { continue }
            if (!results.some(r => r.id === id)) { add(id, name, null, why, ev ?? null) }
        }
    }
    /** 출력 조각을 흘려야만 재는 케이스들 — 채널이 없으면 이것들만 판정 불가다 */
    const OUTPUT_IDS = ['PF3', 'PF4', 'PF5', 'PF6', 'PF7']

    // ---------- 통계 ----------
    const r3 = x => Math.round(x * 1000) / 1000
    /** 표본 요약 — 판정은 p50·p90 으로만 한다 (max 는 GC·남의 탭 활동에 통째로 흔들린다) */
    const stat = arr => {
        const s = arr.slice().sort((a, b) => a - b)
        if (!s.length) { return { n: 0 } }
        const at = q => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
        const sum = s.reduce((a, b) => a + b, 0)
        return { n: s.length, min: r3(s[0]), p50: r3(at(0.5)), p90: r3(at(0.9)), max: r3(s[s.length - 1]), mean: r3(sum / s.length) }
    }

    // ---------- 선택자 ----------
    const sb = () => document.getElementById('agentdeck-sidebar')
    const listEl = () => (sb() ? sb().querySelector('.ad-list') : null)
    const rows = () => (sb() ? sb().querySelectorAll('.ad-tab').length : 0)
    const newTabBtn = () => (sb() ? sb().querySelector('.ad-new') : null)

    const cfg = ad.config.store.agentDeck
    /** 되돌릴 설정 — **저장하지 않는다**(머리주석 '부작용과 정리') */
    const saved = {
        showElapsed: cfg.showElapsed,
        collapsedGroups: Array.isArray(cfg.collapsedGroups) ? cfg.collapsedGroups.slice() : cfg.collapsedGroups,
        viewerScrape: cfg.viewerScrape,
        autoDetect: cfg.autoDetect,
        screenWatch: cfg.screenWatch,
        autoRepairScreen: cfg.autoRepairScreen,
    }
    /** finally 에서 거꾸로 실행할 원복 함수들 (랩한 메서드 등) */
    const restores = []
    const madeTabs = []
    const prevActiveTab = ad.app.activeTab
    const cleanup = {}
    /** 레이아웃 강제 계산 값을 버리지 않게 담아 둔다 — 읽기만 하고 안 쓰면 오해를 부른다 */
    let sink = 0

    // ---------- 탭 만들기 / 닫기 ----------
    const waitFor = async (fn, ms, step) => {
        const t0 = now()
        while (now() - t0 < ms) {
            if (fn()) { return now() - t0 }
            await sleep(step ?? 100)
        }
        return -1
    }
    /**
     * 제품 경로로 탭 하나를 연다 — 사이드바 `+ 새 탭` 클릭.
     * `openNewTabForProfile` 은 진단구에 없으므로(deck.service.ts:516~ 목록) 이 경로가 유일하다.
     */
    const openTab = async (budgetMs) => {
        const btn = newTabBtn()
        if (!btn) { return { ok: false, why: '사이드바 + 새 탭 버튼이 없다 (agentDeck.enabled 확인)' } }
        const before = ad.app.tabs.slice()
        btn.click()
        const waited = await waitFor(() => ad.app.tabs.length > before.length, budgetMs ?? 9000, 200)
        const opened = ad.app.tabs.find(t => before.indexOf(t) < 0)
        if (!opened) { return { ok: false, why: `+ 새 탭 을 눌러도 ${budgetMs ?? 9000}ms 안에 탭이 늘지 않았다` } }
        madeTabs.push(opened)
        return { ok: true, tab: opened, waitedMs: r3(waited) }
    }
    /** 그 root 탭의 첫 pane (프로브가 세션을 만질 대상) — deck.service.ts `firstPane` 과 같은 규칙 */
    const paneOf = root => {
        const anyRoot = root
        const list = typeof anyRoot.getAllTabs === 'function' ? anyRoot.getAllTabs() : [root]
        return list.find(p => p && p.session) ?? list[0] ?? null
    }

    /**
     * 출력 구독을 실제로 태우는 채널 — `emitOutput(문자열)` 은 미들웨어가 Buffer 를 기대해
     * 조용히 삼켜진다(`tools/README.md`). 그것으로 재면 "0회 = 싸다" 라는 거짓 PASS 가 난다.
     */
    const emitChan = pane => {
        const s = pane && pane.session
        return (s && s.output && typeof s.output.next === 'function') ? 'output.next' : null
    }
    const emit = (pane, text) => { pane.session.output.next(text) }

    try {
        // ================================================================ PF1 렌더 1회 비용
        //
        // 재는 것 세 가지 —
        //   script  : `render()` 의 동기 시간 (innerHTML 비우기 + 줄 만들기 + appendChild)
        //   +layout : 그 뒤 `offsetHeight` 를 읽어 스타일·레이아웃을 **강제로 흘린** 시간
        //   frame   : `render()` + `relayout()` + 레이아웃 — `scheduleRender()` 의 run() 이
        //             한 프레임에 실제로 하는 일 그대로 (deck.service.ts:3207-3208)
        //
        // 판정은 frame 으로 한다. 그것이 사용자가 프레임을 놓치는지의 단위다.
        const le = listEl()
        if (!cfg.enabled || !le) {
            add('PF1', '렌더 1회 비용', null,
                `사이드바가 없다 — 렌더가 즉시 return 하므로(deck.service.ts:3314) 잴 것이 없다 (enabled=${!!cfg.enabled}, list=${!!le})`,
                { enabled: !!cfg.enabled })
        } else {
            // 최악을 재려고 접힘을 풀고 경과시간을 켠다 — 접힌 그룹은 줄을 아예 안 그려서
            // 탭이 많아도 렌더가 싸게 보인다(거짓 PASS). 둘 다 메모리에서만 바꾼다.
            cfg.collapsedGroups = []
            cfg.showElapsed = true

            const measure = samples => {
                const script = []
                const withLayout = []
                const frame = []
                // 워밍업 — 첫 몇 회는 JIT 때문에 배 이상 느리다. 버린다.
                for (let i = 0; i < 6; i++) { ad.render(); sink += listEl() ? listEl().offsetHeight : 0 }
                for (let i = 0; i < samples; i++) {
                    let t0 = now()
                    ad.render()
                    script.push(now() - t0)

                    t0 = now()
                    ad.render()
                    sink += listEl() ? listEl().offsetHeight : 0
                    withLayout.push(now() - t0)

                    t0 = now()
                    ad.render()
                    ad.relayout()
                    sink += listEl() ? listEl().offsetHeight : 0
                    frame.push(now() - t0)
                }
                return { script: stat(script), withLayout: stat(withLayout), frame: stat(frame) }
            }

            const n0 = ad.app.tabs.length
            const m0 = measure(25)
            const rows0 = rows()
            // 줄을 실제로 그렸는지 확인한다 — 줄이 탭 수보다 적으면(접힘·필터) 측정이 최악이 아니다
            const drewAll = rows0 >= n0
            const okP50 = m0.frame.p50 <= 8
            const okP90 = m0.frame.p90 <= 16.7
            add('PF1', '렌더 1회 비용', drewAll ? (okP50 && okP90) : null,
                drewAll
                    ? `탭 ${n0}개 / 줄 ${rows0}개 — frame p50=${m0.frame.p50}ms p90=${m0.frame.p90}ms max=${m0.frame.max}ms`
                        + ` (script p50=${m0.script.p50}ms, +layout p50=${m0.withLayout.p50}ms)`
                        + ` · 기준 p50≤8ms(한 프레임 16.7ms 의 절반) p90≤16.7ms`
                    : `줄 ${rows0}개 < 탭 ${n0}개 — 접힘/필터로 일부만 그려져 최악을 재지 못했다`,
                { tabs: n0, rows: rows0, ...m0, thresholdP50: 8, thresholdP90: 16.7 })

            // ============================================================ PF2 유휴 재렌더 빈도
            //
            // 아무것도 안 하는 동안 사이드바가 몇 번 다시 그려지나. 세는 방법은 진단 카운터가
            // 아니라 **DOM 변이**다 — `render()` 는 `listEl.innerHTML=''` 로 시작하므로
            // (deck.service.ts:3326) 줄이 있는 상태의 렌더는 반드시 removedNodes 가 있는
            // 변이 레코드 하나를 남긴다. 내부 호출까지 세려면 이 방법뿐이다
            // (`ad.render` 를 랩해도 제품 내부의 `this.render()` 는 안 잡힌다).
            //
            // 유휴에 기대되는 빈도: tick 1초 1회(showElapsed 가 켜져 있으면 매번 그린다,
            // deck.service.ts:3246) + 상태 전이 몇 번. sweepScreens(2초)·notify 폴링(400ms)은
            // 렌더를 부르지 않는다. 그래서 **초당 5회를 넘으면** 합치기(coalescing)가 깨진 것이다.
            const WIN_MS = 2600
            let renderCount = 0
            const mo = new MutationObserver(recs => {
                for (const rec of recs) {
                    if (rec.type === 'childList' && rec.removedNodes.length > 0 && rec.target === listEl()) {
                        renderCount++
                    }
                }
            })
            mo.observe(le, { childList: true })
            const t0idle = now()
            await sleep(WIN_MS)
            const elapsedIdle = now() - t0idle
            mo.disconnect()
            const perSec = r3(renderCount / (elapsedIdle / 1000))
            const idleCost = r3(perSec * m0.frame.p50)
            // **0회는 PASS 가 아니라 판정 불가다.** showElapsed 를 켜 뒀으므로 tick 은 매초 반드시
            // 그린다(deck.service.ts:3246-3248) — 한 건도 못 봤다면 관측이 안 붙은 것이고(대상
            // 엘리먼트가 교체됐거나 줄이 0개), 그걸 "조용하다 = 통과" 로 읽으면 거짓 PASS 다.
            const observed = renderCount > 0 && rows() > 0
            add('PF2', '유휴 재렌더 빈도', observed ? perSec <= 5 : null,
                observed
                    ? `유휴 ${r3(elapsedIdle)}ms 동안 ${renderCount}회 = 초당 ${perSec}회`
                        + ` (showElapsed=${cfg.showElapsed} → tick 이 매초 1회 그리는 것이 정상)`
                        + ` · 초당 비용 ≈ ${idleCost}ms/s · 기준 ≤5회/s`
                    : `변이를 한 건도 못 봤다 (줄 ${rows()}개) — 관측이 안 붙었다. 조용한 것과 구별할 수 없어 판정하지 않는다`,
                { window: r3(elapsedIdle), renders: renderCount, perSec, rows: rows(), showElapsed: !!cfg.showElapsed, msPerSec: idleCost })
        }

        // ================================================================ 출력 경로 (PF3~PF7)
        //
        // 전용 임시 탭을 하나 열어 **거기에만** 조각을 흘린다. 활성 탭에 쓰면 그 글자가 남아
        // 뒤 단계(R11 재측정, R10·PR1 재기동)가 우리 화면을 재게 된다.
        const scratch = await openTab(12000)
        const pane = scratch.ok ? paneOf(scratch.tab) : null
        const chan = pane ? emitChan(pane) : null
        if (!chan) {
            const why = scratch.ok
                ? '임시 탭에 `session.output.next` 가 없다 — 구독을 태울 채널이 없으면 0회를 싸다고 오판한다'
                : `임시 탭을 열지 못했다: ${scratch.why}`
            // 출력 경로 케이스만 판정 불가다 — PF8·PF9 는 아래에서 제 힘으로 잰다
            skipRest(why, { scratch }, OUTPUT_IDS)
        } else {
            const root = scratch.tab
            // 상태 고정을 풀어 둔다 — pinned 면 `setAuto` 가 즉시 return 해서(status.service.ts:47)
            // "상태가 바뀌는 조각" 을 만들 수 없다. `tools/README.md` 가 지적한 그 함정이다.
            try { ad.status.unpin(root) } catch { /* 상태가 없으면 그냥 둔다 */ }

            /** 패턴에 걸리지 않는 조각 — 실사용 출력의 대다수다 (상태줄 재그리기) */
            const QUIET = '\u001b[2K[perf-probe] quiet chunk 0123456789\r\n'
            /** 승인대기 패턴에 걸리는 조각 (agents.ts CONFIRM_YN) — 상태를 바꾼다 */
            const FLIP = '\u001b[2K[perf-probe] Do you want to proceed? (y/n)\r\n'

            // **출하 기본값(전부 켜짐)으로 못박고 잰다.** 사용자 설정이 `viewerScrape=false` 인
            // 인스턴스에서 재면 PF3 은 더 싼 구성을 재고, PF4 의 차분은 0 이 나와 "경로 줍기는
            // 공짜" 라는 거짓 결론이 된다. 기본값은 config.ts:62(viewerScrape) ·:129(autoDetect)
            // ·:371(screenWatch) 이 전부 true 다. 메모리만 바꾸고 finally 에서 되돌린다.
            cfg.viewerScrape = true
            cfg.autoDetect = true
            cfg.screenWatch = true

            const timeChunks = (texts, samples) => {
                const ts = []
                for (let i = 0; i < 6; i++) { emit(pane, texts[i % texts.length]) }   // 워밍업(JIT)
                for (let i = 0; i < samples; i++) {
                    const t0 = now()
                    emit(pane, texts[i % texts.length])
                    ts.push(now() - t0)
                }
                return stat(ts)
            }

            // ============================================================ PF3 조각 1개 처리 비용
            //
            // **절대값은 상한이다** — 같은 Subject 를 xterm(화면 쓰기)과 decorator 도 구독하므로
            // 우리 몫만 재는 것이 아니다. 우리 몫은 PF4 의 차분으로 가른다.
            // 또 이 루프는 동기라 rAF 가 못 돌아 **렌더가 합쳐진다** — 이 숫자에 렌더는 없다.
            const quiet = timeChunks([QUIET], 41)
            const flip = timeChunks([FLIP, QUIET], 40)
            const okChunk = quiet.p50 <= 1.0
            add('PF3', '출력 조각 1개 처리 비용', okChunk,
                `상태불변 p50=${quiet.p50}ms p90=${quiet.p90}ms (초당 ${r3(1000 / Math.max(quiet.p50, 0.001))}조각)`
                    + ` / 상태변화 p50=${flip.p50}ms p90=${flip.p90}ms`
                    + ` · 기준 상태불변 p50≤1.0ms (한 프레임 16.7ms 에 버스트 16조각이 들어가야 한다)`
                    + ` · xterm·decorator 구독을 포함한 상한이고 렌더는 합쳐져 빠져 있다`,
                { channel: chan, unchanged: quiet, changed: flip, thresholdP50: 1.0 })

            // ============================================================ PF4 출력 경로 비용 분해
            //
            // 설정 토글로 갈래를 하나씩 끄고 차분을 본다. 이 방법을 쓰는 이유 — 제품 함수를
            // 개별로 부를 방법이 없고(진단구에 없다), 절대값에는 xterm·decorator 가 섞여 있다.
            //   viewerScrape=false → `noteOutput`(경로 줍기 버퍼링, viewPanel.ts:621) 이 빠진다
            //   autoDetect=false   → `applyOutput` 의 패턴 매칭이 빠진다 (detect.ts:136 에서 return)
            //   screenWatch/autoRepairScreen=false → `scheduleScreenCheck`(타이머 재예약) 이 빠진다
            //
            // **판정하지 않는다(pass=null).** "어느 갈래가 몇 % 까지 괜찮은가" 는 사용자 체감·전력
            // 예산의 문제라 이 프로브가 정할 근거가 없다. 대신 20탭 부하로 외삽한 값을 남긴다.
            // 기준선은 위에서 못박은 **전부 켜짐**이다. 갈래를 끈 뒤에는 반드시 다시 켜서
            // 다음 차분이 같은 기준선을 쓰게 한다 (사용자 값으로 돌리면 기준선이 바뀐다).
            const base = timeChunks([QUIET], 31)
            cfg.viewerScrape = false
            const noScrape = timeChunks([QUIET], 31)
            cfg.viewerScrape = true
            cfg.autoDetect = false
            const noDetect = timeChunks([QUIET], 31)
            cfg.autoDetect = true
            cfg.screenWatch = false
            cfg.autoRepairScreen = false
            const noWatch = timeChunks([QUIET], 31)
            cfg.screenWatch = true
            cfg.autoRepairScreen = saved.autoRepairScreen

            // 20탭 × 초당 30조각 = 600조각/s 로 외삽한다. 30조각/s 는 에이전트 TUI 가 상태줄을
            // 다시 그릴 때 조각이 쪼개져 오는 실측 규모(viewPanel.ts:619 주석 "초당 수십 개씩 온다").
            const per = ms => r3(ms * 600)
            const parts = {
                total: base.p50,
                noteOutput: r3(base.p50 - noScrape.p50),
                patternMatch: r3(base.p50 - noDetect.p50),
                screenCheck: r3(base.p50 - noWatch.p50),
            }
            add('PF4', '출력 경로 비용 분해', null,
                `조각당 p50 총 ${parts.total}ms — 경로줍기 ${parts.noteOutput}ms / 패턴매칭 ${parts.patternMatch}ms`
                    + ` / 화면검사예약 ${parts.screenCheck}ms`
                    + ` · 20탭×30조각/s(=600조각/s) 외삽: 총 ${per(parts.total)}ms/s`
                    + ` (경로줍기 ${per(parts.noteOutput)} / 패턴 ${per(parts.patternMatch)} / 화면검사 ${per(parts.screenCheck)})`
                    + ` · 0 이하(음수)는 측정 잡음 이하 = 그 갈래가 잴 수 없을 만큼 싸다는 뜻이다`
                    + ` · 비중의 통과선은 근거가 없어 판정하지 않는다 (숫자만)`,
                {
                    p50: { base: base.p50, noScrape: noScrape.p50, noDetect: noDetect.p50, noWatch: noWatch.p50 },
                    deltaMs: parts,
                    projectedMsPerSec: {
                        assumption: '탭 20개 × 초당 30조각',
                        total: per(parts.total),
                        noteOutput: per(parts.noteOutput),
                        patternMatch: per(parts.patternMatch),
                        screenCheck: per(parts.screenCheck),
                    },
                    unionPatternCount: (() => {
                        try {
                            const u = ad.profiles().union
                            return { waiting: u.waitingPatterns.length, busy: u.busyPatterns.length, busyTitleMarks: u.busyTitleMarks.length }
                        } catch { return null }
                    })(),
                })

            // ---------- OS 호출 계수기 (PF5~PF7) ----------
            //
            // 진단 로그로는 못 센다(값이 바뀔 때만 찍힌다 — README 함정). 세션 메서드와
            // `child_process.execFile` 을 랩해서 **직접** 센다. 랩은 통과(passthrough)만 하고
            // finally 에서 원복한다.
            const counts = { cwd: 0, children: 0, exec: 0, execPs: 0 }
            const execCalls = []
            const session = pane.session

            const wrapOwn = (obj, name, make) => {
                const had = Object.prototype.hasOwnProperty.call(obj, name)
                const prev = obj[name]
                obj[name] = make(prev ? prev.bind(obj) : null)
                restores.push(() => {
                    if (had) { obj[name] = prev } else { delete obj[name] }
                })
            }
            let cwdReturnsNull = false
            // 세션이 이 메서드를 아예 안 주면 `touchCwd` 는 즉시 return 한다(deck.service.ts:3149).
            // 그때의 "0회" 는 "TTL 이 막았다" 가 아니라 "경로가 없다" 다 — 섞으면 거짓 PASS 다.
            const haveCwdFn = typeof session.getWorkingDirectory === 'function'
            if (haveCwdFn) {
                wrapOwn(session, 'getWorkingDirectory', real => function () {
                    counts.cwd++
                    // PF6 은 "cwd 를 못 알아내는 탭" 을 만들어야 재진다. 그 갈래에서만 null 을 준다.
                    if (cwdReturnsNull) { return Promise.resolve(null) }
                    return real ? real() : Promise.resolve(null)
                })
            }
            let fakeChildren = null
            if (typeof session.getChildProcesses === 'function') {
                wrapOwn(session, 'getChildProcesses', real => function () {
                    counts.children++
                    if (fakeChildren) { return Promise.resolve(fakeChildren) }
                    return real ? real() : Promise.resolve([])
                })
            }
            /** `commandLinesOf` 가 띄우는 PowerShell 을 센다 (deck.service.ts:2076) */
            let cp = null
            try {
                cp = require('child_process')
                const realExec = cp.execFile
                cp.execFile = function (...args) {
                    counts.exec++
                    const file = String(args[0] ?? '')
                    const argv = Array.isArray(args[1]) ? args[1] : []
                    const isCimProbe = /powershell|^ps$/i.test(file) && argv.join(' ').indexOf('Win32_Process') >= 0
                    if (isCimProbe) {
                        counts.execPs++
                        const startedAt = now()
                        const ci = args.findIndex(a => typeof a === 'function')
                        if (ci >= 0) {
                            const userCb = args[ci]
                            args[ci] = function (...cbArgs) {
                                execCalls.push({ file, ms: r3(now() - startedAt), args: argv.slice(0, 3) })
                                return userCb.apply(this, cbArgs)
                            }
                        } else {
                            execCalls.push({ file, ms: null, args: argv.slice(0, 3) })
                        }
                    }
                    return realExec.apply(cp, args)
                }
                restores.push(() => { cp.execFile = realExec })
            } catch (e) {
                cp = null
            }

            // ============================================================ PF6 cwd 미상 탭의 조회 폭발
            //
            // 먼저 잰다 — 임시 탭의 cwd 가 아직 안 채워진 지금이 유일한 기회다. 한 번 채워지면
            // `touchCwd` 가 그 값을 지우지 않으므로(deck.service.ts:3147 `dir: hit?.dir ?? null`)
            // 나중에는 이 갈래를 다시 만들 수 없다.
            //
            // 무엇을 보는가 — TTL 은 **이미 아는 값**만 막는다. `if (hit?.dir && now-hit.at < TTL)`
            // 이므로 dir 이 null 인 탭은 **출력 조각마다** `getWorkingDirectory()`(OS 호출)를 부른다.
            // 주석(deck.service.ts:3137-3147)은 이것을 의도된 트레이드오프로 적어 뒀다 —
            // 그래서 실패로 판정하지 않고 **비율만** 남긴다. 탭 수에 곱해지는 값이라 보고 대상이다.
            const cwdNow = () => {
                try {
                    const i = ad.app.tabs.indexOf(root)
                    const e = ad.groups().cwdCache.find(x => x.index === i)
                    return e ? e.dir : null
                } catch { return null }
            }
            if (!haveCwdFn) {
                add('PF6', 'cwd 미상 탭의 조회 폭발', null,
                    '이 세션에는 getWorkingDirectory 가 없다 — touchCwd 가 즉시 return 하므로 조회 자체가 없다 (잴 것이 없음)',
                    { haveCwdFn: false })
            } else if (cwdNow()) {
                add('PF6', 'cwd 미상 탭의 조회 폭발', null,
                    `임시 탭의 cwd 가 이미 채워져(${cwdNow()}) TTL 이 막는 갈래로 들어갔다 —`
                        + ' dir=null 갈래를 실측할 조건을 만들지 못했다 (정적 판독: deck.service.ts:3144 은 dir=null 이면 TTL 을 건너뛴다)',
                    { cwd: cwdNow() })
            } else {
                cwdReturnsNull = true
                const before = counts.cwd
                let sent = 0
                const t0 = now()
                while (now() - t0 < 1500) {
                    emit(pane, QUIET)
                    sent++
                    await sleep(60)
                }
                await sleep(120)
                const called = counts.cwd - before
                cwdReturnsNull = false
                const ratio = r3(called / Math.max(sent, 1))
                add('PF6', 'cwd 미상 탭의 조회 폭발', null,
                    `조각 ${sent}개를 흘리는 동안 getWorkingDirectory() ${called}회 (조각당 ${ratio}회)`
                        + ` · TTL(3초) 이 막는다면 1~2회여야 한다 — dir=null 이면 TTL 을 건너뛰므로(deck.service.ts:3144) 조각마다 OS 호출이 난다`
                        + ' · 의도된 트레이드오프라고 주석에 적혀 있어 실패로 판정하지 않는다 (숫자만)',
                    { chunks: sent, calls: called, perChunk: ratio, ttlMs: 3000 })
            }

            // ============================================================ PF5 OS 호출 대 TTL 상한
            //
            // cwd 가 채워진 뒤(=TTL 이 실제로 일하는 상태)에 창 W 동안 몇 번 불리나.
            // 상한은 코드에서 유도한다: cwd ceil(W/3000)+1, 프로세스 트리 ceil(W/10000)+1.
            // **기다리기만 하면 영영 안 채워진다.** `touchCwd` 는 출력 조각(또는 frontendReady)에서만
            // 도는데(deck.service.ts:1204, 1224) 이 구간에는 우리가 넣는 출력밖에 없다. 그래서
            // 기다리는 동안에도 조각을 흘려 조회를 태운다 — 목 하네스에서 이걸 빼먹어 PF5 가
            // "6초 안에 안 채워졌다" 로 조용히 SKIP 났다 (2026-09-09 목 실행).
            let gotCwd = -1
            {
                const tw = now()
                while (now() - tw < 6000) {
                    if (cwdNow()) { gotCwd = now() - tw; break }
                    emit(pane, QUIET)
                    await sleep(250)
                }
            }
            const win = 6000
            const c0 = { cwd: counts.cwd, children: counts.children, ps: counts.execPs }
            let sent5 = 0
            const t05 = now()
            while (now() - t05 < win) {
                emit(pane, QUIET)
                sent5++
                await sleep(100)
            }
            await sleep(200)
            const used = r3(now() - t05)
            const d5 = { cwd: counts.cwd - c0.cwd, children: counts.children - c0.children, ps: counts.execPs - c0.ps }
            const capCwd = Math.ceil(used / 3000) + 1
            const capChild = Math.ceil(used / 10000) + 1
            const tabsNow = ad.app.tabs.length
            if (!haveCwdFn || gotCwd < 0) {
                add('PF5', 'OS 호출 횟수 대 TTL 상한', null,
                    (haveCwdFn
                        ? '임시 탭의 cwd 가 6초 안에 안 채워졌다 — TTL 이 일하는 상태를 못 만들어 판정 불가.'
                        : '이 세션에는 getWorkingDirectory 가 없다 — 조회 자체가 없어 TTL 을 판정할 수 없다.')
                        + ` 그 상태의 호출량은 PF6 이 잰다 (이 창에서 cwd ${d5.cwd}회 / 프로세스트리 ${d5.children}회 / 조각 ${sent5}개)`,
                    { chunks: sent5, calls: d5, windowMs: used, haveCwdFn })
            } else {
                const ok = d5.cwd <= capCwd && d5.children <= capChild
                add('PF5', 'OS 호출 횟수 대 TTL 상한', ok,
                    `조각 ${sent5}개 / ${used}ms — getWorkingDirectory ${d5.cwd}회(상한 ${capCwd})`
                        + ` · getChildProcesses ${d5.children}회(상한 ${capChild}) · PowerShell ${d5.ps}회`
                        + ` · 탭 1개당 값이므로 탭 ${tabsNow}개면 ×${tabsNow} 로 본다`,
                    {
                        chunks: sent5, windowMs: used, calls: d5,
                        caps: { cwd: capCwd, children: capChild }, ttlMs: { cwd: 3000, agent: 10000 },
                        tabs: tabsNow, perTabProjection: { cwd: d5.cwd * tabsNow, children: d5.children * tabsNow, powershell: d5.ps * tabsNow },
                    })
            }

            // ============================================================ PF7 명령줄 조회 발화 조건
            //
            // 0.9.0 설계: 프로세스 **이름**으로 가려지면 명령줄 조회(PowerShell 기동)는 아예
            // 돌지 않고, 이름으로 못 가렸을 때만 폴백으로 돈다(deck.service.ts:2047-2060).
            // 그 주장을 그대로 잰다 — 자식 프로세스 목록을 두 번 갈아 끼우고 spawn 수를 센다.
            //   ① `claude.exe` → 이름으로 잡힌다 → PowerShell 0회여야 한다
            //   ② `node.exe`   → 이름·제목으로 못 잡힌다 → 폴백이 1회 이상 떠야 한다
            // pid 는 렌더러 자기 pid 를 쓴다 — 실재하는 숫자여야 조회가 정상 경로를 탄다.
            if (!cp) {
                add('PF7', '명령줄 조회(PowerShell) 발화 조건', null,
                    "renderer 에서 require('child_process') 를 못 잡았다 — spawn 을 셀 수 없다", null)
            } else if (typeof session.getChildProcesses !== 'function' || typeof ad.probeAgent !== 'function') {
                add('PF7', '명령줄 조회(PowerShell) 발화 조건', null,
                    `랩할 대상이 없다 (getChildProcesses=${typeof session.getChildProcesses}, ad.probeAgent=${typeof ad.probeAgent})`, null)
            } else {
                const myPid = (typeof process !== 'undefined' && process.pid) ? process.pid : 4
                const runProbe = async (children, waitMs) => {
                    fakeChildren = children
                    const before = { ps: counts.execPs, children: counts.children }
                    ad.probeAgent(root)      // TTL 을 지우고 다시 판정한다 (진단구 deck.service.ts:697)
                    await waitFor(() => counts.children > before.children, 3000, 50)
                    await sleep(waitMs)
                    return { ps: counts.execPs - before.ps, children: counts.children - before.children }
                }
                // ① 이름으로 잡히는 탭
                const byName = await runProbe([{ pid: myPid, command: 'claude.exe', name: 'claude.exe' }], 700)
                const idName = (ad.agentOf(root) || {}).id
                // ② 이름으로 못 잡히는 탭 — 여기서 PowerShell 이 실제로 한 번 뜬다(비용 측정 목적)
                const byCmd = await runProbe([{ pid: myPid, command: 'node.exe', name: 'node.exe' }], 5000)
                fakeChildren = null
                const lat = execCalls.filter(c => typeof c.ms === 'number').map(c => c.ms)
                // **판정 경로가 실제로 돌았는지부터 본다.** `getChildProcesses` 가 한 번도 안 불렸다면
                // 우리가 끼운 목록이 쓰이지 않은 것이고, 그때의 "PowerShell 0회" 는 설계가 맞다는
                // 증거가 아니라 **아무것도 안 일어났다**는 뜻이다 (그걸 PASS 로 세면 거짓 PASS).
                const ran = byName.children > 0 && byCmd.children > 0
                const ok = byName.ps === 0 && byCmd.ps >= 1
                add('PF7', '명령줄 조회(PowerShell) 발화 조건', ran ? ok : null,
                    (ran
                        ? `이름식별(claude.exe) → PowerShell ${byName.ps}회 (판정 id=${idName})`
                            + ` · 이름미식별(node.exe) → ${byCmd.ps}회`
                        : `판정 경로가 돌지 않았다 — getChildProcesses ${byName.children}/${byCmd.children}회 (probeAgent 가 TTL 에 막혔거나 pane 이 바뀌었다)`)
                        + (lat.length ? ` · 기동+조회 실측 ${stat(lat).p50}ms (n=${lat.length}, max=${stat(lat).max}ms)` : ' · 지연 표본 없음')
                        + ' · 기준: 이름으로 잡히면 0회여야 한다 (0.9.0 설계, deck.service.ts:2054 주석)',
                    { byName, byCmd, agentId: idName, latencyMs: lat.length ? stat(lat) : null, execTotal: counts.exec, ranDetect: ran })
            }
        }

        // ================================================================ PF8 탭 수 대비 렌더 증가
        //
        // 탭을 하나씩 늘리며 매번 렌더를 다시 잰다. 판정은 두 가지 —
        //   ① 최대 N 에서 frame p50 이 8ms(프레임 절반) 안인가
        //   ② 실측 기울기로 **탭 30개**를 외삽했을 때 한 프레임(16.7ms) 안인가
        // ②를 넣는 이유: 지금 탭이 5개인 인스턴스에서 "빠르다" 를 확인해도 실사용(10~30탭)에
        // 대한 답이 아니다. 기울기는 앞 절반·뒤 절반을 따로 내서 선형인지도 같이 본다.
        const le8 = listEl()
        if (!cfg.enabled || !le8) {
            add('PF8', '탭 수 대비 렌더 증가', null, '사이드바가 없어 렌더를 잴 수 없다', null)
        } else {
            cfg.collapsedGroups = []
            cfg.showElapsed = true
            const series = []
            const flush = () => { const l = listEl(); sink += l ? l.offsetHeight : 0 }
            const sample = () => {
                const ts = []
                for (let i = 0; i < 6; i++) { ad.render(); flush() }   // 워밍업(JIT)
                for (let i = 0; i < 21; i++) {
                    const t0 = now()
                    ad.render()
                    ad.relayout()
                    flush()
                    ts.push(now() - t0)
                }
                const s = stat(ts)
                series.push({ tabs: ad.app.tabs.length, rows: rows(), p50: s.p50, p90: s.p90, max: s.max })
            }
            sample()
            // 탭 열기는 비싸다(각 1~3초). 벽시계 예산으로 끊고, 몇 개까지 갔든 그 지점들로 판정한다.
            const budget = 40000
            const t0g = now()
            let failedOpen = null
            for (let i = 0; i < 10 && now() - t0g < budget; i++) {
                const r = await openTab(9000)
                if (!r.ok) { failedOpen = r.why; break }
                await sleep(350)          // 새 탭의 첫 출력이 몰려오는 구간을 피한다
                sample()
            }
            const added = series.length - 1
            const first = series[0]
            const last = series[series.length - 1]
            if (added < 4) {
                add('PF8', '탭 수 대비 렌더 증가', null,
                    `탭을 ${added}개만 더 열었다 — 기울기를 낼 표본이 부족하다 (${failedOpen ?? '예산 초과'})`,
                    { series, added, failedOpen })
            } else if (last.rows < last.tabs) {
                // 줄이 탭보다 적으면 접힘/필터로 일부만 그린 것이다 — 그 숫자로 "탭이 늘어도
                // 싸다" 를 말하면 거짓 PASS 다 (머리주석 함정 ④)
                add('PF8', '탭 수 대비 렌더 증가', null,
                    `탭 ${last.tabs}개인데 줄이 ${last.rows}개뿐이다 — 일부만 그려져 증가 추세를 판정할 수 없다`,
                    { series, added })
            } else {
                const slope = (a, b) => (b.tabs === a.tabs ? 0 : r3((b.p50 - a.p50) / (b.tabs - a.tabs)))
                const mid = series[Math.floor(series.length / 2)]
                const s1 = slope(first, mid)
                const s2 = slope(mid, last)
                const sAll = slope(first, last)
                const at30 = r3(last.p50 + sAll * Math.max(0, 30 - last.tabs))
                const ok = last.p50 <= 8 && at30 <= 16.7
                add('PF8', '탭 수 대비 렌더 증가', ok,
                    `탭 ${first.tabs}→${last.tabs}개: frame p50 ${first.p50}→${last.p50}ms`
                        + ` · 기울기 ${sAll}ms/탭 (앞절반 ${s1} / 뒤절반 ${s2} → 비 ${s1 ? r3(s2 / s1) : 'n/a'})`
                        + ` · 30탭 외삽 ${at30}ms · 기준 최대N p50≤8ms 그리고 30탭 외삽 ≤16.7ms`,
                    { series, slopePerTab: sAll, slopeFirstHalf: s1, slopeSecondHalf: s2, projectedAt30Tabs: at30, thresholds: { p50: 8, frame: 16.7 } })
            }

            // ============================================================ PF9 탭 닫은 뒤 잔여
            //
            // 우리가 만든 탭을 전부 닫고 잔여를 본다. 볼 수 있는 것 —
            //   * `status.states` 는 **Map** 이다(status.service.ts:19 — WeakMap 이 아니다).
            //     닫힌 탭이 남으면 그 탭 객체가 영영 붙잡혀 있다. 지우는 경로는
            //     `decorator.detach → status.forget`(decorator.ts:48-55) 하나뿐이다.
            //   * 사이드바 줄 수가 `app.tabs` 와 맞나 (유령 줄).
            // 볼 수 없는 것 — `screenCheckTimers`·`cwdCache` 는 private WeakMap 이라 밖에서
            // 크기를 못 읽는다. WeakMap 은 키가 죽으면 함께 사라지니 누수 후보에서 뺀다.
            const closed = madeTabs.slice()
            const statesBefore = (ad.status && ad.status.states) ? ad.status.states.size : null
            for (const t of closed.slice().reverse()) {
                try { await ad.app.closeTab(t, false) } catch { /* 이미 닫혔다 */ }
            }
            madeTabs.length = 0
            cleanup.closedTabs = closed.length
            await sleep(700)
            try { ad.render() } catch { /* 무시 */ }
            const statesAfter = (ad.status && ad.status.states) ? ad.status.states.size : null
            if (!closed.length) {
                // 닫은 탭이 0개면 잔여를 볼 근거가 없다 — 그걸 PASS 로 세면 **공허한 통과**다
                add('PF9', '탭 닫은 뒤 잔여', null,
                    '우리가 만든 탭이 없어 닫을 것이 없었다 (앞 단계에서 탭을 못 열었다) — 잔여를 판정할 근거가 없다',
                    { closedTabs: 0, tabs: ad.app.tabs.length, rows: rows() })
            } else if (statesAfter === null) {
                add('PF9', '탭 닫은 뒤 잔여', null,
                    'status.states 를 읽을 수 없다 (필드명이 바뀌었나) — 누수 판정 근거가 없다',
                    { closedTabs: closed.length, rows: rows(), tabs: ad.app.tabs.length })
            } else {
                const leftover = closed.filter(t => ad.status.states.has(t)).length
                const rowsOk = rows() === ad.app.tabs.length
                const ok = leftover === 0 && statesAfter <= Math.max(statesBefore - closed.length, ad.app.tabs.length) && rowsOk
                add('PF9', '탭 닫은 뒤 잔여', ok,
                    `탭 ${closed.length}개를 닫았다 — status.states ${statesBefore}→${statesAfter}개`
                        + ` (닫힌 탭이 남아 있는 수 ${leftover}) · 사이드바 줄 ${rows()}개 = 탭 ${ad.app.tabs.length}개 ${rowsOk ? 'OK' : '불일치'}`
                        + ' · 기준: 닫힌 탭이 states 에 0개, 줄 수 일치',
                    { closedTabs: closed.length, statesBefore, statesAfter, leftover, rows: rows(), tabs: ad.app.tabs.length })
            }
        }
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
        // 예외가 났어도 **안 매긴 케이스는 판정 불가로 채운다** — 결과에서 통째로 빠지면
        // 요약만 조용히 짧아져 "그 케이스는 재지도 않았다" 를 아무도 모른다 (probe-group 과 같은 규칙)
        skipRest(`프로브가 도중에 예외로 멈췄다: ${String((e && e.message) || e)}`, null)
    } finally {
        // ① 랩한 것부터 되돌린다 — 남으면 다음 프로브의 OS 호출이 우리 카운터를 타고 돈다
        for (const undo of restores.slice().reverse()) {
            try { undo() } catch { /* 무시 */ }
        }
        // ② 만든 탭 정리 (PF9 가 이미 닫았으면 비어 있다)
        for (const t of madeTabs.slice().reverse()) {
            try { await ad.app.closeTab(t, false) } catch { /* 이미 닫혔다 */ }
        }
        cleanup.closedTabs = (cleanup.closedTabs ?? 0) + madeTabs.length
        madeTabs.length = 0
        // ③ 설정 원복 — **저장하지 않는다**(머리주석). 저장하면 CDP 가 끊길 때 사용자 파일에 남는다
        try { Object.assign(cfg, saved) } catch { /* 무시 */ }
        cleanup.configRestored = {
            showElapsed: cfg.showElapsed,
            collapsedGroups: Array.isArray(cfg.collapsedGroups) ? cfg.collapsedGroups.length : cfg.collapsedGroups,
            viewerScrape: cfg.viewerScrape, autoDetect: cfg.autoDetect,
            screenWatch: cfg.screenWatch, autoRepairScreen: cfg.autoRepairScreen,
        }
        // ④ 활성 탭도 처음 것으로 (probe-viewer·probe-group 과 같은 이유 — 다음 시나리오가 엉뚱한 탭을 잰다)
        if (prevActiveTab && ad.app.tabs.indexOf(prevActiveTab) >= 0) {
            try { ad.app.selectTab(prevActiveTab) } catch { /* 무시 */ }
        }
        try { ad.relayout(); ad.render() } catch { /* 무시 */ }
        cleanup.tabs = ad.app.tabs.length
        cleanup.sink = sink > 0            // 레이아웃 강제 계산이 실제로 값을 읽었나 (최적화로 사라지지 않았나)
    }

    // 끝까지 왔는데 안 매긴 케이스가 있으면 조용히 빠지지 않게 채운다
    skipRest('실행이 그 케이스에 닿지 않았다 (앞 단계에서 조건이 안 만들어졌다)', null)

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    // **evidence 에 무엇이 들어와도 직렬화가 터지지 않게 한다.**
    // 2026-09-09 실측: 어딘가에서 RxJS 구독 객체가 evidence 로 새어 들어가
    // `Converting circular structure to JSON` 으로 프로브 전체가 예외로 끝났고, 러너에는
    // "출력 파싱 불가" 로만 보여서 **앱이 죽은 것처럼 읽혔다**(원인 추적에 오래 걸렸다).
    // 측정값은 숫자·문자열뿐이라 잃는 것이 없고, 실수로 객체를 넣어도 그 사실이 보인다.
    const seen = new WeakSet()
    const safe = (key, value) => {
        if (typeof value === 'function') { return '[function]' }
        if (typeof value === 'object' && value !== null) {
            if (value instanceof Node) { return '[' + (value.nodeName || 'Node') + ']' }
            if (seen.has(value)) { return '[circular]' }
            seen.add(value)
            // 프레임워크 객체(구독·컴포넌트)는 통째로 이름만 남긴다 — 안을 훑을 값어치가 없다
            const ctor = value.constructor && value.constructor.name
            if (ctor && /Subscri|Subject|Component|Observable|Zone/.test(ctor)) {
                return '[' + ctor + ']'
            }
        }
        return value
    }
    return JSON.stringify({ summary, results, cleanup }, safe, 1)
})()
