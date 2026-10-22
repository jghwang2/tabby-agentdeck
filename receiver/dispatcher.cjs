// Receiver-owned durable inbox. Only this process starts the business workers.
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process')
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
class HookDispatcher {
    constructor (root, workerRoot = __dirname) {
        this.root = root
        this.workerRoot = workerRoot
        this.inbox = path.join(root, 'hook-inbox')
        this.receipts = path.join(root, 'hook-receipts')
        this.active = new Map()
        this.tail = Promise.resolve()
        this.sessions = new Map()
        this.nextScan = 0
    }
    valid (event) {
        return event?.channel === 'agentdeck-hook' && validId(event.id)
            && ['notify', 'statusline'].includes(event.kind) && Number.isFinite(event.ts)
            && event.ts > Date.now() - 86400000 && event.ts < Date.now() + 60000
            && event.hook && (validId(event.hook.session_id) || (!event.hook.session_id &&
                (validId(event.options?.SessionId) || (event.kind === 'notify' && !event.hook.hook_event_name && event.options?.Agent === 'claude'))))
            && (!event.hook.agent_id || validId(event.hook.agent_id))
    }
    async submit (event) {
        if (!this.valid(event)) return { id: event?.id, accepted: false }
        // accept() durably saves before returning. State processing need not hold
        // the caller open; only the small context response shares its deadline.
        const pending = this.accept(event).catch(() => {})
        const context = event.kind === 'notify' && !event.hook.agent_id
            && ['UserPromptSubmit', 'PostToolUse'].includes(event.hook.hook_event_name)
        const output = context ? await this.run(event, true).catch(() => '') : ''
        // External callers lack a tab ID: retain the origin process until its
        // ancestry has been observed. Replayed events still require identity.
        if (event.kind === 'notify' && !event.env?.AGENTDECK_TAB) await pending
        return { id: event.id, accepted: true, output }
    }
    accept (event) {
        if (!this.valid(event)) return Promise.resolve({ id: event?.id, accepted: false })
        const receipt = path.join(this.receipts, event.id + '.json')
        try {
            const reply = JSON.parse(fs.readFileSync(receipt, 'utf8'))
            try { fs.unlinkSync(path.join(this.inbox, event.id + '.json')) } catch {}
            return Promise.resolve(reply)
        } catch {}
        if (this.active.has(event.id)) return this.active.get(event.id)
        fs.mkdirSync(this.inbox, { recursive: true })
        const file = path.join(this.inbox, event.id + '.json')
        const tmp = file + '.receiver.tmp'
        fs.writeFileSync(tmp, JSON.stringify(event)); fs.renameSync(tmp, file)
        const key = event.hook.session_id || event.options?.SessionId || 'manual'
        const previous = this.sessions.get(key) || Promise.resolve()
        const result = previous.catch(() => {}).then(async () => {
            // Arrival order can differ from event order after reconnect. The worker
            // also preserves child event timestamps; parent snapshots reject old events.
            const output = await this.run(event)
            const reply = { id: event.id, accepted: true, output }
            fs.mkdirSync(this.receipts, { recursive: true })
            const receiptTmp = receipt + '.tmp'
            fs.writeFileSync(receiptTmp, JSON.stringify(reply)); fs.renameSync(receiptTmp, receipt)
            fs.unlinkSync(file)
            return reply
        })
        this.sessions.set(key, result)
        this.tail = Promise.allSettled([...this.sessions.values()])
        this.active.set(event.id, result)
        result.finally(() => {
            this.active.delete(event.id)
            if (this.sessions.get(key) === result) this.sessions.delete(key)
        }).catch(() => {})
        return result
    }
    poll () {
        if (Date.now() < this.nextScan) return
        this.nextScan = Date.now() + 1000
        try {
            const events = fs.readdirSync(this.inbox).filter(n => n.endsWith('.json')).map(name => {
                try { return { name, event: JSON.parse(fs.readFileSync(path.join(this.inbox, name), 'utf8')) } }
                catch { return { name } }
            }).sort((a, b) => (a.event?.ts || 0) - (b.event?.ts || 0))
            for (const { name, event } of events) {
                if (!this.valid(event) || name !== event.id + '.json') {
                    fs.unlinkSync(path.join(this.inbox, name)); continue
                }
                this.accept(event).catch(() => {})
            }
            for (const name of fs.readdirSync(this.receipts)) {
                const file = path.join(this.receipts, name)
                if (fs.statSync(file).mtimeMs < Date.now() - 86400000) fs.unlinkSync(file)
            }
        } catch { /* Absent inbox is normal; next tick retries disk failures. */ }
    }
    run (event, contextOnly = false) {
        const env = { ...process.env, AGENTDECK_RUNTIME_ROOT: this.root,
            AGENTDECK_MAILBOX_ROOT: path.join(this.root, 'mailbox'),
            AGENTDECK_EVENT_TS: String(event.ts), AGENTDECK_ORIGIN_PID: String(event.pid || 0),
            AGENTDECK_CONTEXT_HANDLED: '1' }
        for (const key of ['AGENTDECK_TAB', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'AGENTDECK_CONTEXT'])
            env[key] = typeof event.env?.[key] === 'string' ? event.env[key] : ''
        const isMeta = event.kind === 'statusline'
        const options = event.options || {}
        const codex = options.Agent === 'codex' && !options.Status && !options.Subagent
        const script = contextOnly ? 'agentdeck-mailbox.mjs' : isMeta ? 'agentdeck-statusline.mjs' : codex ? 'agentdeck-codex-notify.ps1' : 'agentdeck-notify.ps1'
        const args = contextOnly ? [path.join(this.workerRoot, script), '--hook', event.hook.session_id, event.hook.hook_event_name]
            : isMeta ? [path.join(this.workerRoot, script)]
            : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.workerRoot, script)]
        if (!isMeta && !codex && !contextOnly) {
            for (const key of ['Agent', 'Status', 'Label', 'Subagent', 'SessionId', 'MaxLabel']) {
                if (options[key] !== undefined && options[key] !== '') args.push('-' + key, String(options[key]))
            }
        }
        return new Promise((resolve, reject) => {
            const child = spawn(isMeta || contextOnly ? 'node' : 'powershell.exe', args, { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] })
            let output = '', bytes = 0
            const timer = setTimeout(() => { child.kill(); reject(new Error('Receiver worker timeout')) }, contextOnly ? 1200 : 5000)
            child.stdout.setEncoding('utf8')
            child.stdout.on('data', b => { bytes += b.length; if (bytes < 262144) output += b })
            child.stderr.resume()
            child.on('error', error => { clearTimeout(timer); reject(error) })
            child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('Receiver worker failed')) })
            child.stdin.on('error', () => {})
            child.stdin.end(JSON.stringify(event.hook))
        })
    }
}
module.exports = { HookDispatcher }
