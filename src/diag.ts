import * as childProcess from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { followModeOf } from './viewer'

/**
 * 진단 로그.
 *
 * 이 파일이 따로 있는 이유 — 이 플러그인은 npm 으로 배포되므로 버그를 겪는 사람이
 * 개발자가 아니다. 그 사람에게서 받을 수 있는 것은 **파일 한 개**뿐이고, 그 파일이
 *   ① 세션이 바뀌어도 남아 있어야 하고 (옛 구현은 기동할 때마다 비웠다)
 *   ② 어느 버전·어느 환경에서 난 일인지 스스로 말해야 하고 (스탬프)
 *   ③ 예외를 담아야 하며 (`catch {}` 로 삼킨 것은 아무 데도 안 남는다)
 *   ④ 무한정 커지지 않아야 한다 (사람에게 첨부를 요구하는 파일이다)
 * 네 가지가 전부 만족돼야 "로그 받아서 고친다" 가 성립한다.
 *
 * 그래서 deck / alert / notify 가 각자 `appendFileSync` 를 하던 것을 여기로 모으고,
 * 회전 · 세션 스탬프 · 예외 캡처 · 수집(zip)까지 한 군데서 처리한다.
 */

/**
 * 로그를 둘 폴더. 기본은 홈, `AGENTDECK_DIAG_DIR` 가 있으면 그 폴더.
 *
 * **왜 갈라야 하나** — 회귀용 격리 인스턴스와 실사용 Tabby 가 같은 파일에 섞어 쓰면
 * 남의 줄에 묻힌다. 2026-09-09 실측: 러너에서 프로세스가 사라진 판의 마지막 줄을 보려 했는데
 * 실사용 쪽이 계속 쓰는 동안 그 줄이 밀려나고 `.1` 회전도 실사용 분량에 걸려 **종료 원인을
 * 끝내 볼 수 없었다.** 회전이 있어도 파일이 공유되면 소용이 없다.
 *
 * **왜 전용 변수인가** — 처음에는 `TABBY_CONFIG_DIRECTORY` 로 판별했는데, 그 값은 **실사용
 * Tabby 에도 설정돼 있을 수 있다**(이 개발기가 그런 환경이었고 `test/diag.test.js` 의
 * "홈에 잡힌다" 케이스가 그걸 잡았다). 그러면 실사용 로그까지 엉뚱한 폴더로 옮긴다.
 * 목적이 하나뿐인 변수를 두고 `tools/test-instance.ps1` 만 그것을 심는다.
 */
function logDir (): string {
    const wanted = process.env.AGENTDECK_DIAG_DIR
    if (wanted) {
        try {
            if (fs.existsSync(wanted)) {
                return wanted
            }
        } catch {
            // 접근할 수 없으면 홈으로 — 로그 때문에 기동이 막히면 안 된다
        }
    }
    return os.homedir()
}

/** 한 줄 요약이 쌓이는 곳 */
export const DIAG_PATH = path.join(logDir(), '.agentdeck-diag.log')
/** 직전 분량 — 상한을 넘으면 여기로 밀고 새로 쓴다. 지우지 않는 것이 요점이다 */
export const DIAG_PREV_PATH = DIAG_PATH + '.1'
/** 깨진 화면의 원문 (deck.service 의 snapshot) */
export const SCREEN_PATH = path.join(logDir(), '.agentdeck-screen.log')
/** 화면 원문의 직전 분량 */
export const SCREEN_PREV_PATH = SCREEN_PATH + '.1'

