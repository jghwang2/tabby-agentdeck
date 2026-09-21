import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { createHash } from 'crypto'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'

export type AccountProvider = 'claude' | 'codex'
export interface SavedAccount { provider: AccountProvider, key: string, name: string, id: string }
interface SecretAccount extends SavedAccount { password: string }
export interface AccountQuota { label: string, remaining?: number, status?: string, resetsAt?: number }
export class AccountRequestError extends Error {
    constructor (public kind: 'auth' | 'temporary', message: string, public status = 0, public retryAfterMs = 60000) { super(message) }
}
export const ACCOUNTS_FILE = process.env.AGENTDECK_ACCOUNTS_FILE || path.join(os.homedir(), '.agentdeck', 'accounts.json')

/** Do not let JSON parser errors (which can contain passwords) escape this boundary. */
export function readAccounts (file = ACCOUNTS_FILE): SavedAccount[] {
    return readSecrets(file).map(({ password, ...account }) => account)
}

/** Add one local plaintext entry without replacing other accounts or their encrypted auth snapshots. */
export function addAccount (provider: AccountProvider, id: string, password: string, file = ACCOUNTS_FILE, name = ''): void {
    id = id.trim()
    if (!id || !password) { throw new Error('계정과 비밀번호를 입력하세요.') }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) { throw new Error('이메일 주소 전체를 입력하세요.') }
    let data: any = {}
    try {
        if (fs.existsSync(file)) { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }
        if (!data || typeof data !== 'object' || Array.isArray(data)
            || (data[provider] !== undefined && !Array.isArray(data[provider]))) { throw new Error() }
    } catch { throw new Error('계정 파일을 읽지 못했습니다. JSON 형식을 확인하세요.') }
    const rows = data[provider] || []
    if (rows.some((row: any) => typeof row?.id === 'string' && row.id.trim().toLowerCase() === id.toLowerCase())) {
        throw new Error('이미 등록된 계정입니다.')
    }
    data[provider] = [...rows, { name: name.trim() || id, id, password }]
    const temporary = file + '.' + process.pid + '.add.tmp'
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
        fs.renameSync(temporary, file)
    } catch {
        try { fs.unlinkSync(temporary) } catch { /* Nothing was written. */ }
        throw new Error('계정을 저장하지 못했습니다. 다시 시도하세요.')
    }
}

/** Remove the saved entry only. Running sessions may still use its native credential directory. */
export function removeAccount (account: SavedAccount, file = ACCOUNTS_FILE): void {
    let data: any
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
        if (!Array.isArray(data?.[account.provider])) { throw new Error() }
    } catch { throw new Error('계정 파일을 읽지 못했습니다. JSON 형식을 확인하세요.') }
    data[account.provider] = data[account.provider].filter((row: any) =>
        typeof row?.id !== 'string' || row.id.trim().toLowerCase() !== account.id.toLowerCase())
    const temporary = file + '.' + process.pid + '.remove.tmp'
    try {
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
        fs.renameSync(temporary, file)
    } catch {
        try { fs.unlinkSync(temporary) } catch { /* Nothing was written. */ }
        throw new Error('계정을 저장하지 못했습니다. 다시 시도하세요.')
    }
}

function readSecrets (file: string): SecretAccount[] {
    let data: any
    try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch (error: any) {
        if (error.code === 'ENOENT') { return [] }
        throw new Error('계정 파일을 읽지 못했습니다. JSON 형식을 확인하세요.')
    }
    const result: SecretAccount[] = []
    for (const provider of ['claude', 'codex'] as AccountProvider[]) {
        if (!Array.isArray(data?.[provider])) { continue }
        for (const row of data[provider]) {
            if (typeof row?.id !== 'string' || !row.id.trim()) { continue }
            const id = row.id.trim()
            const key = createHash('sha256').update(provider + ':' + id.toLowerCase()).digest('hex').slice(0, 24)
            if (result.some(a => a.key === key)) { continue }
            result.push({ provider, key, id, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id,
                password: typeof row.password === 'string' ? row.password : '' })
        }
    }
    return result
}

