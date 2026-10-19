(async () => {
    const fs = require('fs'), path = require('path')
    const ad = window.__agentdeck
    const cfg = process.env.TABBY_CONFIG_DIRECTORY || ''
    if (!cfg.includes('memory-cleanup') || !cfg.includes('.tmp')) throw Error('Isolated memory test app required')
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const notify = ad.app.tabsService.injector.get(params[2])
    const deck = ad.app.tabsService.injector.get(params[0])
    const results = []
    const check = (name, ok, detail) => {
        results.push({ name, pass: !!ok, detail })
        if (!ok) throw Error(name + ': ' + JSON.stringify(detail))
    }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const paneOf = tab => (tab.getAllTabs?.() || [tab])[0]
    if (!ad.app.tabs.some(tab => paneOf(tab)?.session?.open)) {
        document.querySelector('.ad-new').click()
        for (let i = 0; i < 100 && !ad.app.tabs.some(tab => paneOf(tab)?.session?.open); i++) await wait(100)
    }
    const tab = ad.app.tabs.find(tab => paneOf(tab)?.session?.open)
    if (!tab) throw Error('Test shell did not start')
    const pane = (tab.getAllTabs?.() || [tab])[0]
    const tabId = pane.profile.options.env.AGENTDECK_TAB
    check('live shell', pane.session.open && !!tabId)
    const sid = 'memory-probe-' + Date.now(), now = Date.now(), day = 86400000
    fs.mkdirSync(notify.dir, { recursive: true })
    const reportPath = path.join(notify.dir, sid + '.json')
    const report = { sessionId: sid, tabId, agent: 'claude', ts: now, status: 'running',
        agents: [{ id: 'memory-worker', type: 'worker', at: now }] }
    fs.writeFileSync(reportPath, JSON.stringify(report))
    await wait(2500)
    check('file hook routes to real tab', notify.tabSession.get(tab) === sid)
    check('hook badge renders', document.querySelector('.ad-subagents')?.textContent?.includes('1'),
        document.querySelector('.ad-subagents')?.textContent)
    for (let i = 0; i < 20000; i++) notify.applied.set('expired-' + i, now - 2 * day)
    const closed = { title: 'synthetic closed root' }
    notify.sessionTab.set('closed-memory', closed); notify.tabSession.set(closed, 'closed-memory')
    notify.tabIds.set(closed, ['closed-memory']); notify.tabPids.set(closed, [1])
    await wait(2500)
    check('periodic cleanup releases history', ![...notify.applied.keys()].some(id => id.startsWith('expired-')), notify.applied.size)
    check('periodic cleanup releases closed root', !notify.tabSession.has(closed) && !notify.sessionTab.has('closed-memory'))
    check('live tab and badge survive cleanup', pane.session.open && notify.subagentsOf(tab)?.running === 1)
    // The file polling path must ignore the expired record, not rebind the pane.
    fs.writeFileSync(path.join(notify.dir, 'expired-probe.json'), JSON.stringify({
        sessionId: 'expired-probe', tabId, ts: now - 2 * day, status: 'done',
    }))
    await wait(1000)
    check('expired status cannot steal pane', notify.tabSession.get(tab) === sid)
    const scan = notify.scans.get(sid)
    check('live scan exists', !!scan)
    scan.state.calls.set('toolu_old', { id: 'toolu_old', description: 'completed history', subagentType: null, startedAt: null })
    scan.state.done.add('toolu_old')
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, ts: now + 1 }))
    await wait(1000)
    check('hook releases accumulated fallback', scan.state.calls.size === 0 && scan.state.done.size === 0)
    const transcript = path.join(path.dirname(cfg), 'memory-transcript.jsonl')
    let text = ''
    for (let i = 0; i < 5000; i++) text += JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Agent', id: 'toolu_mem_' + i, input: { description: 'worker' } },
    ] } }) + '\n'
    text += JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'CronCreate', id: 'timer-memory', input: { prompt: 'memory regression timer' } },
    ] } }) + '\n'
    text += JSON.stringify({ type: 'user', toolUseResult: { id: 'job-memory' }, message: { content: [
        { type: 'tool_result', tool_use_id: 'timer-memory', content: '' },
    ] } }) + '\n'
    fs.writeFileSync(transcript, text)
    scan.path = transcript
    await wait(3000)
    check('transcript read by actual scanner', scan.lastSize === Buffer.byteLength(text), { offset: scan.lastSize, size: Buffer.byteLength(text) })
    check('unused history stays empty', scan.state.calls.size === 0 && scan.state.done.size === 0)
    check('timer close protection still works', notify.scheduledTasksOf(tab).count === 1)
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, ts: now + 2, agents: [] }))
    await wait(1500)
    check('stop hook removes badge', !notify.subagentsOf(tab) && !document.querySelector('.ad-subagents'))
    check('shell survived all updates', pane.session.open)
    if (notify.agentLifecycles) {
        const activity = { id: 'expired-lifecycle-worker', type: 'worker', action: 'active', ts: Date.now() - 900001 }
        notify.apply({ sessionId: sid, tabId, ts: Date.now(), agentActivity: activity })
        const lifecycle = notify.agentLifecycles.get(sid)
        check('expired durable hook retains source ownership', !!lifecycle)
        check('expired durable hook does not retain history', lifecycle.events.size === 0)
        notify.apply({ sessionId: sid, tabId, ts: Date.now(), agentActivity: activity })
        check('expired lifecycle replay stays empty', lifecycle.events.size === 0 && !notify.subagentsOf(tab))
        for (let i = 0; i < 2000; i++) lifecycle.events.set('ended-' + i, { ...activity, id: 'ended-' + i, action: 'stop' })
        lifecycle.active()
        check('expired lifecycle tombstones released in renderer', lifecycle.events.size === 0)
    }
    deck.render()
    return { pass: results.length, results }
})()
