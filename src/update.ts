/**
 * **자동 업데이트의 판단 규칙** — 언제 확인할지, 새 버전인지, 업데이트해도 되는지.
 *
 * 네트워크·fs·타이머는 여기 없다 (`group.ts`·`sessionLedger.ts` 와 같은 이유). 이 파일은
 * "무엇을 근거로 결정하는가" 만 정하고, 실제로 묻고 설치하는 것은 `update.service.ts` 다.
 *
 * ## 적용은 **창만 새로 고쳐서** 한다 (Tabby 를 닫지 않는다)
 *
 * Tabby 는 플러그인을 기동할 때 `dist/index.js` 를 한 번 읽는다. 그래서 예전에는
 * "닫았다가 설치하고 다시 띄운다" 였는데, 그 사이 열린 탭과 돌고 있는 세션이 전부 끊겼다.
 * 지금은 `reload.service.ts` 가 **renderer 만 리로드**하면서 탭을 복구 토큰으로 되살린다 —
 * pty 는 main 프로세스가 쥐고 있어 창이 다시 떠도 살아 있다. 리로드는 디스크를 다시 읽으므로
 * 새로 깔린 코드가 그대로 뜬다.
 *
 * 그래서 설치도 **Tabby 가 떠 있는 채로** 한다. 로드된 `.js` 는 Windows 가 잡고 있지 않으므로
 * (require 는 읽고 바로 닫는다 — 2026-09-14 실측: 요구된 파일이 든 폴더를 그대로 지울 수 있었다)
 * npm 이 플러그인 폴더를 갈아끼워도 돌고 있는 코드는 메모리에 그대로다.
 */

/** npm 레지스트리 기본값. 사내 미러를 쓰는 사람은 설정으로 바꾼다 */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** 이 패키지 이름 — 레지스트리에 물어볼 대상이자 `installPlugin` 에 넘길 이름 */
export const PACKAGE_NAME = 'tabby-agentdeck'

/** 확인 간격 기본값 (시간). 기동마다 묻지 않는다 — 레지스트리에도 사람 네트워크에도 예의가 아니다 */
export const DEFAULT_INTERVAL_HOURS = 6

/**
 * 버전 문자열을 숫자 3개 + 프리릴리스로 가른다.
 * semver 가 아니면 `null` — 그런 값이 오면 비교하지 않고 "모른다" 로 둔다(업데이트를 강행하지 않는다).
 */
export function parseVersion (v: unknown): { nums: number[], pre: string | null } | null {
    if (typeof v !== 'string') {
        return null
    }
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(v)
    if (!m) {
        return null
    }
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }
}

/**
 * semver 비교 — `a < b` 면 -1, 같으면 0, `a > b` 면 1. 못 읽으면 `null`.
 *
 * 프리릴리스는 같은 숫자의 정식판보다 **낮다**(`1.1.0-beta` < `1.1.0`). 프리릴리스끼리는
 * 점으로 끊어 숫자는 수로, 그 외는 문자열로 비교한다 (semver 규칙 그대로).
 */
export function compareVersions (a: unknown, b: unknown): number | null {
    const pa = parseVersion(a)
    const pb = parseVersion(b)
    if (!pa || !pb) {
        return null
    }
    for (let i = 0; i < 3; i++) {
        if (pa.nums[i] !== pb.nums[i]) {
            return pa.nums[i] < pb.nums[i] ? -1 : 1
        }
    }
    if (pa.pre === pb.pre) {
        return 0
    }
    // 한쪽만 프리릴리스면 그쪽이 낮다
    if (pa.pre === null) {
        return 1
    }
    if (pb.pre === null) {
        return -1
    }
    const xa = pa.pre.split('.')
    const xb = pb.pre.split('.')
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
        const ta = xa[i]
        const tb = xb[i]
        if (ta === undefined) {
            return -1
        }
        if (tb === undefined) {
            return 1
        }
        const na = /^\d+$/.test(ta)
        const nb = /^\d+$/.test(tb)
        if (na && nb) {
            if (Number(ta) !== Number(tb)) {
                return Number(ta) < Number(tb) ? -1 : 1
            }
        } else if (ta !== tb) {
            return ta < tb ? -1 : 1
        }
    }
    return 0
}

/** 레지스트리의 것이 지금 것보다 새로운가. 못 읽으면 `false` — 모르면 건드리지 않는다 */
export function isNewer (current: unknown, latest: unknown): boolean {
    return compareVersions(current, latest) === -1
}

/** 레지스트리 응답(JSON 문자열)에서 버전을 꺼낸다 — `<registry>/<pkg>/latest` 의 모양 */
export function parseLatestVersion (body: string): string | null {
    try {
        const v = JSON.parse(body)?.version
        return parseVersion(v) ? String(v).trim() : null
    } catch {
        // HTML 오류 페이지·프록시 응답 — 버전을 모르는 것으로 본다
        return null
    }
}

