/**
 * 하단 "지금 이 탭" 줄 + 훅이 말하는 에이전트 정체 회귀 프로브 (ML1~ML12).
 *
 *   powershell -File tools/test-instance.ps1 -Cwd D:\Project\tabby-agentdeck
 *   node tools/cdp.js 9222 tools/probe-meta.js
 *
 * **무엇을 보나 —** 두 가지가 한 자리에서 만난다.
 *
 *  ① **모델·계정·한도는 statusLine stdin 에만 내려온다.** 훅 JSON 에는 없고 대화기록(jsonl)에는
 *     모델까지만 있다. 그래서 `hooks/agentdeck-statusline.mjs` 가 원래 statusLine 을 감싸
 *     그 입력을 `%LOCALAPPDATA%\tabby-agentdeck\meta\<session>.json` 으로 흘리고, 플러그인이
 *     400ms 폴링으로 읽어 활성 탭 것만 그린다. 여기서는 **그 파일부터 화면까지**를 잰다.
 *  ② **에이전트가 누구인지는 훅이 말한다.** 예전에는 프로세스 이름 → 명령줄(WMI) → 탭 제목 →
 *     화면 문구로 추측했는데 넷 다 흔들린다(npm 전역 래퍼 gemini 는 자식이 `node.exe` 하나뿐이고
 *     제목에도 이름이 없었다 — 2026-09-08 실측). 훅 스크립트는 `-Agent claude|codex|gemini` 로
 *     불리므로 자기가 누구인지 알고 있다. 그 값이 추측을 이기는지 본다.
 *
 * **규칙을 베끼지 않는다.** 문구 규칙(어느 칸을 언제 접나, 몇 %부터 빨간가)은 `src/meta.ts` 가
 * 유일한 출처이고 조합 전수는 `test/meta.test.js` 몫이다. 여기서는 **제품이 실제로 그린 DOM** 과
 * 제품 자신의 진단구(`__agentdeck.meta()` / `agentOf()`)만 읽는다 — 프로브가 규칙 사본을 들면
 * 제품이 규칙을 바꿔도 초록으로 남는다(이 저장소가 `probe-all.js` 화면 판정 사본으로 이미 겪었다).
 *
 * **자기가 바꾼 것은 되돌린다.** 상태·메타 폴더는 실사용 Tabby 와 **공용**이라, 세션 id 에
 * `adprobe-meta-` 접두를 박고 격리 인스턴스의 tabId 로만 보고한다 — 실사용 쪽 표에 없는 id 라
 * 거기서는 버려진다(`notify.service` `resolveTab`). 마지막에 그 접두의 파일만 지운다.
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

    const ROOT = ad.runtimePaths().root
    const STATUS_DIR = path.join(ROOT, 'status')
    const META_DIR = path.join(ROOT, 'meta')
    const PREFIX = 'adprobe-meta-'
    const written = []

    /** 훅이 쓰는 것과 **같은 모양**의 상태 보고 (hooks/agentdeck-notify.ps1 payload) */
    const report = (sid, tabId, extra) => {
        fs.mkdirSync(STATUS_DIR, { recursive: true })
        const f = path.join(STATUS_DIR, sid + '.json')
        fs.writeFileSync(f, JSON.stringify(Object.assign({
            sessionId: sid, status: 'running', ts: Date.now(), tabId,
        }, extra || {})), 'utf8')
        if (written.indexOf(f) < 0) { written.push(f) }
    }
    /** statusLine 래퍼가 쓰는 것과 같은 모양의 스냅샷 (hooks/agentdeck-statusline.mjs) */
    const meta = (sid, over) => {
        fs.mkdirSync(META_DIR, { recursive: true })
        const f = path.join(META_DIR, sid + '.json')
        fs.writeFileSync(f, JSON.stringify(Object.assign({
            sessionId: sid, ts: Date.now(), agent: 'claude',
            model: 'Opus 5', modelId: 'claude-opus-5', effort: 'high', version: '2.1.270',
            fastMode: false, account: 'probe@example.com', org: 'probeorg', configDir: '',
            cwd: 'D:\\Project\\tabby-agentdeck', contextPct: 13,
            limits: { fiveHourPct: 91, fiveHourResetsAt: Math.floor(Date.now() / 1000) + 3600,
                sevenDayPct: 15, sevenDayResetsAt: Math.floor(Date.now() / 1000) + 86400 },
        }, over || {})), 'utf8')
        if (written.indexOf(f) < 0) { written.push(f) }
    }

    const nowEl = () => document.querySelector('#agentdeck-sidebar .ad-now')
    const nowText = () => {
        const el = nowEl()
        if (!el || el.hidden) { return null }
        return {
            title: (el.querySelector('.ad-now-title') || {}).textContent || '',
            account: (el.querySelector('.ad-now-account') || {}).textContent || '',
            gauges: Array.from(el.querySelectorAll('.ad-now-gauge')).map(g => ({
                text: `${g.querySelector('.ad-now-gauge-key')?.textContent || ''} ${g.querySelector('.ad-now-gauge-pct')?.textContent || ''}`,
                cls: g.className, title: g.title,
            })),
            tooltip: el.title,
        }
    }
    /** 폴링(400ms)이 파일을 집어 화면까지 오기를 기다린다 */
    const until = async (fn, tries = 20) => {
        for (let i = 0; i < tries; i++) {
            const v = fn()
            if (v) { return v }
            await sleep(250)
        }
        return null
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
    const newTabBtn = () => {
        const sb = document.getElementById('agentdeck-sidebar')
        return sb ? sb.querySelector('.ad-new') : null
    }
    /** 격리 인스턴스는 탭 하나로 뜬다 — 탭 전환을 재려면 두 개가 필요하다 */
    const ensureTabs = async n => {
        for (let i = 0; i < 25 && !panes().length; i++) {
            if (i === 0 && newTabBtn()) { newTabBtn().click() }
            await sleep(300)
        }
        // **총 탭 수가 아니라 id 가 심긴 탭 수로 센다.** 격리 인스턴스는 `Welcome` 탭을 달고
        // 뜨는데 그건 터미널이 아니라 영원히 id 가 없다 — 총 수로 세면 "2개 있다" 로 보고
        // 둘째 터미널을 안 열어 탭 전환 항목이 통째로 건너뛰어진다(실측 1회)
        for (let round = 0; round < n && withIds().length < n; round++) {
            const before = ad.app.tabs.length
            if (!newTabBtn()) { break }
            newTabBtn().click()
            for (let i = 0; i < 25 && ad.app.tabs.length === before; i++) { await sleep(300) }
        }
        // 셸이 떠서 AGENTDECK_TAB 표가 채워질 때까지 (tabId 없이는 보고가 탭에 안 묶인다)
        for (let i = 0; i < 20 && withIds().length < n; i++) { await sleep(300) }
    }
    /**
     * **id 가 심긴 탭만 고른다.** 격리 인스턴스는 `Welcome` 탭을 달고 뜨는데 그건 터미널이
     * 아니라 `AGENTDECK_TAB` 이 없다 — 인덱스 0·1 을 그냥 쓰면 그 탭을 집어 판정 불가가 된다
     * (첫 실행에서 실제로 그렇게 났다).
     */
    const withIds = () => (ad.tabIds() || [])
        .map((r, i) => ({ i, id: ((r.ids || [])[0] || null) }))
        .filter(r => r.id)
    await ensureTabs(2)

    const usable = withIds()
    const tabA = usable[0] ? ad.app.tabs[usable[0].i] : null
    const tabB = usable[1] ? ad.app.tabs[usable[1].i] : null
    const idA = usable[0] ? usable[0].id : null
    const idB = usable[1] ? usable[1].id : null
    /**
     * 세션 id 는 **매 실행 새로 뽑는다.** 플러그인은 세션 id 로 값을 기억하므로(`metaBySession`),
     * 같은 id 를 다시 쓰면 앞선 실행이 남긴 값이 메모리에 그대로 있어 "보고가 없을 때" 를 잴 수
     * 없다 — ML3 이 두 번째 실행에서 그렇게 거짓 실패했다(파일은 지웠는데 기억은 남아 있었다).
     * 실사용에서도 세션 id 는 매번 새로 생기니 이쪽이 실제와 같다.
     */
    const RUN = Date.now().toString(36)
    const SID_A = PREFIX + RUN + '-a'
    const SID_B = PREFIX + RUN + '-b'
    const SID_C = PREFIX + RUN + '-c'
    const SID_CODEX = PREFIX + RUN + '-codex'
    /** ML11 을 잰 탭 — 끝나면 닫는다 */
    let tabC = null
    const cfg = ad.config.store.agentDeck
    const metaLineWas = cfg.metaLine

    /** 탭의 첫 터미널 패널 (분할 래퍼면 자식 중 첫 번째) */
    const paneOf = tab => (tab && typeof tab.getAllTabs === 'function' ? tab.getAllTabs()[0] : tab)
    /** 셸 아래 자식 프로세스 개수 — 제품이 보는 것과 같은 창구(`session.getChildProcesses`) */
    const childCount = async tab => {
        try { return ((await paneOf(tab).session.getChildProcesses()) || []).length } catch (e) { return -1 }
    }
    /**
     * 탭 셸 아래에 **이름이 `codex` 인 프로세스**를 띄운다 — Windows 기본 `ping.exe` 를 `codex.exe` 로
     * 복사해 30초 돌린다(실물 codex 없이, 토큰 0).
     *
     * 왜 필요한가 — 훅에는 "세션 끝" 이 없어서, 같은 탭에서 claude 를 끄고 훅 없는 codex 를 띄우면
     * 옛 `claude` 가 남는다. 제품은 프로세스 이름이 **다른 에이전트를 확실히** 가리킬 때만 훅 값을
     * 버린다(`detectAgentApp`). 그 "확실한 근거" 를 실제 프로세스로 만든다.
     *
     * 자식이 안 보이면 판정 불가(null)로 남긴다 — `getChildProcesses()` 는 처음 연 터미널 탭 외에는
     * 자식이 돌아도 `[]` 를 냈다(ML11 머리주석 ①).
     */
    const FAKE_DIR = path.join(os.tmpdir(), 'ad-probe-meta-fake')
    const FAKE = path.join(FAKE_DIR, 'codex.exe')
    const startFakeCodex = async tab => {
        fs.mkdirSync(FAKE_DIR, { recursive: true })
        if (!fs.existsSync(FAKE)) { fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), FAKE) }
        paneOf(tab).sendInput(`& '${FAKE}' -n 30 127.0.0.1\r`)
        for (let i = 0; i < 20 && (await childCount(tab)) < 1; i++) { await sleep(250) }
        return childCount(tab)
    }
    const stopFake = async tab => {
        paneOf(tab).sendInput('\x03')
        for (let i = 0; i < 20 && (await childCount(tab)) > 0; i++) { await sleep(250) }
    }

    try {
        if (!idA || !tabA) {
            add('ML1', '준비', null, 'AGENTDECK_TAB 이 심긴 탭이 없다 — 셸이 안 떴다',
                { tabIds: ad.tabIds() })
            return JSON.stringify({ results, summary: { pass: 0, fail: 0, skip: 1 } }, null, 1)
        }

        // ---------- ML1: 훅이 말한 정체가 추측을 이긴다 ----------
        ad.app.selectTab(tabA)
        report(SID_A, idA, { agent: 'codex' })
        const asCodex = await until(() => {
            const a = ad.agentOf(tabA)
            return a && a.hookId === 'codex' ? a : null
        })
        add('ML1', '훅이 말한 에이전트가 1순위다', !!asCodex && asCodex.effectiveId === 'codex',
            asCodex ? `hookId=${asCodex.hookId} effectiveId=${asCodex.effectiveId} (추측 캐시 id=${asCodex.id})`
                : '훅 보고가 탭에 안 묶였다',
            { agentOf: ad.agentOf(tabA) })

        // ---------- ML2: 다른 CLI 로 갈아타면 그 값이 덮는다 ----------
        report(SID_A, idA, { agent: 'claude' })
        const backToClaude = await until(() => {
            const a = ad.agentOf(tabA)
            return a && a.hookId === 'claude' ? a : null
        })
        add('ML2', '보고가 바뀌면 정체도 바뀐다', !!backToClaude && backToClaude.effectiveId === 'claude',
            backToClaude ? `hookId=${backToClaude.hookId} effectiveId=${backToClaude.effectiveId}` : '안 바뀌었다',
            { agentOf: backToClaude })

        // ---------- ML3: 보고가 없으면 줄이 접혀 있다 ----------
        add('ML3', '모델 보고가 없으면 줄을 안 그린다', nowText() === null,
            nowText() === null ? 'hidden' : '보고 없이 줄이 떠 있다', { now: nowText() })

        // ---------- ML4: 모델·effort·계정이 그려진다 ----------
        meta(SID_A)
        const shown = await until(() => nowText())
        add('ML4', '모델·effort 가 제목 줄에 뜬다',
            !!shown && shown.title === 'Claude · Opus 5 · high',
            shown ? `title=${JSON.stringify(shown.title)}` : '줄이 안 떴다', { now: shown })
        add('ML5', '계정이 둘째 줄에 뜬다',
            !!shown && shown.account === 'probe@example.com',
            shown ? `account=${JSON.stringify(shown.account)}` : '줄이 안 떴다', { account: shown && shown.account })

        // ---------- ML6: 한도 칸 3종 + 급한 것만 색이 다르다 ----------
        const gauges = shown ? shown.gauges : []
        const hot = gauges.filter(g => g.cls.indexOf('ad-now-hot') >= 0).map(g => g.text)
        add('ML6', '컨텍스트·5h·7d 가 칸으로 뜨고 급한 것만 색이 다르다',
            gauges.length === 3 && hot.length === 1 && hot[0] === '5h 91%',
            `칸=${JSON.stringify(gauges.map(g => g.text))} hot=${JSON.stringify(hot)}`,
            { gauges })
        add('ML7', '리셋까지 남은 시간이 칸 툴팁에 붙는다',
            gauges.length === 3 && /뒤 리셋|곧 리셋/.test(gauges[1].title),
            gauges.length === 3 ? `title=${JSON.stringify(gauges[1].title)}` : '칸이 없다',
            { titles: gauges.map(g => g.title) })

        // ---------- ML8: 탭을 바꾸면 그 탭 값으로 다시 그린다 ----------
        if (!idB || !tabB) {
            add('ML8', '탭을 바꾸면 그 탭 값으로 다시 그린다', null,
                '탭을 두 개 못 만들었다 — 이 항목은 두 탭이 있어야 잰다', { idB })
        } else {
            report(SID_B, idB, { agent: 'claude' })
            meta(SID_B, { model: 'Sonnet 5', modelId: 'claude-sonnet-5', effort: 'low',
                account: 'other@example.com', contextPct: 4,
                limits: { fiveHourPct: 2, fiveHourResetsAt: 0, sevenDayPct: 1, sevenDayResetsAt: 0 } })
            ad.app.selectTab(tabB)
            const onB = await until(() => {
                const t = nowText()
                return t && t.title.indexOf('Sonnet 5') >= 0 ? t : null
            })
            ad.app.selectTab(tabA)
            const backOnA = await until(() => {
                const t = nowText()
                return t && t.title.indexOf('Opus 5') >= 0 ? t : null
            })
            add('ML8', '탭을 바꾸면 그 탭 값으로 다시 그린다',
                !!onB && !!backOnA && onB.account === 'other@example.com',
                onB && backOnA ? `B=${JSON.stringify(onB.title)} / 돌아오면 A=${JSON.stringify(backOnA.title)}`
                    : 'B 탭 값으로 안 바뀌었다',
                { onB, backOnA })
        }

        // ---------- ML12: Codex 탭도 같은 줄을 채운다 (세션 기록에서) ----------
        // Codex 에는 statusLine 이 없다. 대신 자기 세션 기록(rollout jsonl)에 같은 값을 남기므로
        // 플러그인이 그걸 증분으로 읽는다(`notify.service.scanCodexMeta`). 줄 모양은 실측 그대로다.
        //
        // **실사용 `~/.codex` 에는 절대 쓰지 않는다** — 거기에 파일을 만들면 `지난 세션` 목록에
        // 유령 세션이 생긴다. `CODEX_HOME` 이 격리된 값일 때만 잰다.
        const codexHome = process.env.CODEX_HOME || ''
        const isolatedHome = codexHome && codexHome.replace(/\\/g, '/').toLowerCase().indexOf('/appdata/local/temp/') >= 0
        if (!idB || !tabB) {
            add('ML12', 'Codex 탭도 모델·계정·한도를 그린다', null, '탭을 두 개 못 만들었다', { idB })
        } else if (!isolatedHome) {
            add('ML12', 'Codex 탭도 모델·계정·한도를 그린다', null,
                `CODEX_HOME 이 격리된 값이 아니다(${codexHome || '없음'}) — 실사용 ~/.codex 에는 쓰지 않는다`,
                { codexHome })
        } else {
            // 훅이 보고하는 session_id 와 rollout 파일 이름의 id 는 **같은 값**이다(실제 Codex 가 그렇다).
            // 다르게 두면 플러그인이 기록 파일을 못 찾는다 — 첫 판이 그래서 FAIL 했다(2026-09-14)
            const sid = SID_CODEX
            const dir = path.join(codexHome, 'sessions', '2026', '09', '14')
            fs.mkdirSync(dir, { recursive: true })
            const roll = path.join(dir, `rollout-2026-09-14T00-00-00-${sid}.jsonl`)
            const nowSec = Math.floor(Date.now() / 1000)
            fs.writeFileSync(roll, [
                JSON.stringify({ type: 'session_meta', payload: { session_id: sid, cwd: 'D:\\Project\\tabby-agentdeck', cli_version: '0.154.0', context_window: 400000 } }),
                JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'low', cwd: 'D:\\Project\\tabby-agentdeck' } }),
                JSON.stringify({ type: 'event_msg', payload: { type: 'token_count',
                    rate_limits: { limit_id: 'codex', primary: { used_percent: 88, window_minutes: 300, resets_at: nowSec + 1800 },
                        secondary: { used_percent: 24, window_minutes: 10080, resets_at: nowSec + 86400 } },
                    info: { last_token_usage: { total_tokens: 40000 } } } }),
            ].join('\n') + '\n', 'utf8')
            written.push(roll)
            // 훅 보고로 **세션↔탭을 묶는다** — 추측 경로는 쓰지 않는다(그래서 Codex 훅이 없으면 이 줄도 안 나온다)
            report(sid, idB, { agent: 'codex' })
            ad.app.selectTab(tabB)
            const codexShown = await until(() => {
                const t = nowText()
                return t && t.title.indexOf('gpt-6-astra') >= 0 ? t : null
            }, 40)
            // 기록이 자라면 따라오는지 — 모델과 한도를 바꿔 한 줄 더 붙인다
            fs.appendFileSync(roll, JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra-mini', effort: 'high' } }) + '\n', 'utf8')
            const grew = await until(() => {
                const t = nowText()
                return t && t.title.indexOf('gpt-6-astra-mini') >= 0 ? t : null
            }, 40)
            const gaugeText = codexShown ? codexShown.gauges.map(g => g.text) : []
            add('ML12', 'Codex 탭도 모델·계정·한도를 그린다',
                !!codexShown && codexShown.title === 'Codex · gpt-6-astra · low'
                    && codexShown.account === 'codex-probe@example.com'
                    && gaugeText.indexOf('5h 88%') >= 0 && gaugeText.indexOf('7d 24%') >= 0
                    && !!grew,
                codexShown
                    ? `${JSON.stringify(codexShown.title)} / ${codexShown.account} / ${JSON.stringify(gaugeText)}`
                        + ` / 기록이 자라면 ${grew ? JSON.stringify(grew.title) : '안 따라왔다'}`
                    : 'Codex 값이 줄에 안 떴다',
                { codexShown, grew })
            ad.app.selectTab(tabA)
        }

        // ---------- ML9: 설정으로 끄면 줄이 사라진다 ----------
        cfg.metaLine = false
        ad.config.save()
        const gone = await until(() => (nowText() === null ? 'hidden' : null))
        cfg.metaLine = metaLineWas
        ad.config.save()
        const back = await until(() => nowText())
        add('ML9', '끄면 줄이 사라지고 켜면 돌아온다', gone === 'hidden' && !!back,
            `끈 뒤=${gone || '남아 있다'} / 켠 뒤=${back ? back.title : '안 돌아왔다'}`,
            { back })

        // ---------- ML11: 다른 에이전트가 확실히 뜨면 훅이 남긴 정체를 버린다 ----------
        // **맨 마지막에, 첫 터미널 탭(tabA)에서 재고 그 탭을 닫는다.** 이유 둘 —
        //  ① `getChildProcesses()` 는 **처음 연 터미널 탭에서만** 자식을 보여 줬다. 뒤에 연 탭은
        //     `ping` 이 응답을 찍고 있는데도 `[]` 였다(winpty·ConPTY 둘 다, 2026-09-14 실측).
        //  ② codex 이름의 프로세스를 돌린 탭은 (제품이 옳게) codex 로 식별된 채 남는다. 그 탭을 두면
        //     같은 인스턴스에서 뒤이어 도는 프로브가 줄바꿈을 codex 식(`1b 0d`)으로 보고 실패한다
        //     (probe-input IN7·IN8 이 그렇게 거짓 실패했다).
        tabC = tabA
        ad.app.selectTab(tabC)
        report(SID_C, idA, { agent: 'claude' })
        const before11 = await until(() => {
            const a = ad.agentOf(tabC)
            return a && a.hookId === 'claude' ? a : null
        })
        const kids = await startFakeCodex(tabC)
        if (kids < 1) {
            add('ML11', '다른 에이전트 프로세스가 뜨면 훅이 남긴 정체를 버린다', null,
                `자식 프로세스가 안 보인다(${kids}) — 이 탭에서는 getChildProcesses 가 비어 온다(①)`,
                { before11 })
        } else {
            ad.probeAgent(tabC)
            const switched = await until(() => {
                const a = ad.agentOf(tabC)
                // `effectiveId` 까지 본다 — 훅 값만 지워지고 다른 캐시(스트림 추적기)에 옛 정체가
                // 남아 있으면 화면 판정은 여전히 옛 프로필로 돈다(첫 구현이 정확히 그랬다)
                return a && a.hookId === null && a.id === 'codex' && a.effectiveId === 'codex' ? a : null
            })
            add('ML11', '다른 에이전트 프로세스가 뜨면 훅이 남긴 정체를 버린다',
                !!before11 && !!switched,
                `전 hookId=${before11 && before11.hookId} / 자식=${kids} / 후=${JSON.stringify(ad.agentOf(tabC))}`,
                { before11, after: ad.agentOf(tabC) })
        }
        await stopFake(tabC)
    } catch (e) {
        add('ML-ERR', '프로브 실행', false, String((e && e.message) || e), {})
    } finally {
        // ML11 을 잰 탭은 가짜 codex 를 내리고 닫는다 — codex 로 식별된 탭을 남기면 뒤 프로브가 오염된다
        let tabCClosed = !tabC
        if (tabC) {
            try { if ((await childCount(tabC)) > 0) { await stopFake(tabC) } } catch (e) { /* 탭이 이미 없다 */ }
            try { await ad.app.closeTab(tabC, false) } catch (e) { /* 이미 닫혔다 */ }
            for (let i = 0; i < 20 && ad.app.tabs.indexOf(tabC) >= 0; i++) { await sleep(150) }
            tabCClosed = ad.app.tabs.indexOf(tabC) < 0
        }
        try { fs.rmSync(FAKE_DIR, { recursive: true, force: true }) } catch (e) { /* 아직 잡혀 있으면 다음 실행이 덮는다 */ }
        cfg.metaLine = metaLineWas
        try { ad.config.save() } catch (e) { /* 설정 저장 실패는 정리 보고에만 남긴다 */ }
        // 공용 폴더라 **우리 접두의 파일만** 지운다
        const removed = []
        for (const f of written) {
            // rollout 픽스처는 이름이 `rollout-…-<uuid>.jsonl` 이라 접두가 안 맞는다.
            // 격리 CODEX_HOME 안의 파일만 통과시킨다(실사용 ~/.codex 는 애초에 쓰지 않는다)
            const norm = x => String(x).replace(/\\/g, '/').toLowerCase()
            const inCodexHome = !!process.env.CODEX_HOME && norm(f).indexOf(norm(process.env.CODEX_HOME)) === 0
            if (path.basename(f).indexOf(PREFIX) !== 0 && !inCodexHome) { continue }
            try { fs.unlinkSync(f); removed.push(path.basename(f)) } catch (e) { /* 이미 없다 */ }
        }
        add('ML10', '정리 확인', removed.length === written.length && tabCClosed,
            `지운 파일 ${removed.length}/${written.length}, metaLine 복원=${cfg.metaLine}, ML11 탭 닫힘=${tabCClosed}`,
            { removed })
    }

    const pass = results.filter(r => r.pass === true).length
    const fail = results.filter(r => r.pass === false).length
    const skip = results.filter(r => r.pass === null).length
    return JSON.stringify({ results, summary: { pass, fail, skip } }, null, 1)
})()
