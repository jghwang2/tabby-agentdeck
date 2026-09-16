/**
 * Codex 세션 기록(rollout jsonl)에서 "지금 이 탭" 줄에 쓸 값을 뽑는다.
 *
 * **왜 다른 경로인가** — Claude Code 는 `statusLine` 이라는 통보 창구가 있어 그쪽 입력을 베끼면
 * 되지만(`hooks/agentdeck-statusline.mjs`), Codex 에는 그런 것이 없다. 대신 Codex 는 자기 세션
 * 기록에 같은 값을 남긴다(2026-09-14 실측, `~/.codex/sessions/…/rollout-*.jsonl`):
 *
 *   `turn_context`            → `model: "gpt-6-astra"` · `effort: "low"` (턴마다 새로 나온다)
 *   `session_meta`            → `cwd` · `cli_version` (+ 옛 버전은 `context_window` 가 **숫자**)
 *   `event_msg`/`token_count` → `rate_limits.primary/secondary` (`used_percent`·`window_minutes`·`resets_at`)
 *                               `info.last_token_usage.total_tokens` · `info.model_context_window`
 *
 * **창 크기가 사는 곳이 버전마다 다르다.** 0.154.0 부터 `session_meta.context_window` 는 숫자가
 * 아니라 `{window_id: "…"}` 객체이고, 진짜 토큰 수는 `token_count.info.model_context_window` 로
 * 옮겨 갔다 (2026-09-14 실측, gpt-6-astra / cli 0.154.0: `{"window_id":"01a09f5e-…"}` 와 `258400`).
 * 그래서 둘 다 읽는다 — 하나만 읽으면 그 버전에서 컨텍스트% 칸이 통째로 사라진다.
 *
 * **이 파일은 순수하다** — fs·DOM·tabby 를 건드리지 않는다(`agents.ts`·`meta.ts` 와 같은 규칙).
 * 줄을 먹이면 상태가 갱신되고, 서비스 쪽은 파일을 증분으로 읽어 그 줄만 넘긴다.
 */

/** 한도 한 칸 — Codex 는 창 길이를 분으로 준다 */
export interface CodexWindow {
    pct: number
    /** 창 길이(분). 300 = 5시간, 10080 = 7일 */
    windowMinutes: number
    /** 리셋 시각 (epoch **초**) */
    resetsAt: number
}

export interface CodexState {
    model: string
    effort: string
    cwd: string
    cliVersion: string
    /**
     * 세션의 컨텍스트 창 크기(토큰). Codex 가 안 적어 주는 버전도 있다.
     * 0.154.0 부터는 `session_meta` 가 아니라 `token_count.info.model_context_window` 가 원천이다
     */
    contextWindow: number
    /** 마지막 요청이 쓴 토큰 — 컨텍스트 사용률의 분자 */
    lastTokens: number
    primary: CodexWindow | null
    secondary: CodexWindow | null
    /**
     * 개행으로 끝나지 않은 마지막 조각 — 다음 청크 앞에 이어 붙인다.
     *
     * **증분 읽기에는 이게 반드시 있어야 한다.** 서비스는 2초마다 `size - lastSize` 만큼 읽는데
     * Codex 는 그동안에도 쓰고 있어 읽은 청크의 마지막 줄은 대개 미완성이다. 이어 붙이지 않으면
     * 그 줄을 버리는데 `lastSize` 는 이미 전진했으므로 **나머지 절반도 다음 판에서 버려진다** —
     * 턴 끝의 마지막 `token_count`(한도·컨텍스트%)가 통째로 유실돼 값이 옛 상태로 굳는다
     * (2026-09-15 코드리뷰 지적). `subagents.ts` 의 `feedChunk` 가 같은 이유로 같은 것을 한다.
     */
    pending: string
    /** 먹인 줄 수 / 버린 줄 수 (진단용) */
    lines: number
    skipped: number
    /** `MAX_PENDING` 을 넘겨 버린 꼬리 수 (진단용 — 0 이 아니면 뭔가 이상하다) */
    dropped: number
}

/**
 * 개행 없이 들고 있을 꼬리의 상한. 넘으면 버린다 — 파일이 이상해져 개행이 영영 안 오면
 * 메모리가 계속 늘기 때문이다 (`subagents.ts` 의 `MAX_PENDING` 과 같은 이유).
 */
const MAX_PENDING = 2 * 1024 * 1024

export function createCodexState (): CodexState {
    return {
        model: '', effort: '', cwd: '', cliVersion: '',
        contextWindow: 0, lastTokens: 0,
        primary: null, secondary: null, pending: '', lines: 0, skipped: 0, dropped: 0,
    }
}

