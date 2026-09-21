const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript'), Module = require('module')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
}).outputText, file)
const load = Module._load
Module._load = function (id, ...args) {
    if (id.startsWith('@angular/') || id.startsWith('tabby-')) {
        return new Proxy({}, { get: (_, key) => key === '__esModule' ? false
            : ['Injectable', 'Component', 'NgModule', 'Inject', 'Optional'].includes(key) ? () => target => target : class {} })
    }
    return load.call(this, id, ...args)
}
const { AgentDeckService } = require('../src/deck.service.ts')
const { accountHome } = require('../src/accounts.ts')
const { resumeCommand } = require('../src/sessionLedger.ts')
;(async () => {
    for (const provider of ['claude', 'codex']) {
        const events = [], tab = {}, other = {}, account = { provider, key: 'test-only', id: 'test@example.test' }
        const base = { id: 'shell', type: 'local', options: { command: 'powershell.exe', env: { BASE: 'yes' }, restoreFromPTYID: 'old' } }
        const before = JSON.stringify(base)
        const previous = { destroy: async () => { assert.equal(pane.session, null); events.push('destroy') } }
        const replacement = { releaseInitialDataBuffer: () => events.push('release') }
        const pane = { profile: { type: 'local', options: { cwd: 'old', env: { AGENTDECK_TAB_ID: 'same-tab' } } },
            session: previous, size: { columns: 120, rows: 40 },
            setSession: session => { pane.session = session; events.push('detach') },
            initializeSession: (columns, rows) => { assert.deepEqual([columns, rows], [120, 40]); pane.session = replacement; events.push('start') },
            frontend: { xterm: { reset: () => events.push('reset') } } }
        const context = { firstPane: () => pane, app: { tabs: [tab, other], activeTab: tab },
            profiles: { getProfiles: async () => [base] }, config: { store: { terminal: { profile: 'shell' } } },
            notify: { setAccountHome: (...args) => assert.deepEqual(args, [tab, provider, accountHome(account), account.id]) },
            sendResumeCommand: (target, command, session) => { assert.equal(target, tab); assert.equal(session, replacement); assert.ok(!command.includes('fork')); events.push('resume') },
            diag: () => {}, ui: s => s }
        const sid = '11111111-1111-4111-8111-111111111111'
        await AgentDeckService.prototype.switchAccountInTab.call(context, tab, account, resumeCommand(sid, false, provider), 'new-cwd')
        assert.deepEqual(context.app.tabs, [tab, other]); assert.equal(context.app.activeTab, tab)
        assert.equal(JSON.stringify(base), before, 'shared profile unchanged')
        assert.equal(pane.profile.options.cwd, 'new-cwd')
        assert.equal(pane.profile.options.env[provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'], accountHome(account))
        assert.equal(pane.profile.options.env.AGENTDECK_TAB_ID, 'same-tab')
        assert.equal(pane.profile.options.env.OPENAI_API_KEY, '')
        assert.ok(!('restoreFromPTYID' in pane.profile.options))
        assert.deepEqual(events, ['detach', 'destroy', 'reset', 'start', 'resume', 'release'])
        context.app.tabs = [other]
        events.length = 0
        await assert.rejects(AgentDeckService.prototype.switchAccountInTab.call(context, tab, account, 'unused'))
        assert.equal(events.length, 0, 'closed tab must not be restarted')
    }
    console.log('PASS: both providers keep tab identity, resume conversation, preserve unrelated tabs, isolate credentials and reject closed tabs')
})().catch(error => { console.error(error); process.exitCode = 1 })
