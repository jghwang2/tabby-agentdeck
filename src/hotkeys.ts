import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider } from 'tabby-core'
import { devHotkeys } from './devReload.service'
import { JUMP_SLOTS } from './nav'

/**
 * 핫키 "선언"만 한다.
 *
 * 여기서 HotkeysService 를 주입하면 안 된다 — HotkeysService 자신이
 * HotkeyProvider 목록을 주입받으므로(tabby-core/src/services/hotkeys.service.ts:85)
 * 순환 의존이 되어 부분 초기화된 인스턴스가 넘어온다.
 * 실제 핫키 처리는 AgentDeckService 에서 구독한다.
 */
@Injectable()
export class AgentDeckHotkeyProvider extends HotkeyProvider {
    async provide (): Promise<HotkeyDescription[]> {
        return [
            // 개발 설치에만 생긴다 (배포 빌드는 스텁이라 빈 배열) — 처리는 AgentDeckDevReloadService
            ...devHotkeys(),
            {
                id: 'agentdeck-toggle',
                name: 'AgentDeck 사이드바 / 4:3 전환',
            },
            {
                id: 'agentdeck-newline',
                name: 'AgentDeck 줄바꿈 (Ctrl+Enter / Shift+Enter, 0x0A 전송)',
            },
            {
                id: 'agentdeck-paste',
                name: 'AgentDeck 붙여넣기 (텍스트는 그대로, 이미지는 Alt+V 로 위임)',
            },
            {
                id: 'agentdeck-repair',
                name: 'AgentDeck 화면 복구 (깨진 TUI 다시 그리기)',
            },
            {
                id: 'agentdeck-view',
                name: 'AgentDeck 미리보기 패널 (md · 이미지 · 표)',
            },
            {
                // 처리는 AgentDeckService 의 `hotkey$` 구독에서 `view?.toggleMode()` 로 잇는다
                // (여기서 HotkeysService 를 주입하면 순환 의존 — 위 주석 참고)
                id: 'agentdeck-view-mode',
                name: 'AgentDeck 미리보기 파일 / 변경 전환',
            },
            {
                // 사이드바를 마우스 없이 다루기 위한 **유일한 진입점**이다. 목록은 tabindex=-1 이라
                // 터미널에서 Tab 으로 넘어올 수 없고(에이전트 CLI 가 Tab 을 자기 것으로 쓴다),
                // 검색창 포커스로 갈음할 수도 없다 — 검색 줄은 끌 수 있는 기능이다(`searchBox`).
                // 처리는 AgentDeckService 의 `hotkey$` 구독 → `toggleKeyboardNav()`.
                id: 'agentdeck-focus-list',
                name: 'AgentDeck 사이드바 목록에 포커스 (↑↓ 이동 · Enter 전환 · Esc 복귀)',
            },
            // 사이드바에 **보이는 순서**로 N 번째 세션 (기본 Ctrl+1…Ctrl+9).
            // Tabby 순정 `tab-N` 과는 세는 대상이 다르다 (그쪽은 탭 바 = `app.tabs`).
            // 처리는 AgentDeckService 의 `hotkey$` 구독 → `jumpToRow()`
            ...Array.from({ length: JUMP_SLOTS }, (_, i) => ({
                id: `agentdeck-jump-${i + 1}`,
                name: `AgentDeck ${i + 1}번째 세션으로 (사이드바에 보이는 순서)`,
            })),
        ]
    }
}
