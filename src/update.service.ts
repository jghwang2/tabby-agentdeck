import { Injectable } from '@angular/core'
import { AppService, ConfigService, NotificationsService, PlatformService } from 'tabby-core'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import * as os from 'os'
import * as path from 'path'

import { diag, diagCatch, pluginVersion } from './diag'
import { AgentDeckReloadService } from './reload.service'
import {
    DEFAULT_INTERVAL_HOURS,
    PACKAGE_NAME,
    UpdateOutcome,
    canSelfUpdate,
    decide,
    installSucceeded,
    latestUrl,
    parseLatestVersion,
    shouldCheck,
} from './update'

/** 레지스트리 응답을 기다리는 시간 — 기동 직후라 오래 붙들면 안 된다 */
const FETCH_TIMEOUT_MS = 6000
/** npm 설치를 기다리는 한도 — 사내망에서 레지스트리가 느릴 수 있어 넉넉히 준다 */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
/** 기동하고 이만큼 뒤에 확인한다 — 창이 뜨는 순간에 네트워크를 건드리지 않는다 */
const STARTUP_DELAY_MS = 8000
/** 응답 본문 상한 — 레지스트리가 아닌 무언가가 답할 때 메모리를 먹지 않게 */
const MAX_BODY_BYTES = 512 * 1024

