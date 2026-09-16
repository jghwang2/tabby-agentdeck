import { BaseTabComponent } from 'tabby-core'
import { WorkStatusService } from './status.service'
import { WorkStatus } from './api'
import { AgentProfile, unionProfile } from './agents'
import { reasonFromScreen } from './reason'

/** 훅이 상태를 직접 통보하는 커스텀 OSC — ESC ] 1337 ; AgentDeck=<status>;<label> BEL */
const OSC_RE = /\x1b\]1337;AgentDeck=([a-z]+)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/gi

// 대기·작업중 판정에 쓰는 화면 문구와 제목 스피너는 **에이전트마다 다르므로** 여기 두지 않고
// `agents.ts` 의 프로필에서 읽는다. 예전에는 Claude Code 기준 리터럴이 이 파일에 박혀 있었고,
// 그래서 새 CLI 를 지원할 때마다 이 파일을 고쳐야 했다. 실측 근거는 값과 함께 그쪽으로 옮겼다.
// OSC_RE 와 TITLE_RE 는 우리 규약이라 에이전트와 무관하다 — 그것만 이 파일에 남는다.

const VALID: WorkStatus[] = ['idle', 'running', 'waiting', 'limited', 'done', 'error']

/** OSC 가 청크 경계에 걸리는 것을 막기 위한 잔여 버퍼 */
const tails = new WeakMap<object, string>()

/**
 * 조각 안에서 그 패턴에 걸린 **줄 하나**를 찾아 배지에 붙일 이유로 줄인다.
 *
 * 판정 자체는 조각 전체에 `test` 한다(아래 갈래들 — 지금까지의 동작을 그대로 둔다). 그런데
 * 이유는 조각 전체를 쓸 수 없다: 화면 재그리기 한 번이 수십 줄이라 그대로 넣으면 배지가
 * 화면 덤프가 된다. 그래서 이유만 줄 단위로 다시 찾는다.
 *
 * 빈 이유를 주는 줄은 건너뛰고 다음 줄을 본다 — 승인 대화상자는 질문 줄과 선택지 줄이 같은
 * 조각에 오는데(`Allow execution of …` + `● 1. Allow once`), 선택지 줄은 이유가 아니라
 * 빈 값으로 접히기 때문이다(`reason.ts`). 아무 줄도 안 걸리면 빈 값 = 부연 없이 상태만 바꾼다.
 */
function reasonFrom (data: string, patterns: RegExp[]): string {
    for (const line of data.split(/[\r\n]+/)) {
        if (!line.trim() || !patterns.some(re => re.test(line))) {
            continue
        }
        const short = reasonFromScreen(line)
        if (short) {
            return short
        }
    }
    return ''
}

/**
 * 자동 판정으로 상태를 바꾸면서 **부연(이유)도 함께** 남긴다.
 *
 * `status.setAuto` 는 상태만 바꾸고 이유를 받지 않는다 — 이유는 지금까지 훅 경로(`setManual`)에만
 * 있던 값이었고, 그래서 화면 판정으로 `waiting` 이 된 탭은 배지에 이유가 비어 있었다(어느 탭이
 * 무엇을 기다리는지 사이드바만 보고 알 수 없다). 그래서 살아있는 상태 객체(`status.get`)에
 * 이유를 먼저 써 두고 전이는 `setAuto` 에 맡긴다 — 전이가 일어나면 화면 갱신 통보도 그때 함께 나간다.
 *
 * **상태가 바뀔 때는 빈 이유라도 덮어쓴다.** `waiting`·`limited` 는 둘 다 이유를 가질 수 있어
 * (`status.service` `REASON_STATUSES`) 그냥 두면 승인 이유("Bash 권한")가 한도 배지에 남고,
 * 그러면 지금 승인을 기다리는 것처럼 읽힌다. 반대로 **같은 상태의 재판정에서는 빈 이유로 지우지
 * 않는다** — 커서만 움직인 재그리기 조각에서 이유를 못 뽑았다고 앞서 잡은 이유를 버릴 일이 없다.
 *
 * pinned(훅·수동 지정) 탭은 손대지 않는다 — `setAuto` 가 어차피 무시하므로 이유만 바뀌면
 * 배지가 훅이 준 상태와 어긋난다.
 */
function setAutoWithReason (
    status: WorkStatusService,
    root: BaseTabComponent,
    next: WorkStatus,
    reason: string,
): void {
    const s = status.get(root)
    if (s.pinned) {
        return
    }
    if (s.status !== next || reason) {
        s.reason = reason
    }
    status.setAuto(root, next)
}

