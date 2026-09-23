import * as fs from 'fs'
import { agentHome } from './storagePaths'
import * as path from 'path'

const MARK = 'agentdeck-codex-notify.ps1'
// https://learn.chatgpt.com/docs/hooks — no Claude-only Notification/StopFailure events.
export const CODEX_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd']

export function codexHooksPath (): string {
    return path.join(agentHome('codex'), 'hooks.json')
}

/** Codex 가 훅 신뢰 상태를 적어 두는 곳 — `hooks.json` 과 **다른 파일**이다 */
export function codexConfigPath (): string {
    return path.join(agentHome('codex'), 'config.toml')
}

/**
 * Codex 가 **꺼 둔** 우리 훅 목록 (`config.toml` 의 `[hooks.state]`).
 *
 * **`hooks.json` 에 우리 항목이 있다고 훅이 도는 것이 아니다.** Codex 는 훅을 처음 보면
 * `/hooks` 에서 사람이 신뢰할 때까지 멈춰 두고, 그 결과를 `config.toml` 에 따로 적는다:
 *
 *     [hooks.state.'C:\\Users\\…\\hooks.json:user_prompt_submit:0:0']
 *     trusted_hash = "sha256:…"
 *     enabled = false
 *
 * 2026-09-14 실측: 이 PC 는 `session_start`·`user_prompt_submit`·`stop` 셋이 꺼져 있었고,
 * 그 셋이 정확히 **진행중 진입과 완료 신호**라 사이드바가 Codex 상태를 영영 못 받았다
 * (상태 보고 폴더에 codex 파일 0건). 설치만 확인하고 "연동됨" 이라 말하면 사용자는
 * 아무 일도 안 일어나는 이유를 볼 수 없다 — 그래서 이 값을 따로 읽어 화면에 말한다.
 *
 * TOML 파서를 들이지 않는 이유 — 읽는 것이 **한 종류의 줄**뿐이고, 그 모양이 깨지면
 * 빈 목록으로 떨어져 "모른다" 가 된다(없는 경고를 지어내지 않는다).
 */
export function codexDisabledEvents (): string[] {
    let text: string
    try {
        text = fs.readFileSync(codexConfigPath(), 'utf8')
    } catch {
        return [] // 파일이 없다 = Codex 를 아직 안 띄웠다. 모르는 것을 경고로 만들지 않는다
    }
    const out: string[] = []
    // **우리 것만 센다.** 경로가 우리 `hooks.json` 이고, 이벤트도 우리가 설치한 목록
    // (`CODEX_EVENTS`) 안이어야 한다. 넓게 잡으면 남의 훅이나 우리가 설치하지도 않은 이벤트를
    // 집어 "AgentDeck 훅이 꺼져 있다" 고 거짓말한다 — 2026-09-15 실측으로 실제 그랬다:
    // `session_start` 를 집고 있었는데 그건 `CODEX_EVENTS` 에 없는 남의 항목이다.
    const fold = (v: string): string => v.toLowerCase().replace(/\\/g, '/')
    const mine = fold(codexHooksPath())
    // `[` 로 시작하는 줄마다 잘라 한 절씩 본다 — 절 안에 `enabled = false` 가 있으면 꺼진 것
    for (const block of text.split(/\n(?=\[)/)) {
        const key = hookStateKey(block)
        if (!key) {
            continue
        }
        // 키는 `<hooks.json 경로>:<이벤트>:<n>:<n>` 인데 **경로에도 `:` 가 있다**(`C:\…`).
        // 그래서 앞에서 자르지 않고 뒤에서 세 칸을 떼어낸다
        const parts = key.split(':')
        if (parts.length < 4) {
            continue
        }
        parts.pop()
        parts.pop()
        const event = parts.pop() as string
        if (fold(parts.join(':')) !== mine) {
            continue
        }
        if (CODEX_EVENTS.includes(codexEventLabel(event)) && /^\s*enabled\s*=\s*false\s*$/m.test(block)) {
            out.push(event)
        }
    }
    return out
}

/**
 * `[hooks.state.<키>]` 한 절에서 그 키를 꺼낸다 (아니면 null).
 *
 * **TOML 은 같은 키를 두 가지로 적는다** — 리터럴 문자열 `'C:\…'` 은 원문 그대로이고,
 * 기본 문자열 `"C:\\…"` 은 백슬래시가 이스케이프돼 있다. Codex 는 둘 다 쓴다
 * (2026-09-15 실측: 같은 날 오전에는 `'…'`, 오후에는 `"…"` 로 바뀌어 있었다).
 * 한쪽만 알던 정규식은 그 순간 조용히 0건을 돌려줬다 — 그래서 둘 다 읽고 이스케이프를 푼다.
 */
function hookStateKey (block: string): string | null {
    const lit = /^\[hooks\.state\.'([^']*)'\]/.exec(block)
    if (lit) {
        return lit[1]
    }
    const basic = /^\[hooks\.state\."((?:[^"\\]|\\.)*)"\]/.exec(block)
    return basic ? basic[1].replace(/\\(.)/g, '$1') : null
}

/** `user_prompt_submit` → `UserPromptSubmit` (config.toml 은 snake_case, hooks.json 은 PascalCase) */
export function codexEventLabel (snake: string): string {
    const pascal = snake.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
    return CODEX_EVENTS.includes(pascal) ? pascal : snake
}

function ours (handler: any): boolean {
    return typeof handler?.command === 'string' && handler.command.includes(MARK)
}

export function stripCodexHooks (settings: any): any {
    const hooks = { ...(settings?.hooks ?? {}) }
    for (const event of Object.keys(hooks)) {
        if (!Array.isArray(hooks[event])) {
            throw new Error(`Invalid hooks.${event}: expected an array`)
        }
        hooks[event] = hooks[event].map((group: any) => {
            if (!Array.isArray(group?.hooks)) { throw new Error(`Invalid hooks.${event} group`) }
            return { ...group, hooks: group.hooks.filter((handler: any) => !ours(handler)) }
        }).filter((group: any) => group.hooks.length)
        if (!hooks[event].length) { delete hooks[event] }
    }
    return { ...settings, hooks }
}

export function mergeCodexHooks (settings: any, script: string): any {
    const next = stripCodexHooks(settings)
    const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"`
    for (const event of CODEX_EVENTS) {
        next.hooks[event] = [...(next.hooks[event] ?? []), {
            hooks: [{ type: 'command', command, timeout: 3 }],
        }]
    }
    return next
}

export function codexHooksInstalled (): boolean {
    const settings = readCodexHooks()
    return CODEX_EVENTS.every(event => settings.hooks?.[event]?.some((group: any) => group.hooks?.some(ours)))
}

function readCodexHooks (): any {
    const file = codexHooksPath()
    if (!fs.existsSync(file)) { return {} }
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value.hooks != null && (typeof value.hooks !== 'object' || Array.isArray(value.hooks)))) {
        throw new Error('Invalid Codex hooks.json; existing configuration was not changed')
    }
    return value
}

export function setCodexHooks (enabled: boolean): void {
    const file = codexHooksPath()
    const script = path.join(__dirname, '..', 'hooks', MARK)
    if (enabled && !fs.existsSync(script)) { throw new Error(`Missing hook: ${script}`) }
    const current = readCodexHooks()
    const next = enabled ? mergeCodexHooks(current, script) : stripCodexHooks(current)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file)) { fs.copyFileSync(file, `${file}.agentdeck-backup-${Date.now()}`) }
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
}
