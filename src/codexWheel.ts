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
    let partial = 0
    // Use the same pixel/line/page conversion and sensitivity as native history.
    // The previous fixed 40px divisor made Codex slower than Claude at 17px rows.
    const scrollLines = (event: WheelEvent): number => {
        const viewport = x._core?.viewport
        if (typeof viewport?.getLinesScrolled === 'function') {
            return viewport.getLinesScrolled(event)
        }
        const height = x._core?._renderService?.dimensions?.css?.cell?.height
            || element.getBoundingClientRect().height / x.rows || 17
        const sensitivity = x.options?.scrollSensitivity ?? 1
        partial += event.deltaY * sensitivity * (event.deltaMode === 1 ? 1
            : event.deltaMode === 2 ? x.rows : 1 / height)
        const amount = Math.trunc(partial)
        partial -= amount
        return amount
    }
    const limit = (): number => Math.max(12, x.rows)
    const lines = (): string[] => {
        const b = x.buffer.active
        return Array.from({ length: x.rows }, (_, i) => b.getLine(b.baseY + i)?.translateToString(true) ?? '')
    }
    const navigate = (amount: number): void => {
        if (amount) { send((amount < 0 ? '\x1b[A' : '\x1b[B').repeat(Math.min(limit(), Math.abs(amount)))) }
    }
    element.addEventListener('wheel', event => {
        if (!enabled() || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
            || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { return }
        // Current fullscreen Codex consumes one line per mouse report; Claude
        // consumes three. Keep native coordinates/encoding (and menu handling),
        // but deliver three wheel reports instead of injecting navigation keys.
        const mouseMode = x.modes?.mouseTrackingMode
        const core = x._core
        if (mouseMode && mouseMode !== 'none' && mouseMode !== 'x10'
            && typeof core?.viewport?.getLinesScrolled === 'function'
            && typeof core?._mouseService?.getMouseReportCoords === 'function'
            && typeof core?.coreMouseService?.triggerMouseEvent === 'function') {
            const coords = core._mouseService.getMouseReportCoords(event, core.screenElement)
            if (!coords) { return }
            event.preventDefault()
            event.stopImmediatePropagation()
            if (core.viewport.getLinesScrolled(event) === 0) { return }
            for (let i = 0; i < 3; i++) {
                core.coreMouseService.triggerMouseEvent({
                    ...coords, button: 4, action: event.deltaY < 0 ? 0 : 1,
                    ctrl: false, alt: false, shift: false,
                })
            }
            return
        }
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
        const amount = scrollLines(event)
        if (transcript) { navigate(amount); return }
        queued = Math.max(-limit(), Math.min(limit(), queued + amount))
        if (!queued) { return }
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
