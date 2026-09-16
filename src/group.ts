/**
 * 사이드바를 프로젝트 단위로 묶는 순수 규칙 — DOM·tabby·fs 에 기대지 않아 단위 테스트가 된다.
 *
 * 탭이 열 개를 넘으면 평면 목록에서는 어느 프로젝트의 세션인지 눈으로 가릴 수 없다. 그래서
 * **탭이 태어난 작업 폴더(cwd)** 로 묶는다 — 에이전트 CLI 는 "어느 폴더에서 떴는가" 가 곧
 * 작업 대상이고(`config.ts` rootProfile 주석), `getWorkingDirectory()` 는 셸의 `cd` 를
 * 따라오지 않아 사실상 "탭이 태어난 폴더" 를 준다(docs/DEVELOPMENT.md 0.5.0 실측).
 * 즉 이 값은 세션이 사는 동안 안 바뀌는 = 그룹 키로 쓸 만한 유일한 값이다.
 *
 * 이 모듈은 **여전히 fs 를 모른다.** 프로젝트 경계(저장소 루트)를 실제로 찾는 것은
 * `project-root.ts` 이고, 여기는 호출부가 넘긴 `rootOf` 조회 함수를 부를 뿐이다 —
 * 경계를 알아내려고 여기서 `.git` 을 찾기 시작하면 렌더마다 디스크를 때리게 된다
 * (렌더는 초당 여러 번 불린다 — deck.service `scheduleRender`).
 */

/** cwd 를 모르는 탭들이 모이는 그룹의 이름 (Welcome 탭·조회 실패) */
export const UNGROUPED_LABEL = '기타'

/**
 * 정규화된 cwd 를 받아 그 폴더가 속한 **프로젝트 루트**를 돌려주는 조회 함수.
 *
 * 구현은 `project-root.ts` 가 한다 (`.git` 등을 위로 훑는다). 여기서 주입받는 이유는 둘 —
 * 이 모듈을 fs 없이 단위 테스트하기 위해서, 그리고 조회가 캐시·비동기라는 사정을
 * 그룹 규칙이 몰라도 되게 하기 위해서다. 아직 모르면 `null` 을 주면 된다(= cwd 자체가 키).
 */
export type ProjectRootOf = (cwd: string) => string | null | undefined

export interface GroupedTab<T> { tab: T, key: string | null }

export interface TabGroup<T> { key: string | null, label: string, tabs: T[] }

/**
 * 경로를 비교 가능한 꼴로 — 구분자는 `/` 하나, 중복 슬래시 축약, 끝 슬래시 제거.
 *
 * 대소문자는 **일부러 안 건드린다.** 라벨에 원문 대소문자(`Root` 를 `root` 로 만들지 않게)를
 * 살려야 하기 때문이고, 같은 폴더인지 볼 때만 `foldGroupKey` 를 통과시킨다.
 * 값이 없거나 공백뿐이면 null — 호출부에서 "cwd 모름" 과 같게 취급된다.
 */
export function normalizeCwd (cwd: string | null | undefined): string | null {
    if (typeof cwd !== 'string') {
        return null
    }
    let p = cwd.trim()
    if (!p) {
        return null
    }
    p = p.replace(/\\/g, '/')
    // UNC(`//server/share`) 의 앞 두 슬래시는 의미가 있으므로 축약한 뒤 되살린다
    const unc = p.startsWith('//')
    p = p.replace(/\/{2,}/g, '/')
    if (unc) {
        p = '/' + p
    }
    // 끝 슬래시 제거 — 단 루트 자체(`/`, `C:/`)는 더 줄일 것이 없으므로 남긴다
    while (p.length > 1 && p.endsWith('/') && !/^[A-Za-z]:\/$/.test(p)) {
        p = p.slice(0, -1)
    }
    return p
}

/**
 * 그룹 동일성 판정용 접기.
 *
 * Windows 는 경로 대소문자를 무시한다 — `D:\Project` 와 `d:\project` 는 같은 폴더다.
 * 이걸 안 접으면 같은 프로젝트가 두 그룹으로 갈려 기능 자체가 무의미해진다.
 * 설정에 저장한 접힘 목록을 맞출 때도 이걸 통과시켜야 한다 — 셸이 알려주는 경로의
 * 대소문자는 기동마다 다를 수 있는데 접힘은 유지돼야 하기 때문이다.
 */
