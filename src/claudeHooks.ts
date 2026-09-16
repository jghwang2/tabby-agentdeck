import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Claude Code 상태 통보 훅을 사용자의 Claude 설정에 등록/해제한다.
 *
 * 왜 플러그인이 남의 설정 파일을 만지나 — 훅은 Claude Code 쪽 설정(`~/.claude/settings.json`)에
 * 있어야 하고, npm 으로 배포되는 Tabby 플러그인은 그 파일에 손댈 방법이 달리 없다.
 * 그래서 "설치할지" 를 사용자가 설정 창에서 직접 고르게 하고, 고른 순간에만 쓴다.
 * 쓰기 전에 항상 백업을 남기고, 남의 훅은 건드리지 않는다.
 *
 * 훅이 있으면 상태 판정이 정확해진다. 에이전트가 "지시를 받았다 / 승인을 기다린다 / 끝났다" 를
 * 직접 알려주기 때문이다. 훅이 없으면 화면에 그려진 글자로 추측하는 폴백(detect.ts)이 도는데,
 * 그건 TUI 가 화면을 어떻게 그리는지에 기대는 만큼 흔들린다.
 */

/** 우리 훅인지 알아보는 표식 — 파일 이름이 그대로 명령줄에 들어간다 */
const MARK = 'agentdeck-notify'

/**
 * 어떤 순간에 무엇을 보고할지.
 *
 * **상태만 보낸다 — 작업 이름은 여기서 보내지 않는다.** 라벨은 플러그인이 Enter 시점에
 * 입력창을 읽어 매번 갱신하는 경로(`claimEnterLabel`)가 전담한다. 예전에는 여기에
 * `-PromptAsLabel` 이 붙어 있었는데, 훅이 상태 파일의 직전 라벨을 도로 써 넣는 바람에
 * 플러그인이 방금 넣은 최신 프롬프트를 옛 값으로 되돌렸다 (2026-09-01 실측).
 */
const PLAN: { event: string, args: string }[] = [
    // 지시를 받았다
    { event: 'UserPromptSubmit', args: '-Status running' },
    // 승인을 기다린다
    { event: 'Notification', args: '-Status waiting' },
    // 승인 뒤 도구가 돌았다 / 실패했다 / 사람이 거부했다 — 어느 쪽이든 에이전트는 다시 일하는 중이다.
    // 이 셋이 없으면 승인대기에서 내려올 훅이 Stop 밖에 없어 승인을 해 줘도 사이드바가 승인대기에
    // 박혀 있었다 (2026-09-07 실측). 스크립트는 이미 running 이면 아무것도 쓰지 않아 도구마다 도는 비용이 없다
    { event: 'PostToolUse', args: '-Status running' },
    { event: 'PostToolUseFailure', args: '-Status running' },
    { event: 'PermissionDenied', args: '-Status running' },
    // 서브에이전트가 뜨고 졌다 — **개수는 이 두 줄이 진실이다.**
    // 예전에는 대화기록(JSONL)을 2초마다 훑어 세었는데(subagents.ts), 그건 파일에 기록이 닿은
    // 뒤에야 보이고 종료 알림의 JSON 모양이 세 가지라 놓치기 쉬웠다 — 화면에 5개가 떠 있는데
    // 배지가 4로 남는 어긋남이 실제로 났다 (2026-09-11 유저 스크린샷).
    // 이 두 이벤트에는 `agent_id` 가 실려 오므로(실측 payload) 켜짐/꺼짐을 id 로 정확히 맞출 수 있다.
    { event: 'SubagentStart', args: '-Subagent start' },
    { event: 'SubagentStop', args: '-Subagent stop' },
    // 답이 끝났다
    { event: 'Stop', args: '-Status done' },
    // 턴이 실패로 끝났다 — 스크립트가 `error` 를 보고 rate_limit(사용량 한도)이면 limited 로 바꿔 보낸다
    { event: 'StopFailure', args: '-Status error' },
]

