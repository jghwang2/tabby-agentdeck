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
        try {
            assert.equal(request.channel, 'agentdeck-mailbox')
            assert.equal(typeof request.sessionId, 'string')
            assert.equal(request.slot, undefined)
            socket.write(JSON.stringify({ result: mailbox.call(request.sessionId, request.token, request.method, request.arguments) }) + '\n')
        } catch (e) { socket.write(JSON.stringify({ error: e.message }) + '\n') }
    })
})
function client (pane, sid) {
    const env = { ...process.env, AGENTDECK_MAILBOX_ROOT: root, AGENTDECK_TAB: pane }
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
    const a = client('pane-a', 'actual-a'), b = client('pane-b', 'actual-b')
    for (const c of [a, b]) {
        const init = await c.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
        assert.equal(init.result.serverInfo.name, 'agentdeck-mailbox')
        c.register()
        const list = await c.call('tools/list')
        assert.equal(list.result.tools.length, 4)
        assert.ok(list.result.tools.every(tool => !JSON.stringify(tool.inputSchema).includes('slot')))
    }
    const tool = async (c, name, args = {}) => (await c.call('tools/call', { name: 'agentdeck_' + name, arguments: args })).result
    const sent = JSON.parse((await tool(a, 'send', { toSessionId: 'actual-b', body: '리뷰 부탁', requestKey: 'one' })).content[0].text)
    assert.equal(sent.fromSessionId, 'actual-a')
    assert.equal(JSON.parse((await tool(b, 'receive')).content[0].text)[0].id, sent.id)
    const hook = spawn(process.execPath, [bridge, '--hook', 'actual-b', 'PostToolUse'], { env: b.env, windowsHide: true })
    let hookOutput = ''; hook.stdout.on('data', data => { hookOutput += data })
    await timeout(new Promise(resolve => hook.on('exit', resolve)))
    assert.match(JSON.parse(hookOutput).hookSpecificOutput.additionalContext, /1 pending messages/)
    const reply = JSON.parse((await tool(b, 'send', { toSessionId: 'actual-a', body: '검토 완료', requestKey: 'reply', replyTo: sent.id })).content[0].text)
    assert.equal(reply.replyTo, sent.id)
    await tool(b, 'acknowledge', { messageId: sent.id, completed: true })
    mailbox = new SessionMailbox(path.join(root, 'mailbox.json'))
    assert.equal((await tool(a, 'receive')).isError, true)
    a.register(); b.register()
    assert.equal(JSON.parse((await tool(a, 'receive')).content[0].text)[0].id, reply.id)
    mailbox.close('actual-b')
    assert.equal((await tool(a, 'send', { toSessionId: 'actual-b', body: 'late', requestKey: 'two' })).isError, true)
    assert.equal((await tool(a, 'send', { slot: 2 })).isError, true)
    console.log('PASS: two real MCP stdio processes, TCP send/receive/reply, hook additionalContext, disk restart, closed-session error and no slot addressing')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
    children.forEach(child => child.kill())
    server.close()
    setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 150)
})
