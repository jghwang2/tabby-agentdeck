import { Injectable } from '@angular/core'
import { Subject, Observable } from 'rxjs'
import { BaseTabComponent } from 'tabby-core'
import { TabState, WorkStatus } from './api'

/**
 * 부연(reason)을 들고 있을 수 있는 상태. 나머지 상태로 바뀌면 무조건 비운다 —
 * 끝난 뒤에도 "Bash 권한" 이 남아 있으면 지금 승인을 기다리는 것처럼 읽히기 때문이다
 */
const REASON_STATUSES: readonly WorkStatus[] = ['waiting', 'limited', 'error']

/**
 * 훅 고정(`pinned`)에 **유예 시계가 붙는 상태** (`tickIdle` 의 `staleAfterMs`).
 *
 * `waiting`·`limited` 가 빠진 것은 실수가 아니다 — 그 둘은 **조용한 것이 정상**이다. 사람이
 * 승인을 안 했거나 한도가 안 풀린 것이고, 시간이 지났다고 고정을 풀면 화면 재그리기 한 조각에
 * `진행중` 으로 덮여 **사용자가 답해야 할 탭이 목록에서 사라진다**. `idle` 은 이미 바닥이라
 * 풀 것이 없다
 */
const STALE_STATUSES: readonly WorkStatus[] = ['running', 'done', 'error']

/**
 * 탭별 작업 상태 보관소.
 * 상태의 출처는 3가지 — 자동 감지(decorator), OSC 시퀀스(Claude Code 훅), 사이드바에서의 수동 지정.
 * pinned 가 true 면 자동 감지가 값을 덮어쓰지 않는다.
 */
@Injectable({ providedIn: 'root' })
export class WorkStatusService {
    private states = new Map<BaseTabComponent, TabState>()
    private changed = new Subject<void>()

    /** 진단용 카운터 — decorator 가 실제로 붙었는지, 출력이 흘러오는지 확인한다 */
    debug = {
        attached: 0,
        outputs: 0,
        oscHits: 0,
        titleHits: 0,
    }

    get changed$ (): Observable<void> { return this.changed }

    get (tab: BaseTabComponent): TabState {
        let s = this.states.get(tab)
        if (!s) {
            s = {
                status: 'idle', label: '', reason: '', since: Date.now(), pinned: false,
                lastOutput: 0, busyMode: false, lastBusy: 0,
            }
            this.states.set(tab, s)
        }
        return s
    }

    /** 자동 감지용 — pinned 상태는 건드리지 않는다 */
    setAuto (tab: BaseTabComponent, status: WorkStatus): void {
        const s = this.get(tab)
        if (s.pinned || s.status === status) {
            return
        }
        s.status = status
        s.since = Date.now()
        this.clearReasonUnlessWaiting(s)
        this.changed.next()
    }

    /**
     * 수동/훅 지정 — 이후 자동 감지보다 우선한다.
     * `reason` 은 상태의 부연(승인 이유 / 한도 리셋 시각 / 오류 코드) — REASON_STATUSES 일 때만 담는다
     */
    setManual (tab: BaseTabComponent, status: WorkStatus, label?: string, reason?: string): void {
        const s = this.get(tab)
        s.status = status
        s.since = Date.now()
        s.pinned = true
        if (label !== undefined) {
            s.label = label
        }
        s.reason = REASON_STATUSES.includes(status) ? (reason ?? '') : ''
        this.changed.next()
    }

    /**
     * 승인대기 → 진행중. 사람이 승인한 순간을 훅은 알려주지 않는다 — 다음 훅(PostToolUse)은
     * 도구가 **끝난 뒤**라 긴 빌드 동안 사이드바가 승인대기에 박혀 있다. 그래서 화면에 "esc to interrupt"
     * 같은 작업 중 표시가 다시 보이면 여기로 올린다 (detect.ts). pinned·label 은 그대로 둔다 —
     * 훅이 고정한 탭도 이 전이만은 허용해야 하기 때문이다. waiting 이 아니면 아무것도 하지 않는다
     */
    resume (tab: BaseTabComponent): void {
        const s = this.get(tab)
        if (s.status !== 'waiting') {
            return
        }
        s.status = 'running'
        s.since = Date.now()
        s.reason = ''
        this.changed.next()
    }

