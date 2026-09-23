// CDP expression; run only in the isolated tabby-agentdeck-test instance.
(async () => {
    const fs = require('fs'), path = require('path')
    const deck = window.__agentdeck
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) throw new Error('Isolated app required')
    const root = 'D:/Project/tabby-agentdeck/.tmp/storage-fixtures'
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const result = []
    const check = (name, value) => { result.push({ name, pass: !!value }); if (!value) throw new Error(name) }
    const keys = ['accountStorageDir', 'claudeStorageDir', 'codexStorageDir']
    let before = keys.map(k => deck.config.store.agentDeck[k] || '')
    const unchanged = () => keys.every((k, i) => (deck.config.store.agentDeck[k] || '') === before[i])
    const save = async () => {
        await wait(100)
        document.querySelector('.ad-storage-save').click()
        for (let i = 0; i < 50; i++) {
            await wait(100)
            if (!document.querySelector('.ad-storage-save').disabled) return
        }
        throw new Error('Save did not settle')
    }
    const set = (key, value) => {
        const el = document.querySelector(`[data-storage-key="${key}"]`)
        el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('accountStorageDir', `${root}/discarded`)
    document.querySelector('.ad-storage-save + button').click(); await wait(100)
    check('Default button clears the draft', [...document.querySelectorAll('[data-storage-key]')].every(e => e.value === ''))
    for (let i = 0; i < 50 && document.querySelector('.ad-storage-save').disabled; i++) await wait(100)
    check('Default button saves immediately', keys.every(k => !deck.config.store.agentDeck[k]))
    before = keys.map(k => deck.config.store.agentDeck[k] || '')
    set('accountStorageDir', 'relative/path')
    await save()
    check('Relative path rejected without saving', unchanged() && document.querySelector('.ad-storage-message.text-danger'))
    const paths = { accountStorageDir: `${root}/accounts`, claudeStorageDir: `${root}/claude`, codexStorageDir: `${root}/codex` }
    for (const [key, value] of Object.entries(paths)) { fs.mkdirSync(value, { recursive: true }); set(key, value) }
    set('codexStorageDir', paths.claudeStorageDir)
    await save()
    check('Overlapping paths rejected', unchanged() && document.querySelector('.ad-storage-message.text-danger'))
    set('codexStorageDir', paths.codexStorageDir)
    await save()
    check('All three paths saved through UI', Object.entries(paths).every(([key, value]) => path.resolve(deck.config.store.agentDeck[key]) === path.resolve(value)))
    check('Restart notice displayed', document.querySelector('.ad-storage-message').textContent.includes('다시 시작'))
    const config = fs.readFileSync(path.join(process.env.TABBY_CONFIG_DIRECTORY, 'config.yaml'), 'utf8')
    check('Persisted to disk', ['accountStorageDir:', 'claudeStorageDir:', 'codexStorageDir:'].every(key => config.includes(key)))
    fs.mkdirSync(path.join(root, 'work'), { recursive: true })
    const line = [...document.querySelectorAll('.form-line')].find(e => e.querySelector('.title')?.textContent.includes('루트 프로필 사용'))
    const toggle = line?.querySelector('input[type=checkbox]')
    if (!toggle.checked) toggle.click()
    await wait(100)
    const working = document.querySelector('input[placeholder="D:/Project"]')
    working.value = `${root}/work`; working.dispatchEvent(new Event('input', { bubbles: true })); working.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(200)
    check('Working folder reaches profile immediately', deck.config.store.profiles.some(p => p.id === 'agentdeck:root' && p.options.cwd === `${root}/work`))
    return { result }
})()
