(async () => {
    const fs = require('fs'), path = require('path')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('usage-refresh-ui')) throw Error('Dedicated isolated app required')
    const base = path.dirname(process.env.TABBY_CONFIG_DIRECTORY)
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const notify = window.__agentdeck.app.tabsService.injector.get(params[6]).deck.notify
    const files = ['claude-home/settings.json', 'codex-home/hooks.json'].map(f => path.join(base, f))
    const originals = files.map((f, i) => ({hooks: {PostToolUse: [{hooks: [
        {type: 'command', command: 'echo keep-user-hook'},
        {type: 'command', command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:/old/tabby-agentdeck/hooks/agentdeck-${i ? 'codex-' : ''}notify.ps1"`, timeout: 3},
    ]}]}}))
    for (let i = 0; i < files.length; i++) {
        fs.mkdirSync(path.dirname(files[i]), {recursive: true})
        fs.writeFileSync(files[i], JSON.stringify(originals[i]))
    }
    const platform = notify.platform, original = platform.showMessageBox
    let prompts = 0
    platform.showMessageBox = async () => { prompts++; return {response: 1} }
    try {
        if (!await notify.promptHookUpgrade() || prompts !== 1) throw Error('Missing decline prompt')
        if (files.some((f,i) => fs.readFileSync(f,'utf8') !== JSON.stringify(originals[i]))) throw Error('Decline wrote settings')
    } finally { platform.showMessageBox = original }
    window.__hookUpgradeResult = null
    window.__hookUpgradePending = notify.promptHookUpgrade().then(async shown => {
        if (!shown) throw Error('Missing native upgrade prompt')
        for (const f of files) {
            const hooks = JSON.parse(fs.readFileSync(f)).hooks.PostToolUse[0].hooks
            if (hooks[0].command !== 'echo keep-user-hook' || !hooks[1].command.startsWith('node "')) throw Error('Incorrect replacement')
            if (!fs.existsSync(f + '.agentdeck-hook-upgrade-backup')) throw Error('Missing backup')
        }
        if (await notify.promptHookUpgrade()) throw Error('Prompt repeated after upgrade')
        const result = {pass: true, declinedWithoutWrite: true, nativeAccepted: true, files: files.length, backup: true, noRepeat: true}
        window.__hookUpgradeResult = result
        fs.writeFileSync(path.join(base, 'hook-upgrade-results.json'), JSON.stringify(result, null, 2))
    }).catch(error => { window.__hookUpgradeResult = {pass: false, error: String(error)} })
    return {pendingNativeDialog: true}
})()
