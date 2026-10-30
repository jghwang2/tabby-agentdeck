import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { agentHome } from './storagePaths'
import { accountHome, readAccounts } from './accounts'
import { historicalHook, hookCommand, notifyCommand } from './hookCatalog'
import { planHookManagement, applyHookManagement, HookManagementPlan } from './hookManagement'

export interface HookUpgrade { file: string, beforeHash: string, count: number, management: HookManagementPlan }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Upgrade only recognized, standalone AgentDeck transports. Preserve every other setting. */
export function upgradedHookSettings (settings: any, hooksDir: string): { next: any, count: number } {
    const next = JSON.parse(JSON.stringify(settings))
    let count = 0
    for (const [event, groups] of Object.entries(next?.hooks || {})) {
        if (!Array.isArray(groups)) { continue }
        for (const group of groups) {
            for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
                if (typeof hook?.command !== 'string') { continue }
                const parsed = hookCommand(hook.command)
                if (!parsed) { continue }
                const oldScript = parsed.script
                // Other integrations use the same basename (e.g. claude-compat).
                if (!/\/tabby-agentdeck\/hooks\/[^/]+$/i.test(oldScript)) { continue }
                const name = oldScript.split('/').pop()!
                if (!/^agentdeck-(?:codex-)?notify\.(?:ps1|mjs|exe)$/i.test(name)) { continue }
                if (!historicalHook(name.toLowerCase().includes('codex') ? 'codex' : 'claude', event, group, hook)) { continue }
                const script = path.join(hooksDir, name.replace(/\.(?:ps1|exe)$/i, '.mjs'))
                if (!fs.existsSync(script)) { throw new Error('새 AgentDeck 훅 파일을 찾지 못했습니다: ' + script) }
                const command = notifyCommand(script) + (parsed.args ? ' ' + parsed.args.replace(/ -PromptAsLabel$/, '') : '')
                if (command === hook.command) { continue }
                // Do not downgrade an already native registration when inspecting an old package.
                if (/\.exe$/i.test(name) && command.startsWith('node ')) { continue }
                hook.command = command
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
        const provider = path.basename(file).toLowerCase() === 'hooks.json' ? 'codex' : 'claude'
        const count = Object.entries(settings.hooks || {}).reduce((n, [event, groups]: [string, any]) => n +
            (Array.isArray(groups) ? groups.reduce((sum, group) => sum + (Array.isArray(group?.hooks)
                ? group.hooks.filter((hook: any) => !!historicalHook(provider, event, group, hook)).length : 0), 0) : 0), 0)
        if (!count) continue // Never enroll an integration that the user has not installed.
        const management = planHookManagement(provider, 'apply', [path.dirname(file)], hooksDir)
        if (management.blockers.length) throw Error(management.blockers.join('\n'))
        if (management.canApply) result.push({ file, beforeHash: hash(text), count, management })
    }
    return result
}

/** The caller must have explicit consent; never enroll a new integration or edit Codex trust state. */
export function applyHookUpgrades (plans: HookUpgrade[], hooksDir = path.resolve(__dirname, '../hooks')): void {
    // Validate every target before the first write; don't apply a stale dialog's choices.
    const updates = plans.map(plan => {
        const text = fs.readFileSync(plan.file, 'utf8')
        if (hash(text) !== plan.beforeHash) { throw new Error('훅 설정이 변경되었습니다. 다시 확인한 뒤 갱신하세요: ' + plan.file) }
        const current = planHookManagement(plan.management.provider, 'apply', [path.dirname(plan.file)], hooksDir)
        if (current.blockers.length || JSON.stringify(current.writes) !== JSON.stringify(plan.management.writes)
            || JSON.stringify(current.snapshots) !== JSON.stringify(plan.management.snapshots)) {
            throw new Error('갱신할 훅이 변경되었습니다: ' + plan.file)
        }
        return current
    })
    if (!updates.length) return
    // History cleanup and current installation share one preflight/backup/rollback transaction across homes.
    applyHookManagement({...updates[0], snapshots: updates.flatMap(p => p.snapshots), writes: updates.flatMap(p => p.writes),
        changes: updates.flatMap(p => p.changes), blockers: [], canApply: true})
}
