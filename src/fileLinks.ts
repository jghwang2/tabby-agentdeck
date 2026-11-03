import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

/** Shared by all providers in a terminal; never blocks the renderer on filesystem I/O. */
export class FileLinkLookup {
    private cache = new Map<string, {until: number, pending: Promise<string | null>}>()
    constructor (private stat: (file: string) => Promise<{isFile(): boolean}> = file => fs.promises.stat(file)) { }

    async resolve (raw: string, cwd: string | null, refresh = false): Promise<string | null> {
        let file = localLinkPath(raw)
        if (file && /^~[\\/]/.test(file)) { file = path.join(homedir(), file.slice(2)) }
        if (!file || (!path.isAbsolute(file) && !cwd)) { return null }
        // A POSIX server path is not a drive-relative local Windows path.
        if (process.platform === 'win32' && /^\/(?!\/)/.test(file)) { return null }
        const absolute = path.resolve(cwd || '', file)
        let entry = this.cache.get(absolute)
        if (refresh || !entry || entry.until <= Date.now()) {
            if (this.cache.size >= 256) { this.cache.delete(this.cache.keys().next().value) }
            const next = {until: Infinity, pending: null as unknown as Promise<string | null>}
            next.pending = this.stat(absolute).then(info => info.isFile() ? absolute : null, () => null)
                .finally(() => { next.until = Date.now() + 1500 })
            this.cache.set(absolute, next)
            entry = next
        }
        // Slow/network paths cannot hold up the other link providers indefinitely.
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), 200)
            entry!.pending.then(value => { clearTimeout(timer); resolve(value) })
        })
    }
}

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
    cwd?: () => string | null,
): void {
    const x = frontend?.xterm
    if (!x?.registerLinkProvider) { return }
    if (cwd) { frontend.__adFileLinkCwd = cwd }
    const lookup: FileLinkLookup = frontend.__adFileLinkLookup ??= new FileLinkLookup()
    const wrapped: WeakSet<object> = frontend.__adCheckedLinkProviders ??= new WeakSet()
    const allowed = (event: MouseEvent): boolean => {
        const cfg = settings()
        return cfg.enabled && event.button === 0 && (!cfg.modifier || !!(event as any)[cfg.modifier])
    }
    const checkProvider = (provider: any): any => {
        if (wrapped.has(provider)) { return provider }
        wrapped.add(provider)
        const provide = provider.provideLinks.bind(provider)
        provider.provideLinks = (line: number, callback: (links: any[]) => void) => {
            const buffer = x.buffer.active
            const row = buffer.getLine(line - 1)?.translateToString()
            provide(line, (links: any[] | undefined) => {
                void Promise.all((links || []).map(async link => {
                    const target = link.text.replace(/^"|"$/g, '')
                    const candidate = /^(?:file:\/\/|[a-z]:[\\/]|[\\/]|~[\\/])/i.test(target) ? target
                        : fileLinkMatches('"' + target + '"').find(match => match.text === target)?.path
                    if (!candidate) { return link }
                    if (!settings().enabled) { return null }
                    const absolute = await lookup.resolve(candidate, frontend.__adFileLinkCwd?.() ?? null)
                    if (!absolute) { return null }
                    return {...link, activate: (event: MouseEvent) => {
                        if (!allowed(event)) { return }
                        void lookup.resolve(absolute, null, true).then(current => { if (current && allowed(event)) { open(current) } })
                    }}
                })).then(links => callback(buffer === x.buffer.active && row === buffer.getLine(line - 1)?.translateToString()
                    ? links.filter(Boolean) : []), () => callback([]))
            })
        }
        return provider
    }
    if (!frontend.__adFileLinks) { x.registerLinkProvider(checkProvider({
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
    })); frontend.__adFileLinks = true }
    // xterm's OSC provider and Tabby's native file provider must also validate:
    // otherwise they would underline a missing file after our provider declined it.
    for (const provider of x._core?._linkProviderService?.linkProviders ?? []) { checkProvider(provider) }
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
