/**
 * 세션이 지금 **서브에이전트를 몇 개 돌리고 있나** — Claude Code 대화기록(JSONL) 줄만 보고 세는 순수 로직.
 *
 * 왜 대화기록인가 — 훅(`hooks/agentdeck-notify.ps1`)이 알려 주는 것은 세션 하나의 상태
 * (`running`/`waiting`/…)뿐이다. 그 안에서 백그라운드 Agent 가 몇 개 도는지는 훅에 없고,
 * 대화기록에만 남는다. 그리고 탭 ↔ 세션 연결은 이미 `notify.service.ts` 가 갖고 있으므로
 * (status 파일의 `sessionId`·`tabId`) 세션 id 로 대화기록을 찾아 세면 사이드바에 붙일 수 있다.
 *
 * **개수는 id 대조로 나온다** (실측 2026-09-09, 6,395줄/13MB 세션에서 호출 28 · 도는 중 1 = 실제와 일치):
 *  - 호출 = `type:"assistant"` 줄의 `message.content[]` 안 `{type:"tool_use", name:"Agent", id:"toolu_…"}`
 *  - 종료 = 어딘가의 문자열에 실린 `<task-notification>` 블록의 `<tool-use-id>`
 *  - 도는 중 = 호출된 id 중 종료 알림에 안 나온 것
 *
 * **`tool_result` 를 종료로 보면 안 된다.** 백그라운드 Agent 의 `tool_result` 는 호출 **바로 다음 줄**에
 * `Async agent launched successfully.` 로 온다(실측: 28건 전부 호출줄 +1). 이걸 완료로 세면 항상 0개가 된다.
 *
 * **종료 알림은 JSON 모양이 한 가지가 아니다.** 같은 알림이 실측에서 세 모양으로 나왔다 —
 *  ① `type:"user"` 줄의 `message.content` (문자열 그대로)
 *  ② `type:"queue-operation"` 줄의 최상위 `content`
 *  ③ `type:"attachment"` 줄의 `attachment.prompt`
 * 그래서 알림은 **줄 원문에서 태그를 직접 긁는다.** JSON 모양을 따라가면 셋 중 하나만 잡게 되는데,
 * 처음에 ①만 봤을 때 28건 중 16건을 놓쳤다(도는 중 16 = 오답). 태그는 순수 ASCII 라 JSON 이스케이프가
 * 끼어도(`\n`) 그대로 읽힌다.
 *
 * 파일을 읽거나 경로를 뒤지지 않는다 — 줄(또는 청크)을 받아 상태를 갱신하는 것만 한다.
 * `group.ts`·`gitDiff.ts` 와 같은 이유다: fs·타이머가 들어오면 `npm test` 에서 돌릴 수 없고,
 * 폴링 주기·증분 오프셋 관리는 호출부(서비스)의 일이다.
 */

/**
 * 서브에이전트를 띄우는 도구 이름. `Task` 는 옛 이름(구버전 CLI)이라 같이 받는다 —
 * 최근 기록에는 `Agent` 만 나오지만, 플러그인은 사용자가 깔아 둔 아무 버전과도 붙는다.
 */
export const AGENT_TOOL_NAMES: readonly string[] = ['Agent', 'Task']

const NOTIFY_OPEN = '<task-notification>'
const NOTIFY_CLOSE = '</task-notification>'
const TOOL_USE_ID_RE = /<tool-use-id>([^<]*)<\/tool-use-id>/
const STATUS_RE = /<status>([^<]*)<\/status>/

/**
 * 알림에 실려 오는 id 의 생김새. 이걸 통과하지 못하면 버린다.
 *
 * 왜 필요한가 — 대화기록에는 **알림 형식을 설명하는 산문**도 들어 있다(이 모듈의 작업 지시문이
 * 그랬다). 거기서 `<tool-use-id>` 를 긁으면 `0-9]+)` 같은 정규식 조각이 딸려 온다(실측).
 * 실제 호출 id 와 겹치지 않는 쓰레기라 개수를 틀리게 만들지는 않지만, 상태 집합에 쌓이지 않게 막는다.
 */
const ID_RE = /^[A-Za-z0-9_-]{4,200}$/

