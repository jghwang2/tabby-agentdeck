// Codex hook -> receiver -> shared usage refresh -> sidebar DOM, in the isolated app only.
//   tools/test-instance.ps1 -PluginRoot <stage> -TestRoot <...codex-usage-hook-ui> -Port <port>
//   node tools/cdp.js <port> tools/probe-codex-usage-hook.js
// The usage API is a fixture; the relay, receiver, rollout scan and DOM are the real ones.
(async () => {
    const fs = require('fs'), path = require('path'), cp = require('child_process'), https = require('https')
    const { EventEmitter } = require('events')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('codex-usage-hook-ui')) throw Error('Isolated app required')
    const base = path.dirname(process.env.TABBY_CONFIG_DIRECTORY), ad = window.__agentdeck
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const deck = ad.app.tabsService.injector.get(params[6]).deck
    // The package this instance actually loaded, whatever the staging folder is called.
    const hooks = path.join(base, 'ud/plugins/node_modules/tabby-agentdeck/hooks')
    const home = path.join(base, 'codex-fixture-' + Date.now()), account = 'codex-hook@example.test'
    const results = [], sleep = ms => new Promise(r => setTimeout(r, ms))
    const check = (name, pass) => {
        results.push({ name, pass: !!pass })
        fs.writeFileSync(path.join(base, 'codex-hook-results.json'), JSON.stringify(results, null, 2))
        if (!pass) throw Error(name + ' | ' + text())
    }
    const until = async (fn, what) => { for (let i = 0; i < 150; i++) { if (fn()) return; await sleep(100) } throw Error('Timed out: ' + what + ' | ' + text()) }
    const text = () => document.querySelector('.ad-now')?.textContent || ''
    const shows = pct => new RegExp('(^|\\D)' + pct + '%').test(text())

    const sid = '01a1f000-0000-7000-8000-' + Date.now().toString(16).padStart(12, '0')
    const child = '01a1f000-0000-7000-9000-' + Date.now().toString(16).padStart(12, '0')
    const rollout = path.join(home, 'sessions/2026/11/23', `rollout-2026-11-23T00-00-00-${sid}.jsonl`)
    const row = (timestamp, type, payload) => JSON.stringify({ timestamp: new Date(timestamp).toISOString(), type, payload }) + '\n'
    const tokens = (timestamp, weekly) => row(timestamp, 'event_msg', { type: 'token_count',
        rate_limits: { limit_id: 'codex', primary: { used_percent: weekly, window_minutes: 10080, resets_at: Math.round(Date.now() / 1000) + 86400 }, secondary: null },
        info: { model_context_window: 1000, last_token_usage: { total_tokens: 420 } } })
    fs.mkdirSync(path.dirname(rollout), { recursive: true })
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: 'fixture', account_id: 'fixture',
        id_token: 'fixture.' + Buffer.from(JSON.stringify({ email: account })).toString('base64url') + '.fixture' } }))
    // The main thread last spoke an hour ago at 9%: the frozen value this change is about.
    const hourAgo = Date.now() - 3600000
    fs.writeFileSync(rollout, row(hourAgo, 'session_meta', { session_id: sid, id: sid, cwd: base, cli_version: '0.171.0' })
        + row(hourAgo, 'turn_context', { model: 'gpt-fixture', effort: 'low', cwd: base }) + tokens(hourAgo, 9))

    const previousTab = ad.app.activeTab
    document.querySelector('.ad-new').click()
    await until(() => ad.app.activeTab !== previousTab && ad.app.activeTab?.getAllTabs?.().some(p => p.session), 'new terminal')
    const tab = ad.app.activeTab, pane = tab.getAllTabs?.()[0] || tab, pty = pane.session
    await until(() => deck.notify.tabIds.get(tab)?.length, 'tab id')
    const tabId = deck.notify.tabIds.get(tab)[0]
    // A bare shell prompt drops the tab's agent (`observePaneAgent`), so the tab must really be
    // running something called codex. Same stand-in as probe-parent-account: no model, no login.
    const bin = path.join(base, 'fixture-bin'), exe = path.join(bin, 'codex.exe'), started = path.join(bin, 'started-' + Date.now())
    const driver = path.join(bin, 'driver.cjs')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(driver, "process.stdout.write('\\x1b]0;cmd.exe - codex\\x07codex fixture\\r\\n')\n"
        + "require('fs').writeFileSync(process.argv[2], 'started')\nsetTimeout(() => {}, 900000)\n")
    if (!fs.existsSync(exe)) {
        const source = 'using System; using System.Diagnostics;\nclass Entry { static void Main(string[] args) { '
            + 'var p = new ProcessStartInfo("node", "\\"' + driver.replace(/\\/g, '\\\\') + '\\" \\"" + args[0] + "\\""); '
            + 'p.UseShellExecute = false; var c = Process.Start(p); c.WaitForExit(); } }'
        const compile = path.join(bin, 'compile.ps1')
        fs.writeFileSync(compile, "Add-Type -TypeDefinition @'\n" + source + "\n'@ -OutputAssembly '" + exe.replace(/'/g, "''") + "' -OutputType ConsoleApplication\n")
        cp.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile], { windowsHide: true })
    }
    pane.sendInput("& '" + exe.replace(/'/g, "''") + "' '" + started.replace(/'/g, "''") + "'\r")
    await until(() => fs.existsSync(started), 'stand-in codex process')
    await until(() => deck.notify.parentAgentOf(tab) === 'codex', 'tab identified as Codex')
    const env = { ...process.env, CODEX_HOME: home, AGENTDECK_TAB: tabId,
        AGENTDECK_RUNTIME_ROOT: path.dirname(ad.runtimePaths().status) }
    const hook = (session, event) => new Promise((resolve, reject) => {
        const proc = cp.spawn('python', [path.join(hooks, 'agentdeck-codex-notify.py')], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        let err = ''; proc.stderr.on('data', x => err += x); proc.stdout.resume()
        proc.on('error', reject); proc.on('close', code => code ? reject(Error(err)) : resolve())
        proc.stdin.end(JSON.stringify({ session_id: session, hook_event_name: event, cwd: base }))
    })

    const original = https.get
    let requests = 0, pending = 0, weekly = 37, status = 200, release = null
    https.get = (url, options, callback) => {
        if (!String(url).includes('chatgpt.com/backend-api/wham/usage')) return original(url, options, callback)
        requests++; pending++
        const req = new EventEmitter(); req.destroy = () => req.emit('error', Error('fixture'))
        const answer = () => {
            const res = new EventEmitter(); res.statusCode = status; res.headers = { 'retry-after': '120' }; callback(res)
            res.emit('data', JSON.stringify({ account_id: 'fixture', rate_limit: { secondary_window: null,
                primary_window: { used_percent: weekly, limit_window_seconds: 604800, reset_at: Math.round(Date.now() / 1000) + 86400 } } }))
            res.emit('end'); req.emit('close'); pending--
        }
        if (release === null) setTimeout(answer, 150); else release.push(answer)
        return req
    }
    const state = () => deck.usageRefresh.state(deck.notify.metaOf(tab))
    const expire = () => { const s = state(); s.ts = Date.now() - 60001; s.retryAt = 0 }
    try {
        release = []
        await hook(sid, 'UserPromptSubmit')
        await until(() => deck.notify.tabSession.get(tab) === sid && deck.notify.metaOf(tab)?.agent === 'codex', 'Codex session bound')
        await until(() => shows(9) && shows(42), 'rollout values')
        check('rollout alone shows the frozen main-thread value', text().includes('gpt-fixture') && !shows(37))
        await until(() => requests === 1, 'usage request')
        check('Codex hook returns while the usage API is pending', pending === 1 && release.length === 1)
        release.shift()(); release = null
        await until(() => shows(37), 'hook result')
        check('Codex hook alone updates usage in the sidebar', requests === 1 && !shows(9) && shows(42))
        check('hook used the account and home the sidebar reads', deck.notify.metaOf(tab).account === account
            && deck.notify.metaOf(tab).configDir === home && state()?.values?.length > 0)

        await hook(sid, 'PostToolUse'); await sleep(400)
        check('Codex hook burst reuses the shared result', requests === 1)

        // A subagent thread spends the same quota while the main rollout stays silent.
        weekly = 100; expire()
        await hook(child, 'PostToolUse')
        await until(() => shows(100), 'subagent result')
        check('subagent-thread hook refreshes the account usage', requests === 2)
        check('subagent-thread hook does not take over the tab', deck.notify.tabSession.get(tab) === sid)

        // Reading old limits now does not make them new.
        fs.appendFileSync(rollout, row(Date.now(), 'turn_context', { model: 'gpt-fixture-2', effort: 'high', cwd: base }))
        await until(() => text().includes('gpt-fixture-2'), 'model change from rollout')
        check('rollout change keeps the newer API value', shows(100) && !shows(9))

        // `expire` rewinds the API result by a minute; do this while the rollout limits are an hour old.
        expire(); status = 429
        await hook(sid, 'PostToolUse'); await until(() => requests === 3 && !state().busy, 'failed request')
        check('failed hook refresh preserves the previous value', shows(100) && state().retryAt > Date.now() + 60000)
        await hook(sid, 'Stop'); await sleep(400)
        check('retry-after suppresses further hook requests', requests === 3)
        status = 200; state().ts = Date.now(); state().retryAt = 0

        fs.appendFileSync(rollout, tokens(Date.now() + 1000, 12))
        await until(() => shows(12), 'newer rollout limits')
        check('limits recorded after the API result win', !shows(100))

        weekly = 55; state().retryAt = 0; deck.renderNow(); document.querySelector('.ad-now-refresh').click()
        await until(() => shows(55), 'button result')
        check('button shares the hook refresh state and API', requests === 4)
        check('terminal session preserved', pane.session === pty && ad.app.activeTab === tab)
        return { pass: true, results }
    } finally { https.get = original }
})()
