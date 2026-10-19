const installed = new WeakSet<object>()

/** Finish the committed range before xterm's next key cancels its deferred send. */
export function installImeCommitGuard (frontend: any, enabled: () => boolean): void {
    const xterm = frontend?.xterm
    const helper = xterm?._core?._compositionHelper
    if (!helper || typeof helper.keydown !== 'function' || typeof helper.compositionend !== 'function'
        || !xterm.textarea || installed.has(helper)) { return }
    const original = helper.keydown
    const originalEnd = helper.compositionend
    let pendingStart: number | undefined
    helper.compositionend = function (): void {
        // Another syllable may start and end before the first deferred send runs.
        // Native compositionstart replaces its range, so retain the unsent prefix.
        if (!this._isSendingComposition || pendingStart === undefined) {
            pendingStart = this._compositionPosition?.start
        }
        return originalEnd.call(this)
    }
    helper.keydown = function (event: { keyCode: number }): boolean {
        // These keys leave the native deferred composition path intact.
        if (enabled() && this.isComposing === false && this._isSendingComposition === true
            && ![20, 229, 16, 17, 18].includes(event.keyCode)) {
            const position = this._compositionPosition
            const value = xterm.textarea.value
            const start = pendingStart ?? position?.start
            if (position && typeof value === 'string' && Number.isInteger(start)
                && start >= 0 && start <= value.length) {
                // compositionupdate normally does this on a timer. A queued key can
                // arrive first; native keydown then sends an empty or partial range.
                position.start = start
                position.end = value.length
            }
        }
        const result = original.call(this, event)
        if (!this._isSendingComposition) { pendingStart = undefined }
        return result
    }
    installed.add(helper)
}
