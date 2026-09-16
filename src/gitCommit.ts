/**
 * `git status` 의 스테이지 상태를 구조로 바꾸고, 스테이지·커밋에 쓸 **명령 인자만** 조립하는
 * 순수 모듈 — 미리보기 패널 `변경` 탭의 스테이지 토글·커밋 버튼이 쓴다.
 *
 * **여기서 git 을 실행하지 않는 이유** — 커밋은 되돌리기 번거로운 실제 부작용이다. 그래서
 * "무엇을 실행할지" 를 정하는 자리(이 파일, 테스트로 고정)와 "실제로 실행하는 자리"
 * (viewPanel.ts, 사람의 클릭에만 반응)를 갈랐다. 이 파일만 읽으면 어떤 명령이 나가는지
 * 인자 배열 단위로 확인할 수 있고, 반대로 이 파일을 불러도 아무 일도 일어나지 않는다.
 *
 * DOM·child_process·fs 를 건드리지 않는다 — gitDiff.ts 와 같은 결이다(테스트로 묶기 위해서).
 *
 * **셸을 거치지 않는다** — viewPanel 은 `execFile('git', args)` 로 부르므로 여기서 만드는
 * 인자는 인용·이스케이프가 필요 없고, 반대로 인용을 붙이면 그 따옴표가 파일명이 된다.
 * 경로 앞에는 항상 `--` 를 넣는다(파일명이 `-f` 나 브랜치명이어도 옵션·리비전으로 안 읽히게).
 */

import { unquotePath } from './gitDiff'

/**
 * 한 경로의 스테이지 상태.
 * - `staged` = 스테이지에만 변경이 있다 (X 만 있음)
 * - `unstaged` = 작업트리에만 있다 (Y 만 있음)
 * - `both` = 둘 다 — 올린 뒤에 또 고친 파일이다 (부분 스테이지)
 * - `untracked` = `??`
 * - `conflict` = 머지 충돌 (`UU`·`AA`·`DD`·`AU`·`UA`·`DU`·`UD`)
 */
export type StageState = 'staged' | 'unstaged' | 'both' | 'untracked' | 'conflict'

export interface StatusEntry {
    /** 저장소 루트 기준 경로. 이름이 바뀐 경우 **새** 경로 */
    path: string
    /** 이름이 바뀐(복사된) 경우의 원래 경로 */
    oldPath?: string
    /** 상태코드 두 글자 중 첫 글자 = 스테이지(index) 쪽 */
    index: string
    /** 둘째 글자 = 작업트리(worktree) 쪽 */
    work: string
    state: StageState
}

/**
 * 소스에 리터럴 NUL(0x00)을 쓰면 그 파일이 "바이너리" 로 취급돼 diff·grep·리뷰가 통째로
 * 막힌다 (0.6.0 에서 agents.ts 가 실제로 그렇게 됐다 — docs/DEVELOPMENT.md 함정 목록).
 * `--porcelain -z` 를 다루려면 NUL 이 필요하므로 **이스케이프로만** 적는다.
 */
const NUL = '\u0000'

/**
 * 커밋 메시지 길이 상한. git 자체에는 제한이 없지만 우리는 인자로 넘기고,
 * Windows 의 CreateProcess 명령줄 상한이 32767 자다 — 그 앞에서 넉넉히 막아
 * "왜 실패했는지 모르는 실패" 를 안 만든다.
 */
const MAX_MESSAGE = 8000

/** 충돌 조합 — 한쪽이 `U` 면 무조건, 그 밖에 `DD`(양쪽 삭제)·`AA`(양쪽 추가)도 충돌이다 */
function isConflict (x: string, y: string): boolean {
    return x === 'U' || y === 'U' || (x === 'D' && y === 'D') || (x === 'A' && y === 'A')
}

/**
 * 두 글자 상태코드(XY)를 상태로 읽는다.
 *
 * 규칙은 하나다 — **X 는 스테이지, Y 는 작업트리.** 어느 쪽이 공백이 아니냐로 갈리고,
 * 둘 다 값이 있으면 부분 스테이지(`both`)다. 충돌을 먼저 걸러내는 이유는 `AA`·`UU` 가
 * "양쪽에 값이 있다" 조건도 만족해서 `both` 로 새기 때문이다.
 */