/**
 * 한도 도달을 사람의 행동으로 풀어 준다 — **사용자가 새 프롬프트를 보낸 순간**이 근거다.
 *
 * `limited` 는 화면 갱신만으로는 안 풀린다(`applyOutput` 의 마지막 갈래 주석). 그래서 풀리는
 * 길을 반드시 하나 더 열어 둔다 — 실패에 영구 lock 을 걸지 않는다는 이 저장소의 원칙이다.
 * `deck.service` 의 Enter 관측 지점(`claimEnterLabel`)에서 부르면, 사용량이 회복된 뒤 사용자가
 * 다시 지시를 넣는 순간 배지가 진행중으로 돌아온다.
 *
 * pinned(훅이 지정한 `limited`)는 건드리지 않는다 — 그 탭은 훅이 풀어 준다
 * (`UserPromptSubmit` → `running`, `claudeHooks.ts` PLAN).
 */
export function releaseLimited (status: WorkStatusService, root: BaseTabComponent): void {
    if (status.get(root).status === 'limited') {
        status.setAuto(root, 'running')
    }
}

/**
 * PTY 출력 한 조각을 보고 탭 상태를 갱신한다.
 *
 * 우선순위: OSC 통보 > 대기 패턴 > 한도 패턴 > "출력이 있다 = 진행중".
 * idle 로의 복귀는 사이드바 타이머(tickIdle)가 담당한다.
 *
 * decorator 와 deck 의 세션 워처 양쪽에서 호출된다 — 같은 조각을 두 번 먹어도
 * 결과가 같도록 상태 설정은 모두 멱등하게 만들어 두었다.
 *
 * @param profile 이 탭에서 도는 에이전트의 프로필. **생략하면 합집합**(`unionProfile()`)이라
 *   0.5.0 까지의 판정과 완전히 같다 — 아직 어떤 에이전트인지 못 알아낸 탭에는 넘기지 않는다.
 */
export function applyOutput (
    status: WorkStatusService,
    root: BaseTabComponent,
    owner: object,
    data: string,
    autoDetect: boolean,
    profile: AgentProfile = unionProfile(),
): void {
    status.debug.outputs++
    status.markOutput(root)

    const buf = (tails.get(owner) ?? '') + data
    let matched = false
    let m: RegExpExecArray | null
    // 이미 처리한 OSC 가 어디까지인지 — 그 뒤만 다음 조각으로 넘긴다
    let consumed = 0
    OSC_RE.lastIndex = 0
    while ((m = OSC_RE.exec(buf)) !== null) {
        consumed = OSC_RE.lastIndex
        const s = m[1].toLowerCase() as WorkStatus
        if (VALID.includes(s)) {
            status.setManual(root, s, m[2])
            status.debug.oscHits++
            matched = true
        }
    }
    // 미완성 OSC 가 남아있을 수 있으므로 꼬리만 보관한다.
    // 단 이미 처리한 부분은 반드시 버린다 — 완결된 OSC 가 짧으면 꼬리 안에 통째로 남고,
    // 그러면 다음 출력마다 같은 시퀀스가 또 매치돼 상태가 그 값에 박혀 버린다
    // (2026-09-01, detect 테스트에서 드러남).
    tails.set(owner, buf.slice(Math.max(consumed, buf.length - 256)))
    if (matched || !autoDetect) {
        return
    }

    if (profile.waitingPatterns.some(re => re.test(data))) {
        // 이유를 함께 남긴다 — 여기까지는 화면 판정으로 waiting 이 된 탭의 배지가 `⏸ 승인대기` 뿐이라
        // 여섯 탭 중 어느 것이 무엇을 기다리는지 사이드바만 보고 정할 수 없었다 (훅이 있는 Claude 탭만
        // `⏸ 승인대기 · Bash 권한` 이었다). 이유의 출처는 걸린 줄 하나뿐이다 (reasonFrom)
        setAutoWithReason(status, root, 'waiting', reasonFrom(data, profile.waitingPatterns))
        return
    }

    // 사용량 한도 — 대기 다음, 작업중보다 앞이다.
    //
    // 왜 작업중보다 앞인가: 한도에 걸린 화면에도 상태줄·힌트가 계속 그려지고, 그 조각이 먼저
    // "진행중" 으로 읽히면 정작 한도 줄이 왔을 때 배지가 이미 진행중이라 사용자는 왜 멈췄는지
    // 알 수 없다. 왜 대기보다 뒤인가: 대기 오탐의 비용이 가장 크다는 원칙(대기 > busy)을
    // 흔들지 않기 위해서다 — 한 조각에 둘이 같이 왔다면 사람이 답할 것이 있는 쪽이 먼저다.
    //
    // 문구는 프로필이 들고 있다(`agents.ts` `limitedPatterns`) — 실측이 없는 에이전트는 비어 있고,
    // 그 프로필의 판정에는 합집합이 쓰이므로 어느 한 곳에서 실측된 문구는 모두가 함께 쓴다.
    if (profile.limitedPatterns.some(re => re.test(data))) {
        setAutoWithReason(status, root, 'limited', reasonFrom(data, profile.limitedPatterns))
        return
    }

    // 승인대기였던 탭에 작업 중 문구가 다시 보이면 사람이 승인한 것이다 — 진행중으로 올린다.
    // 훅은 이 순간을 알려주지 않는다: 승인 뒤 첫 훅(PostToolUse)은 도구가 끝난 뒤라, 2분짜리 빌드를
    // 승인하면 그동안 사이드바가 승인대기에 박혀 있다 (2026-09-07 실측 — "승인했는데 진행중으로 안 돌아온다").
    // 훅이 고정(pinned)한 탭에도 적용해야 하므로 setAuto 가 아니라 resume 을 쓴다.
    // 제목 스피너(busyTitleMarks)는 근거로 삼지 않는다 — 승인 대화상자가 떠 있는 동안에도 제목에 남을 수 있다
    if (status.get(root).status === 'waiting' && profile.busyPatterns.some(re => re.test(data))) {
        status.markBusy(root)
        status.resume(root)
        return
    }

    // 에이전트가 "지금 일하는 중" 이라고 스스로 밝히는 표시를 찾는다
    if (profile.busyTitleMarks.some(mark => data.includes(mark))
        || profile.busyPatterns.some(re => re.test(data))) {
        status.markBusy(root)
        status.setAuto(root, 'running')
        return
    }

    // 그 표시를 내는 탭(에이전트 TUI)이라면, 표시가 없는 출력은 진행중의 근거가 아니다.
    // Claude Code 는 놀고 있을 때도 하단 상태줄을 매초 다시 그리기 때문에, 이 갈래가 없으면
    // 사이드바가 영원히 "진행중" 에 박혀 있게 된다 (2026-09-01 실측 — 세 탭 모두 진행중).
    if (status.isBusyMode(root)) {
        return
    }
    // 한도 도달은 "출력이 있다 = 진행중" 으로 풀리지 않는다.
    //
    // 한도에 걸린 CLI 도 하단 상태줄을 계속 다시 그린다. 그런데 작업중 문구를 한 번도 못 본
    // 탭(busyMode 가 아닌 탭 — codex 가 그렇다. 작업중 문구가 미관측이라 그 신호를 잡을 수 없다)은
    // 바로 아래 갈래에서 그 재그리기 한 조각에 진행중으로 올라가 버린다. 그러면 배지가 한 조각만
    // ⛔ 였다가 사라져 이 판정이 아무 쓸모가 없다.
    //
    // **풀리는 길은 열어 둔다** (실패에 영구 lock 을 걸지 않는다):
    //   ① 작업중 문구·스피너가 다시 보이면 위 갈래가 running 으로 올린다 (사용량이 회복돼 실제로 도는 경우)
    //   ② 사용자가 새 프롬프트를 Enter 로 보내면 `releaseLimited` (deck.service 의 claimEnterLabel 배선)
    //   ③ 훅이 있는 CLI 는 다음 훅(`UserPromptSubmit` → running)이 덮는다
    //   ④ 사이드바에서 상태를 직접 고르거나 고정을 푸는 것(setManual/unpin)
    if (status.get(root).status === 'limited') {
        return
    }
    // 신호를 낼 줄 모르는 보통 셸 — 예전처럼 "출력이 있다 = 진행중" 으로 본다
    status.setAuto(root, 'running')
}

