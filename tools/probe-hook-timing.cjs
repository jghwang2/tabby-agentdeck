// Read-only product profiling: preload the real relay; all writes stay in an isolated runtime.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const now = () => Number(process.hrtime.bigint()) / 1e6
const base = path.resolve(__dirname, '../.tmp/hook-timing-' + Date.now())
fs.mkdirSync(base, { recursive: true })
const preload = path.join(base, 'preload.cjs')
fs.writeFileSync(preload, `const trace={boot:Number(process.hrtime.bigint())/1e6};
const stamp=()=>Number(process.hrtime.bigint())/1e6;
const fs=require('node:fs'),net=require('node:net');
const read=fs.readFileSync;
fs.readFileSync=function(file,...args){if(file===0)trace.stdinStart=stamp();const result=read.call(this,file,...args);if(file===0)trace.stdinEnd=stamp();return result};
const connect=net.createConnection;
net.createConnection=function(...args){trace.connectStart=stamp();const socket=connect.apply(this,args);
socket.prependListener('connect',()=>trace.connected=stamp());
socket.prependListener('data',()=>{trace.response??=stamp()});return socket};
trace.preloadEnd=stamp();
process.on('exit',()=>{trace.exit=stamp();process.stderr.write('HOOK_TIMING '+JSON.stringify(trace)+'\\n')});
`)
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
const { service: notify } = require('../test/notifyFixture.cjs')()
const receiver = new Map(), samples = []
const loopGaps = []
let loopAt = now()
const loopTimer = setInterval(() => { const at = now(); if (at-loopAt>30) loopGaps.push({from:loopAt,to:at,gapMs:at-loopAt}); loopAt=at }, 10)
let seq = 0, outboundHttps = 0
const https = require('node:https')
const originalHttps = { get: https.get, request: https.request }
https.get = https.request = () => { outboundHttps++; throw Error('Unexpected external API call') }
const dispatcher = new HookDispatcher(base, path.resolve(__dirname, '../receiver'), {
    authorize: event => {
        const start = now(), result = notify.authorizeHook(event)
        const row = receiver.get(event.hook.cwd)
        if (row) row.authorizeMs = (row.authorizeMs || 0) + now() - start
        return result
    }, report () {}, request: async () => ({ result: [] }),
})
dispatcher.runLegacy = () => { throw Error('Unexpected legacy worker') }
const accept = dispatcher.accept.bind(dispatcher)
dispatcher.accept = event => {
    const start = now(), pending = accept(event), row = receiver.get(event.hook.cwd)
    if (row) row.persistAndEnqueueMs = now() - start
    return pending
}
const run = dispatcher.run.bind(dispatcher)
dispatcher.run = async (event, context) => {
    const start = now()
    try { return await run(event, context) } finally {
        const row = receiver.get(event.hook.cwd)
        if (row) row[context ? 'contextMs' : 'workerMs'] = now() - start
    }
}
fs.mkdirSync(path.join(base, 'mailbox/mailbox-connections'), { recursive: true })
fs.writeFileSync(path.join(base, 'mailbox/mailbox-connections/test-tab.json'), JSON.stringify({ sessionId: 'parent', token: 'a'.repeat(64) }))
const server = net.createServer(socket => {
    let input = ''
    socket.on('data', async chunk => {
        input += chunk
        if (!input.includes('\n')) return
        const event = JSON.parse(input.split('\n')[0]); input = ''
        const row = { received: now() }; receiver.set(event.hook.cwd, row)
        const reply = await dispatcher.submit(event)
        row.ack = now()
        socket.end(JSON.stringify(reply) + '\n')
    })
})
function invoke (group, instrument = true, plain = false) {
    return new Promise((resolve, reject) => {
        const id = 'trace-' + (++seq), row = { id, group, start: now() }
        const args = [...(instrument ? ['--require', preload] : []), ...(plain ? ['-e', '0'] : [path.resolve(__dirname, '../hooks/agentdeck-notify.mjs'), '-Status', 'running'])]
        const child = spawn('node', args, { windowsHide: true, env: { ...process.env, AGENTDECK_RUNTIME_ROOT: base, AGENTDECK_TAB: 'test-tab' }, stdio: ['pipe', 'pipe', 'pipe'] })
        row.spawnReturned = now()
        child.on('exit', () => { row.osExitObserved = now() })
        child.stdout.on('end', () => { row.stdoutEnd = now() })
        child.stderr.on('end', () => { row.stderrEnd = now() })
        let stderr = '', stdout = ''
        child.stderr.on('data', b => { stderr += b }); child.stdout.on('data', b => { stdout += b })
        child.on('error', reject)
        child.on('close', code => {
            row.closed = now()
            if (code || stdout) return reject(Error('Unexpected relay output/exit: ' + stderr))
            const trace = stderr.split('\n').find(s => s.startsWith('HOOK_TIMING '))
            if (instrument && !trace) return reject(Error('Missing trace: ' + stderr))
            row.child = trace ? JSON.parse(trace.slice(12)) : null
            row.receiver = receiver.get(id)
            row.totalMs = row.closed - row.start
            const c = row.child, r = row.receiver
            if (c) row.stages = plain ? { startupMs: c.boot-row.start, runtimeMs: c.exit-c.boot, exitMs: row.closed-c.exit } : {
                startupMs: c.boot-row.start,
                moduleLoadMs: c.stdinStart-c.boot,
                stdinMs: c.stdinEnd-c.stdinStart,
                prepareMs: c.connectStart-c.stdinEnd,
                connectSendMs: r.received-c.connectStart,
                receiverMs: r.ack-r.received,
                responseMs: c.response-r.ack,
                exitMs: row.closed-c.response,
            }
            if (row.stages) {
                assert.ok(Object.values(row.stages).every(v => Number.isFinite(v) && v >= -1), 'monotonic clocks/stamps')
                assert.ok(Math.abs(Object.values(row.stages).reduce((a,b)=>a+b,0)-row.totalMs)<1)
            }
            samples.push(row); resolve(row)
        })
        child.stdin.end(JSON.stringify({ session_id: 'parent', hook_event_name: 'PostToolUse', cwd: id }))
    })
}
const summary = rows => {
    const totals = rows.map(x=>x.totalMs).sort((a,b)=>a-b)
    const worst = rows.reduce((a,b)=>a.totalMs>b.totalMs?a:b)
    const avg = key => rows.reduce((sum,r)=>sum+(r.stages?.[key]||0),0)/rows.length
    return { n:rows.length, medianMs:totals[Math.floor(totals.length/2)], p90Ms:totals[Math.ceil(totals.length*.9)-1], maxMs:worst.totalMs,
        meanStages: Object.fromEntries(Object.keys(worst.stages||{}).map(k=>[k,avg(k)])), worst }
}
;(async () => {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
    fs.writeFileSync(path.join(base,'port'),String(server.address().port))
    // Same persistent inbox/state pressure as hookSustained, without real CLI sessions.
    for(let wave=0;wave<10;wave++) await Promise.all(Array.from({length:128},(_,i)=>dispatcher.accept({
        channel:'agentdeck-hook',kind:'notify',id:'warm-'+wave+'-'+i,ts:Date.now(),env:{AGENTDECK_TAB:'test-tab'},options:{Agent:'claude',Status:'running'},
        hook:{session_id:'parent',hook_event_name:i<64?'PostToolUse':'SubagentStop',agent_id:'child-'+(i%64)},
    })))
    for(let i=0;i<10;i++) await invoke('sequential')
    for(let round=1;round<=3;round++) await Promise.all(Array.from({length:16},()=>invoke('concurrent-'+round)))
    await Promise.all(Array.from({length:16},()=>invoke('uninstrumented',false)))
    await Promise.all(Array.from({length:16},()=>invoke('plain-node',true,true)))
    await dispatcher.tail
    assert.equal(outboundHttps,0)
    assert.equal(dispatcher.active.size,0)
    const groups=Object.fromEntries([...new Set(samples.map(x=>x.group))].map(g=>[g,summary(samples.filter(x=>x.group===g))]))
    const report={base,node:process.version,clock:'process.hrtime.bigint; shared OS monotonic clock',outboundHttps,groups,samples,loopGaps}
    fs.writeFileSync(path.join(base,'report.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify({report:path.join(base,'report.json'),outboundHttps,groups},null,2))
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearInterval(loopTimer);https.get=originalHttps.get;https.request=originalHttps.request;server.close()})
