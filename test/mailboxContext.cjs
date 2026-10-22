const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-context-'))
const hooks = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../receiver')
const title = '한글 탭 제목 · 새 메시지 😀'
let pending = [], receiveError = false, navigationError = false, disabled = false
const env = { ...process.env, AGENTDECK_TAB: 'context-pane', AGENTDECK_MAILBOX_ROOT: root,
    AGENTDECK_RUNTIME_ROOT: root, AGENTDECK_ACCOUNTS_FILE: path.join(root, 'accounts.json'),
    AGENTDECK_CONTEXT: '', AGENTDECK_HOOK_DEADLINE: '' }
fs.mkdirSync(path.join(root, 'mailbox-connections'))
fs.writeFileSync(path.join(root, 'mailbox-connections/context-pane.json'), JSON.stringify({ sessionId: 'context-session', token: 'fixture' }))
const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', data => {
        buffer += data
        if (!buffer.includes('\n')) return
        const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (disabled) {
            socket.end(JSON.stringify({ error: 'AgentDeck communication is disabled', code: 'COMMUNICATION_DISABLED' }) + '\n')
            return
        }
        if (request.channel === 'agentdeck-navigation') {
            socket.end(JSON.stringify(navigationError ? { error: 'offline' } : { result: {
                capturedAt: 'fixture', context: `Tab alias="테스트1": session IDs context-session; title="${title}"`,
            } }) + '\n')
        } else if (request.channel?.includes('mailbox')) {
            socket.end(JSON.stringify(receiveError ? { error: 'not registered' } : { result: pending }) + '\n')
        } else socket.end() // status report from the real PowerShell hook
    })
})
function run (command, args, extraEnv = {}, input = '') {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env: { ...env, ...extraEnv }, windowsHide: true })
        const chunks = [], errors = []
        child.stdout.on('data', data => chunks.push(data))
        child.stderr.on('data', data => errors.push(data))
        child.on('error', reject)
        const timer = setTimeout(() => { child.kill(); reject(new Error('hook timeout')) }, 10000)
        child.on('close', code => {
            clearTimeout(timer)
            if (code !== 0) return reject(new Error(Buffer.concat(errors).toString() || `exit ${code}`))
            const raw = Buffer.concat(chunks)
            resolve(raw.length ? JSON.parse(raw.toString('utf8')).hookSpecificOutput.additionalContext : '')
        })
        child.stdin.end(input)
    })
}
const hook = (event = 'UserPromptSubmit', extraEnv) => run(process.execPath,
    [path.join(hooks, 'agentdeck-mailbox.mjs'), '--hook', 'context-session', event], extraEnv)
async function main () {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fs.writeFileSync(path.join(root, 'port'), String(server.address().port))
    const minimal = await hook()
    assert.ok(!minimal.includes(title))
    assert.match(minimal, /--cli context-session context$/)
    assert.doesNotMatch(minimal, /CLI reply|agentdeck_reply/)
    assert.match(minimal, /context-session/)
    assert.equal(await hook('UserPromptSubmit', { AGENTDECK_CONTEXT: 'minimal' }), minimal)
    assert.equal(await hook('UserPromptSubmit', { AGENTDECK_CONTEXT: 'invalid' }), minimal)
    const full = await hook('UserPromptSubmit', { AGENTDECK_CONTEXT: ' FULL ' })
    assert.match(full, /CLI reply:.*--cli context-session reply/)
    assert.match(full, /Mailbox registered\. 0 pending/)
    assert.ok(full.length - minimal.length > 1500)
    assert.equal(await hook('PostToolUse'), '')
    assert.equal(await hook('PostToolUse', { AGENTDECK_CONTEXT: 'full' }), '')
    pending = [{ id: 'pending-fixture' }]
    disabled = true
    for (const event of ['UserPromptSubmit', 'PostToolUse']) {
        assert.equal(await hook(event), '')
        assert.equal(await hook(event, { AGENTDECK_CONTEXT: 'full' }), '')
        assert.equal(await hook(event, { AGENTDECK_TAB: '' }), '')
    }
    disabled = false
    for (const event of ['UserPromptSubmit', 'PostToolUse']) {
        const text = await hook(event)
        assert.match(text, /1 pending; read now/)
        assert.match(text, /--cli context-session context$/)
        assert.ok(!text.includes(title))
    }
    pending = []
    receiveError = true
    assert.match(await hook(), /Connection unconfirmed/)
    const external = await hook('UserPromptSubmit', { AGENTDECK_TAB: '' })
    assert.match(external, /--cli context-session context$/)
    receiveError = false
    navigationError = true
    assert.equal(await hook(), minimal)
    assert.match(await hook('UserPromptSubmit', { AGENTDECK_CONTEXT: 'full' }), /snapshot unavailable/)
    navigationError = false
    if (process.platform === 'win32') {
        // Force the Windows PowerShell 5.1 legacy output code page even on UTF-8 hosts.
        for (const script of ['agentdeck-notify.ps1', 'agentdeck-codex-notify.ps1']) {
            const file = path.join(hooks, script).replace(/'/g, "''")
            const args = script === 'agentdeck-notify.ps1' ? ' -Status running' : ''
            const text = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
                `[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(949); & '${file}'${args}`], { AGENTDECK_CONTEXT: 'full' },
                JSON.stringify({ session_id: 'context-session', hook_event_name: 'UserPromptSubmit', cwd: root }))
            assert.ok(text.includes(title), `${script}: Korean and emoji survive CP949 stdout: ${text}`)
            assert.match(text, /Mailbox registered\. 0 pending/)
            const state = JSON.parse(fs.readFileSync(path.join(root, 'status/context-session.json'), 'utf8').replace(/^\uFEFF/, ''))
            assert.equal(state.sessionId, 'context-session')
            assert.equal(state.status, 'running')
        }
    }
    console.log(`PASS mailbox context: empty/pending/full/unregistered/offline/PowerShell UTF-8; chars ${full.length} -> ${minimal.length}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => server.close())
