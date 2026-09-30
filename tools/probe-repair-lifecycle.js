// Run with tools/cdp.js against an isolated test instance.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY) throw new Error('Isolated app required')
    const ad = window.__agentdeck, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const originalTabs = new Set(ad.app.tabs)
    document.querySelector('#agentdeck-sidebar .ad-new').click()
    let tab, pane
    for (let i = 0; i < 50; i++) {
        tab = ad.app.tabs.find(t => !originalTabs.has(t))
        pane = (tab?.getAllTabs?.() || [tab]).find(p => p?.session?.open && p.frontend?.xterm)
        if (pane) break
        await sleep(100)
    }
    if (!pane) throw new Error('Test terminal did not open')
    let deck
    const queue = [pane.injector], seen = new Set()
    while (queue.length && seen.size < 100) {
        const injector = queue.shift()
        if (!injector || seen.has(injector)) continue
        seen.add(injector)
        if (injector.records) for (const record of injector.records.values()) {
            if (record?.value?.resumeStarting instanceof Map) deck = record.value
        }
        queue.push(injector.parent, injector.parentInjector, injector.injector, injector._lView?.[9])
    }
    if (!deck) throw new Error('Deck service unavailable')
    const results = [], session = pane.session, resize = session.resize
    const sendResume = deck.sendResumeCommand, originalRepair = deck.repairPane
    const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const row = { sessionId: sid, agent: 'codex', cwd: process.env.TABBY_CONFIG_DIRECTORY, label: 'Resume fixture' }
    const add = (id, pass, detail) => results.push({ id, pass: !!pass, detail })
    try {
        await sleep(1000)
        ad.app.selectTab(tab)
        ad.pinAgent(pane, 'codex')
        // Tabby's focus redraw briefly resizes columns. Let selection settle
        // before observing the separate AgentDeck repair operation.
        await sleep(300)
        let repairs = 0
        const sizes = []
        deck.repairPane = function (...args) { repairs++; return originalRepair.apply(this, args) }
        session.resize = function (cols, rows) { sizes.push([cols, rows]); return resize.call(this, cols, rows) }
        const x = pane.frontend.xterm, before = [x.cols, x.rows]
        for (let i = 0; i < 50; i++) ad.repair('active')
        await sleep(1900)
        add('RL1', repairs === 1 && session.open && pane.session === session,
            { repairs, sessionAlive: session.open })
        add('RL2', sizes.length > 0 && sizes.every(v => v[0] === before[0]) &&
            sizes.some(v => v[1] === before[1] - 1) && x.cols === before[0] && x.rows === before[1], { before, sizes })
        ad.repair('active')
        await sleep(1900)
        add('RL3', repairs === 2, { repairs })
        const fs = require('fs'), path = require('path')
        const loaded = path.join(path.dirname(process.env.TABBY_CONFIG_DIRECTORY), 'ud/plugins/node_modules/tabby-agentdeck')
        const version = JSON.parse(fs.readFileSync(path.join(loaded, 'package.json'), 'utf8')).version
        add('RL4', document.querySelector('.ad-head-version')?.textContent === 'v' + version, { version })
        // Preserve real profile/tab/PTY creation while avoiding an external model request.
        deck.sendResumeCommand = function (target) { sendResume.call(this, target, 'Write-Output "RESUME_FIXTURE_READY"') }
        const count = ad.app.tabs.length
        await Promise.all(Array.from({ length: 30 }, () => deck.activateResume({ ...row }, false)))
        await sleep(1200)
        const starting = deck.resumeStarting.get(sid)
        await deck.activateResume({ ...row }, false)
        add('RL5', ad.app.tabs.length === count + 1 && starting && ad.app.activeTab === starting,
            { before: count, after: ad.app.tabs.length, focused: ad.app.activeTab === starting })
        const terminal = (starting?.getAllTabs?.() || [starting])[0]
        terminal.sendInput('Write-Output "thread-store conflict: thread already has an active writer"\r')
        await sleep(700)
        add('RL6', !deck.resumeStarting.has(sid), 'Startup failure releases reservation')
        await deck.activateResume({ ...row }, false)
        add('RL7', ad.app.tabs.length === count + 2, 'A failed startup can be retried')
    } finally {
        deck.repairPane = originalRepair
        deck.sendResumeCommand = sendResume
        session.resize = resize
        ad.pinAgent(pane, null)
        for (const created of [...ad.app.tabs]) if (!originalTabs.has(created)) await ad.app.closeTab(created, false)
    }
    return JSON.stringify({ results, pass: results.length === 7 && results.every(r => r.pass) })
})()
