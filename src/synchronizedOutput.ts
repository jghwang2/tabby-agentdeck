/** Older xterm builds ignore synchronized-output mode (DEC 2026).
 * ConPTY exposes a temporary cursor between the begin/end packets. Buffer the
 * complete frame before handing it to xterm. The caller bounds missing ends.
 */
export class SynchronizedOutputStream {
    private pending = ''
    write (data: string, enabled: boolean): string {
        this.pending += data
        if (!enabled || this.pending.length > 1024 * 1024) { return this.flush() }
        const begin = '\x1b[?2026h'
        const end = '\x1b[?2026l'
        if (this.pending.lastIndexOf(begin) > this.pending.lastIndexOf(end)) { return '' }
        for (let n = 1; n < begin.length; n++) {
            if (this.pending.endsWith(begin.slice(0, n))) { return '' }
        }
        return this.flush()
    }
    get waiting (): boolean { return !!this.pending }
    flush (): string { const data = this.pending; this.pending = ''; return data }
}
