const installed = new WeakSet<object>()

/** Keep composition commits and the key-229 textarea fallback from sending the same range. */
export function installImeCommitGuard (frontend: any, enabled: () => boolean): void {
    const xterm = frontend?.xterm
    const helper = xterm?._core?._compositionHelper
    if (!helper || typeof helper.keydown !== 'function' || typeof helper.compositionend !== 'function'
        || typeof helper.compositionstart !== 'function' || typeof helper._finalizeComposition !== 'function'
        || typeof helper._handleAnyTextareaChanges !== 'function'
        || !xterm.textarea || installed.has(helper)) { return }
    const original = helper.keydown
    const originalEnd = helper.compositionend
    const originalStart = helper.compositionstart
    const originalChanges = helper._handleAnyTextareaChanges
    const originalFinalize = helper._finalizeComposition
    let pendingStart: number | undefined
    let generation = 0
    let commitTicket = 0
    let endedSynchronously = false
    helper.compositionstart = function (): void {
        generation++
        endedSynchronously = false
        return originalStart.call(this)
    }
    helper._handleAnyTextareaChanges = function (): void {
        if (!enabled()) { return originalChanges.call(this) }
        const ticket = generation
        const before = xterm.textarea.value
        setTimeout(() => {
            // A composition owns its text from compositionstart onward. The
            // fallback queued by its initial Process key must not resend it.
            if (ticket !== generation || this.isComposing) { return }
            const after = xterm.textarea.value
            const changed = after.replace(before, '')
            this._dataAlreadySent = changed
            if (after.length > before.length) { this._coreService.triggerDataEvent(changed, true) }
            else if (after.length < before.length) { this._coreService.triggerDataEvent('\x7f', true) }
            else if (after !== before) { this._coreService.triggerDataEvent(after, true) }
        }, 0)
    }
    helper._finalizeComposition = function (defer: boolean): void {
        if (!enabled()) { return originalFinalize.call(this, defer) }
        const wasComposing = this.isComposing
        this._compositionView.classList.remove('active')
        this._isComposing = false
        pendingStart ??= this._compositionPosition.start
        const ticket = ++commitTicket
        const send = (): void => {
            if (ticket !== commitTicket || pendingStart === undefined) { return }
            const value = xterm.textarea.value
            const end = this.isComposing ? this._compositionPosition.start : value.length
            const start = pendingStart + this._dataAlreadySent.length
            pendingStart = undefined
            this._isSendingComposition = false
            const data = value.slice(start, end)
            if (data) { this._coreService.triggerDataEvent(data, true) }
        }
        if (defer) {
            this._isSendingComposition = true
            setTimeout(send, 0)
        } else {
            generation++
            endedSynchronously = wasComposing
            send()
        }
    }
    helper.compositionend = function (): void {
        // xterm can synchronously commit on a normal key while Windows still
        // owes us compositionend. That notification must not send it again.
        if (enabled() && endedSynchronously) {
            endedSynchronously = false
            return
        }
        // Another syllable may start and end before the first deferred send runs.
        // Native compositionstart replaces its range, so retain the unsent prefix.
        if (!this._isSendingComposition || pendingStart === undefined) {
            pendingStart = this._compositionPosition?.start
        }
        return originalEnd.call(this)
    }
    helper.keydown = function (event: { keyCode: number }): boolean {
        // Native key selection still owns IME/modifier exclusion and navigation.
        const result = original.call(this, event)
        if (!this._isSendingComposition) { pendingStart = undefined }
        return result
    }
    installed.add(helper)
}
