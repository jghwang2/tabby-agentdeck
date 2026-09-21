/** Isolated fresh-login probe. Intercept browser launch to avoid signing in an unrelated browser session. */
(async () => {
    const fs = require('fs'), path = require('path'), os = require('os')
    const file = process.env.AGENTDECK_ACCOUNTS_FILE
    if (!file || !file.includes('ad-account-switch-stage')) { throw new Error('Isolated account file required') }
    const ad = window.__agentdeck, shell = require('electron').shell
    const originalOpen = shell.openExternal, before = new Set(ad.app.tabs), created = []
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    let officialBrowserRequested = false
    try {
        shell.openExternal = async url => {
            officialBrowserRequested = new URL(url).origin === 'https://auth.openai.com'
            throw new Error('Intentional isolated browser cancellation')
        }
        document.querySelector('.ad-new').click(); await sleep(2000)
        const owner = ad.app.activeTab, pane = owner.getAllTabs?.()[0] || owner
        const sid = 'fresh-login-probe-' + Date.now()
        const root = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'tabby-agentdeck')
        for (const [folder, value] of [
            ['status', { sessionId: sid, tabId: pane.id, agent: 'codex', status: 'done', ts: Date.now() }],
            ['meta', { sessionId: sid, agent: 'codex', ts: Date.now(), model: 'test', account: 'current@example.test', cwd: os.tmpdir(), limits: {} }],
        ]) {
            const target = path.join(root, folder, sid + '.json')
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); created.push(target)
        }
        await sleep(1200); ad.render(); document.querySelector('.ad-now-account').click(); await sleep(300)
        let popup = document.querySelector('.ad-account-picker')
        popup.querySelector('.ad-account-add').click()
        const form = popup.querySelector('form')
        form.querySelector('[name=account]').value = 'fresh-' + Date.now() + '@example.test'
        form.querySelector('[name=password]').value = 'fixture-password'
        form.querySelector('[type=submit]').click(); await sleep(500)
        popup = document.querySelector('.ad-account-picker')
        const button = [...popup.querySelectorAll('.ad-account-option')].at(-1)
        const session = pane.session
        button.click()
        for (let i = 0; i < 80 && (!officialBrowserRequested || button.disabled); i++) { await sleep(500) }
        const results = {
            officialBrowserRequested,
            failureDidNotRestartSession: pane.session === session,
            retryEnabled: !button.disabled,
            browserFailureShown: /브라우저|browser/i.test(popup.querySelector('[role=status]').textContent),
        }
        return { pass: Object.values(results).every(Boolean), results }
    } finally {
        shell.openExternal = originalOpen
        document.querySelector('.ad-account-close')?.click()
        for (const target of created) { try { fs.unlinkSync(target) } catch {} }
        for (const tab of [...ad.app.tabs]) { if (!before.has(tab)) { await ad.app.closeTab(tab, true) } }
    }
})()
