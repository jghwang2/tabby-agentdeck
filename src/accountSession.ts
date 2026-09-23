import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { createHash } from 'crypto'
import { SavedAccount, AccountQuota, AccountRequestError, accountHome, accountEmail, readAccounts,
    restoreAccountAuth, saveAccountAuth, authenticateAccount, fetchAccountQuotas } from './accounts'
import { MetaInput } from './meta'
import { agentHome } from './storagePaths'

function read (file: string): any {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}
function write (file: string, data: any): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
    fs.renameSync(tmp, file)
}
const sources = new Map<string, Set<string>>()
const inFlight = new Map<string, Promise<void>>()
const saved = new Map<string, string>()
const quotaFlight = new Map<string, Promise<QuotaSnapshot>>()
const nextQuery = new Map<string, number>()
export interface QuotaSnapshot { values: AccountQuota[], ts: number, stale: boolean }

export function registerAccountSource (account: SavedAccount, home?: string): void {
    if (!home) { return }
    const set = sources.get(account.key) || new Set<string>()
    set.add(path.resolve(home)); sources.set(account.key, set)
}

function profileAt (home: string): any {
    return read(path.join(home, '.claude.json'))?.oauthAccount
        || (path.resolve(home) === path.resolve(path.join(os.homedir(), '.claude'))
            ? read(path.join(os.homedir(), '.claude.json'))?.oauthAccount : null)
}

/** Select only identity-checked credentials. A newer live CLI token wins over an old private copy. */
export function synchronizeClaudeAuth (account: SavedAccount): string {
    const dest = accountHome(account)
    if (account.provider !== 'claude') { return dest }
    const candidates = [...new Set([dest, ...(sources.get(account.key) || []),
        agentHome('claude'), ...(process.env.CLAUDE_CONFIG_DIR ? [process.env.CLAUDE_CONFIG_DIR] : []), path.join(os.homedir(), '.claude')])]
    const matching = candidates.map(home => ({ home, profile: profileAt(home), credentials: read(path.join(home, '.credentials.json')) }))
        .filter(x => String(x.profile?.emailAddress || '').toLowerCase() === account.id.toLowerCase() && x.credentials?.claudeAiOauth?.accessToken)
        .sort((a, b) => Number(b.credentials.claudeAiOauth.expiresAt || 0) - Number(a.credentials.claudeAiOauth.expiresAt || 0))
    const best = matching[0]
    if (!best) { return dest }
    const current = read(path.join(dest, '.credentials.json'))
    if (JSON.stringify(current) !== JSON.stringify(best.credentials)) {
        write(path.join(dest, '.credentials.json'), best.credentials)
    }
    if (String(profileAt(dest)?.emailAddress || '').toLowerCase() !== account.id.toLowerCase()) {
        const profile = read(path.join(dest, '.claude.json')) || {}
        profile.oauthAccount = best.profile
        write(path.join(dest, '.claude.json'), profile)
    }
    // Keep the live source as refresh owner when it holds the same token, so rotation isn't stranded in a copy.
    return matching.find(x => path.resolve(x.home) !== path.resolve(dest)
        && x.credentials.claudeAiOauth.accessToken === best.credentials.claudeAiOauth.accessToken)?.home || best.home
}

async function persistIfChanged (account: SavedAccount): Promise<void> {
    const credentials = read(path.join(accountHome(account), account.provider === 'claude' ? '.credentials.json' : 'auth.json'))
    if (!credentials) { return }
    const hash = createHash('sha256').update(JSON.stringify(credentials)).digest('hex')
    if (saved.get(account.key) === hash) { return }
    await saveAccountAuth(account)
    saved.set(account.key, hash)
}

