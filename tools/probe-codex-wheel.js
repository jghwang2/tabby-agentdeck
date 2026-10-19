// Run with tools/cdp.js against a dedicated wheel-ui staging instance.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('wheel-ui')) throw Error('Dedicated wheel-ui instance required')
    const ad = window.__agentdeck, wait = ms => new Promise(r => setTimeout(r, ms))
    document.querySelector('.ad-new').click()
    await wait(1800)
    const tab = ad.app.activeTab, pane = (tab.getAllTabs?.() || [tab]).find(p => p.frontend?.xterm)
    const x = pane.frontend.xterm
    const write = data => new Promise(resolve => x.write(data, resolve))
    const results = []
    const wheel = (deltaY, extra = {}) => {
        const rect = x.element.getBoundingClientRect()
        return x.element.dispatchEvent(new WheelEvent('wheel', {
            deltaY, clientX: rect.x + 40, clientY: rect.y + 40,
            bubbles: true, cancelable: true, ...extra,
        }))
    }
    await write('\r\n' + Array.from({ length: 500 }, (_, i) => `native history ${i}`).join('\r\n'))
    x.scrollToBottom()
    await wait(200)
    const before = x.buffer.active.viewportY
    wheel(-120)
    await wait(250)
    const nativeLines = before - x.buffer.active.viewportY
    results.push({ name: 'native terminal baseline', lines: nativeLines, pass: nativeLines > 3 })
    x.reset()
    pane.sendInput('node D:/Project/tabby-agentdeck/tools/fake-codex-scroll.cjs\r')
    const screen = () => Array.from({ length: x.rows }, (_, i) => x.buffer.active.getLine(x.buffer.active.baseY + i)?.translateToString(true) || '')
    for (let i = 0; i < 40 && !screen().some(line => line.includes('wheel draft stays intact')); i++) await wait(100)
    if (!screen().some(line => line.includes('wheel draft stays intact'))) throw Error('PTY fixture did not start')
    ad.pinAgent(pane, 'codex')
    await wait(800)
    const sent = [], originalSend = pane.sendInput
    pane.sendInput = function(data) { sent.push(data); return originalSend.call(this, data) }
    results.push({ name: 'fixture ready', pass: x.buffer.active.baseY === 0, footer: screen().slice(-4), agent: ad.agentOf(tab), rowHeight: x._core.viewport._currentRowHeight })
    const position = () => Number(screen().find(line => /^history row \d+/.test(line))?.match(/\d+/)?.[0])
    const settled = async () => {
        for (let i = 0; i < 30 && !Number.isFinite(position()); i++) await wait(100)
        await wait(350)
    }
    wheel(-120)
    await settled()
    const first = position()
    results.push({ name: 'open pager and scroll at native speed', nativeLines, codexLines: 250 - first, sent: [...sent], baseY: x.buffer.active.baseY, screen: screen().slice(0,3), pass: Math.abs(250 - first - nativeLines) <= 1 })
    wheel(-120)
    await wait(250)
    const second = position()
    results.push({ name: 'continued scroll', lines: first - second, pass: Math.abs(first - second - nativeLines) <= 1 })
    wheel(120)
    await wait(250)
    results.push({ name: 'reverse direction', pass: Math.abs(position() - first) <= 1 })
    const protectedPosition = position()
    wheel(-120, { ctrlKey: true })
    await wait(100)
    results.push({ name: 'modifier guard', pass: position() === protectedPosition })
    x.options.scrollSensitivity = 2
    wheel(-120)
    await wait(250)
    results.push({ name: 'terminal sensitivity', lines: protectedPosition - position(), pass: Math.abs(protectedPosition - position() - nativeLines * 2) <= 1 })
    x.options.scrollSensitivity = 1
    pane.sendInput('q')
    await wait(150)
    results.push({ name: 'draft preserved', pass: screen().some(line => line.includes('› wheel draft stays intact')) })
    pane.sendInput('\x03')
    pane.sendInput = originalSend
    ad.pinAgent(pane, null)
    await wait(700)
    pane.sendInput('node D:/Project/tabby-agentdeck/tools/fake-codex-scroll.cjs --mouse\r')
    for (let i = 0; i < 40 && x.modes.mouseTrackingMode !== 'any'; i++) await wait(100)
    await wait(800)
    ad.pinAgent(pane, 'codex')
    const mouseData = [], subscription = x.onData(data => mouseData.push(data))
    const mouseBefore = position()
    wheel(-120)
    await wait(350)
    const mouseAfter = position()
    results.push({ name: 'fullscreen native mouse matches measured Claude step', lines: mouseBefore - mouseAfter,
        reports: [...mouseData], pass: mouseBefore - mouseAfter === 3 && mouseData.length === 3 && mouseData.every(data => /^\x1b\[<64;\d+;\d+M$/.test(data)) })
    wheel(120)
    await wait(350)
    results.push({ name: 'fullscreen reverse', pass: position() === mouseBefore })
    ad.pinAgent(pane, 'claude')
    mouseData.length = 0
    wheel(-120)
    await wait(350)
    results.push({ name: 'Claude native mouse remains one report', reports: mouseData.length, pass: mouseData.length === 1 && position() === mouseBefore - 1 })
    subscription.dispose()
    pane.sendInput('\x03')
    ad.pinAgent(pane, null)
    return { results, pass: results.every(result => result.pass) }
})()
