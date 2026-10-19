// Read-only installation checks in a dedicated app; user settings are never changed.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('hooks-on-open-ui')) throw new Error('Dedicated isolated app required')
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    if (!document.querySelector('agentdeck-settings-tab')) {
        document.querySelector('button[title="설정"]').click()
        await wait(500)
        ;[...document.querySelectorAll('a,button')].find(x => x.textContent.trim() === 'AgentDeck').click()
        await wait(500)
    }
    const checks = []
    const rows = () => [...document.querySelectorAll('agentdeck-settings-tab .form-line')].filter(x => /Claude integration|Codex integration|Claude 연동|Codex 연동/.test(x.innerText))
    const installed = () => rows().map(row => /Connected|연동됨/.test(row.innerText))
    const check = (name, pass, evidence) => { checks.push({ name, pass: !!pass, evidence }); if (!pass) throw new Error(name) }
    const fs = require('fs'), path = require('path')
    const config = window.__agentdeck.config.store.agentDeck
    const claude = config.claudeStorageDir || process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude')
    const codex = config.codexStorageDir || process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex')
    const targets = new Set([path.join(claude, 'settings.json'), path.join(codex, 'hooks.json'), path.join(codex, 'config.toml')].map(x => path.resolve(x).toLowerCase()))
    const read = fs.readFileSync
    let reads = 0, empty = false
    const reopen = async () => {
        const other = [...document.querySelectorAll('a.nav-link')].find(x => ['응용 프로그램', 'Application'].includes(x.textContent.trim()))
        other.click(); await wait(250)
        check('component destroyed on leaving', !document.querySelector('agentdeck-settings-tab'))
        ;[...document.querySelectorAll('a.nav-link')].find(x => x.textContent.trim() === 'AgentDeck').click()
        await wait(350)
    }
    try {
        check('both integrations initially detected', installed().length === 2 && installed().every(Boolean), installed())
        fs.readFileSync = function (file, ...args) {
            if (targets.has(path.resolve(String(file)).toLowerCase())) {
                reads++
                if (empty) return String(file).endsWith('.toml') ? '' : '{}'
            }
            return read.call(this, file, ...args)
        }
        await wait(6200)
        check('no periodic settings reads over three former intervals', reads === 0, reads)
        empty = true
        await wait(2300)
        check('external change waits until reopening', installed().every(Boolean) && reads === 0)
        await reopen()
        check('reopening rereads configuration', reads > 0, reads)
        check('reopening reflects removed integrations', installed().length === 2 && installed().every(x => !x), installed())
        empty = false
        await reopen()
        check('reopening reflects restored integrations', installed().every(Boolean), installed())
        const lastReads = reads
        await wait(2300)
        check('reopening did not start a new polling timer', reads === lastReads, { reads, lastReads })
        for (const row of rows()) {
            const button = row.querySelector('button'), style = getComputedStyle(button)
            check('button stays one line', style.flexShrink === '0' && style.whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth + 1)
        }
        return { pass: true, checks }
    } catch (error) {
        return { pass: false, checks, error: error.stack }
    } finally { fs.readFileSync = read }
})()
