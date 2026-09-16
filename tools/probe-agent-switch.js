/**
 * 같은 탭에서 CLI 를 갈아탈 때 정체가 따라오는지 실측 — `tools/cdp.js <port> tools/probe-agent-switch.js`.
 *
 * 훅은 자기가 무슨 CLI 인지 **정확히 안다** (각 CLI 설정에 따로 심는다). 틀리는 게 아니라
 * **낡는다** — 훅에 "세션이 끝났다" 가 없어서, claude 를 끄고 다른 CLI 를 띄워도 옛 값이 남는다.
 * 그래서 `claude` → 끄기 → `codex` 를 실제로 해 보고, 정체가 언제 따라오는지를 잰다.
 */
(async () => {
    const ad = window.__agentdeck
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    if (!ad) { return { error: '__agentdeck 없음 (플러그인 미로드)' } }

    const panesOf = () => {
        const list = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { list.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return list.filter(p => p.frontend && p.frontend.xterm)
    }

    const before = panesOf().length
    const btn = document.querySelector('#agentdeck-sidebar .ad-new')
    if (!btn) { return { error: '새 탭 버튼이 없다' } }
    btn.click()
    let waited = 0
    while (waited < 10000 && panesOf().length <= before) { await sleep(250); waited += 250 }
    await sleep(1500)
    const pane = panesOf()[panesOf().length - 1]
    if (!pane) { return { error: '탭을 못 열었다' } }
    const owner = ad.app.tabs.find(t => t === pane
        || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0))
    if (owner) { ad.app.selectTab(owner) }
    await sleep(500)

    const x = pane.frontend.xterm
    const screen = () => {
        const b = x.buffer.active
        const rows = []
        for (let i = 0; i < x.rows; i++) {
            rows.push((b.getLine(b.baseY + i) || { translateToString: () => '' }).translateToString(true))
        }
        return rows.join('\n')
    }
    const who = () => { try { return ad.agentOf(owner || pane).effectiveId } catch { return 'error' } }
    const tail = () => screen().split('\n').map(r => r.trim()).filter(Boolean).slice(-4)
    const until = async (test, limit) => {
        let t = 0
        while (t < limit && !test()) { await sleep(250); t += 250 }
        return t
    }

    const out = { 셸정체: who() }

    // ── 1) claude 를 띄운다 ──
    pane.sendInput('claude\r')
    out.claude정체까지ms = await until(() => who() === 'claude', 60000)
    out.claude정체 = who()
    out.claude화면 = tail()
    if (out.claude정체 !== 'claude') { return out }

    // ── 2) 끈다 ── (한 pty 에서 두 CLI 가 같이 돌 수는 없다)
    pane.sendInput('\x03')
    await sleep(400)
    pane.sendInput('\x03')
    await sleep(600)
    pane.sendInput('/exit\r')
    await until(() => /\$|>|#/.test(screen().split('\n').filter(Boolean).slice(-1)[0] || ''), 15000)
    await sleep(1500)
    out.끈직후정체 = who()          // 여기서 'claude' 로 남아 있는 것은 정상이다 (훅이 낡은 상태)
    out.끈직후화면 = tail()

    // ── 3) codex 를 띄운다 — 정체가 따라오는지가 이 프로브의 전부다 ──
    pane.sendInput('codex\r')
    out.codex배너까지ms = await until(() => /OpenAI Codex|Ask Codex/.test(screen()), 40000)
    out.배너뜬순간정체 = who()
    out.codex정체까지ms = await until(() => who() === 'codex', 30000)
    out.최종정체 = who()
    out.codex화면 = tail()
    out.판정 = out.최종정체 === 'codex' ? '정체가 따라왔다' : '옛 정체가 남았다'

    pane.sendInput('\x03')
    await sleep(300)
    pane.sendInput('\x04')
    await sleep(500)
    try { await ad.app.closeTab(owner || pane, false) } catch { /* 이미 닫혔다 */ }
    return out
})()
