/**
 * **지난 세션 원장** — 죽은 Claude Code 세션을 다시 찾아낼 수 있게 하는 순수 규칙.
 *
 * 왜 필요한가 — `recovery.service.ts` 가 적어 둔 대로 agentdeck 은 Tabby 의 순정 탭 복원을
 * 의도적으로 껐다. 되살아나는 것은 셸뿐이고 그 안의 세션은 이미 죽어 있어 "주인 없는 탭" 만
 * 남기 때문이다. 그 자리에 들어갈 진짜 복원이 `claude --resume <세션id>` 인데, 사람이 막히는
 * 지점은 명령이 아니라 **UUID 목록에서 내 작업을 못 찾는 것** 이다.
 *
 * agentdeck 은 그 답을 이미 갖고 있다 — Enter 시점에 입력창에서 주운 프롬프트 원문(라벨).
 * 문제는 그게 **메모리에만 있다는 것** 이다(`status.service` 의 `TabState.label`). 탭이 닫히면
 * 같이 증발한다. 그래서 이 모듈이 라벨·상태·cwd 를 세션 id 에 묶어 남기고, 목록을 만든다.
 *
 * fs·타이머는 여기 없다 — `group.ts`·`subagents.ts` 와 같은 이유다. 파일을 읽고 주기를
 * 관리하는 것은 호출부(서비스)의 일이고, 이 파일은 **무엇을 어떤 순서로 보여줄지** 만 정한다.
 * 그래야 `npm test` 에서 돌릴 수 있다.
 */

/** 원장 한 줄 — 세션 하나가 무엇이었는지 */
export interface SessionRecord {
    /** Older ledger entries default to Claude. */
    agent?: 'claude' | 'codex'
    /** Claude Code 세션 id (기록 파일 이름이기도 하다) */
    sessionId: string
    /** 그 세션이 돌던 작업 폴더. **프로젝트 루트가 아니라 cwd 다** (`--resume` 이 이걸로 세션을 묶는다) */
    cwd: string | null
    /** 사람이 알아보는 이름 — 살아 있을 때 주운 라벨, 없으면 기록에서 읽은 첫 프롬프트 */
    label: string
    /** 마지막으로 관측된 작업 상태. 화면에 흔적으로만 남는다 */
    lastStatus: string | null
    /** 마지막 활동 시각 (epoch ms) */
    lastSeen: number
    /** 라벨의 출처 — `live` 는 사람이 친 원문, `head` 는 기록 앞부분에서 주운 것 */
    from: 'live' | 'head'
}

/** 화면에 그릴 한 줄 — `SessionRecord` 에 "지금 열려 있나" 를 더한 것 */
export interface ResumeRow extends SessionRecord {
    /** 이 세션을 이미 들고 있는 탭 id. 있으면 이어받기 대신 그 탭으로 이동한다 */
    openTabId: string | null
}

/**
 * 기록 파일 앞부분을 얼마나 읽을지.
 *
 * 전부 파싱하면 안 된다 — 실측 세션이 2.6MB(1,021줄)·5.5MB 고, 목록 한 번에 수십 개를 훑는다.
 * 필요한 것은 `cwd` 와 **첫 사람 프롬프트** 둘뿐인데 실측에서 `cwd` 는 5번째 줄,
 * 프롬프트는 65번째 줄에 나왔다(2026-09-11, `f54b20b9`). 앞의 60여 줄은 훅 주입·모드·첨부라
 * 여유를 크게 잡아도 이 정도면 닿는다. 못 찾으면 라벨 없이 두지, 파일을 더 파고들지 않는다.
 */
export const HEAD_LINE_LIMIT = 400
/** 줄 수와 별개로 이 바이트를 넘기면 멈춘다 — 한 줄이 통째로 거대한 기록(대용량 첨부)이 있다 */
export const HEAD_BYTE_LIMIT = 512 * 1024

/**
 * 첫 프롬프트로 치지 않는 것들.
 *
 * 기록의 `type:"user"` 줄에는 사람이 친 것만 오지 않는다 — 훅이 주입한 컨텍스트, 한도 리셋
 * 안내, 서브에이전트 종료 알림, 슬래시 명령의 출력이 같은 모양으로 들어온다(실측: `9e0c954f`
 * 의 마지막 user 줄 8개가 전부 `Your claude.ai usage limit has reset…` 이었다).
 * 그걸 라벨로 올리면 목록의 모든 줄이 같은 문장이 되어 아무것도 구별하지 못한다.
 */