export function foldGroupKey (key: string | null | undefined): string {
    return (key ?? '').toLowerCase()
}

interface Split { prefix: string, abs: boolean, segs: string[] }

/** 경로를 "더 못 쪼개는 접두 + 조각들" 로 — 접두는 `C:` / `//server/share` / POSIX 는 빈 문자열 */
function splitPath (p: string): Split {
    // UNC 는 `//server/share` 까지가 한 덩어리다 (호스트만 떼면 경로가 아니다)
    const unc = /^\/\/([^/]+)\/([^/]+)(.*)$/.exec(p)
    if (unc) {
        return { prefix: '//' + unc[1] + '/' + unc[2], abs: true, segs: segsOf(unc[3]) }
    }
    const drive = /^([A-Za-z]:)(\/.*)?$/.exec(p)
    if (drive) {
        return { prefix: drive[1], abs: true, segs: segsOf(drive[2] ?? '') }
    }
    return { prefix: '', abs: p.startsWith('/'), segs: segsOf(p) }
}

function segsOf (rest: string): string[] {
    return rest.split('/').filter(s => s.length > 0)
}

function joinPath (s: Split, segs: readonly string[]): string {
    if (!segs.length) {
        // 루트 자체 — 드라이브는 `C:/` 로 되돌린다(`normalizeCwd` 가 남기는 꼴과 같아야
        // 같은 폴더가 `C:` 와 `C:/` 두 값으로 갈리지 않는다). UNC 공유 루트는 그대로, POSIX 는 `/`
        if (/^[A-Za-z]:$/.test(s.prefix)) {
            return s.prefix + '/'
        }
        return s.prefix || (s.abs ? '/' : '')
    }
    return s.prefix + (s.abs ? '/' : '') + segs.join('/')
}

function sameSegs (a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((s, i) => foldGroupKey(s) === foldGroupKey(b[i]))
}

/** b 의 조각들로 시작하나 (대소문자 무시) */
function startsWithSegs (segs: readonly string[], prefix: readonly string[]): boolean {
    return segs.length >= prefix.length && sameSegs(segs.slice(0, prefix.length), prefix)
}

/**
 * cwd 를 그룹 키로 — 없으면 null(그룹 없음).
 *
 * cwd 를 그대로 키로 쓰면 `D:\Project\a\sub` 에서 띄운 탭과 `D:\Project\a` 에서 띄운 탭이
 * 다른 그룹으로 갈린다(에이전트를 서브폴더에서 띄우는 건 흔하다). 그래서 **그 폴더가 속한
 * 프로젝트 루트**를 키로 삼는다 — 루트는 `rootOf` 가 알려주고(보통 `.git` 이 있는 폴더),
 * 모르면 cwd 자체가 키다(예전 동작 그대로).
 *
 * `rootOf` 가 준 값이 cwd 의 조상이 아니면 **버린다.** 엉뚱한 값 하나가 상관없는 탭들을
 * 한 그룹으로 빨아들이는 것이 "안 묶임" 보다 훨씬 나쁘기 때문이다.
 */
export function groupKeyOf (cwd: string | null | undefined, rootOf?: ProjectRootOf): string | null {
    const p = normalizeCwd(cwd)
    if (!p) {
        return null
    }
    const root = rootOf ? normalizeCwd(rootOf(p)) : null
    if (!root) {
        return p
    }
    const pp = splitPath(p)
    const rp = splitPath(root)
    if (foldGroupKey(rp.prefix) === foldGroupKey(pp.prefix) && startsWithSegs(pp.segs, rp.segs)) {
        return root
    }
    return p
}

/**
 * 한 단계 위 폴더 — 더 올라갈 데가 없으면 null.
 *
 * `project-root.ts` 가 마커를 찾아 올라갈 때 쓴다. 여기 두는 이유는 드라이브(`C:/`)·UNC
 * (`//server/share`) 경계를 아는 것이 `splitPath` 뿐이라서다 — `path.dirname` 은 UNC 공유
 * 루트에서 호스트만 남기는 등 경로가 아닌 값을 만든다.
 */
export function parentPath (p: string | null | undefined): string | null {
    const norm = normalizeCwd(p)
    if (!norm) {
        return null
    }
    const s = splitPath(norm)
    if (!s.segs.length) {
        return null
    }
    return joinPath(s, s.segs.slice(0, -1))
}

