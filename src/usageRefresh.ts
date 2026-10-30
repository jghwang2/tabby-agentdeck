import { AccountQuota, AccountRequestError, fetchAccountQuotas, readAccounts } from './accounts'
import { cacheQuotas, getAccountQuotas, registerAccountSource } from './accountSession'
import { agentHome } from './storagePaths'
import { MetaInput } from './meta'

type LiveMeta = MetaInput & { ts?: number, configDir?: string }
interface RefreshState {
    busy: boolean
    message: string
    ts: number
    retryAt: number
    values?: AccountQuota[]
    task?: Promise<void>
}

export function quotaLimits (values: AccountQuota[]): NonNullable<MetaInput['limits']> {
    const limits: NonNullable<MetaInput['limits']> = {}
    for (const value of values) {
        if (value.remaining === undefined) { continue }
        const used = 100 - value.remaining
        if (value.label === '5시간') { limits.fiveHourPct = used; limits.fiveHourResetsAt = value.resetsAt }
        else if (value.label === '주간') { limits.sevenDayPct = used; limits.sevenDayResetsAt = value.resetsAt }
        else { limits.scopedName = value.label; limits.scopedPct = used; limits.scopedResetsAt = value.resetsAt }
    }
    return limits
}

/** Usage belongs to the provider/account/home, never to whichever tab is active when a request finishes. */
export class UsageRefresh {
    private states = new Map<string, RefreshState>()

    state (meta: LiveMeta | null): RefreshState | undefined {
        return meta ? this.states.get(this.key(meta)) : undefined
    }

    private key (meta: LiveMeta): string {
        return JSON.stringify([meta.agent, meta.account?.toLowerCase(), meta.configDir || ''])
    }

    merge (meta: LiveMeta | null): LiveMeta | null {
        const state = this.state(meta)
        if (!meta || !state?.values) { return meta }
        const limits = quotaLimits(state.values)
        // Later passive CLI values can update shared windows without losing API-only scoped limits.
        if (Number(meta.ts) > state.ts) {
            for (const [key, value] of Object.entries(meta.limits || {})) {
                if (value !== null && value !== undefined && value !== '') { (limits as any)[key] = value }
            }
        }
        return { ...meta, limits }
    }

    refresh (meta: LiveMeta): Promise<void> {
        if ((meta.agent !== 'claude' && meta.agent !== 'codex') || !meta.account) { return Promise.resolve() }
        const key = this.key(meta)
        const state = this.states.get(key) || { busy: false, message: '', ts: 0, retryAt: 0 }
        if (state.task) { return state.task }
        if (state.retryAt > Date.now()) { return Promise.resolve() }
        this.states.set(key, state)
        state.busy = true; state.message = ''
        const provider = meta.agent, id = meta.account
        const task = Promise.resolve().then(async () => {
            try {
                const saved = !meta.configDir && readAccounts().find(a => a.provider === provider && a.id.toLowerCase() === id.toLowerCase())
                if (saved && !meta.configDir) {
                    registerAccountSource(saved, meta.configDir)
                    const snapshot = await getAccountQuotas(saved, true)
                    state.values = snapshot.values; state.ts = snapshot.ts
                    if (snapshot.stale) { throw new AccountRequestError('temporary', '새 값을 받지 못했습니다. 이전 사용량을 표시합니다.') }
                } else {
                    state.values = await fetchAccountQuotas({ provider, id, key, name: id }, meta.configDir || agentHome(provider))
                    state.ts = Date.now()
                    // Share the result with the picker without registering accounts or copying credentials.
                    try {
                        const account = readAccounts().find(a => a.provider === provider && a.id.toLowerCase() === id.toLowerCase())
                        if (account) { cacheQuotas(account, state.values, state.ts) }
                    } catch { /* A picker storage error must not discard a successful live query. */ }
                }
                state.message = state.values.length ? '사용량을 갱신했습니다.' : '사용량 정보 없음'
                state.retryAt = Date.now() + 3000
            } catch (error) {
                state.message = error instanceof AccountRequestError && error.kind === 'auth'
                    ? '로그인을 확인한 뒤 다시 시도하세요.' : '사용량을 갱신하지 못했습니다. 잠시 후 다시 시도하세요.'
                state.retryAt = Date.now() + (error instanceof AccountRequestError ? error.retryAfterMs : 60000)
            } finally { state.busy = false; state.task = undefined }
        })
        state.task = task
        return task
    }
}
