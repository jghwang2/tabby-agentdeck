/** Windows Codex redraws one viewport instead of accumulating native history.
 * Use its transcript pager only when there is no native scrollback to browse.
 * Never send navigation keys until the pager is visibly confirmed.
 */
export function isCodexTranscript (lines: string[]): boolean {
    return /^\s*\/ T R A N S C R I P T\b/.test(lines[0] ?? '')
        && lines.slice(-4).some(line => /q close/.test(line))
}

export function installCodexWheel (
    frontend: any, enabled: () => boolean, send: (data: string) => void,
): void {
    const x = frontend?.xterm
    const element = x?.element as HTMLElement | undefined
    if (!element || frontend.__adCodexWheel) { return }
    frontend.__adCodexWheel = true
    let opening = false
    let queued = 0
    const lines = (): string[] => {
        const b = x.buffer.active
        return Array.from({ length: x.rows }, (_, i) => b.getLine(b.baseY + i)?.translateToString(true) ?? '')
    }
    const navigate = (amount: number): void => {
        if (amount) { send((amount < 0 ? '\x1b[A' : '\x1b[B').repeat(Math.min(12, Math.abs(amount)))) }
    }
    element.addEventListener('wheel', event => {
        if (!enabled() || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
            || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { return }
        const screen = lines()
        const transcript = isCodexTranscript(screen)
        const b = x.buffer.active
        // A live composer footer is required, so approvals, menus, shells and
        // alternate-screen tools cannot receive an unsolicited Ctrl+T.
        const contentEnd = screen.reduce((end, line, i) => line.trim() ? i + 1 : end, 0)
        const composer = screen.slice(Math.max(0, contentEnd - 4), contentEnd)
            .some(line => /Context \d+% left/.test(line))
        if (!transcript && !opening && (b.type !== 'normal' || b.baseY > 0 || !composer || event.deltaY > 0)) { return }
        event.preventDefault()
        event.stopImmediatePropagation()
        const amount = Math.sign(event.deltaY) * Math.max(1, Math.min(12,
            Math.ceil(Math.abs(event.deltaY) / (event.deltaMode === 1 ? 1 : 40))))
        if (transcript) { navigate(amount); return }
        queued = Math.max(-12, Math.min(12, queued + amount))
        if (opening) { return }
        opening = true
        send('\x14')
        let attempts = 0
        const check = (): void => {
            if (!enabled() || ++attempts > 20) { opening = false; queued = 0; return }
            if (isCodexTranscript(lines())) {
                opening = false
                navigate(queued)
                queued = 0
            } else { setTimeout(check, 50) }
        }
        setTimeout(check, 50)
    }, { capture: true, passive: false })
}
