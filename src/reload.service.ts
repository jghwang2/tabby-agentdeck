import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, NotificationsService } from 'tabby-core'

import { diag, diagCatch } from './diag'
import { AgentDeckService } from './deck.service'
import { PerformanceTrace } from './performance'

/**
 * 복구 짐을 두는 localStorage 키.
 *
 * **이 이름과 아래 `Stash` 모양은 버전을 넘어 고정이다.** 짐을 쓰는 것은 옛 버전이고
 * 읽는 것은 **새로 깔린 버전**이기 때문이다(자동 업데이트). 여기서 이름이나 필드를 바꾸면
 * 그 업데이트에서 짐을 못 읽어 **탭이 통째로 사라진다.**
 */
const STASH_KEY = 'agentdeck.reloadStash'
/**
 * 옛 이름 — 리로드가 개발 전용이던 시절의 키. **읽기만 한다.**
 *
 * 이걸 안 봤다가 실제로 탭을 잃었다(2026-09-14 09:59Z 실측): 옛 코드가 이 키로 짐을 쓰고
 * 리로드했는데 새로 뜬 코드가 새 키만 보고 빈손이라, 진단 로그에 `dev-reload go ... tabs=5` 는
 * 있는데 짝이 될 `restored` 줄이 없다. 사용자 눈에는 "리로드가 아니라 재시작" 으로 보였다.
 * 판을 넘길 때 짐을 못 읽으면 그 판에서 **한 번은 탭이 통째로 날아간다** — 그 값이 이 폴백이다.
 */
const LEGACY_STASH_KEY = 'agentdeck.devReload'
/** 이보다 오래된 짐은 버린다 — 지난 실행의 잔재를 엉뚱하게 되살리지 않도록 */
const STASH_TTL_MS = 10 * 60 * 1000
/** 복구한 탭 하나에 세션이 붙기를 기다리는 한도 */
const ATTACH_TIMEOUT_MS = 4000
/** 기동 직후 순정이 멋대로 연 탭(Welcome·autoOpen)을 치우는 시점 */
const STRAY_SWEEP_MS = [300, 1500, 3000]
/**
 * 이 시간 안에 나타난 탭까지만 순정이 연 것으로 본다.
 *
 * 늦게 생기는 순정 탭이 실제로 있어서(`ready$` 구독 순서) 창을 열어 둬야 하는데,
 * 무한정 열어 두면 사람이 연 탭까지 닫는다 (`sweepStrays` 주석). 기동 직후 1.5초면
 * 순정이 열 것은 다 열린다.
 */
const STRAY_GRACE_MS = 1500

interface Stash {
    /** 짐의 판 번호 — 진단용. 토큰 자체는 Tabby 의 형식이라 판이 달라도 읽을 수 있다 */
    v?: number
    at: number
    tokens: any[]
    activeIndex: number
    requestedAt?: number
}