/**
 * "아직 도는 중" 을 뜻하는 알림 상태들. 이 값이면 종료로 세지 않는다.
 *
 * 지금 실측에 나오는 값은 `completed`(66) 와 `failed`(5) 둘뿐이고 **둘 다 종료**다. 그래서 판정은
 * 화이트리스트(`completed` 만 종료)가 아니라 **블랙리스트**로 뒀다 — 새 종료 상태(`cancelled` 등)가
 * 생겨도 자동으로 종료로 잡히는 쪽이 안전하다. 화이트리스트면 모르는 상태가 영원히 "도는 중" 으로 남는다.
 * `<status>` 자체가 없는 알림도 종료로 본다(진행 중 알림은 관측되지 않았다).
 */
const RUNNING_STATUSES: readonly string[] = ['running', 'pending', 'in_progress', 'in-progress', 'started', 'queued']

/**
 * 개행 없이 남은 꼬리를 얼마까지 들고 있을지. 넘으면 버린다(`dropped`).
 *
 * 꼬리는 "아직 다 안 쓰인 줄" 이라 다음 청크에 이어 붙여야 하는데, 파일이 이상해져서 개행이 영원히
 * 안 오면 메모리가 계속 늘어난다. 실측 줄 길이는 평균 2KB 지만 큰 `tool_result` 가 실린 줄은
 * 수백 KB 가 되므로 넉넉히 잡는다.
 */
const MAX_PENDING = 4 * 1024 * 1024

/** 서브에이전트 호출 한 건 */
export interface SubagentCall {
    /** `tool_use` 의 id (`toolu_…`) — 종료 알림과 맞추는 열쇠 */
    id: string
    /** `input.description` — 3~5 낱말짜리 표시용 라벨. 없으면 빈 문자열 */
    description: string
    /** `input.subagent_type` — 없으면 null (기본 에이전트) */
    subagentType: string | null
    /** 호출 줄의 `timestamp` (ISO 문자열). 줄에 없으면 null */
    startedAt: string | null
}

/**
 * 증분 스캔 누적 상태.
 *
 * **왜 이 모양인가** — 13MB 까지 자라는 파일을 매번 다 파싱할 수 없어서(실측 6,395줄) 호출부가
 * "지난번 오프셋 이후" 만 읽어 넘기고, 이 객체가 그 사이의 기억을 들고 있어야 한다. 들고 있을 것은
 * 정확히 두 집합이다 —
 *  - `calls`: 호출 id → 정보. **Map 인 이유는 삽입 순서**다. 툴팁에 호출된 순서(= 시간순)로 적어야
 *    사람이 읽을 수 있고, Set + 별도 배열로 나누면 두 자료구조가 어긋날 자리가 생긴다.
 *  - `done`: 종료 알림을 받은 id. **호출을 아직 못 봤어도 넣는다** — 증분 경계에서 알림이 호출보다
 *    먼저 도착하고(청크가 알림 줄에서 시작), 세션을 이어받으면 앞 파일의 호출은 아예 못 본다.
 *    그러니 `done` 은 호출 여부와 무관하게 단조증가하는 집합이어야 한다.
 * 두 집합을 따로 두고 **차집합으로 답을 만드는** 구조라 순서가 어떻게 오든 결과가 같다(멱등).
 *
 * 완료된 호출을 `calls` 에서 지우지 않는 이유 — 총 호출 수를 진단(`diag`)에 쓸 수 있고, 규모가
 * 세션당 수십 건이라 지워서 얻을 것이 없다. 지우면 "완료 먼저 → 호출 나중" 을 되살릴 수도 없다.
 */
export interface SubagentState {
    calls: Map<string, SubagentCall>
    done: Set<string>
    /** 개행으로 끝나지 않은 마지막 조각 — 다음 청크 앞에 이어 붙인다 */
    pending: string
    /** 지금까지 먹은 줄 수 (진단용) */
    lines: number
    /** JSON 이 아니거나 깨져서 버린 완성된 줄 수 (진단용) */
    skipped: number
    /** `MAX_PENDING` 을 넘겨 버린 꼬리 수 (진단용 — 0 이 아니면 뭔가 이상하다) */
    dropped: number
}

/** 사이드바가 쓰는 결론 */
export interface SubagentSummary {
    /** 도는 중인 개수 */
    running: number
    /** 도는 중인 것들 — 호출된 순서(시간순) */
    items: SubagentCall[]
    /** 이 상태가 본 총 호출 수 */
    calls: number
    /** 종료 알림을 받은 id 수 (호출을 못 본 것도 포함) */
    done: number
}

