/** xterm's Windows Alt+Up mapping emits Ctrl+Up. Codex uses Alt+Up
 * to open queued questions; preserve the modifier for that CLI only. */
export function installCodexKeys (
    frontend: any, enabled: () => boolean, send: (data: string) => void,
): void {
    const element = frontend?.xterm?.element as HTMLElement | undefined
    if (!element || frontend.__adCodexKeys) { return }
    frontend.__adCodexKeys = true
    element.addEventListener('keydown', event => {
        if (!enabled() || event.key !== 'ArrowUp' || !event.altKey
            || event.ctrlKey || event.shiftKey || event.metaKey || event.isComposing) { return }
        event.preventDefault()
        event.stopImmediatePropagation()
        send('\x1b[1;3A')
    }, { capture: true })
}
