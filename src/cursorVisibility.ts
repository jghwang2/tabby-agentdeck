/** Codex 0.154.0 + Windows ConPTY emits CSI 25 l (without the DEC '?').
 * xterm only implements DECTCEM as CSI ? 25 l/h. Preserve chunk boundaries
 * so a split hide sequence is repaired as well as a complete one.
 */
import { SynchronizedOutputStream } from './synchronizedOutput'

export class CursorVisibilityStream {
    private pending = ''
    corrections = 0

    write (data: string, enabled: boolean): string {
        let input = this.pending + data
        this.pending = ''
        if (!enabled) { return input }
        const marker = '\x1b[25'
        for (let length = marker.length; length > 0; length--) {
            if (input.endsWith(marker.slice(0, length))) {
                this.pending = input.slice(-length)
                input = input.slice(0, -length)
                break
            }
        }
        return input.replace(/\x1b\[25([lh])/g, (_match, mode) => {
            this.corrections++
            return `\x1b[?25${mode}`
        })
    }
}

/**
 * `CSI Ps SP q` (DECSCUSR) 의 **깜빡이는 스타일을 고정 스타일로** 바꾼다.
 *
 * Codex 0.154.0 은 프레임마다 `ESC [ 0 q` 를 보낸다(`test/cursor.cjs` 의 실측 `lastPacket`).
 * 0 은 "깜빡이는 블록" 이라, 터미널은 시킨 대로 커서를 깜빡인다 — **순정 Tabby 에서도 똑같이
 * 난다**(2026-09-15 유저 확인). 표시/숨김이 아니라 스타일이므로 가시성 필터로는 막을 수 없다.
 *
 * 모양은 그대로 두고 깜빡임만 끈다: 0·1(블록)→2, 3(밑줄)→4, 5(막대)→6.
 */
export class SteadyCursorStyleStream {
    private pending = ''
    changes = 0
    write (data: string, enabled: boolean): string {
        let input = this.pending + data
        this.pending = ''
        if (!enabled) { return input }
        // 청크 경계에 걸친 미완성 `CSI Ps SP q` 는 다음 청크와 이어 붙여야 한다
        const tail = /\x1b(?:\[[0-9]*\x20?)?$/.exec(input)
        if (tail) {
            this.pending = tail[0]
            input = input.slice(0, -tail[0].length)
        }
        return input.replace(/\x1b\[([0-9]*)\x20q/g, (whole, ps) => {
            const n = ps === '' ? 0 : Number(ps)
            if (!Number.isFinite(n) || n > 6) { return whole }
            const steady = n <= 1 ? 2 : (n % 2 === 1 ? n + 1 : n)
            if (steady !== n) { this.changes++ }
            return `\x1b[${steady} q`
        })
    }
}

/** Install at the frontend's write boundary; do not inject into xterm's
 * asynchronously parsed stream or touch the application's saved cursor slot.
 */
export function installCursorVisibilityFix (
    frontend: any, enabled: (data: string) => boolean, onCorrection: () => void,
    onTrace?: (summary: string) => void,
): void {
    if (!frontend || typeof frontend.write !== 'function' || frontend.__adCursorVisibilityFix) { return }
    const counts = { calls: 0, active: 0, forwarded: 0, buffered: 0, timeouts: 0, deferredShows: 0 }
    const original = frontend.write.bind(frontend)
    const stream = new CursorVisibilityStream()
    const style = new SteadyCursorStyleStream()
    const frames = new SynchronizedOutputStream()
    const cursor = new StableCursorStream()
    let timer: ReturnType<typeof setTimeout> | undefined
    let showTimer: ReturnType<typeof setTimeout> | undefined
    const forward = (data: string) => {
        if (!data) { return Promise.resolve() }
        counts.forwarded++
        return original(data)
    }
    /**
     * 화면에 실제로 반영해 둔 커서 표시 상태. `null` = 아직 우리가 건드린 적 없다.
     *
     * 의도(`cursor.visible`)와 따로 쥐는 것이 깜빡임을 없애는 핵심이다 — 그리는 동안
     * 오가는 hide/show 를 그대로 흘리면 화면이 그 속도로 깜빡인다.
     */
    let applied: boolean | null = null
    const settleCursor = () => {
        if (showTimer) { clearTimeout(showTimer); showTimer = undefined }
        if (frames.waiting || cursor.visible === applied) {
            return
        }
        // 프레임 하나가 끝난 뒤에 반영한다 — 같은 버스트 안의 토글은 이미 걷어냈으므로
        // 여기 남는 것은 "정말로 바뀐 의도" 뿐이다. 위치는 애플리케이션 몫이라 건드리지 않는다.
        showTimer = setTimeout(() => {
            showTimer = undefined
            if (cursor.visible === applied) { return }
            applied = cursor.visible
            void Promise.resolve(forward(applied ? '\x1b[?25h' : '\x1b[?25l')).catch(() => {})
        }, 50)
    }
    /**
     * 터미널 옵션을 직접 고정한다 — **스트림만으로는 못 막는 구멍이 있다.**
     *
     * `SteadyCursorStyleStream` 은 *지나가는* `ESC [ 0 q` 를 고쳐 쓴다. 그런데 그 스타일이
     * 우리가 붙기 **전에** 이미 설정돼 있으면(셸이 켜 뒀거나, 정체가 codex 로 잡히기 전에
     * Codex 가 보냈거나, 핫 리로드로 우리만 새로 붙었거나) 고쳐 쓸 시퀀스가 다시 오지 않아
     * 깜빡임이 그대로 남는다 — 2026-09-15 실측: 새 셸의 `cursorBlink` 가 이미 `true` 였다.
     *
     * 그래서 codex pane 인 동안에는 옵션 자체를 꺼 두고, 다른 에이전트로 바뀌면 원래대로 돌린다.
     */
    /**
     * 프레임 끝에 남는 **커서 이동 꼬리**를 잠깐 들고 있다가 다음 write 와 붙여 보낸다.
     *
     * Codex 는 프레임을 커서가 입력줄이 아닌 자리에 놓인 채로 끝내고, 9ms 쯤 뒤에 별도 write
     * 로 입력줄에 되돌린다 (2026-09-15 실측):
     *
     *     2095ms  …⠈ `ESC[10;1H` `ESC[2 q` `ESC[?2026l`   ← 프레임 끝, 커서는 10행 1열
     *     2104ms  `ESC[m` ` ` `ESC[12;3H`                  ← 9ms 뒤 입력줄로 복귀
     *
     * 그 사이에 xterm 이 한 번 그리면 커서가 엉뚱한 자리에 찍혔다가 사라진다 — 270ms 마다
     * 반복되니 사람 눈에는 깜빡임이다. 깜빡임 옵션도 표시/숨김도 아니라서 앞의 두 필터로는
     * 잡히지 않는다(실측: 두 값 모두 0인데 자리는 6초에 14번 바뀌었다).
     *
     * **꼬리만 떼어 미루면 안 된다** — 자리를 바로잡는 이동까지 미뤄져서 커서가 프레임 중간
     * 자리에 더 오래 앉는다 (그렇게 해 봤더니 6초에 14번이던 것이 72번이 됐다). 그래서 덩어리
     * **전체를 잠깐 들고 있다가 다음 write 와 합쳐 한 번에** 넘긴다. xterm 이 한 번에
     * 파싱하므로 중간 자리는 화면에 나타나지 않는다.
     *
     * 꼬리 모양(`ESC[…H`)으로 골라 묶는 것도 안 된다 — 프레임이 `ESC[2C` 같은 상대 이동으로
     * 끝나는 경우가 섞여 있어 절반만 잡힌다(실측 14번 → 7번). 그래서 모양을 따지지 않는다.
     *
     * 뒤가 안 오면 PARK_MS 뒤 그대로 내보내고, 출력이 쉬지 않고 이어질 때를 대비해
     * PARK_MAX_MS 를 넘기면 더 묶지 않는다 — 안 그러면 바쁜 화면에서 출력이 계속 밀린다.
     */
    const PARK_MS = 24
    const PARK_MAX_MS = 48
    let parked = ''
    let parkedAt = 0
    let parkTimer: ReturnType<typeof setTimeout> | undefined
    const park = (output: string, active: boolean): string => {
        if (parkTimer) { clearTimeout(parkTimer); parkTimer = undefined }
        const payload = parked + output
        const since = parked ? parkedAt : 0
        parked = ''
        if (!active || !payload) { return payload }
        if (since && Date.now() - since >= PARK_MAX_MS) { return payload }
        parked = payload
        parkedAt = since || Date.now()
        parkTimer = setTimeout(() => {
            parkTimer = undefined
            const held = parked
            parked = ''
            if (held) { void Promise.resolve(forward(held)).catch(() => {}) }
        }, PARK_MS)
        return ''
    }
    let blinkSaved: boolean | undefined
    const pinBlink = (on: boolean) => {
        const term = frontend.xterm
        if (!term || !term.options) { return }
        if (on) {
            if (blinkSaved === undefined) { blinkSaved = !!term.options.cursorBlink }
            if (term.options.cursorBlink) { term.options.cursorBlink = false }
            return
        }
        if (blinkSaved !== undefined) {
            term.options.cursorBlink = blinkSaved
            blinkSaved = undefined
        }
    }
    frontend.__adCursorVisibilityFix = true
    if (onTrace) {
        onTrace('installed stable-cursor')
        for (const delay of [5000, 15000, 30000]) {
            setTimeout(() => onTrace(JSON.stringify({ ...counts, corrections: stream.corrections,
                steadied: style.changes, waiting: frames.waiting, elapsedMs: delay })), delay)
        }
    }
    frontend.write = (data: string) => {
        const before = stream.corrections
        const active = enabled(data)
        counts.calls++
        if (active) { counts.active++ }
        if (showTimer) { clearTimeout(showTimer); showTimer = undefined }
        pinBlink(active)
        if (!active && applied !== null) {
            // 다른 에이전트로 바뀌었다 — 우리가 눌러 둔 상태를 놓아 준다.
            // 놓지 않으면 그쪽 앱이 보낸 표시 명령과 우리 기억이 어긋난 채로 남는다
            applied = null
        }
        const normalized = style.write(stream.write(data, active), active)
        const beforeShows = cursor.deferredShows
        const output = frames.write(cursor.write(normalized, active), active)
        counts.deferredShows += cursor.deferredShows - beforeShows
        if (onTrace && beforeShows === 0 && cursor.deferredShows > 0) {
            onTrace(`stable-cursor engaged active=${active} deferredShows=${cursor.deferredShows}`)
        }
        if (frames.waiting) { counts.buffered++ }
        // Fixed deadline from the first unfinished frame, even with continuous input.
        if (!frames.waiting && timer) { clearTimeout(timer); timer = undefined }
        if (frames.waiting && !timer) {
            timer = setTimeout(() => {
                timer = undefined
                counts.timeouts++
                void Promise.resolve(forward(park(frames.flush(), true))).catch(() => {})
                settleCursor()
            }, 200)
        }
        if (!before && stream.corrections) { onCorrection() }
        const result = forward(park(output, active))
        if (active) { settleCursor() }
        return result
    }
}

/** ConPTY wraps **every** redraw chunk with DECTCEM hide/show while Codex is
 * still painting. Those toggles are noise, not intent — forwarding them makes the
 * cursor flicker at the redraw rate (2026-09-15 measured: the cursor cell flipped
 * every 100-200ms, 5-10 Hz, during Codex's startup animation).
 *
 * So strip them and keep only the application's **latest intent**. The installer
 * applies a visibility change to the terminal *only when that intent differs from
 * what is already on screen*, so a steady cursor stays steady. Text and position
 * commands pass through untouched.
 */
export class StableCursorStream {
    private pending = ''
    /** 애플리케이션이 마지막으로 말한 의도 — **화면 상태가 아니다** (그건 설치부가 쥔다) */
    visible = true
    /** 걷어낸 표시 명령 수 (진단용) */
    deferredShows = 0
    write (data: string, enabled: boolean): string {
        let input = this.pending + data
        this.pending = ''
        if (!enabled) {
            // 다른 에이전트로 바뀌었다 — 우리가 손대던 것을 그만두고 그대로 흘린다
            return input
        }
        const marker = '\x1b[?25'
        for (let n = marker.length; n > 0; n--) {
            if (input.endsWith(marker.slice(0, n))) {
                this.pending = input.slice(-n)
                input = input.slice(0, -n)
                break
            }
        }
        return input.replace(/\x1b\[\?25([lh])/g, (_match, mode) => {
            this.visible = mode === 'h'
            this.deferredShows++
            return ''
        })
    }
}
