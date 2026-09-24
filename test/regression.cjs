const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const ts = require('typescript')
const Module = require('module')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true, esModuleInterop: true },
}).outputText, file)
const { mergeCodexHooks, stripCodexHooks, CODEX_EVENTS, setCodexHooks } = require('../src/codexHooks.ts')
const script = path.resolve('hooks/agentdeck-codex-notify.ps1')
const own = { type: 'command', command: `powershell -File "${script}"` }
const other = { type: 'command', command: 'echo keep' }
const original = { description: 'keep', hooks: { Stop: [{ matcher: 'existing', hooks: [own, other] }], SessionStart: [{ hooks: [other] }] } }
const untouched = structuredClone(original)
const merged = mergeCodexHooks(original, script)
assert.deepEqual(original, untouched)
assert.deepEqual(mergeCodexHooks(merged, script), merged)
assert.deepEqual(stripCodexHooks(merged).hooks.Stop, [{ matcher: 'existing', hooks: [other] }])
assert.deepEqual(stripCodexHooks(merged).hooks.SessionStart, original.hooks.SessionStart)
assert.equal(merged.description, 'keep')
assert.equal(CODEX_EVENTS.includes('Notification'), false)
assert.equal(CODEX_EVENTS.includes('StopFailure'), false)

// Exercise the actual service's input routing, including the IME send boundary.
const load = Module._load
Module._load = function (id, ...args) {
    if (id.startsWith('@angular/') || id.startsWith('tabby-')) {
        return new Proxy({}, { get: (_, key) => key === '__esModule' ? false
            : ['Injectable', 'Component', 'NgModule', 'Inject', 'Optional'].includes(key) ? () => target => target : class {} })
    }
    return load.call(this, id, ...args)
}
const { AgentDeckService } = require('../src/deck.service.ts')
const { WorkNotifyService } = require('../src/notify.service.ts')
Module._load = load
// Metadata-only identity must reach the actual rendering/input profile path.
const metaNotify = Object.assign(Object.create(WorkNotifyService.prototype), {
    hookAgent: new WeakMap(), rejectedMetaSession: new WeakMap(),
    tabSession: new Map(), metaBySession: new Map(),
})
const metaTab = {}
metaNotify.tabSession.set(metaTab, 'current')
metaNotify.metaBySession.set('current', { agent: 'codex', model: 'custom-model' })
const metaService = { app: {}, notify: metaNotify }
assert.equal(AgentDeckService.prototype.profileForPane.call(metaService, metaTab).id, 'codex')
metaNotify.hookAgent.set(metaTab, 'claude')
assert.equal(metaNotify.agentOf(metaTab), 'claude', 'explicit hook overrides retained metadata')
metaNotify.forgetAgent(metaTab)
assert.equal(metaNotify.agentOf(metaTab), null, 'disproved metadata cannot revive Codex')
metaNotify.metaBySession.set('current', { agent: 'codex', model: 'new-model' })
assert.equal(metaNotify.agentOf(metaTab), null, 'polling the old session cannot revive it either')
metaNotify.tabSession.set(metaTab, 'next')
assert.equal(metaNotify.agentOf(metaTab), null, 'new session does not inherit old metadata')
metaNotify.metaBySession.set('next', { agent: 'claude', model: 'gpt-custom' })
assert.equal(metaNotify.agentOf(metaTab), 'claude', 'reporting CLI takes priority over model spelling')
metaNotify.metaBySession.set('next', { model: 'gpt-custom' })
assert.equal(metaNotify.agentOf(metaTab), null, 'a model name alone does not identify the CLI')
metaNotify.hookAgent.set(metaTab, 'codex')
assert.equal(metaNotify.agentOf(metaTab), 'codex', 'fresh explicit hook remains authoritative')
assert.equal(metaNotify.agentOf({}), null, 'unbound tabs cannot borrow another session')