/** 진단 로그 상한 — 넘으면 `.1` 로 밀린다. 두 개를 합쳐도 메일에 붙일 수 있는 크기로 잡았다 */
const DIAG_MAX_BYTES = 2 * 1024 * 1024
/** 화면 원문 상한. 한 스냅샷이 수십 KB 라 진단 로그보다 넉넉히 준다 */
const SCREEN_MAX_BYTES = 4 * 1024 * 1024
/** 메모리에 들고 있는 줄 수 — devtools(`__agentdeck.kickLog`)와 수집 리포트가 이걸 읽는다 */
const MEMORY_MAX_LINES = 2000
/** 한 세션에서 콘솔을 옮겨 적는 최대 건수. 폭주하는 경고가 로그를 밀어내지 않게 한다 */
const CONSOLE_MAX_ENTRIES = 300
/** 같은 콘솔 메시지를 다시 적기까지의 간격 */
const CONSOLE_DEDUPE_MS = 5000
/** 콘솔 인자 하나를 적을 최대 길이 */
const CONSOLE_ARG_CHARS = 400
/** `diagCatch` 로 남길 최대 건수 */
const CATCH_MAX_ENTRIES = 200
/** 같은 자리·같은 사유를 다시 적기까지의 간격 */
const CATCH_DEDUPE_MS = 60000
/** 이 횟수마다 파일 크기를 다시 읽는다 (다른 창이 같은 파일에 쓴 만큼을 반영) */
const STAT_REFRESH_APPENDS = 500
/** 예외 스택을 적을 최대 줄 수 */
const STACK_MAX_LINES = 12

/** 세션 스탬프 — 받은 로그가 "어느 빌드/환경의 것인가" 를 답하는 값들 */
export interface DiagStamp {
    /** Tabby 버전 (`PlatformService.getAppVersion()`) */
    tabby?: string
    /** OS 릴리스 (`PlatformService.getOSRelease()`) */
    osRelease?: string
    /** 로그를 읽는 사람이 재현에 필요한 설정만 골라 넣는다 (전체 config 를 넣지 않는다) */
    config?: Record<string, any>
}

/**
 * 세션 머리말·수집 리포트에 넣을 설정만 골라 담는다.
 *
 * 전체 config 를 넣지 않는 이유 — 작업 폴더 같은 사적인 경로까지 들어가는데, 정작 증상을
 * 가르는 데 필요한 값은 몇 개뿐이다. `terminal.useConPTY` 는 Tabby 쪽 값이지만 새 탭이 안
 * 열리는 증상(README 문제해결)의 원인이라 같이 본다.
 */
export function configStamp (store: any): Record<string, any> {
    const cfg = store?.agentDeck ?? {}
    return {
        enabled: cfg.enabled,
        dock: cfg.sidebarDock,
        sidebar: cfg.sidebarWidth || cfg.sidebarHeight,
        aspect: `${cfg.aspectW}:${cfg.aspectH}`,
        viewerOpen: cfg.viewerOpen,
        // **해석한 값**을 적는다 — 토글 두 개(읽어두기·자동열기)가 접힌 결과가 동작을 정하므로,
        // 원본 둘만 보면 "패널이 왜 저절로 열리나/안 열리나" 를 한눈에 가리기 어렵다
        viewerFollow: followModeOf(cfg.viewerPreload, cfg.viewerAutoOpen),
        screenWatch: cfg.screenWatch,
        autoRepair: cfg.autoRepair,
        notifyChannel: cfg.notifyChannel,
        rootProfile: cfg.rootProfile,
        useConPTY: store?.terminal?.useConPTY,
    }
}

/** 최근 줄 — 파일이 안 써지는 환경에서도 devtools 로는 볼 수 있어야 한다 */
const memory: string[] = []
/** `diagOnce` 가 이미 남긴 키 */
const onceKeys = new Set<string>()
/** 지금 파일 크기 (append 마다 statSync 하지 않으려고 들고 센다). -1 = 아직 안 읽음 */
let diagBytes = -1
/** 마지막 재측정 이후의 append 횟수 — 창이 두 개면 같은 파일에 둘이 쓰므로 셈이 어긋난다 */
let appendsSinceStat = 0
/** 회전 직후 새 파일에 다시 적을 세션 머리말 */
let sessionHeader = ''
/** 예외 캡처를 이미 걸었나 */
let captureInstalled = false
/** 콘솔에서 옮겨 적은 건수 */
let consoleCount = 0
/** 같은 콘솔 메시지의 마지막 기록 시각 */
const consoleSeen = new Map<string, number>()
/** `diagCatch` 로 남긴 건수 */
let catchCount = 0
/** 같은 (자리, 사유) 의 마지막 기록 시각 */
const catchSeen = new Map<string, number>()