const NOISE_PREFIXES: readonly string[] = [
    '<',                       // <task-notification> · <command-name> · <local-command-stdout> · <system-reminder>
    'Caveat:',                 // 요약 이어받기 안내
    '[Request interrupted',    // 사람이 끊은 자리
    'Your claude.ai usage limit',
]

/** 사람이 친 프롬프트로 볼 수 있는 문자열인가 */
export function isHumanPrompt (text: unknown): boolean {
    if (typeof text !== 'string') {
        return false
    }
    const t = text.trim()
    if (!t) {
        return false
    }
    return !NOISE_PREFIXES.some(p => t.startsWith(p))
}

/**
 * 기록 줄(파싱된 JSON) 하나에서 사람이 친 프롬프트를 꺼낸다 — 아니면 null.
 *
 * `message.content` 는 문자열일 때도 있고 블록 배열일 때도 있다. 배열이면 `text` 블록만 잇는다
 * (`tool_result` 가 섞여 들어오면 라벨이 도구 출력으로 오염된다).
 */
export function promptFromRecord (rec: any): string | null {
    if (rec?.type === 'event_msg' && rec.payload?.type === 'user_message') {
        return isHumanPrompt(rec.payload.message) ? rec.payload.message.trim() : null
    }
    if (rec?.type === 'response_item' && rec.payload?.role === 'user') {
        const text = (Array.isArray(rec.payload.content) ? rec.payload.content : [])
            .filter((b: any) => b?.type === 'input_text' && typeof b.text === 'string')
            .map((b: any) => b.text).join(' ')
        return isHumanPrompt(text) ? text.trim() : null
    }
    if (!rec || rec.type !== 'user' || rec.isMeta === true) {
        return null
    }
    const content = rec.message?.content
    let text: string | null = null
    if (typeof content === 'string') {
        text = content
    } else if (Array.isArray(content)) {
        const parts = content
            .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
        text = parts.length ? parts.join(' ') : null
    }
    return isHumanPrompt(text) ? (text as string).trim() : null
}

/** 라벨로 쓸 길이로 줄인다 — 사이드바 한 줄은 말줄임이 있지만 원장에 소설을 담을 이유는 없다 */
export const LABEL_MAX = 140

export function clampLabel (text: string | null | undefined): string {
    if (!text) {
        return ''
    }
    // 줄바꿈이 들어오면 한 줄로 — 여러 줄 프롬프트가 그대로 오면 목록 높이가 튄다
    const one = text.replace(/\s+/g, ' ').trim()
    return one.length > LABEL_MAX ? one.slice(0, LABEL_MAX - 1) + '…' : one
}

/** 기록 앞부분에서 읽어낸 것 */
export interface HeadInfo {
    isSubagent?: boolean
    cwd: string | null
    label: string
    /** 앞부분에서 본 가장 이른 timestamp — 파일 mtime 이 없을 때의 폴백 */
    startedAt: number | null
}

/**
 * 기록 앞부분의 줄들에서 cwd·첫 프롬프트를 뽑는다.
 *
 * **폴더 이름 규칙을 흉내내지 않는다.** `~/.claude/projects/<폴더>` 의 이름은 작업 경로를 `-` 로
 * 뭉갠 것이라 드라이브 문자·한글·특수문자에서 되돌릴 수 없다(`notify.service.ts:1006` 이 같은
 * 이유로 폴더 이름 대신 파일명 매칭을 쓴다). 기록 안에 `cwd` 가 그대로 들어 있으니 그걸 읽는다.
 */
export function readHead (lines: readonly string[]): HeadInfo {
    let cwd: string | null = null
    let label = ''
    let startedAt: number | null = null
    for (const line of lines) {
        if (!line) {
            continue
        }
        let rec: any
        try {
            rec = JSON.parse(line)
        } catch {
            // 잘린 줄 하나 때문에 나머지를 포기하지 않는다 (증분 읽기와 같은 태도)
            continue
        }
        if (rec?.type === 'session_meta') {
            if (rec.payload?.source?.subagent) {
                return { cwd: null, label: '', startedAt: null, isSubagent: true }
            }
            if (!cwd && typeof rec.payload?.cwd === 'string') {
                cwd = rec.payload.cwd
            }
        }
        if (!cwd && typeof rec?.cwd === 'string' && rec.cwd) {
            cwd = rec.cwd
        }
        if (startedAt === null && typeof rec?.timestamp === 'string') {
            const t = Date.parse(rec.timestamp)
            if (!Number.isNaN(t)) {
                startedAt = t
            }
        }
        if (!label) {
            const p = promptFromRecord(rec)
            if (p) {
                label = clampLabel(p)
            }
        }
        if (cwd && label && startedAt !== null) {
            break
        }
    }
    return { cwd, label, startedAt }
}

