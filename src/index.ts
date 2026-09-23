import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { AppService, ConfigProvider, ConfigService, HotkeyProvider } from 'tabby-core'
import { configureStoragePaths } from './storagePaths'
import { SettingsTabProvider } from 'tabby-settings'
import { TerminalDecorator } from 'tabby-terminal'

import { AgentDeckConfigProvider } from './config'
import { AgentDeckHotkeyProvider } from './hotkeys'
import { AgentDeckDecorator } from './decorator'
import { AgentDeckService } from './deck.service'
import { AgentDeckProfileService } from './profile.service'
import { WorkNotifyService } from './notify.service'
import { AgentDeckAlertService } from './alert.service'
import { AgentDeckRecoveryService } from './recovery.service'
import { AgentDeckUpdateService } from './update.service'
import { AgentDeckReloadService } from './reload.service'
import { AgentDeckDevReloadService } from './devReload.service'
import { AgentDeckSettingsTabProvider } from './settings'
import { AgentDeckSettingsTabComponent } from './settings.component'

import './styles.scss'

export * from './api'

@NgModule({
    imports: [
        CommonModule,
        // 설정 탭이 [(ngModel)] 로 config.store 를 직접 물고 있어서 필요하다
        FormsModule,
        TabbyCoreModule,
    ],
    providers: [
        { provide: ConfigProvider, useClass: AgentDeckConfigProvider, multi: true },
        { provide: HotkeyProvider, useClass: AgentDeckHotkeyProvider, multi: true },
        { provide: TerminalDecorator, useClass: AgentDeckDecorator, multi: true },
        { provide: SettingsTabProvider, useClass: AgentDeckSettingsTabProvider, multi: true },
    ],
    declarations: [
        AgentDeckSettingsTabComponent,
    ],
})
export default class AgentDeckModule {
    constructor (
        deck: AgentDeckService,
        profiles: AgentDeckProfileService,
        notify: WorkNotifyService,
        alert: AgentDeckAlertService,
        recovery: AgentDeckRecoveryService,
        update: AgentDeckUpdateService,
        reload: AgentDeckReloadService,
        devReload: AgentDeckDevReloadService,
        config: ConfigService,
        app: AppService,
    ) {
        app.ready$.subscribe(() => {
            configureStoragePaths(config.store.agentDeck)
            notify.configureStorageRoots()
        })
        // 서비스 모두 app.ready$ 를 기다렸다가 스스로 붙는다.
        // alert 는 deck 이 만드는 `__agentdeck` 에 붙으므로 deck 뒤에 둔다
        deck.init()
        profiles.init()
        notify.init()
        alert.init()
        recovery.init()
        // 리로드 짐 되살리기 — 업데이트/개발 리로드 **둘 다** 이 길로 돌아온다.
        // update 보다 먼저 켠다: 짐이 있으면 탭부터 살려 놓고 그 뒤에 네트워크를 본다
        reload.init()
        // 자동 업데이트는 기동 8초 뒤에 한 번 움직인다 — 창이 뜨는 순간에 네트워크를 건드리지 않는다
        update.init()
        // 개발 설치에서만 켜진다 — dist 가 바뀌면 세션을 살린 채 창을 리로드한다
        devReload.init()
    }
}
