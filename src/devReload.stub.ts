import { Injectable } from '@angular/core'

/**
 * npm 배포 빌드용 빈 껍데기 — `devReload.service.ts` 대신 끼워진다(webpack `--env release`).
 *
 * 개발용 라이브 리로드는 GitHub 소스에는 있지만 배포 번들에는 **코드째로 없어야** 한다.
 * import 하는 쪽(index.ts·hotkeys.ts·settings.component.ts)은 그대로 두고 모듈만 바꾸므로
 * 공개하는 이름과 모양은 원본과 같게 맞춘다. 원본의 문자열 표식이 여기 들어오면
 * `tools/check-release.js` 가 배포를 막는다 — 이 파일에 그 문자열을 쓰지 말 것.
 */
export function isDevInstall (): boolean {
    return false
}

export function devHotkeys (): { id: string, name: string }[] {
    return []
}

@Injectable({ providedIn: 'root' })
export class AgentDeckDevReloadService {
    readonly available = false

    init (): void { }

    enabled (): boolean {
        return false
    }

    async reload (_reason: string): Promise<void> { }
}
