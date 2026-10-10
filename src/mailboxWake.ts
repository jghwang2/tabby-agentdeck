export const MAILBOX_WAKE_TEXT = '[agentdeck] 새 메시지 {N}건 도착  receive 로 확인하고 acknowledge 할 것'
export type WakeReason = 'no-tab' | 'busy-deferred' | 'typing-deferred' | 'disabled' | 'sent' | 'reply-queued'
export interface WakeResult { attempted: boolean; delivered: boolean; reason: WakeReason }
export interface WakeTarget {
    identity: object
    enabled: boolean
    idle: boolean
    lastInput: number
    composing: boolean
    typingGuardMs: number
    text: string
    send: (write: (sendInput: (text: string) => void) => void) => void
}
interface PendingWake { ids: Set<string>; writing: boolean; timer?: ReturnType<typeof setTimeout> }

/** Event driven: busy/disabled queues have no timer; typing uses one deadline. */
export class MailboxWake {
    private pendingWake = new Map<string, PendingWake>()
    private results = new Map<string, WakeResult>()
    constructor (
        private resolve: (sessionId: string) => WakeTarget | null,
        private log: (line: string) => void,
    ) {}

    enqueue (message: { id: string; toSessionId: string; completedAt?: number }): WakeResult {
        const previous = this.results.get(message.id)
        if (previous) { return { ...previous } }
        if (message.completedAt) { return { attempted: false, delivered: false, reason: 'no-tab' } }
        const result: WakeResult = { attempted: false, delivered: false, reason: 'typing-deferred' }
        this.results.set(message.id, result)
        let pending = this.pendingWake.get(message.toSessionId)
        if (!pending) {
            pending = { ids: new Set(), writing: false }
            this.pendingWake.set(message.toSessionId, pending)
        }
        pending.ids.add(message.id)
        this.flush(message.toSessionId)
        return { ...result }
    }

    flushAll (): void {
        for (const sessionId of this.pendingWake.keys()) { this.flush(sessionId) }
    }

    private reason (target: WakeTarget | null): WakeReason {
        if (!target) { return 'no-tab' }
        if (!target.enabled) { return 'disabled' }
        if (!target.idle) { return 'busy-deferred' }
        if (target.composing || Date.now() - target.lastInput < target.typingGuardMs) { return 'typing-deferred' }
        return 'sent'
    }

    private record (sessionId: string, pending: PendingWake, reason: WakeReason): void {
        for (const id of pending.ids) {
            Object.assign(this.results.get(id)!, { attempted: reason === 'sent', delivered: reason === 'sent', reason })
        }
        this.log(`mailbox-wake to=${JSON.stringify(sessionId)} n=${pending.ids.size} reason=${reason}`)
    }

    flush (sessionId: string): void {
        const pending = this.pendingWake.get(sessionId)
        if (!pending || pending.writing) { return }
        if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined }
        const target = this.resolve(sessionId)
        const reason = this.reason(target)
        if (reason !== 'sent') {
            this.record(sessionId, pending, reason)
            if (reason === 'no-tab') { this.pendingWake.delete(sessionId) }
            if (reason === 'typing-deferred' && !target!.composing) {
                pending.timer = setTimeout(() => this.flush(sessionId),
                    Math.max(1, target!.typingGuardMs - (Date.now() - target!.lastInput)))
            }
            return
        }
        pending.writing = true
        // A wrapper may defer for IME. Recheck every condition at the actual write.
        try {
            target!.send(sendInput => {
                const current = this.resolve(sessionId)
                const nowReason = current?.identity !== target!.identity ? 'no-tab' : this.reason(current)
                if (nowReason !== 'sent') {
                    pending.writing = false
                    if (nowReason === 'no-tab') {
                        this.record(sessionId, pending, nowReason)
                        this.pendingWake.delete(sessionId)
                    } else { this.flush(sessionId) }
                    return
                }
                const text = (current!.text || MAILBOX_WAKE_TEXT).replace(/\{N\}/g, String(pending.ids.size))
                    .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ')
                try {
                    sendInput(text + '\r')
                    this.record(sessionId, pending, 'sent')
                } catch {
                    this.record(sessionId, pending, 'no-tab')
                }
                this.pendingWake.delete(sessionId)
            })
        } catch {
            pending.writing = false
            this.record(sessionId, pending, 'no-tab')
            this.pendingWake.delete(sessionId)
        }
    }

}