/** package.json 의 버전 — 배포판은 사용자가 어느 버전을 쓰는지 모르니 로그가 스스로 말해야 한다 */
let cachedVersion: string | null = null

/**
 * 이 플러그인 버전.
 *
 * `dist/index.js` 기준 `../package.json` 이 npm 설치본과 개발용 junction 양쪽에서 모두 맞는다
 * (`claudeHooks.ts:52` 가 `hooks/` 를 찾는 방식과 같다).
 */
export function pluginVersion (): string {
    if (cachedVersion !== null) {
        return cachedVersion
    }
    cachedVersion = 'unknown'
    for (const candidate of [path.join(__dirname, '..', 'package.json'), path.join(__dirname, 'package.json')]) {
        try {
            const raw = fs.readFileSync(candidate, 'utf8')
            const version = JSON.parse(raw)?.version
            if (version) {
                cachedVersion = String(version)
                break
            }
        } catch {
            // 다음 후보로 넘어간다 — 버전은 있으면 좋은 값이고 없어도 로그는 남아야 한다
        }
    }
    return cachedVersion
}

function fileSize (target: string): number {
    try {
        return fs.statSync(target).size
    } catch {
        return 0
    }
}

/**
 * 상한을 넘었으면 `.1` 로 밀어낸다.
 *
 * `rename` 은 Windows 에서도 기존 `.1` 을 덮어쓴다. 두 세대만 남기는 것은 의도다 —
 * 세 세대째부터는 사람이 첨부하지 않고, 디스크만 먹는다.
 */
function rotate (target: string, prev: string, max: number): boolean {
    try {
        if (fileSize(target) < max) {
            return false
        }
        fs.renameSync(target, prev)
        return true
    } catch {
        return false
    }
}

/** 파일에 그대로 붙인다. 상한을 넘으면 회전하고 새 파일 머리에 세션 스탬프를 다시 적는다 */
function append (chunk: string): void {
    try {
        // 창(렌더러 프로세스)이 두 개면 같은 파일에 둘이 쓴다 — 들고 센 값만 믿으면 상한을 넘겨
        // 계속 자란다. 그래서 일정 횟수마다 실제 크기를 다시 읽는다 (statSync 는 그때만)
        if (diagBytes < 0 || ++appendsSinceStat >= STAT_REFRESH_APPENDS) {
            diagBytes = fileSize(DIAG_PATH)
            appendsSinceStat = 0
        }
        if (diagBytes >= DIAG_MAX_BYTES && rotate(DIAG_PATH, DIAG_PREV_PATH, DIAG_MAX_BYTES)) {
            diagBytes = 0
            if (sessionHeader) {
                fs.appendFileSync(DIAG_PATH, sessionHeader)
                diagBytes += Buffer.byteLength(sessionHeader)
            }
        }
        fs.appendFileSync(DIAG_PATH, chunk)
        diagBytes += Buffer.byteLength(chunk)
    } catch {
        // 디스크가 막혀 있다 — 진단일 뿐이라 동작에는 영향이 없다
    }
}

function remember (line: string): void {
    memory.push(line)
    if (memory.length > MEMORY_MAX_LINES) {
        memory.splice(0, memory.length - MEMORY_MAX_LINES)
    }
}

/** 진단 한 줄. 시각은 여기서 붙이므로 호출부는 내용만 넘긴다 */
export function diag (line: string): void {
    const text = `${new Date().toISOString()} ${line}`
    remember(text)
    append(text + '\n')
}

/**
 * 같은 키로는 한 번만 남기는 진단.
 * relayout 처럼 초당 여러 번 불리는 자리에서 조기 return 사유를 남길 때 쓴다
 */
