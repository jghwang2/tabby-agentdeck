const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('module')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true, esModuleInterop: true },
}).outputText, f)
const load = Module._load
Module._load = function (id, ...args) {
    if (id.startsWith('@angular/') || id.startsWith('tabby-')) {
        return new Proxy({}, { get: (_, key) => key === '__esModule' ? false
            : ['Injectable', 'Component', 'NgModule', 'Inject', 'Optional'].includes(key) ? () => target => target : class {} })
    }
    return load.call(this, id, ...args)
}
const { AgentDeckService } = require('../src/deck.service.ts')
const { TerminalAgentTracker } = require('../src/screenAgent.ts')
Module._load = load

;(async () => {
    // A known AGY session can still be replaced by another CLI in the same PTY.
    // Output must schedule a fresh (TTL-throttled) process probe even before a title change.
    {
        const { WorkStatusService } = require('../src/status.service.ts')
        const root = {}, listeners = []
        const pane = { session: { output$: { subscribe: fn => listeners.push(fn) } } }
        let probes = 0
        const service = {
            watchedPanes: new WeakSet(), paneAgents: new WeakMap(), tabAgents: new WeakMap(),
            diag: () => {}, installCodexCursorFix: () => {}, announceSizeOnOpen: () => {},
            probeAgent: () => { probes++ }, outputHits: 0, status: new WorkStatusService(),
            config: { store: { agentDeck: { autoDetect: true, viewerScrape: false } } },
            profileForTab: () => undefined, touchCwd: () => {}, scheduleScreenCheck: () => {}, view: null,
        }
        service.tabAgents.set(root, 'agy')
        service.paneAgents.set(pane, { session: pane.session, tracker: { id: 'agy' } })
        AgentDeckService.prototype.watchPane.call(service, root, pane)
        probes = 0 // ignore session-bind
        listeners[0]('Claude Code v2.1.332')
        assert.equal(probes, 1, 'known AGY output still schedules a process probe for CLI replacement')
    }
    {
        const root = {}; let probes = 0
        const service = {
            enabled: true, app: { tabs: [root], activeTab: null },
            status: { tickIdle: () => false }, notify: { cwdOf: () => null }, cwdCache: new WeakMap(),
            config: { store: { agentDeck: { idleAfterMs: 2500, staleAfterMs: 300000, showElapsed: false, subagentCount: false } } },
            probeAgent: () => { probes++ }, syncLedger: () => {}, render: () => {},
        }
        AgentDeckService.prototype.tick.call(service)
        assert.equal(probes, 1, 'periodic reconciliation retries even when the terminal is idle')
    }
    const { agentFromProcessTable, parsePosixProcessTable, parseWindowsProcessTable } = require('../src/processTree.ts')
    assert.deepEqual(parsePosixProcessTable('  100     1 /bin/zsh\n  110   100 /Users/test/.local/bin/agy --sandbox\n'), [
        { pid: 100, ppid: 1, command: '/bin/zsh' },
        { pid: 110, ppid: 100, command: '/Users/test/.local/bin/agy --sandbox' },
    ])
    assert.deepEqual(parseWindowsProcessTable(JSON.stringify([{ ProcessId: 100, ParentProcessId: 1, CommandLine: 'powershell.exe' }])), [
        { pid: 100, ppid: 1, command: 'powershell.exe' },
    ])
    for (const [command, expected] of [['/Users/test/.local/bin/agy', 'agy'], ['/Users/test/.local/bin/claude', 'claude'], ['/Users/test/.codex/bin/codex', 'codex']]) {
        assert.equal(agentFromProcessTable([{ pid: 100, ppid: 1, command }], 100), expected,
            'a PTY created directly for ' + expected + ' is itself the agent')
    }
    assert.equal(agentFromProcessTable([
        { pid: 100, ppid: 1, command: '/bin/zsh' },
        { pid: 110, ppid: 100, command: '"C:\\Users\\test\\agy.exe" --sandbox' },
    ], 100), 'agy', 'quoted Windows CommandLine is recognized')
    assert.equal(agentFromProcessTable([
        { pid: 1, ppid: 0, command: 'launchd' },
        { pid: 100, ppid: 1, command: '/bin/zsh' },
        { pid: 110, ppid: 100, command: '/Users/test/.local/bin/agy' },
    ], 100), 'agy')
    assert.equal(agentFromProcessTable([
        { pid: 100, ppid: 1, command: '/bin/zsh' },
        { pid: 120, ppid: 100, command: '/Users/test/.local/bin/claude' },
    ], 100), 'claude')
    assert.equal(agentFromProcessTable([
        { pid: 100, ppid: 1, command: '/bin/zsh' },
        { pid: 110, ppid: 100, command: 'agy' },
        { pid: 111, ppid: 110, command: 'codex delegate' },
    ], 100), 'agy', 'the outer agent wins over a nested delegate')
    assert.equal(agentFromProcessTable([
        { pid: 100, ppid: 1, command: '/bin/zsh' },
        { pid: 110, ppid: 100, command: 'agy' },
        { pid: 120, ppid: 100, command: 'claude' },
    ], 100), 'unknown', 'ambiguous sibling agents are not guessed')
    for (const next of ['claude', 'codex']) {
        const root = {}, pane = { title: '', customTitle: '', session: {
            getChildProcesses: async () => [{ pid: 4242, command: next, name: next }],
            pty: { getPID: async () => 74707 },
        } }
        const tracker = new TerminalAgentTracker(); tracker.id = 'agy'
        let parent = 'agy', hooked = 'agy', unpinned = 0, renders = 0
        const service = {
            app: { getParentTab: () => root }, agentProbedAt: new WeakMap(), tabAgents: new WeakMap(),
            paneAgents: new WeakMap(), profileMemo: new WeakMap(), firstPane: () => pane,
            notify: {
                parentAgentOf: () => parent, agentOf: () => hooked,
                setParentAgent: (_tab, owner) => { if (!owner) { parent = null; hooked = null } },
                forgetAgent: () => { hooked = null },
            },
            status: { get: () => ({ pinned: true }), unpin: () => { unpinned++ } },
            commandLinesOf: async () => null, diag: () => {}, detectAgentApp: AgentDeckService.prototype.detectAgentApp,
            scheduleRender: () => { renders++ },
        }
        service.paneAgents.set(pane, { session: pane.session, tracker })
        service.tabAgents.set(root, 'agy')
        service.forgetHookStatus = AgentDeckService.prototype.forgetHookStatus.bind(service)
        await AgentDeckService.prototype.probeAgent.call(service, root, 'agy-to-' + next)
        assert.equal(tracker.id, next, 'stream identity follows the new real process')
        assert.equal(service.tabAgents.get(root), next)
        assert.equal(parent, null, 'old AGY parent ownership is released')
        assert.equal(unpinned, 1, 'old AGY pinned status is cleared')
        assert.equal(renders, 1, 'agent identity change schedules a sidebar repaint')
        assert.equal(AgentDeckService.prototype.profileForPane.call(service, pane).id, next,
            'input handling uses the new agent profile')
    }

    for (const next of ['claude', 'codex']) {
        const root = {}, pane = { title: '', customTitle: '', session: {
            getChildProcesses: async () => [], pty: { getPID: async () => 74707 },
        } }
        const tracker = new TerminalAgentTracker(); tracker.id = 'agy'
        let parent = 'agy'
        const service = {
            app: { getParentTab: () => root }, agentProbedAt: new WeakMap(), tabAgents: new WeakMap(),
            paneAgents: new WeakMap(), firstPane: () => pane,
            notify: {
                parentAgentOf: () => parent, agentOf: () => parent,
                setParentAgent: (_tab, owner) => { if (!owner) parent = null }, forgetAgent: () => {},
            },
            status: { get: () => ({ pinned: true }), unpin: () => {} },
            commandLinesOf: async () => null, agentFromProcessTree: async () => next,
            diag: () => {}, detectAgentApp: AgentDeckService.prototype.detectAgentApp,
        }
        service.paneAgents.set(pane, { session: pane.session, tracker })
        service.forgetHookStatus = AgentDeckService.prototype.forgetHookStatus.bind(service)
        await AgentDeckService.prototype.probeAgent.call(service, root, 'empty-child-list')
        assert.equal(tracker.id, next, 'PTY process-tree fallback replaces AGY without shell-title evidence')
        assert.equal(parent, null)
    }
    console.log('PASS: AGY exit then Claude/Codex replaces stream, parent, status and input profile')
})().catch(error => { console.error(error); process.exitCode = 1 })
