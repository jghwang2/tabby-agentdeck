import { Injectable } from '@angular/core'
import { AppService, ConfigService } from 'tabby-core'

/**
 * "기동 시 탭 복원 끄기" — Tabby 의 `recoverTabs` 를 강제로 false 에 묶는다.
 *
 * 왜 따로 있나: Tabby 는 종료 때 열려 있던 탭을 `localStorage.tabsRecovery` 에 저장하고
 * 다음 기동에서 `config.store.recoverTabs` 가 참이면 되살린다(tabby-core/dist/index.js:5003).
 * 그런데 복원되는 것은 **셸만**이다 — 그 안에서 돌던 Claude Code 세션은 이미 죽어 있어
 * 되살아난 탭은 빈 프롬프트일 뿐이고, 사이드바에는 주인 없는 탭이 줄줄이 남는다.
 * 그래서 사용자가 고르면 "무조건 빈 상태로 시작" 을 보장한다.
 *
 * 두 상태만 있다:
 *  - `agentDeck.noTabRecovery = false` : 순정. Tabby 의 `recoverTabs` 값을 건드리지 않는다.
 *  - `agentDeck.noTabRecovery = true`  : 무조건 끔. Tabby 설정 창에서 `recoverTabs` 를 다시 켜도
 *    기동 때와 설정이 바뀔 때마다 false 로 되돌린다(`enforce`).
 *
 * 기동 분기(5003)는 `config.ready$` 직후라 플러그인보다 먼저 지나간다 — 그래서 값은 토글 순간에
 * config.yaml 에 써 두고, 여기서는 그 뒤로 누가 뒤집어 놓는 경우만 막는다.
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckRecoveryService {
    constructor (
        private app: AppService,
        private config: ConfigService,
    ) { }

    init (): void {
        this.app.ready$.subscribe(() => this.enforce())
        this.config.changed$.subscribe(() => this.enforce())
    }

    /**
     * 토글 진입점. 켜면 `recoverTabs=false` + 이미 저장된 복원 목록도 지운다 —
     * 남겨 두면 나중에 순정으로 되돌렸을 때 그때의 낡은 탭들이 되살아난다.
     * 끄면 Tabby 기본값(true)으로 되돌린다.
     */
    setNoTabRecovery (on: boolean): void {
        this.config.store.agentDeck.noTabRecovery = on
        this.config.store.recoverTabs = !on
        if (on) {
            try {
                delete window.localStorage.tabsRecovery
            } catch { /* 격리/비브라우저 환경 — 없으면 지울 것도 없다 */ }
        }
        this.config.save()
    }

    /** noTabRecovery 가 켜져 있는데 recoverTabs 가 참으로 돌아와 있으면 다시 끈다. 필요할 때만 저장한다 */
    private enforce (): void {
        if (!this.config.store.agentDeck?.noTabRecovery || this.config.store.recoverTabs === false) {
            return
        }
        this.config.store.recoverTabs = false
        this.config.save()
    }
}