export function createSubagentState (): SubagentState {
    return { calls: new Map(), done: new Set(), pending: '', lines: 0, skipped: 0, dropped: 0 }
}

/** 알림 블록에서 종료 id 를 긁어 `done` 에 넣는다 (한 줄에 여러 블록이 실려 오기도 한다) */
function readNotifications (state: SubagentState, line: string): void {
    let at = 0
    for (;;) {
        const open = line.indexOf(NOTIFY_OPEN, at)
        if (open < 0) {
            return
        }
        const from = open + NOTIFY_OPEN.length
        const close = line.indexOf(NOTIFY_CLOSE, from)
        // 닫는 태그가 없어도 앞쪽의 id 는 읽는다 — 태그 순서가 `task-id` → `tool-use-id` → 나머지라
        // 블록이 잘려 있어도 열쇠는 이미 지나갔다
        const block = close < 0 ? line.slice(from) : line.slice(from, close)
        at = close < 0 ? line.length : close + NOTIFY_CLOSE.length
        const hit = TOOL_USE_ID_RE.exec(block)
        if (!hit) {
            continue
        }
        const id = hit[1].trim()
        if (!ID_RE.test(id)) {
            continue
        }
        const st = STATUS_RE.exec(block)
        if (st && RUNNING_STATUSES.indexOf(st[1].trim().toLowerCase()) >= 0) {
            continue
        }
        state.done.add(id)
    }
}

/** 이 줄에 Agent 호출이 들어 있을 가능성이 있나 — JSON.parse 를 아끼는 값싼 체 */
function mayHaveCall (line: string): boolean {
    if (line.indexOf('tool_use') < 0) {
        return false
    }
    for (const name of AGENT_TOOL_NAMES) {
        if (line.indexOf(name) >= 0) {
            return true
        }
    }
    return false
}

/** `message.content[]` 에서 Agent 호출을 뽑아 `calls` 에 넣는다 */
function readCalls (state: SubagentState, line: string): void {
    let obj: any
    try {
        obj = JSON.parse(line)
    } catch {
        // 완성된 줄인데 JSON 이 아니다 — 버린다. 근거는 `feedLines` 주석
        state.skipped++
        return
    }
    if (!obj || typeof obj !== 'object' || obj.isSidechain === true) {
        // 사이드체인 = 서브에이전트 자신의 줄. 그 안에서 또 Agent 를 부른 것까지 세면 사이드바 숫자가
        // "이 세션이 띄운 개수" 가 아니게 된다. (실측 파일에는 사이드체인 줄이 없었지만, 다른 버전에서
        // 같은 파일에 섞여 들어오더라도 숫자가 흔들리지 않게 막아 둔다)
        return
    }
    const content = obj.message?.content
    if (!Array.isArray(content)) {
        return
    }
    for (const block of content) {
        if (!block || typeof block !== 'object') {
            continue
        }
        if (block.type !== 'tool_use' || AGENT_TOOL_NAMES.indexOf(String(block.name)) < 0) {
            continue
        }
        const id = String(block.id ?? '').trim()
        if (!ID_RE.test(id) || state.calls.has(id)) {
            // 같은 id 가 두 번 오면 먼저 본 것을 지킨다 — 세션을 이어받으면 같은 줄이 다시 적히는 일이 있다
            continue
        }
        const input = block.input && typeof block.input === 'object' ? block.input : {}
        // `input.prompt` 는 폴백으로도 쓰지 않는다 — 지시문 전문이라 툴팁에 넣을 것이 아니고(길다),
        // 사용자 대화 내용이 사이드바 title 로 새는 길을 만들지 않는다. 라벨은 description 이 정본이다
        const desc = typeof input.description === 'string' ? input.description.trim() : ''
        const type = typeof input.subagent_type === 'string' && input.subagent_type.trim()
            ? input.subagent_type.trim() : null
        const ts = typeof obj.timestamp === 'string' && obj.timestamp ? obj.timestamp : null
        state.calls.set(id, { id, description: desc, subagentType: type, startedAt: ts })
    }
}

