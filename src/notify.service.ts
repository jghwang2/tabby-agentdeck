import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, ConfigService, PlatformService } from 'tabby-core'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import { WorkStatusService } from './status.service'
import { WorkStatus } from './api'
import { AgentId } from './agents'
import {
    CodexState, codexContextPct, codexLimits, createCodexState, emailFromIdToken, feedCodexChunk,
} from './codexMeta'
import { claudeSettingsPath, hooksInstalled, hooksSupported, installHooks } from './claudeHooks'
import { pickTabByPids } from './bind'
import { shortenReason } from './reason'
import { TAB_ENV, newTabId, pickTabByTabId } from './tabenv'
import { SessionMailbox } from './sessionMailbox'
import { diag, diagCatch } from './diag'
import { accountEmail } from './accounts'
import { agentHome, runtimeRoot, runtimeEnvironment } from './storagePaths'
import {
    createSubagentState, feedChunk, formatSubagentTooltip, matchesSessionTranscript, summarizeSubagents,
    summarizeLiveAgents, formatLiveAgentTooltip, LiveAgent,
    SubagentCall, SubagentState, SubagentSummary,
} from './subagents'

/** 훅이 남기는 파일 하나의 내용 */
interface NotifyFile {
    sessionId: string
    /**
     * 보고한 CLI (`claude` / `codex` / `gemini`) — 훅 스크립트의 `-Agent`.
     *
     * **에이전트 판정의 1순위 근거다.** 플러그인은 원래 자식 프로세스 이름 → 명령줄(WMI) →
     * 탭 제목 → 화면 문구 순으로 추측했는데(deck.service `detectAgentApp`), 그 넷은 전부
     * 흔들린다 — npm 전역 래퍼로 띄운 gemini 는 자식이 `node.exe` 하나뿐이고 제목에도 이름이
     * 없었다(2026-09-08 실측). 훅을 부르는 쪽은 자기가 누구인지 **알고 있으므로** 그 값을
     * 그대로 받는다. cwd·tabId 에서 이미 한 판단과 같다: 아는 쪽이 말하면 추측을 하지 않는다.
     */
    agent?: string
    /** 없으면 지금 상태를 유지한다 (라벨만 바꾸는 보고) */
    status?: WorkStatus
    /** 없으면 지금 라벨을 유지한다 (상태만 바꾸는 보고) */
    label?: string
    /**
     * 승인대기 이유 — Notification 훅의 message 원문 ("Claude needs your permission to use Bash" 등).
     * 훅은 waiting 일 때만 넣는다. 여기서 짧은 한국어로 줄여(reason.ts) 배지에 붙인다
     */
    reason?: string
    /** 훅이 쓴 시각 (epoch ms) — 같은 값을 두 번 적용하지 않기 위한 판별자 */
    ts: number
    /**
     * 훅 프로세스의 조상 PID — claude.exe 부터 위로(탭 셸, Tabby.exe …).
     * 어느 탭의 보고인지 이걸로 확정한다 (bind.ts). 없으면 옛 훅이거나 셸에서 사람이 부른 것.
     * tabId 가 있는 보고는 이걸 보내지 않는다 (훅이 계보 조회를 건너뛴다)
     */
    pids?: number[]
    /**
     * 훅 셸의 `AGENTDECK_TAB` — 플러그인이 탭을 열 때 그 셸에 심은 값(tabenv.ts). 1순위 매칭 근거.
     * 없으면 이 버전 이전에 열린 탭·재시작으로 복원된 탭·옛 훅이고, pids 로 떨어진다
     */
    tabId?: string
    /**
     * 에이전트가 실제로 돌고 있는 폴더 (훅 JSON 의 `cwd`).
     *
     * 이걸 받는 이유는 **Tabby 순정의 cwd 추정이 윈도우에서 못 믿을 값을 내기 때문**이다 —
     * `guessWindowsCWD` 가 PTY 출력 조각마다 정규식을 돌려 `X:\…` 처럼 보이는 첫 토큰을 그대로
     * cwd 로 삼는다(tabby-local/dist/index.js:1316). 에이전트가 화면에 찍은 **파일 경로**도 걸리고,
     * `getWorkingDirectory()` 는 그 값이 폴더인지 보지 않고 존재 여부(`fs.access`)만 본다(:1306).
     * 그래서 미리보기 `변경` 탭이 `git -C <…\notes.py>` 를 돌려
     * `fatal: cannot change to …: Invalid argument` 로 끝났다 (2026-09-11 실측).
     * 훅이 말해 주는 값은 추정이 아니라 에이전트가 아는 사실이라 이게 오면 추정보다 앞선다.
     */
    cwd?: string
    /**
     * 이번 도구가 고친 파일의 절대경로 (훅 JSON 의 `tool_input.file_path`).
     *
     * 탭별로 모아 `변경` 탭의 '세션' 목록을 만든다. 훅은 `file_path` 를 쓰는 도구
     * (Edit/Write/NotebookEdit)에서만 싣고, 이미 running 인 세션에서도 **이것이 있으면 보고를
     * 생략하지 않는다** — 하나 빠지면 그 파일이 화면에서 통째로 사라지기 때문이다.
     */
    file?: string
    /**
     * 서브에이전트 켜짐/꺼짐 (`SubagentStart`/`SubagentStop` 훅). `agentId` 와 짝이다.
     *
     * 개수를 대화기록에서 세던 방식은 파일에 기록이 닿아야 보이고 종료 알림 모양이 셋이라
     * 놓치기 쉬웠다 — 화면에 5개인데 배지가 4로 남는 어긋남이 실제로 났다(2026-09-11).
     * 이 경로는 훅이 id 로 직접 알려 주므로 짝만 맞으면 틀릴 수 없다.
     */
    agentEvent?: 'start' | 'stop'
    agentId?: string
    /** `general-purpose` 등. 툴팁의 종류별 개수에 쓴다 */
    agentType?: string
    /**
     * **지금 도는 서브에이전트 목록 전체** — 증분이 아니라 스냅샷이다.
     *
     * 상태 파일은 "마지막 보고 한 건" 만 담으므로, TCP 가 막혀 폴링(400ms)으로만 전달되는
     * 환경에서는 한 주기 안에 겹친 보고가 덮여 사라진다. 상태값은 최신 하나만 의미가 있어
     * 문제가 없었지만 **개수는 누적이라 한 건만 잃어도 영영 어긋난다.** 그래서 훅이 목록을
     * 통째로 싣고(`hooks/agentdeck-notify.ps1`) 여기서는 그대로 갈아 끼운다.
     *
     * PowerShell 의 JSON 변환은 원소가 하나면 배열을 스칼라로 접으므로 단일 객체도 받는다.
     */
    agents?: { id?: string, type?: string, at?: number } | { id?: string, type?: string, at?: number }[]
}

/**
 * 대화기록을 다시 재는 주기 — 폴링(400ms) 몇 번마다 한 번인지. 5 = 2초.
 *
 * 상태 파일 폴링(400ms)에 얹지 않는 이유: 하는 일이 "자랐나" 를 보는 것뿐이라 초당 두 번 반
 * 볼 값어치가 없고, 자란 경우에는 파일을 읽는다 — 그 비용을 400ms 마다 낼 수는 없다.
 * 사람이 사이드바 숫자에서 2초를 늦게 보는 것은 눈에 띄지 않는다(경과시간도 1초 단위로 흐른다).
 */
const SUBAGENT_SCAN_EVERY = 5
/**
 * 한 탭에서 기억할 "만진 파일" 개수 상한.
 *
 * `변경` 탭 목록의 재료라 화면에 그려지는 수(`MAX_DIFF_FILES` 300)보다 넉넉하면 충분하다.
 * 넘치면 오래된 것부터 버린다 — 버려도 '전체' 로 바꾸면 그 파일은 여전히 보인다.
 */
const TOUCHED_MAX = 400
/**
 * 그 주기 안에서 **몇 번째** 폴링에 볼지. `refreshPids`(0번째)와 겹치지 않게 어긋나 둔다 —
 * 같은 tick 에 몰면 pty 조회와 파일 읽기가 한 프레임에 같이 걸린다.
 */
const SUBAGENT_SCAN_PHASE = 2
/**
 * 대화기록 파일을 못 찾았을 때 폴더를 다시 훑기까지의 간격 (ms).
 *
 * 못 찾는 것은 정상 상태일 수 있다 — 세션 첫 줄이 아직 안 쓰였거나(파일이 없다), 훅만 붙은
 * 다른 CLI 다. 그런 세션 때문에 2초마다 `~/.claude/projects` 전체를 readdir 하면 안 된다.
 */
const TRANSCRIPT_LOOKUP_RETRY_MS = 10000
/**
 * Codex 세션 기록 스캔이 도는 tick (`SUBAGENT_SCAN_EVERY` 주기 안에서 몇 번째인가).
 * pid 조회(0)·대화기록 스캔(2)과 어긋나게 둬서 한 프레임에 파일 작업이 겹치지 않게 한다.
 */
const CODEX_META_SCAN_PHASE = 4

/**
 * 세션 하나의 대화기록 증분 스캔 상태.
 *
 * **decoder 를 상태와 함께 들고 있는 이유** — 증분 읽기는 바이트 오프셋으로 끊으므로 UTF-8
 * 멀티바이트(한글 설명)가 경계에서 쪼개진다. `Buffer.toString()` 으로 잘라 쓰면 그 자리에
 * 대체문자가 박혀 툴팁 글자가 깨진다. `StringDecoder` 는 남은 바이트를 자기가 들고 다음
 * `write` 에 이어 주므로 경계가 사라진다. 그래서 **파일 하나당 하나**여야 하고, 파일이
 * 갈리거나(세션 교체) 잘리면 상태와 함께 새로 만든다(`resetScan`).
 */
interface SubagentScan {
    sessionId: string
    state: SubagentState
    decoder: StringDecoder
    /** 대화기록 파일 경로. null = 아직 못 찾았다 */
    path: string | null
    /** 마지막으로 **다 읽은** 바이트 수 — 다음에는 여기부터만 읽는다 */
    lastSize: number
    /** 읽기(또는 폴더 훑기)가 도는 중 — 겹쳐 돌면 같은 구간을 두 번 먹인다 */
    busy: boolean
    /** 마지막 폴더 훑기 시각 (ms) */
    lookupAt: number
    /** 지금까지 먹인 결과 — 사이드바가 되읽는 값 */
    summary: SubagentSummary
}

/**
 * 탭에 안 묶인 세션의 모델 보고를 기억해 두는 시간 (ms).
 *
 * 버리지 않는 이유는 `pollMeta` 주석에 있다(statusLine 이 훅보다 먼저 돌 수 있다). 다만
 * **영원히 들고 있으면 안 된다** — Tabby 를 며칠 켜 두면 다른 창·VSCode 에서 돈 세션까지
 * 쌓인다. 한 번도 묶이지 않은 채 이 시간이 지나면 우리 탭의 것이 아니었던 것으로 본다.
 */
const META_TTL_MS = 2 * 60 * 60 * 1000

/**
 * statusLine 래퍼(`hooks/agentdeck-statusline.mjs`)가 보내는 스냅샷.
 *
 * **훅(NotifyFile)과 원천이 다르다.** 여기 있는 값(모델·effort·컨텍스트%·5h/7d 한도%)은
 * 훅 JSON 에 아예 없고 statusLine stdin 에만 내려온다. 그래서 전달 통로도 폴더도 따로 둔다.
 * 계정만 예외로 래퍼가 설정 파일에서 읽어 함께 싣는다 (stdin 에 없다).
 */
export interface AgentMeta {
    sessionId: string
    /** 래퍼가 쓴 시각 (epoch ms) — 같은 값을 두 번 반영하지 않기 위한 판별자 */
    ts: number
    agent: string
    /** 사람이 읽는 이름 (`Opus 5`). 없으면 modelId 로 떨어진다 */
    model: string
    modelId: string
    /** `high` / `medium` / … — 없을 수 있다 */
    effort: string
    version: string
    fastMode: boolean
    /** 로그인 계정 메일. 래퍼가 `CLAUDE_CONFIG_DIR` 을 먼저 보므로 탭마다 갈라 써도 맞는다 */
    account: string
    org: string
    configDir: string
    cwd: string
    /** 컨텍스트 사용률(%) — 모르면 null */
    contextPct: number | null
    limits: {
        fiveHourPct: number | null
        fiveHourResetsAt: number
        sevenDayPct: number | null
        sevenDayResetsAt: number
        /**
         * 모델별 주간 한도 (Fable 등) — Claude 래퍼만 채운다. statusLine stdin 에는 없어서
         * 래퍼가 `/api/oauth/usage` 를 따로 물어본 값이고, 없으면 칸이 안 생긴다 (meta.ts)
         */
        scopedName?: string
        scopedPct?: number | null
        scopedResetsAt?: number
    }
}

