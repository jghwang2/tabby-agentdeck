import { fileURLToPath } from 'url'

export function localLinkPath (raw: string): string | null {
    let value = raw.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/, '')
    if (/^file:\/\//i.test(value)) {
        try { value = fileURLToPath(value) } catch { return null }
    } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
        return null
    }
    return value && !/[\x00-\x1f]/.test(value) ? value : null
}

export function fileLinkMatches (text: string): {start: number, end: number, text: string, path: string}[] {
    // Quoted paths preserve spaces; bare tokens must contain a file extension.
    const re = /\[[^\]\r\n]*\]\(([^)\r\n]+)\)|"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|[^\s<>"'`|\u2500-\u257f]+/g
    const result: {start: number, end: number, text: string, path: string}[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
        const quoted = m[2] ?? m[3] ?? m[4]
        const token = m[1]?.replace(/^<|>$/g, '') ?? quoted ?? m[0].replace(/^[([]+/, '').replace(/[),.;\]}]+$/, '')
        // Tabby's URL handler also recognizes bare www hosts and email addresses.
        if (/^www\./i.test(token) || /^[^@/\\]+@[^/\\]+\.[a-z]+$/i.test(token)) { continue }
        const path = localLinkPath(token)
        if (!path || !/(?:^|[\\/])[^\\/]+\.[a-z][a-z\d]{0,15}$/i.test(path)) { continue }
        const start = m.index + (m[1] !== undefined ? m[0].indexOf('](') + 2 + (m[1].startsWith('<') ? 1 : 0)
            : quoted !== undefined ? 1 : m[0].indexOf(token))
        result.push({start, end: start + token.length, text: token, path})
    }
    return result
}

/** Register on the terminal itself so wrapped lines, scrollback and selection use xterm's link handling. */
export function installFileLinks (
    frontend: any, settings: () => {enabled: boolean, modifier: string | null}, open: (file: string) => void,
): void {
    const x = frontend?.xterm
    if (!x?.registerLinkProvider) { return }
    const allowed = (event: MouseEvent): boolean => {
        const cfg = settings()
        return cfg.enabled && event.button === 0 && (!cfg.modifier || !!(event as any)[cfg.modifier])
    }
    if (!frontend.__adFileLinks) { x.registerLinkProvider({
        provideLinks: (lineNumber: number, callback: (links: any[]) => void) => {
            if (!settings().enabled) { callback([]); return }
            const buffer = x.buffer.active
            let first = lineNumber - 1
            let last = first
            while (first > 0 && buffer.getLine(first)?.isWrapped && last - first < 64) { first-- }
            while (buffer.getLine(last + 1)?.isWrapped && last - first < 64) { last++ }
            let text = ''
            const positions: {x: number, y: number}[] = []
            for (let row = first; row <= last; row++) {
                const line = buffer.getLine(row)
                for (let col = 0; col < x.cols; col++) {
                    const cell = line?.getCell(col)
                    if (!cell || cell.getWidth() === 0) { continue }
                    const chars = cell.getChars() || ' '
                    for (let i = 0; i < chars.length; i++) { positions.push({x: col + 1, y: row + 1}) }
                    text += chars
                }
            }
            callback(fileLinkMatches(text).map(match => ({
                text: match.text,
                range: {start: positions[match.start], end: positions[match.end - 1]},
                activate: (event: MouseEvent) => { if (allowed(event)) { open(match.path) } },
            })).filter(link => link.range.start.y <= lineNumber && link.range.end.y >= lineNumber))
        },
    }); frontend.__adFileLinks = true }
    // OSC 8 hyperlinks have priority over providers. Preserve non-file handlers.
    const original = x.options.linkHandler
    if (original === frontend.__adFileLinkHandler) { return }
    x.options.linkHandler = {
        ...original,
        allowNonHttpProtocols: true,
        activate: (event: MouseEvent, uri: string, range: any) => {
            if (/^file:\/\//i.test(uri)) {
                const path = localLinkPath(uri)
                if (path && allowed(event)) { open(path) }
            } else if (original?.allowNonHttpProtocols || /^https?:\/\//i.test(uri)) {
                if (original?.activate) { original.activate(event, uri, range) }
                else if (allowed(event)) { window.open(uri, '_blank', 'noopener,noreferrer') }
            }
        },
    }
    frontend.__adFileLinkHandler = x.options.linkHandler
}