/** 물어볼 주소. 레지스트리 끝의 `/` 가 있든 없든 같은 주소가 나오게 한다 */
export function latestUrl (registry: string | null | undefined, pkg = PACKAGE_NAME): string {
    const base = (registry || DEFAULT_REGISTRY).replace(/\/+$/, '')
    return `${base}/${encodeURIComponent(pkg)}/latest`
}

/** 지금 확인할 때가 됐나. `lastCheckAt` 이 미래면(시계가 뒤로 갔다) 확인한다 */
export function shouldCheck (lastCheckAt: unknown, now: number, intervalHours: number): boolean {
    const last = Number(lastCheckAt) || 0
    if (last > now) {
        return true
    }
    const interval = Math.max(0, Number(intervalHours) || 0) * 3600000
    return now - last >= interval
}

/**
 * 이 설치본을 자동으로 갈아끼워도 되나.
 *
 * **개발 설치(소스 트리로의 junction)에는 절대 하면 안 된다.** Tabby 플러그인 폴더의
 * `tabby-agentdeck` 은 개발 중에는 `D:\Project\tabby-agentdeck` 을 가리키는 링크이고
 * (`install.ps1`), 거기에 `npm install` 이 돌면 **작업 중인 소스 트리를 덮어쓴다.**
 *
 * 판정은 두 가지를 본다 — 둘 다 배포본에는 없는 것들이다
 * (`package.json` 의 `files` 는 `dist`·`hooks`·`install.ps1` 뿐이다):
 *  - `src/` 나 `webpack.config.js` 가 있다 = 소스 트리
 *  - `.git` 이 있다 = 저장소
 * 하나라도 걸리면 확인만 하고 설치는 하지 않는다.
 */
export function canSelfUpdate (marks: { hasSrc: boolean, hasGit: boolean, hasWebpackConfig: boolean, isLink: boolean }): boolean {
    return !(marks.hasSrc || marks.hasGit || marks.hasWebpackConfig || marks.isLink)
}

/**
 * 설치가 실제로 끝났나 — **디스크의 버전**으로 판정한다.
 *
 * npm 이 0 으로 끝나도 폴더가 옛것 그대로일 수 있다(캐시·권한·프록시). 그 상태로 창을
 * 리로드하면 "업데이트했다" 고 해 놓고 같은 버전이 다시 뜬다. 그래서 갈아끼우기 직전에
 * `<plugins>/node_modules/<pkg>/package.json` 의 버전을 읽어 기대값과 맞춰 본다.
 */
export function installSucceeded (expected: string, onDisk: unknown): boolean {
    return compareVersions(onDisk, expected) === 0
}

export type UpdateOutcome =
    | 'disabled'      // 설정에서 껐다
    | 'too-soon'      // 아직 확인할 때가 아니다
    | 'dev-install'   // 개발 설치 — 확인은 하되 설치하지 않는다
    | 'unknown'       // 레지스트리를 못 읽었다 (오프라인·사내망)
    | 'up-to-date'
    | 'update-ready'  // 새 버전이 있다 — 이제 사람에게 묻는다
    | 'skipped'       // `다시 묻지 않기` — 그 버전만 건너뛴다
    | 'postponed'     // `나중에` — 다음 확인 때 다시 묻는다
    | 'installing'    // 제자리에 깔았다. 곧 창이 새로 고쳐진다 (탭·세션은 유지)
    | 'installed'     // 깔기는 했는데 창을 새로 고치지 못했다 — 재시작하면 적용된다
    | 'failed'        // 설치하지 못했다

/**
 * 확인 결과로 무엇을 할지 — 순수 결정.
 *
 * 설치 성공/실패는 이 함수가 모르므로(`installPlugin` 이 비동기다) 여기서는
 * `update-ready` 직전까지만 정하고, 실제 설치는 서비스가 하고 실패하면 `failed` 로 덮는다.
 */
export function decide (input: {
    enabled: boolean
    lastCheckAt: unknown
    now: number
    intervalHours: number
    devInstall: boolean
    current: string
    latest: string | null
}): UpdateOutcome {
    if (!input.enabled) {
        return 'disabled'
    }
    if (!shouldCheck(input.lastCheckAt, input.now, input.intervalHours)) {
        return 'too-soon'
    }
    if (input.latest === null) {
        return 'unknown'
    }
    if (!isNewer(input.current, input.latest)) {
        return 'up-to-date'
    }
    // 새 버전이 있는데 개발 설치다 — 알려만 주고 손대지 않는다
    return input.devInstall ? 'dev-install' : 'update-ready'
}
