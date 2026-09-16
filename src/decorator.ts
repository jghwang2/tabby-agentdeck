import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, ConfigService } from 'tabby-core'
import { TerminalDecorator, BaseTerminalTabComponent, BaseSession } from 'tabby-terminal'
import { WorkStatusService } from './status.service'
import { applyOutput, forgetOutputBuffer } from './detect'

/**
 * PTY 출력을 훔쳐보며 탭 상태를 추론한다.
 *
 * Tabby 는 프론트엔드(xterm)가 첫 리사이즈를 보고할 때 decorator 를 붙이므로
 * (tabby-terminal/src/api/baseTerminalTab.component.ts:386) 그 시점을 놓친 탭은
 * 여기로 들어오지 않는다. 그 빈틈은 AgentDeckService 의 세션 워처가 메운다.
 */
@Injectable()
export class AgentDeckDecorator extends TerminalDecorator {
    constructor (
        private status: WorkStatusService,
        private config: ConfigService,
        private app: AppService,
    ) {
        super()
    }

    /**
     * 상태를 기록할 키를 사이드바가 보는 것과 같은 탭으로 맞춘다.
     *
     * Tabby 는 모든 탭을 SplitTabComponent 로 감싸므로 app.tabs 에 들어있는 것은
     * 그 래퍼이고, decorator 가 받는 것은 그 안의 터미널 탭이다. 정규화하지 않으면
     * 상태를 자식에 쓰고 사이드바는 부모를 읽어 영영 매칭되지 않는다.
     * 분할된 pane 여러 개는 하나의 탭 상태를 공유한다.
     */
    private rootOf (tab: BaseTerminalTabComponent<any>): BaseTabComponent {
        return this.app.getParentTab(tab) ?? tab
    }

    attach (tab: BaseTerminalTabComponent<any>): void {
        this.status.debug.attached++
        if (tab.session) {
            this.attachToSession(tab, tab.session)
        }
        this.subscribeUntilDetached(tab, tab.sessionChanged$.subscribe(session => {
            if (session) {
                this.attachToSession(tab, session)
            }
        }))
    }

    detach (tab: BaseTerminalTabComponent<any>): void {
        const root = this.rootOf(tab)
        super.detach(tab)
        forgetOutputBuffer(tab)
        // 분할 pane 중 하나만 닫힌 경우라면 탭 상태는 남겨둔다
        if (root === tab || !this.app.tabs.includes(root)) {
            this.status.forget(root)
        }
    }

    private attachToSession (tab: BaseTerminalTabComponent<any>, session: BaseSession): void {
        this.subscribeUntilDetached(tab, session.output$.subscribe(data => {
            applyOutput(
                this.status,
                this.rootOf(tab),
                tab,
                data,
                this.config.store.agentDeck.autoDetect,
            )
        }))
    }
}
