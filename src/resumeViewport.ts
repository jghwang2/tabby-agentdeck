import { ResumeRow } from './sessionLedger'

export const RESUME_ROW_HEIGHT = 44
const VIEWPORT_HEIGHT = 200
const OVERSCAN = 3

/** Keep the complete history in memory, but mount only the visible range. */
export class ResumeViewport {
    private rows: readonly ResumeRow[] = []
    private context = ''
    private emptyLabel = ''
    private top = document.createElement('div')
    private bottom = document.createElement('div')
    private empty = document.createElement('div')
    private mounted = new Map<string, { signature: string, element: HTMLElement }>()
    private scroll = () => this.render()

    constructor (readonly element: HTMLElement, private createRow: (row: ResumeRow) => HTMLElement) {
        this.top.setAttribute('aria-hidden', 'true')
        this.bottom.setAttribute('aria-hidden', 'true')
        this.empty.className = 'ad-resume-empty'
        element.addEventListener('scroll', this.scroll, { passive: true })
    }

    dispose (): void { this.element.removeEventListener('scroll', this.scroll) }

    update (rows: readonly ResumeRow[], context: string, emptyLabel: string): void {
        this.rows = rows
        this.context = context
        this.emptyLabel = emptyLabel
        this.element.style.height = rows.length ? `${Math.min(rows.length * RESUME_ROW_HEIGHT, VIEWPORT_HEIGHT)}px` : ''
        this.element.scrollTop = Math.min(this.element.scrollTop,
            Math.max(0, rows.length * RESUME_ROW_HEIGHT - VIEWPORT_HEIGHT))
        this.render()
    }

    private render (): void {
        const start = Math.max(0, Math.floor(this.element.scrollTop / RESUME_ROW_HEIGHT) - OVERSCAN)
        const end = Math.min(this.rows.length,
            Math.ceil((this.element.scrollTop + VIEWPORT_HEIGHT) / RESUME_ROW_HEIGHT) + OVERSCAN)
        const next = new Map<string, { signature: string, element: HTMLElement }>()
        const elements: HTMLElement[] = [this.top]
        const height = (el: HTMLElement, pixels: number) => {
            const value = `${pixels}px`
            if (el.style.height !== value) { el.style.height = value }
        }
        height(this.top, start * RESUME_ROW_HEIGHT)
        height(this.bottom, (this.rows.length - end) * RESUME_ROW_HEIGHT)
        for (let i = start; i < end; i++) {
            const row = this.rows[i]
            const signature = this.context + JSON.stringify(row)
            const cached = this.mounted.get(row.sessionId)
            const entry = cached?.signature === signature ? cached
                : { signature, element: this.createRow(row) }
            entry.element.style.height = `${RESUME_ROW_HEIGHT}px`
            entry.element.dataset.sessionId = row.sessionId
            next.set(row.sessionId, entry)
            elements.push(entry.element)
        }
        if (!this.rows.length) {
            if (this.empty.textContent !== this.emptyLabel) { this.empty.textContent = this.emptyLabel }
            elements.push(this.empty)
        }
        elements.push(this.bottom)
        const retained = new Set(elements)
        for (const child of Array.from(this.element.children)) {
            if (!retained.has(child as HTMLElement)) { child.remove() }
        }
        let cursor = this.element.firstChild
        for (const element of elements) {
            if (element === cursor) { cursor = cursor.nextSibling }
            else { this.element.insertBefore(element, cursor) }
        }
        this.mounted = next
    }
}
