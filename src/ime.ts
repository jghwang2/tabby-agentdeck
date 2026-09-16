/**
 * 한글 조합 중에 우리가 PTY 로 바이트를 써도 되는 시점인지 가른다.
 *
 * 증상: 조합 중인 마지막 음절이 **커서를 따라간다.** Home/End 를 누르면 그 음절이 옮겨간
 * 자리에 찍히고, Shift+Enter 를 누르면 새 줄로 따라간다 (2026-09-08 사용자 재보고).
 * 방향키(←→)만 멀쩡한데, 그 차이가 곧 원인이다.
 *
 * xterm 의 조합 확정에는 **동기·비동기 두 경로**가 있다
 * (`node_modules/tabby-terminal/dist/index.js:44087~44121`, CompositionHelper):
 *
 *   keydown(t)            → 조합 중이면 `_finalizeComposition(false)` = **지금 바로** triggerDataEvent
 *   compositionend()      → `_finalizeComposition(true)`  = `setTimeout(…, 0)` 에서 triggerDataEvent
 *
 * 방향키는 xterm 의 키 경로를 타므로 `keydown()` 이 먼저 동기 확정을 하고 그 뒤에 키를 보낸다 —
 * 글자 먼저, 이동 나중이라 순서가 맞는다. 반대로 **xterm 을 거치지 않고 pty 에 직접 쓰는 경로**
 * (Tabby 핫키의 `sendInput('\x1b[H')`, 우리 `sendNewline()` 의 `sendInput('\n')`)는 동기 확정을
 * 트리거하지 않는다. 확정이 `compositionend` 의 setTimeout 으로 밀리는 동안
 * (`_isSendingComposition === true`) 우리 바이트가 먼저 나가고 음절이 한 틱 뒤에 붙는다.
 *
 * 0.3.0 에서 Home/End 를 핫키에서 놓아준 것(`releaseHomeEndHotkey`)만으로는 부족했다 —
 * 실사용 `%APPDATA%\tabby\config.yaml:71-72` 가 `home: []` / `end: []` 인데도 재발했다.
 * 그래서 한 겹 더 내려가, **바이트를 쓰기 직전에 조합 상태를 보고 순서를 맞춘다.**
 *
 * 여기는 순수 로직만 둔다(테스트로 고정). DOM·xterm 접근은 인자로 받은 객체로만 한다 —
 * `screen.ts` / `prompt.ts` 와 같은 관례다.
 */

/**
 * 조합 상태 — 지금 pty 에 바이트를 써도 되는지 가른다.
 *
 *  - `composing` : 조합이 진행 중이다 (동기 확정을 시킬 수 있다)
 *  - `pending`   : 확정 텍스트 전송이 `setTimeout(…, 0)` 에 예약돼 있다 (우리가 끼어들면 안 된다)
 *  - `idle`      : 조합과 무관하다
 *  - `unknown`   : 헬퍼를 못 찾았거나 내부 구조가 바뀌었다 (지금까지의 동작으로 떨어진다)
 */
export type CompositionState = 'idle' | 'composing' | 'pending' | 'unknown'

/**
 * 우리 바이트를 언제 보낼지.
 *
 * - `now`               : 지금 바로
 * - `after-composition` : **조합이 끝난 뒤**에 (조합 중일 때)
 * - `defer`             : 한 틱 뒤에 (확정 전송이 이미 예약돼 있을 때)
 * - `flush-then-now`    : 동기 확정시키고 바로 (조합이 끝나지 않는 비상 경로에서만)
 */
export type SendPlan = 'now' | 'after-composition' | 'defer' | 'flush-then-now'

/**
 * xterm 의 CompositionHelper 에서 **우리가 쓰는 부분만** 추린 최소 형태.
 *
 * 최소화된 빌드의 내부 객체라 필드가 언제든 사라질 수 있으므로 전부 옵셔널로 둔다.
 * 테스트에서는 이 모양의 가짜 객체를 넣는다.
 */
export interface CompositionHelperLike {
    isComposing?: boolean
    _isSendingComposition?: boolean
    _compositionPosition?: { start: number, end: number }
    keydown? (e: { keyCode: number }): boolean
}

/**
 * 조합 헬퍼의 **살아있는 상태**를 읽는다.
 *
 * 키보드 이벤트의 `isComposing` / 수식키 필드를 믿으면 안 된다 — 한글 IME 가 조합을 확정하며
 * 이벤트를 한 번 삼키고 뒤이어 내보내는 이벤트에는 상태를 싣지 않는다
 * (2026-09-08 실측: Shift+Enter 의 Enter 가 `shiftKey=false` 로 도착, `claimShiftEnterKey` 주석).
 * 그래서 판정 근거는 이벤트가 아니라 헬퍼가 지금 들고 있는 값이다.
 */
