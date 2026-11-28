const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path')
const { spawn } = require('node:child_process'), net = require('node:net')
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
const python = process.env.AGENTDECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-agent-hook-'))
const script = path.resolve(__dirname, process.platform === 'win32' ? '../receiver/agentdeck-notify.ps1' : '../hooks/agentdeck-notify.py')
const dispatcher = new HookDispatcher(root)
const server = net.createServer(socket => {
    let input = ''
    socket.on('data', chunk => {
        input += chunk
        if (!input.includes('\n')) return
        const event = JSON.parse(input.split('\n')[0]); input = ''
        dispatcher.submit(event).then(reply => { if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n') })
    })
})
const session = '11111111-2222-4333-8444-555555555555'
const parent = path.join(root, 'status', session + '.json')
fs.mkdirSync(path.dirname(parent), { recursive: true })
const original = JSON.stringify({ sessionId: session, status: 'done', ts: 1234, agents: [{ id: 'old' }] })
fs.writeFileSync(parent, original)
const events = path.join(root, 'agents', session)
const read = id => JSON.parse(fs.readFileSync(path.join(events, id + '.json'), 'utf8'))
function hook (id, event, parentId = session) {
    return new Promise((resolve, reject) => {
        const child = process.platform === 'win32'
            ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', script, ...(event === 'SubagentStart' ? ['-Subagent', 'start']
                    : event === 'SubagentStop' ? ['-Subagent', 'stop'] : ['-Status', 'running'])], {
                windowsHide: true, env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root,
                    AGENTDECK_ACCOUNTS_FILE: path.join(root, 'accounts.json'), AGENTDECK_TAB: 'isolated-agent-test' },
            })
            : spawn(python, [script, ...(event === 'SubagentStart' ? ['-Subagent', 'start']
                : event === 'SubagentStop' ? ['-Subagent', 'stop'] : ['-Status', 'running'])], {
                windowsHide: true, env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root,
                    AGENTDECK_ACCOUNTS_FILE: path.join(root, 'accounts.json'), AGENTDECK_TAB: 'isolated-agent-test' },
            })
        let out = '', error = ''
        child.stdout.on('data', b => out += b); child.stderr.on('data', b => error += b)
        child.on('error', reject)
        child.on('close', async code => {
            try {
                assert.equal(code, 0, error); assert.equal(out, '', 'child must not consume parent mailbox')
                if (process.platform !== 'win32') await dispatcher.tail
                resolve()
            } catch (e) { reject(e) }
        })
        child.stdin.end(JSON.stringify({ session_id: parentId, hook_event_name: event, agent_id: id,
            agent_type: 'general-purpose', tool_input: { prompt: 'DO-NOT-PERSIST-THIS' } }))
    })
}
;(async () => {
    if (process.platform !== 'win32') {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    }
    await Promise.all(Array.from({ length: 6 }, (_, i) => hook('first-' + i, 'SubagentStart')))
    assert.equal(fs.readdirSync(events).length, 6, 'parallel starts must not overwrite each other')
    await Promise.all([hook('first-0', 'SubagentStop'), hook('second-0', 'PostToolUse'), hook('second-1', 'SubagentStart')])
    assert.equal(read('first-0').agentActivity.action, 'stop')
    assert.equal(read('second-0').agentActivity.action, 'active', 'ordinary tool hook discovers a missed start')
    await hook('first-0', 'PostToolUse')
    assert.equal(read('first-0').agentActivity.action, 'active', 'resumed agents rejoin')
    const before = read('first-1').agentActivity.ts
    await hook('second-0', 'PostToolUseFailure')
    assert.equal(read('first-1').agentActivity.ts, before, 'another agent does not renew this heartbeat')
    await hook('same-id', 'PostToolUse', 'another-parent')
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'agents', 'another-parent', 'same-id.json'))).sessionId, 'another-parent')
    await Promise.all(Array.from({ length: 6 }, () => hook('simultaneous', 'PostToolUse')))
    assert.equal(read('simultaneous').agentActivity.action, 'active')
    assert.ok(!fs.readdirSync(events).some(n => n.endsWith('.tmp')))
    assert.equal(fs.readFileSync(parent, 'utf8'), original, 'child cannot overwrite the parent status or legacy agent list')
    for (const name of fs.readdirSync(events)) assert.ok(!fs.readFileSync(path.join(events, name), 'utf8').includes('DO-NOT-PERSIST'))
    console.log('PASS actual hooks: concurrent starts, second generation, missed start, resume, isolation and parent preservation')
    console.log('Evidence: ' + root)
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { if (process.platform !== 'win32') server.close() })
