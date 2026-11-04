(async () => {
    const fs = require('fs'), path = require('path'), cp = require('child_process'), https = require('https')
    const { EventEmitter } = require('events')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('fable-hook-ui')) throw Error('Isolated app required')
    const base = path.dirname(process.env.TABBY_CONFIG_DIRECTORY), ad = window.__agentdeck
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const deck = ad.app.tabsService.injector.get(params[6]).deck
    const stage = path.resolve(base, '../fable-hook-stage'), home = path.join(base, 'fixture-' + Date.now())
    const results = [], sleep = ms => new Promise(r => setTimeout(r, ms))
    const check = (name, pass) => { results.push({ name, pass: !!pass }); fs.writeFileSync(path.join(base, 'hook-results.json'), JSON.stringify(results, null, 2)); if (!pass) throw Error(name) }
    const until = async fn => { for (let i=0;i<100;i++) { if (fn()) return; await sleep(100) }; throw Error('Timed out') }
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'hook@example.test' } }))
    fs.writeFileSync(path.join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fixture' } }))
    const previousTab = ad.app.activeTab
    document.querySelector('.ad-new').click()
    await until(() => ad.app.activeTab !== previousTab && ad.app.activeTab?.getAllTabs?.().some(p => p.session))
    const tab = ad.app.activeTab, pane = tab.getAllTabs?.()[0] || tab, pty = pane.session
    await until(() => deck.notify.tabIds.get(tab)?.length)
    const tabId = deck.notify.tabIds.get(tab)[0], sid = 'usage-hook-ui-' + Date.now()
    const env = { ...process.env, CLAUDE_CONFIG_DIR: home, AGENTDECK_TAB: tabId,
        AGENTDECK_RUNTIME_ROOT: path.dirname(ad.runtimePaths().status) }
    const run = (file, input, args = []) => new Promise((resolve, reject) => {
        const child = cp.spawn(file.endsWith('.mjs') ? 'node.exe' : file, file.endsWith('.mjs') ? [file,...args] : args,
            { env, windowsHide: true, stdio: ['pipe','pipe','pipe'] })
        let err = ''; child.stderr.on('data', x => err += x); child.stdout.resume()
        child.on('error', reject); child.on('close', code => code ? reject(Error(err)) : resolve())
        child.stdin.end(JSON.stringify(input))
    })
    const original = https.get
    let requests = 0, percent = 37, status = 200, pending = 0
    https.get = (url, options, callback) => {
        if (!String(url).includes('api.anthropic.com/api/oauth/usage')) return original(url, options, callback)
        requests++; pending++
        const req = new EventEmitter(); req.destroy = () => req.emit('error', Error('fixture'))
        setTimeout(() => {
            const res = new EventEmitter(); res.statusCode = status; res.headers = { 'retry-after': '120' }; callback(res)
            res.emit('data', JSON.stringify({ five_hour: { utilization: 18 }, seven_day: { utilization: 58 },
                limits: [{ kind: 'weekly_scoped', percent, scope: { model: { display_name: 'Fable' } } }] }))
            res.emit('end'); req.emit('close'); pending--
        }, 1500)
        return req
    }
    const hook = () => run(path.join(stage, 'hooks/agentdeck-statusline.mjs'), { session_id: sid,
        model: { display_name: 'Claude fixture' }, context_window: { used_percentage: 42 },
        rate_limits: { five_hour: { used_percentage: 18 }, seven_day: { used_percentage: 58 } } })
    const text = () => document.querySelector('.ad-now').textContent
    try {
        await run(path.join(stage, 'hooks/agentdeck-notify.exe'), { session_id: sid, hook_event_name: 'PreToolUse' }, ['-Status','running'])
        await hook()
        await until(() => requests > 0)
        check('hook returns while usage API is pending', pending === 1)
        await until(() => text().includes('37%'))
        check('hook alone updates Fable in DOM', requests === 1 && text().includes('42%'))
        await hook(); await sleep(250)
        check('hook burst reuses shared cache', requests === 1)
        const meta = deck.notify.metaOf(tab), state = deck.usageRefresh.state(meta)
        percent = 61; state.ts = Date.now()-60001; state.retryAt = 0
        await hook(); await until(() => text().includes('61%'))
        check('later hook updates changed Fable', requests === 2)
        percent = 72; state.retryAt = 0; deck.renderNow(); document.querySelector('.ad-now-refresh').click()
        await until(() => text().includes('72%'))
        check('button shares hook refresh state and API', requests === 3)
        state.ts = Date.now()-60001; state.retryAt = 0; status = 429
        await hook(); await until(() => !state.busy)
        check('failed hook preserves previous Fable', text().includes('72%') && state.retryAt > Date.now()+60000)
        await hook(); await sleep(250)
        check('retry-after suppresses hook API calls', requests === 4)
        check('terminal session preserved', pane.session === pty)
        return { pass: true, results }
    } finally { https.get = original }
})()