export function stageStateOf (index: string, work: string): StageState {
    const x = index || ' '
    const y = work || ' '
    if (x === '?' || y === '?') {
        return 'untracked'
    }
    if (isConflict(x, y)) {
        return 'conflict'
    }
    const staged = x !== ' '
    const dirty = y !== ' '
    if (staged && dirty) {
        return 'both'
    }
    return staged ? 'staged' : 'unstaged'
}

/** 목록에 붙일 딱지 — 지금 상태를 그대로 말한다(누르면 무엇이 되는지는 title 이 말한다) */
export function stageLabel (state: StageState): string {
    switch (state) {
        case 'staged': return '올림'
        case 'both': return '일부'
        case 'untracked': return '새파일'
        case 'conflict': return '충돌'
        default: return '안올림'
    }
}

/** `## main...origin/main` 같은 머리줄(`-b`)은 경로가 아니다 */
function isHeader (rec: string): boolean {
    return rec.startsWith('## ')
}

/**
 * `XY PATH` 를 가른다. `-z` 든 아니든 **XY 다음 한 칸은 공백**이다
 * (실측: `git status --porcelain -z` → `b' M docs/ORCHESTRATION.md\x00'`).
 */
function splitCode (rec: string): { code: string, rest: string } | null {
    if (rec.length < 3) {
        return null
    }
    return { code: rec.slice(0, 2), rest: rec.slice(2).replace(/^ /, '') }
}

/** 이름변경·복사인가 — 이때만 경로가 두 개 온다 */
function isRenameCode (code: string): boolean {
    return code.indexOf('R') >= 0 || code.indexOf('C') >= 0
}

/** 따옴표 토큰의 닫는 위치 (백슬래시 이스케이프를 건너뛴다) */
function endOfQuoted (s: string): number {
    for (let i = 1; i < s.length; i++) {
        if (s[i] === '\\') {
            i++
            continue
        }
        if (s[i] === '"') {
            return i + 1
        }
    }
    return -1
}

/**
 * 줄 형식(`-z` 아님)의 이름변경 `ORIG -> PATH` 를 가른다.
 *
 * 따옴표로 감싼 쪽은 닫는 따옴표를 찾아 정확히 가른다. 감싸지 않은 경우는 **첫 ` -> `** 로
 * 가르는데, 파일명 자체에 ` -> ` 가 들어 있으면 이 줄만으로는 원리적으로 가를 수 없다
 * (gitDiff.splitHeadPaths 가 `diff --git` 에서 만난 것과 같은 종류의 모호함이다).
 */
function splitRename (rest: string): { orig: string, next: string } {
    if (rest.startsWith('"')) {
        const end = endOfQuoted(rest)
        if (end > 0) {
            const tail = rest.slice(end).replace(/^ -> /, '')
            return { orig: unquotePath(rest.slice(0, end)), next: unquotePath(tail) }
        }
    }
    const cut = rest.indexOf(' -> ')
    if (cut < 0) {
        return { orig: '', next: unquotePath(rest) }
    }
    return { orig: unquotePath(rest.slice(0, cut)), next: unquotePath(rest.slice(cut + 4)) }
}

function entryOf (code: string, path: string, oldPath?: string): StatusEntry {
    const index = code[0] ?? ' '
    const work = code[1] ?? ' '
    const e: StatusEntry = { path, index, work, state: stageStateOf(index, work) }
    if (oldPath) {
        e.oldPath = oldPath
    }
    return e
}

/**
 * `-z` 형식. 레코드마다 NUL 이 붙고 **따옴표를 쓰지 않는다**(그래서 여기서는 따옴표를 벗기지
 * 않는다 — 벗기면 이름이 `"x"` 인 파일이 망가진다).
 *
 * 이름변경은 `-z` 에서 **순서가 뒤집힌다** — `->` 가 사라지고 `XY PATH<NUL>ORIG<NUL>` 로 온다
 * (git-status(1): "the `->` is omitted from rename entries and the field order is reversed").
 * 이 줄을 실측으로 확인하지 못한 이유는 스테이지된 이름변경을 만들려면 `git add` 가 필요한데
 * 이 라운드에서는 어떤 저장소에도 add/commit 을 하지 않기로 했기 때문이다 — 근거는 문서다.
 */
