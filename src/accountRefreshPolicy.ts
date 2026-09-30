import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'

export const REFRESH_WINDOW_MS = 5 * 60000
export const REFRESH_RETRY_MS = 60000
export interface AccountRefreshState {
    generation: string
    firstFailureAt?: number
    nextAttemptAt?: number
    blocked?: boolean
}
function file (home: string): string { return path.join(home, 'agentdeck-refresh-state.json') }
function save (home: string, state: AccountRefreshState): void {
    fs.mkdirSync(home, { recursive: true })
    const temp = file(home) + '.' + process.pid + '.tmp'
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 })
    fs.renameSync(temp, file(home))
}
export function accountRefreshState (home: string, now = Date.now()): AccountRefreshState {
    let state: AccountRefreshState = { generation: '' }
    try {
        const value = JSON.parse(fs.readFileSync(file(home), 'utf8'))
        if (typeof value.generation !== 'string') { throw new Error('Invalid refresh state') }
        state = value
    } catch (error: any) {
        if (error.code !== 'ENOENT') { return { generation: '', blocked: true } }
    }
    if (!state.blocked && typeof state.firstFailureAt === 'number' && now - state.firstFailureAt >= REFRESH_WINDOW_MS) {
        state.blocked = true
        save(home, state)
    }
    return state
}
export function recordRefreshFailure (home: string, generation: string, now = Date.now()): AccountRefreshState {
    const state = accountRefreshState(home, now)
    // A failed request from before a successful login cannot disable the new login.
    if (state.generation !== generation || state.blocked) { return state }
    state.firstFailureAt ??= now
    state.nextAttemptAt = now + REFRESH_RETRY_MS
    state.blocked = now - state.firstFailureAt >= REFRESH_WINDOW_MS
    save(home, state)
    return state
}
export function recordRefreshSuccess (home: string, generation: string): void {
    const state = accountRefreshState(home)
    if (state.generation === generation && !state.blocked && state.firstFailureAt !== undefined) {
        save(home, { generation })
    }
}
/** Only a completed, identity-verified login resets a disabled account. */
export function resetAccountRefreshAfterLogin (home: string): void {
    save(home, { generation: randomBytes(16).toString('hex') })
}