    setLabel (tab: BaseTabComponent, label: string): void {
        this.get(tab).label = label
        this.changed.next()
    }

    /** 수동 고정을 풀고 자동 감지로 되돌린다 */
    unpin (tab: BaseTabComponent): void {
        const s = this.get(tab)
        s.pinned = false
        s.status = 'idle'
        s.since = Date.now()
        this.clearReasonUnlessWaiting(s)
        this.changed.next()
    }

    /** 부연을 가질 수 없는 상태에는 이유가 남아 있을 수 없다 */
    private clearReasonUnlessWaiting (s: TabState): void {
        if (!REASON_STATUSES.includes(s.status)) {
            s.reason = ''
        }
    }

    markOutput (tab: BaseTabComponent): void {
        this.get(tab).lastOutput = Date.now()
    }

    /**
     * 에이전트가 "작업 중" 이라고 스스로 밝힌 순간 — 스피너나 "esc to interrupt" 같은 표시.
     *
     * 이 신호를 한 번이라도 본 탭은 그 뒤로 신호만 보고 판단한다(busyMode).
     * 상태줄을 매초 다시 그리는 TUI 를 "계속 일하는 중" 으로 오해하지 않기 위해서다.
     */
    markBusy (tab: BaseTabComponent): void {
        const s = this.get(tab)
        s.busyMode = true
        s.lastBusy = Date.now()
    }

    /** 이 탭을 에이전트 TUI 로 볼지 — 아니면 예전처럼 출력 유무로 판단한다 */
    isBusyMode (tab: BaseTabComponent): boolean {
        return this.get(tab).busyMode
    }

    forget (tab: BaseTabComponent): void {
        this.states.delete(tab)
        this.changed.next()
    }

    /**
     * 살아있는 탭만 남긴다 — **닫힌 탭이 `states` 에 쌓이는 것을 막는 유일한 경로다.**
     *
     * `states` 는 WeakMap 이 아니라 Map 이라(틱마다 전 탭을 훑어야 해서 열거가 필요하다)
     * 참조를 우리가 직접 지워야 한다. 지우는 곳은 원래 `decorator.detach` 하나뿐이었는데,
     * 거기 조건이 `root === tab || !app.tabs.includes(root)` 라서 **닫히는 순서에 걸린다** —
     * 분할 탭(`SplitTabComponent`)의 자식 터미널이 detach 될 때 부모가 아직 `app.tabs` 에
     * 남아 있으면 그냥 지나가고, 그 뒤 부모가 사라지면 아무도 지우지 않는다.
     * 2026-09-09 실측(PF9): 탭 11개를 닫았는데 `states` 가 37→37 로 그대로였다.
     *
     * 그래서 탭 목록이 바뀔 때마다 여기서 한 번 훑는다. 비용은 Map 크기만큼의 `includes` 이고,
     * 탭 목록 변화는 사람이 만드는 빈도(초당 몇 번이 최대)라 문제가 되지 않는다.
     */
    sweep (alive: readonly BaseTabComponent[]): number {
        let removed = 0
        for (const tab of [...this.states.keys()]) {
            if (!alive.includes(tab)) {
                this.states.delete(tab)
                removed++
            }
        }
        if (removed > 0) {
            this.changed.next()
        }
        return removed
    }