function parseZ (src: string): StatusEntry[] {
    const fields = src.split(NUL)
    const out: StatusEntry[] = []
    for (let i = 0; i < fields.length; i++) {
        const rec = fields[i]
        if (!rec || isHeader(rec)) {
            continue
        }
        const cut = splitCode(rec)
        if (!cut || cut.code === '!!' || cut.code === '  ') {
            continue
        }
        if (isRenameCode(cut.code)) {
            const orig = fields[i + 1] ?? ''
            i++
            out.push(entryOf(cut.code, cut.rest, orig))
            continue
        }
        out.push(entryOf(cut.code, cut.rest))
    }
    return out
}

/**
 * `git status --porcelain=v1` 출력을 구조로 바꾼다. `-z` 인지는 NUL 유무로 스스로 안다 —
 * 부르는 쪽이 어느 형식으로 뽑았는지 두 번 말하지 않게 하기 위해서다.
 *
 * 버리는 것 두 가지: `!!`(무시된 파일 — `--ignored` 없이는 안 나오고 화면에도 안 그린다)과
 * `## ` 머리줄. 나머지는 상태코드를 그대로 보존해서(`index`/`work`) 판정을 되짚을 수 있게 둔다.
 */
export function parseStatus (text: string): StatusEntry[] {
    const src = String(text ?? '')
    if (!src.trim()) {
        return []
    }
    if (src.indexOf(NUL) >= 0) {
        return parseZ(src)
    }
    const out: StatusEntry[] = []
    // CRLF 로 오는 경우 — 셸을 거치거나 하네스가 흘리면 붙는다
    for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
        if (!raw.trim() || isHeader(raw)) {
            continue
        }
        const cut = splitCode(raw)
        if (!cut || cut.code === '!!' || cut.code === '  ') {
            continue
        }
        if (isRenameCode(cut.code)) {
            const pair = splitRename(cut.rest)
            out.push(entryOf(cut.code, pair.next, pair.orig))
            continue
        }
        out.push(entryOf(cut.code, unquotePath(cut.rest)))
    }
    return out
}

/**
 * 인자로 넘길 경로를 다듬는다.
 * - 빈 경로는 버린다 (git 이 "빈 경로 명세" 로 거절한다)
 * - NUL 이 든 경로는 버린다 — `execFile` 이 인자에 NUL 을 허용하지 않아 **예외로 죽는다**
 * - 중복은 없앤다 (같은 파일을 두 번 넘길 이유가 없다)
 *
 * 앞뒤 공백은 **떼지 않는다** — 파일명에 공백이 들어 있을 수 있고, 다듬으면 없는 경로가 된다.
 */
function cleanPaths (paths: readonly string[]): string[] {
    const seen = new Set<string>()
    for (const p of paths ?? []) {
        const s = typeof p === 'string' ? p : ''
        if (!s || s.indexOf(NUL) >= 0) {
            continue
        }
        seen.add(s)
    }
    return Array.from(seen)
}

/** 스테이지에 올린다. 경로가 없으면 **빈 배열** — 인자 없는 `git add` 는 저장소 전체를 건드린다 */
export function stageArgs (paths: readonly string[]): string[] {
    const list = cleanPaths(paths)
    return list.length ? ['add', '--', ...list] : []
}

/**
 * 스테이지에서 내린다. `git reset -q -- <경로>` = 그 경로만 index 를 HEAD 로 되돌린다
 * (작업트리는 건드리지 않는다 — `--hard` 는 절대 쓰지 않는다).
 * 경로가 없으면 빈 배열 — 인자 없는 `git reset` 은 스테이지 전체를 비운다.
 */
export function unstageArgs (paths: readonly string[]): string[] {
    const list = cleanPaths(paths)
    return list.length ? ['reset', '-q', '--', ...list] : []
}