// Endpoint and public client ID verified against the installed official Claude CLI (2026-09-18).
function refreshToken (refresh: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ grant_type: 'refresh_token', refresh_token: refresh, client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e' })
        const req = https.request('https://platform.claude.com/v1/oauth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000,
        }, res => {
            let output = ''
            res.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) { req.destroy() } })
            res.on('end', () => {
                let data: any
                try { data = JSON.parse(output) } catch { reject(new AccountRequestError('temporary', '인증 갱신 응답을 읽지 못했습니다.')); return }
                if (res.statusCode !== 200) {
                    reject(new AccountRequestError(data?.error === 'invalid_grant' || res.statusCode === 401 ? 'auth' : 'temporary',
                        '저장된 인증정보를 갱신하지 못했습니다.', res.statusCode)); return
                }
                if (typeof data.access_token !== 'string' || !data.access_token || !(Number(data.expires_in) > 0)) {
                    reject(new AccountRequestError('temporary', '인증 갱신 응답이 올바르지 않습니다.')); return
                }
                resolve(data)
            })
        })
        req.on('timeout', () => req.destroy())
        req.on('error', () => reject(new AccountRequestError('temporary', '인증 갱신 연결 실패')))
        req.on('close', () => reject(new AccountRequestError('temporary', '인증 갱신 연결 종료')))
        req.end(body)
    })
}

export function ensureAccountSession (account: SavedAccount, forceRefresh = false): Promise<void> {
    const active = inFlight.get(account.key)
    if (active) { return active }
    const task = (async () => {
        if (account.provider === 'claude') { synchronizeClaudeAuth(account) }
        await restoreAccountAuth(account)
        if (account.provider === 'codex') {
            await authenticateAccount(account)
            await persistIfChanged(account)
            return
        }
        let owner = synchronizeClaudeAuth(account)
        let file = path.join(owner, '.credentials.json')
        let credentials = read(file), oauth = credentials?.claudeAiOauth
        if (!oauth?.accessToken || accountEmail('claude', accountHome(account)).toLowerCase() !== account.id.toLowerCase()) {
            throw new AccountRequestError('auth', '저장된 로그인 정보가 없습니다.')
        }
        if (forceRefresh || Number(oauth.expiresAt) <= Date.now() + 5 * 60000) {
            // Serialize this app's refreshes across multiple Tabby processes; always re-read under the lease.
            const lock = path.join(owner, '.agentdeck-auth-refresh.lock')
            let fd: number
            try { fd = fs.openSync(lock, 'wx') } catch {
                try { if (Date.now() - fs.statSync(lock).mtimeMs > 60000) { fs.unlinkSync(lock) } } catch { /* next tick retries */ }
                throw new AccountRequestError('temporary', '인증 갱신 중입니다. 잠시 후 다시 시도합니다.')
            }
            try {
                owner = synchronizeClaudeAuth(account); file = path.join(owner, '.credentials.json')
                credentials = read(file); oauth = credentials?.claudeAiOauth
                if (forceRefresh || Number(oauth?.expiresAt) <= Date.now() + 5 * 60000) {
                    if (!oauth?.refreshToken) { throw new AccountRequestError('auth', '갱신 가능한 로그인 정보가 없습니다.') }
                    const data = await refreshToken(oauth.refreshToken)
                    if (data.account?.email_address && String(data.account.email_address).toLowerCase() !== account.id.toLowerCase()) {
                        throw new AccountRequestError('auth', '갱신 응답의 계정이 일치하지 않습니다.')
                    }
                    const latest = read(file)
                    // A CLI may have refreshed or logged into a different account while the request was pending.
                    if (latest?.claudeAiOauth?.accessToken === oauth.accessToken
                        && latest?.claudeAiOauth?.refreshToken === oauth.refreshToken
                        && String(profileAt(owner)?.emailAddress || '').toLowerCase() === account.id.toLowerCase()) {
                        latest.claudeAiOauth = { ...oauth, accessToken: data.access_token,
                            refreshToken: data.refresh_token || oauth.refreshToken, expiresAt: Date.now() + Number(data.expires_in) * 1000 }
                        write(file, latest)
                    }
                    synchronizeClaudeAuth(account)
                }
            } catch (error) {
                synchronizeClaudeAuth(account)
                const latest = read(path.join(accountHome(account), '.credentials.json'))?.claudeAiOauth
                // Another CLI's successful rotation can recover a rejected old refresh token.
                if (!latest || latest.accessToken === oauth?.accessToken || Number(latest.expiresAt) <= Date.now()) { throw error }
            } finally { fs.closeSync(fd); try { fs.unlinkSync(lock) } catch { /* lease already removed */ } }
        }
        await persistIfChanged(account)
    })().finally(() => inFlight.delete(account.key))
    inFlight.set(account.key, task)
    return task
}

