const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const { spawn } = require('node:child_process')
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-receiver-'))
let dispatcher = new HookDispatcher(root)
const session = 'receiver-test', secret = 'PRIVATE-PROMPT-MUST-NOT-BE-STORED'
const env = { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_MAILBOX_ROOT: path.join(root, 'mailbox'),
    AGENTDECK_ACCOUNTS_FILE: path.join(root, 'accounts.json'), AGENTDECK_TAB: 'receiver-tab' }
const hook = (event, extra = {}) => ({ session_id: session, hook_event_name: event, prompt: secret, tool_input: { token: secret }, ...extra })
const state = () => JSON.parse(fs.readFileSync(path.join(root, 'status', session + '.json')))
const messages = []
const server = net.createServer(socket => {
    let text = ''; socket.setEncoding('utf8'); socket.on('error', () => {})
    socket.on('data', chunk => {
        text += chunk
        while (text.includes('\n')) {
            const at = text.indexOf('\n'), line = text.slice(0, at); text = text.slice(at + 1)
            const event = JSON.parse(line)
            if (event.channel === 'agentdeck-hook') {
                messages.push(event)
                dispatcher.submit(event).then(reply => { if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n') })
            } else if (event.channel) socket.write(JSON.stringify({ code: 'COMMUNICATION_DISABLED', error: 'Disabled' }) + '\n')
        }
    })
})
async function run (script, input, args = []) {
    const isNode = script.endsWith('.mjs')
    const child = spawn(isNode ? 'node' : 'powershell.exe',
        isNode ? [path.resolve(__dirname, '../hooks', script), ...args]
            : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../hooks', script), ...args],
        { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b)
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input))
    const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject) })
    assert.equal(code, 0, err); assert.equal(err, '')
    await dispatcher.tail
    return out
}
async function drain () {
    dispatcher.nextScan = 0; dispatcher.poll(); await dispatcher.tail
}
;(async () => {
    // No receiver: relay writes only a redacted event, never a final status.
    assert.equal(await run('agentdeck-codex-notify.ps1', hook('Stop')), '')
    assert.ok(!fs.existsSync(path.join(root, 'status')))
    const queuedFile = path.join(root, 'hook-inbox', fs.readdirSync(path.join(root, 'hook-inbox'))[0])
    const queued = JSON.parse(fs.readFileSync(queuedFile)); assert.ok(!JSON.stringify(queued).includes(secret))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    await drain(); assert.equal(state().status, 'done')
    assert.equal(state().identityRequired, true, 'queued lifecycle events require observed identity')
    await run('agentdeck-notify.ps1', 'bad json', ['-SessionId', 'manual-fallback', '-Status', 'done'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'status', 'manual-fallback.json'))).status, 'done')
    await run('agentdeck-codex-notify.ps1', hook('PermissionRequest', { tool_name: 'exec_command' }))
    assert.equal(state().status, 'waiting'); assert.equal(state().reason, 'Approval: exec_command')
    await run('agentdeck-notify.ps1', hook('PostToolUse', { cwd: 'D:/한글/😀', tool_input: { file_path: 'D:/한글/😀/파일.ts', token: secret } }), ['-Status', 'running'])
    assert.equal(state().cwd, 'D:/한글/😀'); assert.equal(state().file, 'D:/한글/😀/파일.ts')
    const before = fs.readFileSync(path.join(root, 'status', session + '.json'), 'utf8')
    await run('agentdeck-notify.ps1', hook('SubagentStart', { agent_id: 'child', agent_type: 'general-purpose' }), ['-Subagent', 'start'])
    assert.equal(fs.readFileSync(path.join(root, 'status', session + '.json'), 'utf8'), before)
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'agents', session, 'child.json'))).agentActivity.action, 'active')
    // Duplicate delivery after receiver restart is acknowledged without replaying the old Stop.
    dispatcher = new HookDispatcher(root)
    fs.writeFileSync(queuedFile, JSON.stringify(queued)); await drain()
    assert.equal(state().status, 'running'); assert.ok(!fs.existsSync(queuedFile))
    const stale = { ...queued, id: 'delayed-stop', ts: queued.ts - 1 }
    await dispatcher.accept(stale); assert.equal(state().status, 'running')
    await run('agentdeck-notify.ps1', hook('StopFailure', { error: 'rate_limit', last_assistant_message: '한도 도달' }), ['-Status', 'error'])
    assert.equal(state().status, 'limited')
    // Snapshot parsing is receiver-owned; user's original statusline still renders at the caller.
    fs.writeFileSync(path.join(root, 'scoped-limit.json'), JSON.stringify({ ts: Date.now(), ok: true }))
    fs.writeFileSync(path.join(root, 'statusline-inner.json'), JSON.stringify({ type: 'command', command: 'node -e "process.stdout.write(\'ORIGINAL-STATUSLINE\')"' }))
    assert.equal(await run('agentdeck-statusline.mjs', { session_id: session, model: { id: 'test', display_name: '모델' }, context_window: { used_percentage: 77 }, rate_limits: { seven_day: { used_percentage: 4 } } }), 'ORIGINAL-STATUSLINE')
    await drain()
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'meta', session + '.json')))
    assert.equal(meta.contextPct, 77); assert.equal(meta.limits.sevenDayPct, 4); assert.equal(meta.model, '모델')
    assert.equal((await dispatcher.accept({ ...queued, id: '../escape' })).accepted, false)
    env.AGENTDECK_TAB = ''
    await run('agentdeck-codex-notify.ps1', hook('PreToolUse', { session_id: 'external-origin' }))
    const external = JSON.parse(fs.readFileSync(path.join(root, 'status', 'external-origin.json')))
    assert.ok(external.pids.includes(process.pid), 'ancestry must follow the caller, not the receiver worker')
    assert.ok(messages.every(m => !JSON.stringify(m).includes(secret)))
    // A busy state worker cannot delay the caller's context response. The ACK
    // must still mean the event is already durable, and replay must run it once.
    const busy = new HookDispatcher(path.join(root, 'busy'))
    let release, writes = 0
    busy.run = (_, contextOnly) => contextOnly ? Promise.resolve('small-context')
        : new Promise(resolve => { writes++; release = () => resolve('') })
    const event = { ...queued, id: 'busy-event', ts: Date.now(), hook: hook('UserPromptSubmit') }
    const reply = await busy.submit(event)
    assert.equal(reply.output, 'small-context'); assert.equal(reply.accepted, true)
    assert.ok(fs.existsSync(path.join(root, 'busy/hook-inbox/busy-event.json')))
    release(); await busy.tail
    await busy.submit(event); assert.equal(writes, 1)
    console.log('PASS receiver: offline queue/replay, actual Claude/Codex relay, UTF8, approval, child isolation, duplicate/restart, stale event, limit, statusline preservation, metrics, invalid identity, privacy')
    console.log('Evidence: ' + root)
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => server.close())
