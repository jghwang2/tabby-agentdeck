import * as fs from 'fs'
import * as path from 'path'
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'

export interface MailSession { sessionId: string; name: string; cwd: string; active: boolean }
export interface MailMessage {
    id: string; fromSessionId: string; toSessionId: string; body: string
    requestKey: string; replyTo?: string; createdAt: number; readAt?: number; completedAt?: number
}
interface Store { version: 1; sessions: Array<MailSession & { token: string }>; messages: MailMessage[] }

/** A single owner (the Tabby hook receiver) serializes durable mailbox writes. */
export class SessionMailbox {
    private data: Store = { version: 1, sessions: [], messages: [] }
    private committed = JSON.stringify(this.data)
    constructor (private file: string) {
        if (fs.existsSync(file)) {
            const value = JSON.parse(fs.readFileSync(file, 'utf8'))
            if (value.version !== 1 || !Array.isArray(value.sessions) || !Array.isArray(value.messages)) {
                throw new Error('Unsupported mailbox store')
            }
            this.data = value
            this.data.sessions.forEach(session => { session.active = false })
        }
        this.committed = JSON.stringify(this.data)
    }

    private save (): void {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true })
            const temp = this.file + '.tmp'
            const next = JSON.stringify(this.data)
            fs.writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600 })
            fs.renameSync(temp, this.file)
            this.committed = next
        } catch (error) {
            // A failed save must not make a later retry look durably delivered.
            this.data = JSON.parse(this.committed)
            throw error
        }
    }

    register (sessionId: string, name: string, cwd: string): { sessionId: string; token: string } {
        if (!sessionId || sessionId.length > 256) { throw new Error('Invalid session ID') }
        let session = this.data.sessions.find(x => x.sessionId === sessionId)
        if (!session) {
            session = { sessionId, name, cwd, active: true, token: randomBytes(32).toString('hex') }
            this.data.sessions.push(session)
        } else { Object.assign(session, { name, cwd, active: true }) }
        this.save()
        return { sessionId, token: session.token }
    }

    close (sessionId: string): void {
        const session = this.data.sessions.find(x => x.sessionId === sessionId)
        if (session?.active) { session.active = false; this.save() }
    }

    call (sessionId: string, token: string, method: string, args: any = {}): unknown {
        const actor = this.data.sessions.find(x => x.sessionId === sessionId)
        const candidate = Buffer.from(typeof token === 'string' ? token : '')
        const expected = Buffer.from(actor?.token ?? '')
        if (!actor || !actor.active || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
            throw new Error('Session is inactive or credentials are invalid')
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) { throw new Error('Invalid arguments') }
        const allowed: Record<string, string[]> = {
            sessions: [], receive: [], send: ['toSessionId', 'body', 'requestKey', 'replyTo'],
            acknowledge: ['messageId', 'completed'],
        }
        if (!allowed[method] || Object.keys(args).some(key => !allowed[method].includes(key))) {
            throw new Error('Unknown method or argument; routing requires actual session IDs')
        }
        if (method === 'sessions') {
            return this.data.sessions.map(({ token: _token, ...session }) => session)
        }
        if (method === 'receive') {
            return this.data.messages.filter(x => x.toSessionId === sessionId && !x.completedAt).slice(0, 50)
        }
        if (method === 'acknowledge') {
            const message = this.data.messages.find(x => x.id === args.messageId && x.toSessionId === sessionId)
            if (!message) { throw new Error('Message not found in this session mailbox') }
            if (args.completed !== undefined && typeof args.completed !== 'boolean') { throw new Error('Invalid completion flag') }
            message.readAt ??= Date.now()
            if (args.completed) { message.completedAt ??= Date.now() }
            this.save()
            return message
        }
        if (typeof args.toSessionId !== 'string' || typeof args.body !== 'string' || !args.body.trim()
            || args.body.length > 32768 || typeof args.requestKey !== 'string' || !args.requestKey || args.requestKey.length > 128) {
            throw new Error('Provide toSessionId, body (1–32768 characters), and a stable requestKey (1–128 characters)')
        }
        const previous = this.data.messages.find(x => x.fromSessionId === sessionId && x.requestKey === args.requestKey)
        if (previous) {
            if (previous.toSessionId !== args.toSessionId || previous.body !== args.body || previous.replyTo !== args.replyTo) {
                throw new Error('requestKey already belongs to a different message')
            }
            return previous
        }
        if (!this.data.sessions.some(x => x.sessionId === args.toSessionId && x.active)) {
            throw new Error('Recipient session is not active')
        }
        if (args.replyTo !== undefined && !this.data.messages.some(x => x.id === args.replyTo
            && x.toSessionId === sessionId && x.fromSessionId === args.toSessionId)) {
            throw new Error('Reply must address the sender of a received message')
        }
        const message: MailMessage = {
            id: randomUUID(), fromSessionId: sessionId, toSessionId: args.toSessionId,
            body: args.body, requestKey: args.requestKey, createdAt: Date.now(),
            ...(args.replyTo !== undefined ? { replyTo: args.replyTo } : {}),
        }
        this.data.messages.push(message)
        this.save()
        return message
    }
}
