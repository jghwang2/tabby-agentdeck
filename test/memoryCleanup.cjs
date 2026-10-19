const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Module = require('node:module'), ts = require('typescript')
const { StringDecoder } = require('node:string_decoder')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true, esModuleInterop: true },
}).outputText, file)
const load = Module._load
Module._load = function (id, ...args) {
    if (id.startsWith('@angular/') || id.startsWith('tabby-')) {
        return new Proxy({}, { get: (_, key) => key === '__esModule' ? false
            : ['Injectable', 'Inject', 'Optional'].includes(key) ? () => target => target : class {} })
    }
    return load.call(this, id, ...args)
}
const { WorkNotifyService } = require('../src/notify.service.ts')
Module._load = load
const { createSubagentState, feedChunk, summarizeSubagents } = require('../src/subagents.ts')
const { ScheduledTasks } = require('../src/scheduledTasks.ts')
const { AgentLifecycle, AGENT_IDLE_TIMEOUT_MS } = require('../src/agentLifecycle.ts')
const day = 24 * 60 * 60 * 1000, now = Date.now()
const lifecycle = new AgentLifecycle()
for (let i = 0; i < 2000; i++) lifecycle.accept({ id: 'worker-' + i, type: 'worker', action: 'stop', ts: now }, now)
assert.equal(lifecycle.events.size, 2000)
assert.equal(lifecycle.active(now + AGENT_IDLE_TIMEOUT_MS).length, 0)
assert.equal(lifecycle.events.size, 0, 'expired stop tombstones must be released')
assert.equal(lifecycle.accept({ id: 'old-worker', type: 'worker', action: 'active', ts: now }, now + AGENT_IDLE_TIMEOUT_MS), true,
    'expired durable hooks still establish authoritative ownership')
assert.equal(lifecycle.events.size, 0, 'replaying expired files cannot refill history')
const tab = { title: 'live' }, closed = { title: 'closed split root' }
const appliedStates = []
const service = new WorkNotifyService({ tabs: [tab], activeTab: tab }, { store: { agentDeck: {} } }, {
    setManual: (...args) => appliedStates.push(args), setLabel: () => {},
}, {})
service.diag = () => {}
service.registerMailbox = () => {}
service.sessionTab.set('live', tab); service.tabSession.set(tab, 'live')
service.tabIds.set(tab, ['pane'])
service.sessionTab.set('closed', closed); service.tabSession.set(closed, 'closed')
service.tabIds.set(closed, ['closed-pane']); service.tabPids.set(closed, [123])
for (let i = 0; i < 20000; i++) service.applied.set('old-' + i, now - 2 * day)
service.applied.set('live', now)
service.pruneHookHistory()
assert.equal(service.applied.size, 1, 'expired history must not accumulate across days')
assert.equal(service.sessionTab.size, 1, 'missed split close must not retain its root')
assert.equal(service.tabSession.has(closed), false)
assert.equal(service.tabIds.has(closed), false)
assert.equal(service.tabPids.has(closed), false)

// Replaying a status file after its dedupe entry was evicted must not steal a tab.
service.apply({ sessionId: 'old-1', tabId: 'pane', ts: now - 2 * day, status: 'done' })
service.apply({ sessionId: 'invalid', tabId: 'pane', ts: NaN, status: 'done' })
assert.equal(service.tabSession.get(tab), 'live')
assert.equal(appliedStates.length, 0)
const fresh = { sessionId: 'new', tabId: 'pane', ts: Date.now(), status: 'running' }
service.apply(fresh); service.apply(fresh)
assert.equal(service.tabSession.get(tab), 'new', 'fresh session still takes over normally')
assert.equal(appliedStates.length, 1, 'duplicate current report is applied once')
for (let i = 0; i < 20000; i++) service.bindLog('unbound-' + i, 'missing pane')
assert.equal(service.lastBindLog.size, 1024)
service.bindLog('unbound-19999', 'changed pane')
assert.equal(service.lastBindLog.get('unbound-19999'), 'changed pane')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-memory-'))
const file = path.join(dir, 'transcript.jsonl')
const call = id => JSON.stringify({ type: 'assistant', message: { content: [{
    type: 'tool_use', name: 'Agent', id, input: { description: 'worker' },
}] } }) + '\n'
const scan = { sessionId: 'new', path: file, state: createSubagentState(), scheduled: new ScheduledTasks(),
    decoder: new StringDecoder('utf8'), lastSize: 0, busy: false, summary: summarizeSubagents(null) }
service.scans.set('new', scan)
feedChunk(scan.state, call('toolu_previous'))
scan.summary = summarizeSubagents(scan.state)
assert.equal(scan.summary.running, 1)
service.apply({ ...fresh, ts: fresh.ts + 1, agents: [{ id: 'hook-worker', type: 'worker', at: now }] })
assert.equal(scan.state.calls.size, 0, 'first authoritative hook releases fallback history')
assert.equal(scan.summary.running, 0)
assert.equal(service.subagentsOf(tab).running, 1, 'hook count survives history cleanup')
const timer = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'CronCreate',
    id: 'timer-call', input: { prompt: 'keep this timer' } }] } }) + '\n'
const result = JSON.stringify({ type: 'user', toolUseResult: { id: 'job' }, message: { content: [{
    type: 'tool_result', tool_use_id: 'timer-call', content: '',
}] } }) + '\n'
fs.writeFileSync(file, Array.from({ length: 5000 }, (_, i) => call('toolu_' + i)).join('') + timer + result)
;(async () => {
    await service.readGrowth(scan, fs.statSync(file).size)
    assert.equal(scan.state.calls.size, 0, 'continued output does not rebuild unused history')
    assert.equal(scan.scheduled.tasks.size, 1, 'scheduled close protection still scans the transcript')
    assert.equal(service.subagentsOf(tab).running, 1)
    // A separate session without hooks must retain the transcript fallback.
    const fallbackTab = { title: 'fallback' }
    service.app.tabs.push(fallbackTab); service.sessionTab.set('fallback', fallbackTab)
    const fallback = { ...scan, sessionId: 'fallback', state: createSubagentState(), scheduled: new ScheduledTasks(),
        decoder: new StringDecoder('utf8'), lastSize: 0, summary: summarizeSubagents(null) }
    await service.readGrowth(fallback, fs.statSync(file).size)
    assert.equal(fallback.summary.running, 5000)
    assert.equal(fallback.scheduled.tasks.size, 1)
    service.apply({ ...fresh, sessionId: 'replacement-without-hooks', ts: Date.now() + 10 })
    assert.equal(service.agentHookSeen.has(tab), false, 'a replacement session can use the transcript fallback')
    assert.equal(service.liveAgents.has(tab), false, 'a replacement cannot inherit old hook workers')
    console.log('PASS memory cleanup: 20,000 expired sessions, replay safety, split close, bounded logs, 5,000 hook-owned calls, timers and fallback')
})().catch(error => { console.error(error); process.exitCode = 1 })
