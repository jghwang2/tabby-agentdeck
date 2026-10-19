/** Preserve a live TUI: Tabby's default snapshot omits alternate screen and modes. */
export function preserveReloadTerminalState (token: any, panes: any[]): void {
    const terminals = new Map(panes.filter(p => p.session?.open && p.frontend?.serializeAddon)
        .map(p => [p.session.getID(), p.frontend]))
    const visit = (entry: any): void => {
        const frontend: any = terminals.get(entry?.profile?.options?.restoreFromPTYID)
        if (frontend) {
            let state = frontend.serializeAddon.serialize({
                excludeAltBuffer: false, excludeModes: false, scrollback: 1000,
            })
            // xterm's serializer saves mouse tracking, but omits its encoding.
            const encoding = frontend.xterm?._core?.coreMouseService?.activeEncoding
            if (encoding === 'SGR') { state += '\x1b[?1006h' }
            if (encoding === 'SGR_PIXELS') { state += '\x1b[?1016h' }
            entry.savedState = state
        }
        for (const child of entry?.children ?? []) { visit(child) }
    }
    visit(token)
}
