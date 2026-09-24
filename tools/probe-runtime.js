(async () => {
    const ad = window.__agentdeck
    const fs = require('fs'), path = require('path'), cp = require('child_process')
    const roots = ad.runtimePaths()
    const configured = ad.config.store.agentDeck.accountStorageDir
    if (!path.resolve(roots.root).startsWith(path.resolve(configured) + path.sep)) throw new Error('Runtime escaped account folder')
    const loaded = fs.realpathSync(path.join(path.dirname(process.env.TABBY_CONFIG_DIRECTORY), 'ud/plugins/node_modules/tabby-agentdeck'))
    const panes = ad.tabIds().flatMap(x => x.ids)
    if (!panes.length) throw new Error('No test terminal pane')
    const sid = 'runtime-probe-' + Date.now()
    const env = { ...process.env, AGENTDECK_RUNTIME_ROOT: roots.root, AGENTDECK_MAILBOX_ROOT: roots.mailbox, AGENTDECK_TAB: panes[0] }
    const hook = path.join(loaded, 'hooks/agentdeck-notify.ps1')
    const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hook, '-HookJson', JSON.stringify({session_id:sid,hook_event_name:'UserPromptSubmit',cwd:configured})], {env,encoding:'utf8',windowsHide:true,timeout:15000})
    if (result.status !== 0) throw new Error(result.stderr)
    await new Promise(r => setTimeout(r, 6500))
    const stored = JSON.parse(fs.readFileSync(path.join(roots.status, sid + '.json'), 'utf8'))
    const bound = ad.hookInfo().some(x => x.sessionId === sid)
    const ledger = JSON.parse(fs.readFileSync(path.join(roots.root, 'sessions.json'), 'utf8'))
    const connections = fs.readdirSync(path.join(roots.mailbox, 'mailbox-connections'))
    // Disk and DOM evidence, without sending any message to another session.
    const badges = [...document.querySelectorAll('.ad-badge')].map(x=>x.textContent)
    return JSON.stringify({pass:stored.sessionId===sid && bound && connections.length>0 && ledger.records.some(x=>x.sessionId===sid), roots, bound, mailboxConnections:connections.length, ledgerRows:ledger.records.length, badges})
})()
