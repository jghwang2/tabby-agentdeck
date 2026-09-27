const assert = require('node:assert/strict')
const fs = require('fs'), ts = require('typescript'), Module = require('module')
const load = Module._load
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText, file)
Module._load = function (id, ...args) {
    if (id.startsWith('@angular/') || id.startsWith('tabby-')) return new Proxy({}, {
        get: (_, key) => key === '__esModule' ? false : ['Injectable', 'Component', 'NgModule', 'Inject', 'Optional'].includes(key) ? () => t => t : class {},
    })
    return load.call(this, id, ...args)
}
const { AgentDeckService } = require('../src/deck.service.ts')
Module._load = load
const proto = AgentDeckService.prototype
const timeout = global.setTimeout, interval = global.setInterval, clear = global.clearInterval
let timers = [], intervals = [], frames = []
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
global.setInterval = fn => { intervals.push(fn); return intervals.length - 1 }
global.clearInterval = id => { intervals[id] = null }
global.requestAnimationFrame = fn => { frames.push(fn) }
const flush = () => { while (frames.length) frames.shift()() }
;(async () => {
    const tab = {}, other = {}, app = { tabs: [tab, other], activeTab: tab }
    let count = 0
    const host = { app, diag() {}, relayout() {}, repairPane() { count++ } }
    for (let i = 0; i < 50; i++) proto.repair.call(host)
    flush()
    assert.equal(count, 2, 'burst repairs each target once')
    timers.splice(0).forEach(t => t.fn())
    proto.repair.call(host); flush()
    assert.equal(count, 4, 'next repair works after completion')
    timers.splice(0).forEach(t => t.fn())
    host.relayout = () => { throw new Error('fixture layout failure') }
    proto.repair.call(host)
    assert.equal(host.repairInProgress, false, 'layout failure releases guard')
    host.relayout = () => {}
    host.repairPane = () => { throw new Error('fixture pane failure') }
    proto.repair.call(host); flush(); timers.splice(0).forEach(t => t.fn())
    assert.equal(host.repairInProgress, false, 'pane failure releases guard')

    const sizes = [], session = { open: true, resize: (...v) => sizes.push(v) }
    const pane = { session, size: { columns: 120, rows: 40 }, frontend: { xterm: { cols: 120, rows: 40 } } }
    const deck = { diag() {}, profileForPane: () => ({ id: 'codex' }), syncPtySize: proto.syncPtySize }
    proto.nudgePtyRedraw.call(deck, pane)
    assert.deepEqual(sizes[0], process.platform === 'win32' ? [120, 39] : [119, 40])
    timers.splice(0).forEach(t => t.fn())
    assert.deepEqual(sizes.at(-1), [120, 40])
    assert.equal(timers.length, 0, 'redraw restore must not queue five redundant resizes')
    proto.nudgePtyRedraw.call(deck, pane)
    pane.session = { open: true, resize() { throw new Error('must not resize replacement') } }
    timers.splice(0).forEach(t => t.fn())
    pane.session = session
    pane.size = { columns: 80, rows: 40 }
    proto.syncPtySize.call(deck, pane, pane.frontend)
    const oldRetries = timers.splice(0)
    proto.syncPtySize.call(deck, pane, pane.frontend, false)
    const before = sizes.length
    oldRetries.forEach(t => t.fn())
    assert.equal(sizes.length, before, 'superseded retries must not touch PTY')

    const sid = '11111111-1111-4111-8111-111111111111', row = { sessionId: sid, agent: 'codex' }
    let resolve, opens = 0, selected
    const resume = { app: { tabs: [tab], selectTab: t => { selected = t } }, resumeTabs: new Map(), resumeStarting: new Map(),
        notify: { liveSessions: () => new Map() }, liveSessionIds: proto.liveSessionIds, trackResumeStart: proto.trackResumeStart,
        firstPane: () => pane,
        openResumeTab: () => { opens++; return new Promise(r => { resolve = r }) } }
    const first = proto.activateResume.call(resume, row, false)
    await Promise.all(Array.from({ length: 30 }, () => proto.activateResume.call(resume, row, false)))
    assert.equal(opens, 1, 'one launch while profile/tab creation is pending')
    resolve(tab); await first
    await proto.activateResume.call(resume, row, false)
    assert.equal(opens, 1, 'tab is reserved before any hook arrives')
    assert.equal(selected, tab)
    let output
    pane.session = { open: true, output$: { subscribe: fn => { output = fn; return { unsubscribe() {} } } } }
    intervals.filter(Boolean).forEach(fn => fn())
    output('thread-store conflict: thread already has an active writer')
    assert.equal(resume.resumeStarting.size, 0, 'startup error releases reservation')
    resume.openResumeTab = async () => undefined
    await proto.activateResume.call(resume, row, false)
    assert.equal(resume.resumeOpening.size, 0, 'failed open is retryable')
    resume.openResumeTab = async () => { throw new Error('open failed') }
    await assert.rejects(() => proto.activateResume.call(resume, row, false))
    assert.equal(resume.resumeOpening.size, 0, 'exception is retryable')
    const inner = {}, wrapper = { getAllTabs: () => [inner] }
    resume.app.tabs = [wrapper]
    proto.trackResumeStart.call(resume, sid, inner)
    assert.equal(resume.resumeStarting.get(sid), wrapper, 'reserve AppService wrapper, not the inner terminal')
    const live = proto.liveSessionIds.call(resume)
    assert.equal(live.get(sid), sid)
    console.log('PASS repair lifecycle: burst, subsequent retry, exception cleanup, Codex redraw, PTY replacement, stale timer, resume race and failure')
})().finally(() => { global.setTimeout = timeout; global.setInterval = interval; global.clearInterval = clear; delete global.requestAnimationFrame })
    .catch(e => { console.error(e); process.exitCode = 1 })