function num (v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

function windowOf (raw: any): CodexWindow | null {
    if (!raw || typeof raw !== 'object') {
        return null
    }
    const pct = Number(raw.used_percent)
    if (!Number.isFinite(pct)) {
        return null
    }
    return {
        pct: Math.max(0, Math.min(100, Math.round(pct))),
        windowMinutes: num(raw.window_minutes),
        resetsAt: num(raw.resets_at),
    }
}

/**
 * 줄 하나를 먹인다. **마지막 값이 이긴다** — `turn_context` 는 턴마다, `token_count` 는 요청마다
 * 새로 나오므로 나중 줄이 지금 상태다. 못 읽는 줄은 세기만 하고 버린다(증분 읽기의 반쪽 줄).
 */
export function feedCodexLine (state: CodexState, line: string): void {
    const text = line.trim()
    if (!text) {
        return
    }
    let rec: any
    try {
        rec = JSON.parse(text)
    } catch {
        state.skipped++
        return
    }
    state.lines++
    const payload = rec?.payload ?? {}
    const type = String(rec?.type ?? '')
    if (type === 'session_meta') {
        state.cwd = String(payload.cwd ?? state.cwd)
        state.cliVersion = String(payload.cli_version ?? state.cliVersion)
        state.contextWindow = num(payload.context_window) || state.contextWindow
        return
    }
    if (type === 'turn_context') {
        state.model = String(payload.model ?? state.model)
        // effort 는 없는 버전이 있다(`null`) — 그때는 직전 값을 지우지 않는다
        if (payload.effort) {
            state.effort = String(payload.effort)
        }
        state.cwd = String(payload.cwd ?? state.cwd)
        return
    }
    if (payload?.type === 'token_count') {
        const limits = payload.rate_limits
        if (limits) {
            // **비어 온 한도는 직전 값을 지우지 않는다** — Codex 는 `primary: null` 인 token_count 도 보낸다
            state.primary = windowOf(limits.primary) ?? state.primary
            state.secondary = windowOf(limits.secondary) ?? state.secondary
        }
        // 0.154.0 부터 창 크기가 여기로 왔다 (`session_meta.context_window` 는 객체가 됐다).
        // 옛 버전에는 이 키가 없으므로 값이 있을 때만 덮는다 — 없다고 지우면 안 된다
        const win = num(payload.info?.model_context_window)
        if (win > 0) {
            state.contextWindow = win
        }
        const used = payload.info?.last_token_usage?.total_tokens
        if (Number.isFinite(Number(used))) {
            state.lastTokens = Number(used)
        }
    }
}

export function feedCodexChunk (state: CodexState, chunk: string): void {
    const text = typeof chunk === 'string' ? chunk : ''
    if (!text) {
        return
    }
    const parts = (state.pending + text).split('\n')
    // 마지막 조각은 개행이 없었다는 뜻 = 아직 쓰이는 중 (`CodexState.pending` 주석).
    // 청크가 개행으로 끝났으면 빈 문자열이 된다
    state.pending = parts.pop() ?? ''
    if (state.pending.length > MAX_PENDING) {
        state.dropped++
        state.pending = ''
    }
    for (const line of parts) {
        feedCodexLine(state, line)
    }
}

/** 컨텍스트 사용률(%) — 창 크기를 모르면 null (지어내지 않는다) */
export function codexContextPct (state: CodexState): number | null {
    if (state.contextWindow <= 0 || state.lastTokens <= 0) {
        return null
    }
    return Math.max(0, Math.min(100, Math.round((state.lastTokens / state.contextWindow) * 100)))
}

/**
 * 한도 두 칸을 Claude 쪽과 **같은 자리**(5시간/7일)에 맞춘다.
 *
 * Codex 는 이름 대신 창 길이(분)를 주므로 그 값으로 가른다 — 실측은 `primary: 300분`(5시간),
 * `secondary: 10080분`(7일)이다. 길이가 그 둘이 아니면 **넣지 않는다**: 다른 길이의 값을 `5h` 자리에
 * 그리면 화면이 거짓말을 한다.
 */
export function codexLimits (state: CodexState): {
    fiveHourPct: number | null, fiveHourResetsAt: number,
    sevenDayPct: number | null, sevenDayResetsAt: number,
} {
    const pick = (minutes: number): CodexWindow | null =>
        [state.primary, state.secondary].find(w => w && w.windowMinutes === minutes) ?? null
    const five = pick(300)
    const seven = pick(10080)
    return {
        fiveHourPct: five ? five.pct : null,
        fiveHourResetsAt: five ? five.resetsAt : 0,
        sevenDayPct: seven ? seven.pct : null,
        sevenDayResetsAt: seven ? seven.resetsAt : 0,
    }
}

/**
 * Codex 계정 메일 — `~/.codex/auth.json` 의 `tokens.id_token`(JWT) 가운데 조각에 들어 있다.
 *
 * **서명을 확인하지 않는다.** 이건 인증이 아니라 "지금 이 컴퓨터가 누구로 로그인돼 있나" 를
 * 화면에 적기 위한 읽기다. 토큰 자체는 어디에도 싣지 않는다.
 */
export function emailFromIdToken (jwt: string | null | undefined): string {
    const part = String(jwt ?? '').split('.')[1]
    if (!part) {
        return ''
    }
    try {
        const pad = part.length % 4 ? '='.repeat(4 - (part.length % 4)) : ''
        const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8')
        return String(JSON.parse(json)?.email ?? '')
    } catch {
        return ''
    }
}
