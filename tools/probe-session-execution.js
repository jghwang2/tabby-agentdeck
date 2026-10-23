(async () => {
    const fs = require('fs'), path = require('path')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('session-identity-ui')) throw new Error('Isolated instance only')
    const ad = window.__agentdeck, base = path.dirname(process.env.TABBY_CONFIG_DIRECTORY)
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const until = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await wait(100) }; throw new Error('Timed out') }
    const checks = []
    const check = (name, pass, evidence) => { checks.push({ name, pass: !!pass, evidence }); if (!pass) throw new Error(name) }
    const bin = path.join(base, 'fixture-bin')
    fs.mkdirSync(bin, { recursive: true })
    const fixtureProfile = ad.config.store.profiles.find(p => p.id === 'local:test-ps')
    fixtureProfile.options.env = { ...fixtureProfile.options.env, PATH: bin + ';' + process.env.PATH }
    const ids = { claude: 'aaaaaaaa-1111-1111-1111-111111111111', codex: 'bbbbbbbb-2222-2222-2222-222222222222' }
    for (const agent of ['claude', 'codex']) {
        const receipt = path.join(base, agent + '-invoked.txt')
        if (fs.existsSync(receipt)) fs.unlinkSync(receipt)
        fs.writeFileSync(path.join(bin, agent + '.cmd'), '@echo off\r\necho %* > "' + path.join(base, agent + '-invoked.txt') + '"\r\npowershell -NoProfile -Command "[Console]::Write([char]27 + \']0;cmd.exe - ' + agent + '\' + [char]7); Start-Sleep -Seconds 120"\r\n')
        const dir = agent === 'claude' ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'fixture') : path.join(process.env.CODEX_HOME, 'sessions')
        fs.mkdirSync(dir, { recursive: true })
        for (let i = 0; i < 110; i++) {
            const sid = i === 0 ? ids[agent] : (agent === 'claude' ? 'aaaaaaaa' : 'bbbbbbbb') + '-0000-0000-0000-' + String(i).padStart(12, '0')
            const records = agent === 'claude'
                ? [{ type: 'user', cwd: base, message: { role: 'user', content: agent + '-fixture-' + i } }]
                : [{ type: 'session_meta', payload: { id: sid, cwd: base, source: 'cli' } }, { type: 'event_msg', payload: { type: 'user_message', message: agent + '-fixture-' + i } }]
            const file = path.join(dir, agent === 'claude' ? sid + '.jsonl' : 'rollout-2020-01-01-' + sid + '.jsonl')
            fs.writeFileSync(file, records.map(JSON.stringify).join('\n'))
            fs.utimesSync(file, new Date('2020-01-01'), new Date('2020-01-01'))
        }
    }
    const cfg = ad.config.store.agentDeck
    cfg.resumeListDays = 1; cfg.resumeListLimit = 1; cfg.resumeHidden = []; cfg.resumeList = true
    await ad.config.save(); await ad.rescanSessions(); ad.render()
    check('All 220 old mixed-provider sessions are listed despite legacy limits', ad.sessions().rows.length === 220, ad.sessions().rows.length)
    if (!document.querySelector('.ad-resume-rows .ad-resume')) document.querySelector('.ad-resume-head').click()
    await until(() => document.querySelectorAll('.ad-resume-rows .ad-resume').length === 220)
    check('All 220 rows are rendered without pagination', true)
    for (const agent of ['claude', 'codex']) {
        // The default terminal launches the opposite CLI directly.
        fixtureProfile.options.command = agent === 'claude' ? 'codex' : 'claude'
        fixtureProfile.options.args = []
        await ad.config.save()
        const row = [...document.querySelectorAll('.ad-resume-rows .ad-resume')].find(r => r.querySelector('.ad-title')?.textContent === agent + '-fixture-0')
        check(agent + ' history icon', row.querySelector('.ad-agent')?.title.toLowerCase().includes(agent))
        const before = new Set(ad.app.tabs)
        row.click()
        await until(() => fs.existsSync(path.join(base, agent + '-invoked.txt')))
        const command = fs.readFileSync(path.join(base, agent + '-invoked.txt'), 'utf8').trim()
        check(agent + ' actual PTY command', command === (agent === 'claude' ? '--resume ' : 'resume ') + ids[agent], command)
        const tab = ad.app.tabs.find(t => !before.has(t))
        const pane = tab.getAllTabs?.()[0] || tab
        await until(() => ad.agentOf(tab)?.effectiveId === agent)
        ad.render()
        const icon = document.querySelector('.ad-tab[data-ad-index="' + ad.app.tabs.indexOf(tab) + '"] .ad-agent')
        check(agent + ' current tab icon', icon?.title.toLowerCase().includes(agent), icon?.title)
        check(agent + ' default home preserved', !pane.profile.options.env[agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']?.includes('fixture-account'))
        const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
        const deck = ad.app.tabsService.injector.get(params[6]).deck
        const other = agent === 'claude' ? 'codex' : 'claude'
        // Exercise the same stream observer and actual DOM with a delayed old hook.
        deck.notify.hookAgent.set(tab, other)
        ad.render()
        check(agent + ' delayed opposite hook cannot replace current icon', document.querySelector('.ad-tab[data-ad-index="' + ad.app.tabs.indexOf(tab) + '"] .ad-agent')?.title.toLowerCase().includes(agent))
        deck.observePaneAgent(pane, '\x1b]0;cmd.exe\x07\r\nC:\\fixture>')
        ad.render()
        check(agent + ' shell exit removes icon', !document.querySelector('.ad-tab[data-ad-index="' + ad.app.tabs.indexOf(tab) + '"] .ad-agent'))
        deck.observePaneAgent(pane, '\x1b]0;cmd.exe - ' + other + '\x07')
        ad.render()
        check(agent + ' same PTY switches icon', document.querySelector('.ad-tab[data-ad-index="' + ad.app.tabs.indexOf(tab) + '"] .ad-agent')?.title.toLowerCase().includes(other))
    }
    fs.writeFileSync(path.join(base, 'execution-results.json'), JSON.stringify(checks, null, 2))
    return checks
})()
