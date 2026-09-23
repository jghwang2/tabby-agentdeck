import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface StoragePaths { accountStorageDir: string, claudeStorageDir: string, codexStorageDir: string }
export const STORAGE_KEYS = ['accountStorageDir', 'claudeStorageDir', 'codexStorageDir'] as const
const inherited = {
    accountFile: process.env.AGENTDECK_ACCOUNTS_FILE || path.join(os.homedir(), '.agentdeck', 'accounts.json'),
    claudeStorageDir: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    codexStorageDir: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
}
let active: StoragePaths = { accountStorageDir: '', claudeStorageDir: '', codexStorageDir: '' }

/** Snapshot at startup: saving settings must not redirect a running login or token refresh. */
export function configureStoragePaths (settings: Partial<StoragePaths>): void {
    active = Object.fromEntries(STORAGE_KEYS.map(key => [key, String(settings[key] || '').trim()])) as unknown as StoragePaths
}

export function storageDefaults (): StoragePaths {
    return { accountStorageDir: path.dirname(inherited.accountFile),
        claudeStorageDir: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
        codexStorageDir: process.env.CODEX_HOME || path.join(os.homedir(), '.codex') }
}

export function accountsFile (): string {
    return active.accountStorageDir ? path.join(active.accountStorageDir, 'accounts.json') : inherited.accountFile
}

export function agentHome (provider: 'claude' | 'codex'): string {
    const key = provider === 'claude' ? 'claudeStorageDir' : 'codexStorageDir'
    return active[key] || storageDefaults()[key]
}

export function hasConfiguredAgentHome (provider: 'claude' | 'codex'): boolean {
    return !!active[provider === 'claude' ? 'claudeStorageDir' : 'codexStorageDir']
}

/** Explicit per-account environments still win over the shared CLI home. */
export function storageEnvironment (env: Record<string, string> = {}): Record<string, string> {
    return { ...(active.claudeStorageDir ? { CLAUDE_CONFIG_DIR: active.claudeStorageDir } : {}),
        ...(active.codexStorageDir ? { CODEX_HOME: active.codexStorageDir } : {}), ...env }
}

/** Validate the complete draft before saving anything. Never create or move user data here. */
export function validateStoragePaths (draft: StoragePaths): StoragePaths {
    const result = {} as StoragePaths
    for (const key of STORAGE_KEYS) {
        const value = String(draft[key] || '').trim()
        if (value && (!path.isAbsolute(value) || /[\x00-\x1f]/.test(value))) { throw new Error('storage.absolute') }
        if (value) {
            if (process.platform === 'win32' && /[<>"|?*]/.test(value)) { throw new Error('storage.absolute') }
            let ancestor = value
            while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) { ancestor = path.dirname(ancestor) }
            if (fs.existsSync(ancestor) && !fs.statSync(ancestor).isDirectory()) { throw new Error('storage.directory') }
        }
        result[key] = value ? path.normalize(value) : ''
    }
    const defaults = storageDefaults()
    const resolved = STORAGE_KEYS.map(key => path.resolve(result[key] || defaults[key]))
    for (let i = 0; i < resolved.length; i++) {
        for (let j = i + 1; j < resolved.length; j++) {
            const relative = path.relative(resolved[i], resolved[j])
            const reverse = path.relative(resolved[j], resolved[i])
            const inside = (p: string) => !p || (!p.startsWith('..' + path.sep) && p !== '..' && !path.isAbsolute(p))
            if (inside(relative) || inside(reverse)) { throw new Error('storage.separate') }
        }
    }
    return result
}