/**
 * 원장과 디스크 스캔을 합친다 — **세션 id 가 키, 원장이 우선.**
 *
 * 두 경로가 다 필요하다. 원장에만 기대면 agentdeck 설치 이전 세션과 다른 터미널에서 띄운
 * 세션이 통째로 안 보이고, 디스크에만 기대면 사람이 친 라벨(가장 좋은 단서)을 잃는다.
 *
 * 원장이 이기는 것은 **라벨과 상태** 뿐이다. `lastSeen` 은 둘 중 큰 값을 쓴다 — 원장은 탭이
 * 닫힐 때 멈추는데 그 뒤 다른 터미널에서 같은 세션을 이어받았을 수 있고, 그때는 디스크가 맞다.
 */
export function mergeSessions (
    ledger: readonly SessionRecord[],
    scanned: readonly SessionRecord[],
): SessionRecord[] {
    const out = new Map<string, SessionRecord>()
    for (const rec of scanned) {
        if (rec.sessionId) {
            out.set(rec.sessionId, { ...rec })
        }
    }
    for (const rec of ledger) {
        if (!rec.sessionId) {
            continue
        }
        const disk = out.get(rec.sessionId)
        if (!disk) {
            // 기록 파일이 사라진 세션. **목록에 넣지 않는다** — 이어받아도 복원할 것이 없다.
            // 원장 청소(`pruneLedger`)가 같은 판정으로 지운다
            continue
        }
        out.set(rec.sessionId, {
            ...disk,
            label: rec.label || disk.label,
            from: rec.label ? rec.from : disk.from,
            lastStatus: rec.lastStatus ?? disk.lastStatus,
            cwd: disk.cwd || rec.cwd,
            lastSeen: Math.max(rec.lastSeen || 0, disk.lastSeen || 0),
        })
    }
    return [...out.values()]
}

/**
 * 기록 파일이 남아 있는 세션만 남긴다 — 원장이 무한히 부풀지 않게.
 *
 * 디스크를 진실로 삼는 이유: 사람이 `~/.claude/projects` 를 지우면 그 세션은 이어받을 수 없고,
 * 그걸 원장이 계속 보여주면 눌렀을 때 빈 세션이 뜬다.
 */
export function pruneLedger (
    ledger: readonly SessionRecord[],
    aliveIds: ReadonlySet<string>,
): SessionRecord[] {
    return ledger.filter(r => r.sessionId && aliveIds.has(r.sessionId))
}

export interface ResumeListOptions {
    /**
     * 이 줄 묶음이 **덮는 그룹 키들**. `null` 이면 **거르지 않는다** (전부).
     *
     * 서랍이 그룹마다 하나씩 달려 있던 시절의 값이다. 지금은 사이드바 바닥에 하나만 있고
     * 거기에는 `null` 이 들어간다 (2026-09-14 유저: "각자 저장한거 전부 ... 찾을 수 있게").
     * 그래도 인자를 남겨 두는 이유 — 그룹별로 좁혀 보는 화면이 돌아올 수 있고,
     * 무엇보다 이 함수의 회귀 시험이 그 경로를 그대로 들고 있다.
     *
     * 목록을 받는(키 하나가 아닌) 까닭: 사이드바는 그룹이 하나뿐이면 헤더를 그리지 않고
     * 목록을 **평면 한 덩이**로 만드는데(deck.service `renderPlan`), 그때 그 덩이의 `key` 는
     * `null`(기타)이 된다. 거기에 `null` 하나만 넘기면 어떤 세션도 안 걸린다.
     */
    groupKeys: readonly (string | null)[] | null
    /** cwd -> 그룹 키. 호출부가 `groupKeyOf` + `projectRootOf` 를 엮어 넘긴다 */
    keyOf: (cwd: string | null) => string | null
    /** 키 비교용 폴딩 (대소문자·구분자) — `group.ts` 의 `foldGroupKey` */
    fold: (key: string | null | undefined) => string
    /** 지금 탭이 들고 있는 세션 — sessionId -> tabId */
    live: ReadonlyMap<string, string>
    /** 며칠치까지 보여줄지 (0 이하면 제한 없음) */
    days: number
    /** 몇 줄까지 (0 이하면 제한 없음) */
    limit: number
    /** 사람이 숨긴 세션 id */
    hidden: ReadonlySet<string>
    /** 기준 시각 — 테스트가 고정할 수 있게 주입받는다 */
    now: number
}

