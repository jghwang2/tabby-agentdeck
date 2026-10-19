(async () => {
    const ad = window.__agentdeck
    const fs = require('fs'), path = require('path'), cp = require('child_process')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('mailbox-context-ui')) throw new Error('Isolated instance only')
    const work = path.dirname(process.env.TABBY_CONFIG_DIRECTORY)
    const stage = path.resolve(work, '../mailbox-context-stage')
    const roots = ad.runtimePaths()
    const results = []
    const check = (name, condition, evidence) => {
        results.push({ name, pass: !!condition, evidence })
        if (!condition) throw new Error(name)
    }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(100) }; throw new Error('Timed out') }
    const panes = () => ad.app.tabs.flatMap(t => t.getAllTabs?.() || [t]).filter(p => p.frontend?.xterm)
    const made = [], sessions = []
    const run = (exe, args, env, input = '') => new Promise((resolve, reject) => {
        const child = cp.spawn(exe, args, { env, windowsHide: true })
        const stdout = [], stderr = []
        const timer = setTimeout(() => { child.kill(); reject(new Error('Hook timed out')) }, 10000)
        child.stdout.on('data', x => stdout.push(x)); child.stderr.on('data', x => stderr.push(x))
        child.on('error', reject)
        child.on('close', code => { clearTimeout(timer); code ? reject(new Error(Buffer.concat(stderr).toString())) : resolve(Buffer.concat(stdout).toString('utf8')) })
        child.stdin.end(input)
    })
    const savedWake = ad.config.store.agentDeck.mailboxWake
    try {
        ad.config.store.agentDeck.mailboxWake = { ...savedWake, enabled: false }
        for (let i = 0; i < 2; i++) {
            const before = new Set(panes())
            document.querySelector('.ad-new').click()
            await until(() => panes().some(p => !before.has(p) && p.session?.open))
            const pane = panes().find(p => !before.has(p))
            made.push(pane)
            const tab = ad.app.tabs.find(t => t === pane || t.getAllTabs?.().includes(pane))
            tab.customTitle = `한글 제목 ${i} · 메시지 😀`
            const sid = `context-probe-${Date.now()}-${i}`
            const env = { ...process.env, AGENTDECK_RUNTIME_ROOT: roots.runtime, AGENTDECK_MAILBOX_ROOT: roots.mailbox,
                AGENTDECK_ACCOUNTS_FILE: path.join(work, 'accounts.json'), AGENTDECK_TAB: pane.profile.options.env.AGENTDECK_TAB,
                AGENTDECK_CONTEXT: '', AGENTDECK_HOOK_DEADLINE: '' }
            // The runtime path API exposes status; its parent is the actual receiver root.
            env.AGENTDECK_RUNTIME_ROOT = path.dirname(roots.status)
            const agent = i === 0 ? 'claude' : 'codex'
            sessions.push({ sid, env, title: tab.customTitle, agent })
            const state = { sessionId: sid, tabId: env.AGENTDECK_TAB, status: 'running', agent, cwd: work, ts: Date.now() }
            fs.mkdirSync(roots.status, { recursive: true })
            fs.writeFileSync(path.join(roots.status, sid + '.json'), JSON.stringify(state))
            await until(() => ad.hookInfo().some(h => h.sessionId === sid))
        }
        ad.render()
        const [a, b] = sessions
        const bridge = path.join(stage, 'hooks/agentdeck-mailbox.mjs')
        const hook = async (session, event = 'UserPromptSubmit', mode = '') => {
            const script = session.agent === 'codex' ? 'agentdeck-codex-notify.ps1' : 'agentdeck-notify.ps1'
            const file = path.join(stage, 'hooks', script).replace(/'/g, "''")
            const args = session.agent === 'codex' ? '' : ' -Status running'
            const raw = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
                `[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(949); & '${file}'${args}`],
                { ...session.env, AGENTDECK_CONTEXT: mode }, JSON.stringify({ session_id: session.sid, hook_event_name: event, cwd: work }))
            return raw ? JSON.parse(raw).hookSpecificOutput.additionalContext : ''
        }
        const cli = async (session, method, args) => {
            const file = path.join(work, 'context-args.json')
            fs.writeFileSync(file, JSON.stringify(args || {}))
            const response = JSON.parse(await run('node.exe', [bridge, '--cli', session.sid, method, file], session.env))
            if (response.error) throw new Error(response.error)
            return response.result
        }
        const minimal = await hook(a)
        check('empty mailbox compact', minimal.endsWith('Mailbox: 0 pending') && !minimal.includes('CLI reply:'), minimal)
        check('actual UI Korean titles through CP949 PowerShell', sessions.every(s => minimal.includes(s.title)), sessions.map(s => s.title))
        check('sidebar still displays Korean titles', sessions.every(s => document.querySelector('.ad-list').textContent.includes(s.title)))
        const full = await hook(a, 'UserPromptSubmit', 'full')
        check('full opt-in retains usage', full.includes('CLI reply:') && full.includes('0 pending messages'), { full: full.length, minimal: minimal.length })
        check('empty tool boundary silent', await hook(a, 'PostToolUse') === '')
        const codexMinimal = await hook(b)
        check('Codex wrapper compact with Korean titles', codexMinimal.endsWith('Mailbox: 0 pending') && sessions.every(s => codexMinimal.includes(s.title)))
        check('Codex full opt-in', (await hook(b, 'UserPromptSubmit', 'full')).includes('CLI reply:'))
        check('Codex empty tool boundary silent', await hook(b, 'PostToolUse') === '')
        const sent = await cli(b, 'send', { toSessionId: a.sid, body: '격리 테스트 메시지', requestKey: 'context-fixture' })
        const notified = await hook(a)
        check('pending message restores instructions', notified.includes('1 pending messages') && notified.includes('agentdeck_reply'))
        const received = await cli(a, 'receive')
        check('real mailbox receives Korean payload', received.some(m => m.id === sent.id && m.body === '격리 테스트 메시지'))
        const reply = await cli(a, 'reply', { messageId: sent.id, body: '한글 답장 확인', requestKey: 'context-reply' })
        const retry = await cli(a, 'reply', { messageId: sent.id, body: '한글 답장 확인', requestKey: 'context-reply' })
        check('reply retry is idempotent', retry.id === reply.id)
        check('sender receives reply', (await cli(b, 'receive')).some(m => m.id === reply.id && m.body === '한글 답장 확인'))
        check('Codex pending reply restores instructions', (await hook(b)).includes('1 pending messages'))
        await cli(a, 'acknowledge', { messageId: sent.id, completed: true })
        await cli(b, 'acknowledge', { messageId: reply.id, completed: true })
        check('completed mailbox compact again', (await hook(a)).endsWith('Mailbox: 0 pending'))
        check('Codex completed mailbox compact again', (await hook(b)).endsWith('Mailbox: 0 pending'))
        check('message state persisted', JSON.parse(fs.readFileSync(path.join(roots.mailbox, 'mailbox.json'), 'utf8')).messages.filter(m => [sent.id, reply.id].includes(m.id)).every(m => m.completedAt))
        return { results, counts: { pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length } }
    } catch (error) { return { results, error: error.stack } }
    finally {
        ad.config.store.agentDeck.mailboxWake = savedWake
        for (const pane of made) { try { await ad.app.closeTab(ad.app.tabs.find(t => t === pane || t.getAllTabs?.().includes(pane)), true) } catch {} }
    }
})()
