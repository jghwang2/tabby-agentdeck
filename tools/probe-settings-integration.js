// Read-only installation check; corrupt only the sandbox component cache, never user settings.
(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    if (!document.querySelector('agentdeck-settings-tab')) {
        document.querySelector('button[title="설정"]').click()
        await wait(500)
        ;[...document.querySelectorAll('a,button')].find(x => x.textContent.trim() === 'AgentDeck').click()
        await wait(500)
    }
    const el = document.querySelector('agentdeck-settings-tab')
    const checks = []
    const rows = [...el.querySelectorAll('.form-line')].filter(x => /Claude integration|Codex integration|Claude 연동|Codex 연동/.test(x.innerText))
    const installed = () => /Connected|연동됨/.test(rows[0]?.innerText || '')
    checks.push({ name: 'installed Claude detected', pass: installed() })
    const fs = require('fs'), path = require('path')
    const settings = path.join(require('os').homedir(), '.claude', 'settings.json')
    const read = fs.readFileSync
    try {
        fs.readFileSync = function (file, ...args) {
            return String(file) === settings ? '{}' : read.call(this, file, ...args)
        }
        await wait(2600)
        checks.push({ name: 'external removal detected', pass: !installed() })
    } finally { fs.readFileSync = read }
    await wait(2600)
    checks.push({ name: 'installation restored without reopening', pass: installed() })
    checks.push({ name: 'both integration rows', pass: rows.length === 2 })
    for (const row of rows) {
        const button = row.querySelector('button')
        const style = getComputedStyle(button)
        checks.push({ name: 'button stays one line', pass: style.flexShrink === '0' && style.whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth + 1 })
    }
    return JSON.stringify({ pass: checks.every(x => x.pass), checks })
})()