/**
 * 그룹에 붙일 짧은 이름 — 경로 마지막 조각. 다른 그룹과 겹치면 상위를 한 단계씩 더 붙인다.
 *
 * 사이드바는 200~560px 라(config `sidebarMin`/`sidebarMax`) 전체 경로를 그리면 말줄임으로
 * 뭉개진다. 그래도 `…/work/agent` 와 `…/temp/agent` 를 둘 다 `agent` 로 적으면 그룹을
 * 구분할 수 없으므로, 겹치는 동안만 위로 올라간다. 끝까지 겹치면 정규화한 전체 경로.
 */
export function groupLabelOf (key: string, allKeys: readonly string[]): string {
    const norm = normalizeCwd(key)
    if (!norm) {
        return UNGROUPED_LABEL
    }
    const segs = splitPath(norm).segs
    if (!segs.length) {
        // 드라이브 루트(`C:/`)·UNC 공유 루트 — 더 짧게 만들 조각이 없다
        return norm
    }
    const others: string[][] = []
    for (const k of allKeys) {
        const n = normalizeCwd(k)
        if (n && foldGroupKey(n) !== foldGroupKey(norm)) {
            others.push(splitPath(n).segs)
        }
    }
    for (let depth = 1; depth <= segs.length; depth++) {
        const tail = segs.slice(-depth)
        const collide = others.some(o => o.length >= depth && sameSegs(o.slice(-depth), tail))
        if (!collide) {
            return tail.join('/')
        }
    }
    return norm
}

/** 라벨 사전순(대소문자 무시). 같으면 키로 가른다 — 로케일에 안 기대는 코드포인트 비교라 어디서나 같은 순서다 */
function compareGroups<T> (a: TabGroup<T>, b: TabGroup<T>): number {
    const la = a.label.toLowerCase()
    const lb = b.label.toLowerCase()
    if (la !== lb) {
        return la < lb ? -1 : 1
    }
    const ka = foldGroupKey(a.key)
    const kb = foldGroupKey(b.key)
    return ka === kb ? 0 : (ka < kb ? -1 : 1)
}

/**
 * 탭을 그룹으로 묶는다.
 *
 * 두 순서를 서로 다르게 정한다 —
 *  - **그룹 순서**: 라벨 사전순, cwd 를 모르는 그룹(`key: null`)은 맨 아래. 프로젝트 목록은
 *    자주 안 바뀌므로 눈이 자리를 기억하는 편이 낫고, 상태로 정렬하면 그룹이 매초 뛴다.
 *  - **그룹 안의 탭 순서**: 넘어온 순서 그대로. 호출부가 `sortByStatus` 를 이미 적용해
 *    넘길 수 있기 때문이다(`order.ts` 의 `sortTabsByStatus` 도 같은 성질을 지킨다).
 *
 * 반환 길이가 1 이면 호출부는 그룹 헤더를 생략한다 — 단일 프로젝트에서 세로 공간을 낭비하지 않게.
 * 비용은 탭 수만큼의 맵 조작 + 그룹 수²의 라벨 대조뿐이라 렌더마다 불러도 된다.
 */
export function groupTabs<T> (tabs: readonly T[], cwdOf: (t: T) => string | null, rootOf?: ProjectRootOf): TabGroup<T>[] {
    const order: string[] = []
    const byFold = new Map<string, { key: string, tabs: T[] }>()
    const ungrouped: T[] = []
    for (const tab of tabs) {
        const key = groupKeyOf(cwdOf(tab), rootOf)
        if (!key) {
            ungrouped.push(tab)
            continue
        }
        const fold = foldGroupKey(key)
        let hit = byFold.get(fold)
        if (!hit) {
            // 대소문자만 다른 경로는 같은 그룹으로 합치고, 표기는 먼저 온 탭의 것을 쓴다
            hit = { key, tabs: [] }
            byFold.set(fold, hit)
            order.push(fold)
        }
        hit.tabs.push(tab)
    }
    const keys = order.map(f => (byFold.get(f) as { key: string }).key)
    const out: TabGroup<T>[] = order.map(f => {
        const hit = byFold.get(f) as { key: string, tabs: T[] }
        return { key: hit.key, label: groupLabelOf(hit.key, keys), tabs: hit.tabs }
    })
    out.sort(compareGroups)
    if (ungrouped.length) {
        out.push({ key: null, label: UNGROUPED_LABEL, tabs: ungrouped })
    }
    return out
}