/**
 * **완성된 줄들**을 먹인다. 상태를 그 자리에서 고치고 같은 객체를 돌려준다
 * (세션당 상태 하나를 계속 들고 도는 쓰임새라 사본을 만들 이유가 없다).
 *
 * **깨진 줄은 버린다.** 개행이 왔다는 것은 그 줄이 다 쓰였다는 뜻이라, 다시 읽어도 결과가 같다.
 * "다음에 다시 보자" 로 남기면 매 폴링마다 같은 줄을 파싱하는 무한 재시도가 된다.
 * 반대로 **개행 없는 꼬리는 남긴다** — 그건 "깨진 것" 이 아니라 "아직 안 온 것" 이고,
 * 게다가 꼬리에 있는 이벤트는 거의 항상 **가장 최신**(방금 띄운 Agent / 방금 온 종료 알림)이라
 * 버리면 증분 구조에서는 되찾을 기회가 없다(파일을 처음부터 다시 읽지 않는다). 그 구분은
 * `feedChunk` 가 개행으로 판정한다.
 */
export function feedLines (state: SubagentState, lines: readonly string[]): SubagentState {
    for (const raw of lines ?? []) {
        if (typeof raw !== 'string') {
            continue
        }
        state.lines++
        // CRLF 로 적힌 기록도 있다 — 꼬리 `\r` 를 떼지 않으면 태그·JSON 끝이 어긋난다
        const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw
        if (!line) {
            continue
        }
        if (line.indexOf(NOTIFY_OPEN) >= 0) {
            // 알림은 JSON 모양이 세 가지라 원문에서 긁는다 (모듈 주석 참고).
            // 사이드체인 여부를 보지 않는 것은 의도다 — `done` 은 `calls` 와 교차될 때만 뜻이 있고
            // `calls` 쪽에서 이미 걸렀다
            readNotifications(state, line)
        }
        if (mayHaveCall(line)) {
            readCalls(state, line)
        }
    }
    return state
}

/**
 * 파일에서 읽은 **청크**를 먹인다. 개행으로 끝나지 않은 마지막 조각은 다음 호출까지 들고 있는다.
 *
 * 호출부는 "지난 크기 이후만 읽기" 만 하면 되고 줄 경계는 여기서 맞춘다 — 그 경계 처리를 호출부마다
 * 다시 쓰면(서비스·진단구) 사본이 갈린다. 빈 청크(파일이 안 자랐다)는 아무 일도 하지 않는다.
 */
export function feedChunk (state: SubagentState, chunk: string): SubagentState {
    const text = typeof chunk === 'string' ? chunk : ''
    if (!text) {
        return state
    }
    const buf = state.pending + text
    const parts = buf.split('\n')
    // 마지막 조각은 개행이 없었다는 뜻 = 아직 쓰이는 중. 청크가 개행으로 끝났으면 빈 문자열이 된다
    state.pending = parts.pop() ?? ''
    if (state.pending.length > MAX_PENDING) {
        state.dropped++
        state.pending = ''
    }
    return feedLines(state, parts)
}

/** 도는 중인 것 = 호출된 것 중 종료 알림에 안 나온 것. 호출 순서를 지킨다 */
export function summarizeSubagents (state: SubagentState | null | undefined): SubagentSummary {
    const s = state
    if (!s || !(s.calls instanceof Map)) {
        return { running: 0, items: [], calls: 0, done: 0 }
    }
    const items: SubagentCall[] = []
    for (const call of s.calls.values()) {
        if (!s.done.has(call.id)) {
            items.push(call)
        }
    }
    return { running: items.length, items, calls: s.calls.size, done: s.done.size }
}

/** 설명이 없는 호출에 붙일 이름 — 타입이라도 있으면 그걸 쓴다 */
function callLabel (call: SubagentCall): string {
    return call.description || call.subagentType || '(설명 없음)'
}

/**
 * 사이드바 title(툴팁)에 넣을 문장. **도는 것이 없으면 빈 문자열** — 호출부가 title 을 아예 안 붙이게.
 *
 * 개수만으로는 "무엇을 시켜 놨는지" 를 모른다(그게 이 기능의 목적이다). 그래서 설명을 줄줄이 붙이는데,
 * 200px 사이드바(config `sidebarMin`)의 툴팁이 화면을 덮지 않게 `max` 개까지만 적고 나머지는 수로 줄인다.
 */
export function formatSubagentTooltip (summary: SubagentSummary | null | undefined, max = 8): string {
    const items = summary?.items ?? []
    if (!items.length) {
        return ''
    }
    const cap = Number.isFinite(max) && (max as number) > 0 ? Math.floor(max as number) : items.length
    const head = '서브에이전트 ' + items.length + '개 진행중'
    const shown = items.slice(0, cap).map(c => '· ' + callLabel(c))
    if (items.length > cap) {
        shown.push('· … 외 ' + (items.length - cap) + '개')
    }
    return [head, ...shown].join('\n')
}