    /**
     * 사이드바가 매 틱 호출 — idle 전환만 담당하고 화면 갱신 필요 여부를 돌려준다.
     *
     * `staleAfterMs` 는 **고정(pinned)된 진행중 탭의 유예 시간**이다. 0 이면 예전과 같다.
     *
     * 왜 필요한가 — 훅에는 "세션이 끝났다" 가 없다. 설치하는 이벤트는 `UserPromptSubmit`
     * `PostToolUse` `Notification` `Stop` 뿐이라(`claudeHooks.ts` PLAN), 세션이 정상 종료
     * 밖으로 사라지면(Ctrl+C 로 끊음 · 창을 닫음 · CLI 크래시 · Tabby 가 탭을 복원했는데 그
     * 세션은 이미 죽음) **마지막으로 온 `running` 이 영원히 남는다.** `setManual` 이 pinned 를
     * 세우고 여기서 pinned 를 그냥 건너뛰었으므로, 그 탭에는 배지가 내려올 길이 한 개도 없었다
     * (`setAuto` 는 pinned 를 무시하고 `resume` 은 waiting 전용이며 `unpin` 은 사람이 메뉴에서
     * 고르는 것뿐이다). 사이드바에 "작업중" 이 박혀 있는 탭이 실은 아무것도 안 하고 있는 모양이
     * 이 구멍이다.
     *
     * **살아 있다는 증거는 셋 다 인정한다** — 훅 보고(`since` 는 `setManual` 이 매 보고마다
     * 새로 찍는다) · PTY 출력(`lastOutput`) · 작업중 신호(`lastBusy`). 셋 중 가장 최근 것에서
     * 잰다. 그래서 오래 도는 빌드처럼 화면이 조용해 보이는 작업도, 스피너든 훅이든 하나만
     * 살아 있으면 내려가지 않는다.
     *
     * **대상은 `running`·`done`·`error` 뿐이다**(`STALE_STATUSES`). 푸는 것은 **고정**이고,
     * `진행중` 일 때만 이어서 `idle` 로 내린다 — 기척이 끊긴 진행중은 거짓말이지만, `완료`·`오류`
     * 는 실제로 있었던 일이라 글자를 지울 이유가 없다. 그 둘에서 필요한 것은 **다음 출력이
     * 배지를 되살릴 수 있게 하는 것**뿐이다: CLI 를 끄고 같은 탭에서 셸을 쓰면 `setAuto` 가
     * 계속 들어오는데 pinned 라 전부 무시돼 배지가 `완료` 에 박혀 있었다.
     *
     * 고정을 반드시 푸는 이유도 같다. idle 로만 내리고 pinned 를 남기면 그 탭은 이어지는
     * 자동 감지를 계속 무시한다 — 구멍을 반만 막는 셈이다. 다음 훅 보고가 오면 `setManual`
     * 이 다시 고정한다.
     */
    tickIdle (tab: BaseTabComponent, idleAfterMs: number, staleAfterMs = 0): boolean {
        const s = this.get(tab)
        if (s.pinned) {
            if (!STALE_STATUSES.includes(s.status) || !(staleAfterMs > 0)) {
                return false
            }
            const alive = Math.max(s.since || 0, s.lastOutput || 0, s.lastBusy || 0)
            if (!alive || Date.now() - alive <= staleAfterMs) {
                return false
            }
            // **고정은 만료된다.** `완료`·`오류` 는 글자를 그대로 두고 고정만 푼다 — 그 값은
            // 실제로 있었던 일이라 지울 이유가 없고, 지금 필요한 것은 **다음 출력이 배지를
            // 되살릴 수 있게 하는 것**뿐이다(CLI 를 끄고 셸로 돌아온 탭이 `완료` 에 박혀 있던 자리).
            // `진행중` 만 idle 로 내린다 — 기척이 끊긴 진행중은 거짓말이기 때문이다
            s.pinned = false
            if (s.status === 'running') {
                s.status = 'idle'
                s.since = Date.now()
                this.clearReasonUnlessWaiting(s)
            }
            return true
        }
        if (s.status !== 'running') {
            return false
        }
        // 에이전트 탭은 "작업 중" 신호가 끊긴 시점부터 잰다.
        // 일반 셸은 예전대로 출력이 끊긴 시점부터 잰다 (신호를 낼 줄 모르므로)
        const from = s.busyMode ? s.lastBusy : s.lastOutput
        if (from && Date.now() - from > idleAfterMs) {
            s.status = 'idle'
            s.since = Date.now()
            this.clearReasonUnlessWaiting(s)
            return true
        }
        return false
    }
}
