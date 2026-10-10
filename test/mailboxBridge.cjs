const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { SessionMailbox } = require('../.tmp/sessionMailbox')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-bridge-test-'))
const bridge = path.resolve(__dirname, '../hooks/agentdeck-mailbox.mjs')
const children = []
const timeout = promise => Promise.race([promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('test timeout')), 10000); timer.unref()
})])
let mailbox = new SessionMailbox(path.join(root, 'mailbox.json'))
const server = net.createServer(socket => {
    socket.on('error', () => {})
    let buffer = ''
    socket.on('data', data => {
        buffer += data
        if (!buffer.includes('\n')) return
        const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (request.channel === 'agentdeck-navigation') {
            socket.write(JSON.stringify({result:{capturedAt:new Date().toISOString(), context:'Human slot 1: session IDs actual-a\nHuman slot 2: tab open; session not registered'}})+'\n')
            return
        }
        try {
            if (request.channel === 'agentdeck-external-mailbox') {
                socket.write(JSON.stringify({ result: mailbox.callExternal(request.sessionId, request.token, request.method, request.arguments) }) + '\n')
                return
            }
            assert.equal(request.channel, 'agentdeck-mailbox')
            assert.equal(typeof request.sessionId, 'string')
            assert.equal(request.slot, undefined)
            socket.write(JSON.stringify({ result: mailbox.call(request.sessionId, request.token, request.method, request.arguments) }) + '\n')
        } catch (e) { socket.write(JSON.stringify({ error: e.message }) + '\n') }
    })
})
function client (pane, sid, external = false) {
    const env = { ...process.env, AGENTDECK_MAILBOX_ROOT: root, AGENTDECK_TAB: pane }
    if (external) { delete env.AGENTDECK_TAB; env.AGENTDECK_SESSION_ID = sid }
    const processChild = spawn(process.execPath, [bridge], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    children.push(processChild)
    let id = 0, buffer = ''
    const waiting = new Map()
    processChild.stdout.on('data', data => {
        buffer += data
        while (buffer.includes('\n')) {
            const index = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
            waiting.get(message.id)?.(message); waiting.delete(message.id)
        }
    })
    return {
        env, pid: processChild.pid,
        call (method, params = {}) {
            const requestId = ++id
            return timeout(new Promise(resolve => {
                waiting.set(requestId, resolve)
                processChild.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
            }))
        },
        register () {
            const auth = mailbox.register(sid, sid, '/project')
            fs.writeFileSync(path.join(root, 'mailbox-connections', pane + '.json'), JSON.stringify({ ...auth, clientPid: processChild.pid }))
        },
    }
}
async function run () {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    async function invoke (args, env) {
        const child = spawn(process.execPath, [bridge, ...args], {env, windowsHide:true})
        children.push(child)
        let stdout = ''; child.stdout.on('data', data => { stdout += data })
        const code = await timeout(new Promise(resolve => child.on('exit', resolve)))
        return {code, stdout}
    }
    const plainEnv = {...process.env, AGENTDECK_MAILBOX_ROOT:root, AGENTDECK_TAB:'plain-pane'}
    const withoutMcp = await invoke(['--hook','actual-plain','UserPromptSubmit'], plainEnv)
    assert.equal(withoutMcp.code,0)
    assert.match(JSON.parse(withoutMcp.stdout).hookSpecificOutput.additionalContext,/Human slot 2: tab open/)
    assert.match(withoutMcp.stdout,/Mailbox not registered/)
    fs.mkdirSync(path.join(root,'mailbox-connections'),{recursive:true})
    fs.writeFileSync(path.join(root,'mailbox-connections','plain-pane.json'),JSON.stringify({...mailbox.register('actual-plain','Plain','/project'),clientPid:0}))
    const registered = await invoke(['--hook','actual-plain','UserPromptSubmit'],plainEnv)
    assert.match(registered.stdout,/Mailbox registered/)
    assert.match(registered.stdout,/--cli actual-plain receive/)
    const cliRead = await invoke(['--cli','actual-plain','receive'],plainEnv)
    assert.deepEqual(JSON.parse(cliRead.stdout),{result:[]})
    assert.equal((await invoke(['--cli','wrong-session','receive'],plainEnv)).code,1)
    const a = client('pane-a', 'actual-a'), b = client('pane-b', 'actual-b')
    for (const c of [a, b]) {
        const init = await c.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
        assert.equal(init.result.serverInfo.name, 'agentdeck-mailbox')
        c.register()
        const list = await c.call('tools/list')
        assert.equal(list.result.tools.length, 5)
        assert.ok(list.result.tools.every(tool => !JSON.stringify(tool.inputSchema).includes('slot')))
    }
    const tool = async (c, name, args = {}) => (await c.call('tools/call', { name: 'agentdeck_' + name, arguments: args })).result
    const externalEnv = { ...process.env, AGENTDECK_MAILBOX_ROOT: root }
    delete externalEnv.AGENTDECK_TAB
    delete externalEnv.AGENTDECK_SESSION_ID
    assert.match((await invoke(['--cli', 'external-peer', 'receive'], externalEnv)).stdout, /first message/)
    assert.equal(fs.existsSync(path.join(root, 'mailbox-external')), false, 'external caller must not create runtime files')
    const externalFile = path.join(root, 'external-send.json')
    // Windows PowerShell's Set-Content -Encoding UTF8 includes a BOM.
    fs.writeFileSync(externalFile, '\uFEFF' + JSON.stringify({ toSessionId: 'actual-a', body: 'external hello', requestKey: 'external-hello' }))
    const firstExternal = JSON.parse((await invoke(['--cli', 'external-peer', 'send', externalFile], externalEnv)).stdout).result
    assert.equal(firstExternal.fromSessionId, 'external-peer')
    const externalReply = JSON.parse((await tool(a, 'reply', { messageId: firstExternal.id, body: 'external reply', requestKey: 'external-reply' })).content[0].text)
    assert.equal(JSON.parse((await invoke(['--cli', 'external-peer', 'receive'], externalEnv)).stdout).result[0].id, externalReply.id)
    assert.match((await invoke(['--hook', 'external-peer', 'PostToolUse'], externalEnv)).stdout, /1 pending messages/)
    assert.equal(JSON.parse((await invoke(['--cli', 'external-peer', 'send', externalFile], externalEnv)).stdout).result.id, firstExternal.id)
    await tool(a, 'acknowledge', { messageId: firstExternal.id, completed: true })
    const outsideMcp = client('', 'external-mcp', true)
    await outsideMcp.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'external-test', version: '1' } })
    const mcpFirst = JSON.parse((await tool(outsideMcp, 'send', { toSessionId: 'actual-a', body: 'external MCP hello', requestKey: 'mcp-first' })).content[0].text)
    const mcpReply = JSON.parse((await tool(a, 'reply', { messageId: mcpFirst.id, body: 'MCP reply', requestKey: 'mcp-answer' })).content[0].text)
    assert.equal(JSON.parse((await tool(outsideMcp, 'receive')).content[0].text)[0].id, mcpReply.id)
    await tool(a, 'acknowledge', { messageId: mcpFirst.id, completed: true })
    const sent = JSON.parse((await tool(a, 'send', { toSessionId: 'actual-b', body: '리뷰 부탁', requestKey: 'one' })).content[0].text)
    assert.equal(sent.fromSessionId, 'actual-a')
    assert.equal(JSON.parse((await tool(b, 'receive')).content[0].text)[0].id, sent.id)
    const cliMessage = path.join(root,'send.json')
    fs.writeFileSync(cliMessage,JSON.stringify({toSessionId:'actual-a',body:'CLI 수신 확인',requestKey:'plain-one'}))
    const cliSent = await invoke(['--cli','actual-plain','send',cliMessage],plainEnv)
    assert.equal(JSON.parse(cliSent.stdout).result.fromSessionId,'actual-plain')
    const receivedPlain = JSON.parse((await tool(a,'receive')).content[0].text).find(x=>x.fromSessionId==='actual-plain')
    assert.ok(receivedPlain)
    await tool(a,'acknowledge',{messageId:receivedPlain.id,completed:true})
    // Reply needs only the received message ID, including from a client without MCP.
    const replyArgs = path.join(root, 'reply.json')
    fs.writeFileSync(replyArgs, JSON.stringify({ messageId: receivedPlain.id, body: '훅으로 답장', requestKey: 'cli-reply' }))
    const queued = await invoke(['--cli', 'actual-a', 'reply', replyArgs], a.env)
    assert.equal(queued.code, 0)
    const queuedReply = JSON.parse(queued.stdout).result
    assert.equal(queuedReply.toSessionId, 'actual-plain')
    assert.equal(queuedReply.replyTo, receivedPlain.id)
    assert.equal(JSON.parse((await invoke(['--cli', 'actual-a', 'reply', replyArgs], a.env)).stdout).result.id, queuedReply.id)
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'mailbox.json'), 'utf8')).messages.filter(x => x.id === queuedReply.id).length, 1)
    const replyHook = await invoke(['--hook', 'actual-plain', 'PostToolUse'], plainEnv)
    assert.match(replyHook.stdout, /1 pending messages/)
    assert.match(replyHook.stdout, /--cli actual-plain reply/)
    const plainInbox = JSON.parse((await invoke(['--cli', 'actual-plain', 'receive'], plainEnv)).stdout).result
    assert.equal(plainInbox[0].body, '훅으로 답장')
    assert.equal(plainInbox[0].fromSessionId, 'actual-a')
    // Sending a message does not make it part of the sender's received mailbox.
    assert.equal((await tool(a, 'reply', { messageId: sent.id, body: 'unauthorized', requestKey: 'invalid-reply' })).isError, true)
    const roundTripFile = path.join(root, 'round-trip.json')
    fs.writeFileSync(roundTripFile, JSON.stringify({ messageId: queuedReply.id, body: '답장 수신 확인', requestKey: 'round-trip' }))
    const roundTrip = JSON.parse((await invoke(['--cli', 'actual-plain', 'reply', roundTripFile], plainEnv)).stdout).result
    assert.equal(roundTrip.toSessionId, 'actual-a')
    assert.equal(JSON.parse((await tool(a, 'receive')).content[0].text)[0].id, roundTrip.id)
    await tool(a, 'acknowledge', { messageId: roundTrip.id, completed: true })
    const hook = spawn(process.execPath, [bridge, '--hook', 'actual-b', 'PostToolUse'], { env: b.env, windowsHide: true })
    let hookOutput = ''; hook.stdout.on('data', data => { hookOutput += data })
    await timeout(new Promise(resolve => hook.on('exit', resolve)))
    assert.match(JSON.parse(hookOutput).hookSpecificOutput.additionalContext, /1 pending messages/)
    const reply = JSON.parse((await tool(b, 'reply', { messageId: sent.id, body: '검토 완료', requestKey: 'reply' })).content[0].text)
    assert.equal(reply.replyTo, sent.id)
    await tool(b, 'acknowledge', { messageId: sent.id, completed: true })
    mailbox = new SessionMailbox(path.join(root, 'mailbox.json'))
    assert.equal((await tool(a, 'receive')).isError, true)
    a.register(); b.register()
    assert.equal(JSON.parse((await tool(a, 'receive')).content[0].text)[0].id, reply.id)
    mailbox.close('actual-b')
    assert.equal(JSON.parse((await tool(a, 'send', { toSessionId: 'actual-b', body: 'late', requestKey: 'two' })).content[0].text).wake.reason, 'no-tab')
    assert.equal((await tool(a, 'send', { slot: 2 })).isError, true)
    fs.writeFileSync(path.join(root, 'port'), '1')
    fs.writeFileSync(path.join(root, 'navigation-context.txt'), 'STALE SLOT MUST NOT BE USED')
    const offline = await invoke(['--hook', 'actual-plain', 'UserPromptSubmit'], plainEnv)
    assert.match(offline.stdout, /live UI snapshot unavailable/)
    assert.ok(!offline.stdout.includes('STALE SLOT MUST NOT BE USED'))
    console.log('PASS: two real MCP stdio processes, TCP send/receive/reply, hook additionalContext, disk restart, closed-session queue and no slot addressing')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
    children.forEach(child => child.kill())
    server.close()
    setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 150)
})