export function readCompositionState (helper: CompositionHelperLike | null | undefined): CompositionState {
    if (!helper || typeof helper !== 'object') {
        return 'unknown'
    }
    try {
        // `isComposing` 은 getter(`get isComposing() { return this._isComposing }`)라 읽기만 해도
        // 던질 수 있는 자리다 — 전체를 try 로 감싼다.
        if (helper.isComposing === true) {
            return 'composing'
        }
        // 조합은 끝났는데 확정 텍스트가 아직 setTimeout 대기 중이다 — 이 틈이 버그의 정체다
        if (helper._isSendingComposition === true) {
            return 'pending'
        }
        // 두 필드 중 하나라도 실제 boolean 으로 읽혔다면 "조합 아님" 을 확인한 것이다
        if (typeof helper.isComposing === 'boolean' || typeof helper._isSendingComposition === 'boolean') {
            return 'idle'
        }
    } catch {
        return 'unknown'
    }
    // 필드가 둘 다 없다 = xterm 내부가 바뀌었다. 아무것도 단정하지 않는다
    return 'unknown'
}

/**
 * 그 상태에서 우리 바이트를 언제 보내야 하나.
 *
 * `unknown` 이 `now` 인 것이 중요하다 — 이 훅은 순서를 맞추려고 얹은 것이고, 상태를 못 읽었을 때
 * 정상 입력을 막아서는 절대 안 된다. 못 읽으면 0.4.0 까지의 동작 그대로 간다.
 */
export function planSend (state: CompositionState): SendPlan {
    if (state === 'composing') {
        // **조합이 끝날 때까지 기다린다.**
        //
        // 0.5.0 은 여기서 `flush-then-now`(동기 확정시키고 바로 쓰기)를 했는데 그것만으로는
        // 부족했다 — 우리가 확정시켜도 **IME 는 자기 일정대로 `compositionend` 를 또 쏘고**,
        // xterm 이 그때 비동기 경로로 음절을 한 번 더 보낸다(`_finalizeComposition(true)`).
        // 그 두 번째 전송이 우리 개행 뒤에 나가면 **음절이 새 줄로 내려간다** — 사용자가
        // 신고한 그 증상이다 (2026-09-08: 하네스에서 `한` → `ESC[H` → `한` 순서로 실측).
        //
        // 그래서 확정을 재촉하지 않고 IME 의 생애주기를 그대로 둔다. 음절은 자기 경로로
        // 한 번만 나가고, 우리 바이트는 그 뒤에 붙는다.
        return 'after-composition'
    }
    if (state === 'pending') {
        // 예약된 전송을 앞당길 방법이 없으므로 **우리가 뒤로 물러난다.**
        // 같은 setTimeout(…, 0) 큐의 뒤에 붙으므로 음절이 먼저 나간다.
        return 'defer'
    }
    return 'now'
}

/**
 * 조합을 **동기 확정**시킨다. 성공하면 true.
 *
 * 왜 `keydown()` 인가 — 실제로 확정하는 것은 `_finalizeComposition(false)` 지만 그건 private 이고
 * 최소화 빌드에서 이름이 바뀔 수 있다. `keydown` 은 xterm 코어가 밖에서 부르는 공개 표면이라
 * (`tabby-terminal/dist/index.js:50225` `this._compositionHelper.keydown(e)`) 최소화를 넘어 살아남는다.
 * 조합 중에 아무 키나 들어오면 동기 확정한다는 성질이 곧 방향키가 멀쩡한 이유이므로,
 * **방향키가 하는 일을 그대로 흉내내는 것**이 가장 안전하다.
 *
 * `keyCode: 0` 을 쓰는 이유 — 20(한/영)·229(IME)·16/17/18(Shift/Ctrl/Alt)은 헬퍼가 확정 없이
 * 빠져나가는 값이고, 229 는 `_handleAnyTextareaChanges()` 까지 부른다. 0 은 그 어느 것도 아니다.
 *
 * 낡은 `end` 보정 — 동기 경로는
 * `value.substring(_compositionPosition.start, _compositionPosition.end)` 를 보내는데, `end` 는
 * `compositionupdate` 의 `setTimeout(…, 0)` 에서만 갱신된다(`index.js:44092`). 첫 음절을 치고
 * 바로 Home 을 누르면 `end` 가 아직 0(또는 start 이하)이라 **빈 문자열이 나가 음절이 통째로
 * 유실된다.** 그래서 확정 직전에 `textarea.value.length` 로 메워 준다.
 *
 * @param textLength `xterm.textarea.value.length` — 낡은 `end` 를 메울 값
 */
export function flushComposition (helper: CompositionHelperLike | null | undefined, textLength: number): boolean {
    if (!helper || typeof helper.keydown !== 'function') {
        return false
    }
    try {
        const pos = helper._compositionPosition
        if (pos
            && typeof pos.start === 'number'
            && typeof pos.end === 'number'
            && pos.end <= pos.start
            && typeof textLength === 'number'
            && isFinite(textLength)
            && textLength > pos.start) {
            pos.end = textLength
        }
        helper.keydown({ keyCode: 0 })
        return true
    } catch {
        // xterm 내부가 바뀌었다 — 확정을 못 했다고만 알리고 예외는 밖으로 내보내지 않는다
        return false
    }
}