export function accountHome (account: SavedAccount): string {
    return path.join(path.dirname(ACCOUNTS_FILE), 'accounts', account.key)
}

export function accountEnv (account: SavedAccount): NodeJS.ProcessEnv {
    const env = { ...process.env }
    // Subscription login must not accidentally inherit an API key from the parent session.
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']) {
        delete env[key]
    }
    delete env.CLAUDECODE
    env[account.provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'] = accountHome(account)
    return env
}

function readJson (file: string): any {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function tokenEmail (token: unknown): string {
    try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8')).email || '' } catch { return '' }
}

export function accountEmail (provider: AccountProvider, home: string): string {
    return provider === 'codex'
        ? tokenEmail(readJson(path.join(home, 'auth.json'))?.tokens?.id_token)
        : String(readJson(path.join(home, '.claude.json'))?.oauthAccount?.emailAddress || '')
}

/** Windows encrypts the snapshot for the current OS user; secrets travel over stdin, never argv. */
export function protectAccountAuth (value: string, decrypt = false): Promise<string> {
    if (process.platform !== 'win32') { return Promise.reject(new Error('인증정보 저장은 현재 Windows에서 지원합니다.')) }
    const command = '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security; '
        + '$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); '
        + `$result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); `
        + '[Console]::Out.Write([Convert]::ToBase64String($result))'
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'pipe' })
        let output = ''
        const fail = () => reject(new Error('인증정보 암호화 저장소에 접근하지 못했습니다.'))
        const timer = setTimeout(() => { child.kill(); fail() }, 15000)
        child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) { child.kill(); fail() } })
        child.stderr.resume()
        child.stdin.on('error', fail)
        child.on('error', () => { clearTimeout(timer); fail() })
        child.on('exit', code => {
            clearTimeout(timer)
            if (code !== 0 || !output.trim()) { fail(); return }
            resolve(decrypt ? Buffer.from(output.trim(), 'base64').toString('utf8') : output.trim())
        })
        child.stdin.end(decrypt ? value : Buffer.from(value, 'utf8').toString('base64'))
    })
}