function cacheFile (account: SavedAccount): string { return path.join(accountHome(account), 'usage.json') }
export function cachedAccountQuotas (account: SavedAccount): QuotaSnapshot | null {
    const cache = read(cacheFile(account))
    return cache?.id === account.id.toLowerCase() && cache?.provider === account.provider && Array.isArray(cache.values)
        ? { values: cache.values, ts: cache.ts, stale: Date.now() - cache.ts > 120000 } : null
}
function cacheQuotas (account: SavedAccount, values: AccountQuota[], ts = Date.now()): QuotaSnapshot {
    const prev = cachedAccountQuotas(account)
    if (prev && prev.ts > ts) { return prev }
    write(cacheFile(account), { provider: account.provider, id: account.id.toLowerCase(), values, ts })
    return { values, ts, stale: Date.now() - ts > 120000 }
}

export function recordAccountUsage (account: SavedAccount, meta: MetaInput & { ts?: number, configDir?: string }): void {
    if (meta.agent !== account.provider || meta.account?.toLowerCase() !== account.id.toLowerCase()) { return }
    registerAccountSource(account, meta.configDir)
    const ts = Number(meta.ts)
    if (!Number.isFinite(ts) || ts <= 0 || ts > Date.now() + 60000 || (cachedAccountQuotas(account)?.ts || 0) >= ts) { return }
    const lim = meta.limits, values: AccountQuota[] = []
    for (const [label, pct, reset] of [
        ['5시간', lim?.fiveHourPct, lim?.fiveHourResetsAt], ['주간', lim?.sevenDayPct, lim?.sevenDayResetsAt],
        [lim?.scopedName, lim?.scopedPct, lim?.scopedResetsAt],
    ] as [string | undefined, number | null | undefined, number | undefined][]) {
        if (label && typeof pct === 'number' && Number.isFinite(pct)) {
            values.push({ label, remaining: 100 - Math.max(0, Math.min(100, pct)), ...(reset ? { resetsAt: reset } : {}) })
        }
    }
    if (values.length) { cacheQuotas(account, values, ts) }
}

export function getAccountQuotas (account: SavedAccount): Promise<QuotaSnapshot> {
    const existing = quotaFlight.get(account.key)
    if (existing) { return existing }
    const run = (async () => {
        try { await ensureAccountSession(account) } catch (error) {
            const cached = cachedAccountQuotas(account)
            if (cached && !(error instanceof AccountRequestError && error.kind === 'auth')) { return { ...cached, stale: true } }
            throw error
        }
        const cache = cachedAccountQuotas(account)
        if (cache && !cache.stale) { return cache }
        const retryFile = path.join(accountHome(account), 'usage-retry.json')
        const blockedUntil = Math.max(nextQuery.get(account.key) || 0, Number(read(retryFile)?.until) || 0)
        if (blockedUntil > Date.now()) {
            if (cache) { return { ...cache, stale: true } }
            throw new AccountRequestError('temporary', '사용량 조회 제한 · 잠시 후 자동 갱신', 429, blockedUntil - Date.now())
        }
        try {
            let values: AccountQuota[]
            try { values = await fetchAccountQuotas(account) } catch (error) {
                if (!(error instanceof AccountRequestError) || error.status !== 401 || account.provider !== 'claude') { throw error }
                await ensureAccountSession(account, true)
                values = await fetchAccountQuotas(account)
            }
            return cacheQuotas(account, values)
        } catch (error) {
            if (error instanceof AccountRequestError && error.kind === 'auth') { throw error }
            const until = Date.now() + (error instanceof AccountRequestError ? error.retryAfterMs : 60000)
            nextQuery.set(account.key, until); write(retryFile, { until })
            if (cache) { return { ...cache, stale: true } }
            throw error
        }
    })().finally(() => quotaFlight.delete(account.key))
    quotaFlight.set(account.key, run)
    return run
}

/** Runs without opening login windows or issuing usage requests; the CLI remains the live source of truth. */
export async function maintainAccountSessions (metas: (MetaInput & { ts?: number, configDir?: string })[] = []): Promise<void> {
    let accounts: SavedAccount[]
    try { accounts = readAccounts() } catch { return }
    for (const account of accounts) {
        try {
            for (const meta of metas) { recordAccountUsage(account, meta) }
            await ensureAccountSession(account)
        } catch { /* Retry next minute; never open a browser in the background. */ }
    }
}
