/**
 * 사이드바에 표시되는 작업 상태.
 *
 * `limited`(한도 도달)는 에이전트가 사용량 한도에 걸려 턴이 끊긴 상태다 — Claude Code 의
 * `StopFailure` 훅이 `error: rate_limit` 로 알려준다. 사람이 승인할 것은 없고 리셋 시각까지 기다려야
 * 하므로 승인대기와는 구분해서 보여준다 (2026-09-07 요청).
 */
export type WorkStatus = 'idle' | 'running' | 'waiting' | 'limited' | 'done' | 'error'

export interface StatusStyle {
    icon: string
    label: string
    color: string
}

/** 상태별 표시 규칙 — 사이드바 배지와 좌측 컬러바에 함께 쓰인다 */
export const STATUS_STYLES: Record<WorkStatus, StatusStyle> = {
    running: { icon: '●', label: '진행중', color: '#e5c07b' },
    waiting: { icon: '⏸', label: '승인대기', color: '#61afef' },
    limited: { icon: '⛔', label: '한도 도달', color: '#c678dd' },
    done:    { icon: '✔', label: '완료', color: '#98c379' },
    error:   { icon: '✖', label: '오류', color: '#e06c75' },
    idle:    { icon: '○', label: '대기', color: '#6b727d' },
}

export interface TabState {
    /** 현재 상태 */
    status: WorkStatus
    /** 작업 이름 (사용자 지정 또는 훅이 보낸 값) */
    label: string
    /**
     * 상태의 부연 — 훅이 보낸 문구를 줄인 것.
     *  - waiting: 승인 이유 (예: `Bash 권한`, `입력 대기`) → 배지 `⏸ 승인대기 · Bash 권한`
     *  - limited: 리셋 시각 (예: `12pm 리셋`) → 배지 `⛔ 한도 도달 · 12pm 리셋`
     *  - error:   StopFailure 의 error 코드 (예: `overloaded`)
     * 그 밖의 상태로 바뀌면 비운다 (status.service REASON_STATUSES)
     */
    reason: string
    /** 상태가 마지막으로 바뀐 시각 */
    since: number
    /** true = 수동/훅 지정. 자동 감지가 덮어쓰지 않는다 */
    pinned: boolean
    /** 마지막 PTY 출력 시각 */
    lastOutput: number
    /**
     * 이 탭에서 에이전트의 "작업 중" 신호를 본 적이 있나.
     *
     * 본 적이 있으면 그 탭은 에이전트 TUI 로 보고, 그 뒤로는 신호가 있을 때만 진행중으로 친다.
     * Claude Code 는 놀고 있을 때도 하단 상태줄을 매초 다시 그리기 때문에
     * "출력이 있다 = 진행중" 으로 보면 영원히 진행중에서 내려오지 않는다 (2026-09-01 실측).
     */
    busyMode: boolean
    /** 마지막으로 "작업 중" 신호를 본 시각 — 진행중에서 내려올 시점을 이걸로 잰다 */
    lastBusy: number
}
