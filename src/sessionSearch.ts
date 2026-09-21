import { Worker } from 'worker_threads'
import { ChildProcess, spawn } from 'child_process'
import { SessionRecord } from './sessionLedger'

export interface HistorySource {
    file: string
    sessionId: string
    agent: 'claude' | 'codex'
}
export interface HistoryMessage { role: 'user' | 'assistant', text: string, line: number }
export interface HistoryHit {
    source: HistorySource
    record: SessionRecord
    snippet: string
    count: number
    line: number
}
export interface HistorySearchResult {
    hits: HistoryHit[]
    checked: number
    unreadable: number
    malformed: number
}

// Kept as plain worker source: webpack must not rewrite its Node require calls.
const workerSource = String.raw`
const { parentPort, workerData } = require('worker_threads')
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const readline = require('readline'), zlib = require('zlib'), util = require('util')
const gzip = util.promisify(zlib.gzip), gunzip = util.promisify(zlib.gunzip)
const normalize = text => String(text || '').toLowerCase()
function message(rec, agent) {
    if (rec.isMeta || rec.isSidechain) return null
    let role, content
    if (agent === 'codex') {
        // response_item is the canonical message; event_msg repeats it.
        if (rec.type !== 'response_item' || rec.payload?.type !== 'message') return null
        role = rec.payload.role; content = rec.payload.content
    } else {
        if (rec.type !== 'user' && rec.type !== 'assistant') return null
        role = rec.message?.role || rec.type; content = rec.message?.content
    }
    if (role !== 'user' && role !== 'assistant') return null
    const text = typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter(b => ['text','input_text','output_text'].includes(b?.type) && typeof b.text === 'string').map(b => b.text).join('\n') : ''
    if (!text.trim()) return null
    if (role === 'user' && /^(?:\s*<(?:system-reminder|environment_context|task-notification|command-name|local-command|INSTRUCTIONS)|# AGENTS\.md instructions|Caveat:|\[Request interrupted|Your claude\.ai usage limit)/.test(text)) return null
    return { role, text }
}
async function read(source) {
    const stat = await fs.promises.stat(source.file)
    const stamp = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
    const id = crypto.createHash('sha256').update(source.agent + ':' + source.file).digest('hex')
    const cache = path.join(workerData.cacheDir, id + '.json.gz')
    try {
        const data = JSON.parse((await gunzip(await fs.promises.readFile(cache))).toString('utf8'))
        if (data.version === 1 && data.stamp === stamp) return data
    } catch {}
    const messages = [], ids = new Set()
    let cwd = null, label = '', line = 0, malformed = 0, subagent = false
    const stream = fs.createReadStream(source.file, { encoding: 'utf8' })
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
    try {
        for await (const raw of lines) {
            line++
            if (!raw.trim()) continue
            let rec
            try { rec = JSON.parse(raw) } catch { malformed++; continue }
            if (rec.type === 'session_meta' && rec.payload?.source?.subagent) subagent = true
            if (!cwd) cwd = rec.cwd || (rec.type === 'session_meta' ? rec.payload?.cwd : null) || null
            const msg = message(rec, source.agent)
            if (!msg) continue
            const key = rec.uuid || rec.id
            if (key && ids.has(key)) continue
            if (key) ids.add(key)
            if (!label && msg.role === 'user') label = msg.text.replace(/\s+/g,' ').slice(0,140)
            messages.push({ ...msg, line })
        }
    } finally { lines.close(); stream.destroy() }
    const data = { version: 1, stamp, messages, cwd, label, lastSeen: stat.mtimeMs, malformed, subagent }
    // A growing transcript is retried on the next query. Never cache a partial append.
    const after = await fs.promises.stat(source.file)
    if ([after.size,after.mtimeMs,after.ctimeMs].join(':') === stamp && !malformed) {
        const temp = cache + '.' + process.pid + '.' + crypto.randomBytes(5).toString('hex') + '.tmp'
        try {
            await fs.promises.mkdir(workerData.cacheDir, { recursive: true, mode: 0o700 })
            await fs.promises.writeFile(temp, await gzip(JSON.stringify(data)), { mode: 0o600 })
            await fs.promises.rename(temp, cache)
        } catch {} finally { await fs.promises.unlink(temp).catch(() => {}) }
    }
    return data
}
function snippet(text, query) {
    const at = normalize(text).indexOf(query)
    const start = Math.max(0, at - 65)
    return (start ? '…' : '') + text.slice(start,start+240).replace(/\s+/g,' ') + (text.length > start+240 ? '…' : '')
}
async function run() {
    if (workerData.op === 'preview') {
        const data = await read(workerData.sources[0])
        const center = Math.max(0,data.messages.findIndex(m => m.line === workerData.line))
        // Page the conversation around the match instead of sending megabytes to the UI.
        const start = Math.max(0,center-2), end = Math.min(data.messages.length,center+4)
        parentPort.postMessage({ done:true, value:{ messages:data.messages.slice(start,end), total:data.messages.length,
            previous:start > 0 ? data.messages[Math.max(0,start-3)].line : null,
            next:end < data.messages.length ? data.messages[end].line : null } })
        return
    }
    const q = normalize(workerData.query), hits = []
    let checked = 0, unreadable = 0, malformed = 0
    for (const source of workerData.sources) {
        try {
            const data = await read(source)
            malformed += data.malformed
            if (!data.subagent) {
                const matches = data.messages.filter(m => normalize(m.text).includes(q))
                const metadata = normalize([data.label,data.cwd,source.sessionId].join(' ')).includes(q)
                if (matches.length || metadata) {
                    const first = matches[0]
                    hits.push({source,record:{ agent:source.agent,sessionId:source.sessionId,cwd:data.cwd,label:data.label,
                        lastSeen:data.lastSeen,lastStatus:null,from:'head'}, count:matches.length,
                        line:first?.line || data.messages[0]?.line || 0,
                        snippet:first ? snippet(first.text,q) : data.cwd || source.sessionId })
                }
            }
        } catch { unreadable++ }
        checked++
        if (checked % 10 === 0) parentPort.postMessage({progress:checked,total:workerData.sources.length})
    }
    hits.sort((a,b)=>b.record.lastSeen-a.record.lastSeen || a.record.sessionId.localeCompare(b.record.sessionId))
    parentPort.postMessage({done:true,value:{hits,checked,unreadable,malformed}})
}
run().catch(e => parentPort.postMessage({error:String(e.message || e)}))
`

