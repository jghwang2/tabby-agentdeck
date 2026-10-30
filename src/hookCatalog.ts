import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'

const history = require('../hooks/hook-history.json')

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
// The shipped offline archive is independent of current events, including retired registrations.
// Evidence: a05e77f (PowerShell, including install.ps1's PromptAsLabel), 7c43ecb (Node).
export function hookCommand (command: unknown): { script: string, args: string, legacy: boolean } | null {
    if (typeof command !== 'string') return null
    const node = /^node(?:\.exe)?\s+"([^"]+\.mjs)"(?:\s+(.*))?\s*$/i.exec(command)
    const ps = /^(?:powershell|powershell\.exe|pwsh|pwsh\.exe)\s+(?:(?:-NoProfile|-NonInteractive|-ExecutionPolicy\s+Bypass)\s+)*-File\s+"([^"]+\.ps1)"(?:\s+(.*))?\s*$/i.exec(command)
    const native = /^"([^"]+\.exe)"(?:\s+(.*))?\s*$/i.exec(command)
    const match = node || ps || native
    if (!match) return null
    const script = match[1].replace(/\\/g, '/')
    if ((!path.isAbsolute(script) && !/^[a-z]:\//i.test(script)) || !/\/hooks\/agentdeck-(?:codex-notify|notify|statusline)\.(?:ps1|mjs|exe)$/i.test(script)) return null
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
    const release = history.releases.find((r: any) => r.extension === path.extname(parsed.script).toLowerCase()
        && r[provider] && Object.prototype.hasOwnProperty.call(history.profiles[r[provider]], event)
        && history.profiles[r[provider]][event] === parsed.args)
    return release?.id || null
}

export function ownedStatusLine (value: any): boolean {
    if (value?.type !== 'command' || Object.keys(value).some(k => !['type', 'command'].includes(k))) return false
    const parsed = hookCommand(value.command)
    return !!parsed && !parsed.legacy && history.statusLine.some((s: any) => s.script === path.basename(parsed.script).toLowerCase())
        && (!parsed.args || /^--inner "[^"\r\n]+"$/.test(parsed.args))
}

export function currentHookGroups (provider: HookProvider, hooksDir: string): Record<string, any[]> {
    const specs = provider === 'claude' ? CLAUDE_HOOK_PLAN : CODEX_HOOK_EVENTS.map(event => ({event, args: ''}))
    const script = path.join(hooksDir, provider === 'claude' ? 'agentdeck-notify.mjs' : 'agentdeck-codex-notify.mjs').replace(/\\/g, '/')
    return Object.fromEntries(specs.map(({event, args}) => [event, [{
        ...(provider === 'claude' ? {matcher: '*'} : {}),
        hooks: [{type: 'command', command: `${notifyCommand(script)}${args ? ' ' + args : ''}`, timeout: provider === 'claude' ? 5 : 3}],
    }]]))
}

/** Use the packaged Windows transport; keep Node available for older packages/platforms. */
export function notifyCommand (script: string): string {
    const normalized = script.replace(/\\/g, '/').replace(/\.(?:ps1|exe)$/i, '.mjs')
    const native = normalized.replace(/\.mjs$/i, '.exe')
    return process.platform === 'win32' && fs.existsSync(native) ? `"${native}"` : `node "${normalized}"`
}

/** Source revision changes trigger one consented reinstall even when the command path stays the same. */
export function hookRevision (provider: HookProvider, hooksDir: string): string {
    const digest = createHash('sha256').update(JSON.stringify({history, provider, groups: currentHookGroups(provider, hooksDir)}))
    const native = process.platform === 'win32' && fs.existsSync(path.join(hooksDir, 'agentdeck-notify.exe'))
    const names = native ? ['agentdeck-notify.cs'] : ['agentdeck-notify.mjs', 'agentdeck-codex-notify.mjs', 'agentdeck-relay.mjs']
    for (const name of [...names, 'agentdeck-runtime.cjs', ...(provider === 'claude' ? ['agentdeck-statusline.mjs'] : [])]) {
        digest.update(name).update(fs.readFileSync(path.join(hooksDir, name)))
    }
    return digest.digest('hex')
}
