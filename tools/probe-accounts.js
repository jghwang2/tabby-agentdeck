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
    try {
        for (const provider of ['claude', 'codex']) {
            document.querySelector('.ad-new').click(); await sleep(2000)
            const tab = panes()[panes().length - 1]
            const owner = ad.app.tabs.find(t => t === tab || t.getAllTabs?.().includes(tab))
            ad.app.selectTab(owner)
            const sid = 'adprobe-account-' + provider + '-' + Date.now()
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
            {
                ad.status.setManual(owner, 'running')
                const before = new Set(ad.app.tabs)
                const previousSession = tab.session
                popup.querySelector('.ad-account-option').click()
                for (let i = 0; i < 60 && (!tab.session || tab.session === previousSession); i++) { await sleep(500) }
                const switched = tab.session && tab.session !== previousSession
                results.push({ test: provider + ' switches in the same active tab', pass: !!switched
                    && before.size === ad.app.tabs.length && ad.app.tabs.every(t => before.has(t)) && ad.app.activeTab === owner })
                if (switched) {
                    const leaf = tab
                    let detected = false
                    for (let i = 0; i < 30; i++) {
                        const x = leaf.frontend.xterm, buffer = x.buffer.active, screen = []
                        for (let n = 0; n < buffer.length; n++) { screen.push(buffer.getLine(n)?.translateToString(true) || '') }
                        if ((provider === 'codex' ? /OpenAI Codex/ : /Claude Code/).test(screen.join('\n'))) { detected = true; break }
                        const children = await Promise.race([leaf.session?.getChildProcesses?.() || [], sleep(1000).then(() => [])])
                        if (children.some(p => new RegExp(provider, 'i').test(p.command || p.name || ''))) { detected = true; break }
                        await sleep(500)
                    }
                    results.push({ test: provider + ' real CLI process started', pass: detected })
                    if (!detected) {
                        const x = leaf.frontend.xterm, b = x.buffer.active, lines = []
                        for (let n = 0; n < b.length; n++) { lines.push(b.getLine(n)?.translateToString(true) || '') }
                        fs.writeFileSync(path.join(process.env.AGENTDECK_DIAG_DIR, 'account-switch-' + provider + '.txt'), lines.join('\n'))
                    }
                    results.push({ test: provider + ' account home applied', pass: !!leaf.profile.options.env[
                        provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'] })
                    document.querySelector('.ad-now-account').click()
                    await sleep(1000)
                    const same = document.querySelector('.ad-account-option')
                    const session = tab.session
                    same?.click()
                    await sleep(1000)
                    results.push({ test: provider + ' current account is a no-op', pass: tab.session === session
                        && !document.querySelector('.ad-account-picker') && ad.app.tabs.length === before.size })
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