/**
 * 한 그룹에 그릴 지난 세션 줄.
 *
 * **살아 있는 세션을 빼지 않는다** — `openTabId` 를 달아 그대로 둔다. 지우면 "내가 방금 보던
 * 그 작업이 목록에 없다" 가 되어 사람이 같은 세션을 다시 찾아 헤맨다. 대신 눌렀을 때
 * 이어받지 않고 그 탭으로 보낸다(같은 세션을 두 번 이어받으면 두 프로세스가 한 기록에 덧쓴다).
 *
 * 정렬은 **마지막 활동 내림차순** 하나뿐이다. 상태별로 묶고 싶어질 수 있는데, 지난 세션에서
 * 사람이 찾는 것은 "방금 하던 것" 이지 "완료된 것" 이 아니다.
 */
export function resumeRowsFor (
    records: readonly SessionRecord[],
    opts: ResumeListOptions,
): ResumeRow[] {
    const want = opts.groupKeys ? new Set(opts.groupKeys.map(k => opts.fold(k))) : null
    const cutoff = opts.days > 0 ? opts.now - opts.days * 86400000 : null
    const rows: ResumeRow[] = []
    for (const rec of records) {
        if (!rec.sessionId || opts.hidden.has(rec.sessionId)) {
            continue
        }
        if (want && !want.has(opts.fold(opts.keyOf(rec.cwd)))) {
            continue
        }
        if (cutoff !== null && rec.lastSeen < cutoff) {
            continue
        }
        rows.push({ ...rec, openTabId: opts.live.get(rec.sessionId) ?? null })
    }
    rows.sort((a, b) => b.lastSeen - a.lastSeen || a.sessionId.localeCompare(b.sessionId))
    return opts.limit > 0 ? rows.slice(0, opts.limit) : rows
}

/**
 * 마지막 활동 시각을 사람이 읽는 짧은 꼴로.
 *
 * 오늘이면 시각(`14:12`), 어제면 `어제`, 그보다 오래면 `9/10`. 사이드바 줄의 오른쪽 끝에
 * 들어가므로 길면 제목 폭을 먹는다 — 연도는 넣지 않는다(제한 기간이 기본 7일이라 못 만난다).
 */
export function formatWhen (ts: number, now: number): string {
    if (!ts || !Number.isFinite(ts)) {
        return ''
    }
    const d = new Date(ts)
    const n = new Date(now)
    const sameDay = d.getFullYear() === n.getFullYear()
        && d.getMonth() === n.getMonth()
        && d.getDate() === n.getDate()
    if (sameDay) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) {
        return '어제'
    }
    return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 세션 id 처럼 생겼나 — 기록 폴더에는 우리 것이 아닌 파일도 있을 수 있다 */
const SESSION_FILE_RE = /^([0-9a-fA-F-]{8,64})\.jsonl$/

/** 파일 이름에서 세션 id 를 꺼낸다 (아니면 null) */
export function sessionIdFromFile (name: string): string | null {
    const m = SESSION_FILE_RE.exec(name || '')
    return m ? m[1] : null
}

/**
 * 셸에 보낼 이어받기 명령.
 *
 * **프로필의 `command` 를 갈아끼우지 않고 셸에 문자열로 보낸다.** 이유 둘 —
 *  ① 기존 `agentdeck:root` 프로필(`-NoLogo -ExecutionPolicy Bypass`, COLORTERM/FORCE_COLOR)을
 *     그대로 쓴다. npm 전역 `.ps1` 래퍼가 실행정책에 막히는 문제를 그 인자가 이미 풀어 둔다
 *     (`profile.service.ts:58`).
 *  ② claude 가 끝나도 셸이 남아 사람이 이어서 쓸 수 있다. `command` 로 박으면
 *     `behaviorOnSessionEnd` 에 따라 탭이 닫힌다.
 *
 * 세션 id 는 우리가 파일 이름에서 읽은 값이고 `SESSION_FILE_RE` 를 통과한 것만 여기 온다 —
 * 그래도 명령을 만드는 자리이므로 한 번 더 막는다. 통과 못 하면 빈 문자열이고 호출부가 아무것도 보내지 않는다.
 */
export function resumeCommand (sessionId: string, fork: boolean, agent: 'claude' | 'codex' = 'claude'): string {
    if (!/^[0-9a-fA-F-]{8,64}$/.test(sessionId || '')) {
        return ''
    }
    return agent === 'codex'
        ? `codex ${fork ? 'fork' : 'resume'} ${sessionId}`
        : `claude --resume ${sessionId}${fork ? ' --fork-session' : ''}`
}