// ---------- 훅이 직접 알려 준 서브에이전트 ----------
// 위(대화기록 훑기)는 **파일에 기록이 닿은 뒤에야** 보이고, 종료 알림의 JSON 모양이 셋이라
// 놓치기도 쉽다. `SubagentStart`/`SubagentStop` 훅은 그 둘 다 없다 — 켜짐·꺼짐을 `agent_id` 로
// 즉시, 정확히 알려준다(실측 payload: 두 이벤트가 같은 `agent_id` 를 싣는다).
// 그래서 **훅을 받는 세션에서는 이쪽이 진실이고, 대화기록 훑기는 훅 없는 세션의 폴백**이다.

/** 훅이 알려 준, 지금 도는 서브에이전트 하나 */
export interface LiveAgent {
    /** 훅 payload 의 `agent_id` — start 와 stop 이 같은 값을 쓴다 */
    id: string
    /** `general-purpose` · `Explore` 등. 없으면 빈 문자열 */
    type: string
    /** start 를 받은 시각 (epoch ms) */
    at: number
}

export interface LiveAgentSummary {
    running: number
    /** 종류별 개수 — 많은 것부터, 같으면 이름순 (화면 순서가 흔들리지 않게) */
    byType: { type: string, count: number }[]
    /** 가장 먼저 뜬 것의 시작 시각. 없으면 0 */
    oldestAt: number
}

/**
 * 훅으로 받은 목록을 화면이 쓸 모양으로 줄인다.
 *
 * 정렬을 못 박는 이유 — 툴팁은 매초 다시 그려진다. `Map` 순서(삽입순)를 그대로 쓰면 에이전트
 * 하나가 끝날 때마다 줄 순서가 바뀌어 읽는 중에 흔들린다.
 */
export function summarizeLiveAgents (list: Iterable<LiveAgent> | null | undefined): LiveAgentSummary {
    const counts = new Map<string, number>()
    let running = 0
    let oldestAt = 0
    for (const a of list ?? []) {
        if (!a || !a.id) {
            continue
        }
        running++
        const type = a.type || '이름 없음'
        counts.set(type, (counts.get(type) ?? 0) + 1)
        if (Number.isFinite(a.at) && a.at > 0 && (!oldestAt || a.at < oldestAt)) {
            oldestAt = a.at
        }
    }
    const byType = [...counts].map(([type, count]) => ({ type, count }))
        .sort((x, y) => y.count - x.count || x.type.localeCompare(y.type))
    return { running, byType, oldestAt }
}

/**
 * 훅 집계로 만드는 툴팁 머리. 대화기록 쪽(`formatSubagentTooltip`)과 **문구를 맞춘다** —
 * 같은 자리에 뜨는 글이 원천에 따라 달라 보이면 사용자는 그것을 버그로 읽는다.
 */
export function formatLiveAgentTooltip (summary: LiveAgentSummary | null | undefined): string {
    const s = summary
    if (!s || s.running <= 0) {
        return ''
    }
    const head = '서브에이전트 ' + s.running + '개 진행중'
    return [head, ...s.byType.map(t => '· ' + t.type + ' ' + t.count + '개')].join('\n')
}

/**
 * 이 파일명이 그 세션의 대화기록인가 — 호출부가 `~/.claude/projects` 의 각 프로젝트 폴더를 훑을 때 쓰는 판정.
 *
 * 프로젝트 폴더 이름 규칙(경로를 `-` 로 뭉갠 이름)에 기대지 않으려고 폴더를 훑는 방식을 쓴다.
 * 규칙을 흉내내면 드라이브·대소문자·특수문자에서 어긋나는데, 세션 id 로 파일명을 맞추면 폴더를
 * 몰라도 정확히 하나가 잡힌다(실측). 대소문자를 무시하는 것은 윈도우 파일명이라서다.
 */
export function matchesSessionTranscript (fileName: string | null | undefined, sessionId: string | null | undefined): boolean {
    const name = String(fileName ?? '').trim().toLowerCase()
    const sid = String(sessionId ?? '').trim().toLowerCase()
    if (!name || !sid || !ID_RE.test(sid)) {
        return false
    }
    return name === sid + '.jsonl'
}
