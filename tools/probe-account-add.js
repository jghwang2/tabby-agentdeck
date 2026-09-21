/** Run only with an isolated AGENTDECK_ACCOUNTS_FILE. Never edits the user's account file. */
(async () => {
    const fs = require('fs'), path = require('path'), os = require('os')
    const file = process.env.AGENTDECK_ACCOUNTS_FILE
    if (!file || !file.includes('ad-account-switch-stage')) { throw new Error('Isolated account file required') }
    const ad = window.__agentdeck, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const results = [], created = [], beforeTabs = new Set(ad.app.tabs)
    const check = (test, pass) => results.push({ test, pass: !!pass })
    const data = () => JSON.parse(fs.readFileSync(file, 'utf8'))
    const root = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'tabby-agentdeck')
    require('@electron/remote').getCurrentWindow().webContents.setBackgroundThrottling(false)
    try {
        for (const provider of ['codex', 'claude']) {
            document.querySelector('.ad-new').click(); await sleep(2000)
            const owner = ad.app.activeTab, pane = owner.getAllTabs?.()[0] || owner
            const sid = 'account-add-probe-' + provider + '-' + Date.now()
            for (const [folder, value] of [
                ['status', { sessionId: sid, tabId: pane.id, agent: provider, status: 'done', ts: Date.now() }],
                ['meta', { sessionId: sid, agent: provider, ts: Date.now(), model: 'test', account: 'probe@example.test', cwd: os.tmpdir(), limits: {} }],
            ]) {
                const target = path.join(root, folder, sid + '.json')
                fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); created.push(target)
            }
            await sleep(1200); ad.render()
            document.querySelector('.ad-now-account').click(); await sleep(300)
            const popup = () => document.querySelector('.ad-account-picker')
            popup().querySelector('.ad-account-add').click()
            let form = popup().querySelector('form')
            check(provider + ' add form and masked password', form && form.querySelector('[name=password]').type === 'password')
            const lang = ad.config.store.language
            const notice = form.querySelector('.ad-account-plaintext').textContent
            check(provider + ' localized plaintext notice', lang.startsWith('ja') ? /平文.*保存/.test(notice)
                : lang.startsWith('ko') ? /이 PC에 평문으로 저장/.test(notice) : /plain text on this PC/.test(notice))
            const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
            form.querySelector('[type=button]').click()
            check(provider + ' cancel does not save', !popup().querySelector('form') && (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) === before)
            popup().querySelector('.ad-account-add').click()
            form = popup().querySelector('form')
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            check(provider + ' empty submission rejected', !!form.querySelector('[role=alert]').textContent
                && (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) === before)
            const id = provider + '-fixture-' + Date.now() + '@example.test', password = 'fixture-only-password'
            form.querySelector('[name=account]').value = id
            form.querySelector('[name=password]').value = password
            form.querySelector('[type=submit]').click(); await sleep(600)
            const saved = data()
            check(provider + ' actual plaintext disk write', saved[provider]?.some(row => row.id === id && row.password === password))
            check(provider + ' saved account appears without exposing password', popup().textContent.includes(id) && !popup().textContent.includes(password))
            const snapshot = fs.readFileSync(file, 'utf8')
            popup().querySelector('.ad-account-add').click(); form = popup().querySelector('form')
            form.querySelector('[name=account]').value = id.toUpperCase()
            form.querySelector('[name=password]').value = 'must-not-overwrite'
            form.querySelector('[type=submit]').click(); await sleep(100)
            check(provider + ' duplicate keeps original file', !!form.querySelector('[role=alert]').textContent && fs.readFileSync(file, 'utf8') === snapshot)
            popup().querySelector('.ad-account-close').click()
        }
        check('both provider lists preserved', data().claude?.length > 0 && data().codex?.length > 0)
    } finally {
        document.querySelector('.ad-account-picker .ad-account-close')?.click()
        for (const target of created) { try { fs.unlinkSync(target) } catch {} }
        for (const tab of [...ad.app.tabs]) { if (!beforeTabs.has(tab)) { await Promise.race([ad.app.closeTab(tab, true), sleep(2000)]) } }
    }
    return { pass: results.every(r => r.pass), results }
})()