const { TerminalAgentTracker, isLiveCodexScreen } = require('../src/screenAgent.ts')
const liveScreen = ['response text', '› draft', '', '  gpt-6-astra · Ready · Context 71% left', '', '', '']
assert.equal(isLiveCodexScreen(liveScreen), true)
assert.equal(isLiveCodexScreen([...liveScreen, 'E:\\project>']), false, 'old Codex footer above a shell is not live')
assert.equal(isLiveCodexScreen(['Discuss Codex', 'Context 71% left']), false)
assert.equal(isLiveCodexScreen(['❯ Claude draft', '  gpt-6-astra · Ready · Context 71% left']), false)
assert.equal(isLiveCodexScreen(['/ T R A N S C R I P T /', 'history', 'q close', '', '']), true)
const livePane = { session: {}, frontend: { xterm: { rows: liveScreen.length, buffer: { active: {
    baseY: 0, getLine: i => ({ translateToString: () => liveScreen[i] }),
} } } } }
const liveService = { app: {}, paneAgents: new WeakMap(), tabAgents: new WeakMap(), profileForTab: () => undefined }
for (let attempt = 0; attempt < 3; attempt++) {
    const lost = new TerminalAgentTracker(); lost.id = 'unknown'
    liveService.paneAgents.set(livePane, { session: livePane.session, tracker: lost })
    assert.equal(AgentDeckService.prototype.profileForPane.call(liveService, livePane).id, 'codex',
        'live composer restores every loss without a banner or OS probe')
    assert.equal(liveService.paneAgents.get(livePane).tracker.id, 'codex')
    assert.equal(liveService.tabAgents.get(livePane), 'codex')
}
livePane.session = {}
assert.equal(AgentDeckService.prototype.profileForPane.call(liveService, livePane), undefined,
    'a new PTY cannot inherit a previous PTY live screen')
const banner = '\x1b[?2026h\x1b[25l│ >_ \x1b[1mOpenAI Codex\x1b[m (v0.154.0) │\r\n'
const tracker = new TerminalAgentTracker()
// ConPTY may split either the ANSI styling or the banner itself at any byte.
for (const ch of banner) tracker.write(ch)
assert.equal(tracker.id, 'codex')
tracker.write('\x1b[H' + 'restored conversation\r\n'.repeat(10000))
assert.equal(tracker.id, 'codex', 'resume cannot erase identity when the banner leaves scrollback')
tracker.write('\r\n ▐▛███▛█   Claude Code v2.1.270\r\n')
assert.equal(tracker.id, 'codex', 'a historical Claude banner is not an application switch')
const resumedPane = { session: {}, frontend: { xterm: { rows: 33, buffer: { active: {
    baseY: 0, getLine: () => ({ translateToString: () => 'restored conversation' }),
} } } } }
const resumeService = {
    app: {}, paneAgents: new WeakMap(), profileForTab: () => undefined,
}
resumeService.paneAgents.set(resumedPane, { session: resumedPane.session, tracker })
assert.equal(AgentDeckService.prototype.profileForPane.call(resumeService, resumedPane).id, 'codex')
tracker.write('\x1b]0;관리자: C:\\WINDOWS\\SYSTEM32\\cmd.exe\x07')
assert.equal(AgentDeckService.prototype.profileForPane.call(resumeService, resumedPane).id, 'codex',
    'a child process restoring the shell title must not disable Codex rendering and input')
tracker.write('\x1b]0;C:\\WINDOWS\\SYSTEM32\\cmd.exe - powershell -NoProfile\x07')
assert.equal(tracker.id, 'codex', 'a tool command title does not mean the outer Codex exited')
tracker.write('\r\nE:\\project>')
assert.equal(AgentDeckService.prototype.profileForPane.call(resumeService, resumedPane), undefined)
tracker.write('\r\n ▐▛███▛█   Claude Code v2.1.270\r\n')
assert.equal(AgentDeckService.prototype.profileForPane.call(resumeService, resumedPane).id, 'claude')
tracker.write('\x1b]0;관리자: C:\\WINDOWS\\SYSTEM32\\cmd.exe - codex resume test\x07' + banner)
assert.equal(tracker.id, 'codex', 'a new Codex banner supersedes Claude')
resumedPane.session = {}
assert.equal(AgentDeckService.prototype.profileForPane.call(resumeService, resumedPane), undefined,
    'a replacement PTY cannot inherit the previous session identity')
