/** Windows ConPTY drops CSI-u. Alt+Enter survives as a native modified Enter.
 * Confirmed against Codex 0.154.0's empty composer on 2026-09-13: row 11 -> 12.
 */
export function newlineSequence (agent?: string): string {
    return agent === 'codex' ? '\x1b\r' : '\n'
}

/** Only Claude's bordered composer has a measured repair layout. */
export function canRepairComposer (agent?: string): boolean {
    return agent === 'claude'
}