let savingAuth: Promise<void> = Promise.resolve()
export function saveAccountAuth (account: SavedAccount): Promise<void> {
    const save = async () => {
        const home = accountHome(account)
        if (accountEmail(account.provider, home).toLowerCase() !== account.id.toLowerCase()) { throw new Error('인증정보의 계정이 일치하지 않습니다.') }
        const credentials = readJson(path.join(home, account.provider === 'claude' ? '.credentials.json' : 'auth.json'))
        if (!credentials) { throw new Error('저장할 인증정보가 없습니다.') }
        const snapshot = { provider: account.provider, id: account.id.toLowerCase(), credentials,
            profile: account.provider === 'claude' ? readJson(path.join(home, '.claude.json'))?.oauthAccount : undefined }
        const data = await protectAccountAuth(JSON.stringify(snapshot))
        // Re-read after encryption so edits made by the user or another account save are retained.
        const file = readJson(ACCOUNTS_FILE)
        const row = file?.[account.provider]?.find((r: any) => typeof r.id === 'string' && r.id.trim().toLowerCase() === account.id.toLowerCase())
        if (!row) { throw new Error('계정 파일이 변경되어 인증정보를 저장하지 못했습니다.') }
        row.auth = { version: 1, protection: 'windows-dpapi', data, updatedAt: new Date().toISOString() }
        const temporary = ACCOUNTS_FILE + '.' + process.pid + '.tmp'
        try {
            fs.writeFileSync(temporary, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
            fs.renameSync(temporary, ACCOUNTS_FILE)
        } catch { throw new Error('계정 파일에 인증정보를 저장하지 못했습니다.') }
    }
    const next = savingAuth.catch(() => {}).then(save)
    savingAuth = next
    return next
}

export async function restoreAccountAuth (account: SavedAccount): Promise<void> {
    const home = accountHome(account)
    const nativeFile = path.join(home, account.provider === 'claude' ? '.credentials.json' : 'auth.json')
    // Native CLIs refresh credentials themselves. Never replace a live token with an older backup.
    if (fs.existsSync(nativeFile) && accountEmail(account.provider, home).toLowerCase() === account.id.toLowerCase()) { return }
    const file = readJson(ACCOUNTS_FILE)
    const auth = file?.[account.provider]?.find((r: any) => typeof r.id === 'string' && r.id.trim().toLowerCase() === account.id.toLowerCase())?.auth
    if (!auth) { return }
    if (auth.protection !== 'windows-dpapi' || auth.version !== 1 || typeof auth.data !== 'string') {
        throw new Error('저장된 인증정보 형식을 확인할 수 없습니다. 다시 로그인하세요.')
    }
    let snapshot: any
    try { snapshot = JSON.parse(await protectAccountAuth(auth.data, true)) } catch {
        throw new Error('저장된 인증정보를 복원하지 못했습니다. 다시 로그인하세요.')
    }
    if (snapshot.provider !== account.provider || snapshot.id !== account.id.toLowerCase() || !snapshot.credentials) {
        throw new Error('저장된 인증정보의 계정이 일치하지 않습니다.')
    }
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    fs.writeFileSync(nativeFile, JSON.stringify(snapshot.credentials), { mode: 0o600 })
    if (account.provider === 'claude') {
        const profileFile = path.join(home, '.claude.json')
        const profile = readJson(profileFile) || {}
        profile.oauthAccount = snapshot.profile
        fs.writeFileSync(profileFile, JSON.stringify(profile), { mode: 0o600 })
    }
}

/** Clone settings, share only conversation/instruction directories, keep auth private per account. */
export function prepareAccount (account: SavedAccount, sourceHome?: string): void {
    const dest = accountHome(account)
    const source = sourceHome || (account.provider === 'claude'
        ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
        : process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 })
    if (path.resolve(source) === path.resolve(dest)) { return }
    if (account.provider === 'claude' && fs.existsSync(path.join(dest, '.claude.json'))) {
        // Restoring encrypted auth may create a minimal profile before first launch. Carry over existing
        // CLI preferences/onboarding state without replacing the selected account's identity.
        const defaults = readJson(path.join(source, '.claude.json')) || readJson(path.join(os.homedir(), '.claude.json')) || {}
        delete defaults.oauthAccount
        const current = readJson(path.join(dest, '.claude.json')) || {}
        fs.writeFileSync(path.join(dest, '.claude.json'), JSON.stringify({ ...defaults, ...current }), { mode: 0o600 })
    }
    const files = account.provider === 'claude'
        ? ['settings.json', 'settings.local.json', 'CLAUDE.md'] : ['config.toml', 'AGENTS.md']
    for (const name of files) {
        const target = path.join(dest, name)
        if (fs.existsSync(path.join(source, name)) && !fs.existsSync(target)) {
            fs.copyFileSync(path.join(source, name), target, fs.constants.COPYFILE_EXCL)
        }
    }
    const dirs = account.provider === 'claude'
        ? ['projects', 'skills', 'commands', 'plugins', 'hooks']
        : ['sessions', 'archived_sessions', 'skills', 'plugins', 'rules', 'claude-compat']
    for (const name of dirs) {
        const target = path.join(dest, name)
        if (fs.existsSync(path.join(source, name)) && !fs.existsSync(target)) {
            fs.symlinkSync(path.resolve(source, name), target, process.platform === 'win32' ? 'junction' : 'dir')
        }
    }
    if (account.provider === 'claude' && !fs.existsSync(path.join(dest, '.claude.json'))) {
        const config = readJson(path.join(source, '.claude.json')) || readJson(path.join(os.homedir(), '.claude.json')) || {}
        const sameAccount = String(config.oauthAccount?.emailAddress || '').toLowerCase() === account.id.toLowerCase()
        if (!sameAccount) { delete config.oauthAccount }
        fs.writeFileSync(path.join(dest, '.claude.json'), JSON.stringify(config), { mode: 0o600 })
        if (sameAccount && fs.existsSync(path.join(source, '.credentials.json'))) {
            fs.copyFileSync(path.join(source, '.credentials.json'), path.join(dest, '.credentials.json'), fs.constants.COPYFILE_EXCL)
        }
    }
    if (account.provider === 'codex' && !fs.existsSync(path.join(dest, 'auth.json'))
        && accountEmail('codex', source).toLowerCase() === account.id.toLowerCase()) {
        fs.copyFileSync(path.join(source, 'auth.json'), path.join(dest, 'auth.json'), fs.constants.COPYFILE_EXCL)
    }
    if (account.provider === 'codex') { void seedCodexMarketplaces(source, dest).catch(() => {}) }
}

