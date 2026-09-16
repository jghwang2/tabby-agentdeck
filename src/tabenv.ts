/**
 * 훅 보고를 탭에 직결하는 열쇠 — 탭 셸에 심는 환경변수와 그것으로 탭을 고르는 순수 규칙.
 * Angular/Tabby 에 기대지 않아 단위 테스트가 된다 (test/tabenv.test.js).
 *
 * 왜 환경변수인가 — 0.2.1 의 프로세스 계보(bind.ts)는 훅이 매 세션 `Win32_Process` 전체를
 * 훑어(~450ms) 조상 PID 를 보내고 플러그인이 탭별 셸 PID 와 맞추는 방식이다. 맞기는 하지만
 * 훅이 느리고, 셸 PID 를 pty 에 비동기로 물어야 해서 표가 늦게 채워지는 창이 있다.
 * 플러그인이 탭을 열 때 셸 환경에 `AGENTDECK_TAB=<id>` 를 심어 두면 그 셸에서 뜬 claude 와
 * 그 훅은 환경을 그대로 물려받으므로, 훅은 `$env:AGENTDECK_TAB` 을 읽어 보내기만 하면 되고
 * 플러그인은 표에서 바로 찾는다. 계보 조회가 통째로 빠진다.
 *
 * 계보는 폴백으로 남는다 — 이 버전 이전에 열린 탭, 재시작으로 복원된 탭(셸이 이미 떠 있어
 * 새 값을 심을 수 없다), 사람이 셸 밖에서 부른 훅은 환경변수가 없다.
 */
export const TAB_ENV = 'AGENTDECK_TAB'

/**
 * 탭 하나를 가리키는 짧은 무작위 id — 12 hex 자리(48비트). 같은 Tabby 안에서만 유일하면 되므로
 * 이 길이로 충분하고, 셸 프롬프트나 진단 로그에 찍혀도 거슬리지 않는다.
 * Electron 렌더러와 Node 20 은 `globalThis.crypto.getRandomValues` 를 둘 다 갖고 있다.
 */
export function newTabId (): string {
    const bytes = new Uint8Array(6)
    const c: any = (globalThis as any).crypto
    if (c && typeof c.getRandomValues === 'function') {
        c.getRandomValues(bytes)
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256)
        }
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 훅이 보낸 tabId 를 가진 탭(루트)을 찾는다. 분할 탭은 패널마다 id 가 다르므로 루트 하나에
 * 여러 id 가 달린다. 없으면 null — 추측하지 않는다 (호출자가 계보/폴백으로 넘어간다).
 */
export function pickTabByTabId<T> (tabId: string | undefined, tabIds: Map<T, string[]>): T | null {
    const want = typeof tabId === 'string' ? tabId.trim() : ''
    if (!want) {
        return null
    }
    for (const [tab, ids] of tabIds) {
        if (ids.includes(want)) {
            return tab
        }
    }
    return null
}
