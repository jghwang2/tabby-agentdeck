import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { agentHome } from './storagePaths'
import { accountHome, readAccounts } from './accounts'

export interface HookUpgrade { file: string, beforeHash: string, count: number }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Upgrade only the old, standalone AgentDeck PowerShell transport. Preserve every other setting. */
export function upgradedHookSettings (settings: any, hooksDir: string): { next: any, count: number } {
    const next = JSON.parse(JSON.stringify(settings))
    let count = 0
    for (const groups of Object.values(next?.hooks || {})) {
        if (!Array.isArray(groups)) { continue }
        for (const group of groups) {
            for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
                if (typeof hook?.command !== 'string') { continue }
                const match = /^\s*(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+((?:(?:-NoProfile|-NonInteractive|-ExecutionPolicy\s+Bypass)\s+)+)-File\s+"([^"]+)"((?:\s+-(?:Status|Agent|Subagent|MaxLabel)\s+[\w-]+)*)\s*$/i.exec(hook.command)
                if (!match) { continue }
                const oldScript = match[2].replace(/\\/g, '/')
                // Other integrations use the same basename (e.g. claude-compat).
                if (!/\/tabby-agentdeck\/hooks\/[^/]+$/i.test(oldScript)) { continue }
                const name = oldScript.split('/').pop()!
                if (!/^agentdeck-(?:codex-)?notify\.ps1$/i.test(name)) { continue }
                const script = path.join(hooksDir, name.replace(/\.ps1$/i, '.mjs'))
                if (!fs.existsSync(script)) { throw new Error('새 AgentDeck 훅 파일을 찾지 못했습니다: ' + script) }
                hook.command = `node "${script.replace(/\\/g, '/')}"${match[3]}`
                count++
            }
        }
    }
    return { next, count }
}

export function hookSettingsFiles (): string[] {
    const files = [path.join(agentHome('claude'), 'settings.json'), path.join(agentHome('codex'), 'hooks.json')]
    for (const account of readAccounts()) {
        files.push(path.join(accountHome(account), account.provider === 'claude' ? 'settings.json' : 'hooks.json'))
    }
    return [...new Set(files.map(file => path.resolve(file)))]
}

export function findHookUpgrades (hooksDir = path.resolve(__dirname, '../hooks'), files = hookSettingsFiles()): HookUpgrade[] {
    const result: HookUpgrade[] = []
    for (const file of files) {
        if (!fs.existsSync(file)) { continue }
        const text = fs.readFileSync(file, 'utf8')
        const settings = JSON.parse(text.replace(/^\uFEFF/, ''))
        const { count } = upgradedHookSettings(settings, hooksDir)
        if (count) { result.push({ file, beforeHash: hash(text), count }) }
    }
    return result
}

/** The caller must have explicit consent; never enroll a new integration or edit Codex trust state. */
export function applyHookUpgrades (plans: HookUpgrade[], hooksDir = path.resolve(__dirname, '../hooks')): void {
    // Validate every target before the first write; don't apply a stale dialog's choices.
    const updates = plans.map(plan => {
        const text = fs.readFileSync(plan.file, 'utf8')
        if (hash(text) !== plan.beforeHash) { throw new Error('훅 설정이 변경되었습니다. 다시 확인한 뒤 갱신하세요: ' + plan.file) }
        const result = upgradedHookSettings(JSON.parse(text.replace(/^\uFEFF/, '')), hooksDir)
        if (result.count !== plan.count) { throw new Error('갱신할 훅이 변경되었습니다: ' + plan.file) }
        return { file: plan.file, text, next: JSON.stringify(result.next, null, 2) + '\n' }
    })
    for (const update of updates) {
        fs.writeFileSync(update.file + '.agentdeck-hook-upgrade-backup', update.text, 'utf8')
        const tmp = update.file + '.agentdeck-' + process.pid + '.tmp'
        try {
            fs.writeFileSync(tmp, update.next, 'utf8')
            fs.renameSync(tmp, update.file)
        } finally { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp) } }
    }
}