const marketplaceSeeds = new Map<string, Promise<void>>()

/** In-flight marketplace seeding for an account home (tests and callers that must wait). */
export function pendingMarketplaceSeed (dest: string): Promise<void> {
    return marketplaceSeeds.get(path.resolve(dest)) || Promise.resolve()
}

/**
 * Codex keeps git marketplace clones in `<CODEX_HOME>/.tmp/marketplaces/<name>`. An account home starts
 * without them, so Codex clones each configured marketplace itself; a large one hits Codex's 30s clone
 * timeout, the half-cloned `.staging/marketplace-upgrade-*` is never removed, and the retry repeats about
 * once a minute (~370MB each, 130GB observed 2026-09-18). Copy the clones the source home already has.
 * Async so the account picker does not freeze; a partial copy never takes the final name.
 */
export function seedCodexMarketplaces (source: string, dest: string): Promise<void> {
    const key = path.resolve(dest)
    const running = marketplaceSeeds.get(key)
    if (running) { return running }
    const job = (async () => {
        const from = path.join(source, '.tmp', 'marketplaces')
        const to = path.join(dest, '.tmp', 'marketplaces')
        let names: string[]
        try { names = (await fs.promises.readdir(from, { withFileTypes: true })).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name) } catch { return }
        for (const name of names) {
            const target = path.join(to, name)
            if (fs.existsSync(target) || !fs.existsSync(path.join(from, name, '.git'))) { continue }
            const partial = path.join(to, '.agentdeck-seed-' + name + '-' + process.pid)
            try {
                await fs.promises.rm(partial, { recursive: true, force: true })
                await fs.promises.mkdir(to, { recursive: true })
                await fs.promises.cp(path.join(from, name), partial, { recursive: true, verbatimSymlinks: true })
                if (!fs.existsSync(target)) { await fs.promises.rename(partial, target) }
            } finally {
                await fs.promises.rm(partial, { recursive: true, force: true }).catch(() => {})
            }
        }
    })().finally(() => marketplaceSeeds.delete(key))
    marketplaceSeeds.set(key, job)
    return job
}

function launch (account: SavedAccount, args: string[]): ChildProcessWithoutNullStreams {
    // Resolve npm's real entry point; never interpolate credentials into a shell command.
    const roots = (process.env.PATH || '').split(path.delimiter)
    for (const root of roots) {
        if (account.provider === 'codex' && process.platform === 'win32') {
            const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
            const triple = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
            const binary = path.join(root, 'node_modules/@openai/codex/node_modules/@openai', `codex-win32-${arch}`, 'vendor', `${triple}-pc-windows-msvc`, 'bin/codex.exe')
            if (fs.existsSync(binary)) {
                return spawn(binary, args, { env: accountEnv(account), windowsHide: true, stdio: 'pipe' })
            }
        }
        const entry = path.join(root, 'node_modules', account.provider === 'claude' ? '@anthropic-ai/claude-code/bin/claude.exe' : '@openai/codex/bin/codex.js')
        if (fs.existsSync(entry)) {
            return spawn(account.provider === 'claude' ? entry : 'node', account.provider === 'claude' ? args : [entry, ...args],
                { env: accountEnv(account), windowsHide: true, stdio: 'pipe' })
        }
    }
    return spawn(account.provider, args, { env: accountEnv(account), windowsHide: true, stdio: 'pipe' })
}