/**
 * 커밋이 0개인 저장소용 대체 명령. `reset` 은 HEAD 를 풀어야 하므로 첫 커밋 전에는 실패한다
 * (`변경` 탭이 `diff HEAD` 대신 `diff` 로 폴백해야 했던 것과 같은 사정 — docs/DEVELOPMENT.md).
 * `rm --cached` 는 index 에서만 빼고 작업트리의 파일은 남긴다.
 */
export function unstageFallbackArgs (paths: readonly string[]): string[] {
    const list = cleanPaths(paths)
    return list.length ? ['rm', '--cached', '-q', '--', ...list] : []
}

/**
 * 커밋 메시지 검증. **거부하는 이유를 사람이 읽을 문장으로** 준다 — 버튼이 안 눌리는데
 * 이유가 없으면 사용자는 플러그인이 고장난 줄 안다.
 */
export function validateMessage (msg: string): { ok: boolean, reason?: string } {
    if (typeof msg !== 'string' || msg === '') {
        return { ok: false, reason: '커밋 메시지가 비어 있다 — 무엇을 바꿨는지 한 줄 적어야 커밋한다' }
    }
    if (msg.indexOf(NUL) >= 0) {
        return { ok: false, reason: '커밋 메시지에 NUL 문자가 들어 있다 — 그대로 넘기면 git 실행 자체가 실패한다' }
    }
    if (!msg.trim()) {
        return { ok: false, reason: '공백·줄바꿈만 있다 — git 도 빈 메시지로 보고 커밋을 거절한다' }
    }
    if (msg.length > MAX_MESSAGE) {
        return { ok: false, reason: '메시지가 너무 길다 (' + msg.length + '자 / 최대 ' + MAX_MESSAGE + '자)' }
    }
    return { ok: true }
}

/**
 * 커밋 명령. **메시지는 `-m` 의 값으로 배열 원소 하나로 넘긴다** — 셸을 거치지 않으므로
 * 메시지에 `&&`·`"`·`$(…)` 가 들어 있어도 그냥 글자다(주입 경로가 없다).
 *
 * 검증에 걸리면 **빈 배열**을 돌려준다. 부르는 쪽이 실수로 그대로 실행해도 인자가 없어
 * 커밋이 만들어지지 않는다 — UI 의 버튼 잠금과 별개인 두 번째 안전장치다.
 */
export function commitArgs (msg: string, opts?: { amend?: boolean }): string[] {
    if (!validateMessage(msg).ok) {
        return []
    }
    const args = ['commit']
    if (opts?.amend) {
        args.push('--amend')
    }
    args.push('-m', msg)
    return args
}

/** 스테이지에 올라간 것이 하나라도 있나 — 커밋 버튼이 "올린 게 없다" 를 미리 말하는 근거 */
export function hasStaged (entries: readonly StatusEntry[]): boolean {
    for (const e of entries ?? []) {
        if (e.state === 'staged' || e.state === 'both') {
            return true
        }
    }
    return false
}

/**
 * 커밋 줄에 붙일 요약. 부분 스테이지(`both`)는 **양쪽에 센다** — 그 파일은 올린 부분과
 * 안 올린 부분이 실제로 둘 다 있고, 한쪽만 세면 합이 파일 수와 안 맞아 더 헷갈린다.
 */
export function formatStageSummary (entries: readonly StatusEntry[]): string {
    let staged = 0
    let unstaged = 0
    let untracked = 0
    let conflict = 0
    for (const e of entries ?? []) {
        switch (e?.state) {
            case 'staged': staged++; break
            case 'unstaged': unstaged++; break
            case 'both': staged++; unstaged++; break
            case 'untracked': untracked++; break
            case 'conflict': conflict++; break
            default: break
        }
    }
    const parts: string[] = []
    if (staged) {
        parts.push(staged + '개 스테이지')
    }
    if (unstaged) {
        parts.push(unstaged + '개 미스테이지')
    }
    if (untracked) {
        parts.push(untracked + '개 추적안됨')
    }
    if (conflict) {
        parts.push(conflict + '개 충돌')
    }
    return parts.length ? parts.join(' · ') : '변경 없음'
}