export function diagOnce (key: string, line: string): void {
    if (onceKeys.has(key)) {
        return
    }
    onceKeys.add(key)
    diag(line)
}

/** `diagOnce` 키를 푼다 — 상황이 바뀌어 다시 한 번 남겨야 할 때 */
export function resetDiagOnce (key: string): void {
    onceKeys.delete(key)
}

/** 메모리에 남은 진단 줄 (devtools `__agentdeck.kickLog` 가 이 배열을 그대로 참조한다) */
export function diagMemory (): string[] {
    return memory
}

/** 최근 N 줄 — 수집 리포트가 쓴다 */
export function recentDiag (limit = 200): string[] {
    return memory.slice(-limit)
}

/**
 * 세션 시작을 기록한다.
 *
 * 옛 구현은 여기서 파일을 **비웠다**(`writeFileSync(path, '')`). 그래서 "어제 이렇게 깨졌어" 를
 * 들고 Tabby 를 껐다 켠 사람에게서는 받을 로그가 없었다. 지금은 비우지 않고, 상한을 넘었을 때만
 * `.1` 로 밀어 두 세대를 남긴다.
 */
export function startDiagSession (stamp: DiagStamp = {}): void {
    rotate(DIAG_PATH, DIAG_PREV_PATH, DIAG_MAX_BYTES)
    diagBytes = -1
    const lines = [
        '',
        `===== agentdeck session ${new Date().toISOString()} =====`,
        `plugin=${pluginVersion()} tabby=${stamp.tabby ?? '?'}`
            + ` platform=${process.platform} arch=${process.arch}`
            + ` node=${process.versions?.node ?? '?'} electron=${process.versions?.electron ?? '?'}`
            + ` os=${JSON.stringify(stamp.osRelease ?? os.release())}`,
    ]
    if (stamp.config) {
        lines.push(`config=${safeJson(stamp.config)}`)
    }
    sessionHeader = lines.join('\n') + '\n'
    for (const line of lines) {
        remember(line)
    }
    append(sessionHeader)
}

/**
 * 잡히지 않은 예외를 진단 로그로 끌어온다.
 *
 * 세 갈래를 다 덮는다 —
 *   ① `window.onerror` / `unhandledrejection`: Angular 밖에서 터지는 비동기 예외
 *   ② `console.error` / `console.warn`: Angular 기본 `ErrorHandler` 와 Tabby 의
 *      `platform.setErrorHandler` 가 결국 여기로 흘린다(tabby-core `AppModule`).
 *      그래서 `ErrorHandler` 를 우리가 갈아끼우지 않아도 잡힌다 — 코어 동작을 건드리지 않는 쪽을 골랐다.
 * 원래 함수는 항상 그대로 호출하므로 devtools 출력은 달라지지 않는다.
 */
export function installErrorCapture (): void {
    if (captureInstalled) {
        return
    }
    captureInstalled = true

    const anyWindow: any = typeof window === 'undefined' ? null : window
    if (anyWindow?.addEventListener) {
        anyWindow.addEventListener('error', (event: any) => {
            const where = event?.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : ''
            diagException('window.onerror' + where, event?.error ?? event?.message)
        })
        anyWindow.addEventListener('unhandledrejection', (event: any) => {
            diagException('unhandledrejection', event?.reason)
        })
    }

    teeConsole('error')
    teeConsole('warn')
}

/** 예외 한 건 — 첫 줄에 요약, 그 뒤에 스택을 붙인다 */
export function diagException (tag: string, error: any): void {
    const message = errorMessage(error)
    diag(`EXCEPTION ${tag} ${message}`)
    const stack = typeof error?.stack === 'string' ? error.stack.split(/\r?\n/) : []
    for (const line of stack.slice(1, STACK_MAX_LINES + 1)) {
        const trimmed = line.trim()
        if (trimmed) {
            append(`    ${trimmed}\n`)
            remember(`    ${trimmed}`)
        }
    }
}

