// Receiver-owned durable inbox. Only this process starts the business workers.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), { spawn } = require('node:child_process')
const { stateEvent } = require('./state.cjs')
const { createMetaProcessor } = require('./meta.cjs')
const { hookContext } = require('./context.cjs')
const { AliasActivity } = require('./aliasActivity.cjs')
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
class HookDispatcher {
    constructor (root, workerRoot = __dirname, services = {}) {
        this.root = root
        this.workerRoot = workerRoot
        this.inbox = path.join(root, 'hook-inbox')
        this.receipts = path.join(root, 'hook-receipts')
        this.active = new Map()
        this.tail = Promise.resolve()
        this.sessions = new Map()
        this.nextScan = 0
        this.nextPrune = 0
        this.pruning = false
        this.services = services
        this.metaProcessors = new Map()
        this.jobs = []
        this.jobTimer = null
        this.aliasActivity = new AliasActivity(root)
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
        if (this.services.authorize && !await this.services.authorize(event)) return { id: event.id, accepted: true, output: '' }
        // accept() durably saves before returning. State processing need not hold
        // the caller open; only the small context response shares its deadline.
        const pending = this.accept(event).catch(() => {})
        const context = event.kind === 'notify' && !event.hook.agent_id
            && ['UserPromptSubmit', 'PostToolUse'].includes(event.hook.hook_event_name)
        // Let an immediately runnable reducer register the session before reading
        // its mailbox. A blocked legacy ancestry worker still cannot hold context.
        await Promise.resolve()
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
        const session = event.hook.session_id || event.options?.SessionId || 'manual'
        // These workers write disjoint files. Keep ordering per record, not per
        // parent: a child's tool burst must not hold up its parent's Stop.
        const child = event.kind === 'notify' && (event.options?.Agent || 'claude') === 'claude' && event.hook.agent_id
        const key = JSON.stringify([session, event.kind, child ? 'child' : 'parent', child || ''])
        const previous = this.sessions.get(key) || Promise.resolve()
        const queuedAt = Date.now()
        const result = previous.catch(() => {}).then(async () => {
            // Arrival order can differ from event order after reconnect. The worker
            // also preserves child event timestamps; parent snapshots reject old events.
            const startedAt = Date.now()
            const output = await this.run(event)
            const reply = { id: event.id, accepted: true, output,
                timing: { queueMs: startedAt - queuedAt, workerMs: Date.now() - startedAt, eventAgeMs: Date.now() - event.ts } }
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
        } catch { /* Absent inbox is normal; next tick retries disk failures. */ }
        this.prune()
    }
    prune () {
        if (this.pruning || Date.now() < this.nextPrune) return
        this.nextPrune = Date.now() + 60000
        this.pruning = true
        // Never synchronously stat a day's receipts on the terminal UI thread.
        ;(async () => {
            const names = await fs.promises.readdir(this.receipts)
            for (const name of names) {
                try {
                    const file = path.join(this.receipts, name)
                    if ((await fs.promises.stat(file)).mtimeMs < Date.now() - 86400000) await fs.promises.unlink(file)
                } catch { /* A concurrent cleanup may already have removed it. */ }
            }
        })().catch(() => {}).finally(() => { this.pruning = false })
    }
    runningHeartbeat (event) {
        const h = event.hook, o = event.options || {}, agent = o.Agent || 'claude'
        // A narrow fast path for an already-known tab. Transitions, edits,
        // children and external-process identity still use the existing worker.
        if (event.kind !== 'notify' || h.hook_event_name !== 'PostToolUse' || h.agent_id
            || o.Subagent || o.Label || h.tool_input?.file_path || !event.env?.AGENTDECK_TAB
            || (agent !== 'claude' && agent !== 'codex') || (o.Status && o.Status !== 'running')) return null
        if (agent === 'claude' && o.Status !== 'running') return null
        const file = path.join(this.root, 'status', h.session_id + '.json')
        let prev
        try { prev = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
        if (prev.status !== 'running' || prev.agent !== agent || prev.tabId !== event.env.AGENTDECK_TAB
            || prev.cwd !== h.cwd || prev.ts >= event.ts) return null
        const payload = { sessionId: h.session_id, ts: event.ts, agent, identityRequired: true,
            status: 'running', tabId: event.env.AGENTDECK_TAB }
        if (h.cwd) payload.cwd = h.cwd
        if (Array.isArray(prev.agents) && prev.agents.length) payload.agents = prev.agents
        const tmp = file + '.' + event.id + '.tmp'
        try {
            fs.writeFileSync(tmp, JSON.stringify(payload)); fs.renameSync(tmp, file)
        } catch (error) {
            try { fs.unlinkSync(tmp) } catch {}
            throw error
        }
        return payload
    }
    report (payload) {
        if (this.services.report) return Promise.resolve(this.services.report(payload))
        return new Promise(resolve => {
            let socket
            const finish = () => { clearTimeout(timer); socket?.destroy(); resolve() }
            const timer = setTimeout(finish, 200)
            try {
                const port = Number(fs.readFileSync(path.join(this.root, 'port'), 'utf8'))
                socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end(JSON.stringify(payload) + '\n'))
                socket.on('error', finish); socket.on('close', finish)
            } catch { finish() }
        })
    }
    async run (event, contextOnly = false) {
        if (this.services.authorize && !await this.services.authorize(event)) return ''
        if (!contextOnly) await this.aliasActivity.touch(event.env?.AGENTDECK_TAB, event.ts)
        if (contextOnly) return this.schedule(() => hookContext(event, this.root, this.workerRoot,
            payload => this.services.request ? this.services.request(payload) : this.request(payload)))
        if (event.kind === 'statusline') return this.schedule(() => {
            const key = event.env?.CLAUDE_CONFIG_DIR || ''
            let processor = this.metaProcessors.get(key)
            if (!processor) {
                processor = createMetaProcessor(this.root, { ...process.env, CLAUDE_CONFIG_DIR: key })
                this.metaProcessors.set(key, processor)
            }
            processor.writeSnapshot(Buffer.from(JSON.stringify(event.hook)), event.ts)
            return ''
        })
        const result = await this.schedule(() => {
            const reduced = stateEvent(this.root, event)
            if (reduced.payload && this.services.report) this.services.report(reduced.payload)
            return reduced
        })
        if (result.handled) {
            if (result.payload && !this.services.report) await this.report(result.payload)
            return ''
        }
        return this.runLegacy(event)
    }
    schedule (work) {
        return new Promise((resolve, reject) => {
            this.jobs.push({ work, resolve, reject })
            if (this.jobTimer === null) this.jobTimer = setTimeout(() => this.drainJobs(), 0)
        })
    }
    drainJobs () {
        this.jobTimer = null
        const start = performance.now()
        do {
            const job = this.jobs.shift()
            try { job.resolve(job.work()) } catch (error) { job.reject(error) }
        } while (this.jobs.length && performance.now() - start < 4)
        if (this.jobs.length) this.jobTimer = setTimeout(() => this.drainJobs(), 0)
    }
    request (payload) {
        return new Promise((resolve, reject) => {
            let socket, text = '', settled = false
            const finish = (error, value) => {
                if (settled) return
                settled = true; clearTimeout(timer); socket?.destroy()
                error ? reject(error) : resolve(value)
            }
            const timer = setTimeout(() => finish(new Error('Context deadline')), 1000)
            try {
                const port = Number(fs.readFileSync(path.join(this.root, 'port'), 'utf8'))
                socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.write(JSON.stringify(payload) + '\n'))
                socket.setEncoding('utf8')
                socket.on('error', error => finish(error))
                socket.on('end', () => finish(new Error('Context connection closed')))
                socket.on('data', chunk => {
                    text += chunk
                    if (text.length > 4194304) return finish(new Error('Context response too large'))
                    if (!text.includes('\n')) return
                    try { finish(null, JSON.parse(text.split('\n')[0])) } catch (error) { finish(error) }
                })
            } catch (error) { finish(error) }
        })
    }
    runLegacy (event, contextOnly = false) {
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
