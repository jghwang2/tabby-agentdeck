/**
 * 승인대기 이유 줄이기 — Notification 훅의 message 원문을 배지에 붙일 짧은 한국어로 바꾼다.
 *
 * 훅(hooks/agentdeck-notify.ps1)은 원문을 그대로 보내고, 줄이는 규칙은 여기 한 곳에만 둔다.
 * Claude Code 가 문구를 바꾸면 이 파일만 고치면 되고, 훅을 다시 설치할 필요가 없다.
 *
 * **훅이 없는 CLI 는 화면에서 온다** — `reasonFromScreen` 이 그 입구다(ANSI·테두리를 벗기고
 * 같은 축약 표를 태운다). 규칙을 두 곳에 두면 한쪽만 고쳐지므로 사본을 만들지 않는다.
 *
 * 알려진 문구 (2026-09 기준):
 *   "Claude needs your permission to use Bash"  -> "Bash 권한"
 *   "Claude is waiting for your input"           -> "입력 대기"
 *   "Allow execution of [Shell]?" (Gemini CLI 화면) -> "Shell 권한"
 *   플랜 승인 / 질문 응답도 같은 요령으로 잡는다.
 *   한도 도달(StopFailure error=rate_limit 의 last_assistant_message):
 *   "You've hit your session limit · resets 12pm (Asia/Seoul)" -> "12pm 리셋"
 *   리셋 시각이 없으면 빈 값 — 배지가 이미 `⛔ 한도 도달` 이라 같은 말을 되풀이하지 않는다.
 * 모르는 문구는 앞 24자만 남긴다 — 배지 한 줄을 넘기지 않기 위해서다.
 */

/** 모르는 문구를 잘라 낼 길이 */
const UNKNOWN_MAX = 24

export function shortenReason (msg: string): string {
    const m = (msg || '').replace(/\s+/g, ' ').trim()
    if (!m) {
        return ''
    }
    // 선택지 줄은 이유가 아니다 — `❯ 1. Yes`(claude) / `● 1. Allow once`(gemini 국면③ 원문).
    // 화면 경로에서는 커서만 움직인 재그리기 조각에 **이 줄만** 담겨 오는 일이 있는데, 그것을
    // 이유로 삼으면 배지에 `1. Yes` 가 박힌다. 빈 값을 주면 화면 판정 쪽이 앞서 잡은 이유를
    // 그대로 남긴다(`detect.ts` 는 빈 이유로 덮지 않는다)
    if (/^[^\w가-힣]*\d+\.\s/.test(m)) {
        return ''
    }
    // 도구 승인 — 도구 이름만 남긴다 (Bash, Edit, Write, mcp__my-server__Xxx …). MCP 이름의 '-' 도 포함
    const tool = /permission to use ([\w-]+)/i.exec(m)
    if (tool) {
        return tool[1] + ' 권한'
    }
    // Gemini CLI 의 승인 대화상자 — 도구 이름만 남긴다.
    // 원문 `│ Allow execution of [Shell]?    │` (2026-09-08 국면③ 채집, docs/AGENT-OBSERVATION.md).
    // 대괄호는 화면 장식이라 벗기고, 이름 문자만 받는다 — `?` 나 테두리가 이름에 붙지 않게
    const allow = /Allow execution of\s*\[?([\w.:-]+)/i.exec(m)
    if (allow) {
        return allow[1] + ' 권한'
    }
    if (/waiting for your input/i.test(m)) {
        return '입력 대기'
    }
    // 한도 도달 — 리셋 시각만 남긴다. 실측 문구 3형:
    //   "You've hit your session limit · resets 12pm (Asia/Seoul)"
    //   "You've reached your weekly limit · resets Monday 9am"
    //   "Claude usage limit reached. Your limit will reset at 7pm (Asia/Seoul)."
    if (/\b(?:hit|reached|exceeded)\b.*\blimit\b|usage limit|limit reached|limit will reset/i.test(m)) {
        const reset = /\breset(?:s)?\s+(?:at\s+)?(.+?)\s*(?:\(|\.\s*$|$)/i.exec(m)
        return reset ? reset[1].trim() + ' 리셋' : ''
    }
    if (/plan/i.test(m)) {
        return '플랜 승인'
    }
    if (/question|answer/i.test(m)) {
        return '질문 응답'
    }
    return m.slice(0, UNKNOWN_MAX).trimEnd()
}

/**
 * **화면에서 뽑은 줄**을 배지에 붙일 이유로 바꾼다 — 훅 문구용 `shortenReason` 을 그대로 태우고,
 * 화면에만 있는 잡음(ANSI 제어열 · TUI 테두리)을 먼저 벗기는 것만 다르다.
 *
 * 왜 여기 두나 — 축약 규칙의 사본을 만들면 한쪽만 고쳐진다. 훅이 있는 탭과 없는 탭의 배지 문구가
 * 같아야 사이드바를 훑어 어느 세션을 먼저 볼지 정할 수 있다(그게 이유를 붙이는 목적이다).
 *
 * 벗기는 것: CSI(색·커서 이동) · OSC/DCS · 남은 ESC 한 글자 · 박스드로잉(U+2500~257F)과
 * 블록(U+2580~259F) 테두리. **`●`(U+25CF)·`■`(U+25A0)·`❯`(U+276F) 는 남긴다** — 선택지 커서와
 * 오류 표식이라 위 규칙들이 그것을 보고 판정한다(선택지 줄 → 빈 이유).
 */
export function reasonFromScreen (line: string): string {
    const clean = (line || '')
        // CSI (색·커서 이동) — TUI 한 줄에 이게 여러 개 섞여 있다
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
        // OSC / DCS — 종결자는 BEL 또는 ESC \
        .replace(/\u001b[\]P][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
        // 청크 경계에 걸쳐 와 종결자가 없는 조각에 남은 ESC 한 글자
        .replace(/\u001b/g, ' ')
        // 박스드로잉(│ 등) · 반블록(▄ ▀) 테두리 — 글자가 아니라 상자다
        .replace(/[\u2500-\u259f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return shortenReason(clean)
}