/**
 * npm 레지스트리를 보고 **Tabby 를 띄운 채로** 새 버전을 깐다.
 *
 * 흐름은 넷이다 —
 *  ① 기동하고 잠시 뒤 레지스트리에 묻는다
 *  ② 새 버전이 있으면 **물어본다** (`지금 업데이트` / `나중에` / `다시 묻지 않기`)
 *  ③ 승낙하면 설치 스크립트를 임시 폴더에서 돌린다 — **Tabby 는 그대로 떠 있다**
 *  ④ 디스크 버전을 확인하고 **창만 새로 고친다**(`reload.service`) — 탭과 세션은 살아남는다
 *
 * **예전에는 닫았다 켰다.** 돌고 있는 플러그인은 자기를 갈아끼울 수 없고(모듈이 이미
 * 메모리에 있다) Windows 가 파일을 잡고 있을까 걱정했기 때문인데, 둘 다 지금은 해결됐다 —
 * 적용은 renderer 리로드가 하고(pty 는 main 이 쥐고 있어 살아남는다), 로드된 `.js` 는
 * 잠기지 않는다(2026-09-14 실측: require 한 파일이 든 폴더를 그대로 지울 수 있었다).
 * 남은 조건은 하나 — **설치 스크립트는 패키지 밖에서 돌려야 한다**(제 발밑을 npm 이 갈아엎는다).
 *
 * **개발 설치에는 설치하지 않는다.** 플러그인 폴더의 `tabby-agentdeck` 은 개발 중에는 소스
 * 트리를 가리키는 링크이고(`plugins/package.json` 에 `file:D:/Project/tabby-agentdeck` 로 적힌다),
 * 거기에 `npm install` 이 돌면 작업 중인 트리를 덮어쓴다. 판정은 `update.ts` 의 `canSelfUpdate`.
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckUpdateService {
    constructor (
        private app: AppService,
        private config: ConfigService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private reloader: AgentDeckReloadService,
    ) { }

    init (): void {
        this.app.ready$.subscribe(() => {
            // 개발/검증용 — deck.service 가 만든 `__agentdeck` 에 붙는다 (없으면 만든다).
            // `run` 은 **설치와 리로드까지 간다**(승낙하면 창이 새로 고쳐진다) — 회귀에서
            // 부를 때는 개발 설치라 `dev-install` 에서 멈추는 것을 전제로 한다
            const g: any = globalThis as any
            g.__agentdeck = g.__agentdeck ?? {}
            g.__agentdeck.update = {
                run: (force = true) => this.run('diag', force),
                // 묻는 단계를 건너뛰고 설치+리로드만 — OS 모달은 CDP 로 못 누르기 때문이다.
                // 회귀(`tools/regress-update.js`) 가 쓴다
                installAndReload: (version: string, spec?: string) =>
                    this.installAndReload(pluginVersion(), version, spec),
                installedVersion: () => this.installedVersion(),
                marks: () => this.installMarks(),
                canSelfUpdate: () => canSelfUpdate(this.installMarks()),
                pluginsDir: () => this.pluginsDir(),
                version: () => pluginVersion(),
            }
            setTimeout(() => { void this.run('startup') }, STARTUP_DELAY_MS)
        })
    }

    /**
     * 한 번 확인하고, 새 버전이면 물어본 뒤 설치를 건다.
     *
     * `force` 는 설정 창의 `지금 확인` 용 — 간격 제한과 `다시 묻지 않기` 를 건너뛴다
     * (사람이 직접 눌렀으니 그 순간만큼은 묻는 게 맞다). 기능 자체를 끈 것은 존중한다.
     */
    async run (reason: string, force = false): Promise<UpdateOutcome> {
        const cfg = this.config.store.agentDeck
        const current = pluginVersion()
        const marks = this.installMarks()
        const devInstall = !canSelfUpdate(marks)

        if (cfg.autoUpdate === false) {
            diag(`update skip=disabled reason=${reason}`)
            return 'disabled'
        }
        if (!force && !shouldCheck(cfg.lastUpdateCheck, Date.now(), Number(cfg.updateCheckIntervalHours) || DEFAULT_INTERVAL_HOURS)) {
            diag(`update skip=too-soon reason=${reason}`)
            return 'too-soon'
        }

        let latest: string | null = null
        try {
            latest = parseLatestVersion(await this.fetch(latestUrl(cfg.updateRegistry)))
        } catch (e: any) {
            // 오프라인·사내망·프록시 — 흔한 일이고 사람에게 알릴 것이 아니다
            diagCatch('update 레지스트리 조회', e)
        }

        // 물어본 것 자체를 기록한다(성공이든 아니든) — 실패할 때마다 기동마다 다시 묻지 않게
        cfg.lastUpdateCheck = Date.now()
        this.config.save()

        const outcome = decide({
            enabled: true,
            lastCheckAt: 0,
            now: Date.now(),
            intervalHours: 0,
            devInstall,
            current,
            latest,
        })
        diag(`update check=${reason} current=${current} latest=${latest ?? '?'} outcome=${outcome}`
            + ` dev=${devInstall} marks=${JSON.stringify(marks)}`)

        if (outcome === 'dev-install') {
            // 개발 중인 사람에게는 알려 줄 값이 있다 — 다만 손대지 않는다
            this.notifications.info(
                `AgentDeck ${latest} 가 나왔다 (지금 ${current})`,
                '개발 설치(소스 링크)라 자동으로 갈아끼우지 않는다. 소스에서 직접 올릴 것.',
            )
            return outcome
        }
        if (outcome !== 'update-ready') {
            return outcome
        }

        // 이 버전은 건너뛰기로 한 적이 있나 — `다시 묻지 않기` 는 **그 버전에만** 건다.
        // 영구히 끄는 것은 설정의 `autoUpdate` 쪽이고, 여기서 영구히 막으면 다음 버전도 못 받는다
        if (!force && cfg.updateSkipVersion === latest) {
            diag(`update skip=asked-not-to version=${latest}`)
            return 'skipped'
        }

        return this.confirmAndInstall(current, latest as string)
    }

    /** ② 물어보고 ③ 제자리에 깐 뒤 ④ 창만 새로 고친다 */
    private async confirmAndInstall (current: string, latest: string): Promise<UpdateOutcome> {
        const r = await this.platform.showMessageBox({
            // Tabby 의 `MessageBoxOptions.type` 은 `warning | error` 둘뿐이다
            // (node_modules/tabby-core/typings/api/platform.d.ts) — electron 의 `question` 은 없다.
            // 둘 중에서는 `warning` 이 낫다: `error` 는 빨간 아이콘이라 "업데이트할까요" 가
            // 사고처럼 읽힌다
            type: 'warning',
            message: `AgentDeck ${latest} 로 업데이트할까요? (지금 ${current})`,
            detail: [
                '누르면 이렇게 됩니다:',
                '  1. 백그라운드에서 새 버전을 내려받아 설치합니다',
                '  2. 창을 한 번 새로 고쳐 새 버전으로 갈아탑니다 (몇 초)',
                '',
                '열린 탭과 돌고 있는 세션은 그대로 유지됩니다 — Tabby 는 닫히지 않습니다.',
            ].join('\n'),
            buttons: ['지금 업데이트', '나중에', '다시 묻지 않기'],
            defaultId: 0,
            cancelId: 1,
        })

        if (r.response === 2) {
            // 이 버전만 건너뛴다 — 다음 버전이 나오면 다시 묻는다
            this.config.store.agentDeck.updateSkipVersion = latest
            this.config.save()
            diag(`update skip-version=${latest}`)
            return 'skipped'
        }
        if (r.response !== 0) {
            return 'postponed'
        }

        return this.installAndReload(current, latest)
    }

    /**
     * ③ 제자리에 깔고 ④ 창을 새로 고친다 — **묻는 단계는 이미 지났다.**
     *
     * 따로 떼어 둔 이유는 회귀 때문이다. `showMessageBox` 는 OS 의 모달이라 CDP 로 누를 수
     * 없어서, 묻기와 한 덩어리면 이 길을 자동으로 한 번도 못 밟아 본다
     * (`tools/regress-update.js` 가 여기를 부른다).
     *
     * `spec` 은 npm 에 건넬 대상을 바꾼다 — **회귀 전용**이다. 기본값(`tabby-agentdeck@<버전>`)은
     * 레지스트리를 보지만, 회귀는 *지금 이 소스로 만든 tgz* 를 깔아야 한다. 이미 배포된 버전을
     * 깔면 그 안에는 이 코드가 없어서, 리로드 뒤 복구를 맡을 쪽이 옛 코드가 된다.
     */
    async installAndReload (current: string, latest: string, spec?: string): Promise<UpdateOutcome> {
        this.notifications.info(`AgentDeck ${latest} 를 설치하는 중…`, '끝나면 창을 한 번 새로 고친다')

        let code: number | null = null
        try {
            code = await this.runUpdater(latest, spec)
        } catch (e: any) {
            diagCatch('update 설치 스크립트 기동', e)
            this.notifications.error(
                '업데이트를 시작하지 못했다',
                `${e?.message ?? e} — 설정 → 플러그인 에서 직접 업데이트할 수 있다.`,
            )
            return 'failed'
        }

        // npm 이 0 으로 끝나도 폴더가 안 바뀌었을 수 있다 — **디스크의 버전**을 보고 판정한다.
        // 옛 버전 그대로인데 리로드하면 "업데이트했다" 며 같은 것이 다시 뜬다
        const onDisk = this.installedVersion()
        if (!installSucceeded(latest, onDisk)) {
            diag(`update install failed exit=${code} onDisk=${onDisk ?? '?'} want=${latest}`)
            this.notifications.error(
                `AgentDeck ${latest} 설치에 실패했다`,
                `지금도 ${onDisk ?? current} 다 — %LOCALAPPDATA%\\tabby-agentdeck\\update.log 에 npm 출력이 남는다.`,
            )
            return 'failed'
        }

        // 여기부터는 디스크가 새 버전이다. 창을 새로 고치면 그것이 뜬다 — 탭·세션은 복구 토큰으로 살린다
        diag(`update installed ${current} -> ${latest}, reloading`)
        let reloading = false
        try {
            // **반환값을 본다.** `reload` 는 예외를 안 내고 `false` 로 알린다 — 예전에는 그것을
            // 삼켜서 아래 `installed` 갈래가 도달 불가능한 코드였고, 리로드가 안 일어났는데도
            // 화면은 "창을 새로 고쳐 갈아탄다" 고 말했다 (2026-09-15 코드리뷰 지적)
            reloading = await this.reloader.reload(`update:${latest}`)
        } catch (e: any) {
            diagCatch('update 리로드', e)
        }
        if (!reloading) {
            // 설치는 됐으니 잃은 것은 없다. 다음 기동에 적용된다고 알려 주고 끝낸다
            diag(`update reload skipped ${latest} — 다음 기동에 적용`)
            this.notifications.info(
                `AgentDeck ${latest} 설치 완료`,
                'Tabby 를 다시 켜면 적용된다 (창을 새로 고치지 못했다).',
            )
            return 'installed'
        }
        return 'installing'
    }

    /**
     * 설치 스크립트를 **패키지 밖에서** 돌리고 끝날 때까지 기다린다.
     *
     * 임시 폴더로 복사하는 이유: 이 스크립트는 곧 npm 이 통째로 갈아엎을 폴더 안에 산다.
     * 제자리에서 돌리면 자기 발밑이 사라진다.
     *
     * `-InPlace` 는 "Tabby 종료를 기다리지도, 다시 띄우지도 말라" 는 뜻이다. 기다릴 이유가
     * 없어졌고(파일이 잠기지 않는다), 다시 띄울 이유도 없다(닫지 않는다).
     */
    private runUpdater (version: string, spec?: string): Promise<number | null> {
        const src = path.join(__dirname, '..', 'updater', 'agentdeck-update.ps1')
        if (!fs.existsSync(src)) {
            throw new Error(`설치 스크립트를 찾지 못했다: ${src}`)
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-up-'))
        const script = path.join(dir, 'agentdeck-update.ps1')
        fs.copyFileSync(src, script)

        const pluginsDir = this.pluginsDir()
        if (!pluginsDir) {
            throw new Error('Tabby 플러그인 폴더를 찾지 못했다')
        }

        const args = [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', script,
            '-Version', version,
            '-PluginsDir', pluginsDir,
            // Electron 에서 `process.execPath` 가 곧 Tabby.exe 다 — 경로를 짐작하지 않는다.
            // `-InPlace` 에서는 쓰이지 않지만, 스크립트가 옛 방식으로도 돌 수 있게 계속 넘긴다
            '-TabbyExe', process.execPath,
            '-InPlace',
        ]
        if (spec) {
            args.push('-Spec', spec)
        }
        const child = spawn('powershell.exe', args, { stdio: 'ignore' })
        diag(`update updater spawned pid=${child.pid} script=${script}`)

        return new Promise((resolve, reject) => {
            const done = setTimeout(() => {
                child.kill()
                reject(new Error('설치가 시간 안에 끝나지 않았다'))
            }, INSTALL_TIMEOUT_MS)
            child.on('error', e => {
                clearTimeout(done)
                reject(e)
            })
            child.on('exit', c => {
                clearTimeout(done)
                diag(`update updater exit=${c}`)
                resolve(c)
            })
        })
    }

    /** 플러그인 폴더에 **실제로 깔려 있는** 버전 — 설치 성공 판정의 근거 */
    private installedVersion (): string | null {
        try {
            const dir = this.pluginsDir()
            if (!dir) {
                return null
            }
            const file = path.join(dir, 'node_modules', PACKAGE_NAME, 'package.json')
            return JSON.parse(fs.readFileSync(file, 'utf8')).version ?? null
        } catch {
            return null
        }
    }

    /** `<Tabby 설정폴더>/plugins` — npm 이 `--prefix` 로 받을 경로 */
    private pluginsDir (): string | null {
        try {
            const configPath = this.platform.getConfigPath?.()
            return configPath ? path.join(path.dirname(configPath), 'plugins') : null
        } catch {
            return null
        }
    }

    /**
     * 이 설치본이 개발 설치인지 가리는 표식.
     *
     * 배포본에는 `dist`·`hooks`·`updater`·`install.ps1` 만 들어간다(`package.json` 의 `files`).
     * `src/`·`webpack.config.js`·`.git` 중 하나라도 있으면 소스 트리이고, 플러그인 폴더의
     * 항목이 링크면 junction 설치다 — 어느 쪽이든 건드리면 안 된다.
     */
    private installMarks (): { hasSrc: boolean, hasGit: boolean, hasWebpackConfig: boolean, isLink: boolean } {
        // `__dirname` 은 `<플러그인>/dist` 다. junction 으로 깔려 있으면 node 가 실경로로 풀어 주므로
        // 이 값 자체가 이미 소스 트리를 가리킨다 — 그래서 아래 파일 표식이 곧바로 걸린다
        const root = path.join(__dirname, '..')
        const has = (rel: string): boolean => {
            try {
                return fs.existsSync(path.join(root, rel))
            } catch {
                return false
            }
        }
        return {
            hasSrc: has('src'),
            hasGit: has('.git'),
            hasWebpackConfig: has('webpack.config.js'),
            isLink: this.pluginEntryIsLink(),
        }
    }

    /** Tabby 플러그인 폴더의 우리 항목이 링크인가 — junction 설치의 가장 직접적인 증거 */
    private pluginEntryIsLink (): boolean {
        try {
            const dir = this.pluginsDir()
            if (!dir) {
                return false
            }
            return fs.lstatSync(path.join(dir, 'node_modules', PACKAGE_NAME)).isSymbolicLink()
        } catch {
            // 경로를 못 찾거나 항목이 없다 — 링크라고 단정하지 않는다(파일 표식이 따로 본다)
            return false
        }
    }

    /** GET 한 번. 리다이렉트는 따라가지 않는다 — 레지스트리 `/latest` 는 200 으로 답한다 */
    private fetch (url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const mod: any = url.startsWith('http://') ? http : https
            const req = mod.get(url, { headers: { accept: 'application/json' } }, (res: any) => {
                if (res.statusCode !== 200) {
                    res.resume()
                    reject(new Error(`HTTP ${res.statusCode}`))
                    return
                }
                let body = ''
                res.setEncoding('utf8')
                res.on('data', (chunk: string) => {
                    body += chunk
                    if (body.length > MAX_BODY_BYTES) {
                        req.destroy(new Error('응답이 너무 크다'))
                    }
                })
                res.on('end', () => resolve(body))
            })
            req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('시간 초과')))
            req.on('error', reject)
        })
    }
}
