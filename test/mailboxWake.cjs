const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MailboxWake, MAILBOX_WAKE_TEXT } = require('../.tmp/mailboxWake')
const { SessionMailbox } = require('../.tmp/sessionMailbox')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run () {
    const writes = [], logs = []
    let target = { identity: {}, enabled: true, idle: true, lastInput: 0, composing: false,
        typingGuardMs: 40, text: MAILBOX_WAKE_TEXT, send: write => write(text => writes.push(text)) }
    const wake = new MailboxWake(() => target, line => logs.push(line))
    let id = 0
    const send = () => wake.enqueue({ id: String(++id), toSessionId: 'recipient' })
    assert.deepEqual(send(), { attempted: true, delivered: true, reason: 'sent' })
    assert.equal(writes[0], MAILBOX_WAKE_TEXT.replace('{N}', '1') + '\r')
    assert.equal(wake.enqueue({ id: '1', toSessionId: 'recipient' }).delivered, true)
    assert.equal(wake.enqueue({ id: '1', toSessionId: 'recipient', completedAt: Date.now() }).delivered, true)
    assert.equal(wake.enqueue({ id: 'completed-before-reload', toSessionId: 'recipient', completedAt: Date.now() }).delivered, false)
    assert.equal(writes.length, 1)
    target.idle = false
    assert.equal(send().reason, 'busy-deferred')
    assert.equal(send().reason, 'busy-deferred')
    assert.equal(wake.pendingWake.get('recipient').timer, undefined)
    target.idle = true
    wake.flushAll()
    assert.equal(writes.length, 2)
    assert.match(writes[1], /2건/)
    target.lastInput = Date.now()
    assert.equal(send().reason, 'typing-deferred')
    await wait(25)
    target.lastInput = Date.now()
    wake.flushAll()
    await wait(25)
    assert.equal(writes.length, 2)
    await wait(35)
    assert.equal(writes.length, 3)
    target.enabled = false
    assert.equal(send().reason, 'disabled')
    assert.equal(wake.pendingWake.get('recipient').timer, undefined)
    target.enabled = true
    wake.flushAll()
    assert.equal(writes.length, 4)
    target.composing = true
    assert.equal(send().reason, 'typing-deferred')
    assert.equal(wake.pendingWake.get('recipient').timer, undefined)
    target.composing = false
    wake.flushAll()
    assert.equal(writes.length, 5)
    const open = target
    target = null
    assert.equal(send().reason, 'no-tab')
    assert.equal(wake.pendingWake.size, 0)
    target = open
    target.text = 'line\n{N}\r\x1b[0m'
    send()
    assert.equal(writes.at(-1).split('\r').length, 2)
    assert.ok(!writes.at(-1).includes('\n'))
    assert.ok(!writes.at(-1).includes('\x1b'))
    let deferred
    target.send = write => { deferred = write }
    assert.equal(send().delivered, false)
    target.idle = false
    deferred(text => writes.push(text))
    assert.equal(wake.pendingWake.get('recipient').writing, false)
    target.idle = true
    wake.flushAll()
    target = { ...target, identity: {} }
    deferred(() => { throw new Error('Must not write to a replacement pane') })
    assert.equal(wake.pendingWake.size, 0)
    target.send = write => write(() => { throw new Error('PTY closed') })
    assert.equal(send().delivered, false)
    assert.equal(wake.pendingWake.size, 0)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-wake-'))
    try {
        let calls = 0
        const box = new SessionMailbox(path.join(dir, 'mail.json'), message => {
            calls++
            const saved = JSON.parse(fs.readFileSync(path.join(dir, 'mail.json')))
            assert.ok(saved.messages.some(m => m.id === message.id))
            return wake.enqueue(message)
        })
        const a = box.register('a', 'a', '/')
        const request = { toSessionId: 'unregistered', body: 'SECRET BODY', requestKey: 'one' }
        const rename = fs.renameSync
        try {
            fs.renameSync = () => { throw new Error('disk failed') }
            assert.throws(() => box.call(a.sessionId, a.token, 'send', request), /disk failed/)
            assert.equal(calls, 0)
        } finally { fs.renameSync = rename }
        target = null
        assert.equal(box.call(a.sessionId, a.token, 'send', request).wake.reason, 'no-tab')
        assert.equal(calls, 1)
        assert.ok(!logs.join('\n').includes('SECRET BODY'))
        const b = box.register('unregistered', 'b', '/')
        assert.equal(box.call(b.sessionId, b.token, 'receive').length, 1)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    console.log('PASS mailbox wake: durable write, idle, coalescing, busy, typing deadline/reset, IME, disabled, no-tab, retry, replacement, PTY failure, single Enter, body-free diagnostics')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
