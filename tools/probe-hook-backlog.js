// Real relay, durable replay, receiver, and rendered status. No live sessions.
(async () => {
    const fs = require('fs'), path = require('path'), cp = require('child_process')
    const ad = window.__agentdeck, results = []
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('hook-backlog-ui')) throw Error('Isolated app required')
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const until = async predicate => {
        const limit = Date.now() + 25000
        while (!predicate()) { if (Date.now() > limit) throw Error('Timed out: ' + predicate); await sleep(50) }
    }
    const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); if (!pass) throw Error(name) }
    const before = new Set(ad.app.tabs)
    document.querySelector('.ad-new').click()
    await until(() => ad.app.tabs.some(t => !before.has(t) && (t.getAllTabs?.() || [t]).some(p => p.session?.open)))
    const tab = ad.app.tabs.find(t => !before.has(t)), pane = (tab.getAllTabs?.() || [tab])[0]
    const tabId = pane.profile.options.env.AGENTDECK_TAB, pty = pane.session.getID()
    const root = path.dirname(ad.runtimePaths().status), sid = 'backlog-ui-' + Date.now()
    const stage = path.resolve(process.env.TABBY_CONFIG_DIRECTORY, '../ud/plugins/node_modules/tabby-agentdeck')
    const env = { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_TAB: tabId }
    const relay = (name, status, extra = {}) => new Promise((resolve, reject) => {
        const began = performance.now()
        const p = cp.spawn('node', [path.join(stage, 'hooks/agentdeck-notify.mjs'), '-Status', status], { env, windowsHide: true })
        p.stdout.resume(); let err = ''; p.stderr.on('data', b => err += b)
        p.on('error', reject); p.on('close', code => code ? reject(Error(err)) : resolve(performance.now() - began))
        p.stdin.end(JSON.stringify({ session_id: sid, hook_event_name: name, cwd: 'D:/한글/😀', ...extra }))
    })
    const stateFile = path.join(root, 'status', sid + '.json')
    const state = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch { return {} } }
    const inbox = path.join(root, 'hook-inbox'), receipts = path.join(root, 'hook-receipts')
    const receipt = e => path.join(receipts, e.id + '.json')
    const events = [], ts = Date.now()
    const enqueue = (name, status, extra = {}, kind = 'notify') => {
        const i = events.length
        const e = { channel: 'agentdeck-hook', id: sid + '-' + i, ts: Date.now() + i, kind,
            pid: process.pid, env: { AGENTDECK_TAB: tabId }, options: { Agent: 'claude', Status: status },
            hook: { session_id: sid, hook_event_name: name, cwd: 'D:/한글/😀', ...extra } }
        fs.mkdirSync(inbox, { recursive: true }); fs.writeFileSync(path.join(inbox, e.id + '.json'), JSON.stringify(e))
        events.push(e); return e
    }
    try {
        await relay('UserPromptSubmit', 'running')
        await until(() => state().status === 'running' && ad.hookInfo().some(h => h.sessionId === sid))
        check('actual relay binds running session', true)
        const fullHookMs = []
        for (let i = 0; i < 5; i++) fullHookMs.push(await relay('PostToolUse', 'running'))
        check('five actual hook invocations preserve running state', state().status === 'running', { fullHookMs })
        fs.writeFileSync(path.join(root, 'scoped-limit.json'), JSON.stringify({ ts: Date.now(), ok: true }))
        const started = performance.now()
        for (let i = 0; i < 60; i++) enqueue('PostToolUse', 'running')
        for (let i = 0; i < 8; i++) enqueue('PostToolUse', 'running', { agent_id: 'busy-child', agent_type: 'worker' })
        const meta = enqueue('', '', { model: { display_name: '한글 모델' }, context_window: { used_percentage: 37 } }, 'statusline')
        const stop = enqueue('Stop', 'done')
        await until(() => fs.existsSync(receipt(stop)) && state().status === 'done')
        const stopMs = performance.now() - started
        check('60 heartbeats do not delay parent completion', stopMs < 10000, { stopMs })
        check('native parent completion stays below two seconds including inbox polling', stopMs < 2000)
        ad.render()
        check('rendered parent badge is completed', document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(tab)}"]`).textContent.includes('완료'))
        await until(() => events.every(e => fs.existsSync(receipt(e))))
        check('all 70 durable events acknowledged', events.length === 70)
        const timing = events.slice(0, 60).map(e => JSON.parse(fs.readFileSync(receipt(e), 'utf8')).timing)
        check('heartbeat workers avoid process startup', Math.max(...timing.map(t => t.workerMs)) < 500, timing)
        check('metadata lane preserves model and context', JSON.parse(fs.readFileSync(path.join(root, 'meta', sid + '.json'), 'utf8')).contextPct === 37)
        check('child events leave parent completion intact', state().status === 'done')
        const child = JSON.parse(fs.readFileSync(path.join(root, 'agents', sid, 'busy-child.json'), 'utf8'))
        check('child activity retained', child.agentActivity.action === 'active')
        // A real edit after completion must take the full transition/file path.
        await sleep(150)
        await relay('PostToolUse', 'running', { tool_input: { file_path: 'D:/한글/😀/수정.ts' } })
        await until(() => state().file === 'D:/한글/😀/수정.ts' && state().status === 'running')
        check('real edit keeps UTF8 file and state transition', true)
        check('same terminal survives load', pane.session.open && pane.session.getID() === pty)
        return { results, counts: { pass: results.length, fail: 0 }, stopMs, fullHookMs, root }
    } catch (error) { return { results, error: error.stack, root } }
    finally { await ad.app.closeTab(tab, true) }
})()