/**
 * `catch` 에서 삼키던 실패를 한 줄로 남긴다.
 *
 * 이 프로젝트는 "동작에는 영향 없다" 는 이유로 빈 `catch {}` 를 많이 쓴다(그 판단 자체는 맞다 —
 * 세션이 막 닫히는 중의 resize 실패 같은 것들이다). 문제는 **정말 이상한 실패도 같은 자리에서
 * 사라진다** 는 것이다. 그래서 같은 (자리, 메시지) 조합은 창(`CATCH_DEDUPE_MS`) 안에서 한 번만,
 * 세션 전체로도 상한(`CATCH_MAX_ENTRIES`)까지만 남긴다 — 흔한 실패로 로그가 밀리지 않게.
 */
export function diagCatch (tag: string, error: any): void {
    if (catchCount >= CATCH_MAX_ENTRIES) {
        return
    }
    const message = errorMessage(error)
    const key = `${tag}|${message}`
    const now = Date.now()
    const last = catchSeen.get(key)
    if (last !== undefined && now - last < CATCH_DEDUPE_MS) {
        return
    }
    catchSeen.set(key, now)
    catchCount++
    diag(`CATCH ${tag} ${clip(message)}`)
    if (catchCount >= CATCH_MAX_ENTRIES) {
        diag(`CATCH 캡처 상한(${CATCH_MAX_ENTRIES}) 도달 — 이 세션에서는 더 적지 않는다`)
    }
}

function errorMessage (error: any): string {
    if (error == null) {
        return '(no error object)'
    }
    if (typeof error === 'string') {
        return error
    }
    const name = error.name ? `${error.name}: ` : ''
    return `${name}${error.message ?? safeJson(error)}`
}

/** `console[level]` 을 감싸 진단 로그로도 흘린다. 원래 함수 호출은 그대로 유지한다 */
function teeConsole (level: 'error' | 'warn'): void {
    const target: any = typeof console === 'undefined' ? null : console
    const original = target?.[level]
    if (typeof original !== 'function') {
        return
    }
    target[level] = (...args: any[]) => {
        try {
            recordConsole(level, args)
        } catch {
            // 진단이 콘솔을 망가뜨리면 안 된다
        }
        return original.apply(target, args)
    }
}

function recordConsole (level: string, args: any[]): void {
    if (consoleCount >= CONSOLE_MAX_ENTRIES) {
        return
    }
    const text = args.slice(0, 4).map(formatArg).join(' ')
    if (!text) {
        return
    }
    const now = Date.now()
    const last = consoleSeen.get(text)
    if (last !== undefined && now - last < CONSOLE_DEDUPE_MS) {
        return
    }
    consoleSeen.set(text, now)
    consoleCount++
    diag(`CONSOLE ${level} ${text}`)
    if (consoleCount >= CONSOLE_MAX_ENTRIES) {
        diag(`CONSOLE 캡처 상한(${CONSOLE_MAX_ENTRIES}) 도달 — 이 세션에서는 더 적지 않는다`)
    }
}

function formatArg (arg: any): string {
    if (typeof arg === 'string') {
        return clip(arg)
    }
    if (arg instanceof Error) {
        const first = typeof arg.stack === 'string' ? arg.stack.split(/\r?\n/)[1]?.trim() : ''
        return clip(`${arg.name}: ${arg.message}${first ? ' | ' + first : ''}`)
    }
    return clip(safeJson(arg))
}

function clip (text: string): string {
    const flat = text.replace(/\r?\n/g, ' ')
    return flat.length > CONSOLE_ARG_CHARS ? flat.slice(0, CONSOLE_ARG_CHARS) + '…' : flat
}

