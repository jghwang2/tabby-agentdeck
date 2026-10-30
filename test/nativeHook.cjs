const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process')
const { buildNativeHook } = require('../tools/build-native-hook.cjs')
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
if (process.platform !== 'win32') { console.log('SKIP Windows native hook'); process.exit(0) }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-native-')), bin = path.join(root, 'tabby-agentdeck', 'hooks')
buildNativeHook(bin)
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
        const p = spawn(native ? path.join(bin, script + '.exe') : process.execPath,
            native ? args : [path.resolve(__dirname, '../hooks', script + '.mjs'), ...args], {
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
    const profile = path.join(root, '프로필') + path.sep
    const accountFile = path.join(root, 'accounts', 'accounts.json')
    const hash = require('node:crypto').createHash('sha256').update(path.resolve(profile).toLowerCase()).digest('hex').slice(0, 16)
    const runtime = path.join(root, 'accounts', 'runtime', hash)
    fs.mkdirSync(runtime, { recursive: true }); fs.writeFileSync(path.join(runtime, 'port'), String(server.address().port))
    assert.equal(await run(true, 'codex', raw, { AGENTDECK_RUNTIME_ROOT: '', AGENTDECK_ACCOUNTS_FILE: accountFile, TABBY_CONFIG_DIRECTORY: profile }), '한글 😀 문맥')
    // Registration, history cleanup and source-only updates use the same offline package.
    const ts = require('typescript')
    require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f)
    for (const name of fs.readdirSync(path.resolve(__dirname, '../hooks')).filter(n => /\.(mjs|cjs|json)$/.test(n)))
        fs.copyFileSync(path.resolve(__dirname, '../hooks', name), path.join(bin, name))
    const {findHookUpgrades,applyHookUpgrades} = require('../src/hookUpgrade.ts')
    const {planHookManagement} = require('../src/hookManagement.ts')
    const homes = ['claude','codex'].map(p => path.join(root, p))
    const files = homes.map((home,i) => { fs.mkdirSync(home); return path.join(home,i ? 'hooks.json' : 'settings.json') })
    for (let i=0;i<files.length;i++) fs.writeFileSync(files[i], JSON.stringify({hooks:{PostToolUse:[{matcher:'*',hooks:[
        {type:'command',command:'echo keep-user-hook',timeout:17},
        {type:'command',command:`node "${bin.replace(/\\/g,'/')}/agentdeck-${i?'codex-':''}notify.mjs"${i?'':' -Status running'}`,timeout:i?3:5},
        {type:'command',command:`powershell -File "C:/old/tabby-agentdeck/hooks/agentdeck-${i?'codex-':''}notify.ps1"${i?'':' -Status running'}`,timeout:i?3:5},
    ]}]}}))
    const plans = findHookUpgrades(bin, files); assert.equal(plans.length,2)
    assert.ok(plans.every(p => p.management.changes.filter(c=>c.decision==='제거').length===2))
    applyHookUpgrades(plans,bin)
    for (let i=0;i<files.length;i++) {
        const s = JSON.parse(fs.readFileSync(files[i])), handlers = s.hooks.PostToolUse.flatMap(g=>g.hooks)
        assert.equal(handlers.length,2); assert.equal(handlers[0].command,'echo keep-user-hook')
        assert.match(handlers[1].command,/^".*\.exe"/)
        const view = planHookManagement(i?'codex':'claude','view',[homes[i]],bin)
        assert.ok(view.sources.some(s=>s.file.endsWith('.cs') && s.text.includes('class HookRelay')))
        assert.ok(!view.preview.includes('keep-user-hook'))
    }
    assert.equal(findHookUpgrades(bin,files).length,0,'accepted revision never prompts again')
    fs.appendFileSync(path.join(bin,'agentdeck-notify.cs'),'\n// new source revision\n')
    assert.equal(findHookUpgrades(bin,files).length,2,'source update detected without command path/version change')
    applyHookUpgrades(findHookUpgrades(bin,files),bin)
    assert.equal(findHookUpgrades(bin,files).length,0)
    fs.appendFileSync(path.join(bin,'agentdeck-notify.cs'),'// next revision\n')
    const ledgers=homes.map(h=>path.join(h,'.agentdeck-hook-registry.json')),saved=ledgers.map(f=>fs.readFileSync(f,'utf8'))
    const failedPlans=findHookUpgrades(bin,files),rename=fs.renameSync
    let failed=false
    fs.renameSync=function(from,to){
        if(!failed&&to===ledgers[1]){failed=true;throw Error('injected write failure')}
        return rename.call(fs,from,to)
    }
    try{assert.throws(()=>applyHookUpgrades(failedPlans,bin),/기존 설정을 유지/)}finally{fs.renameSync=rename}
    assert.ok(failed)
    assert.deepEqual(ledgers.map(f=>fs.readFileSync(f,'utf8')),saved,'later-home failure rolls back earlier home')
    applyHookUpgrades(findHookUpgrades(bin,files),bin)
    assert.equal(findHookUpgrades(bin,files).length,0,'retry succeeds after rollback')
    console.log('PASS native hook: Node contract parity, UTF-8 split response, parent PID, sanitization, malformed/oversize input, ACK failures/deadline, offline replay/deduplication, runtime paths')
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => {
    for (const socket of sockets) socket.destroy()
    server.close()
    fs.rmSync(root, { recursive: true, force: true })
})
