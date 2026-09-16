/**
 * PR4·PR5 조사·검증용 일회성 프로브 — `tools/cdp.js <port> tools/probe-pr45.js`.
 *
 * 2026-09-14 에 두 가지를 잰다.
 *  ① **원인 확인** — 화면 감시(`checkScreen`)는 Claude pane 에서만 돈다(`canRepairComposer`).
 *     격리 인스턴스의 첫 pane 은 PowerShell 이라 `effectiveId=unknown` 이고, 그래서
 *     judge 는 broken 인데 채증이 0바이트였다 (= PR4 의 거짓 실패).
 *  ② **고친 길 확인** — `__agentdeck.pinAgent(pane, 'claude')` 로 신원만 빌리면
 *     같은 주입에 `detect 깨짐` 이 찍히나. 끝나면 반드시 푼다.
 */
(async () => {
    const ad = window.__agentdeck
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    if (!ad) { return { error: '__agentdeck 없음 (플러그인 미로드)' } }
    if (!ad.pinAgent) { return { error: 'pinAgent 진단구 없음 (낡은 dist)' } }

    const fs = require('fs')
    const list = []
    const walk = t => {
        if (!t) { return }
        if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { list.push(t) }
    }
    ad.app.tabs.forEach(walk)
    const panes = list.filter(p => p.frontend && p.frontend.xterm)
    if (!panes.length) { return { error: '터미널 pane 이 없다' } }
    const pane = panes[0]
    const owner = ad.app.tabs.find(t => t === pane
        || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0))
    if (owner) { ad.app.selectTab(owner) }
    await sleep(400)

    const SNAP = ad.diagPaths().screen
    const size = () => {
        try { return fs.statSync(SNAP).size } catch { return 0 }
    }
    const since = from => {
        try {
            const fd = fs.openSync(SNAP, 'r')
            const len = Math.max(0, fs.fstatSync(fd).size - from)
            const buf = Buffer.alloc(len)
            fs.readSync(fd, buf, 0, len, from)
            fs.closeSync(fd)
            return buf.toString('utf8')
        } catch { return '' }
    }

    // 깨진 화면 주입 — `probe-profile.js` 의 breakScreen 과 같은 모양(테두리 두 줄을 맞붙인다)
    const breakScreen = p => {
        const x = p.frontend.xterm
        const rule = '─'.repeat(x.cols)
        const K = '[2K'
        let pad = ''
        try {
            pad = '\r\n'.repeat(Math.max(0, (x.rows - 1) - x.buffer.active.cursorY))
        } catch { pad = '' }
        x.write(`${pad}\r\n${K}${rule}\r\n${K}${rule}\r\n${K}`)
    }

    const cfg = ad.config.store.agentDeck
    const savedAuto = cfg.autoRepairScreen
    const savedWatch = cfg.screenWatch
    cfg.autoRepairScreen = false   // 감지와 복구를 섞지 않는다 (PR4 와 같은 조건)
    cfg.screenWatch = true
    await ad.config.save()

    const out = { snapPath: SNAP }
    const run = async label => {
        const from = size()
        breakScreen(pane)
        await sleep(300)
        const v = ad.judge(pane)
        let waited = 0
        while (waited < 8000 && since(from).indexOf('detect 깨짐') < 0) {
            await sleep(250)
            waited += 250
        }
        const inc = since(from)
        const hit = inc.indexOf('detect 깨짐') >= 0
        out[label] = {
            effectiveId: ad.agentOf(owner || pane).effectiveId,
            judgeBroken: !!(v && v.broken),
            detectMs: hit ? waited : -1,
            incBytes: inc.length,
            firstLine: inc.split('\n')[0].slice(0, 110),
        }
        try { pane.frontend.xterm.clear() } catch { /* 무시 */ }
        await sleep(2500)   // 다음 판이 직전 상태를 이어받지 않게 (상태가 바뀔 때만 찍힌다)
    }

    await run('못박기_전')
    ad.pinAgent(pane, 'claude')
    await run('못박은_뒤')
    ad.pinAgent(pane, null)
    out.해제후_effectiveId = ad.agentOf(owner || pane).effectiveId

    cfg.autoRepairScreen = savedAuto
    cfg.screenWatch = savedWatch
    await ad.config.save()
    return out
})()