AgentDeckService.prototype.observePaneAgent.call(resumeService, resumedPane, 'new shell')
assert.equal(resumeService.paneAgents.get(resumedPane).tracker.id, undefined)
const prose = new TerminalAgentTracker()
for (let split = 0; split <= 40; split++) {
    const active = new TerminalAgentTracker()
    active.write(banner)
    const title = '\x1b]0;C:\\Windows\\System32\\cmd.exe\x07'
    active.write(title.slice(0, split)); active.write(title.slice(split))
    assert.equal(active.id, 'codex', 'split child-process title preserves Codex')
    active.write('\r\nPS E:\\project>')
    assert.equal(active.id, 'unknown', 'returning to the actual shell disables Codex')
}
prose.write('Discuss OpenAI Codex (v0.154.0) and Claude Code v2.1.270\r\n')
assert.equal(prose.id, undefined, 'ordinary mentions are not application banners')
prose.write('\x1b]0;C:\\Windows\\System32\\cmd.exe - echo codex\x07')
assert.equal(prose.id, 'unknown', 'mentioning Codex in a shell argument is not launching it')
prose.write('\x1b]0;C:\\Windows\\System32\\cmd.exe - "node" "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js" resume test\x07')
assert.equal(prose.id, 'codex', 'the actual npm entry point identifies Codex before rendering')
// A previous Codex process must not apply its rendering/input workaround to
// Claude launched subsequently in the same terminal.
for (const [cached, lines, expected] of [
    ['codex', [' ▐▛███▛█   Claude Code v2.1.268'], 'claude'],
    ['claude', ['│ >_ OpenAI Codex (v0.154.0) │'], 'claude'],
    [undefined, ['│ >_ OpenAI Codex (v0.154.0) │'], 'codex'],
]) {
    const pane = { frontend: { xterm: { rows: lines.length, buffer: { active: {
        baseY: 0, getLine: i => ({ translateToString: () => lines[i] }),
    } } } } }
    const profile = AgentDeckService.prototype.profileForPane.call({
        app: {}, profileForTab: () => cached ? { id: cached } : undefined,
    }, pane)
    assert.equal(profile.id, expected)
}
for (const [agent, expected] of [['codex', '\x1b\r'], ['claude', '\n']]) {
    const writes = []
    const pane = { sendInput: data => writes.push(data) }
    let deferred
    AgentDeckService.prototype.sendNewline.call({
        focusedPane: () => pane, profileForPane: () => ({ id: agent }),
        diag: () => {},
        sendToPane: (target, tag, send) => { assert.equal(target, pane); deferred = send },
    })
    assert.deepEqual(writes, [])
    writes.push('한') // IME commit precedes the queued newline.
    deferred()
    assert.deepEqual(writes, ['한', expected])
}
let erased = false
assert.equal(AgentDeckService.prototype.clearInputArea.call({ profileForPane: () => ({ id: 'codex' }) },
    { frontend: { xterm: { write: () => { erased = true } } } }, { lines: [], cols: 80 }), false)