class CodexAccountClient {
    private child: ChildProcessWithoutNullStreams
    private closed = false
    private next = 0
    private pending = new Map<number, { resolve: (x: any) => void, reject: (e: Error) => void, timer: any }>()
    onNotification: (method: string, params: any) => void = () => {}
    constructor (account: SavedAccount) {
        this.child = launch(account, ['-c', 'cli_auth_credentials_store="file"', 'app-server'])
        let buffer = ''
        this.child.stdout.on('data', chunk => {
            buffer += chunk.toString()
            let end: number
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
                let message: any
                try { message = JSON.parse(line) } catch { continue }
                const pending = this.pending.get(message.id)
                if (pending) {
                    clearTimeout(pending.timer); this.pending.delete(message.id)
                    if (message.error) { pending.reject(new Error('Codex 인증 또는 사용량 조회에 실패했습니다. 다시 로그인하세요.')) }
                    else { pending.resolve(message.result) }
                } else if (message.method) { this.onNotification(message.method, message.params) }
            }
            if (buffer.length > 1024 * 1024) { this.close() }
        })
        this.child.stderr.resume() // OAuth URLs/tokens and server diagnostics must not enter app logs.
        this.child.stdin.on('error', () => this.close())
        this.child.on('error', () => this.close())
        this.child.on('exit', () => this.close())
    }
    async init (): Promise<void> {
        await this.request('initialize', { clientInfo: { name: 'agentdeck_accounts', version: '1.0.0' }, capabilities: { experimentalApi: true } })
        this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    }
    request (method: string, params: any = {}): Promise<any> {
        const id = ++this.next
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 응답 시간이 초과되었습니다.')) }, 25000)
            this.pending.set(id, { resolve, reject, timer })
            this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', err => {
                if (err) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Codex에 연결할 수 없습니다.')) }
            })
        })
    }
    close (): void {
        if (this.closed) { return }
        this.closed = true
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex 연결이 종료되었습니다.')) }
        this.pending.clear()
        this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy()
        if (!this.child.killed) { this.child.kill() }
    }
}

export function parseQuotas (provider: AccountProvider, body: any): AccountQuota[] {
    const result: AccountQuota[] = []
    const add = (label: string, used: unknown, reset?: unknown) => {
        if (typeof used !== 'number' || !Number.isFinite(used)) { return }
        if (!result.some(q => q.label === label)) {
            const q: AccountQuota = { label, remaining: Math.max(0, Math.min(100, Math.round(100 - used))) }
            const seconds = typeof reset === 'number' ? reset : typeof reset === 'string' ? Date.parse(reset) / 1000 : 0
            if (Number.isFinite(seconds) && seconds > 0) { q.resetsAt = seconds }
            result.push(q)
        }
    }
    if (provider === 'claude') {
        add('5시간', body?.five_hour?.utilization, body?.five_hour?.resets_at)
        add('주간', body?.seven_day?.utilization, body?.seven_day?.resets_at)
        for (const limit of Array.isArray(body?.limits) ? body.limits : []) {
            if (limit.kind === 'weekly_scoped') { add(String(limit.scope?.model?.display_name || limit.scope?.model?.id || 'Fable'), limit.percent, limit.resets_at) }
            if (limit.kind === 'weekly') { add('주간', limit.percent, limit.resets_at) }
            if (limit.kind === 'session') { add('5시간', limit.percent, limit.resets_at) }
        }
    } else {
        const base = body?.rateLimits
        for (const w of [base?.primary, base?.secondary]) {
            if (w?.windowDurationMins === 300) { add('5시간', w.usedPercent, w.resetsAt) }
            if (w?.windowDurationMins === 10080) { add('주간', w.usedPercent, w.resetsAt) }
        }
        for (const [key, value] of Object.entries(body?.rateLimitsByLimitId || {})) {
            const bucket: any = value
            const label = String(bucket.limitName || bucket.normalModelSlug || key)
            if (/astra/i.test(label + key + (bucket.normalModelSlug || ''))) { add('Astra', bucket.secondary?.usedPercent ?? bucket.primary?.usedPercent, bucket.secondary?.resetsAt ?? bucket.primary?.resetsAt) }
        }
    }
    return result
}

