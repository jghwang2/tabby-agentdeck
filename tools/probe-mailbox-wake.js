(async () => {
    const ad = window.__agentdeck
    const fs = require('fs'), path = require('path'), cp = require('child_process')
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async fn => { for (let i = 0; i < 80; i++) { if (fn()) return; await sleep(100) }; throw new Error('Timed out') }
    const results = []
    const check = (name, condition, evidence) => { results.push({ name, pass: !!condition, evidence }); if (!condition) throw new Error(name) }
    const cfg = ad.config.store.agentDeck, saved = cfg.mailboxWake
    const roots = ad.runtimePaths()
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('mailbox-wake-ui')) throw new Error('Isolated instance only')
    const work = path.dirname(process.env.TABBY_CONFIG_DIRECTORY)
    const repo = 'D:/Project/tabby-agentdeck'
    const bridge = path.join(repo, '.tmp/mailbox-wake-stage/hooks/agentdeck-mailbox.mjs')
    const node = 'C:/Program Files/nodejs/node.exe'
    const prefix = 'wake-probe-' + Date.now()
    const panes = () => ad.app.tabs.flatMap(t => typeof t.getAllTabs === 'function' ? t.getAllTabs() : [t]).filter(p => p.frontend?.xterm)
    const made = [], files = [], writes = []
    let originalSend, recipient, sender
    const run = (args, env) => new Promise((resolve, reject) => cp.execFile(node, args, { env, windowsHide: true, encoding: 'utf8' },
        (err, stdout) => err ? reject(err) : resolve(JSON.parse(stdout))))
    const sidA = prefix + '-a', sidB = prefix + '-b'
    let request = 0
    try {
        for (let i = 0; i < 2; i++) {
            const before = new Set(panes())
            document.querySelector('.ad-new').click()
            await until(() => panes().some(p => !before.has(p) && p.session?.open))
            made.push(panes().find(p => !before.has(p)))
        }
        ;[recipient, sender] = made
        const rootOf = pane => ad.app.tabs.find(t => t === pane || t.getAllTabs?.().includes(pane))
        const tabA = rootOf(recipient), tabB = rootOf(sender)
        const paneId = pane => pane.profile.options.env.AGENTDECK_TAB
        const report = (sid, pane, status, agent = 'claude') => {
            const file = path.join(roots.status, sid + '.json')
            fs.mkdirSync(roots.status, { recursive: true })
            fs.writeFileSync(file, JSON.stringify({ sessionId: sid, tabId: paneId(pane), status, agent, ts: Date.now(), cwd: repo }))
            files.push(file)
        }
        report(sidA, recipient, 'idle'); report(sidB, sender, 'running')
        await until(() => ad.hookInfo().some(i => i.sessionId === sidA) && ad.hookInfo().some(i => i.sessionId === sidB))
        const env = { ...process.env, AGENTDECK_MAILBOX_ROOT: roots.mailbox, AGENTDECK_TAB: paneId(sender) }
        const send = async (over = {}) => {
            const args = { toSessionId: sidA, body: 'PRIVATE wake acceptance fixture', requestKey: prefix + '-' + (++request), ...over }
            const file = path.join(work, 'send.json'); fs.writeFileSync(file, JSON.stringify(args))
            const response = await run([bridge, '--cli', sidB, 'send', file], env)
            if (response.error) throw new Error(response.error)
            return response.result
        }
        const out = path.join(work, prefix + '.jsonl')
        recipient.sendInput(`& '${node}' '${repo}/tools/mailbox-wake-recipient.cjs' '${sidA}' '${roots.mailbox}' '${out}'\r`)
        const events = () => fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
        await until(() => events().some(e => e.event === 'ready'))
        originalSend = recipient.sendInput
        recipient.sendInput = function (text) { writes.push(text); return originalSend.call(this, text) }
        cfg.mailboxWake = { enabled: true, typingGuardMs: 300, text: '[agentdeck] 새 메시지 {N}건 도착  receive 로 확인하고 acknowledge 할 것' }
        ad.status.setManual(tabA, 'idle')
        const first = await send({ requestKey: prefix + '-retry' })
        check('idle: actual PTY write', first.wake.delivered && writes.length === 1, first.wake)
        await until(() => events().some(e => e.event === 'ack' && e.id === first.id))
        check('prompt -> hook pending -> receive -> completed acknowledge', events().some(e => e.event === 'hook' && /1 pending messages/.test(e.context)), events())
        const retry = await send({ requestKey: prefix + '-retry' })
        check('same requestKey writes once, preserves delivery result after ack', writes.length === 1 && retry.id === first.id && retry.wake.delivered, retry.wake)
        ad.status.setManual(tabA, 'running')
        const busy = await send(), busy2 = await send()
        check('busy defers', busy.wake.reason === 'busy-deferred' && busy2.wake.reason === 'busy-deferred' && writes.length === 1)
        ad.status.setManual(tabA, 'done')
        await until(() => events().some(e => e.event === 'ack' && e.id === busy2.id))
        check('done: one coalesced write', writes.length === 2 && writes[1].includes('2건'), writes[1])
        ad.app.selectTab(tabA); recipient.frontend.focus()
        ad.status.setManual(tabA, 'idle')
        recipient.frontend.xterm.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
        const typing = await send()
        check('typing guard defers', typing.wake.reason === 'typing-deferred' && writes.length === 2, typing.wake)
        await until(() => events().some(e => e.event === 'ack' && e.id === typing.id))
        check('typing deadline delivers without state transition', writes.length === 3)
        cfg.mailboxWake.enabled = false; ad.status.setManual(tabA, 'idle')
        const disabled = await send()
        check('global off', disabled.wake.reason === 'disabled' && writes.length === 3)
        cfg.mailboxWake.enabled = true; ad.status.setManual(tabA, 'idle')
        await until(() => events().some(e => e.event === 'ack' && e.id === disabled.id))
        ad.render()
        const row = document.querySelector(`[data-ad-index="${ad.app.tabs.indexOf(tabA)}"]`)
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }))
        const toggle = [...document.querySelectorAll('.ad-menu-item')].find(e => e.textContent === '메일 wake 끄기')
        check('context menu opt-out present', !!toggle)
        toggle.click(); ad.status.setManual(tabA, 'idle')
        const tabOff = await send()
        check('tab opt-out', tabOff.wake.reason === 'disabled' && writes.length === 4)
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        ;[...document.querySelectorAll('.ad-menu-item')].find(e => e.textContent === '메일 wake 켜기').click()
        await until(() => events().some(e => e.event === 'ack' && e.id === tabOff.id))
        // Codex's Stop hook maps to done; use that exact transport report shape.
        report(sidA, recipient, 'running', 'codex')
        await until(() => ad.status.get(tabA).status === 'running')
        const codex = await send()
        report(sidA, recipient, 'done', 'codex')
        await until(() => events().some(e => e.event === 'ack' && e.id === codex.id))
        check('Codex done lifecycle flush', writes.length === 6)
        ad.status.setManual(tabA, 'running')
        const tick = await send()
        const state = ad.status.get(tabA)
        state.since = state.lastBusy = state.lastOutput = Date.now() - 10000
        ad.status.tickIdle(tabA, 1, 1)
        await until(() => events().some(e => e.event === 'ack' && e.id === tick.id))
        check('tickIdle notification flush', writes.length === 7)
        check('one Enter, no message body', writes.every(t => t.endsWith('\r') && t.split('\r').length === 2 && !t.includes('PRIVATE') && !t.includes('\n')), writes)
        recipient.sendInput = originalSend; originalSend = null
        await ad.app.closeTab(tabA, true)
        const closed = await send()
        check('closed session queues without wake', closed.wake.reason === 'no-tab' && !closed.wake.delivered, closed.wake)
        const unknown = await send({ toSessionId: prefix + '-unknown' })
        check('unregistered session queues without wake', unknown.wake.reason === 'no-tab', unknown.wake)
        const log = fs.readFileSync(path.join(process.env.TABBY_CONFIG_DIRECTORY, '.agentdeck-diag.log'), 'utf8')
        check('diagnostic lines contain reason and count, no body', log.includes('mailbox-wake') && !log.includes('PRIVATE wake acceptance fixture'))
    } catch (error) { results.push({ name: 'probe error', pass: false, evidence: String(error.stack || error) }) }
    finally {
        cfg.mailboxWake = saved
        if (originalSend && recipient) recipient.sendInput = originalSend
        for (const pane of made) {
            const tab = ad.app.tabs.find(t => t === pane || t.getAllTabs?.().includes(pane))
            if (tab) await ad.app.closeTab(tab, true)
        }
        for (const file of files) { try { fs.unlinkSync(file) } catch {} }
    }
    return JSON.stringify({ results, summary: { pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length } })
})()
