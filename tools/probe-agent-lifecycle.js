// Actual hook processes -> durable records/TCP -> service -> rendered badges. Isolated app only.
(async () => {
    const ad = window.__agentdeck, fs = require('fs'), path = require('path'), cp = require('child_process')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) throw Error('Isolated instance required')
    const checks = [], sleep = ms => new Promise(r => setTimeout(r, ms))
    const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); if (!pass) throw Error(name + ': ' + JSON.stringify(detail)) }
    const wait = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(100) } throw Error('Timed out: ' + fn) }
    const open = async () => {
        const before = new Set(ad.app.tabs); document.querySelector('.ad-new').click()
        await wait(() => ad.app.tabs.some(t => !before.has(t) && (t.getAllTabs?.() || [t]).some(p => p.session?.open)))
        return ad.app.tabs.find(t => !before.has(t))
    }
    const first = await open(), second = await open(), panes = t => t.getAllTabs?.() || [t]
    const queue = [panes(first)[0].injector], seen = new Set(); let deck
    while (queue.length && seen.size < 100) {
        const i = queue.shift(); if (!i || seen.has(i)) continue; seen.add(i)
        if (i.records) for (const r of i.records.values()) if (r?.value?.resumeStarting instanceof Map) deck = r.value
        queue.push(i.parent, i.parentInjector, i.injector, i._lView?.[9])
    }
    if (!deck) throw Error('Deck unavailable')
    const notify = deck.notify, root = ad.runtimePaths().root
    const script = path.resolve(process.env.TABBY_CONFIG_DIRECTORY, '../ud/plugins/node_modules/tabby-agentdeck/hooks/agentdeck-notify.ps1')
    if (!fs.existsSync(script)) throw Error('Staged hook script missing')
    const sid = 'agentdeck-probe-lifecycle-' + Date.now(), other = sid + '-other'
    const tabId = t => panes(t)[0].profile.options.env.AGENTDECK_TAB
    const hook = (t, parent, id, event = 'PostToolUse') => new Promise((resolve, reject) => {
        const p = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
            ...(event === 'SubagentStop' ? ['-Subagent', 'stop'] : event === 'SubagentStart' ? ['-Subagent', 'start'] : ['-Status', 'running'])], {
            windowsHide: true, env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_TAB: tabId(t) },
        })
        let stderr = ''; p.stderr.on('data', b => stderr += b); p.stdout.resume()
        p.on('error', reject); p.on('close', code => code ? reject(Error(stderr)) : resolve())
        p.stdin.end(JSON.stringify({ session_id: parent, hook_event_name: event, agent_id: id, agent_type: 'general-purpose' }))
    })
    const badge = t => { ad.render(); return document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(t)}"] .ad-subagents`)?.textContent || '' }
    const record = (parent, id) => path.join(root, 'agents', parent, id + '.json')
    try {
        // Bind independent parent sessions without altering their visible work status.
        notify.apply({ sessionId: sid, ts: Date.now(), tabId: tabId(first), status: 'done' })
        notify.apply({ sessionId: other, ts: Date.now(), tabId: tabId(second), status: 'done' })
        await Promise.all([hook(first, sid, 'one', 'SubagentStart'), hook(first, sid, 'two', 'SubagentStart')])
        await wait(() => badge(first) === '❖2')
        check('parallel hook starts render two agents', badge(first) === '❖2')
        await hook(first, sid, 'one', 'SubagentStop'); await wait(() => badge(first) === '❖1')
        await hook(first, sid, 'later'); await wait(() => badge(first) === '❖2')
        check('second generation discovered through activity hook', badge(first) === '❖2')
        await hook(first, sid, 'one'); await wait(() => badge(first) === '❖3')
        check('resumed agent rejoins once', badge(first) === '❖3')
        await hook(first, sid, 'one'); check('duplicate activity does not add another', badge(first) === '❖3')
        await hook(second, other, 'one'); await wait(() => badge(second) === '❖1')
        check('same agent id in different tabs stays separate', badge(first) === '❖3' && badge(second) === '❖1')
        // Simulate TCP loss: real hook persists a fourth agent and the slow recovery path reads it.
        const portFile = path.join(root, 'port'), port = fs.readFileSync(portFile)
        try { fs.writeFileSync(portFile, '0'); await hook(first, sid, 'disk-only') }
        finally { fs.writeFileSync(portFile, port) }
        notify.reconcileAgentFiles(); check('missed TCP recovered from disk', badge(first) === '❖4')
        // Losing volatile service state models renderer reload. The exact saved records restore it.
        notify.agentLifecycles.delete(sid); notify.reconcileAgentFiles()
        check('durable records recover service state', badge(first) === '❖4')
        const old = JSON.parse(fs.readFileSync(record(sid, 'one'), 'utf8'))
        await hook(first, sid, 'one', 'SubagentStop'); notify.apply(old)
        check('old active replay cannot resurrect a stopped agent', badge(first) === '❖3')
        const before = badge(first)
        fs.writeFileSync(path.join(root, 'agents', sid, 'corrupt.json'), '{')
        notify.reconcileAgentFiles(); check('bad record cannot erase known agents', badge(first) === before)
        check('child events preserve parent completion status', document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(first)}"]`)?.textContent.includes('완료'))
        check('periodic recovery is thirty seconds', ad.agentLifecycles().reconcileMs === 30000)
        // Expiration releases history permanently. Run this last: restoring the
        // test clock must not assume the discarded agents return to memory.
        const realNow = Date.now, ttl = ad.agentLifecycles().idleTimeoutMs
        const newest = Math.max(...[...notify.agentLifecycles.get(sid).events.values()].map(a => a.ts))
        try {
            Date.now = () => newest + ttl
            check('fifteen minutes without hooks removes badge', badge(first) === '')
            check('expired agent records leave memory', notify.agentLifecycles.get(sid).events.size === 0)
        } finally { Date.now = realNow }
    } finally {
        for (const t of [first, second]) { if (ad.app.tabs.includes(t)) await ad.app.closeTab(t, false) }
        for (const parent of [sid, other]) {
            const dir = path.resolve(root, 'agents', parent)
            if (path.dirname(dir) === path.resolve(root, 'agents') && parent.startsWith('agentdeck-probe-lifecycle-')) fs.rmSync(dir, { recursive: true, force: true })
        }
    }
    return JSON.stringify({ checks, pass: checks.filter(c => c.pass).length, fail: checks.filter(c => !c.pass).length })
})()
