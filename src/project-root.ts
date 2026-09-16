/**
 * cwd 가 속한 **프로젝트 루트**를 찾는다 — 사이드바 그룹 경계의 유일한 출처.
 *
 * 예전에는 사람이 설정(`groupRoot`)에 상위 폴더를 적어 두고 "그 직하 한 단계" 를 그룹으로
 * 삼았다. 그 규칙은 프로젝트들이 한 폴더에 나란히 있을 때만 맞고, `D:/Project/demo/app` 과
 * `D:/Project/tabby-agentdeck` 처럼 깊이가 다르면 어떤 값을 적어도 한쪽이 틀린다.
 * 그래서 설정을 없애고 **저장소 루트를 직접 찾는다** — 사람이 프로젝트라고 부르는 경계는
 * 사실상 버전관리의 경계이기 때문이다.
 *
 * 두 가지를 지킨다 —
 *  1. **렌더 중에 디스크를 훑지 않는다.** 조회는 캐시를 보고 즉시 돌아오고(`projectRootOf`),
 *     처음 보는 폴더는 백그라운드로 찾은 뒤 `onResolved` 로 다시 그리게 한다. cwd 는 탭이
 *     사는 동안 안 바뀌므로(group.ts 주석) 탭당 한 번이면 끝난다.
 *  2. **판정 규칙은 순수 함수로 둔다**(`walkUp`/`findProjectRoot`) — fs 없이 단위 테스트한다.
 *
 * 캐시는 프로세스 수명 동안 유지된다. 세션 도중 `git init` 을 한 폴더는 다음 기동에 잡힌다 —
 * 그걸 따라가려면 폴더를 계속 다시 물어야 하는데, 얻는 것에 비해 비용이 크다.
 */

import * as fs from 'fs'
import * as os from 'os'
import { foldGroupKey, normalizeCwd, parentPath } from './group'

/**
 * 프로젝트 루트임을 알리는 표식. 위로 올라가며 **가장 먼저** 만나는 것이 루트다
 * (중첩 저장소·서브모듈에서는 가까운 쪽이 그 탭의 프로젝트다).
 *
 * `.git` 은 폴더가 아닐 수도 있다 — worktree·서브모듈에서는 파일이다. 그래서 존재만 본다.
 * `package.json` 류는 넣지 않았다: 모노레포·하위 패키지마다 있어서 프로젝트를 잘게 쪼갠다.
 */
export const PROJECT_MARKERS = ['.git', '.hg', '.svn', '.p4config'] as const

/** 위로 올라가는 최대 단계 — 경로가 이상하게 길어도 여기서 멈춘다 */
const MAX_UP = 64

/**
 * **홈 디렉토리는 프로젝트가 아니다 — 거기서 멈춘다.**
 *
 * dotfiles 를 git 으로 관리하면 `~/.git` 이 있고(이 PC 가 그렇다), 그러면 홈 아래에서 띄운
 * 모든 탭 — `%LOCALAPPDATA%` 임시 폴더까지 — 이 `junggon` 이라는 한 그룹으로 빨려 들어간다.
 * 2026-09-11 실측: 한글 경로 검증용으로 연 탭이 그 폴더 대신 홈 그룹에 들어갔다.
 * 홈 위(`C:/Users`, `C:/`)도 같은 이유로 볼 필요가 없다.
 */
export function homeBoundary (): string | null {
    try {
        return normalizeCwd(os.homedir())
    } catch {
        return null
    }
}

/**
 * cwd 자신부터 루트까지 — `['D:/a/b', 'D:/a', 'D:/']`.
 *
 * `stopAt`(보통 홈)에 닿으면 **그 폴더를 빼고** 멈춘다 — 거기 있는 마커는 프로젝트 경계가 아니다.
 */
export function walkUp (cwd: string | null | undefined, stopAt?: string | null): string[] {
    let dir = normalizeCwd(cwd)
    const stop = normalizeCwd(stopAt)
    const out: string[] = []
    for (let i = 0; dir && i < MAX_UP; i++) {
        if (stop && foldGroupKey(dir) === foldGroupKey(stop)) {
            break
        }
        out.push(dir)
        const up = parentPath(dir)
        if (!up || foldGroupKey(up) === foldGroupKey(dir)) {
            break
        }
        dir = up
    }
    return out
}

/**
 * 표식을 가진 가장 가까운 조상 — 없으면 null(그때는 cwd 자체가 그룹이다).
 *
 * `hasMarker` 를 주입받는 이유는 테스트 때문만이 아니다 — 실제 조회는 비동기라
 * (`detect`) 이 함수는 "어느 순서로 무엇을 묻는가" 만 정하고 묻는 방법은 모른다.
 */
export function findProjectRoot (
    cwd: string | null | undefined,
    hasMarker: (dir: string) => boolean,
    stopAt?: string | null,
): string | null {
    for (const dir of walkUp(cwd, stopAt)) {
        if (hasMarker(dir)) {
            return dir
        }
    }
    return null
}

/** 폴딩한 cwd → 루트(없으면 null). `undefined` 는 "아직 안 찾아봤다" 와 구별하려고 안 넣는다 */
const cache = new Map<string, string | null>()
/** 지금 찾고 있는 폴더 — 같은 cwd 로 탭이 여럿이어도 한 번만 훑는다 */
const pending = new Set<string>()

/** 마커 하나가 있나 — 접근 실패(권한·끊긴 네트워크)는 "없다" 로 본다 */
async function hasMarkerAsync (dir: string): Promise<boolean> {
    for (const marker of PROJECT_MARKERS) {
        try {
            await fs.promises.access(dir + '/' + marker)
            return true
        } catch {
            // 다음 마커로
        }
    }
    return false
}

async function detect (cwd: string): Promise<string | null> {
    for (const dir of walkUp(cwd, homeBoundary())) {
        if (await hasMarkerAsync(dir)) {
            return dir
        }
    }
    return null
}

/**
 * 그룹 키 계산용 조회 — **절대 막히지 않는다.**
 *
 * 캐시에 있으면 그 값, 없으면 null 을 돌려주고 탐지를 백그라운드로 건다. 탐지가 끝나서
 * 그룹이 달라질 때만(`root` 를 찾았을 때만) `onResolved` 를 부른다 — 못 찾은 경우는
 * 키가 cwd 그대로라 화면이 바뀌지 않으므로 다시 그릴 이유가 없다.
 */
export function projectRootOf (cwd: string | null | undefined, onResolved?: () => void): string | null {
    const p = normalizeCwd(cwd)
    if (!p) {
        return null
    }
    const id = foldGroupKey(p)
    const hit = cache.get(id)
    if (hit !== undefined) {
        return hit
    }
    if (!pending.has(id)) {
        pending.add(id)
        detect(p).then(root => {
            cache.set(id, root)
            pending.delete(id)
            if (root) {
                onResolved?.()
            }
        }).catch(() => {
            // 못 찾은 것으로 굳힌다 — 실패한 경로를 매 렌더마다 다시 훑지 않게
            cache.set(id, null)
            pending.delete(id)
        })
    }
    return null
}

/** 테스트·진단용 — 캐시를 비운다 (다음 조회가 다시 훑는다) */
export function clearProjectRootCache (): void {
    cache.clear()
    pending.clear()
}

/** 진단용 — 지금까지 찾아 둔 것 (`__agentdeck.groups()` 가 보여준다) */
export function projectRootCacheSnapshot (): Array<{ cwd: string, root: string | null }> {
    return [...cache.entries()].map(([cwd, root]) => ({ cwd, root }))
}
