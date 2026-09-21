/**
 * 상태 배지 회귀 프로브 (ST1~ST8) — **"상태값이 안 바뀐다" 를 재는 자리.**
 *
 *   powershell -File tools/test-instance.ps1 -Cwd D:\Project\tabby-agentdeck
 *   node tools/cdp.js 9222 tools/probe-status.js
 *
 * **무엇을 보나 —** 훅이 보고한 상태는 `pinned` 로 고정된다(`status.service setManual`).
 * 고정은 자동 감지가 훅을 덮지 못하게 하는 장치인데, 훅에는 **"세션이 끝났다" 이벤트가 없다**
 * (`claudeHooks.ts` PLAN 은 UserPromptSubmit/PostToolUse/Notification/Stop 만 설치한다).
 * 그래서 Ctrl+C 로 끊거나 창을 닫거나 CLI 가 죽으면 마지막 `running` 이 그대로 남고,
 * 고정된 탭에는 배지가 내려올 길이 한 개도 없었다 — `setAuto` 는 pinned 를 무시하고,
 * `resume` 은 waiting 전용이고, `unpin` 은 사람이 메뉴에서 고르는 것뿐이다.
 * 사이드바가 "작업중" 이라고 말하는데 실은 아무것도 안 하고 있는 탭이 그 모양이다.
 *
 * 유닛(`test/status.service.test.js`)이 상태기계를 전수로 보지만, **그 값이 화면까지 오는지**와
 * **매초 도는 타이머가 실제로 그 판정을 부르는지**는 여기서만 잰다. 유닛은 `tickIdle` 을 직접
 * 부르고, 제품은 `deck.service tick()` 이 설정값을 실어 부른다 — 그 배선이 빠져도 유닛은 초록이다.
 *
 * 덤으로 ST7·ST8 은 `Ctrl-1…Ctrl-9`(사이드바에 보이는 순서로 N 번째 세션)를 제품 경로
 * (`__agentdeck.jump`)로 태워 **화면 순서와 같은 것을 고르는지** 본다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary` (probe-all.js 와 같은 모양).
 *   pass=true 통과 / false 실패 / null = 판정 불가(환경이 조건을 못 만듦)
 *
 * **자기가 바꾼 것은 되돌린다** — `staleAfterMs`(유예를 짧게 줄여 놓고 잰다), 만든 탭, 상태 고정.
 * 상태 파일은 안 쓴다(훅 배선은 `probe-hooks.js` 몫) — 여기서는 `status` 서비스를 제품이 쓰는
 * 것과 같은 API 로 직접 움직여 **고정된 탭이 풀리는지**만 본다.
 */
