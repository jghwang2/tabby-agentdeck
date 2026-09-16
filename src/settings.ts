import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { AgentDeckSettingsTabComponent } from './settings.component'

/**
 * 설정 창 왼쪽 목록에 AgentDeck 탭을 끼워 넣는다.
 * `weight` 를 주지 않으면 등록 순서 뒤쪽에 붙는다 — 순정 탭들 아래로 가도록 그대로 둔다.
 */
@Injectable()
export class AgentDeckSettingsTabProvider extends SettingsTabProvider {
    id = 'agentdeck'
    icon = 'layer-group'
    title = 'AgentDeck'

    getComponentType (): any {
        return AgentDeckSettingsTabComponent
    }
}