export function claudeSettingsPath (): string {
    return path.join(os.homedir(), '.claude', 'settings.json')
}

/** 훅 스크립트의 실제 경로. dist/index.js 기준으로 한 단계 위가 패키지 뿌리다 */
export function notifyScriptPath (): string {
    return path.join(__dirname, '..', 'hooks', 'agentdeck-notify.ps1')
}

/** 이 환경에서 훅을 걸 수 있나 — 통보 스크립트가 PowerShell 이라 Windows 전용이다 */
export function hooksSupported (): boolean {
    return process.platform === 'win32' && fs.existsSync(notifyScriptPath())
}

function readSettings (): any {
    try {
        const raw = fs.readFileSync(claudeSettingsPath(), 'utf8')
        return raw.trim() ? JSON.parse(raw) : {}
    } catch {
        // 파일이 없거나 아직 JSON 이 아니다 — 새로 만드는 것으로 본다
        return {}
    }
}

/** 이 이벤트에 걸린 훅 중 우리 것이 아닌 것만 남긴다 */
function withoutOurs (entries: any): any[] {
    return (Array.isArray(entries) ? entries : [])
        .filter(e => !JSON.stringify(e ?? '').includes(MARK))
}

/**
 * 우리 훅이 PLAN 의 모든 이벤트에 걸려 있나 — 파일을 읽지 않는 순수 판정.
 * 이벤트가 늘어난 버전으로 올라오면 옛 설치는 "설치 안 됨" 으로 보인다 — 설정 창에서 설치를 다시 누르면 된다.
 * 파일 접근과 분리해 둔 이유는 이 판단을 테스트로 묶어 두기 위해서다.
 */
export function isMerged (settings: any): boolean {
    const hooks = settings?.hooks ?? {}
    return PLAN.every(p => {
        const entries = Array.isArray(hooks[p.event]) ? hooks[p.event] : []
        return entries.some((e: any) => JSON.stringify(e ?? '').includes(MARK))
    })
}

/**
 * 설정 객체에 우리 훅을 더한 새 객체를 돌려준다 (원본은 건드리지 않는다).
 * 이미 우리 것이 있으면 명령줄만 지금 경로로 갈아끼우고, 남이 걸어 둔 훅은 그대로 둔다.
 */
export function mergeHooks (settings: any, script: string): any {
    const next = { ...(settings ?? {}) }
    next.hooks = { ...(next.hooks ?? {}) }
    for (const p of PLAN) {
        const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${p.args}`
        next.hooks[p.event] = [
            ...withoutOurs(next.hooks[p.event]),
            { matcher: '*', hooks: [{ type: 'command', command, timeout: 5 }] },
        ]
    }
    return next
}

/** 우리 훅만 걷어낸 새 객체. 비어 버린 이벤트 키는 지워서 설정을 깨끗하게 남긴다 */
export function stripHooks (settings: any): any {
    const next = { ...(settings ?? {}) }
    if (!next.hooks) {
        return next
    }
    next.hooks = { ...next.hooks }
    for (const p of PLAN) {
        const kept = withoutOurs(next.hooks[p.event])
        if (kept.length) {
            next.hooks[p.event] = kept
        } else {
            delete next.hooks[p.event]
        }
    }
    return next
}

export function hooksInstalled (): boolean {
    return isMerged(readSettings())
}

/** 훅을 등록한다 */
export function installHooks (): void {
    const script = notifyScriptPath()
    if (!fs.existsSync(script)) {
        throw new Error(`훅 스크립트를 찾지 못했다: ${script}`)
    }
    writeSettings(mergeHooks(readSettings(), script))
}

/** 훅을 뗀다 */
export function uninstallHooks (): void {
    writeSettings(stripHooks(readSettings()))
}

function writeSettings (settings: any): void {
    const file = claudeSettingsPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 남의 설정을 고치는 일이라 되돌릴 수 있게 한 벌 남긴다
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, file + '.agentdeck-backup')
    }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}
