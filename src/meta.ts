/**
 * 사이드바 하단 "지금 이 탭" 줄의 **문구 규칙**.
 *
 * 왜 따로 빼나 — 이 줄은 200px 폭에 모델·effort·계정·컨텍스트%·한도 2종을 넣어야 해서
 * 줄이는 규칙(어디를 먼저 버리나)이 곧 화면의 전부다. `deck.service` 안에 두면 DOM 없이는
 * 검증할 수 없고, 그 파일은 이미 5천 줄이 넘는다. 여기는 **순수 모듈이다** — DOM·fs·tabby 를
 * 건드리지 않으므로 노드에서 바로 돌려볼 수 있다 (`agents.ts` 와 같은 규칙).
 */

/** `notify.service` 의 AgentMeta 중 이 모듈이 쓰는 부분만 (역참조를 만들지 않으려고 구조만 맞춘다) */
export interface MetaInput {
    agent?: string
    model?: string
    modelId?: string
    effort?: string
    version?: string
    fastMode?: boolean
    account?: string
    org?: string
    cwd?: string
    contextPct?: number | null
    limits?: {
        fiveHourPct?: number | null
        fiveHourResetsAt?: number
        sevenDayPct?: number | null
        sevenDayResetsAt?: number
        /**
         * 모델별 주간 한도 (Fable 등). statusLine stdin 에는 **안 내려온다** —
         * 래퍼가 `/api/oauth/usage` 를 따로 물어봐 채운다 (hooks/agentdeck-statusline.mjs).
         * 이름은 계정마다 다를 수 있으므로 화면에 쓸 표시명도 같이 받는다.
         */
        scopedName?: string
        scopedPct?: number | null
        scopedResetsAt?: number
    }
}

/** 한도 한 칸 — 화면에 그릴 글자와 "얼마나 급한가" */
export interface MetaGauge {
    /** `5h` / `7d` / `ctx` */
    key: string
    text: string
    pct: number
    /** ok / warn(60%+) / hot(85%+) — 색만 가른다 */
    level: 'ok' | 'warn' | 'hot'
    /** 리셋까지 남은 시간을 말로 (없으면 빈 문자열) */
    resetText: string
    /**
     * 막대 **아래 줄**에 그대로 찍는 글자 — `4시간 13분 뒤`. 마우스를 올리지 않아도 보여야 하는데
     * (2026-09-14 유저 요청), 막대 뒤에 붙이면 막대가 그만큼 짧아지고 글자도 작아진다.
     * `resetText` 에서 `리셋` 만 뺀 것이라 tooltip 과 값이 어긋날 수 없다.
     */
    resetLine: string
}

export interface MetaView {
    /** 첫 줄 — `Opus 5 · high`. 비면 줄 자체를 그리지 않는다 */
    title: string
    /** 둘째 줄 — 계정. 없으면 빈 문자열 */
    account: string
    gauges: MetaGauge[]
    /** 마우스를 올렸을 때 나올 전문 */
    tooltip: string
}

/** 에이전트 이름 — 모델 이름만으로는 Claude 인지 Codex 인지 모른다 */
const AGENT_LABEL: Record<string, string> = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
}

function levelOf (pct: number): 'ok' | 'warn' | 'hot' {
    if (pct >= 85) {
        return 'hot'
    }
    return pct >= 60 ? 'warn' : 'ok'
}

/**
 * 리셋까지 남은 시간. `resets_at` 은 **초** 단위 epoch 다 (statusLine stdin 실측).
 *
 * 절대 시각(`12시`) 대신 남은 시간으로 쓰는 이유 — 이 줄은 "지금 얼마나 여유가 있나" 를
 * 보는 자리다. 시각을 보려면 머릿속에서 한 번 빼야 한다.
 */
export function formatReset (resetsAt: number, now: number): string {
    if (!Number.isFinite(resetsAt) || resetsAt <= 0) {
        return ''
    }
    const left = resetsAt * 1000 - now
    if (left <= 0) {
        return '곧 리셋'
    }
    const min = Math.round(left / 60000)
    if (min < 60) {
        return `${Math.max(1, min)}분 뒤 리셋`
    }
    const hour = Math.floor(min / 60)
    if (hour < 24) {
        const rest = min % 60
        return rest ? `${hour}시간 ${rest}분 뒤 리셋` : `${hour}시간 뒤 리셋`
    }
    return `${Math.floor(hour / 24)}일 ${hour % 24}시간 뒤 리셋`
}