/** The app-server snapshot omits model_usage, which currently reports Astra availability, not a percentage. */
export function parseCodexUsage (body: any): AccountQuota[] {
    const window = (w: any) => w ? { usedPercent: w.used_percent, windowDurationMins: w.limit_window_seconds / 60, resetsAt: w.reset_at } : null
    const additional: Record<string, any> = {}
    for (const bucket of Array.isArray(body?.additional_rate_limits) ? body.additional_rate_limits : []) {
        additional[String(bucket.metered_feature)] = { limitName: bucket.limit_name, normalModelSlug: bucket.normal_model_slug,
            primary: window(bucket.rate_limit?.primary_window), secondary: window(bucket.rate_limit?.secondary_window) }
    }
    const result = parseQuotas('codex', { rateLimits: { primary: window(body?.rate_limit?.primary_window),
        secondary: window(body?.rate_limit?.secondary_window) }, rateLimitsByLimitId: additional })
    if (!result.some(q => q.label === 'Astra')) {
        const astra: any = Object.entries(body?.model_usage || {}).find(([key]) => /astra/i.test(key))?.[1]
        if (typeof astra?.available === 'boolean') { result.push({ label: 'Astra', status: astra.available ? '사용 가능' : '현재 사용 불가' }) }
    }
    return result
}

function fetchCodexUsage (account: SavedAccount): Promise<AccountQuota[]> {
    const auth = readJson(path.join(accountHome(account), 'auth.json'))
    return new Promise((resolve, reject) => {
        const req = https.get('https://chatgpt.com/backend-api/wham/usage', {
            headers: { authorization: `Bearer ${auth?.tokens?.access_token || ''}`, 'ChatGPT-Account-Id': auth?.tokens?.account_id || '' }, timeout: 10000,
        }, res => {
            let body = ''
            res.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) { req.destroy() } })
            res.on('end', () => {
                if (res.statusCode !== 200) { reject(new Error('Codex 잔량 조회 실패')); return }
                try {
                    const data = JSON.parse(body)
                    if (data.account_id && data.account_id !== auth?.tokens?.account_id) { reject(new Error('잔량 응답의 계정이 일치하지 않습니다.')); return }
                    resolve(parseCodexUsage(data))
                } catch { reject(new Error('Codex 잔량 응답을 읽지 못했습니다.')) }
            })
        })
        req.on('timeout', () => req.destroy())
        req.on('error', () => reject(new Error('Codex 잔량 조회 연결 실패')))
        req.on('close', () => reject(new Error('Codex 잔량 조회 연결 종료')))
    })
}

export async function authenticateAccount (account: SavedAccount): Promise<void> {
    await restoreAccountAuth(account)
    if (accountEmail(account.provider, accountHome(account)).toLowerCase() !== account.id.toLowerCase()) {
        throw new AccountRequestError('auth', '저장된 로그인 정보가 없습니다.')
    }
    if (account.provider === 'codex') {
        const client = new CodexAccountClient(account)
        try {
            await client.init()
            // Checking identity must not rotate refresh tokens behind a running CLI.
            const identity = await client.request('account/read', { refreshToken: false })
            if (identity.account?.email?.toLowerCase() !== account.id.toLowerCase()) { throw new AccountRequestError('auth', '계정 확인이 필요합니다.') }
        } finally { client.close() }
    }
}