/** Codex 세션 기록 하나의 증분 스캔 상태 (`SubagentScan` 과 같은 구조·같은 이유) */
interface CodexScan {
    sessionId: string
    state: CodexState
    decoder: StringDecoder
    path: string | null
    lastSize: number
    busy: boolean
    lookupAt: number
}

/** 사이드바(`deck.service` renderTab)에 넘기는 결론 */
export interface SubagentView {
    sessionId: string
    /** 도는 중인 개수 — 0 이면 이 객체를 아예 만들지 않는다(`subagentsOf` 가 null) */
    running: number
    items: readonly SubagentCall[]
    /** 그대로 `title` 에 넣을 문장. 빈 문자열이면 붙이지 않는다 */
    tooltip: string
}

/** 경과 시간을 짧은 한국어로 (`40초` / `3분` / `2시간 5분` / `1일 3시간`) */
function formatAge (ms: number): string {
    // 음수는 시계 어긋남(파일의 timestamp 가 미래) — 0 으로 눕힌다
    const s = Math.max(0, Math.floor(ms / 1000))
    if (s < 60) {
        return `${s}초`
    }
    const m = Math.floor(s / 60)
    if (m < 60) {
        return `${m}분`
    }
    const h = Math.floor(m / 60)
    if (h < 24) {
        return h + '시간' + (m % 60 ? ` ${m % 60}분` : '')
    }
    const d = Math.floor(h / 24)
    return d + '일' + (h % 24 ? ` ${h % 24}시간` : '')
}

/**
 * 에이전트 훅 -> 사이드바 상태 채널. **기본으로 켜져 있다** (`notifyChannel`).
 *
 * 이쪽이 상태의 정확한 원천이다 — 에이전트가 "지시를 받았다 / 승인을 기다린다 / 끝났다" 를
 * 직접 알려준다. 출력 패턴으로 추측하는 경로(detect.ts)는 훅이 없는 환경을 위한 폴백이고,
 * TUI 가 화면을 어떻게 그리는지에 기대는 만큼 흔들린다 (2026-09-01: Claude Code 가 놀 때도
 * 상태줄을 매초 갱신해 진행중이 안 풀렸다).
 *
 * 훅은 Claude Code 쪽 설정에 있어야 해서 플러그인 설치만으로는 걸리지 않는다. 그래서
 * 기동할 때 한 번 물어보고(promptHooksOnce), 설정 창에도 설치 버튼을 둔다(claudeHooks.ts).
 *
 * 왜 파일인가 — 콘솔 제목 방식(`hooks/agentdeck-status.ps1`)은 **훅에서는 통하지 않는다**.
 * Claude Code 는 훅을 파이프 stdio 로 띄우기 때문에 그 자식 프로세스는 터미널의 콘솔에
 * 붙어 있지 않고, 제목을 바꿔도 pty 까지 오지 않는다 (2026-08-28 실측: 훅으로
 * `[AD:waiting] ...` 을 걸어도 사이드바가 그대로였다). 셸 안에서 직접 실행할 때는
 * 제목 방식이 여전히 유효하므로 그 경로는 남겨 둔다.
 *
 * 전달 경로는 두 가닥이다.
 *
 * 1. **TCP (기본)** — 이쪽이 `127.0.0.1` 임의 포트로 듣고, 실제 포트를
 *    `%LOCALAPPDATA%\tabby-agentdeck\port` 에 적어 둔다. 훅은 그 포트로 JSON 한 줄을
 *    보내고 끊는다. 폴링 지연이 없고 상태 파일도 남지 않는다.
 * 2. **파일 (폴백)** — TCP 연결이 안 되면(Tabby 미기동, 포트 파일 없음, 방화벽)
 *    훅이 `...\status\<sessionId>.json` 에 쓰고 이쪽이 400ms 마다 읽는다.
 *
 * 두 경로 모두 `apply()` 로 모이고, `applied` 의 ts 대조가 중복 적용을 막으므로
 * 같은 보고가 양쪽으로 들어와도 결과는 같다.
 *
 * 세션 -> 탭 매칭: 어떤 Claude 세션이 **처음** 보고할 때의 활성 탭에 묶는다.
 * 사용자가 프롬프트를 넣은 탭이 곧 활성 탭이므로 이 규칙이면 탭이 여러 개여도 맞다.
 * 한 번 묶으면 그 뒤로는 활성 탭이 바뀌어도 같은 탭을 따라간다.
 */