/**
 * 접힘 상태를 설정(`collapsedGroups`)에 적을 때 쓰는 id.
 *
 * cwd 를 모르는 그룹(`key === null`, 라벨 `기타`)도 접을 수 있어야 하는데 그 그룹에는 경로
 * 키가 없다. 그래서 경로일 수 없는 이 토큰을 대신 쓴다 — 실제 그룹 키는 정규화된 경로뿐이라
 * 괄호로 시작하는 값과는 겹칠 수 없다.
 *
 * `deck.service.ts` 의 private `UNGROUPED_KEY` 와 **같은 값이어야 한다**(deck.service.ts:134).
 * 이미 그 값으로 설정에 적힌 접힘이 있어서, 바꾸면 사용자가 접어 둔 그룹이 조용히 펴진다.
 */
export const UNGROUPED_COLLAPSE_KEY = '(ungrouped)'

/**
 * 그룹 키 → 설정에 적는 접힘 id. **쓸 때도 읽을 때도** 이걸 통과시켜야 한다.
 *
 * 폴딩(`foldGroupKey`)을 빼먹으면 셸이 기동마다 다른 대소문자로 cwd 를 알려줄 때 접힘이
 * 풀린다(회귀 `GR8`·`GR9` 가 그 성질을 고정한다). `null` 은 `기타` 그룹이라 위 토큰이 된다.
 */
export function collapseIdOf (key: string | null | undefined): string {
    return foldGroupKey(key ?? UNGROUPED_COLLAPSE_KEY)
}

/**
 * 설정에 남은 접힘 목록에 이 그룹이 있나 — **저장된 사용자 의도**를 읽는 유일한 창구.
 *
 * 저장값은 사람이 손으로 고칠 수 있는 config.yaml 이라 무엇이든 들어올 수 있다. 배열이
 * 아니거나 비어 있으면 "접힌 것 없음" 이고, 원소는 문자열로 만든 뒤 폴딩해서 비교한다
 * (`deck.service.ts` `collapsedKeys` 와 같은 처리).
 */
export function isStoredCollapsed (key: string | null | undefined, stored: readonly unknown[] | null | undefined): boolean {
    if (!Array.isArray(stored)) {
        return false
    }
    const id = collapseIdOf(key)
    return stored.some(k => k !== null && k !== undefined && foldGroupKey(String(k)) === id)
}

/**
 * 그룹이 지금 접혀 있는 이유 — 화면(캐럿·title)이 상태만 보고 문구를 정할 수 있게 같이 준다.
 *  - `open`: 저장된 접힘이 없다. 그냥 펴진 그룹.
 *  - `stored`: 저장된 접힘 그대로 접혀 있다.
 *  - `filter-open`: **저장은 접힘인데** 지금 걸린 필터에 걸린 탭이 이 그룹에 있어 임시로 펴 보인다.
 *    저장값은 그대로다 — 필터를 풀면 다시 접힌다.
 */
export type GroupCollapseReason = 'open' | 'stored' | 'filter-open'

export interface GroupCollapseState { collapsed: boolean, reason: GroupCollapseReason }

export interface GroupCollapseInput {
    /** 설정에 이 그룹이 접힘으로 적혀 있나 (`isStoredCollapsed`) */
    stored: boolean
    /** 검색어나 상태 필터가 하나라도 걸려 있나 (`renderPlan().filtering`) */
    filtering: boolean
    /** 이 그룹에서 필터를 통과한 탭 수. 없거나 0 이하면 0 (필터 중이 아니면 보지 않는다) */
    matches?: number
}