export function forgetOutputBuffer (owner: object): void {
    tails.delete(owner)
}

/**
 * 탭 제목에 실려 온 상태 표식 — `[AD:running] 결제 버그 수정` 형태.
 *
 * Windows 에서 이 경로를 쓰는 이유: ConPTY 는 자기가 모르는 OSC 를 삼켜서
 * 커스텀 이스케이프가 PTY 스트림까지 오지 못한다(2026-08-28 실측 — 출력에 남은 건
 * 입력 에코뿐이었다). 반면 콘솔 제목은 ConPTY 가 API 로 변환해 전달하므로 확실히 통과한다.
 */
const TITLE_RE = /\[AD:([a-z]+)\]\s*(.*)$/i

// 작업중 제목 표식(Claude 의 별·원형 스피너 9종)은 `agents.ts` 의 프로필로 옮겼다 —
// 실측 근거("2026-08-28 ◐ WindowTitle 설정")도 값과 함께 그쪽에 있다.

export function stripTitleMarker (title: string): string {
    return title.replace(/\[AD:[a-z]+\]\s*/i, '')
}

/**
 * @param profile 이 탭의 에이전트 프로필. 생략하면 합집합이라 0.5.0 과 같은 판정이다.
 */
export function applyTitle (
    status: WorkStatusService,
    root: BaseTabComponent,
    title: string,
    autoDetect: boolean,
    profile: AgentProfile = unionProfile(),
): void {
    const m = TITLE_RE.exec(title)
    if (m) {
        const s = m[1].toLowerCase() as WorkStatus
        if (VALID.includes(s)) {
            status.setManual(root, s, m[2].trim())
            status.debug.titleHits++
            return
        }
    }
    // 명시 표식이 없으면 에이전트가 제목에 넣는 작업중 표식(스피너)이라도 읽는다
    if (autoDetect && profile.busyTitleMarks.some(mark => title.includes(mark))) {
        status.setAuto(root, 'running')
    }
}
