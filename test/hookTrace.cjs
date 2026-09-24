const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync, spawn } = require('node:child_process')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-hook-trace-test-'))
const source = path.resolve(__dirname, '../hooks')
const session = '11111111-2222-4333-8444-555555555555'
const secret = 'DO-NOT-LOG-PROMPT-TOKEN-123456'
const results = []
function traces (runtime) {
    const base = path.join(runtime, 'hook-timing')
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return []
    return fs.readdirSync(base).flatMap(day => fs.readdirSync(path.join(base, day)).map(file => {
        const text = fs.readFileSync(path.join(base, day, file), 'utf8')
        assert.ok(!text.includes(secret), 'diagnostics must not expose input or exception messages')
        return text.trim().split('\n').map(line => JSON.parse(line))
    }))
}
function envFor (runtime) {
    return { ...process.env, AGENTDECK_RUNTIME_ROOT: runtime, AGENTDECK_MAILBOX_ROOT: path.join(runtime, 'mailbox'), AGENTDECK_ACCOUNTS_FILE: path.join(runtime, 'accounts.json'), AGENTDECK_TAB: 'diagnostic-isolated' }
}
function run (name, input, prepare, hooks = source) {
    const runtime = path.join(root, name); fs.mkdirSync(runtime)
    prepare?.(runtime)
    const begin = Date.now()
    const proc = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(hooks, 'agentdeck-codex-notify.ps1')], {
        env: envFor(runtime), input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000, windowsHide: true,
    })
    assert.equal(proc.status, 0, proc.stderr || String(proc.error || ''))
    assert.equal(proc.stderr, '')
    const logs = traces(runtime)
    results.push({ name, elapsed_ms: Date.now() - begin, files: logs.length })
    return { runtime, logs, proc }
}
const payload = event => ({ session_id: session, hook_event_name: event, prompt: secret, tool_input: { token: secret }, cwd: root, tool_name: 'exec_command' })
for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd']) {
    const { runtime, logs } = run(event, payload(event))
    assert.equal(logs.length, 1)
    const stages = logs[0].map(row => row.stage)
    for (const stage of ['wrapper_enter', 'stdin_begin', 'stdin_end', 'parse_end', 'transport_begin', 'notify_enter', 'ancestry_end', 'state_write_end', 'tcp_end', 'notify_end', 'transport_end', 'wrapper_end']) assert.ok(stages.includes(stage), `${event}: missing ${stage}`)
    assert.equal(logs[0].find(row => row.stage === 'parse_end').session, session)
    assert.ok(logs[0].every(row => Number.isFinite(row.elapsed_ms)))
    const state = JSON.parse(fs.readFileSync(path.join(runtime, 'status', session + '.json'), 'utf8'))
    assert.equal(state.status, ({ PermissionRequest: 'waiting', Stop: 'done', Interrupt: 'idle', SessionEnd: 'idle' })[event] || 'running')
}
const invalid = run('invalid-json', '{' + secret)
assert.ok(invalid.logs[0].some(row => row.stage === 'wrapper_error' && row.error_type && row.line))
assert.equal(invalid.proc.stdout, '')
assert.equal(invalid.logs[0].at(-1).stage, 'wrapper_end')
const absent = run('no-session', { hook_event_name: 'Stop' })
assert.ok(absent.logs[0].some(row => row.reason === 'missing_session'))
const blocked = run('unwritable-trace', payload('Stop'), runtime => fs.writeFileSync(path.join(runtime, 'hook-timing'), 'file blocks directory'))
assert.equal(blocked.logs.length, 0)
assert.equal(JSON.parse(fs.readFileSync(path.join(blocked.runtime, 'status', session + '.json'))).status, 'done')
const writeFailure = run('state-write-failure', payload('Stop'), runtime => fs.mkdirSync(path.join(runtime, 'status', session + '.json'), { recursive: true }))
assert.ok(writeFailure.logs[0].some(row => row.stage === 'state_write_error'))
const tcpFailure = run('tcp-failure', payload('Stop'), runtime => fs.writeFileSync(path.join(runtime, 'port'), '0-invalid-' + secret))
assert.ok(tcpFailure.logs[0].some(row => row.stage === 'tcp_error'))
// Use a private hook copy to observe a failing child without altering production mailbox code.
const fakeHooks = path.join(root, 'fake-hooks'); fs.cpSync(source, fakeHooks, { recursive: true })
fs.writeFileSync(path.join(fakeHooks, 'agentdeck-mailbox.mjs'), 'process.exit(7)\n')
const childFailure = run('mailbox-child-failure', payload('PostToolUse'), null, fakeHooks)
assert.ok(childFailure.logs[0].some(row => row.stage === 'mailbox_end' && row.exit_code === 7))
async function main () {
    const runtime = path.join(root, 'interrupted'); fs.mkdirSync(runtime)
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(source, 'agentdeck-codex-notify.ps1')], { env: envFor(runtime), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.resume(); child.stderr.resume()
    const closed = new Promise(resolve => child.once('close', resolve))
    const deadline = Date.now() + 8000
    let logs
    try {
        do { await new Promise(resolve => setTimeout(resolve, 50)); logs = traces(runtime) } while (!logs.some(run => run.some(row => row.stage === 'stdin_begin')) && Date.now() < deadline)
        assert.ok(logs.some(run => run.some(row => row.stage === 'stdin_begin')))
    } finally { child.kill(); await closed }
    assert.equal(traces(runtime)[0].at(-1).stage, 'stdin_begin', 'killed process must retain its last started stage')
    results.push({ name: 'interrupted-stdin', last_stage: 'stdin_begin' })
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify({ pass: results.length, root, results }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