assert.equal(erased, false)
// Codex's valid completion separator must never enter Claude's repair detector.
AgentDeckService.prototype.checkScreen.call({
    profileForPane: () => ({ id: 'codex' }),
    readScreen: () => { throw new Error('Claude-only detector reached Codex screen') },
}, {})

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-regression-'))
const oldHome = process.env.CODEX_HOME
try {
    process.env.CODEX_HOME = path.join(temp, 'codex')
    fs.mkdirSync(process.env.CODEX_HOME)
    const config = path.join(process.env.CODEX_HOME, 'hooks.json')
    fs.writeFileSync(config, '{broken')
    assert.throws(() => setCodexHooks(true))
    assert.equal(fs.readFileSync(config, 'utf8'), '{broken')
    const env = { ...process.env, LOCALAPPDATA: temp, AGENTDECK_RUNTIME_ROOT: path.join(temp, 'tabby-agentdeck'), AGENTDECK_MAILBOX_ROOT: path.join(temp, 'mailbox'), AGENTDECK_TAB: 'test-tab' }
    const report = event => {
        const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
            input: JSON.stringify({ session_id: 'test-session', hook_event_name: event, tool_name: '셸' }), encoding: 'utf8', env, timeout: 10000,
        })
        assert.equal(result.status, 0, result.error?.message || result.stderr)
        if (event === 'UserPromptSubmit') {
            const context = JSON.parse(result.stdout).hookSpecificOutput
            assert.equal(context.hookEventName, event)
            assert.match(context.additionalContext, /AgentDeck live UI snapshot/)
            assert.match(context.additionalContext, /test-session/)
        } else { assert.equal(result.stdout.trim(), '') }
        return JSON.parse(fs.readFileSync(path.join(temp, 'tabby-agentdeck/status/test-session.json'), 'utf8'))
    }
    for (const [event, status] of [['UserPromptSubmit', 'running'], ['Stop', 'done'], ['PermissionRequest', 'waiting'], ['PostToolUse', 'running'], ['Interrupt', 'idle']]) {
        const data = report(event)
        assert.equal(data.status, status, event)
        assert.equal(data.sessionId, 'test-session')
        assert.equal(data.tabId, 'test-tab')
        if (event === 'PermissionRequest') assert.equal(data.reason, 'Approval: 셸')
    }
    const claudeReport = (event, status, extra = {}) => {
        const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            path.resolve('hooks/agentdeck-notify.ps1'), '-Status', status], {
            input: JSON.stringify({ session_id: 'claude-test', hook_event_name: event, ...extra }),
            encoding: 'utf8', env, timeout: 10000,
        })
        assert.equal(result.status, 0, result.stderr)
        if (event === 'UserPromptSubmit') {
            const context = JSON.parse(result.stdout).hookSpecificOutput
            assert.equal(context.hookEventName, event)
            assert.match(context.additionalContext, /AgentDeck live UI snapshot/)
            assert.match(context.additionalContext, /claude-test/)
        } else { assert.equal(result.stdout.trim(), '') }
        const data = JSON.parse(fs.readFileSync(path.join(temp, 'tabby-agentdeck/status/claude-test.json'), 'utf8'))
        assert.equal(data.tabId, 'test-tab')
        return data.status
    }
    assert.equal(claudeReport('UserPromptSubmit', 'running'), 'running')
    assert.equal(claudeReport('Notification', 'waiting', { message: 'Claude needs your permission to use Bash' }), 'waiting')
    assert.equal(claudeReport('PostToolUse', 'running'), 'running')
    assert.equal(claudeReport('Stop', 'done'), 'done')
    assert.equal(claudeReport('Notification', 'waiting', { message: 'waiting for your input' }), 'done')
    assert.equal(claudeReport('StopFailure', 'error', { error: 'rate_limit' }), 'limited')
    assert.equal(claudeReport('StopFailure', 'error', { error: 'server_error' }), 'error')
    console.log('PASS: Claude lifecycle transport, approval, idle filtering, rate limit, error; prompt context without MCP')
    console.log('PASS: routing/IME order, Codex repair guard, hook merge preservation/idempotence, malformed config, PowerShell lifecycle transport')
} finally {
    if (oldHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = oldHome
    fs.rmSync(temp, { recursive: true, force: true })
}

;(async () => {
    for (const via of ['proc', 'cmdline', 'title', 'none']) {
        const pane = { session: {} }, tracker = new TerminalAgentTracker()
        tracker.id = 'unknown'
        const root = {}, service = {
            agentProbedAt: new WeakMap(), tabAgents: new WeakMap(), paneAgents: new WeakMap(),
            firstPane: () => pane, detectAgentApp: async () => ({ id: 'codex', via }), diag: () => {},
        }
        service.paneAgents.set(pane, { session: pane.session, tracker })
        await AgentDeckService.prototype.probeAgent.call(service, root, 'test')
        assert.equal(tracker.id, ['proc', 'cmdline'].includes(via) ? 'codex' : 'unknown',
            'only fresh process evidence restores an invalidated stream identity')
        tracker.id = 'unknown'; service.agentProbedAt.delete(root)
        service.detectAgentApp = async () => { pane.session = {}; return { id: 'codex', via: 'proc' } }
        await AgentDeckService.prototype.probeAgent.call(service, root, 'test')
        assert.equal(tracker.id, 'unknown', 'a late process result cannot restore a replaced PTY')
    }
    // ── 낡은 훅 정체는 명령줄로 갈렸을 때도 버려야 한다 ──
    //
    // 훅은 자기가 무슨 CLI 인지 **정확히** 안다 (`hooks/agentdeck-notify.ps1` 은 `-Agent claude`,
    // `agentdeck-codex-notify.ps1` 은 `-Agent codex` 로 고정). 틀리는 게 아니라 **낡는다** —
    // 훅에 "세션이 끝났다" 가 없어서, 같은 탭에서 claude 를 끄고 다른 CLI 를 띄워도 옛 값이 남는다.
    //
    // npm 전역 래퍼로 띄운 CLI 는 자식이 `node.exe` 하나뿐이라 **이름으로는 영영 안 갈린다**.
    // 그 경우 명령줄만이 지금의 사실인데, 여기서 훅 값을 버리지 않으면 훅을 제일 먼저 보는
    // 동기 경로(`resolveProfileForPane`)가 계속 옛 정체를 낸다 — 커서 보정·키보드가 쓰는 자리다.
    for (const [cmdline, expected, forgets] of [
        ['"C:/…/node.exe" C:/Users/x/npm/node_modules/@openai/codex/bin/codex.js', 'codex', true],
        ['"C:/…/node.exe" C:/Users/x/npm/node_modules/@anthropic-ai/claude-code/cli.js', 'claude', false],
        ['"C:/…/node.exe" C:/Users/x/npm/node_modules/left-pad/index.js', 'unknown', false],
    ]) {
        const root = {}, forgot = [], unpinned = []
        const pane = {
            title: '', customTitle: '',
            session: { getChildProcesses: async () => [{ pid: 4242, command: 'node.exe', name: 'node.exe' }] },
        }
        // 훅이 `진행중`으로 고정해 둔 탭을 그대로 재현한다 — 정체만 버리고 고정을 남기면
        // 새 CLI 의 출력이 `setAuto` 로 아무리 들어와도 전부 무시된다 (배지가 박힌다)
        const service = {
            app: { getParentTab: () => root },
            notify: { agentOf: () => 'claude', forgetAgent: t => forgot.push(t) },
            status: { get: () => ({ pinned: true }), unpin: t => unpinned.push(t) },
            commandLinesOf: async () => cmdline,
            diag: () => {},
        }
        service.forgetHookStatus = AgentDeckService.prototype.forgetHookStatus.bind(service)
        const got = await AgentDeckService.prototype.detectAgentApp.call(service, pane)
        assert.equal(got.id, expected === 'unknown' ? 'unknown' : expected,
            `command line decides when the process name is just node.exe (${expected})`)
        assert.equal(got.via, expected === 'unknown' ? 'none' : 'cmdline')
        assert.equal(forgot.length, forgets ? 1 : 0,
            `a stale hook identity is dropped only when the command line names a different agent (${expected})`)
        assert.equal(unpinned.length, forgets ? 1 : 0,
            `the hook-pinned status is dropped with the identity (${expected})`)
        if (forgets) {
            assert.equal(forgot[0], root, 'dropped on the owning tab')
            assert.equal(unpinned[0], root, 'unpinned on the owning tab')
        }
    }
    console.log('PASS: child-process titles, real shell exit, fresh process identity recovery, stale hook dropped by command line')
})().catch(error => { console.error(error); process.exitCode = 1 })
