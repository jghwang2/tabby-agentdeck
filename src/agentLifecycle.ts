/** Hook identity is (parent session, agent id), never the order of creation. */
export const AGENT_IDLE_TIMEOUT_MS = 15 * 60 * 1000
export const AGENT_RECONCILE_MS = 30 * 1000
export interface AgentEvent { id: string; type: string; action: 'active' | 'stop'; ts: number }
export const validAgentKey = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)

export class AgentLifecycle {
    private events = new Map<string, AgentEvent>()

    accept (input: AgentEvent, now = Date.now()): boolean {
        if (!input || !validAgentKey(input.id) || !['active', 'stop'].includes(input.action)
            || !Number.isFinite(input.ts) || input.ts <= 0 || input.ts > now + 60000) { return false }
        this.prune(now)
        // An expired durable hook still establishes that hooks own this session,
        // but must not repopulate history or revive a transcript fallback.
        if (now - input.ts >= AGENT_IDLE_TIMEOUT_MS) { return true }
        const prev = this.events.get(input.id)
        // Disk replay and TCP can arrive in either order. A stop wins an exact tie.
        if (prev && (prev.ts > input.ts || (prev.ts === input.ts
            && (prev.action === 'stop' || input.action === prev.action)))) { return false }
        this.events.set(input.id, { id: input.id, action: input.action, ts: input.ts,
            type: typeof input.type === 'string' ? input.type.slice(0, 120) : prev?.type || '' })
        return true
    }

    active (now = Date.now()): AgentEvent[] {
        this.prune(now)
        return [...this.events.values()].filter(e => e.action === 'active' && now - e.ts < AGENT_IDLE_TIMEOUT_MS)
    }

    private prune (now: number): void {
        for (const [id, event] of this.events) {
            if (now - event.ts >= AGENT_IDLE_TIMEOUT_MS) { this.events.delete(id) }
        }
    }
}
