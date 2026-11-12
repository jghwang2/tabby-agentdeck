const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process')
const repo = path.resolve(__dirname, '..')
const python = process.env.AGENTDECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const { HookDispatcher } = require(path.join(repo, 'receiver/dispatcher.cjs'))
if (process.platform !== 'win32') { console.log('SKIP Windows Python hook'); process.exit(0) }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-python-'))
// Python scripts are staged outside the installed plugin.
let event, mode = 'ok'
const sockets = new Set()
const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    let input = ''
    socket.on('data', chunk => {
        input += chunk
        if (!input.includes('\n')) return
        event = JSON.parse(input.split('\n')[0]); input = ''
        if (mode === 'silent') return
        if (mode === 'malformed') return socket.end('broken\n')
        const reply = JSON.stringify({ id: mode === 'wrong-id' ? 'other' : event.id, accepted: mode !== 'reject', output: '한글 😀 문맥' }) + '\n'
        const bytes = Buffer.from(reply), cut = bytes.indexOf(Buffer.from('한')) + 1
        socket.write(bytes.subarray(0, cut)); setTimeout(() => socket.end(bytes.subarray(cut)), 5)
    })
})
function run (native, provider, raw, extraEnv = {}, args = []) {
    return new Promise((resolve, reject) => {
        const script = 'agentdeck-' + (provider === 'codex' ? 'codex-' : '') + 'notify'
        const p = spawn(native ? python : process.execPath,
            native ? [path.join(repo, 'hooks', script + '.py'), ...args] : [path.join(repo, 'hooks', script + '.mjs'), ...args], {
                windowsHide: true, env: { ...process.env, AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_TAB: 'test-tab', ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
            })
        const chunks = []; let err = ''
        p.stdout.on('data', b => chunks.push(b)); p.stderr.on('data', b => { err += b }); p.on('error', reject)
        p.on('close', code => code ? reject(Error(err)) : resolve(Buffer.concat(chunks).toString('utf8')))
        p.stdin.end(raw)
    })
}
const normalize = e => { const { id, ts, pid, ...rest } = e; return rest }
;(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    const raw = JSON.stringify({ session_id: 'native-parent', hook_event_name: 'PostToolUse', cwd: 'D:/한글/😀', tool_name: 'Write',
        tool_input: { file_path: 'D:/한글/😀.txt', secret: 'never-retain' }, prompt: 'never-retain', tool_response: 'never-retain',
        agent_type: 'worker', message: '안내', error: null })
    for (const provider of ['claude', 'codex']) {
        const args = provider === 'claude' ? ['-Status', 'running', '-MaxLabel', '32'] : []
        assert.equal(await run(false, provider, raw, {}, args), '한글 😀 문맥')
        const expected = normalize(event)
        assert.equal(await run(true, provider, raw, {}, args), '한글 😀 문맥')
        assert.deepEqual(normalize(event), expected)
        assert.equal(event.pid, process.pid, 'origin is the actual parent, without another worker')
        assert.ok(Math.abs(event.ts - Date.now()) < 2000)
        assert.ok(!JSON.stringify(event).includes('never-retain'))
    }
    await run(true, 'claude', raw, { AGENTDECK_ORIGIN_PID: '1234' }); assert.equal(event.pid, 1234)
    const last = event.id
    assert.equal(await run(true, 'claude', '{bad'), ''); assert.equal(event.id, last)
    assert.equal(await run(true, 'claude', 'null'), ''); assert.equal(event.id, last)
    assert.equal(await run(true, 'claude', JSON.stringify({ session_id: 'x', message: '가'.repeat(90000) })), ''); assert.equal(event.id, last)
    await run(true, 'claude', '{bad', {}, ['-SessionId', 'fallback']); assert.equal(event.options.SessionId, 'fallback')
    for (const failure of ['wrong-id', 'reject', 'malformed', 'silent']) {
        mode = failure
        const start = performance.now()
        assert.equal(await run(true, 'codex', raw), '')
        assert.ok(performance.now() - start < 3500, 'bounded failure deadline')
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'hook-inbox', event.id + '.json'))), event)
    }
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    const before = fs.readdirSync(path.join(root, 'hook-inbox'))
    assert.equal(await run(true, 'codex', raw), '')
    const added = fs.readdirSync(path.join(root, 'hook-inbox')).filter(n => !before.includes(n))
    assert.equal(added.length, 1)
    let processed = 0
    const dispatcher = new HookDispatcher(root)
    dispatcher.run = async () => { processed++; return '' }
    dispatcher.poll(); await dispatcher.tail
    assert.equal(processed, 5); assert.equal(fs.readdirSync(dispatcher.inbox).length, 0)
    const replay = JSON.parse(fs.readFileSync(path.join(dispatcher.receipts, added[0])))
    assert.equal(replay.accepted, true)
    const retained = event
    await dispatcher.accept(retained); assert.equal(processed, 5, 'replay deduplicated')
    // Runtime root parity with accounts path/profile hashing, including a trailing slash.
    mode = 'ok'
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const accountFile = path.join(root, 'accounts', 'accounts.json')
    const shortProfile = path.join(path.parse(process.env.ProgramFiles || 'C:/Program Files').root, 'PROGRA~1')
    const profiles = [path.join(root, '프로필') + path.sep, ...(fs.existsSync(shortProfile) ? [shortProfile] : [])]
    for (const profile of profiles) {
        const hash = require('node:crypto').createHash('sha256').update(path.resolve(profile).toLowerCase()).digest('hex').slice(0, 16)
        const runtime = path.join(root, 'accounts', 'runtime', hash)
        fs.mkdirSync(runtime, { recursive: true }); fs.writeFileSync(path.join(runtime, 'port'), String(server.address().port))
        assert.equal(await run(true, 'codex', raw, { AGENTDECK_RUNTIME_ROOT: '', AGENTDECK_ACCOUNTS_FILE: accountFile, TABBY_CONFIG_DIRECTORY: profile }), '한글 😀 문맥', 'profile path parity: ' + profile)
    }

    fs.writeFileSync(path.join(root, 'port'), String(server.address().port));
    const actual = new HookDispatcher(root, path.join(repo, 'receiver'), {report: p => reports.push(p)});
    const reports = [];
    for (const provider of ['claude','codex']) {
        for (const [hook_event_name, status] of [['UserPromptSubmit','running'],['PermissionRequest','waiting'],['Stop','done']]) {
            await run(true, provider, JSON.stringify({session_id:'actual-'+provider, hook_event_name, cwd:'D:/test'}),
                {}, provider === 'claude' ? ['-Status',status] : []);
            await actual.accept(event);
            const saved=JSON.parse(fs.readFileSync(path.join(root,'status','actual-'+provider+'.json')));
            assert.equal(saved.status,status);
            assert.equal(saved.agent,provider);
            assert.equal(saved.tabId,'test-tab');
        }
    }
    for (const [hook_event_name, args, count] of [
        ['SessionStart', ['-Status','idle'], 0],
        ['SubagentStart', ['-Subagent','start'], 1],
        ['SubagentStop', ['-Subagent','stop'], 0],
    ]) {
        await run(true, 'claude', JSON.stringify({session_id:'actual-adapter',hook_event_name,agent_id:hook_event_name==='SessionStart'?undefined:'child-1'}),{},['-Agent','codex',...args]);
        await actual.accept(event);
        const saved=JSON.parse(fs.readFileSync(path.join(root,'status','actual-adapter.json')));
        assert.equal(saved.agent,'codex');
        assert.equal((saved.agents||[]).length,count);
    }
    assert.ok(reports.length >= 6);
    console.log('PASS Python: both providers, Node parity, actual dispatcher status transitions, split UTF-8, parent PID, input limits, ACK failure deadline, offline replay/dedup, profile paths');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
    for (const socket of sockets) socket.destroy();
    server.close();
    console.log('Test artifacts:',root);
});
