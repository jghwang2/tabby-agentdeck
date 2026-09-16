import { AgentId } from './agents'

/** Match the current UI, never a banner left in scrollback. Both the composer
 * and its model/context footer are required; a shell prompt below it rejects
 * an old Codex screen after exit. Trailing empty terminal rows are harmless.
 */
export function isLiveCodexScreen (lines: string[]): boolean {
    const end = lines.reduce((last, line, i) => line.trim() ? i + 1 : last, 0)
    const visible = lines.slice(0, end)
    if (/^\s*\/ T R A N S C R I P T\b/.test(visible[0] ?? '')
        && visible.slice(-4).some(line => /\bq close\b/.test(line))) { return true }
    const footer = visible.findIndex(line => /^\s*(?:gpt-[\w.-]+|o\d[\w.-]*)\b.*\bContext \d+% left\b/.test(line))
    if (footer < 0 || footer < end - 3) { return false }
    if (visible.slice(footer + 1).some(line => /^(?:PS )?[A-Za-z]:[\\/][^>]*>/.test(line.trim()))) { return false }
    return visible.slice(0, footer).some(line => /^\s*›/.test(line))
}

function identifyShellLaunch (command: string): AgentId {
    const args = (command.match(/"[^"]*"|\S+/g) ?? []).map(arg => arg.replace(/^"|"$/g, ''))
    const exe = (args[0] ?? '').split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
    if (exe === 'codex' || exe === 'claude' || exe === 'gemini') { return exe }
    if (exe === 'node') {
        const script = (args[1] ?? '').replace(/\\/g, '/')
        if (/\/@openai\/codex\/bin\/codex\.js$/i.test(script)) { return 'codex' }
        if (/\/@anthropic-ai\/claude-code\/cli\.js$/i.test(script)) { return 'claude' }
        if (/\/@google\/gemini-cli\/(?:bundle\/gemini|dist\/index)\.js$/i.test(script)) { return 'gemini' }
    }
    return 'unknown'
}

/** Synchronous fallback while the OS process probe is pending or unavailable.
 * Only application version banners count, not mentions in ordinary output.
 * A newer shell prompt or a Claude banner supersedes an old Codex banner.
 */
export function identifyScreenAgent (lines: string[]): AgentId {
    let id: AgentId = 'unknown'
    for (const line of lines) {
        if (/^\s*│\s*>_\s+OpenAI Codex\s+\(v\d+\./.test(line)) { id = 'codex' }
        else if (/^[\s*\u2500-\u259f]*Claude Code v\d+\./.test(line)) { id = 'claude' }
        else if (/^(?:PS )?[A-Za-z]:[\\/][^>]*>/.test(line)) { id = 'unknown' }
    }
    return id
}

/** Observe banners before xterm renders them, and retain the identity when a
 * resumed transcript replaces the banner. Bound parser state even for corrupt
 * or split CSI/OSC sequences. Child processes can also change the console
 * title, so require a shell prompt before treating a shell title as an exit.
 */
export class TerminalAgentTracker {
    id: AgentId | undefined
    private line = ''
    private control = ''
    private shellTitle = false
    private mode: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' = 'text'

    write (data: string): void {
        for (const ch of data) {
            if (this.mode === 'osc' || this.mode === 'osc-escape') {
                if (ch === '\x07' || (this.mode === 'osc-escape' && ch === '\\')) {
                    const title = this.control.replace(/^[02];/, '')
                    if (/^[02];/.test(this.control) && /(?:^|:\s+)(?:[a-z]:[\\/][^\r\n]*[\\/])?(?:cmd|powershell|pwsh)(?:\.exe)?\s*$/i.test(title)) {
                        this.shellTitle = true
                    }
                    const launch = /^[02];/.test(this.control) && title.match(/(?:^|:\s+)(?:[a-z]:[\\/][^\r\n]*[\\/])?(?:cmd|powershell|pwsh)(?:\.exe)?\s+-\s+(.+)$/i)
                    if (launch) {
                        const launched = identifyShellLaunch(launch[1])
                        this.shellTitle = launched === 'unknown'
                        if (launched !== 'unknown' || !this.id) { this.id = launched }
                    }
                    this.mode = 'text'; this.control = ''; this.line = ''
                } else {
                    this.mode = ch === '\x1b' ? 'osc-escape' : 'osc'
                    if (this.control.length < 4096 && ch !== '\x1b') { this.control += ch }
                }
                continue
            }
            if (this.mode === 'escape') {
                this.mode = ch === '[' ? 'csi' : ch === ']' ? 'osc' : 'text'
                this.control = ''
                continue
            }
            if (this.mode === 'csi') {
                if (ch >= '@' && ch <= '~') {
                    this.mode = 'text'
                    // Cursor positioning begins a new on-screen line. SGR does not.
                    if ('HfG'.includes(ch)) { this.line = '' }
                }
                continue
            }
            if (ch === '\x1b') { this.mode = 'escape'; continue }
            if (ch === '\r' || ch === '\n') { this.line = ''; continue }
            if (ch < ' ') { continue }
            this.line = (this.line + ch).slice(-512)
            if (ch === '>' && this.shellTitle && /^(?:PS )?[A-Za-z]:[\\/][^>]*>$/.test(this.line.trim())) {
                this.id = 'unknown'
                this.shellTitle = false
            }
            // Check only the short version prefix, not ordinary mentions in text.
            if (ch === '.') {
                const id = identifyScreenAgent([this.line])
                // A conversation can quote a different application's banner.
                // Only a new shell/launch boundary can replace an active identity.
                if (id !== 'unknown' && (!this.id || this.id === 'unknown')) { this.id = id }
            }
        }
    }
}