/**
 * 접힘의 **최종 판정** — 저장된 접힘 + 필터 상태 + 그 그룹의 매칭 수로 정한다.
 *
 * 왜 이 함수가 있나 — 그룹이 여럿이고 그중 접힌 그룹에만 검색어가 걸리면, 줄은 안 그려지고
 * 헤더의 개수 칩만 남는다. 사용자는 "검색했는데 아무것도 안 나온다" 로 읽는데 실제로는
 * 접힌 그룹 안에 있다. 이 규칙을 렌더에 직접 적으면 진단구(`groups()`)와 사본이 갈리므로
 * (그 사본 문제가 `renderPlan()` 을 뽑은 이유다) 판정은 여기 하나만 둔다.
 *
 * **세 안을 비교하고 ②를 골랐다.**
 *  ① 검색 중에는 접힘을 통째로 무시(다 펴 보인다) — 결과는 지금 배선에서 ②와 같다
 *    (`renderPlan` 이 그룹을 `visible` 로 만들므로 매칭 0인 그룹은 애초에 목록에 없다).
 *    그래도 규칙으로는 버렸다: "매칭이 없는데도 펴진다" 를 허용하는 문장이라, 나중에 빈
 *    그룹까지 헤더로 보여주는 화면이 생기면 아무 이유 없이 다 펴진다.
 *  ② **매칭이 있는 접힌 그룹만 임시로 펴진다** ← 채택. 좁아진 이유가 화면에 보이고
 *    (`renderEmpty` 가 0건을 한 줄로 알리는 것과 같은 계열), 저장값은 건드리지 않으므로
 *    필터를 지우면 저장된 접힘으로 **정확히** 돌아온다. 판정에 매칭 수가 들어가 있어
 *    "왜 펴졌나" 를 `reason` 으로 되읽을 수 있다.
 *  ③ 접힌 채 두고 헤더에 "안에 N개 걸렸다" 를 표시 — 버렸다. 개수 칩은 **전체 기준**이라는
 *    성질을 회귀 `GR11` 이 고정하고 있어서(접어도 총계가 줄지 않는다) 같은 자리에 매칭 수를
 *    넣으면 그 성질과 부딪히고, 칩을 하나 더 두더라도 200px 사이드바(`sidebarMin`)에
 *    자리가 없다. 무엇보다 사용자가 헤더를 눌러야 결과를 보게 되는데, 검색은 "치면 바로
 *    보이는 것" 이라 왕복이 하나 늘면 검색창의 의미가 준다.
 *
 * **이 함수는 설정을 바꾸지 않는다** — 임시로 펴 보이는 것과 접힘을 푸는 것은 다른 일이다.
 * 접힘을 실제로 푸는 길은 헤더 클릭(`toggleGroup`) 하나뿐이어야 한다. 그래서 반환값은
 * 매번 입력만으로 계산되고, 임시 상태를 어디에도 남기지 않는다(필터를 지우면 같은 입력이
 * 되어 저장된 접힘이 그대로 나온다).
 *
 * 상태 필터만 걸린 경우(검색어는 비었다)도 **같게 다룬다.** 칩 `⏸ 2` 를 눌렀는데 그 두 탭이
 * 접힌 그룹에 있으면 "대기 중인 게 없다" 로 읽히는 것은 검색어일 때와 똑같은 오독이다.
 * 그래서 입력은 검색어가 아니라 `filtering`(검색어 OR 상태 필터) 하나로 받는다.
 */
export function resolveGroupCollapse (input: GroupCollapseInput): GroupCollapseState {
    if (!input.stored) {
        // 저장된 접힘이 없으면 필터와 무관하게 펴진 그룹이다 (필터가 접는 일은 없다)
        return { collapsed: false, reason: 'open' }
    }
    const raw = input.matches
    const matches = typeof raw === 'number' && isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
    if (input.filtering && matches > 0) {
        return { collapsed: false, reason: 'filter-open' }
    }
    // 필터가 없거나, 있어도 이 그룹에 걸린 것이 없으면 저장된 접힘 그대로 — 보여줄 것이 없다
    return { collapsed: true, reason: 'stored' }
}

/**
 * `resolveGroupCollapse` 를 그룹 하나에 바로 먹인다 — 렌더가 매칭 수를 다시 세지 않게.
 *
 * 필터가 걸린 화면에서 `group.tabs` 는 **이미 필터를 통과한 탭들**이다
 * (`deck.service.ts renderPlan()` 이 `groupsFor(visible)` 로 그룹을 만든다). 그래서
 * `tabs.length` 가 곧 이 그룹의 매칭 수다. 필터가 없으면 그 값은 쓰이지 않는다.
 *
 * 헤더 자체를 안 그리는 화면(그룹 1개 = `withHeads === false`)에서는 접힘을 적용하지 않는다는
 * 규칙은 그대로 호출부에 있다 — `withHeads && collapsed` 조합을 유지할 것.
 */
export function resolveGroupCollapseFor<T> (
    group: TabGroup<T>,
    stored: readonly unknown[] | null | undefined,
    filtering: boolean,
): GroupCollapseState {
    return resolveGroupCollapse({
        stored: isStoredCollapsed(group.key, stored),
        filtering,
        matches: group.tabs.length,
    })
}