/**
 * 막대 아래 줄에 쓰는 꼴 — `4시간 13분 뒤`. 없으면 빈 문자열.
 *
 * `formatReset` 에서 끝의 `리셋` 만 뗀다. 같은 규칙을 두 번 적지 않으려는 것이다 —
 * 두 벌이면 한쪽만 고쳐 놓고 화면과 tooltip 이 다른 시각을 말하는 날이 온다.
 */
export function formatResetLine (resetsAt: number, now: number): string {
    return formatReset(resetsAt, now).replace(/\s*리셋$/, '')
}

function gauge (key: string, label: string, pct: unknown, resetsAt: number, now: number): MetaGauge | null {
    // **모르는 값(null)과 0% 를 갈라야 한다.** 둘 다 흔한 화면이고 뜻이 정반대다 —
    // 한도를 하나도 안 쓴 주(0%)와 래퍼가 그 값을 못 받은 것(null).
    // `Number(null)` 은 **0** 이라 Number.isFinite 만으로는 안 갈라진다(실측: 이 줄을
    // 그냥 두었다가 회귀 `모르는 값(null)은 칸을 만들지 않는다` 가 잡았다).
    if (pct === null || pct === undefined || pct === '') {
        return null
    }
    const n = Number(pct)
    if (!Number.isFinite(n)) {
        return null
    }
    const rounded = Math.max(0, Math.min(100, Math.round(n)))
    return {
        key,
        text: `${label} ${rounded}%`,
        pct: rounded,
        level: levelOf(rounded),
        resetText: formatReset(resetsAt, now),
        resetLine: formatResetLine(resetsAt, now),
    }
}

/**
 * 보고 하나를 화면에 그릴 것으로 바꾼다.
 *
 * **없는 값은 지어내지 않는다** — 모델을 모르면 빈 제목을 내고, 부르는 쪽이 줄을 통째로
 * 접는다. "알 수 없음" 을 그려 두면 그 줄이 항상 자리를 차지해서 "래퍼가 안 걸렸다" 와
 * "래퍼는 걸렸는데 값이 안 온다" 가 화면에서 같아 보인다.
 */
export function formatMeta (meta: MetaInput | null | undefined, now: number): MetaView | null {
    if (!meta) {
        return null
    }
    const model = String(meta.model || meta.modelId || '').trim()
    if (!model) {
        return null
    }
    const agent = AGENT_LABEL[String(meta.agent || '').toLowerCase()] ?? ''
    const effort = String(meta.effort || '').trim()
    const title = [agent, model, effort].filter(Boolean).join(' · ')
        + (meta.fastMode ? ' ⚡' : '')

    const lim = meta.limits ?? {}
    // 모델별 주간 한도는 이름이 계정마다 다르다(Fable …). 못 받았으면 칸 자체가 안 생긴다
    const scoped = String(lim.scopedName || '').trim().toLowerCase()
    const gauges = [
        gauge('ctx', 'ctx', meta.contextPct, 0, now),
        gauge('5h', '5h', lim.fiveHourPct, Number(lim.fiveHourResetsAt) || 0, now),
        gauge('7d', '7d', lim.sevenDayPct, Number(lim.sevenDayResetsAt) || 0, now),
        scoped ? gauge(scoped, scoped, lim.scopedPct, Number(lim.scopedResetsAt) || 0, now) : null,
    ].filter((g): g is MetaGauge => !!g)

    const account = String(meta.account || '').trim()
    const tooltip = [
        title,
        account ? `계정: ${account}${meta.org ? ` (${meta.org})` : ''}` : '',
        meta.version ? `버전: ${meta.version}` : '',
        meta.cwd ? `폴더: ${meta.cwd}` : '',
        ...gauges.map(g => (g.resetText ? `${g.text} — ${g.resetText}` : g.text)),
    ].filter(Boolean).join('\n')

    return { title, account, gauges, tooltip }
}
