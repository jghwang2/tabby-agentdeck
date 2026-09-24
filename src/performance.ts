import { diag } from './diag'

let sequence = 0
export const perfNow = (): number => performance.now()

/** Infrequent lifecycle operations only; never log terminal contents or recovery tokens. */
export class PerformanceTrace {
    private readonly id = `${Date.now().toString(36)}-${++sequence}`
    private readonly started = perfNow()
    private previous = this.started

    constructor (private operation: string) { this.mark('begin') }

    mark (stage: string, detail = ''): void {
        const now = perfNow()
        diag(`perf op=${this.operation} id=${this.id} stage=${stage}`
            + ` stepMs=${(now - this.previous).toFixed(1)} totalMs=${(now - this.started).toFixed(1)}`
            + (detail ? ` ${detail}` : ''))
        this.previous = perfNow()
    }

    step<T> (stage: string, action: () => T): T {
        const started = perfNow()
        try { return action() } finally {
            this.mark(stage, `workMs=${(perfNow() - started).toFixed(1)}`)
        }
    }
}

let monitoring = false
/** One timer per renderer; report stalls at most once every five seconds. */
export function monitorEventLoop (): void {
    if (monitoring) { return }
    monitoring = true
    let previous = perfNow()
    let reported = -Infinity
    const timer = setInterval(() => {
        const now = perfNow()
        const lag = now - previous - 250
        previous = now
        if (lag >= 250 && now - reported >= 5000) {
            reported = now
            diag(`perf op=event-loop lagMs=${lag.toFixed(1)} visibility=${document.visibilityState}`)
        }
    }, 250)
    window.addEventListener('beforeunload', () => { clearInterval(timer); monitoring = false }, { once: true })
}
