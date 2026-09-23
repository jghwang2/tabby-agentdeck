// Run in the isolated AgentDeck settings tab via tools/cdp.js.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test-storage-autosave')) throw new Error('Dedicated storage test app required')
    const ad = window.__agentdeck, fs = require('fs'), path = require('path')
    const root = 'D:/Project/tabby-agentdeck/.tmp/storage-autosave-ui'
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const results = []
    const check = (name, pass) => { results.push({ name, pass: !!pass }); if (!pass) throw new Error(name) }
    const edit = async (key, value, change = true) => {
        const input = document.querySelector(`[data-storage-key="${key}"]`)
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }))
        if (change) input.dispatchEvent(new Event('change', { bubbles: true }))
        await wait(250)
    }
    const leave = async () => {
        [...document.querySelectorAll('a.nav-link')].find(e => e.textContent.trim() === '응용 프로그램')?.click()
        await wait(300)
        check('Settings component is destroyed on navigation', !document.querySelector('agentdeck-settings-tab'))
    }
    const reopen = async () => {
        [...document.querySelectorAll('a.nav-link')].find(e => e.textContent.trim() === 'AgentDeck')?.click()
        await wait(300)
    }
    const configFile = path.join(process.env.TABBY_CONFIG_DIRECTORY, 'config.yaml')
    const expected = `${root}/accounts`
    await edit('accountStorageDir', expected)
    check('Text change saves without a save-button click', path.resolve(ad.config.store.agentDeck.accountStorageDir) === path.resolve(expected))
    check('Text change is persisted to disk', fs.readFileSync(configFile, 'utf8').includes('accountStorageDir:'))
    await leave(); await reopen()
    check('Reopening keeps the saved path', path.resolve(document.querySelector('[data-storage-key="accountStorageDir"]').value) === path.resolve(expected))

    const leaving = `${root}/claude`
    await edit('claudeStorageDir', leaving, false)
    await leave(); await reopen()
    check('Leaving before blur still saves', path.resolve(ad.config.store.agentDeck.claudeStorageDir) === path.resolve(leaving))

    const originalSave = ad.config.save.bind(ad.config)
    const failedPath = `${root}/codex`
    try {
        ad.config.save = async () => { throw new Error('Synthetic ENOSPC') }
        await edit('codexStorageDir', failedPath)
        check('Write failure is displayed', !!document.querySelector('.ad-storage-message.text-danger'))
        await leave(); await reopen()
        check('Failed draft survives navigation', document.querySelector('[data-storage-key="codexStorageDir"]').value === failedPath)
        check('Failure message survives navigation', !!document.querySelector('.ad-storage-message.text-danger'))
    } finally { ad.config.save = originalSave }
    document.querySelector('.ad-storage-save').click(); await wait(300)
    check('Retry saves the retained input', path.resolve(ad.config.store.agentDeck.codexStorageDir) === path.resolve(failedPath))
    await edit('codexStorageDir', 'relative/path')
    await leave(); await reopen()
    check('Invalid draft stays visible', document.querySelector('[data-storage-key="codexStorageDir"]').value === 'relative/path')
    await edit('codexStorageDir', failedPath)
    check('Default paths are explicitly labelled', document.querySelector('[data-storage-key="codexStorageDir"]').placeholder.startsWith('기본값:'))
    document.querySelector('.ad-storage-settings').scrollIntoView({ block: 'center' })
    return { results, debugComponentAvailable: !!window.ng?.getComponent }
})()
