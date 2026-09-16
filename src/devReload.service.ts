import { Injectable } from '@angular/core'
import { AppService, ConfigService, HotkeysService, NotificationsService } from 'tabby-core'
import * as fs from 'fs'
import * as path from 'path'

import { diag, diagCatch } from './diag'
import { AgentDeckReloadService } from './reload.service'

/** webpack 이 쓰기를 끝냈다고 볼 때까지 기다리는 시간 (마지막 변경 이후) */
const WATCH_DEBOUNCE_MS = 1500
/**
 * 개발 빌드에만 들어 있는 표식 — 새 dist 에 이게 없으면 리로드하지 않는다.
 * 배포 빌드(스텁)나 다른 세션이 기능 없이 덮어쓴 dist 로 갈아타면 감시 코드가 없어
 * 그 뒤로 빌드를 해도 아무 일이 없기 때문이다(2026-09-14 실측: 동시 빌드가 기능 없는 dist 로 덮었다).
 * `tools/check-release.js` 는 반대로 배포 빌드에 이게 **없어야** 통과시킨다.
 */
export const DEV_BUILD_MARKER = 'agentdeck-dev-reload'

/**
 * 개발 설치인가 — 배포본에는 `src/`·`webpack.config.js` 가 없다(`package.json` 의 `files`).
 * `__dirname` 은 `<플러그인>/dist` 이고 junction 설치면 node 가 소스 트리 실경로로 풀어 준다.
 */
export function isDevInstall (): boolean {
    try {
        const root = path.join(__dirname, '..')
        return fs.existsSync(path.join(root, 'src')) && fs.existsSync(path.join(root, 'webpack.config.js'))
    } catch {
        return false
    }
}

/** 핫키 선언 — 스텁은 빈 배열을 돌려주므로 핫키 id 문자열이 배포 번들에 남지 않는다 */
export function devHotkeys (): { id: string, name: string }[] {
    return isDevInstall()
        ? [{ id: DEV_BUILD_MARKER, name: 'AgentDeck [개발] 플러그인 리로드 (세션 유지)' }]
        : []
}

/**
 * **개발용 라이브 리로드** — `npm run build` 만 하면 세션을 살린 채 새 플러그인으로 갈아탄다.
 *
 * 리로드 자체(복구 토큰·창 리로드·탭 재부착)는 `reload.service.ts` 가 한다 — 자동 업데이트도
 * 같은 것을 쓰기 때문에 배포본에 실린다. **여기 남은 것은 "언제 부를까" 뿐이다**:
 * `dist/index.js` 감시와 핫키. 그 둘은 개발 설치에서만 존재한다(배포 번들에서는 스텁으로 빠진다).
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckDevReloadService {
    /** 설정 화면이 개발자 옵션을 보일지 가르는 값 — 스텁은 항상 false */
    readonly available = isDevInstall()
    private watcher: fs.FSWatcher | null = null
    private debounce: any = null
    private startMtime = 0

    constructor (
        private app: AppService,
        private config: ConfigService,
        private hotkeys: HotkeysService,
        private notifications: NotificationsService,
        private reloader: AgentDeckReloadService,
    ) { }

    init (): void {
        if (!this.available) {
            return
        }
        const g = window as any
        g.__agentdeck = g.__agentdeck ?? {}
        g.__agentdeck.devReload = () => this.reload('devtools')

        this.hotkeys.hotkey$.subscribe(hotkey => {
            if (hotkey === DEV_BUILD_MARKER && this.enabled()) {
                void this.reload('hotkey')
            }
        })

        // 복구(짐 되살리기)는 `reload.service` 가 켠다 — 개발자 옵션을 꺼도 남은 짐은 살아난다
        this.app.ready$.subscribe(() => this.watch())
    }

    /** 개발자 옵션이 켜져 있나 */
    enabled (): boolean {
        return this.config.store.agentDeck?.devMode !== false
    }

    /** 설정 화면의 `지금 리로드` 버튼과 핫키가 부르는 입구. 실제로 예약됐으면 `true` */
    async reload (reason: string): Promise<boolean> {
        return this.reloader.reload(`dev:${reason}`)
    }

    /** 파일 안에 개발 빌드 표식이 있나 — 400KB 한 번 읽는 값이라 빌드마다 해도 싸다 */
    private isDevBuild (file: string): boolean {
        try {
            return fs.readFileSync(file, 'utf8').includes(DEV_BUILD_MARKER)
        } catch {
            return false
        }
    }

    /** `dist/index.js` 가 바뀌면(= npm run build 완료) 리로드 */
    private watch (): void {
        const file = path.join(__dirname, 'index.js')
        try {
            this.startMtime = fs.statSync(file).mtimeMs
            this.watcher = fs.watch(__dirname, (_event, name) => {
                if (name !== 'index.js') {
                    return
                }
                clearTimeout(this.debounce)
                this.debounce = setTimeout(() => {
                    let mtime = 0
                    try {
                        mtime = fs.statSync(file).mtimeMs
                    } catch {
                        return // 쓰는 중에 잠깐 없어졌다 — 다음 이벤트가 온다
                    }
                    if (mtime <= this.startMtime || !this.enabled()) {
                        return
                    }
                    if (!this.isDevBuild(file)) {
                        diag('dev-reload skip: 새 dist 에 개발 기능이 없다 (배포 빌드 또는 다른 빌드가 덮음)')
                        this.notifications.notice('AgentDeck: 새 dist 가 개발 빌드가 아니라 리로드하지 않았다')
                        return
                    }
                    void this.reload('build')
                }, WATCH_DEBOUNCE_MS)
            })
            diag(`dev-reload watching ${file}`)
        } catch (e: any) {
            diagCatch('dev-reload watch', e)
        }
    }
}