export class SessionSearch {
    private worker: Worker | ChildProcess | null = null
    private cancelPending: (() => void) | null = null
    constructor (private cacheDir: string, private subprocess = (process as any).type === 'renderer') {}

    private stop (worker: Worker | ChildProcess | null): void {
        if (!worker) { return }
        if ('terminate' in worker) { void worker.terminate() } else { worker.kill() }
    }

    cancel (): void {
        this.cancelPending?.()
        this.cancelPending = null
        this.stop(this.worker)
        this.worker = null
    }

    private run<T> (data: object, progress?: (done: number, total: number) => void): Promise<T> {
        this.cancel()
        return new Promise((resolve, reject) => {
            const job = { ...data, cacheDir: this.cacheDir }
            // Electron's renderer V8 platform cannot host Node worker_threads.
            // Tabby's executable also disables ELECTRON_RUN_AS_NODE. Use the Node
            // runtime provided by the CLI installation, without invoking a shell.
            const worker = this.subprocess
                ? spawn((process as any).type === 'renderer' ? 'node' : process.execPath, ['-e', workerSource.replace(
                    "const { parentPort, workerData } = require('worker_threads')",
                    "const parentPort = { postMessage: value => process.send(value) }; process.once('message', workerData => {",
                ) + '\n})'], { env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
                : new Worker(workerSource, { eval: true, workerData: job })
            this.worker = worker
            const finish = () => {
                if (this.worker === worker) { this.worker = null; this.cancelPending = null }
                this.stop(worker)
            }
            this.cancelPending = () => reject(new Error('Search cancelled'))
            worker.on('message', (msg: any) => {
                if (msg.progress !== undefined) { progress?.(msg.progress, msg.total) }
                if (msg.done) { finish(); resolve(msg.value) }
                if (msg.error) { finish(); reject(new Error(msg.error)) }
            })
            worker.on('error', error => { finish(); reject(error) })
            worker.on('exit', code => {
                if (this.worker === worker) { finish(); reject(new Error(`Search worker stopped (${code})`)) }
            })
            if ('send' in worker) {
                worker.send(job, error => { if (error) { finish(); reject(error) } })
            }
        })
    }

    search (sources: HistorySource[], query: string, progress?: (done: number, total: number) => void): Promise<HistorySearchResult> {
        if (!query.trim()) { this.cancel(); return Promise.resolve({hits:[],checked:0,unreadable:0,malformed:0}) }
        return this.run({op:'search',sources,query:query.trim()}, progress)
    }

    preview (source: HistorySource, line: number): Promise<{messages: HistoryMessage[], total: number, previous: number | null, next: number | null}> {
        return this.run({op:'preview',sources:[source],line})
    }
}
