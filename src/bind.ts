/**
 * 훅 보고를 어느 탭에 붙일지 고르는 순수 규칙 — Angular/Tabby 에 기대지 않아 단위 테스트가 된다.
 *
 * 왜 PID 인가 — 예전 규칙 "처음 보고할 때의 활성 탭" 은 사용자가 방금 프롬프트를 넣은 탭이
 * 곧 활성 탭이라는 가정인데, 파일 폴링이 400ms 마다 못 묶은 보고를 다시 시도하는 탓에
 * **끝난 세션의 done 이 다음에 열리는 빈 탭을 붙잡았다** (2026-09-02 실측: 작업 중인 탭이
 * "완료" 로, 그 탭의 진짜 세션은 주인이 있다며 거절돼 running 이 버려졌다).
 *
 * 훅은 자기 조상 프로세스 PID 를 함께 보낸다 — claude.exe → 탭 셸 → Tabby.exe 순서다.
 * 탭마다 pty 가 띄운 셸 PID 를 알고 있으면 어느 탭의 보고인지 추측 없이 확정된다.
 */
export type BindMode = 'pid' | 'pid-miss' | 'legacy'

export interface BindPick<T> {
    tab: T | null
    /**
     * pid      — 조상 PID 가 어떤 탭의 셸 PID 와 맞았다 (확정)
     * pid-miss — pids 도 왔고 탭 PID 표도 있는데 맞는 탭이 없다. 활성 탭으로 추측하지 **않는다**
     *            (탭 PID 표가 아직 안 채워진 것일 수 있으니 호출자는 다음 폴링에 다시 본다)
     * legacy   — pids 가 없거나(옛 훅·수동 호출) 탭 PID 를 하나도 모른다. 호출자가 예전 활성 탭 규칙을 쓴다
     */
    mode: BindMode
}

export function pickTabByPids<T> (pids: number[] | undefined, tabPids: Map<T, number[]>): BindPick<T> {
    const wanted = (pids ?? []).filter(n => Number.isInteger(n) && n > 0)
    let anyInfo = false
    for (const list of tabPids.values()) {
        if (list.length) {
            anyInfo = true
            break
        }
    }
    if (!wanted.length || !anyInfo) {
        return { tab: null, mode: 'legacy' }
    }
    const set = new Set(wanted)
    for (const [tab, list] of tabPids) {
        if (list.some(p => set.has(p))) {
            return { tab, mode: 'pid' }
        }
    }
    return { tab: null, mode: 'pid-miss' }
}