function safeJson (value: any): string {
    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

/** 화면 원문 한 덩이 — 상한을 넘으면 회전한다 (옛 구현은 상한이 없어 무한히 커졌다) */
export function appendScreenLog (chunk: string): void {
    try {
        rotate(SCREEN_PATH, SCREEN_PREV_PATH, SCREEN_MAX_BYTES)
        fs.appendFileSync(SCREEN_PATH, chunk)
    } catch {
        // 채증일 뿐이라 실패해도 동작에는 영향이 없다
    }
}

/** 수집 결과 */
export interface DiagBundle {
    /** 사용자에게 보여줄 경로 — zip 이면 zip, 실패하면 폴더 */
    path: string
    /** 압축까지 됐나 */
    zipped: boolean
    /** 담긴 파일명 */
    files: string[]
}

/** 파일명에 쓸 시각 — `2026-09-09_1130` */
function stampForName (now = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
        + `_${p(now.getHours())}${p(now.getMinutes())}`
}

/**
 * 신고용 묶음을 만든다.
 *
 * 화면 원문(`SCREEN_PATH`)은 **기본으로 넣지 않는다** — 터미널에 찍힌 코드·경로가 그대로 들어 있어서,
 * 넣을지는 보내는 사람이 정할 일이다. 압축이 안 되는 환경(zip 도구 없음)에서는 폴더를 그대로 돌려준다.
 */
export function collectDiagBundle (options: { includeScreen?: boolean, stamp?: DiagStamp } = {}): DiagBundle {
    const name = `agentdeck-diag-${stampForName()}`
    const dir = path.join(os.tmpdir(), name)
    fs.mkdirSync(dir, { recursive: true })

    const files: string[] = []
    const report = [
        `agentdeck 진단 묶음 ${new Date().toISOString()}`,
        `plugin=${pluginVersion()} tabby=${options.stamp?.tabby ?? '?'}`,
        `platform=${process.platform} arch=${process.arch}`
            + ` node=${process.versions?.node ?? '?'} electron=${process.versions?.electron ?? '?'}`,
        `os=${options.stamp?.osRelease ?? os.release()}`,
        `config=${safeJson(options.stamp?.config ?? {})}`,
        `diag=${fileSize(DIAG_PATH)}B prev=${fileSize(DIAG_PREV_PATH)}B`
            + ` screen=${fileSize(SCREEN_PATH)}B (포함=${options.includeScreen ? 'y' : 'n'})`,
        '',
        '--- 이 세션의 최근 진단 (메모리) ---',
        ...recentDiag(200),
        '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'report.txt'), report, 'utf8')
    files.push('report.txt')

    const sources: string[] = [DIAG_PATH, DIAG_PREV_PATH]
    if (options.includeScreen) {
        sources.push(SCREEN_PATH, SCREEN_PREV_PATH)
    }
    for (const source of sources) {
        try {
            if (fs.existsSync(source)) {
                const base = path.basename(source).replace(/^\./, '')
                fs.copyFileSync(source, path.join(dir, base))
                files.push(base)
            }
        } catch {
            // 한 파일을 못 복사해도 나머지는 담는다
        }
    }

    const zip = dir + '.zip'
    try {
        fs.rmSync(zip, { force: true })
    } catch {
        // 옛 묶음이 남아 있어도 압축 단계에서 다시 판정한다
    }
    if (compress(dir, zip) && fs.existsSync(zip)) {
        return { path: zip, zipped: true, files }
    }
    return { path: dir, zipped: false, files }
}

/**
 * 폴더를 zip 으로 만든다.
 *
 * 의존성을 늘리지 않으려고 OS 도구를 쓴다 — Windows 는 `Compress-Archive`, 그 외는 `zip`.
 * 실패하면 false 를 돌려주고 호출부가 폴더 경로를 그대로 안내한다.
 */
function compress (dir: string, zip: string): boolean {
    try {
        if (process.platform === 'win32') {
            childProcess.execFileSync('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-Command', `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zip}' -Force`,
            ], { timeout: 30000, stdio: 'ignore' })
        } else {
            childProcess.execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: dir, timeout: 30000, stdio: 'ignore' })
        }
        return true
    } catch {
        return false
    }
}
