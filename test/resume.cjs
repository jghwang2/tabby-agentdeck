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
    try {
        process.env.CODEX_HOME = temp
        const dir = path.join(temp, 'sessions', '2026', '09', '13')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, `rollout-2026-09-13T18-41-53-${sid}.jsonl`), lines.join('\n'))
        const service = new SessionLedgerService({ store: { agentDeck: { resumeListDays: 7 } } })
        service.file = path.join(temp, 'ledger.json')
        service.projectsDir = path.join(temp, 'missing-claude')
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
            host.profiles.openNewTabForProfile = async () => null
            await assert.rejects(() => AgentDeckService.prototype.openResumeTab.call(host, rows[0], command, account))
        }
        console.log('PASS: Codex history scan without Claude, prompt/cwd, resume/fork routing, open-tab reuse, command validation')
    } finally {
        if (oldHome === undefined) delete process.env.CODEX_HOME
        else process.env.CODEX_HOME = oldHome
        fs.rmSync(temp, { recursive: true, force: true })
    }
})().catch(e => { console.error(e); process.exitCode = 1 })
