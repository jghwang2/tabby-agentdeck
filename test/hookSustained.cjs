const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process')
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-sustained-'))
let pending = [], disabled = false, seq = 0, legacyCalls = 0
const dispatcher = new HookDispatcher(root, path.resolve(__dirname, '../receiver'), {
    report () {}, request: async () => disabled ? { error: 'disabled', code: 'COMMUNICATION_DISABLED' } : { result: pending },
})
dispatcher.runLegacy = () => { legacyCalls++; throw Error('Unexpected worker process') }
fs.mkdirSync(path.join(root, 'mailbox/mailbox-connections'), { recursive: true })
fs.writeFileSync(path.join(root, 'mailbox/mailbox-connections/test-tab.json'), JSON.stringify({ sessionId: 'parent', token: 'a'.repeat(64) }))
const event = (name, child) => ({ channel: 'agentdeck-hook', kind: 'notify', id: `stress-${++seq}`, ts: Date.now(),
    env: { AGENTDECK_TAB: 'test-tab' }, options: { Agent: 'claude', Status: name === 'Stop' ? 'done' : 'running' },
    hook: { session_id: 'parent', hook_event_name: name, ...(child ? { agent_id: child } : {}) } })
const server = net.createServer(socket => {
    let input = ''
    socket.on('data', async chunk => {
        input += chunk
        if (!input.includes('\n')) return
        const e = JSON.parse(input.split('\n')[0]); input = ''
        socket.end(JSON.stringify(await dispatcher.submit(e)) + '\n')
    })
})
function invoke () {
    return new Promise((resolve, reject) => {
        const started = performance.now()
        const p = spawn('node', [path.resolve(__dirname, '../hooks/agentdeck-notify.mjs'), '-Status', 'running'], {
            windowsHide: true, env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_TAB: 'test-tab' }, stdio: ['pipe', 'pipe', 'pipe'],
        })
        let output = '', error = ''
        p.stdout.on('data', b => { output += b }); p.stderr.on('data', b => { error += b })
        p.on('error', reject); p.on('close', code => code ? reject(Error(error)) : resolve({ ms: performance.now() - started, chars: output.length }))
        p.stdin.end(JSON.stringify({ session_id: 'parent', hook_event_name: 'PostToolUse' }))
    })
}
;(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    const promptLengths = [], waves = []
    for (let wave = 0; wave < 10; wave++) {
        pending = Array.from({ length: wave * 100 }, (_, i) => ({ id: i, body: '긴 메시지'.repeat(1000) }))
        const prompt = await dispatcher.submit(event('UserPromptSubmit'))
        promptLengths.push(prompt.output.length)
        assert.ok(prompt.output.length < 500, 'Default context must not include bodies or roster')
        assert.ok(!prompt.output.includes('긴 메시지'))
        const started = performance.now()
        const jobs = Array.from({ length: 128 }, (_, i) => dispatcher.accept(event(i < 64 ? 'PostToolUse' : 'SubagentStop', `child-${i % 64}`)))
        await Promise.all(jobs)
        waves.push(performance.now() - started)
        assert.equal(dispatcher.active.size, 0)
        assert.equal(dispatcher.jobs.length, 0)
        assert.equal(fs.readdirSync(dispatcher.inbox).length, 0)
    }
    pending = []
    assert.equal((await dispatcher.submit(event('PostToolUse'))).output, '')
    disabled = true
    assert.equal((await dispatcher.submit(event('UserPromptSubmit'))).output, '')
    disabled = false
    const sequential = []
    for (let i = 0; i < 10; i++) sequential.push(await invoke())
    const concurrent = await Promise.all(Array.from({ length: 16 }, invoke))
    assert.ok([...sequential, ...concurrent].every(x => x.chars === 0))
    await dispatcher.tail
    await dispatcher.accept(event('Stop'))
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'status/parent.json'))).status, 'done')
    assert.equal(legacyCalls, 0)
    assert.equal(fs.readdirSync(dispatcher.inbox).length, 0)
    const result = { root, wavesMs: waves, eventsPerWave: 128, children: 64, promptChars: promptLengths, sequential, concurrent, legacyCalls }
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    console.log('PASS sustained: 64 children, 10 waves, empty queue, bounded context, actual Node relay')
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => server.close())
