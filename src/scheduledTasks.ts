/** Count confirmed timer events, never assistant prose or unconfirmed calls. */
export interface ScheduledTask { id: string; prompt: string; recurring: boolean }
export class ScheduledTasks {
    readonly tasks = new Map<string, ScheduledTask>()
    private calls = new Map<string, { name: string; input: any }>()
    private results = new Set<string>()
    private pending = ''
    revision = 0

    feed (chunk: string): void {
        const lines = (this.pending + chunk).split('\n')
        this.pending = lines.pop() || ''
        if (this.pending.length > 4 * 1024 * 1024) { this.pending = '' }
        for (const line of lines) {
            if (!/CronCreate|CronDelete|CronList|tool_result|scheduled_task_fire/.test(line)) { continue }
            try { this.accept(JSON.parse(line)) } catch { /* malformed record */ }
        }
    }

    private accept (record: any): void {
        if (record.isSidechain) { return }
        if (record.type === 'system' && record.subtype === 'scheduled_task_fire') {
            const task = this.tasks.get(record.taskId)
            if (task && !task.recurring) { this.tasks.delete(task.id); this.revision++ }
            return
        }
        const content = record.message?.content
        if (!Array.isArray(content)) { return }
        for (const block of content) {
            if (record.type === 'assistant' && block.type === 'tool_use'
                && ['CronCreate', 'CronDelete', 'CronList'].includes(block.name)) {
                this.calls.set(block.id, { name: block.name, input: block.input || {} })
            }
            if (record.type !== 'user' || block.type !== 'tool_result' || block.is_error
                || this.results.has(block.tool_use_id)) { continue }
            const call = this.calls.get(block.tool_use_id)
            if (!call) { continue }
            const result = record.toolUseResult
            const text = typeof block.content === 'string' ? block.content : ''
            if (call.name === 'CronCreate') {
                const id = result?.id || /^Scheduled (?:one-shot|recurring) task ([\w-]+)/.exec(text)?.[1]
                if (!id) { continue }
                this.tasks.set(id, { id, prompt: String(call.input.prompt || ''),
                    recurring: result?.recurring ?? call.input.recurring ?? true })
            } else if (call.name === 'CronDelete') {
                const id = result?.id || /^Cancelled job ([\w-]+)\./.exec(text)?.[1]
                if (!id) { continue }
                this.tasks.delete(id)
            } else {
                const jobs = Array.isArray(result) ? result : result?.jobs
                if (!Array.isArray(jobs)) { continue }
                this.tasks.clear()
                for (const job of jobs) {
                    if (typeof job.id === 'string') {
                        this.tasks.set(job.id, { id: job.id, prompt: String(job.prompt || ''), recurring: job.recurring !== false })
                    }
                }
            }
            this.results.add(block.tool_use_id)
            this.revision++
        }
    }
}

/** Repeated close requests cannot open another dialog or destroy a tab twice. */
export function guardScheduledClose (tab: { canClose: () => Promise<boolean> }, count: () => Promise<number>,
    confirm: (count: number) => Promise<boolean>): void {
    const original = tab.canClose.bind(tab)
    let pending: Promise<boolean> | undefined
    tab.canClose = () => {
        if (pending) { return Promise.resolve(false) }
        if (!pending) {
            pending = (async () => {
                const n = await count()
                return n > 0 ? confirm(n) : original()
            })().finally(() => { pending = undefined })
        }
        return pending
    }
}
