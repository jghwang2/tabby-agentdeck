const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
}).outputText, file)
const load = Module._load
Module._load = function (id, ...args) {
    if (id === '@angular/core') return { Injectable: () => target => target }
    if (id === 'tabby-core') return {}
    return load.call(this, id, ...args)
}
const { SessionLedgerService } = require('../src/sessionLedger.service.ts')
const { AgentDeckService } = (() => {
    Module._load = function (id, ...args) {
        if (id.startsWith('@angular/') || id.startsWith('tabby-')) {
            return new Proxy({}, { get: (_, key) => key === '__esModule' ? false
                : ['Injectable', 'Component', 'NgModule', 'Inject', 'Optional'].includes(key) ? () => target => target : class {} })
        }
        return load.call(this, id, ...args)
    }
    return require('../src/deck.service.ts')
})()
Module._load = load
const { resumeCommand, readHead } = require('../src/sessionLedger.ts')
const sid = '01a09a25-09fa-7360-a547-691158db2faf'
const lines = [
    { type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: sid, cwd: 'E:\\project', source: 'cli' } },
    { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: '<environment_context>ignore</environment_context>' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: '지난 세션 연결' } },
].map(JSON.stringify)
assert.equal(readHead(lines).label, '지난 세션 연결')
assert.equal(resumeCommand(sid, false), `claude --resume ${sid}`)
assert.equal(resumeCommand(sid, true), `claude --resume ${sid} --fork-session`)
assert.equal(resumeCommand('bad; command', false, 'codex'), '')
assert.equal(readHead([JSON.stringify({ type: 'session_meta', payload: { source: { subagent: { thread_spawn: {} } } } })]).isSubagent, true)
;(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-resume-'))
    const oldHome = process.env.CODEX_HOME
    const oldClaudeHome = process.env.CLAUDE_CONFIG_DIR
    try {
        process.env.CODEX_HOME = temp
        process.env.CLAUDE_CONFIG_DIR = path.join(temp, 'missing-claude')
        const dir = path.join(temp, 'sessions', '2026', '09', '13')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, `rollout-2026-09-13T18-41-53-${sid}.jsonl`), lines.join('\n'))
        const service = new SessionLedgerService({ store: { agentDeck: { resumeListDays: 7 } } })
        service.file = path.join(temp, 'ledger.json')
        await service.refresh(true)
        const rows = service.records()
        assert.equal(rows.length, 1)
        assert.equal(rows[0].agent, 'codex')
        assert.equal(rows[0].cwd, 'E:\\project')
        for (const fork of [false, true]) {
            let command
            await AgentDeckService.prototype.activateResume.call({ openResumeTab: async (_, cmd) => { command = cmd } }, rows[0], fork)
            assert.equal(command, `codex ${fork ? 'fork' : 'resume'} ${sid}`)
        }
        let selected
        const tab = {}
        await AgentDeckService.prototype.activateResume.call({ resumeTabs: new Map([[sid, tab]]), app: { tabs: [tab], selectTab: t => { selected = t } } }, { ...rows[0], openTabId: sid }, false)
        assert.equal(selected, tab)
        for (const provider of ['claude', 'codex']) {
            const account = { provider, key: 'fixture-account', id: 'fixture@example.test', name: 'fixture' }
            const base = { id: 'base', options: { cwd: 'original', env: { KEEP: 'yes', OPENAI_API_KEY: 'must-not-inherit' } } }
            let opened, sent, bound
            const host = {
                syncSessionSlots: () => {}, sessionSlots: { full: true, occupied: 9 }, pendingSessionOpens: 0,
                config: { store: { terminal: { profile: 'base' } } },
                profiles: { getProfiles: async () => [base], openNewTabForProfile: async p => { opened = p; return tab } },
                status: { setLabel: () => {} }, diag: () => {},
                notify: { setAccountHome: (...args) => { bound = args } },
                sendResumeCommand: (target, cmd) => { sent = { target, cmd } },
            }
            const command = resumeCommand(sid, true, provider)
            await AgentDeckService.prototype.openResumeTab.call(host, { ...rows[0], agent: provider }, command, account)
            assert.equal(opened.options.cwd, rows[0].cwd)
            assert.equal(opened.options.env.KEEP, 'yes')
            assert.equal(opened.options.env.OPENAI_API_KEY, '')
            assert.ok(opened.options.env[provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'].endsWith('fixture-account'))
            assert.equal(base.options.cwd, 'original')
            assert.equal(base.options.env.OPENAI_API_KEY, 'must-not-inherit')
            assert.equal(sent.cmd, command)
            assert.equal(bound[1], provider)
            base.options.command = provider === 'claude' ? 'codex' : 'claude'
            base.options.args = ['--resume', 'unrelated-session']
            await AgentDeckService.prototype.openResumeTab.call(host, { ...rows[0], agent: provider }, command)
            assert.equal(opened.options.command, process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')
            assert.ok(!opened.options.args.includes('unrelated-session'))
            assert.equal(sent.cmd, command)
            host.profiles.openNewTabForProfile = async () => null
            await assert.rejects(() => AgentDeckService.prototype.openResumeTab.call(host, rows[0], command, account))
        }
        // A busy provider must not evict the other provider's older sessions.
        const claudeDir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'fixture')
        fs.mkdirSync(claudeDir, { recursive: true })
        for (let i = 0; i < 205; i++) {
            const id = 'aaaaaaaa-aaaa-aaaa-aaaa-' + String(i).padStart(12, '0')
            fs.writeFileSync(path.join(claudeDir, id + '.jsonl'), JSON.stringify({ type: 'user', cwd: 'E:\\project', message: { role: 'user', content: 'history ' + i } }))
        }
        const allHistory = new SessionLedgerService({ store: { agentDeck: { resumeListDays: 1, resumeListLimit: 1 } } })
        const oldDate = new Date('2020-01-01')
        fs.utimesSync(path.join(dir, `rollout-2026-09-13T18-41-53-${sid}.jsonl`), oldDate, oldDate)
        await allHistory.refresh(true)
        assert.equal(allHistory.records().length, 206)
        for (const row of allHistory.records()) {
            let command
            await AgentDeckService.prototype.activateResume.call({ openResumeTab: async (_, cmd) => { command = cmd } }, row, false)
            assert.equal(command.split(' ')[0], row.sessionId === sid ? 'codex' : 'claude')
        }
        const pane = { session: {} }, root = {}
        const { TerminalAgentTracker } = require('../src/screenAgent.ts')
        const tracker = new TerminalAgentTracker()
        tracker.id = 'codex'
        const host = { firstPane: () => pane, paneAgents: new WeakMap([[pane, { session: pane.session, tracker }]]),
            notify: { agentOf: () => 'claude' }, tabAgents: new WeakMap([[root, 'claude']]) }
        assert.equal(AgentDeckService.prototype.profileForTab.call(host, root).id, 'codex')
        tracker.id = 'unknown'
        assert.equal(AgentDeckService.prototype.profileForTab.call(host, root), undefined)
        tracker.id = 'claude'
        host.notify.agentOf = () => 'codex'
        assert.equal(AgentDeckService.prototype.profileForTab.call(host, root).id, 'claude')
        pane.session = {}
        assert.equal(AgentDeckService.prototype.profileForTab.call(host, root), undefined)
        console.log('PASS: default-provider resume, 206 untruncated mixed sessions, current execution icons, shell exit and PTY replacement')
    } finally {
        if (oldHome === undefined) delete process.env.CODEX_HOME
        else process.env.CODEX_HOME = oldHome
        if (oldClaudeHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = oldClaudeHome
        fs.rmSync(temp, { recursive: true, force: true })
    }
})().catch(e => { console.error(e); process.exitCode = 1 })
