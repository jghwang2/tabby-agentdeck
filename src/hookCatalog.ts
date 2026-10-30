import * as fs from 'fs'
import * as path from 'path'

export type HookProvider = 'claude' | 'codex'
export const CLAUDE_HOOK_PLAN = [
    { event: 'UserPromptSubmit', args: '-Status running' },
    { event: 'Notification', args: '-Status waiting' },
    { event: 'PostToolUse', args: '-Status running' },
    { event: 'PostToolUseFailure', args: '-Status running' },
    { event: 'PermissionDenied', args: '-Status running' },
    { event: 'SubagentStart', args: '-Subagent start' },
    { event: 'SubagentStop', args: '-Subagent stop' },
    { event: 'Stop', args: '-Status done' },
    { event: 'StopFailure', args: '-Status error' },
]
export const CODEX_HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd']
export const HOOK_CATALOG_VERSION = 1
// Archive is intentionally independent of the current catalog: retired events must stay recognizable.
const HISTORICAL_CLAUDE_ARGS: Record<string, string> = {
    UserPromptSubmit: '-Status running', Notification: '-Status waiting', PostToolUse: '-Status running',
    PostToolUseFailure: '-Status running', PermissionDenied: '-Status running', SubagentStart: '-Subagent start',
    SubagentStop: '-Subagent stop', Stop: '-Status done', StopFailure: '-Status error',
}
const HISTORICAL_CODEX_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd']
// Evidence: a05e77f (PowerShell, including install.ps1's PromptAsLabel), 7c43ecb (Node).
export function hookCommand (command: unknown): { script: string, args: string, legacy: boolean } | null {
    if (typeof command !== 'string') return null
    const node = /^node(?:\.exe)?\s+"([^"]+\.mjs)"(?:\s+(.*))?\s*$/i.exec(command)
    const ps = /^(?:powershell|powershell\.exe|pwsh|pwsh\.exe)\s+(?:(?:-NoProfile|-NonInteractive|-ExecutionPolicy\s+Bypass)\s+)*-File\s+"([^"]+\.ps1)"(?:\s+(.*))?\s*$/i.exec(command)
    const match = node || ps
    if (!match) return null
    const script = match[1].replace(/\\/g, '/')
    if ((!path.isAbsolute(script) && !/^[a-z]:\//i.test(script)) || !/\/hooks\/agentdeck-(?:codex-notify|notify|statusline)\.(?:ps1|mjs)$/i.test(script)) return null
    const root = path.dirname(path.dirname(script))
    let packageOwned = path.basename(root).toLowerCase() === 'tabby-agentdeck'
    try { packageOwned = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name === 'tabby-agentdeck' }
    catch (e: any) { if (e.code !== 'ENOENT') packageOwned = false }
    return packageOwned ? { script, args: (match[2] || '').trim(), legacy: !!ps } : null
}

export function historicalHook (provider: HookProvider, event: string, group: any, hook: any): string | null {
    if (hook?.type !== 'command' || Object.keys(hook).some(k => !['type', 'command', 'timeout'].includes(k))) return null
    if (hook.timeout !== undefined && hook.timeout !== (provider === 'claude' ? 5 : 3)) return null
    if (Object.keys(group).some(k => !['matcher', 'hooks'].includes(k)) || (group.matcher !== undefined && group.matcher !== '*')) return null
    const parsed = hookCommand(hook.command)
    if (!parsed) return null
    const expected = provider === 'claude' ? 'agentdeck-notify' : 'agentdeck-codex-notify'
    if (path.basename(parsed.script).split('.')[0].toLowerCase() !== expected) return null
    if (provider === 'codex') return HISTORICAL_CODEX_EVENTS.includes(event) && !parsed.args ? (parsed.legacy ? 'a05e77f' : '7c43ecb') : null
    const args = HISTORICAL_CLAUDE_ARGS[event]
    if (!args) return null
    if (parsed.args === args) return parsed.legacy ? 'a05e77f' : '7c43ecb'
    return parsed.legacy && event === 'UserPromptSubmit' && parsed.args === '-Status running -PromptAsLabel' ? 'a05e77f install.ps1' : null
}

export function ownedStatusLine (value: any): boolean {
    if (value?.type !== 'command' || Object.keys(value).some(k => !['type', 'command'].includes(k))) return false
    const parsed = hookCommand(value.command)
    return !!parsed && !parsed.legacy && path.basename(parsed.script).toLowerCase() === 'agentdeck-statusline.mjs'
        && (!parsed.args || /^--inner "[^"\r\n]+"$/.test(parsed.args))
}

export function currentHookGroups (provider: HookProvider, hooksDir: string): Record<string, any[]> {
    const specs = provider === 'claude' ? CLAUDE_HOOK_PLAN : CODEX_HOOK_EVENTS.map(event => ({event, args: ''}))
    const script = path.join(hooksDir, provider === 'claude' ? 'agentdeck-notify.mjs' : 'agentdeck-codex-notify.mjs').replace(/\\/g, '/')
    return Object.fromEntries(specs.map(({event, args}) => [event, [{
        ...(provider === 'claude' ? {matcher: '*'} : {}),
        hooks: [{type: 'command', command: `node "${script}"${args ? ' ' + args : ''}`, timeout: provider === 'claude' ? 5 : 3}],
    }]]))
}
