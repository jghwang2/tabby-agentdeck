/** Runs only in the isolated Tabby instance. Does not print account IDs or passwords. */
(async () => {
    const fs = require('fs'), path = require('path'), os = require('os')
    const ad = window.__agentdeck
    require('@electron/remote').getCurrentWindow().webContents.setBackgroundThrottling(false)
    if (!ad) { return { pass: false, reason: 'plugin not loaded' } }
    const results = []
    window.__accountUiProbe = results
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const root = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'tabby-agentdeck')
    const created = []
    const saved = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.agentdeck/accounts.json'), 'utf8'))
    const panes = () => ad.app.tabs.flatMap(t => t.getAllTabs ? t.getAllTabs() : [t]).filter(t => t.frontend?.xterm)
    const originalTabs = new Set(ad.app.tabs)
    document.querySelector('.ad-new').click(); await sleep(2000)
    const tab = panes()[panes().length - 1]
    const owner = ad.app.tabs.find(t => t === tab || t.getAllTabs?.().includes(tab))
    ad.app.selectTab(owner)
    const sid = 'adprobe-account-' + Date.now()
    try {
        for (const provider of ['claude', 'codex']) {
            for (const [folder, body] of [
                ['status', { sessionId: sid, tabId: tab.id, agent: provider, status: 'done', ts: Date.now() }],
                ['meta', { sessionId: sid, agent: provider, ts: Date.now(), model: provider === 'claude' ? 'Fable' : 'Astra',
                    account: 'probe@example.test', configDir: '', cwd: os.tmpdir(), limits: {} }],
            ]) {
                fs.mkdirSync(path.join(root, folder), { recursive: true })
                const file = path.join(root, folder, sid + '.json')
                fs.writeFileSync(file, JSON.stringify(body)); created.push(file)
            }
            await sleep(1200)
            ad.render()
            const button = document.querySelector('.ad-now-account')
            button.click()
            await sleep(1000)
            const popup = document.querySelector('.ad-account-picker')
            for (let i = 0; i < 24 && !popup?.querySelector('.ad-now-gauge'); i++) { await sleep(500) }
            const names = [...(popup?.querySelectorAll('.ad-account-option strong') || [])].map(x => x.textContent)
            const wanted = saved[provider].filter(x => x.id?.trim()).map(x => x.name?.trim() || x.id.trim())
            results.push({ test: provider + ' provider filter', pass: wanted.length === names.length && wanted.every(x => names.includes(x)) })
            const text = popup?.textContent || ''
            const passwords = [...saved.claude, ...saved.codex].map(x => x.password).filter(Boolean)
            results.push({ test: provider + ' password not rendered', pass: passwords.every(x => !text.includes(x)) })
            results.push({ test: provider + ' keyboard button', pass: button.tagName === 'BUTTON' && !button.disabled })
            results.push({ test: provider + ' theme close', pass: popup?.querySelector('.ad-account-close')?.textContent === '×' })
            const gauges = [...(popup?.querySelectorAll('.ad-now-gauge') || [])]
            results.push({ test: provider + ' shared gauge format without context', pass: gauges.length > 0 && gauges.every(g =>
                g.querySelector('.ad-now-gauge-key')?.textContent !== 'ctx'
                && g.querySelector('.ad-now-bar-fill')?.style.width === g.querySelector('.ad-now-gauge-pct')?.textContent) })
            if (provider === 'codex') {
                ad.status.setManual(owner, 'running')
                const before = new Set(ad.app.tabs)
                popup.querySelector('.ad-account-option').click()
                for (let i = 0; i < 60 && !ad.app.tabs.some(t => !before.has(t)); i++) { await sleep(500) }
                const opened = ad.app.tabs.find(t => !before.has(t))
                results.push({ test: 'saved account opens real terminal tab', pass: !!opened })
                if (opened) {
                    const leaf = opened.getAllTabs ? opened.getAllTabs()[0] : opened
                    let detected = false
                    for (let i = 0; i < 30; i++) {
                        const identity = ad.agentOf(opened)
                        if (identity?.effectiveId === 'codex') { detected = true; break }
                        const children = await Promise.race([leaf.session?.getChildProcesses?.() || [], sleep(1000).then(() => [])])
                        if (children.some(p => /codex/i.test(p.command || p.name || ''))) { detected = true; break }
                        await sleep(500)
                    }
                    results.push({ test: 'real Codex process started', pass: detected })
                }
            }
            popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            results.push({ test: provider + ' escape closes', pass: !document.querySelector('.ad-account-picker') })
        }
    } finally {
        document.querySelector('.ad-account-picker')?.remove()
        for (const file of new Set(created)) { try { fs.unlinkSync(file) } catch {} }
        for (const tab of [...ad.app.tabs]) { if (!originalTabs.has(tab)) { await Promise.race([ad.app.closeTab(tab, true), sleep(2000)]) } }
    }
    return { pass: results.every(x => x.pass), results }
})()
