const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-backlog-'))
process.env.AGENTDECK_ACCOUNTS_FILE = path.join(root, 'accounts.json')
const epoch = Date.now()
let sequence = 0
const event = (name = 'PostToolUse', extra = {}) => ({
    channel: 'agentdeck-hook', id: `event-${++sequence}`, ts: epoch + sequence,
    kind: 'notify', pid: process.pid, env: { AGENTDECK_TAB: 'known-tab' },
    options: { Agent: 'claude', Status: 'running' },
    hook: { session_id: 'parent', hook_event_name: name, cwd: 'D:/한글/😀', ...extra },
})
function seeded (name, legacy = false, agent = 'claude') {
    const dir = path.join(root, name)
    fs.mkdirSync(path.join(dir, 'status'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'status/parent.json'), JSON.stringify({
        sessionId: 'parent', ts: epoch - 1, agent, status: 'running',
        tabId: 'known-tab', cwd: 'D:/한글/😀', label: 'old label', file: 'old file', reason: 'old reason',
        agents: [{ id: 'kept-child', type: 'worker', at: epoch - 1 }],
    }))
    const d = new HookDispatcher(dir)
    if (legacy) d.run = d.runLegacy.bind(d)
    return d
}
const state = d => JSON.parse(fs.readFileSync(path.join(d.root, 'status/parent.json'), 'utf8'))
;(async () => {
    // Compare real legacy PowerShell output with the optimized disk/TCP path.
    for (const agent of ['claude', 'codex']) {
        const old = seeded(agent + '-legacy', true, agent), fast = seeded(agent + '-fast', false, agent)
        const e = event(); e.options = agent === 'codex' ? { Agent: agent } : e.options
        await old.accept(e); await fast.accept(e)
        assert.deepEqual(state(fast), state(old), agent + ' heartbeat contract')
        const before = state(fast)
        for (const change of [
            { hook: { ...e.hook, hook_event_name: 'Stop' } },
            { hook: { ...e.hook, agent_id: 'child' } },
            { hook: { ...e.hook, tool_input: { file_path: 'new-file' } } },
            { hook: { ...e.hook, cwd: 'different-cwd' } },
            { env: { AGENTDECK_TAB: '' } }, { env: { AGENTDECK_TAB: 'other-tab' } },
            { options: { ...e.options, Label: 'explicit label' } },
            { options: { ...e.options, Status: 'waiting' } }, { ts: epoch - 10 },
        ]) assert.equal(fast.runningHeartbeat({ ...e, ts: epoch + 1000, ...change }), null)
        assert.deepEqual(state(fast), before, 'ineligible events are left to the existing worker')
        fs.writeFileSync(path.join(fast.root, 'status/parent.json'), JSON.stringify({ ...before, status: 'waiting' }))
        assert.equal(fast.runningHeartbeat({ ...e, ts: epoch + 1000 }), null, 'approval must transition through worker')
    }
    // Preserve transition semantics against the original executable worker.
    for (const agent of ['claude', 'codex']) {
        const original = seeded(agent + '-transitions-old', true, agent)
        const native = seeded(agent + '-transitions-native', false, agent)
        for (const [name, status, extra] of [
            ['PostToolUse', 'running', { tool_input: { file_path: 'D:/한글/수정.ts' } }],
            ['Notification', 'waiting', { message: 'Approval required' }],
            ['PostToolUse', 'running', {}], ['Stop', 'done', {}],
            ['Notification', 'waiting', { message: 'Approval required' }],
            ['UserPromptSubmit', 'running', {}],
            ['StopFailure', 'error', { error: 'rate_limit', last_assistant_message: '한도 도달' }],
            ['UserPromptSubmit', 'running', {}],
            ['StopFailure', 'error', { error: 'server_error' }],
        ]) {
            const e = event(name, extra); e.options = { Agent: agent, Status: status }
            await original.accept(e); await native.accept(e)
            assert.deepEqual(state(native), state(original), agent + ' ' + name)
        }
    }
    // A burst that used to start one PowerShell per event; Stop must still win.
    const old = seeded('burst-legacy', true), fast = seeded('burst-fast')
    const batch = Array.from({ length: 24 }, () => event())
    let started = performance.now()
    await Promise.all(batch.map(e => old.accept(e)))
    const legacyMs = performance.now() - started
    started = performance.now()
    await Promise.all(batch.map(e => fast.accept(e)))
    const fastMs = performance.now() - started
    assert.deepEqual(state(fast), state(old))
    assert.ok(fastMs < legacyMs / 3, `Expected >3x faster: ${fastMs} vs ${legacyMs}`)
    const stop = event('Stop'); stop.options.Status = 'done'
    await fast.accept(stop); assert.equal(state(fast).status, 'done')
    assert.equal(fs.readdirSync(fast.inbox).length, 0)
    assert.equal(fs.readdirSync(fast.receipts).length, 25)
    // Independent files may proceed, but same-child and Codex parent-list order must hold.
    const lanes = new HookDispatcher(path.join(root, 'lanes'))
    const startedIds = [], releases = new Map()
    lanes.run = e => new Promise(resolve => { startedIds.push(e.id); releases.set(e.id, resolve) })
    const child = event('PostToolUse', { agent_id: 'child-a' })
    const childNext = event('SubagentStop', { agent_id: 'child-a' })
    const parent = event('Stop'), meta = { ...event(), kind: 'statusline' }
    const jobs = [child, childNext, parent, meta].map(e => lanes.accept(e))
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(new Set(startedIds), new Set([child.id, parent.id, meta.id]))
    releases.get(parent.id)(''); releases.get(meta.id)(''); releases.get(child.id)('')
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(startedIds.includes(childNext.id)); releases.get(childNext.id)(''); await Promise.all(jobs)
    const a = event('SubagentStart', { agent_id: 'codex-child' }); a.options = { Agent: 'codex', Subagent: 'start' }
    const b = event('Stop'); b.options = { Agent: 'codex', Status: 'done' }
    const aj = lanes.accept(a), bj = lanes.accept(b)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(!startedIds.includes(b.id)); releases.get(a.id)('')
    await new Promise(resolve => setImmediate(resolve))
    releases.get(b.id)(''); await Promise.all([aj, bj])
    // Receipt expiration remains operational, outside the synchronous UI poll.
    const expired = path.join(fast.receipts, 'expired.json')
    fs.writeFileSync(expired, '{}'); fs.utimesSync(expired, new Date(0), new Date(0))
    fast.prune()
    while (fast.pruning) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(!fs.existsSync(expired)); assert.ok(fs.existsSync(path.join(fast.receipts, stop.id + '.json')))
    const report = { legacyMs, fastMs, speedup: legacyMs / fastMs, burst: batch.length, root }
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
    console.log('PASS backlog: actual worker parity, burst, terminal state, independent records, Codex ordering, asynchronous expiry')
    console.log(JSON.stringify(report))
})().catch(error => { console.error(error); process.exitCode = 1 })
