const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process')
const repo = path.resolve(__dirname, '..'), python = process.env.AGENTDECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-agy-hook-'))
let event
const server = net.createServer(socket => {
    let input = ''
    socket.on('data', chunk => {
        input += chunk
        if (!input.includes('\n')) return
        event = JSON.parse(input.split('\n')[0]); input = ''
        socket.end(JSON.stringify({ id: event.id, accepted: true, output: '' }) + '\n')
    })
})
const payload = extra => JSON.stringify({
    conversationId: 'ec33ebf9-0cba-4100-8142-c61503f6c587', workspacePaths: ['/workspace/project'],
    transcriptPath: '/tmp/transcript.jsonl', artifactDirectoryPath: '/tmp/artifacts', modelName: 'gemini-test',
    lastUserInput: 'never-forward-this-prompt', ...extra,
})
function run (name, raw) {
    return new Promise((resolve, reject) => {
        const p = spawn(python, [path.join(repo, 'hooks', 'agentdeck-agy-notify.py'), name], {
            env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_TAB: 'tab-1' }, stdio: ['pipe', 'pipe', 'pipe'],
        })
        let out = '', err = ''
        p.stdout.on('data', b => { out += b }); p.stderr.on('data', b => { err += b })
        p.on('error', reject); p.on('close', code => code ? reject(Error(err)) : resolve(out))
        p.stdin.end(raw)
    })
}
;(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    assert.deepEqual(JSON.parse(await run('PreInvocation', payload({ invocationNum: 1, initialNumSteps: 0 }))), {})
    assert.equal(event.options.Agent, 'agy')
    assert.equal(event.options.Status, 'running')
    assert.equal(event.hook.session_id, 'ec33ebf9-0cba-4100-8142-c61503f6c587')
    assert.equal(event.hook.cwd, '/workspace/project')
    assert.ok(!JSON.stringify(event).includes('never-forward-this-prompt'))

    assert.deepEqual(JSON.parse(await run('PreToolUse', payload({ toolCall: { name: 'write_to_file', args: { TargetFile: '/workspace/project/a.ts' } }, stepIdx: 2 }))), { decision: 'allow' })
    assert.equal(event.options.Status, 'running')
    assert.equal(event.hook.tool_name, 'write_to_file')
    assert.equal(event.hook.tool_input.file_path, '/workspace/project/a.ts')

    await run('Stop', payload({ executionNum: 1, terminationReason: 'model_stop', fullyIdle: false, error: '' }))
    assert.equal(event.options.Status, 'running', 'background work is not done')
    assert.deepEqual(JSON.parse(await run('Stop', payload({ executionNum: 1, terminationReason: 'model_stop', fullyIdle: true, error: '' }))), { decision: 'stop' })
    assert.equal(event.options.Status, 'done')
    await run('Stop', payload({ executionNum: 1, terminationReason: 'error', fullyIdle: true, error: 'boom' }))
    assert.equal(event.options.Status, 'error')

    // The installer must preserve unrelated AGY hooks and remove only its own group.
    const file = path.join(root, 'hooks.json'), setup = path.join(repo, 'scripts', 'agentdeck-agy-setup.py')
    const originalConfig = JSON.stringify({ custom: { enabled: false, Stop: [{ type: 'command', command: 'echo keep' }] } })
    fs.writeFileSync(file, originalConfig)
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
    const configure = action => new Promise((resolve, reject) => {
        const p = spawn(python, [setup, action, '--file', file], { stdio: ['ignore', 'pipe', 'pipe'] })
        let err = ''; p.stderr.on('data', b => { err += b }); p.on('error', reject)
        p.on('close', code => code ? reject(Error(err)) : resolve())
    })
    await configure('install')
    const installed = JSON.parse(fs.readFileSync(file))
    assert.deepEqual(installed.custom, { enabled: false, Stop: [{ type: 'command', command: 'echo keep' }] })
    for (const name of ['PreInvocation', 'PreToolUse', 'PostToolUse', 'PostInvocation', 'Stop']) {
        assert.ok(installed['tabby-agentdeck'][name], name)
    }
    const once = fs.readFileSync(file, 'utf8')
    await configure('install')
    assert.equal(fs.readFileSync(file, 'utf8'), once, 'installation is idempotent')
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'existing file permissions are preserved')
    const backups = fs.readdirSync(root).filter(n => n.startsWith('hooks.json.agentdeck-backup-')).sort()
    assert.equal(backups.length, 2, 'each install keeps a distinct backup')
    assert.equal(fs.readFileSync(path.join(root, backups[0]), 'utf8'), originalConfig, 'first backup contains the original config')
    await configure('uninstall')
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { custom: { enabled: false, Stop: [{ type: 'command', command: 'echo keep' }] } })
    if (process.platform === 'win32') {
        // Exercise the actual legacy PowerShell receiver with -Agent agy.
        const ps = require('node:child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            path.join(repo, 'receiver', 'agentdeck-notify.ps1'), '-Agent', 'agy', '-Status', 'done', '-SessionId', 'legacy-agy'], {
            env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_TAB: '' }, encoding: 'utf8',
        })
        assert.equal(ps.status, 0, ps.stderr)
    }
    console.log('PASS AGY Python transport, safe hook responses, Stop states, config preservation')
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => server.close())