export async function fetchAccountQuotas (account: SavedAccount): Promise<AccountQuota[]> {
    await authenticateAccount(account)
    if (account.provider === 'codex') { return fetchCodexUsage(account) }
    const token = readJson(path.join(accountHome(account), '.credentials.json'))?.claudeAiOauth?.accessToken
    if (!token) { throw new AccountRequestError('auth', '저장된 로그인 정보가 없습니다.') }
    return new Promise((resolve, reject) => {
        const req = https.get('https://api.anthropic.com/api/oauth/usage', {
            headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' }, timeout: 10000,
        }, res => {
            let body = ''
            res.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) { req.destroy() } })
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const retry = Number(res.headers['retry-after'])
                    reject(new AccountRequestError(res.statusCode === 401 ? 'auth' : 'temporary',
                        res.statusCode === 429 ? '사용량 조회 제한 · 잠시 후 자동 갱신' : '사용량 조회 일시 실패',
                        res.statusCode, Number.isFinite(retry) ? Math.max(30000, retry * 1000) : 60000)); return
                }
                try { resolve(parseQuotas('claude', JSON.parse(body))) } catch { reject(new Error('잔량 응답을 읽지 못했습니다.')) }
            })
        })
        req.on('timeout', () => req.destroy())
        req.on('error', () => reject(new Error('잔량 조회 연결 실패')))
        req.on('close', () => reject(new Error('잔량 조회 연결 종료')))
    })
}

export type LoginBrowser = (url: string, account: SavedAccount, cancel: () => void) => Promise<() => void>

/** First login is completed by the user; the saved authentication is reused afterwards. */
export async function loginAccount (account: SavedAccount, browser: LoginBrowser): Promise<void> {
    if (!readAccounts().some(a => a.key === account.key)) { throw new Error('계정 파일에서 이 계정이 제거되었습니다.') }
    let closeBrowser = () => {}
    if (account.provider === 'codex') {
        const client = new CodexAccountClient(account)
        let timer: any
        try {
            await client.init()
            let finish: (value?: unknown) => void = () => {}
            let fail: (e: Error) => void = () => {}
            const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject })
            // Attach before starting login: a cached browser session can complete immediately.
            completed.catch(() => {})
            client.onNotification = (method, params) => {
                if (method === 'account/login/completed') {
                    if (params.success) { finish() } else { fail(new Error('로그인에 실패했습니다.')) }
                }
            }
            timer = setTimeout(() => fail(new Error('로그인 시간이 초과되었습니다. 다시 선택하세요.')), 5 * 60000)
            const login = await client.request('account/login/start', { type: 'chatgpt' })
            closeBrowser = await browser(login.authUrl, account, () => fail(new Error('로그인을 취소했습니다.')))
            await completed
            const identity = await client.request('account/read', { refreshToken: false })
            if (identity.account?.email?.toLowerCase() !== account.id.toLowerCase()) {
                await client.request('account/logout')
                throw new Error('선택한 계정과 로그인된 계정이 다릅니다. 다시 선택하세요.')
            }
        } finally { clearTimeout(timer); closeBrowser(); client.close() }
    } else {
        const child = launch(account, ['auth', 'login', '--claudeai', '--email', account.id])
        try {
            await new Promise<void>((resolve, reject) => {
                let opened = false
                let output = ''
                const timer = setTimeout(() => { child.kill(); reject(new Error('로그인 시간이 초과되었습니다.')) }, 5 * 60000)
                const onData = (chunk: Buffer) => {
                    output = (output + chunk.toString()).slice(-32000)
                    const match = output.match(/https:\/\/(?:claude\.ai|console\.anthropic\.com|platform\.claude\.com)\/[^\s\x1b]+/)
                    if (match && !opened) {
                        opened = true
                        void browser(match[0], account, () => child.kill()).then(close => { closeBrowser = close }, () => { child.kill() })
                    }
                }
                child.stdout.on('data', onData); child.stderr.on('data', onData)
                child.on('error', () => { clearTimeout(timer); reject(new Error('Claude 로그인을 실행하지 못했습니다.')) })
                child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Claude 로그인이 완료되지 않았습니다.')) })
            })
            if (accountEmail('claude', accountHome(account)).toLowerCase() !== account.id.toLowerCase()) {
                throw new Error('선택한 계정과 로그인된 계정이 다릅니다. 다시 로그인하세요.')
            }
        } finally { closeBrowser(); if (!child.killed) { child.kill() } }
    }
    await saveAccountAuth(account)
}
