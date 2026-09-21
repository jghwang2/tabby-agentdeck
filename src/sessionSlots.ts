/** Human navigation only. Never pass a slot to a messaging transport. */
export class SessionSlots<T> {
    private slots: Array<T | null> = Array(9).fill(null)

    reconcile (sessions: readonly T[], preferred: (session: T) => number | null = () => null): void {
        const live = new Set(sessions)
        this.slots = this.slots.map(value => value !== null && live.has(value) ? value : null)
        for (const session of sessions) {
            if (this.slots.includes(session)) { continue }
            const number = preferred(session)
            if (number !== null && Number.isInteger(number) && number >= 1 && number <= 9 && this.slots[number - 1] === null) {
                this.slots[number - 1] = session
            }
        }
        for (const session of sessions) {
            if (this.slots.includes(session)) { continue }
            const free = this.slots.indexOf(null)
            if (free < 0) { break }
            this.slots[free] = session
        }
    }

    numberOf (session: T): number | null {
        const index = this.slots.indexOf(session)
        return index < 0 ? null : index + 1
    }

    get (number: number): T | null {
        return Number.isInteger(number) && number >= 1 && number <= 9 ? this.slots[number - 1] : null
    }

    get full (): boolean { return !this.slots.includes(null) }
    get occupied (): number { return this.slots.filter(value => value !== null).length }
}
