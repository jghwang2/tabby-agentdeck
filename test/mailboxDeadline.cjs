const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-deadline-'))
const bridge = path.resolve(__dirname, '../hooks/agentdeck-mailbox.mjs')
const env = { ...process.env, AGENTDECK_TAB: 'test-pane', AGENTDECK_MAILBOX_ROOT: root }
fs.mkdirSync(path.join(root, 'mailbox-connections'))
fs.writeFileSync(path.join(root, 'mailbox-connections/test-pane.json'), JSON.stringify({ sessionId: 'test-session', token: 'fixture' }))
fs.writeFileSync(path.join(root, 'mailbox-connections/test-pane.client'), 'fixture')

async function check (trickle) {
    const sockets = new Set()
    const server = net.createServer(socket => {
        sockets.add(socket)
        socket.on('error', () => {})
        const timer = setInterval(() => { if (trickle) socket.write(' ') }, 50)
        socket.on('close', () => { clearInterval(timer); sockets.delete(socket) })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    const start = Date.now()
    const child = spawn(process.execPath, [bridge, '--hook', 'test-session', 'PostToolUse'], {
        env: { ...env, AGENTDECK_HOOK_DEADLINE: String(Date.now() + 500) }, windowsHide: true,
    })
    let stdout = ''
    child.stdout.on('data', data => { stdout += data })
    try {
        const code = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); reject(new Error('hook exceeded hard deadline')) }, 2500)
            child.on('error', reject)
            child.on('exit', code => { clearTimeout(timer); resolve(code) })
        })
        assert.equal(code, 0)
        assert.equal(stdout, '') // Do not emit a partial context JSON document.
        assert.ok(Date.now() - start < 2000)
        console.log(`PASS ${trickle ? 'trickling' : 'silent'} receiver: clean exit within deadline`)
    } finally {
        sockets.forEach(socket => socket.destroy())
        await new Promise(resolve => server.close(resolve))
    }
}

check(false).then(() => check(true)).catch(error => {
    console.error(error)
    process.exitCode = 1
})
