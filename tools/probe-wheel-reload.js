// Run twice via cdp.js on a dedicated wheel-ui instance; the first call reloads it.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('wheel-ui')) throw Error('Dedicated wheel-ui instance required')
    const ad = window.__agentdeck, sleep = ms => new Promise(r => setTimeout(r, ms))
    const key = 'agentdeck.wheelReloadProbe'
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const reloader = ad.app.tabsService.injector.get(params[6])
    let saved = JSON.parse(localStorage.getItem(key) || 'null')
    if (!saved) {
        document.querySelector('.ad-new').click()
        await sleep(2000)
        const tab = ad.app.activeTab, pane = (tab.getAllTabs?.() || [tab])[0]
        pane.sendInput('node D:/Project/tabby-agentdeck/tools/fake-codex-scroll.cjs --mouse\r')
        const x = pane.frontend.xterm
        for (let i = 0; i < 80 && x.modes.mouseTrackingMode !== 'any'; i++) await sleep(100)
        if (x.buffer.active.type !== 'alternate' || x.modes.mouseTrackingMode !== 'any') throw Error('Fixture not ready')
        await new Promise(r => x.write('\x1b[?2004h\x1b[?1004h', r))
        saved = { pty: pane.session.getID(), type: x.buffer.active.type, modes: x.modes,
            encoding: x._core.coreMouseService.activeEncoding }
        localStorage.setItem(key, JSON.stringify(saved))
        setTimeout(() => reloader.reload('wheel-reload-regression'), 100)
        return { phase: 'before', ...saved }
    }
    const tab = ad.app.tabs.find(t => (t.getAllTabs?.() || [t]).some(p => p.session?.getID() === saved.pty))
    if (!tab) throw Error('PTY was not restored')
    ad.app.selectTab(tab)
    const pane = (tab.getAllTabs?.() || [tab]).find(p => p.session?.getID() === saved.pty)
    const x = pane.frontend.xterm
    await sleep(700)
    const results = []
    const add = (name, pass, detail) => results.push({ name, pass: !!pass, detail })
    add('same live PTY', pane.session.open, pane.session.getID())
    add('alternate screen preserved', x.buffer.active.type === saved.type, x.buffer.active.type)
    add('mouse tracking preserved', x.modes.mouseTrackingMode === saved.modes.mouseTrackingMode, x.modes.mouseTrackingMode)
    add('SGR encoding preserved', x._core.coreMouseService.activeEncoding === saved.encoding, x._core.coreMouseService.activeEncoding)
    add('paste and focus modes preserved', x.modes.bracketedPasteMode && x.modes.sendFocusMode, x.modes)
    ad.pinAgent(pane, 'codex')
    const position = () => {
        const b = x.buffer.active
        for (let i = 0; i < x.rows; i++) {
            const m = b.getLine(b.baseY + i)?.translateToString(true).match(/^history row (\d+)/)
            if (m) return Number(m[1])
        }
        return NaN
    }
    const before = position(), data = [], sub = x.onData(s => data.push(s))
    const rect = x.element.getBoundingClientRect()
    x.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120,
        clientX: rect.x + 40, clientY: rect.y + 40, bubbles: true, cancelable: true }))
    for (let i = 0; i < 60 && position() === before; i++) await sleep(100)
    sub.dispose()
    add('wheel scrolls actual PTY after reload', before - position() === 3, { before, after: position(), data })
    ad.pinAgent(pane, null)
    pane.sendInput('\x03')
    localStorage.removeItem(key)
    return { phase: 'after', pass: results.every(r => r.pass), results }
})()