@Injectable({ providedIn: 'root' })
export class WorkNotifyService {
    private root = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'tabby-agentdeck',
    )
    private dir = path.join(this.root, 'status')
    // Test/multiple Tabby profiles must never share a mailbox writer or endpoint.
    private mailboxRoot = process.env.TABBY_CONFIG_DIRECTORY
        ? path.join(process.env.TABBY_CONFIG_DIRECTORY, 'agentdeck-mailbox') : this.root
    private mailbox: SessionMailbox | null = null
    private mailboxOwners = new Map<string, { sessionId: string; tab: BaseTabComponent; clientPid: number }>()
    private navigationContext = ''
    private navigationRefresh: (() => void) | null = null

    setNavigationRefresh (refresh: () => void): void { this.navigationRefresh = refresh }

    mailboxConnectionState (tab: BaseTabComponent): string {
        const owners = [...this.mailboxOwners.entries()].filter(([, owner]) => owner.tab === tab)
        if (!owners.length) { return 'mailbox=not registered; MCP=not connected' }
        return owners.map(([pane, owner]) => {
            let connected = false
            try {
                const pid = Number(fs.readFileSync(path.join(this.mailboxRoot, 'mailbox-connections', pane + '.client'), 'utf8'))
                if (pid > 0 && pid === owner.clientPid) { process.kill(pid, 0); connected = true }
            } catch {}
            return `session ${owner.sessionId}: mailbox=registered; MCP=${connected ? 'connected' : 'not connected (CLI transport available)'}`
        }).join('; ')
    }

    publishNavigationContext (context: string): void {
        if (context === this.navigationContext) { return }
        try {
            fs.mkdirSync(this.mailboxRoot, { recursive: true })
            fs.writeFileSync(path.join(this.mailboxRoot, 'navigation-context.txt'), context, 'utf8')
            this.navigationContext = context
        } catch (error) { diagCatch('navigation context', error) }
    }

    sessionIdOf (tab: BaseTabComponent): string | null {
        const sessions = this.sessionIdsOf(tab)
        return sessions.length === 1 ? sessions[0] : null
    }

    sessionIdsOf (tab: BaseTabComponent): string[] {
        return [...new Set([...this.mailboxOwners.values()].filter(owner => owner.tab === tab).map(owner => owner.sessionId))]
    }

    private registerMailbox (sessionId: string, tab: BaseTabComponent, paneId: string | undefined): void {
        if (!paneId || !(this.tabIds.get(tab) ?? []).includes(paneId)) { return }
        const previous = this.mailboxOwners.get(paneId)
        let clientPid = 0
        try { clientPid = Number(fs.readFileSync(path.join(this.mailboxRoot, 'mailbox-connections', paneId + '.client'), 'utf8')) } catch {}
        if (previous?.sessionId === sessionId && previous.clientPid === clientPid) { return }
        try {
            this.mailbox ??= new SessionMailbox(path.join(this.mailboxRoot, 'mailbox.json'))
            if (previous && previous.sessionId !== sessionId) { this.mailbox.close(previous.sessionId) }
            const credentials = this.mailbox.register(sessionId, tab.customTitle || tab.title || '', this.cwdOf(tab) || '')
            const dir = path.join(this.mailboxRoot, 'mailbox-connections')
            fs.mkdirSync(dir, { recursive: true })
            for (const id of [paneId]) {
                if (!/^[a-zA-Z0-9_-]+$/.test(id)) { continue }
                fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ ...credentials, clientPid }), { mode: 0o600 })
            }
            this.mailboxOwners.set(paneId, { sessionId, tab, clientPid })
        } catch (error) { diagCatch('mailbox register', error) }
    }
    /** statusLine 래퍼(`hooks/agentdeck-statusline.mjs`)가 모델·계정·한도를 남기는 곳 */
    private metaDir = path.join(this.root, 'meta')
    /** 훅이 접속할 포트를 알려주는 파일 */
    private portFile = path.join(this.root, 'port')
    private server: net.Server | null = null
    private sessionTab = new Map<string, BaseTabComponent>()
    /** 역방향 — 한 탭을 두 세션이 나눠 쓰지 못하게 막는다 */
    private tabSession = new Map<BaseTabComponent, string>()
    /** 이미 적용한 (sessionId -> ts) — 같은 파일을 반복 적용하지 않는다 */
    private applied = new Map<string, number>()
    private timer: any = null
    /** 폴링을 시작한 시각 — 이보다 오래된 파일은 지난 실행의 잔재다 */
    private startedAt = 0
    /**
     * 탭(루트) -> 그 안 패널들의 셸 PID. 훅이 보낸 조상 PID 와 맞춰 어느 탭의 보고인지 확정한다.
     * pty 에 물어보는 비동기 작업이라 표로 들고 있고, 탭이 열릴 때와 2초마다 새로 채운다
     */
    private tabPids = new Map<BaseTabComponent, number[]>()
    private pidRefreshing = false
    /**
     * 탭(루트) -> 그 안 패널 셸에 심은 `AGENTDECK_TAB` 값들(tabenv.ts). 훅이 tabId 로 보내면 여기서 바로
     * 확정하고, 프로세스 계보(tabPids)는 이 표에 없을 때의 폴백이다. 패널의 `profile.options.env` 를 읽어
     * 다시 채우므로 재시작으로 복원된 탭(복원 토큰에 profile 이 통째로 들어간다, tabby-local
     * dist/index.js:639-648)도 지난 실행의 id 를 그대로 되찾는다 — 살아 있는 pty 에 다시 붙든, 복원이
     * 실패해 같은 options 로 새 셸을 띄우든 셸 환경은 그 값이다
     */
    private tabIds = new Map<BaseTabComponent, string[]>()
    /**
     * 탭(루트) -> 훅이 알려 준 작업 폴더. 상대경로 풀기·`변경` 탭의 git 기준이 된다.
     *
     * **Tabby 의 추정값보다 앞세우려고 따로 든다** (NotifyFile.cwd 주석 참고). 약참조라 탭이
     * 사라지면 같이 사라진다 — 탭 닫힘을 따로 청소할 필요가 없다.
     */
    private hookCwd = new WeakMap<BaseTabComponent, string>()
    /**
     * 탭(루트) -> 훅이 말해 준 CLI (`claude` / `codex` / `gemini`).
     *
     * 이게 있으면 deck.service 는 프로세스·제목·화면으로 추측하지 않는다(`NotifyFile.agent` 주석).
     * 같은 탭에서 다른 CLI 를 띄우면 그쪽 훅의 첫 보고가 값을 덮는다 — 훅이 없는 CLI 로
     * 갈아타면 옛 값이 남지만, 그건 추측 경로로 떨어지는 것보다 낫다(적어도 한 번은 사실이었다).
     */
    private hookAgent = new WeakMap<BaseTabComponent, AgentId>()
    // A disproved session must not regain its identity from retained model metadata.
    private rejectedMetaSession = new WeakMap<BaseTabComponent, string>()
    /**
     * 탭(루트) -> 이번 세션에서 에이전트가 고친 파일들 (훅이 보고한 절대경로, 최신이 앞).
     *
     * `변경` 탭이 "저장소 전체" 대신 "이 세션이 만진 것" 을 그리는 근거다 — P4 워크스페이스 위에
     * git 을 얹은 저장소에서는 전체 diff 가 수백 개씩 나와 방금 고친 것을 찾을 수 없다
     * (2026-09-11 유저 지적). 훅이 없는 에이전트는 이 목록이 비고, 그때는 전체를 그린다.
     *
     * 상한을 두는 이유 — 오래 도는 세션에서 무한히 자란다. 넘치면 오래된 것부터 버린다.
     * 버려진 파일은 '전체' 로 바꾸면 여전히 보인다.
     */
    private touched = new WeakMap<BaseTabComponent, string[]>()
    /**
     * 탭(루트) -> 훅이 "지금 돌고 있다" 고 알려 준 서브에이전트들 (`agent_id` -> 정보).
     *
     * **이 표가 있는 탭에서는 이것이 개수의 진실이고**, 대화기록 훑기(`scans`)는 훅이 없는
     * 세션의 폴백으로만 쓴다. 두 원천을 섞지 않는 이유: 배지 숫자와 툴팁 목록이 서로 다른
     * 원천에서 나오면 "4개라면서 5줄" 같은 화면이 나온다 — 사용자가 어긋남을 본 바로 그 모양이다.
     */
    private liveAgents = new WeakMap<BaseTabComponent, Map<string, LiveAgent>>()
    /**
     * 서브에이전트 훅 보고를 **한 번이라도 받은** 탭. 이 표에 있으면 개수를 훅으로만 센다.
     *
     * "지금 0개" 와 "훅이 없어서 모른다" 를 가르는 유일한 자리다. 이게 없으면 에이전트가 전부
     * 끝난 순간(집합이 빔) 폴백이 되살아나 옛 기록을 세어 유령 숫자가 다시 뜬다.
     */
    private agentHookSeen = new WeakSet<BaseTabComponent>()
    /** tabAdded$ 를 이미 구독한 분할 루트 — 루트가 사라지면 함께 사라진다 */
    private watchedSplits = new WeakSet<object>()
    private pollCount = 0
    /**
     * 세션 id -> statusLine 래퍼가 보고한 모델·계정·한도.
     *
     * **탭이 아니라 세션을 키로 둔다** (`scans` 와 같은 이유) — 같은 탭에서 claude 를 다시 띄우면
     * 세션 id 가 새로 생기고, 그때 옛 값이 따라붙으면 안 된다. 탭 ↔ 세션 매칭은 훅이 확정한
     * `tabSession` 하나만 쓴다 (활성 탭 추측은 이 저장소가 이미 한 번 크게 데었다).
     */
    private metaBySession = new Map<string, AgentMeta>()
    /**
     * 세션 id -> Codex 세션 기록 증분 스캔. Codex 에는 statusLine 이 없어 기록에서 직접 뽑는다
     * (`scanCodexMeta`). 키를 세션으로 두는 이유는 `scans` 와 같다.
     */
    private codexScans = new Map<string, CodexScan>()
    /** `auth.json` 에서 푼 Codex 계정 — 파일이 바뀔 때만 다시 읽는다 */
    private codexAuth: { mtime: number, email: string } | null = null
    private codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
    /** 모델·한도 값이 바뀌면 부른다 (사이드바 다시 그리기). deck.service 가 꽂는다 */
    onMetaChange: (() => void) | null = null
    /** 같은 매칭 실패를 폴링마다 diag 에 찍지 않기 위한 마지막 메시지 */
    private lastBindLog = new Map<string, string>()
    /**
     * 세션 id -> 대화기록 증분 스캔 상태. 탭에 묶인 세션만 들어 있다(`pruneScans`).
     *
     * 탭이 아니라 **세션** 을 키로 두는 이유: 같은 탭에서 claude 를 다시 띄우면 세션 id 가
     * 새로 생기는데(그게 정상이다) 탭을 키로 두면 옛 세션의 줄 수·호출 목록이 새 세션 것으로
     * 이어져 개수가 틀어진다.
     */
    private scans = new Map<string, SubagentScan>()
    /**
     * Claude Code 대화기록이 사는 곳. 그 아래 프로젝트 폴더 이름은 **규칙을 흉내내지 않고**
     * 훑어서 찾는다 (`findTranscript`).
     */
    private projectsDir = path.join(os.homedir(), '.claude', 'projects')

    constructor (
        private app: AppService,
        private config: ConfigService,
        private status: WorkStatusService,
        private platform: PlatformService,
    ) { }

    /**
     * 훅이 안 걸려 있으면 기동할 때 한 번 물어본다.
     *
     * 훅은 Claude Code 쪽 설정(`~/.claude/settings.json`)에 있어야 해서 플러그인을 설치하는 것만으로는
     * 걸리지 않는다. 그렇다고 말없이 남의 설정을 고칠 수는 없으니, 한 번 묻고 고른 대로 한다.
     * "다시 묻지 않기" 를 고르면 그 뒤로는 조용하고, 설정 창의 설치 버튼은 언제든 그대로 쓸 수 있다.
     */
    private async promptHooksOnce (): Promise<void> {
        const cfg = this.config.store.agentDeck
        if (cfg.hookPromptDismissed || !hooksSupported()) {
            return
        }
        try {
            if (hooksInstalled()) {
                return
            }
        } catch {
            // 설정을 못 읽었다 — 그 상태로 남의 파일을 고치자고 권할 수는 없다
            return
        }

        const r = await this.platform.showMessageBox({
            // 이 타입에는 'question' 이 없다 (tabby-core MessageBoxOptions) — 경고로 띄우면
            // 필요 이상으로 겁을 주므로 'warning' 대신 형만 맞추고 문구로 성격을 드러낸다
            type: 'warning',
            message: 'AgentDeck — Claude Code 상태 통보를 연결할까요?',
            detail: [
                '연결하면 에이전트가 "지시를 받았다 / 승인을 기다린다 / 끝났다" 를 사이드바에 직접 알려줍니다.',
                '연결하지 않아도 동작은 하지만, 화면에 그려진 글자를 보고 추측하는 방식이라 상태가 부정확할 수 있습니다.',
                '',
                `설치 위치: ${claudeSettingsPath()}`,
                '기존 훅은 건드리지 않고, 쓰기 전에 같은 폴더에 백업을 남깁니다. 설정 창에서 언제든 제거할 수 있습니다.',
            ].join('\n'),
            buttons: ['연결한다', '나중에', '다시 묻지 않기'],
            defaultId: 0,
            cancelId: 1,
        })

        if (r.response === 0) {
            try {
                installHooks()
                if (!cfg.notifyChannel) {
                    cfg.notifyChannel = true
                }
                this.config.save()
            } catch (e: any) {
                await this.platform.showMessageBox({
                    type: 'error',
                    message: 'AgentDeck — 훅을 설치하지 못했습니다.',
                    detail: `${e?.message ?? e}`,
                    buttons: ['확인'],
                })
            }
            return
        }
        if (r.response === 2) {
            cfg.hookPromptDismissed = true
            this.config.save()
        }
    }

    configureStorageRoots (): void {
        this.root = runtimeRoot()
        this.dir = path.join(this.root, 'status')
        this.metaDir = path.join(this.root, 'meta')
        this.portFile = path.join(this.root, 'port')
        this.mailboxRoot = path.join(this.root, 'mailbox')
        this.codexHome = agentHome('codex')
        this.projectsDir = path.join(agentHome('claude'), 'projects')
    }

    init (): void {
        // 개발/진단용 — deck.service 가 만든 `__agentdeck` 에 붙는다 (alert.service 와 같은 방식).
        // 탭↔AGENTDECK_TAB 매핑은 훅 보고가 어느 탭에 붙을지의 근거인데, 지금까지는 진단 로그의
        // `tabid-map` 줄로만 볼 수 있어 검증 도구가 대조할 방법이 없었다 (2026-09-08 R18).
        const g = window as any
        g.__agentdeck = g.__agentdeck ?? {}
        g.__agentdeck.runtimePaths = () => ({ root: this.root, status: this.dir, meta: this.metaDir, mailbox: this.mailboxRoot })
        g.__agentdeck.tabIds = () => [...this.tabIds].map(([tab, ids]) => ({
            title: (tab as any).title ?? '', ids,
        }))
        /**
         * 탭별 "훅이 말해 준 것" — 작업 폴더와 이번 세션이 만진 파일.
         *
         * `변경` 탭이 목록을 안 좁힐 때 **"훅 보고가 안 왔다" 와 "필터가 안 걸렸다" 를 가르는**
         * 유일한 자리다. 이게 없어서 회귀(CW6)가 원인을 못 짚고 한 바퀴를 돌았다 (2026-09-11).
         */
        g.__agentdeck.hookInfo = () => this.app.tabs.map((tab, index) => ({
            index,
            title: String((tab as any).title ?? '').slice(0, 40),
            sessionId: this.tabSession.get(tab) ?? null,
            cwd: this.hookCwd.get(tab) ?? null,
            touched: this.touched.get(tab) ?? [],
            // 서브에이전트 숫자가 이상할 때 **어느 원천을 보고 있는지**부터 가른다 —
            // `agentHook: false` 면 훅을 못 받아 대화기록 훑기로 센 값이다
            agentHook: this.agentHookSeen.has(tab),
            agents: [...(this.liveAgents.get(tab)?.values() ?? [])],
        }))
        /**
         * statusLine 래퍼가 보고한 모델·계정·한도 (회귀용).
         *
         * "줄이 안 뜬다" 를 세 가지로 가르는 자리다 — 래퍼가 안 걸렸나(`reports: 0`),
         * 걸렸는데 세션이 탭에 안 묶였나(`bound: null`), 묶였는데 화면만 안 그렸나.
         */
        g.__agentdeck.meta = () => ({
            dir: this.metaDir,
            reports: [...this.metaBySession.values()].map(m => ({
                sessionId: m.sessionId,
                model: m.model,
                effort: m.effort,
                account: m.account,
                contextPct: m.contextPct,
                limits: m.limits,
                ageMs: Date.now() - m.ts,
                bound: this.app.tabs.indexOf(this.sessionTab.get(m.sessionId) as any),
            })),
            active: this.metaOf(this.app.activeTab as any),
        })
        /**
         * 서브에이전트 개수의 **지금 상태**를 좌표 없이 되읽는다 (회귀용).
         *
         * 규칙의 사본을 만들지 않는다 — 개수는 `subagents.ts` 가 세고 여기서는 그 결과와
         * 스캔 배선(대화기록을 찾았나·어디까지 읽었나)만 내놓는다. 검증 도구가 "0 개인 이유" 를
         * 가르는 데 필요한 것이 정확히 그 배선이다: 파일을 못 찾은 것(`transcript: null`)과
         * 찾아서 다 읽었는데 도는 게 없는 것(`lastSize > 0, running: 0`)은 전혀 다른 상황이다.
         * `index` 는 `app.tabs` 인덱스 — 사이드바 줄의 `data-ad-index` 와 같은 뜻이라
         * 프로브가 줄을 찾을 때 쓴다.
         */
        g.__agentdeck.subagents = () => ({
            enabled: this.subagentEnabled,
            projectsDir: this.projectsDir,
            tabs: [...this.tabSession].map(([tab, sid]) => {
                const scan = this.scans.get(sid)
                const sum = scan?.summary
                return {
                    index: this.app.tabs.indexOf(tab),
                    title: String((tab as any).title ?? '').slice(0, 40),
                    tabId: this.tabIds.get(tab)?.[0] ?? null,
                    sessionId: sid,
                    transcript: scan?.path ?? null,
                    lastSize: scan?.lastSize ?? 0,
                    lines: scan?.state.lines ?? 0,
                    skipped: scan?.state.skipped ?? 0,
                    running: sum?.running ?? 0,
                    calls: sum?.calls ?? 0,
                    done: sum?.done ?? 0,
                    items: (sum?.items ?? []).map(c => ({
                        id: c.id, description: c.description, subagentType: c.subagentType, startedAt: c.startedAt,
                    })),
                    tooltip: sum ? this.subagentTooltip(sum) : '',
                }
            }),
        })

        this.app.ready$.subscribe(() => {
            // 이미 열려 있는 탭 중 셸이 아직 안 뜬 패널이 있으면 지금 심는다 (기동 직후의 첫 탭).
            // 셸이 이미 뜬 패널은 못 심고 계보 폴백으로 남는다
            for (const root of [...this.app.tabs]) {
                this.stampRoot(root)
            }
            // 훅이 안 걸려 있으면 기동할 때 한 번 물어본다. 통로만 열려 있고 보고자가 없으면
            // 아무 일도 일어나지 않는데, 사용자 눈에는 그냥 "상태가 이상하다" 로만 보인다.
            // 기동 직후는 화면이 정신없으니 조금 뒤에 띄운다
            setTimeout(() => { void this.promptHooksOnce() }, 3000)

            // 채널이 닫혀 있으면 훅이 보낸 보고가 어디에도 닿지 않는다.
            // 기본은 열려 있고, 비용은 유휴 포트 하나와 400ms 폴링뿐이다
            if (!this.config.store.agentDeck.notifyChannel) {
                return
            }
            this.startedAt = Date.now()
            this.listen()
            this.timer = setInterval(() => this.poll(), 400)
            void this.refreshPids()
        })
        this.app.tabOpened$.subscribe(tab => {
            // 셸은 아직 안 떴다 — `openNewTab` 은 `tabsService.create` 직후 `addTabRaw` 에서 동기로 tabOpened 를
            // 내고(tabby-core dist/index.js:5029), 셸은 그 뒤 프런트엔드가 준비된 다음에야 뜬다(tabby-local
            // dist/index.js:623-635). 여기서 profile.options.env 에 심어야 셸이 물려받는다
            this.stampRoot(tab)
            // 새 탭의 셸 PID 는 세션이 붙은 뒤에야 나온다 — 조금 뒤에 한 번 더 채운다 (2초 주기 폴링도 있다)
            setTimeout(() => { void this.refreshPids() }, 1500)
        })
        // 탭이 닫히면 점유를 풀어야 그 자리를 다음 세션이 쓸 수 있다
        this.app.tabClosed$.subscribe(tab => {
            for (const [paneId, owner] of this.mailboxOwners) {
                if (owner.tab === tab) { this.mailbox?.close(owner.sessionId); this.mailboxOwners.delete(paneId) }
            }
            this.tabPids.delete(tab)
            this.tabIds.delete(tab)
            const sid = this.tabSession.get(tab)
            if (sid) {
                this.tabSession.delete(tab)
                this.sessionTab.delete(sid)
                // 스캔 상태(줄 수·호출 목록·decoder)도 같이 버린다 — 닫힌 탭의 세션은 다시
                // 그려질 일이 없고, 안 지우면 하루 켜 둔 Tabby 에서 죽은 세션이 끝없이 쌓인다.
                // 이 저장소에서 같은 종류의 누수(`status.states`)가 실제 결함으로 잡혔다
                this.scans.delete(sid)
            }
        })
    }

    /** 진단 한 줄 — deck.service 와 같은 파일(`~/.agentdeck-diag.log`)에 남긴다 */
    private diag (line: string): void {
        diag(line)
    }

    private tabName (tab: BaseTabComponent): string {
        const anyTab = tab as any
        return JSON.stringify(String(anyTab.customTitle || anyTab.title || '').slice(0, 40))
    }

    /**
     * 탭별 셸 PID 표를 새로 채운다. 로컬 pty 는 `session.pty.getPID()` 로 셸 PID 를 준다
     * (tabby-local Session — gracefullyKillProcess 가 쓰는 그 경로). SSH 등 PID 가 없는 탭은 빈 목록.
     */
    private async refreshPids (): Promise<void> {
        if (this.pidRefreshing) {
            return
        }
        this.pidRefreshing = true
        try {
            for (const root of [...this.app.tabs]) {
                const pids: number[] = []
                for (const pane of this.panesOf(root)) {
                    const pty = pane?.session?.pty
                    if (!pty || typeof pty.getPID !== 'function') {
                        continue
                    }
                    try {
                        const pid = await pty.getPID()
                        if (Number.isInteger(pid) && pid > 0) {
                            pids.push(pid)
                        }
                    } catch {
                        // 세션이 닫히는 중이다
                    }
                }
                const prev = this.tabPids.get(root)
                if (!prev || prev.join(',') !== pids.join(',')) {
                    this.tabPids.set(root, pids)
                    this.diag(`pid-map tab=${this.tabName(root)} pids=[${pids.join(',')}]`)
                }
            }
        } finally {
            this.pidRefreshing = false
        }
    }

    /** 루트 하나의 터미널 패널들 — 분할 래퍼(`app.tabs` 의 원소는 SplitTabComponent)면 자식들, 아니면 자기 자신 */
    private panesOf (root: BaseTabComponent): any[] {
        const anyRoot = root as any
        return typeof anyRoot.getAllTabs === 'function' ? anyRoot.getAllTabs() : [root]
    }

    private isLocalProfile (profile: any): boolean {
        return !!profile && profile.type === 'local' && !!profile.options && typeof profile.options === 'object'
    }

    /**
     * 새 루트 탭의 셸에 `AGENTDECK_TAB` 을 심는다 — 지금 있는 패널, 복원 토큰 안의 패널, 나중에 분할로 붙는 패널.
     *
     * 심는 자리가 맞는 근거 (tabby-local/dist/index.js, 1.0.231):
     *  - 셸은 `onFrontendReady -> initializeSession` 이 `session.start({ ...this.profile.options, width, height })`
     *    로 띄운다(623-635). 자식 env 는 `mergeEnv(process.env, {TERM_PROGRAM: 'Tabby', …}, substituteEnv(options.env),
     *    config.store.terminal.environment)` 다(1158-1162). 즉 **spawn 시점의 `pane.profile.options.env`** 가 셸 환경이다.
     *  - `ngOnInit` 의 `this.sessionOptions = this.profile.options`(604-605) 는 같은 객체를 가리키는 참조일 뿐
     *    spawn 에 쓰이지 않는다. profile 을 새 객체로 바꾸므로 그것도 같이 맞춰 둔다.
     *  - `tab.profile` 은 `getNewTabParameters` 가 deep clone 한 것(898)이라 저장된 프로필과 다른 객체다. 그래도
     *    여기서 다시 얕게 복제해 넣는다 — 다른 경로(복원·복제 토큰)로 들어온 profile 이 공유 객체일 가능성을 막고,
     *    탭 하나의 id 가 설정 파일의 프로필로 새는 일이 없게 한다.
     *
     * 타이밍 (tabby-core/dist/index.js): `openNewTab`(5075) 은 `wrapAndAddTab`(5086) 에서 `splitTab.addTab(tab)` 을
     * 부르고 — `add()` 는 첫 await(2620 `initialized$`) 앞에서 자식을 `children` 에 넣는다(2618) — 그 다음
     * `addTabRaw` 가 `tabOpened.next(splitTab)` 를 낸다(5029). 그래서 tabOpened 시점에 `getAllTabs()` 에 자식이
     * 있고 `session` 은 아직 null 이다.
     */
    private stampRoot (root: BaseTabComponent): void {
        this.stampPanes(root)
        const anyRoot = root as any
        // 복제 탭(duplicateTab, 5245-5249)과 재시작 복원 탭(5003-5006)은 이 시점에 자식이 없고 복원 토큰
        // (`_recoveredState`)만 있다 — 자식은 ngAfterViewInit 의 recoverContainer 가 비동기로 만들고(2488-2491,
        // 3093 `tabsService.create(recovered)`) tabAdded 도 내지 않는다. 토큰 안의 profile 을 지금 고치면 그것이
        // 그대로 자식의 profile 이 된다 (recoverTab -> inputs.profile)
        if (anyRoot._recoveredState && typeof anyRoot._recoveredState === 'object') {
            this.stampRecoveryState(anyRoot._recoveredState, root)
        }
        // 나중에 분할로 붙는 패널 — tabAdded 는 onAfterTabAdded 의 setImmediate 에서 나오는데(2935-2939),
        // 셸은 그보다 뒤인 프런트엔드 준비 후에 뜬다. 혹시 이미 떠 있으면 stampPane 이 건너뛴다.
        // Subject 는 루트가 destroy 될 때 complete 되므로(2510) 구독을 따로 풀 필요가 없다
        if (anyRoot.tabAdded$ && typeof anyRoot.tabAdded$.subscribe === 'function' && !this.watchedSplits.has(root)) {
            this.watchedSplits.add(root)
            anyRoot.tabAdded$.subscribe(() => this.stampPanes(root))
        }
    }

    private stampPanes (root: BaseTabComponent): void {
        for (const pane of this.panesOf(root)) {
            this.stampPane(pane, root)
        }
        this.refreshTabIds()
    }

    /**
     * 패널 하나에 심는다. **아직 셸이 안 뜬**(`session` 없음) 로컬 패널만 — 이미 뜬 셸의 환경은 바꿀 수 없다.
     * 복원 패널(`restoreFromPTYID`)은 살아 있는 pty 에 다시 붙으므로 건드리지 않는다 — 토큰의 profile 에
     * 지난 실행의 id 가 있으면 그게 곧 그 셸의 환경이고 refreshTabIds 가 읽어 간다.
     * 이미 id 가 있어도 다른 패널이 같은 값을 갖고 있으면(복제) 새로 뽑는다 — 같은 id 가 두 셸에 있으면 어느 쪽인지 알 수 없다.
     */
    private stampPane (pane: any, root: BaseTabComponent): void {
        if (!pane || pane.session || !this.isLocalProfile(pane.profile) || pane.profile.options.restoreFromPTYID) {
            return
        }
        const env = pane.profile.options.env ?? {}
        const cur = typeof env[TAB_ENV] === 'string' ? env[TAB_ENV] : ''
        if (cur && !this.idTakenElsewhere(cur, pane)) {
            return
        }
        const id = newTabId()
        pane.profile = { ...pane.profile, options: { ...pane.profile.options,
            env: { ...env, [TAB_ENV]: id, ...runtimeEnvironment() } } }
        if (pane.sessionOptions !== undefined) {
            pane.sessionOptions = pane.profile.options
        }
        this.diag(`tabid stamp tab=${this.tabName(root)} id=${id}${cur ? ` (was ${cur}: duplicate)` : ''}`)
    }

    /**
     * 복원 토큰 트리(`app:split-tab` 은 children, 잎은 profile 을 가진다)의 로컬 패널에 심는다.
     * `restoreFromPTYID` 가 있는 잎은 재시작 복원(saveTabs 가 includeState 로 만든 토큰, tabby-core 7700) —
     * 살아 있는 pty 의 환경은 이미 정해져 있으니 두고, 없는 잎은 새 셸이 뜰 것이므로(복제 탭 —
     * `tabsService.duplicate` 는 options 없이 토큰을 만들어 restoreFromPTYID 가 비어 있다, 7819-7830) 항상 새 id 를 준다.
     * 복제 원본의 id 가 토큰에 그대로 실려 오는데 그걸 두면 두 탭이 같은 id 를 갖게 된다
     */
    private stampRecoveryState (state: any, root: BaseTabComponent): void {
        if (Array.isArray(state.children)) {
            for (const child of state.children) {
                if (child && typeof child === 'object') {
                    this.stampRecoveryState(child, root)
                }
            }
            return
        }
        const profile = state.profile
        if (!this.isLocalProfile(profile) || profile.options.restoreFromPTYID) {
            return
        }
        const id = newTabId()
        state.profile = { ...profile, options: { ...profile.options,
            env: { ...(profile.options.env ?? {}), [TAB_ENV]: id, ...runtimeEnvironment() } } }
        this.diag(`tabid stamp tab=${this.tabName(root)} id=${id} (recovery token)`)
    }

    /** 같은 id 를 다른 패널(어느 루트든)이 이미 갖고 있나 */
    private idTakenElsewhere (id: string, self: any): boolean {
        for (const root of this.app.tabs) {
            for (const pane of this.panesOf(root)) {
                if (pane !== self && pane?.profile?.options?.env?.[TAB_ENV] === id) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * 탭별 tabId 표를 패널의 `profile.options.env` 에서 다시 읽는다. 동기·저비용이라 폴링(400ms)마다 돈다 —
     * 복원 탭의 자식은 tabOpened 뒤에 비동기로 생기고(tabby-core 3093) 이벤트도 없어서 읽는 쪽이 주기적으로 봐야 한다.
     * 같은 id 가 두 루트에 있으면(복제 뒤 셸이 이미 뜬 경우) 어느 쪽인지 알 수 없으니 둘 다 표에서 빼고 계보 폴백에 맡긴다.
     */
    private refreshTabIds (): void {
        const owner = new Map<string, BaseTabComponent>()
        const dup = new Set<string>()
        const next = new Map<BaseTabComponent, string[]>()
        for (const root of [...this.app.tabs]) {
            const ids: string[] = []
            for (const pane of this.panesOf(root)) {
                const v = pane?.profile?.options?.env?.[TAB_ENV]
                if (typeof v !== 'string' || !v || ids.includes(v)) {
                    continue
                }
                ids.push(v)
                const prevOwner = owner.get(v)
                if (prevOwner && prevOwner !== root) {
                    dup.add(v)
                } else {
                    owner.set(v, root)
                }
            }
            next.set(root, ids)
        }
        for (const root of [...this.tabIds.keys()]) {
            if (!next.has(root)) {
                this.tabIds.delete(root)
            }
        }
        for (const [root, ids] of next) {
            const clean = ids.filter(v => !dup.has(v))
            const prev = this.tabIds.get(root)
            if (!prev || prev.join(',') !== clean.join(',')) {
                this.tabIds.set(root, clean)
                const dropped = ids.filter(v => dup.has(v))
                this.diag(`tabid-map tab=${this.tabName(root)} ids=[${clean.join(',')}]`
                    + (dropped.length ? ` dup-dropped=[${dropped.join(',')}]` : ''))
            }
        }
    }

    private retireMissingMailboxPanes (): void {
        for (const [paneId, owner] of this.mailboxOwners) {
            if (!(this.tabIds.get(owner.tab) ?? []).includes(paneId)) {
                this.mailbox?.close(owner.sessionId)
                this.mailboxOwners.delete(paneId)
            }
        }
    }

    /** 진단용 */
    get debugDir (): string { return this.dir }
    /** 진단용 — 듣고 있는 포트 (0 = TCP 채널이 안 떴다) */
    get debugPort (): number {
        const addr = this.server?.address()
        return addr && typeof addr === 'object' ? addr.port : 0
    }

    /**
     * 훅이 상태를 바로 밀어 넣을 TCP 채널을 연다.
     *
     * 기본은 `agentDeck.notifyPort` 고정 포트다 — 번호가 늘 같아야 훅이나 진단 도구가
     * 바로 붙을 수 있다. Windows 임시 포트 범위(49152~65535) 아래로 잡아 두어야
     * OS 가 그 번호를 다른 프로세스에 먼저 내주는 일이 없다.
     *
     * 그 번호가 이미 물려 있으면(Tabby 두 개, 다른 프로그램) 0 으로 다시 시도한다 —
     * OS 가 빈 포트를 골라 준다. 어느 쪽이든 실제 번호는 port 파일에 적어 두므로
     * 훅은 고정/임의를 구분할 필요가 없다. 둘 다 실패해도 파일 폴백이 살아 있다.
     */
    private listen (): void {
        const server = net.createServer(socket => {
            let buf = ''
            socket.setEncoding('utf8')
            socket.on('data', chunk => {
                buf += chunk
                if (buf.length > 262144) { socket.destroy(); return }
                // 훅이 여러 건을 몰아 보낼 수도 있으니 줄 단위로 끊어 처리한다
                let nl: number
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl)
                    buf = buf.slice(nl + 1)
                    if (!this.acceptMailbox(line, socket)) { this.accept(line) }
                }
            })
            // 개행 없이 끊는 훅도 받아 준다
            socket.on('end', () => this.accept(buf))
            socket.on('error', () => { /* 훅이 먼저 끊어도 Tabby 가 죽으면 안 된다 */ })
        })
        let fellBack = false
        server.on('error', (e: any) => {
            if (!fellBack) {
                // 고정 포트가 물려 있다 — OS 가 골라 주는 번호로 한 번 더 시도한다
                fellBack = true
                diagCatch('notify channel listen (고정 포트 실패, 임의 포트로 재시도)', e)
                server.listen(0, '127.0.0.1')
                return
            }
            // 여기까지 오면 훅의 TCP 경로는 죽었다. 상태가 안 바뀐다는 제보의 1순위 원인이라 반드시 남긴다
            diagCatch('notify channel listen 최종 실패', e)
            this.server = null
            // 지난 실행의 포트 번호를 남겨 두면 훅이 그 번호로 접속을 시도한다.
            // 그 사이 다른 프로그램이 같은 번호를 잡았다면 엉뚱한 곳으로 JSON 을 쏘게 되므로 지운다
            try {
                fs.unlinkSync(this.portFile)
            } catch {
                // 이미 없으면 그만이다
            }
        })
        server.on('listening', () => {
            this.server = server
            try {
                fs.mkdirSync(this.root, { recursive: true })
                fs.writeFileSync(this.portFile, String(this.debugPort), 'utf8')
                fs.mkdirSync(this.mailboxRoot, { recursive: true })
                fs.writeFileSync(path.join(this.mailboxRoot, 'port'), String(this.debugPort), 'utf8')
            } catch (e: any) {
                // 포트를 못 알리면 훅은 파일 경로로 떨어진다 (느려지지만 동작은 한다)
                diagCatch('notify port 파일 쓰기', e)
            }
        })
        server.listen(this.config.store.agentDeck.notifyPort || 0, '127.0.0.1')
    }

    /** TCP 로 들어온 JSON 한 줄 */
    private acceptMailbox (line: string, socket: net.Socket): boolean {
        let request: any
        try { request = JSON.parse(line) } catch { return false }
        if (request?.channel === 'agentdeck-navigation') {
            try {
                this.retireMissingMailboxPanes()
                this.navigationRefresh?.()
                socket.write(JSON.stringify({ result: { capturedAt: new Date().toISOString(), context: this.navigationContext } }) + '\n')
            } catch { socket.write(JSON.stringify({ error: 'Navigation snapshot unavailable' }) + '\n') }
            return true
        }
        if (request?.channel !== 'agentdeck-mailbox') { return false }
        try {
            this.retireMissingMailboxPanes()
            if (!this.mailbox) { throw new Error('No connected sessions') }
            const result = this.mailbox.call(request.sessionId, request.token, request.method, request.arguments)
            socket.write(JSON.stringify({ result }) + '\n')
        } catch (error) {
            socket.write(JSON.stringify({ error: String((error as Error).message) }) + '\n')
        }
        return true
    }

    private accept (line: string): void {
        // Hook reports are independent of authenticated mailbox commands.
        const text = line.trim()
        if (!text) {
            return
        }
        try {
            this.apply(JSON.parse(text))
        } catch (e: any) {
            // 깨진 줄은 버린다 — 다음 보고가 곧 온다.
            // 다만 훅 스크립트가 바뀌어 형식이 어긋난 경우도 여기로 오므로 사유는 남긴다
            diagCatch('notify 보고 파싱', e)
        }
    }

    private poll (): void {
        // tabId 표는 동기라 매번, 셸 PID 표는 pty 에 물어야 해서 2초마다 — 탭 안에서 셸을 다시 띄우거나 분할하면 바뀐다
        this.refreshTabIds()
        if (++this.pollCount % 5 === 0) {
            void this.refreshPids()
        }
        // 대화기록 증분 스캔은 2초에 한 번, pid 조회와 다른 tick 에 (상수 주석 참고)
        if (this.pollCount % SUBAGENT_SCAN_EVERY === SUBAGENT_SCAN_PHASE) {
            this.scanSubagents()
        }
        // 모델·계정·한도. 상태 폴더와 **같은 주기**로 읽는다 — 한도%는 턴이 끝나는 순간
        // 바뀌는 값이라, 상태 배지가 '완료' 로 바뀐 화면에 옛 한도가 남으면 어긋나 보인다
        this.pollMeta()
        // Codex 는 statusLine 이 없어 세션 기록에서 같은 값을 뽑는다. 파일을 여는 일이라 대화기록
        // 스캔과 같은 2초 주기에 태운다(`SUBAGENT_SCAN_EVERY`), 다만 그쪽 tick 과 어긋나게 둔다
        if (this.pollCount % SUBAGENT_SCAN_EVERY === CODEX_META_SCAN_PHASE) {
            this.scanCodexMeta()
        }
        let names: string[]
        try {
            names = fs.readdirSync(this.dir)
        } catch {
            return // 폴더 없음 = 훅이 아직 한 번도 안 돌았다
        }
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue
            }
            const full = path.join(this.dir, name)
            let data: NotifyFile
            try {
                data = JSON.parse(fs.readFileSync(full, 'utf8'))
            } catch {
                continue // 훅이 쓰는 중 — 다음 폴링에서 다시 읽는다
            }

            // 지난 Tabby 실행 때 남은 파일 — 이걸 읽으면 죽은 세션들이 전부 "지금 활성 탭" 에
            // 묶여 버려서(resolveTab 규칙) 실제 세션이 엉뚱한 탭에 붙는다. 실제로 완료된 세션의
            // done 이 작업 중인 탭에 찍히는 증상이 이것이었다 (2026-08-28 실측). 읽지 말고 지운다
            if (data.ts < this.startedAt && !this.sessionTab.has(data.sessionId)) {
                try {
                    fs.unlinkSync(full)
                } catch {
                    // 지우기 실패해도 아래 apply 를 타지 않으므로 해는 없다
                }
                continue
            }

            this.apply(data)
        }
    }

    /**
     * 보고 한 건을 반영한다. `status` / `label` 은 **각각 선택**이고, 빠진 쪽은 지금 값을 유지한다.
     *
     * 병합 규칙을 여기(플러그인)에 둔 이유 — 예전에는 훅 스크립트가 status 파일을 읽어
     * 직전 값과 합친 뒤 다시 쓰는 read-modify-write 를 했다. 그러면 진짜 상태가 파일과
     * 플러그인 메모리 두 곳에 살고 병합 규칙이 PowerShell 안에 숨는다. 라벨만 바꾸려 해도
     * 직전 status 를 채워 넣어야 했고(안 채우면 여기서 통째로 버려졌다), 파일이 밀리면
     * 표시가 어긋났다. 보내는 쪽은 "자기가 아는 것만" 보내고 합치는 건 상태를 실제로
     * 들고 있는 이쪽이 한다 — 그래야 어느 경로로 들어오든 결과가 같다.
     */
    private apply (data: NotifyFile): void {
        if (!data || !data.sessionId) {
            return
        }
        const hasStatus = !!data.status
        const hasLabel = typeof data.label === 'string' && !!data.label.trim()
        const hasFile = typeof data.file === 'string' && !!data.file.trim()
        const hasAgents = data.agents !== undefined && data.agents !== null
        if (!hasStatus && !hasLabel && !hasFile && !hasAgents) {
            return
        }
        if (this.applied.get(data.sessionId) === data.ts) {
            return
        }

        const tab = this.resolveTab(data.sessionId, data.tabId, data.pids)
        if (!tab) {
            // tabId 도 pids 도 없는 보고(옛 훅·수동 호출)는 다시 봐도 결과가 같다. 그런데 폴링이 400ms 마다
            // 되풀이하면 "활성 탭에 묶는다" 규칙이 다음에 열리는 빈 탭을 붙잡는다 — 끝난 세션의
            // done 이 새 탭에 박히고, 그 탭의 진짜 세션은 주인이 있다며 거절됐다 (2026-09-02 실측).
            // 적용한 것으로 쳐서 멈춘다. 다음 보고(새 ts)가 오면 그때 다시 시도한다.
            // tabId / pids 가 있는 보고는 표가 채워지면 맞을 수 있으니 다음 폴링에 다시 본다.
            if (!data.pids?.length && !data.tabId) {
                this.applied.set(data.sessionId, data.ts)
            }
            return
        }
        this.applied.set(data.sessionId, data.ts)
        this.registerMailbox(data.sessionId, tab, data.tabId)

        // 누가 보냈나 — 온 보고마다 갱신한다. 같은 탭에서 CLI 를 바꿔 띄우면 그쪽 첫 보고가 덮는다
        const agent = String(data.agent ?? '').trim().toLowerCase()
        if (agent === 'claude' || agent === 'codex' || agent === 'gemini') {
            this.hookAgent.set(tab, agent)
            this.rejectedMetaSession.delete(tab)
        }

        // 작업 폴더는 상태·라벨과 독립이다 — 온 보고마다 최신 값으로 갈아 둔다.
        // (에이전트가 세션 도중 폴더를 옮기면 다음 보고가 그 값을 들고 온다)
        const cwd = typeof data.cwd === 'string' ? data.cwd.trim() : ''
        if (cwd) {
            this.hookCwd.set(tab, cwd)
        }
        // 만진 파일도 마찬가지다 — 같은 파일을 또 고치면 맨 앞으로 올린다(최근 순).
        // 목록 자체를 `변경` 탭이 읽으므로 순서가 곧 화면 순서는 아니지만(그건 git 이 정한다),
        // 상한을 넘길 때 **오래된 것부터** 버리려면 순서가 있어야 한다
        // 서브에이전트 목록 — **덧붙이지 않고 통째로 갈아 끼운다**(스냅샷, NotifyFile.agents 주석).
        // 빈 목록도 뜻이 있다: "마지막 하나가 끝났다". 그래서 `hasAgents` 는 길이가 아니라
        // 키의 유무로 판정한다
        if (hasAgents) {
            const raw = Array.isArray(data.agents) ? data.agents : [data.agents!]
            const live = new Map<string, LiveAgent>()
            for (const a of raw) {
                const id = String(a?.id ?? '').trim()
                if (!id) {
                    continue
                }
                const at = Number(a?.at)
                live.set(id, {
                    id,
                    type: String(a?.type ?? '').trim(),
                    // 시작 시각이 없거나 깨졌으면 **지금**으로 둔다 — 툴팁의 "가장 오래된 것"
                    // 계산이 NaN 으로 새지 않게. 값을 지어내는 셈이지만 그 줄은 참고용이고,
                    // 0 으로 두면 1970년부터 돌고 있다고 말하게 된다
                    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
                })
            }
            const before = this.liveAgents.get(tab)?.size ?? 0
            this.liveAgents.set(tab, live)
            this.agentHookSeen.add(tab)
            if (before !== live.size) {
                this.diag(`agents sid=${data.sessionId.slice(0, 8)} ${before} -> ${live.size}`
                    + ` [${[...live.values()].map(a => a.type || '?').join(',')}]`)
            }
        }

        if (hasFile) {
            const file = data.file!.trim()
            const list = this.touched.get(tab) ?? []
            const next = [file, ...list.filter(p => p !== file)]
            this.touched.set(tab, next.length > TOUCHED_MAX ? next.slice(0, TOUCHED_MAX) : next)
        }

        const label = (data.label || '').trim()
        if (hasStatus) {
            // 라벨이 안 왔으면 undefined 를 넘겨 기존 라벨을 지키게 한다 (setManual 규약)
            // 이유는 waiting 에서만 의미가 있고 setManual 이 다른 상태에서는 비운다
            const reason = shortenReason(typeof data.reason === 'string' ? data.reason : '')
            this.status.setManual(tab, data.status!, hasLabel ? label : undefined, reason)
        } else {
            // 라벨만 온 보고 — 상태도 고정 여부도 건드리지 않는다
            this.status.setLabel(tab, label)
        }

        // 탭 제목(customTitle)은 건드리지 않는다.
        // 제목을 라벨 원천으로 쓸 수 있는지 보려고 한동안 비워 뒀고, 판정은 났다 —
        // Claude Code 는 세션 첫 작업을 요약해 제목에 한 번 박고 그 뒤로 갱신하지 않는다.
        // 그래서 라벨은 Enter 시점 입력창에서 직접 읽고(claimEnterLabel), 사이드바는
        // 제목과 그 라벨을 각자 줄에 나눠 그린다(renderTab). 여기서 제목을 덮어쓸 이유가 없다.
    }

    /**
     * 세션에 묶인 탭을 찾는다.
     *
     * 1순위는 **셸에 심어 둔 `AGENTDECK_TAB`**(tabId, tabenv.ts) — 플러그인이 탭을 열 때 심은 값을 훅이 그대로
     * 돌려보낸 것이라 표에 있으면 곧 그 탭이다. 2순위는 **프로세스 계보**(pids) — 훅이 보낸 조상 PID(claude.exe →
     * 탭 셸 → Tabby) 에 어떤 탭의 셸 PID 가 들어 있으면 그 탭이다(bind.ts). 이 버전 이전에 열린 탭·복원된 탭이
     * 여기로 온다. 둘 다 이미 다른 세션이 그 탭을 갖고 있어도 넘겨받는다: 같은 탭에서 claude 를 다시 띄우면
     * 세션 id 가 바뀌는 게 정상이고, 이전 주인은 이미 죽은 세션이다. 알던 탭과 다른 탭이 맞으면 옮긴다
     * (`claude --resume` 을 다른 탭에서 띄운 경우).
     *
     * tabId 나 pids 가 왔는데 맞는 탭이 없으면 **추측하지 않고** null 이다 — 표가 아직 안 채워진 것일 수
     * 있고(복원 탭의 자식은 늦게 생긴다), 그 경우 다음 폴링(400ms)에 다시 온다. 활성 탭으로 떨어지던 예전 규칙이
     * 낸 사고가 "끝난 세션의 done 이 새 탭에 박힘" 이었다 (2026-09-02 실측).
     *
     * 둘 다 없는 보고(옛 훅·셸에서 사람이 부른 것)만 예전 규칙을 탄다 — 처음 보는 세션이면 지금 활성 탭.
     * 단 그 탭을 이미 다른 세션이 점유했으면 묶지 않는다 (여러 세션이 한 탭에 겹쳐 붙어 서로의
     * 상태를 덮어쓰던 2026-08-28 사고의 방지책).
     */
    private resolveTab (sessionId: string, tabId: string | undefined, pids?: number[]): BaseTabComponent | null {
        const known = this.sessionTab.get(sessionId)
        const alive = known && this.app.tabs.includes(known) ? known : null

        const byId = pickTabByTabId(tabId, this.tabIds)
        if (byId) {
            if (byId !== alive) {
                this.bind(sessionId, byId, alive ? 'tabid-move' : 'tabid')
            }
            return byId
        }
        const pick = pickTabByPids(pids, this.tabPids)
        if (pick.mode === 'pid' && pick.tab) {
            if (pick.tab !== alive) {
                this.bind(sessionId, pick.tab, alive ? 'pid-move' : 'pid')
            }
            return pick.tab
        }
        if (alive) {
            return alive
        }
        if (tabId) {
            // 훅은 tabId 가 있으면 pids 를 보내지 않으므로 여기서 멈춘다 — 계보처럼 추측 없이 다음 폴링을 기다린다
            const table = [...this.tabIds.entries()]
                .map(([tab, list]) => `${this.tabName(tab)}:[${list.join(',')}]`)
                .join(' ')
            this.bindLog(sessionId, `unbound (tabid-miss) tabId=${tabId} tabs=${table}`)
            return null
        }
        if (pick.mode === 'pid-miss') {
            const table = [...this.tabPids.entries()]
                .map(([tab, list]) => `${this.tabName(tab)}:[${list.join(',')}]`)
                .join(' ')
            this.bindLog(sessionId, `unbound (pid-miss) pids=[${(pids ?? []).join(',')}] tabs=${table}`)
            return null
        }

        const active = this.app.activeTab
        if (!active) {
            return null
        }
        const owner = this.tabSession.get(active)
        if (owner && owner !== sessionId) {
            this.bindLog(sessionId, `unbound (legacy: active tab owned by ${owner.slice(0, 8)})`)
            return null
        }
        this.bind(sessionId, active, 'legacy')
        return active
    }

    /** 세션 <-> 탭 을 묶고, 그 탭의 이전 주인과 이 세션의 이전 탭은 풀어 준다 */
    private bind (sessionId: string, tab: BaseTabComponent, how: string): void {
        const prevOwner = this.tabSession.get(tab)
        if (prevOwner && prevOwner !== sessionId) {
            this.sessionTab.delete(prevOwner)
            this.hookAgent.delete(tab)
            // 이 탭에서 다른 세션이 시작됐다 — 만진 파일 목록은 **앞 세션 것**이라 버린다.
            // 안 버리면 `변경` 탭의 '세션' 목록에 지난 세션이 고친 파일이 섞여 남는다
            this.touched.delete(tab)
            // 도는 중이던 서브에이전트도 앞 세션 것이다. 그 세션의 `SubagentStop` 은 이제 이
            // 탭으로 오지 않으므로(세션이 바뀌었다) 남겨 두면 영원히 안 지워지는 유령이 된다
            this.liveAgents.delete(tab)
        }
        const prevTab = this.sessionTab.get(sessionId)
        if (prevTab && prevTab !== tab && this.tabSession.get(prevTab) === sessionId) {
            this.tabSession.delete(prevTab)
            this.hookAgent.delete(prevTab)
        }
        this.sessionTab.set(sessionId, tab)
        this.tabSession.set(tab, sessionId)
        this.lastBindLog.delete(sessionId)
        this.diag(`bind sid=${sessionId.slice(0, 8)} via=${how} tab=${this.tabName(tab)}`
            + (prevOwner && prevOwner !== sessionId ? ` (took over from ${prevOwner.slice(0, 8)})` : ''))
    }

    /** 매칭 실패는 폴링마다 반복되므로 같은 내용은 한 번만 남긴다 */
    private bindLog (sessionId: string, msg: string): void {
        if (this.lastBindLog.get(sessionId) === msg) {
            return
        }
        this.lastBindLog.set(sessionId, msg)
        this.diag(`bind sid=${sessionId.slice(0, 8)} ${msg}`)
    }

    // ---------- 서브에이전트 개수 (대화기록 증분 스캔) ----------

    /** 서브에이전트 개수를 세고 보일지 (`agentDeck.subagentCount`) */
    private get subagentEnabled (): boolean {
        return this.config.store.agentDeck.subagentCount !== false
    }

    /**
     * 이 탭에서 도는 에이전트가 알려 준 작업 폴더. 훅이 붙지 않은 탭(Codex·Gemini·맨 셸)은 null.
     *
     * 부르는 쪽(deck.service)은 이 값이 있으면 Tabby 의 추정을 쓰지 않는다 — 추정이 파일 경로를
     * 집어 오는 실사고가 있었다(NotifyFile.cwd 주석).
     */
    cwdOf (tab: BaseTabComponent | null | undefined): string | null {
        return (tab && this.hookCwd.get(tab)) || null
    }

    /**
     * 이 탭에서 도는 CLI — **훅이 직접 말한 것**. 훅이 없는 탭(gemini·맨 셸)은 null.
     *
     * null 은 "에이전트가 없다" 가 아니라 **"훅이 없어서 모른다"** 다. 그때만 추측 경로
     * (프로세스·명령줄·제목·화면)가 돈다 — 이 값이 있으면 그쪽은 아예 부르지 않는다.
     */
    agentOf (tab: BaseTabComponent | null | undefined): AgentId | null {
        if (!tab) { return null }
        const hooked = this.hookAgent.get(tab)
        if (hooked && hooked !== 'unknown') { return hooked }
        const sid = this.tabSession.get(tab)
        if (!sid || this.rejectedMetaSession.get(tab) === sid) { return null }
        // Model metadata identifies its reporting CLI explicitly. Model names alone
        // do not identify a terminal application (custom providers can share them).
        const agent = this.metaOf(tab)?.agent?.trim().toLowerCase()
        return agent === 'codex' || agent === 'claude' || agent === 'gemini' ? agent : null
    }

    /**
     * 훅이 말한 정체를 버린다 — 그 에이전트가 끝났다는 증거를 deck.service 가 찾았을 때
     * (프로세스 트리에 **다른 에이전트가 확실히** 떴다, `detectAgentApp`).
     *
     * 훅에는 "세션이 끝났다" 가 없어서 이 값은 스스로 낡는다. 다음 훅 보고가 오면 다시 채워진다.
     */
    forgetAgent (tab: BaseTabComponent | null | undefined): void {
        if (tab) {
            this.hookAgent.delete(tab)
            const sid = this.tabSession.get(tab)
            if (sid) { this.rejectedMetaSession.set(tab, sid) }
        }
    }

    /**
     * 이번 세션에서 에이전트가 고친 파일들 (절대경로, 최신 순). 훅이 없는 탭은 빈 배열.
     *
     * **빈 배열은 "아무것도 안 고쳤다" 가 아니라 "모른다" 로 읽어야 한다** — 훅이 없는
     * 에이전트(Codex·Gemini)와 아직 안 고친 세션이 같은 값이다. 그래서 `변경` 탭은 이게 비면
     * 목록을 좁히지 않고 저장소 전체를 그린다(빈 화면은 거짓말이 된다).
     */
    touchedOf (tab: BaseTabComponent | null | undefined): string[] {
        return (tab && this.touched.get(tab)) || []
    }

    /**
     * 이 탭에서 도는 에이전트의 **지금 모델·계정·한도**. statusLine 래퍼가 보고한 것 그대로.
     * 래퍼가 안 걸렸거나 세션이 탭에 안 묶였으면 null (사이드바는 그 줄을 아예 안 그린다).
     *
     * 여기서 값을 꾸미지 않는다 — 화면 문구는 부르는 쪽(deck.service)이 만든다.
     * 이 서비스는 "누가 무엇을 보고했나" 만 들고 있는다.
     */
    private accountHomes = new WeakMap<BaseTabComponent, { provider: string, home: string, email: string }>()

    setAccountHome (tab: BaseTabComponent, provider: string, home: string, email: string): void {
        this.accountHomes.set(tab, { provider, home, email })
    }

    metaOf (tab: BaseTabComponent | null | undefined): AgentMeta | null {
        const sid = tab ? this.tabSession.get(tab) : null
        const meta = (sid && this.metaBySession.get(sid)) || null
        if (!meta || !tab) { return meta }
        const selected = this.accountHomes?.get(tab)
        const env = (tab as any).profile?.options?.env
        const home = selected?.home || (meta.agent === 'codex' ? env?.CODEX_HOME : env?.CLAUDE_CONFIG_DIR)
        if (home && (meta.agent === 'codex' || meta.agent === 'claude')) {
            return { ...meta, configDir: home, account: accountEmail(meta.agent, home) || selected?.email || '' }
        }
        return meta
    }

    /**
     * statusLine 래퍼가 남긴 스냅샷을 읽는다 (`%LOCALAPPDATA%\tabby-agentdeck\meta`).
     *
     * 상태 보고(`status/`)와 폴더를 나눈 이유 — 그쪽 폴링은 `apply()` 의 병합·매칭 규칙을
     * 타는데, 이건 상태를 바꾸지 않는 **부가 정보**라 같은 통로에 태우면 그 규칙(중복 ts 래치,
     * 미매칭 보고 처리)을 둘 다 헝클어뜨린다.
     *
     * 탭에 안 묶인 세션의 보고도 **버리지 않고 들고 있는다** — statusLine 은 훅보다 먼저 돌 수
     * 있어서(첫 렌더가 첫 프롬프트보다 이르다), 그때 버리면 세션이 묶인 뒤 첫 갱신까지
     * 줄이 비어 보인다.
     */
    private pollMeta (): void {
        let names: string[]
        try {
            names = fs.readdirSync(this.metaDir)
        } catch {
            return // 폴더 없음 = statusLine 래퍼가 아직 한 번도 안 돌았다
        }
        let changed = false
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue // 래퍼가 쓰는 중인 `.tmp` — 다음 폴링에서 온전한 파일을 읽는다
            }
            const full = path.join(this.metaDir, name)
            let data: AgentMeta
            try {
                data = JSON.parse(fs.readFileSync(full, 'utf8'))
            } catch {
                continue
            }
            if (!data?.sessionId) {
                continue
            }
            // 지난 Tabby 실행 때 남은 파일. 상태 쪽과 같은 규칙이다 — 죽은 세션의 값을 들고
            // 있으면 그 세션 id 가 다시 묶일 때 옛 모델·한도가 잠깐 뜬다
            if (data.ts < this.startedAt && !this.sessionTab.has(data.sessionId)) {
                try {
                    fs.unlinkSync(full)
                } catch {
                    // 지우기 실패해도 아래 ts 비교에서 걸러진다
                }
                continue
            }
            if (this.metaBySession.get(data.sessionId)?.ts === data.ts) {
                continue
            }
            this.metaBySession.set(data.sessionId, data)
            changed = true
        }
        this.pruneMeta()
        if (changed) {
            this.onMetaChange?.()
        }
    }

    /**
     * Codex 탭의 모델·effort·컨텍스트%·한도 — **세션 기록(rollout jsonl)에서 직접 뽑는다.**
     *
     * Claude 쪽(`pollMeta`)과 원천이 다른 이유는 `codexMeta.ts` 머리주석에 있다: Codex 에는
     * statusLine 이 없고 대신 같은 값을 자기 기록에 남긴다.
     *
     * **훅이 묶어 준 세션만 본다.** 탭↔세션을 화면·폴더로 추측하지 않는다 — 이 저장소는 그 추측으로
     * 남의 탭에 남의 상태를 박은 사고를 이미 겪었다(`resolveTab` 주석). 그래서 Codex 훅을 설치하지
     * 않으면 이 줄도 안 나온다(서브에이전트 개수와 같은 조건).
     *
     * 읽기는 대화기록 스캔과 같은 방식 — `stat` 으로 자란 만큼만, `StringDecoder` 로 UTF-8 경계를 잇는다.
     */
    private scanCodexMeta (): void {
        for (const [sid, tab] of this.sessionTab) {
            if (!this.app.tabs.includes(tab) || this.hookAgent.get(tab) !== 'codex') {
                continue
            }
            let scan = this.codexScans.get(sid)
            if (!scan) {
                scan = { sessionId: sid, state: createCodexState(), decoder: new StringDecoder('utf8'),
                    path: null, lastSize: 0, busy: false, lookupAt: 0 }
                this.codexScans.set(sid, scan)
            }
            if (scan.busy) {
                continue
            }
            if (!scan.path) {
                void this.findCodexRollout(scan)
                continue
            }
            let size: number
            try {
                size = fs.statSync(scan.path).size
            } catch {
                // 파일이 사라졌다 — 경로부터 다시 찾고, 그동안 값은 그대로 둔다(마지막으로 본 사실이다)
                scan.path = null
                scan.lookupAt = 0
                continue
            }
            if (size < scan.lastSize) {
                // 줄었다 = 다른 파일이 같은 이름으로 앉았다. 상태를 새로 시작한다
                scan.state = createCodexState()
                scan.decoder = new StringDecoder('utf8')
                scan.lastSize = 0
            }
            if (size > scan.lastSize) {
                try {
                    const fd = fs.openSync(scan.path, 'r')
                    try {
                        const len = size - scan.lastSize
                        const buf = Buffer.allocUnsafe(len)
                        const read = fs.readSync(fd, buf, 0, len, scan.lastSize)
                        feedCodexChunk(scan.state, scan.decoder.write(buf.subarray(0, read)))
                        scan.lastSize += read
                    } finally {
                        fs.closeSync(fd)
                    }
                } catch (e: any) {
                    // 읽다 실패하면 `lastSize` 를 올리지 않는다 — 다음 주기에 같은 구간을 다시 읽는다
                    diagCatch('codex 기록 읽기', e)
                    continue
                }
            }
            const next = this.codexMetaOf(sid, scan.state)
            const prev = this.metaBySession.get(sid)
            // 값이 그대로면 렌더를 부르지 않는다 (2초마다 사이드바를 다시 그릴 이유가 없다)
            if (prev && prev.model === next.model && prev.effort === next.effort
                && prev.account === next.account && prev.contextPct === next.contextPct
                && prev.limits.fiveHourPct === next.limits.fiveHourPct
                && prev.limits.sevenDayPct === next.limits.sevenDayPct) {
                continue
            }
            this.metaBySession.set(sid, next)
            this.onMetaChange?.()
        }
    }

    /** 스캔 상태를 사이드바가 쓰는 모양으로 (`AgentMeta`) */
    private codexMetaOf (sid: string, state: CodexState): AgentMeta {
        return {
            sessionId: sid,
            ts: Date.now(),
            agent: 'codex',
            model: state.model,
            modelId: state.model,
            effort: state.effort,
            version: state.cliVersion,
            fastMode: false,
            account: this.codexAccount(),
            org: '',
            configDir: this.codexHome,
            cwd: state.cwd,
            contextPct: codexContextPct(state),
            limits: codexLimits(state),
        }
    }

    /**
     * Codex 계정 메일. 파일이 바뀔 때만 다시 읽는다 — 2초마다 JWT 를 풀 이유가 없다.
     * 토큰 자체는 들고 있지 않는다(메일만 남긴다).
     */
    private codexAccount (): string {
        const file = path.join(this.codexHome, 'auth.json')
        let mtime = 0
        try {
            mtime = fs.statSync(file).mtimeMs
        } catch {
            return '' // 로그인 기록이 없다
        }
        if (this.codexAuth && this.codexAuth.mtime === mtime) {
            return this.codexAuth.email
        }
        let email = ''
        try {
            email = emailFromIdToken(JSON.parse(fs.readFileSync(file, 'utf8'))?.tokens?.id_token)
        } catch {
            email = ''
        }
        this.codexAuth = { mtime, email }
        return email
    }

    /**
     * `~/.codex/sessions/<년>/<월>/<일>/rollout-<시각>-<세션id>.jsonl` 을 찾는다.
     *
     * 대화기록 찾기(`findTranscript`)와 같은 규칙 — **경로 규칙을 흉내내지 않고** 훑어서 이름으로 맞춘다.
     * 날짜 폴더를 계산하면 시간대·자정 경계에서 어긋난다.
     */
    private async findCodexRollout (scan: CodexScan): Promise<void> {
        const now = Date.now()
        if (now - scan.lookupAt < TRANSCRIPT_LOOKUP_RETRY_MS) {
            return
        }
        scan.lookupAt = now
        scan.busy = true
        const want = scan.sessionId.toLowerCase()
        const walk = async (dir: string, depth: number): Promise<string | null> => {
            let entries: fs.Dirent[]
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true })
            } catch {
                return null
            }
            // 최신 날짜 폴더부터 본다 — 지금 도는 세션은 거의 항상 오늘 자리에 있다
            for (const entry of [...entries].reverse()) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory() && depth < 3) {
                    const hit = await walk(full, depth + 1)
                    if (hit) {
                        return hit
                    }
                    continue
                }
                if (entry.isFile() && entry.name.toLowerCase().endsWith(`-${want}.jsonl`)) {
                    return full
                }
            }
            return null
        }
        try {
            const hit = await walk(path.join(this.codexHome, 'sessions'), 0)
            if (hit) {
                scan.path = hit
                this.diag(`codex meta sid=${scan.sessionId.slice(0, 8)} file=${hit}`)
            }
        } finally {
            scan.busy = false
        }
    }

    /**
     * 기억에서 지울 것 — 닫힌 탭에 묶여 있던 세션과, 한 번도 묶이지 않은 채 오래된 보고.
     *
     * `pruneScans` 처럼 "묶이지 않았으면 버린다" 로 하지 않는다 — 그러면 statusLine 이 훅보다
     * 먼저 도는 정상 경우(첫 렌더 > 첫 프롬프트)에 첫 값이 매번 버려진다.
     */
    private pruneMeta (): void {
        const now = Date.now()
        // Codex 스캔은 **묶인 탭이 살아 있는 동안만** 든다 (파일 핸들이 아니라 오프셋뿐이지만
        // 죽은 세션의 상태를 들고 있을 이유가 없다). `pruneScans` 와 같은 규칙
        for (const sid of [...this.codexScans.keys()]) {
            const tab = this.sessionTab.get(sid)
            if (!tab || !this.app.tabs.includes(tab)) {
                this.codexScans.delete(sid)
            }
        }
        for (const [sid, meta] of [...this.metaBySession]) {
            const tab = this.sessionTab.get(sid)
            if (tab) {
                if (!this.app.tabs.includes(tab)) {
                    this.metaBySession.delete(sid)
                    this.dropMetaFile(sid)
                }
                continue
            }
            if (now - meta.ts > META_TTL_MS) {
                this.metaBySession.delete(sid)
                this.dropMetaFile(sid)
            }
        }
    }

    /**
     * 메모리에서 버린 보고를 **디스크에서도 지운다.**
     *
     * 안 지우면 다음 폴링이 같은 파일을 다시 읽어 `metaBySession` 에 넣고(`ts` 비교에 안 걸린다)
     * `onMetaChange` → 사이드바 전체 리렌더, 그리고 그 호출 끝의 `pruneMeta` 가 또 지운다 —
     * **닫은 탭 하나마다 400ms 리렌더 루프가 하나씩 영구히 는다** (2026-09-15 코드리뷰 지적).
     * `pollMeta` 의 unlink 는 **지난 실행이 남긴 파일**(`ts < startedAt`)만 치우므로
     * 이번 실행 중에 생긴 것은 여기서 치워야 한다.
     */
    private dropMetaFile (sessionId: string): void {
        try {
            fs.unlinkSync(path.join(this.metaDir, sessionId + '.json'))
        } catch {
            // 이미 없거나 못 지운다 — 다음 판에서 다시 만난다
        }
    }

    /**
     * 이 탭에서 도는 서브에이전트 — **사이드바가 쓰는 유일한 창구**. 없으면 null.
     *
     * 개수를 여기서 다시 세지 않는다(`subagents.ts` 가 센 것을 되읽는다). 툴팁만 부를 때마다
     * 만드는데, 거기에 **경과 시간**이 들어가기 때문이다 — 캐시하면 시계가 멈춘다.
     * 세션이 안 묶인 탭·꺼진 상태·0 개는 전부 null 로 떨어져 호출부가 조건을 따로 적을 일이 없다.
     */
    subagentsOf (tab: BaseTabComponent | null | undefined): SubagentView | null {
        if (!tab || !this.subagentEnabled) {
            return null
        }
        const sid = this.tabSession.get(tab)
        // **훅을 받는 탭은 훅만 본다** (`agentHookSeen`). 대화기록 훑기는 그 세션의 옛 호출까지
        // 다시 세는 폴백이라, 훅이 "지금 0개" 라고 말한 뒤에 그것이 끼어들면 유령 숫자가 뜬다
        if (this.agentHookSeen.has(tab)) {
            const live = summarizeLiveAgents(this.liveAgents.get(tab)?.values())
            if (live.running <= 0) {
                return null
            }
            const head = formatLiveAgentTooltip(live)
            return {
                sessionId: sid ?? '',
                running: live.running,
                // 목록(`items`)은 대화기록 쪽 구조라 여기서는 비운다 — 숫자와 다른 원천의 목록을
                // 섞으면 "4개라면서 5줄" 이 된다. 툴팁은 같은 원천(훅)으로만 만든다
                items: [],
                tooltip: live.oldestAt
                    ? `${head}\n가장 오래된 것: ${formatAge(Date.now() - live.oldestAt)} 전 시작`
                    : head,
            }
        }
        const scan = sid ? this.scans.get(sid) : null
        if (!scan || scan.summary.running <= 0) {
            return null
        }
        return {
            sessionId: scan.sessionId,
            running: scan.summary.running,
            items: scan.summary.items,
            tooltip: this.subagentTooltip(scan.summary),
        }
    }

    /**
     * 툴팁 문장 = `formatSubagentTooltip()`(목록) + **가장 오래된 것의 경과 시간** 한 줄.
     *
     * **유령 카운트를 감추지 않는다** (2026-09-09 판단 확정). 사용자가 Esc 로 취소하거나 CLI 가
     * 죽으면 종료 알림이 안 남아 "영구 1개" 가 될 수 있는데, 임의 임계(예: 2시간 넘으면 제외)나
     * 세션 상태로 숨기는 처리를 넣지 않는다 —
     *  ⓐ 백그라운드 에이전트가 도는 동안 **메인 세션 상태가 `대기` 인 것은 정상**이다. 그걸로
     *    숨기면 진짜로 도는 것을 지운다.
     *  ⓑ 이 저장소의 원칙은 잘못된 상태를 조용한 폴백으로 덮지 않는 것이다. 숨겨 버리면 개수가
     *    맞는지 아무도 알 수 없고, 정작 사용자가 "왜 안 보이나" 를 물을 때 근거가 없다.
     * 대신 **경과 시간을 보여** 사람이 스스로 유령을 알아보게 한다 — 5분 된 3개와 이틀 된 1개는
     * 눈으로 갈린다. 시각의 원천은 호출 줄의 `timestamp`(`SubagentCall.startedAt`)다.
     */
    private subagentTooltip (summary: SubagentSummary): string {
        const head = formatSubagentTooltip(summary)
        if (!head) {
            return ''
        }
        let oldest = 0
        for (const item of summary.items) {
            const at = item.startedAt ? Date.parse(item.startedAt) : NaN
            if (Number.isFinite(at) && (!oldest || at < oldest)) {
                oldest = at
            }
        }
        if (!oldest) {
            // 호출 줄에 timestamp 가 없었다 — 목록만 보여 준다 (없는 값을 만들어 내지 않는다)
            return head
        }
        return `${head}\n가장 오래된 것: ${formatAge(Date.now() - oldest)} 전 시작`
            + ' (종료 알림을 못 받은 것이면 이 값만 계속 늘어난다)'
    }

    /**
     * 지금 탭이 들고 있는 세션들 — `세션id -> 탭`.
     *
     * 사이드바의 "지난 세션" 목록이 이걸 본다. 살아 있는 세션은 이어받는 대신 그 탭으로 보내야
     * 하기 때문이다: 같은 세션을 두 탭에서 `--resume` 하면 두 프로세스가 같은 기록 파일에
     * 덧쓴다. 매핑은 이 서비스가 훅 보고로 이미 만들어 두었으니 판정에 드는 비용이 없다.
     *
     * 사본을 돌려준다 — 호출부가 들고 있는 동안 이쪽에서 지워도(`sessionTab.delete`) 순회가 깨지지 않게.
     */
    liveSessions (): Map<string, BaseTabComponent> {
        return new Map(this.sessionTab)
    }

    /**
     * 탭에 묶인 세션들의 대화기록을 **자란 만큼만** 읽어 개수를 갱신한다 (2초마다).
     *
     * 매 주기에 하는 일은 `statSync().size` 비교뿐이다 — 안 자랐으면 파일을 아예 열지 않는다.
     * 자란 경우에만 그 구간을 스트림으로 읽고, 그 읽기는 **비동기**다: 실측 대화기록이
     * 13MB / 6,570줄이라 첫 스캔을 동기로 하면 그동안 Tabby UI 가 통째로 멈춘다.
     *
     * 상태 파일을 다시 읽지 않는다 — 세션 ↔ 탭 은 이 서비스가 이미 들고 있는 `sessionTab` 이
     * 정본이고(훅 보고로 채워진다), 같은 것을 두 곳에서 만들면 어긋난다.
     */
    private scanSubagents (): void {
        if (!this.subagentEnabled) {
            // 끈 기능이 파일을 계속 읽고 있으면 안 된다. 들고 있던 상태도 버린다 — 꺼 둔 사이의
            // 호출·종료를 못 봤으므로 남겨 두면 종료 알림을 놓친 유령만 남는다. 다시 켜면 그때
            // 처음부터(파일 앞부터) 다시 센다
            if (this.scans.size) {
                this.scans.clear()
            }
            return
        }
        this.pruneScans()
        for (const [sid, tab] of this.sessionTab) {
            if (!this.app.tabs.includes(tab)) {
                continue
            }
            let scan = this.scans.get(sid)
            if (!scan) {
                scan = { sessionId: sid, state: createSubagentState(), decoder: new StringDecoder('utf8'),
                    path: null, lastSize: 0, busy: false, lookupAt: 0, summary: summarizeSubagents(null) }
                this.scans.set(sid, scan)
            }
            if (scan.busy) {
                // 첫 스캔(13MB)이 아직 도는 중이다 — 겹쳐 읽으면 같은 구간을 두 번 먹인다
                continue
            }
            if (!scan.path) {
                void this.findTranscript(scan)
                continue
            }
            let size: number
            try {
                size = fs.statSync(scan.path).size
            } catch {
                // 파일이 사라졌다(세션 삭제·프로젝트 폴더 이동) — 경로부터 다시 찾는다.
                //
                // **집계도 같이 버린다.** 예전에는 경로만 비워서, 근거 파일이 없어진 뒤에도
                // 마지막 개수가 그대로 남아 `❖N` 칩이 영구히 붙어 있었다(파일이 다시 안 생기면
                // Tabby 재시작까지). 크기가 줄어드는 경로에만 리셋이 있어서 **삭제·이동은 리셋을
                // 못 탔다.** 근거를 잃었으면 숫자를 말하지 않는 것이 맞다 — 파일이 잠깐 안 보인
                // 것이었으면 다음 탐색에서 다시 찾아 처음부터 세면 되고, 그쪽이 틀린 수를
                // 계속 보여 주는 것보다 낫다.
                if (scan.lastSize > 0 || scan.summary.running > 0) {
                    this.diag(`subagent gone sid=${sid.slice(0, 8)} running=${scan.summary.running} -> 0`)
                }
                this.resetScan(scan)
                scan.path = null
                scan.lookupAt = 0
                continue
            }
            if (size < scan.lastSize) {
                // 잘렸거나 같은 이름으로 다른 파일이 왔다. 오프셋을 그대로 쓰면 파일 중간부터
                // 읽어 줄 경계가 어긋나고 decoder 도 엉뚱한 바이트를 이어 붙인다 — 처음부터 다시
                this.diag(`subagent reset sid=${sid.slice(0, 8)} size=${size} < last=${scan.lastSize}`)
                this.resetScan(scan)
            }
            if (size === scan.lastSize) {
                continue
            }
            this.readGrowth(scan, size)
        }
    }

    /**
     * 탭이 닫히거나 세션이 다른 탭으로 넘어가면 그 스캔 상태를 버린다.
     *
     * `tabClosed$` 만 믿지 않고 매 주기에 표를 대조하는 이유 — 세션이 다른 탭에서 되살아나면
     * (`claude --resume`) 닫힘 이벤트 없이 `bind()` 가 이전 주인을 조용히 풀고, 그러면
     * `sessionTab` 에서 빠진 세션의 스캔만 남는다.
     */
    private pruneScans (): void {
        for (const sid of [...this.scans.keys()]) {
            const tab = this.sessionTab.get(sid)
            if (!tab || !this.app.tabs.includes(tab)) {
                this.scans.delete(sid)
            }
        }
    }

    /** 상태·decoder·오프셋을 한 세트로 새로 만든다 (셋이 따로 놀면 글자가 깨지거나 개수가 틀어진다) */
    private resetScan (scan: SubagentScan): void {
        scan.state = createSubagentState()
        scan.decoder = new StringDecoder('utf8')
        scan.lastSize = 0
        scan.summary = summarizeSubagents(null)
    }

    /**
     * `~/.claude/projects/<프로젝트폴더>/<세션id>.jsonl` 을 찾는다.
     *
     * **폴더 이름 규칙을 흉내내지 않는다.** 그 이름은 작업 경로를 `-` 로 뭉갠 것인데 드라이브
     * 문자·대소문자·특수문자에서 어긋난다. 하위 폴더를 훑어 파일명을 세션 id 로 맞추면 폴더를
     * 몰라도 정확히 하나가 잡힌다 — 판정은 `subagents.ts` 의 `matchesSessionTranscript` 하나뿐이고
     * 여기에 사본을 두지 않는다.
     *
     * 비동기인 이유는 읽기와 같다(프로젝트가 수십 개면 readdir 도 공짜가 아니다). 못 찾으면
     * `TRANSCRIPT_LOOKUP_RETRY_MS` 뒤에 다시 본다 — 파일이 아직 안 생겼을 수 있다.
     */
    private async findTranscript (scan: SubagentScan): Promise<void> {
        const now = Date.now()
        if (now - scan.lookupAt < TRANSCRIPT_LOOKUP_RETRY_MS) {
            return
        }
        scan.lookupAt = now
        scan.busy = true
        try {
            const dirs = await fs.promises.readdir(this.projectsDir, { withFileTypes: true })
            for (const entry of dirs) {
                if (!entry.isDirectory()) {
                    continue
                }
                const dir = path.join(this.projectsDir, entry.name)
                let names: string[]
                try {
                    names = await fs.promises.readdir(dir)
                } catch {
                    // 권한·경합으로 못 읽는 폴더 하나 때문에 나머지를 포기하지 않는다
                    continue
                }
                const hit = names.find(name => matchesSessionTranscript(name, scan.sessionId))
                if (hit) {
                    scan.path = path.join(dir, hit)
                    this.diag(`subagent transcript sid=${scan.sessionId.slice(0, 8)} file=${scan.path}`)
                    return
                }
            }
        } catch {
            // `~/.claude/projects` 자체가 없다 — Claude Code 가 아닌 CLI 이거나 아직 한 번도 안 돌았다.
            // 개수는 0 으로 남고 사이드바에는 아무것도 안 그려진다(그게 맞는 표시다)
        } finally {
            scan.busy = false
        }
    }

    /**
     * `lastSize` 부터 `size` 까지만 읽어 먹인다.
     *
     * 실패하면 `lastSize` 를 **올리지 않는다** — 다음 주기에 같은 구간을 다시 읽게 되는데, 같은
     * 줄을 두 번 먹여도 결과는 같다(`subagents.ts`: 호출은 이미 본 id 를 무시하고 종료는 Set).
     * 중간에 끊긴 조각이 앞에 붙어 생기는 깨진 줄은 그쪽에서 `skipped` 로 버린다.
     */
    private readGrowth (scan: SubagentScan, size: number): void {
        const file = scan.path
        if (!file) {
            return
        }
        const from = scan.lastSize
        const sid8 = scan.sessionId.slice(0, 8)
        scan.busy = true
        let stream: fs.ReadStream
        try {
            stream = fs.createReadStream(file, { start: from, end: size - 1 })
        } catch (e: any) {
            // 스트림을 못 만들었다. **`busy` 를 반드시 되돌린다** — 여기서 true 로 남으면 그
            // 세션은 다시는 스캔되지 않고 개수가 조용히 멈춘 채로 굳는다(잘못된 상태를 조용히
            // 덮는 것이 이 저장소에서 가장 경계하는 실패 모양이다)
            scan.busy = false
            diagCatch(`subagent 스트림 생성 sid=${sid8}`, e)
            return
        }
        let settled = false
        const finish = (e?: any): void => {
            if (settled) {
                return
            }
            settled = true
            scan.busy = false
            if (e) {
                diagCatch(`subagent 대화기록 읽기 sid=${sid8}`, e)
                return
            }
            scan.lastSize = size
            const prev = scan.summary.running
            scan.summary = summarizeSubagents(scan.state)
            if (from === 0) {
                // 첫 스캔은 늘 남긴다 — "개수가 0" 의 원인이 파일을 못 읽은 것인지 정말 없는
                // 것인지를 나중에 이 한 줄로 가른다
                this.diag(`subagent first-scan sid=${sid8} bytes=${size} lines=${scan.state.lines}`
                    + ` calls=${scan.summary.calls} done=${scan.summary.done} running=${scan.summary.running}`)
            } else if (scan.summary.running !== prev) {
                this.diag(`subagent sid=${sid8} running=${prev} -> ${scan.summary.running} (+${size - from}B)`)
            }
        }
        // Buffer -> 문자열 변환은 decoder 에게 맡긴다 (멀티바이트 경계, `SubagentScan` 주석)
        stream.on('data', (chunk: any) => feedChunk(scan.state, scan.decoder.write(chunk as Buffer)))
        stream.on('end', () => finish())
        stream.on('error', (e: any) => finish(e))
    }
}