/**
 * **세션을 살린 채 플러그인을 갈아끼운다** — 창(renderer)만 다시 띄우고 pty 는 그대로 둔다.
 *
 * Angular 모듈은 부트스트랩 후 교체할 수 없다(플러그인이 RootModule imports 에 박히고
 * multi-provider 가 고정된다 — app `src/entry.ts`). 그래서 모듈을 바꾸는 대신 **창을
 * 통째로 리로드**한다. pty 는 main 프로세스 `PTYManager` 소유라 renderer 가 새로 떠도 살아 있고,
 * main 은 `ready` 를 `ipcMain.on` 으로 받아 매번 `start` 를 다시 보내므로 정상 부팅된다.
 * 리로드하면 Tabby 가 `dist/index.js` 를 **디스크에서 다시 읽으므로** 새 코드가 뜬다.
 *
 * 탭은 Tabby 의 복구 토큰(`includeState: true` → `restoreFromPTYID` + `savedState`)으로 되살린다.
 * 순정 `saveTabs` 는 `recoverTabs=false` 면 아무것도 안 하므로(사용자 설정) 토큰을 **직접** 만든다.
 * 실측(2026-09-14): 리로드 전후 ptyID·셸 `$PID` 동일, 화면 원문 복원.
 *
 * 쓰는 곳은 둘이다 —
 *  - **자동 업데이트**(`update.service.ts`): 새 버전을 제자리에 깔고 이 리로드로 갈아탄다.
 *    개발자 옵션과 무관하게 돈다.
 *  - **개발용 라이브 리로드**(`devReload.service.ts`): `npm run build` 를 감시해 같은 일을 한다.
 *    이쪽은 개발 설치에서만 존재한다.
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckReloadService {
    private reloading = false

    constructor (
        private app: AppService,
        private notifications: NotificationsService,
        private deck: AgentDeckService,
    ) { }

    init (): void {
        this.app.ready$.subscribe(() => {
            this.restore().catch(e => diagCatch('reload 복구', e))
        })
    }

    /**
     * 복구 토큰을 남기고 창을 리로드한다. **리로드를 실제로 예약했으면 `true`.**
     *
     * 성공/실패를 돌려주는 이유 — 자동 업데이트는 이 값으로 사용자에게 할 말을 가른다
     * ("창을 새로 고쳐 갈아탄다" vs "다시 켜면 적용된다"). 예전처럼 예외를 삼키고 `void` 를
     * 돌려주면 **그 갈림길이 도달 불가능한 코드**가 되어, 리로드가 안 일어났는데도 화면은
     * 갈아탔다고 말한다 (2026-09-15 코드리뷰 지적).
     */
    async reload (reason: string): Promise<boolean> {
        if (this.reloading) {
            return false
        }
        this.reloading = true
        const trace = new PerformanceTrace('reload-save')
        const requestedAt = Date.now()
        try {
            const tr = (this.app as any).tabRecovery
            const tokens: any[] = []
            // 토큰이 없는 탭(Welcome 등)은 빠지므로 활성 탭 순번은 **토큰 배열 기준**으로 잡는다
            let activeIndex = -1
            for (const tab of this.app.tabs) {
                try {
                    const token = await tr.getFullRecoveryToken(tab, { includeState: true })
                    trace.mark('token', `index=${tokens.length}`)
                    if (token) {
                        if (tab === this.app.activeTab) {
                            activeIndex = tokens.length
                        }
                        tokens.push(token)
                    }
                } catch (e: any) {
                    diagCatch('reload 토큰', e)
                }
            }
            const stash: Stash = { v: 1, at: Date.now(), tokens, activeIndex, requestedAt }
            const encoded = trace.step('encode', () => JSON.stringify(stash))
            trace.step('storage', () => window.localStorage.setItem(STASH_KEY, encoded))
            trace.mark('scheduled', `tabs=${tokens.length} chars=${encoded.length}`)

            // 순정 복구가 같이 돌면(recoverTabs=true) 탭이 두 벌 생긴다 — 순정 짐은 비워 두고
            // 리로드 전까지 다시 쓰지 못하게 막는다. 복구가 끝나면 순정이 스스로 다시 저장한다
            tr.enabled = false
            delete window.localStorage.tabsRecovery

            diag(`reload go reason=${reason} tabs=${tokens.length}`)
            setTimeout(() => location.reload(), 50)
            return true
        } catch (e: any) {
            this.reloading = false
            diagCatch('reload', e)
            return false
        }
    }

    /** 리로드 직후 — 짐이 있으면 탭을 되살리고 세션을 하나씩 붙인다 */
    private async restore (): Promise<void> {
        // 옛 키도 본다 — 업데이트 직전 판이 그쪽에 썼을 수 있다(위 `LEGACY_STASH_KEY` 주석)
        const raw = window.localStorage.getItem(STASH_KEY) ?? window.localStorage.getItem(LEGACY_STASH_KEY)
        window.localStorage.removeItem(STASH_KEY)
        window.localStorage.removeItem(LEGACY_STASH_KEY)
        if (!raw) {
            return
        }
        const trace = new PerformanceTrace('reload-restore')
        const stash: Stash = trace.step('decode', () => JSON.parse(raw))
        trace.mark('renderer-ready', `sinceRequestMs=${Date.now() - (stash.requestedAt ?? stash.at)} chars=${raw.length}`)
        if (Date.now() - stash.at > STASH_TTL_MS) {
            diag(`reload stash expired age=${Date.now() - stash.at}`)
            return
        }

        const t0 = Date.now()
        const tr = (this.app as any).tabRecovery
        const recovered: BaseTabComponent[] = []
        // 원래 몇 번째 탭이었는지 — 죽은 탭을 건너뛰면 순번이 밀리므로 따로 쥔다
        const byIndex = new Map<number, BaseTabComponent>()
        let dead = 0
        for (const [index, token] of (stash.tokens ?? []).entries()) {
            // 이미 죽은 pty 를 가리키는 탭은 되살리지 않는다 — 순정은 그때 새 셸을 띄워 버린다
            if (!trace.step('pty-check', () => this.ptysAlive(token))) {
                dead++
                continue
            }
            try {
                const params = await tr.recoverTab(token)
                trace.mark('recover-token', `index=${index}`)
                if (params) {
                    const tab = this.app.openNewTabRaw(params)
                    recovered.push(tab)
                    byIndex.set(index, tab)
                    trace.mark('open-tab', `index=${index}`)
                }
            } catch (e: any) {
                diagCatch('reload recoverTab', e)
            }
        }

        this.sweepStrays(recovered)

        // 복구된 탭은 **화면에 붙어야** 세션이 연결된다(뒤에 깔린 탭은 lazy). 하나씩 보여 준다
        for (const tab of recovered) {
            this.app.selectTab(tab)
            await this.waitAttached(tab)
            trace.mark('attached', `index=${recovered.indexOf(tab)}`)
            // 리로드 공백 동안 나온 출력은 화면에 없다 — TUI 에게 다시 그리게 한다
            await sleep(250)
            trace.mark('settled')
            this.deck.repair('active')
            trace.mark('repair-requested')
        }
        const target = byIndex.get(stash.activeIndex) ?? recovered[recovered.length - 1]
        if (target) {
            this.app.selectTab(target)
        }

        const ms = Date.now() - t0
        diag(`reload restored tabs=${recovered.length} dead=${dead} ms=${ms}`)
        trace.mark('complete', `tabs=${recovered.length} dead=${dead} sinceRequestMs=${Date.now() - (stash.requestedAt ?? stash.at)}`)
        this.notifications.info(`AgentDeck 리로드됨 — 탭 ${recovered.length}개 재부착 (${ms}ms)`)
    }

    /** 토큰 안의 모든 pty 가 main 에 살아 있는가 (분할 탭은 children 을 따라간다) */
    private ptysAlive (token: any): boolean {
        const ids: string[] = []
        const walk = (t: any): void => {
            const id = t?.profile?.options?.restoreFromPTYID
            if (id) {
                ids.push(id)
            }
            for (const c of t?.children ?? []) {
                walk(c)
            }
        }
        walk(token)
        if (!ids.length) {
            // pty 가 없는 탭(설정·미리보기 등)은 그냥 되살린다
            return true
        }
        try {
            const { ipcRenderer } = (window as any).require('electron')
            return ids.some(id => ipcRenderer.sendSync('pty:exists', id))
        } catch {
            return true
        }
    }

    /**
     * 기동하면서 순정이 연 탭(Welcome, autoOpen 새 셸)은 치운다 — 되살린 탭만 남긴다.
     * 순정 탭은 `ready$` 구독 순서에 따라 우리 복구보다 늦게 생길 수도 있어 몇 번 나눠 본다.
     *
     * **사람이 연 탭은 절대 닫지 않는다.** "3초 창이니 사람은 아직 못 열었다" 는 전제는 틀렸다 —
     * 복구 루프는 탭 하나당 최대 4.25초(`ATTACH_TIMEOUT_MS`)를 기다리므로 스윕이 도는 동안
     * 창은 이미 조작 가능한 상태다. 그 사이 사람이 연 탭을 경고 없이 닫았다
     * (2026-09-15 코드리뷰 지적).
     *
     * 그래서 **후보를 시각으로 가른다** — 스윕을 걸 때 이미 있던 탭과, 그 뒤 짧은 유예
     * (`STRAY_GRACE_MS`) 안에 나타난 탭까지만 순정이 연 것으로 본다. 유예가 지난 뒤 처음 보이는
     * 탭은 사람 것이므로 건드리지 않는다.
     */
    private sweepStrays (recovered: BaseTabComponent[]): void {
        const keep = new Set(recovered)
        const armedAt = Date.now()
        // 스윕을 걸 때 이미 있던 탭 = 순정이 연 것 (사람은 아직 아무것도 못 눌렀다)
        const strays = new Set(this.app.tabs.filter(t => !keep.has(t)))
        for (const delay of STRAY_SWEEP_MS) {
            setTimeout(() => {
                const graced = Date.now() - armedAt <= STRAY_GRACE_MS
                for (const tab of [...this.app.tabs]) {
                    if (keep.has(tab)) {
                        continue
                    }
                    // 유예 안에 나타난 것은 아직 순정 몫으로 본다
                    if (graced) {
                        strays.add(tab)
                    } else if (!strays.has(tab)) {
                        diag(`reload keep user tab "${tab.title}" (스윕 유예 뒤에 생겼다)`)
                        continue
                    }
                    diag(`reload close stray ${tab.constructor.name} "${tab.title}"`)
                    this.app.closeTab(tab, false)
                }
            }, delay)
        }
    }

    private async waitAttached (tab: BaseTabComponent): Promise<void> {
        const until = Date.now() + ATTACH_TIMEOUT_MS
        while (Date.now() < until) {
            const anyTab = tab as any
            const panes: any[] = typeof anyTab.getAllTabs === 'function' ? anyTab.getAllTabs() : [tab]
            const terminals = panes.filter(p => 'frontend' in p || 'session' in p)
            if (!terminals.length || terminals.every(p => p.session?.open)) {
                return
            }
            await sleep(100)
        }
        diag(`reload attach timeout "${tab.title}"`)
    }
}

function sleep (ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}
