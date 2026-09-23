(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test-storage-autosave')) throw new Error('Dedicated test app required')
    const cp = require('child_process'), originalExec = cp.execFile
    const key = 'Software\\AgentDeckStorageEnvironmentTest'
    let rejectRegistry = false
    cp.execFile = function (file, args, options, callback) {
        if (args?.includes('-EncodedCommand') && options?.env?.AGENTDECK_STORAGE_ENV_PAYLOAD) {
            if (rejectRegistry) { queueMicrotask(() => callback(new Error('Synthetic registry denial'), '')); return }
            args = [...args]
            const i = args.indexOf('-EncodedCommand') + 1
            let source = Buffer.from(args[i], 'base64').toString('utf16le')
            source = source.replace("CreateSubKey('Environment')", `CreateSubKey('${key}')`)
            args[i] = Buffer.from(source, 'utf16le').toString('base64')
        }
        return originalExec.call(this, file, args, options, callback)
    }
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const settle = async () => {
        await wait(50)
        for (let i = 0; i < 300 && document.querySelector('.ad-storage-save')?.disabled; i++) await wait(100)
        if (document.querySelector('.ad-storage-save')?.disabled) throw new Error('Save timed out')
    }
    const query = name => new Promise((resolve, reject) => originalExec('reg.exe', ['query', 'HKCU\\'+key, '/v', name], { windowsHide: true }, (e,s) => e ? reject(e) : resolve(s)))
    const config = window.__agentdeck.config, originalSave = config.save.bind(config)
    const checks = []
    const check = (label, value) => { if (!value) throw new Error(label); checks.push(label) }
    const root = 'D:\\Project\\tabby-agentdeck\\.tmp\\storage-autosave-ui'
    const edit = async (name, value) => {
        const input = document.querySelector(`[data-storage-key="${name}"]`)
        input.value = value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); await settle()
    }
    try {
        await edit('claudeStorageDir', root+'\\claude')
        await edit('codexStorageDir', root+'\\codex')
        check('Both Windows values persisted by UI save', (await query('CLAUDE_CONFIG_DIR')).includes(root+'\\claude') && (await query('CODEX_HOME')).includes(root+'\\codex'))
        check('New child environment updated', process.env.CODEX_HOME===root+'\\codex' && process.env.CLAUDE_CONFIG_DIR===root+'\\claude')
        config.save = async () => { throw new Error('Synthetic ENOSPC') }
        await edit('codexStorageDir', root+'\\rejected')
        check('Disk failure restores registry', (await query('CODEX_HOME')).includes(root+'\\codex'))
        check('Disk failure restores process environment', process.env.CODEX_HOME===root+'\\codex')
        config.save = originalSave
        rejectRegistry = true
        await edit('codexStorageDir', root+'\\denied')
        check('Registry failure keeps previous settings', config.store.agentDeck.codexStorageDir===root+'\\codex')
        check('Registry failure visible', !!document.querySelector('.ad-storage-message.text-danger'))
        rejectRegistry = false
        await edit('codexStorageDir', root+'\\codex')
        ;[...document.querySelectorAll('.ad-storage-settings button')].find(b => b.textContent.includes('기본값')).click(); await settle()
        let absent = false
        try { await query('CODEX_HOME') } catch { absent = true }
        check('Reset removes user environment override', absent)
        await edit('claudeStorageDir', root+'\\claude')
        await edit('codexStorageDir', root+'\\codex')
        return { checks, count: checks.length, testRegistryKey: key }
    } finally {
        config.save = originalSave; cp.execFile = originalExec
        originalExec('reg.exe', ['delete', 'HKCU\\'+key, '/f'], { windowsHide: true }, () => {})
    }
})()