(async () => {
    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    const status = ad.status
    const cfg = ad.config.store.agentDeck
    const savedStale = cfg.staleAfterMs
    const savedIdle = cfg.idleAfterMs
    const madeTabs = []
    const touched = []

    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    /** 사이드바 `+ 새 탭` — 제품 경로로 탭을 여는 유일한 창구 (probe-cwd.js 와 같은 이유) */
    const ensurePane = async () => {
        if (panes().length) { return }
        const sb = document.getElementById('agentdeck-sidebar')
        const b = sb ? sb.querySelector('.ad-new') : null
        if (!b) { return }
        b.click()
        for (let i = 0; i < 25 && !panes().length; i++) { await sleep(300) }
    }
    await ensurePane()

    const pane0 = panes()[0]
    const tab0 = pane0
        ? (ad.app.tabs.find(t => t === pane0
            || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane0) >= 0)) ?? ad.app.tabs[0])
        : ad.app.tabs[0]

    /** 사이드바가 그 탭 줄에 실제로 그린 배지 글자 — 내부 상태가 아니라 **화면**을 본다 */
    const badgeOf = tab => {
        const i = ad.app.tabs.indexOf(tab)
        const list = document.querySelector('#agentdeck-sidebar .ad-list')
        if (!list || i < 0) { return null }
        const row = list.querySelector(`.ad-tab[data-ad-index="${i}"]`)
        if (!row) { return null }
        const b = row.querySelector('.ad-badge')
        return b ? (b.textContent || '').trim() : ''
    }
    /** 상태 객체 그대로 — 화면이 안 따라왔을 때 어느 쪽이 늦은 것인지 가르려고 같이 남긴다 */
    const stateOf = tab => {
        const s = status.get(tab)
        return { status: s.status, pinned: s.pinned, reason: s.reason, label: s.label }
    }
    /** `조건이 참이 될 때까지` — 매초 도는 `tick()` 을 기다린다 (폴링 간격 250ms) */
    const until = async (fn, ms) => {
        const end = Date.now() + ms
        while (Date.now() < end) {
            if (fn()) { return true }
            await sleep(250)
        }
        return fn()
    }

    try {
        if (!tab0) {
            add('ST1', '상태 배지 기본 경로', null, '탭이 하나도 없다 — 격리 인스턴스가 안 떴다', {})
        } else {
            touched.push(tab0)

            // ---------- ST1: 훅이 고정한 상태가 화면에 온다 ----------
            // 여기가 깨지면 아래 전부가 무의미하다 (배지가 아예 안 움직인다)
            status.setManual(tab0, 'running', '프로브')
            const gotRunning = await until(() => /진행|작업/.test(badgeOf(tab0) || ''), 3000)
            add('ST1', '훅이 고정한 `진행중` 이 사이드바에 뜬다', gotRunning,
                gotRunning ? '' : '배지가 안 바뀌었다 — 렌더 경로가 상태를 안 읽는다',
                { badge: badgeOf(tab0), state: stateOf(tab0) })

            // ---------- ST2: 고정된 진행중이 기척 없이 멈추면 풀린다 ----------
            // **이 프로브가 생긴 이유.** 세션이 Stop 훅 없이 사라진 상황을 그대로 만든다 —
            // 마지막 보고가 `running` 인 채로 아무 기척(훅 보고·PTY 출력·작업중 신호)도 없다.
            // 유예를 2초로 줄여 실제 `tick()` 이 판정하게 두고 기다린다 (시계를 조작하지 않는다)
            cfg.staleAfterMs = 2000
            const st = status.get(tab0)
            st.since = Date.now() - 60000
            st.lastOutput = Date.now() - 60000
            st.lastBusy = Date.now() - 60000
            const released = await until(() => !status.get(tab0).pinned && status.get(tab0).status === 'idle', 8000)
            add('ST2', '기척이 끊긴 `진행중` 고정은 유예 뒤에 풀린다', released,
                released ? '' : '고정이 안 풀렸다 — 죽은 세션이 영영 `진행중` 으로 남는다',
                { state: stateOf(tab0), badge: badgeOf(tab0), staleAfterMs: cfg.staleAfterMs })

            // ---------- ST3: 풀린 뒤에는 자동 감지가 다시 먹는다 ----------
            // 고정만 남기고 idle 로 내리면 구멍을 반만 막은 것이다 — 그 탭은 이어지는
            // `setAuto` 를 계속 무시해서 셸로 돌아온 뒤에도 배지가 죽어 있다
            status.setAuto(tab0, 'running')
            const revived = status.get(tab0).status === 'running'
            add('ST3', '풀린 탭은 자동 감지가 다시 먹는다', revived,
                revived ? '' : '고정이 남아 setAuto 가 무시됐다',
                { state: stateOf(tab0) })

            // ---------- ST4: 승인대기·한도는 유예에 안 걸린다 ----------
            // 조용한 것이 정상인 상태다 — 시간이 지났다고 내리면 **사람이 답해야 할 탭**이
            // 목록에서 사라진다. 이 갈래가 없으면 ST2 의 수정이 기능을 하나 부순다
            const kept = []
            for (const s of ['waiting', 'limited']) {
                status.setManual(tab0, s, '프로브', '이유')
                const q = status.get(tab0)
                q.since = Date.now() - 60000
                q.lastOutput = Date.now() - 60000
                q.lastBusy = Date.now() - 60000
                await sleep(2500)
                kept.push(`${s}:${status.get(tab0).status}/${status.get(tab0).pinned}`)
            }
            const okKept = kept.join(',') === 'waiting:waiting/true,limited:limited/true'
            add('ST4', '`승인대기`·`한도` 는 유예에 안 걸린다', okKept,
                okKept ? '' : '조용하다는 이유로 내려갔다 — 사람이 답해야 할 탭이 사라진다',
                { kept })

            // ---------- ST5: 훅이 계속 말하면 안 내려온다 ----------
            // 2분짜리 빌드처럼 화면이 조용해 보이는 작업도 보고 하나로 시계가 돌아야 한다
            status.setManual(tab0, 'running', '프로브')
            const s5 = status.get(tab0)
            s5.lastOutput = Date.now() - 60000
            s5.lastBusy = Date.now() - 60000
            let survived = true
            for (let i = 0; i < 6; i++) {
                await sleep(700)
                status.setManual(tab0, 'running')     // 훅 보고 한 번 = since 갱신
                if (!status.get(tab0).pinned || status.get(tab0).status !== 'running') { survived = false }
            }
            add('ST5', '보고가 이어지는 세션은 안 내려온다', survived,
                survived ? '' : '살아 있는 세션의 배지가 꺼졌다 — 유예가 너무 공격적이다',
                { state: stateOf(tab0), staleAfterMs: cfg.staleAfterMs })

            // ---------- ST6: 유예를 끄면 예전 그대로 ----------
            cfg.staleAfterMs = 0
            status.setManual(tab0, 'running', '프로브')
            const s6 = status.get(tab0)
            s6.since = Date.now() - 3600000
            s6.lastOutput = Date.now() - 3600000
            s6.lastBusy = Date.now() - 3600000
            await sleep(2500)
            const frozen = status.get(tab0).pinned && status.get(tab0).status === 'running'
            add('ST6', '`staleAfterMs: 0` 이면 끈 것이다 (예전 동작)', frozen,
                frozen ? '' : '껐는데도 내려갔다 — 기본값이 되살아나는 배선이다',
                { state: stateOf(tab0) })
            status.unpin(tab0)
        }

        // ---------- ST7 · ST8: Ctrl+N — 사이드바에 보이는 순서로 N 번째 ----------
        if (typeof ad.jump !== 'function') {
            add('ST7', 'Ctrl+N 이 보이는 순서로 고른다', null, '`__agentdeck.jump` 진단구가 없다', {})
            add('ST8', 'Ctrl+N 은 범위 밖에서 아무 일도 안 한다', null, '같은 이유', {})
        } else {
            // 탭이 둘 이상이어야 "순서대로 골랐나" 를 가릴 수 있다
            const sb = document.getElementById('agentdeck-sidebar')
            const newBtn = sb ? sb.querySelector('.ad-new') : null
            while (ad.app.tabs.length < 3 && newBtn) {
                const before = ad.app.tabs.length
                newBtn.click()
                for (let i = 0; i < 25 && ad.app.tabs.length === before; i++) { await sleep(300) }
                const made = ad.app.tabs[ad.app.tabs.length - 1]
                if (made && madeTabs.indexOf(made) < 0) { madeTabs.push(made) }
                if (ad.app.tabs.length === before) { break }
            }
            await sleep(600)
            const probe = ad.jump(1)
            if (probe.tabRows.length < 2) {
                add('ST7', 'Ctrl+N 이 보이는 순서로 고른다', null,
                    '보이는 탭 줄이 2개 미만이다 — 순서를 가릴 수 없다', probe)
                add('ST8', 'Ctrl+N 은 범위 밖에서 아무 일도 안 한다', null, '같은 이유', probe)
            } else {
                // **기대값을 산술로 만들지 않는다** — 제품이 말한 화면 순서(`tabRows`)의 N 번째다
                const wrong = []
                const targets = probe.slots ? probe.slots.filter(value => value.tabIndex >= 0) : probe.tabRows.map((tabIndex, i) => ({ number: i + 1, tabIndex }))
                for (const target of targets) {
                    const slot = target.number
                    const r = ad.jump(slot)
                    if (r.activeTabIndex !== target.tabIndex) {
                        wrong.push(`slot=${slot}: 활성 ${r.activeTabIndex} (고정 슬롯 대상 ${target.tabIndex})`)
                    }
                    if (r.navMode === 'list') {
                        wrong.push(`slot=${slot}: 목록에 포커스가 갔다 — 이어지는 타이핑이 터미널로 안 간다`)
                    }
                    if (!r.bound) {
                        wrong.push(`slot=${slot}: 핫키가 안 묶여 있다 (Ctrl-${slot})`)
                    }
                }
                add('ST7', 'Ctrl+N 이 보이는 순서로 N 번째 세션을 고른다', wrong.length === 0,
                    wrong.length ? wrong[0] : '',
                    { rows: probe.tabRows, checked: probe.tabRows.length, wrong })

                // 범위 밖 — 가장 가까운 탭으로 보내면 목록이 줄어든 줄 모르고 누른 사람이
                // 엉뚱한 세션에 입력하게 된다. 아무 일도 안 해야 한다
                const last = ad.jump(targets[targets.length - 1].number)
                const over = ad.jump(10)
                const stayed = over.activeTabIndex === last.activeTabIndex
                add('ST8', 'Ctrl+N 은 범위 밖에서 아무 일도 안 한다', stayed,
                    stayed ? '' : '없는 자리를 눌렀는데 활성 탭이 움직였다',
                    { before: last.activeTabIndex, after: over.activeTabIndex, rows: over.tabRows })
            }
        }
    } finally {
        cfg.staleAfterMs = savedStale
        cfg.idleAfterMs = savedIdle
        for (const t of touched) { try { status.unpin(t) } catch (e) { /* 이미 닫혔다 */ } }
        for (const t of madeTabs) { try { ad.app.closeTab(t, false) } catch (e) { /* 이미 닫혔다 */ } }
    }

    const pass = results.filter(r => r.pass === true).length
    const fail = results.filter(r => r.pass === false).length
    const skip = results.filter(r => r.pass === null).length
    return JSON.stringify({ results, summary: { pass, fail, skip } }, null, 1)
})()
