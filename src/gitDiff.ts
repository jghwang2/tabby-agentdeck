/**
 * `git diff` 유니파이드 출력을 구조로 바꾸는 순수 파서 — 미리보기 패널의 `변경` 탭이 쓴다.
 *
 * **왜 근거를 훅이 아니라 git 에 두나 —** 이 패널은 Claude·Codex·Gemini 를 가리지 않아야 한다.
 * "누가 무엇을 고쳤다" 를 에이전트에게 물으면 에이전트마다 규약이 달라지고(훅이 있는 것은
 * Claude Code 뿐이다 — src/claudeHooks.ts), 훅이 없는 에이전트에서는 탭이 텅 빈다.
 * 반면 작업트리는 누가 고쳤든 같은 자리에 같은 모양으로 남는다. 그래서 `git diff` 가 기본이다.
 *
 * DOM 도 child_process 도 건드리지 않는다 — git 실행과 화면 그리기는 viewPanel.ts 가 맡고
 * 여기서는 문자열을 구조로만 바꾼다. viewer.ts / markdown.ts 를 가른 것과 같은 이유(테스트)다.
 */

export interface DiffLine {
    /** `hunk` = `@@ … @@` 머리줄, 나머지는 본문 한 줄 */
    kind: 'add' | 'del' | 'ctx' | 'hunk'
    /** 본문은 앞머리 기호(`+ - ` )를 뗀 내용. hunk 는 머리줄 원문 그대로 */
    text: string
    /** 구(舊) 파일 줄번호 — 추가줄에는 없다 */
    oldNo?: number
    /** 신(新) 파일 줄번호 — 삭제줄에는 없다 */
    newNo?: number
}

export interface DiffFile {
    /** 새 경로 (`b/` 쪽). 삭제된 파일은 지워진 경로 */
    path: string
    /** 이름이 바뀐 경우의 옛 경로. 그 외에는 없다 */
    oldPath?: string
    status: 'modified' | 'added' | 'deleted' | 'renamed'
    /** 바이너리는 내용 비교가 없다 — `lines` 가 비어 있다 */
    binary: boolean
    added: number
    removed: number
    lines: DiffLine[]
}

const DIFF_HEAD_RE = /^diff --git (.*)$/
/**
 * `@@ -12,7 +12,9 @@ 함수명` — 개수는 1일 때 생략된다(`@@ -1 +1 @@`).
 * 꼬리(함수명)는 git 이 붙여 주는 문맥이라 그대로 보존한다 — 어느 함수 안인지가 diff 를 읽는 데
 * 가장 큰 단서다.
 */
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
const BINARY_RE = /^Binary files (.*) and (.*) differ$/

/** 바이트 배열을 UTF-8 로 읽는다 — git 이 한글 경로를 `\355\225\234` 처럼 8진 이스케이프로 준다 */
function bytesToUtf8 (bytes: number[]): string {
    if (!bytes.length) {
        return ''
    }
    try {
        return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''))
    } catch {
        // UTF-8 이 아닌 파일명 — 바이트를 글자로 그대로 흘린다 (깨져 보여도 목록에서 사라지지는 않게)
        return bytes.map(b => String.fromCharCode(b)).join('')
    }
}

const ESCAPES: Record<string, string> = {
    n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f', v: '\v', a: '\x07',
}

/**
 * git 이 따옴표로 감싼 경로의 속을 푼다.
 *
 * `core.quotePath` 기본값이 true 라서 한글·공백·따옴표가 든 경로는 `"a/\355\225\234 \353\254\270.md"`
 * 처럼 온다. 8진 이스케이프는 **바이트 단위**라 한 글자가 여러 개로 쪼개져 있고, 그래서 모아 두었다가
 * 비-8진 문자를 만날 때 한 번에 UTF-8 로 읽는다 (한 개씩 읽으면 한글이 전부 깨진다).
 */
function decodeQuoted (body: string): string {
    let out = ''
    let bytes: number[] = []
    const flush = () => {
        if (bytes.length) {
            out += bytesToUtf8(bytes)
            bytes = []
        }
    }
    for (let i = 0; i < body.length; i++) {
        const ch = body[i]
        if (ch !== '\\') {
            flush()
            out += ch
            continue
        }
        const next = body[i + 1] ?? ''
        if (next >= '0' && next <= '7') {
            let oct = ''
            while (oct.length < 3 && body[i + 1] >= '0' && body[i + 1] <= '7') {
                oct += body[i + 1]
                i++
            }
            bytes.push(parseInt(oct, 8))
            continue
        }
        flush()
        out += ESCAPES[next] ?? next
        i++
    }
    flush()
    return out
}

/** 경로 한 토큰을 정규화한다 — 따옴표를 벗기고 탭 뒤(타임스탬프)를 버린다 */
export function unquotePath (raw: string): string {
    let s = String(raw ?? '').replace(/\t.*$/, '').trim()
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        s = decodeQuoted(s.slice(1, -1))
    }
    return s
}

/** `a/` `b/` 접두를 뗀다. `--no-prefix` 로 뽑은 diff 는 접두가 없어 그대로 둔다 */
function stripSide (p: string): string {
    return /^[ab]\//.test(p) ? p.slice(2) : p
}

/** 따옴표 토큰 하나를 읽는다 (끝 위치도 같이 돌려준다 — 뒤에 두 번째 경로가 붙어 있다) */
function readQuoted (s: string): { value: string, end: number } | null {
    if (s[0] !== '"') {
        return null
    }
    for (let i = 1; i < s.length; i++) {
        if (s[i] === '\\') {
            i++
            continue
        }
        if (s[i] === '"') {
            return { value: decodeQuoted(s.slice(1, i)), end: i + 1 }
        }
    }
    return null
}

/**
 * `diff --git a/X b/Y` 의 두 경로를 가른다.
 *
 * 경로에 공백이 있으면 이 줄만으로는 원리적으로 가를 수 없다(구분자가 공백인데 경로에도 공백이 있다).
 * 그래서 **같은 경로가 두 번 오는 경우**(수정·삭제·신규 = 거의 전부)를 길이로 정확히 판정하고,
 * 이름이 바뀐 경우는 뒤따라오는 `rename from/to` 나 `---`/`+++` 가 덮어 준다.
 */
function splitHeadPaths (rest: string): { old: string, next: string } {
    const s = String(rest ?? '').trim()
    if (s.startsWith('"')) {
        const first = readQuoted(s)
        if (first) {
            const tail = s.slice(first.end).trim()
            const second = readQuoted(tail)
            return { old: stripSide(first.value), next: stripSide(second ? second.value : tail) }
        }
    }
    // `a/P b/P` 꼴이면 길이가 `2 + L + 3 + L` 이다 — L 을 역산해 양쪽이 같은지 확인한다
    const half = (s.length - 5) / 2
    if (Number.isInteger(half) && half > 0 && s.slice(0, 2) === 'a/'
        && s.slice(2 + half, 5 + half) === ' b/' && s.slice(2, 2 + half) === s.slice(5 + half)) {
        const p = s.slice(2, 2 + half)
        return { old: p, next: p }
    }
    const cut = s.indexOf(' b/')
    if (cut > 0) {
        return { old: stripSide(s.slice(0, cut)), next: stripSide(s.slice(cut + 1)) }
    }
    return { old: stripSide(s), next: stripSide(s) }
}

function blank (): DiffFile {
    return { path: '', status: 'modified', binary: false, added: 0, removed: 0, lines: [] }
}

/**
 * 유니파이드 diff 한 덩이를 파일 목록으로 바꾼다.
 *
 * 훑는 방식: `diff --git` 마다 파일을 하나 열고, `@@` 를 만나면 그 헝크가 **몇 줄인지 세면서**
 * 본문을 먹는다. 줄 수로 끝을 판정하는 이유 — 헝크 본문에는 `+++ b/x` 나 `--- a/x` 같은 글자가
 * 그대로 들어 있을 수 있다(diff 를 담은 파일의 diff). 앞머리 기호만 보고 헤더와 본문을 가르면
 * 그런 줄에서 파싱이 어긋난다.
 */
export function parseUnifiedDiff (text: string): DiffFile[] {
    const src = String(text ?? '').replace(/\r\n?/g, '\n')
    if (!src.trim()) {
        return []
    }
    const files: DiffFile[] = []
    let cur: DiffFile | null = null
    let oldNo = 0
    let newNo = 0
    /** 지금 헝크에서 아직 안 먹은 줄 수 (둘 다 0 이면 헝크 밖) */
    let remOld = 0
    let remNew = 0

    for (const raw of src.split('\n')) {
        const inHunk = cur !== null && (remOld > 0 || remNew > 0)
        if (inHunk) {
            const mark = raw[0] ?? ''
            if (mark === '\\') {
                // `\ No newline at end of file` — 내용이 아니라 주석이라 줄로 세지 않는다.
                // 이걸 ctx 로 흘리면 줄번호가 한 칸씩 밀린다
                continue
            }
            if (mark === '+') {
                cur!.added++
                cur!.lines.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ })
                remNew--
                continue
            }
            if (mark === '-') {
                cur!.removed++
                cur!.lines.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ })
                remOld--
                continue
            }
            if (mark === ' ' || raw === '') {
                // 빈 문맥줄은 원래 공백 한 칸이지만, 중간에 거친 도구가 뒷공백을 떼면 빈 줄로 온다
                cur!.lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
                remOld--
                remNew--
                continue
            }
            // 헝크가 선언한 줄 수보다 일찍 끝났다 — 헤더로 되돌아간다
            remOld = 0
            remNew = 0
        }

        const head = DIFF_HEAD_RE.exec(raw)
        if (head) {
            const pair = splitHeadPaths(head[1])
            cur = blank()
            cur.path = pair.next
            if (pair.old && pair.old !== pair.next) {
                cur.oldPath = pair.old
            }
            files.push(cur)
            remOld = 0
            remNew = 0
            continue
        }
        if (!cur) {
            // `diff --git` 앞에 붙은 것(커밋 메시지 등) — 볼 것이 없다
            continue
        }

        const hunk = HUNK_RE.exec(raw)
        if (hunk) {
            oldNo = Number(hunk[1])
            newNo = Number(hunk[3])
            remOld = hunk[2] === undefined ? 1 : Number(hunk[2])
            remNew = hunk[4] === undefined ? 1 : Number(hunk[4])
            cur.lines.push({ kind: 'hunk', text: raw })
            continue
        }

        if (raw.startsWith('new file mode')) {
            cur.status = 'added'
        } else if (raw.startsWith('deleted file mode')) {
            cur.status = 'deleted'
        } else if (raw.startsWith('rename from ')) {
            cur.status = 'renamed'
            cur.oldPath = unquotePath(raw.slice('rename from '.length))
        } else if (raw.startsWith('rename to ')) {
            cur.status = 'renamed'
            cur.path = unquotePath(raw.slice('rename to '.length))
        } else if (raw.startsWith('--- ')) {
            const p = unquotePath(raw.slice(4))
            if (p === '/dev/null') {
                cur.status = 'added'
            } else if (cur.status !== 'renamed') {
                // 이름이 바뀐 경우는 rename from/to 가 더 정확하다 (거기엔 접두가 없다)
                const old = stripSide(p)
                if (old !== cur.path) {
                    cur.oldPath = old
                }
            }
        } else if (raw.startsWith('+++ ')) {
            const p = unquotePath(raw.slice(4))
            if (p === '/dev/null') {
                cur.status = 'deleted'
            } else if (cur.status !== 'renamed') {
                cur.path = stripSide(p)
            }
        } else if (raw.startsWith('GIT binary patch')) {
            cur.binary = true
        } else {
            const bin = BINARY_RE.exec(raw)
            if (bin) {
                cur.binary = true
                // 이 줄은 경로를 공백 없이 `and` 로 갈라 줘서 공백 든 경로도 정확히 읽힌다
                const oldSide = unquotePath(bin[1])
                const newSide = unquotePath(bin[2])
                if (newSide !== '/dev/null') {
                    cur.path = stripSide(newSide)
                }
                if (oldSide === '/dev/null') {
                    cur.status = 'added'
                } else if (newSide === '/dev/null') {
                    cur.status = 'deleted'
                }
            }
        }
    }
    return files
}

/**
 * 헤더에 쓸 한 줄 요약. 변경이 없으면 그 사실을 그대로 문장으로 돌려준다 —
 * 부르는 쪽에서 빈 목록을 또 갈라 보지 않게 하기 위해서다.
 */
export function formatStat (files: DiffFile[]): string {
    const list = files ?? []
    if (!list.length) {
        return '변경 없음'
    }
    let added = 0
    let removed = 0
    for (const f of list) {
        added += f.added
        removed += f.removed
    }
    return list.length + '개 파일 · +' + added + ' -' + removed
}

/** 파일 목록에 붙일 상태 딱지 */
export function statusLabel (file: DiffFile): string {
    switch (file.status) {
        case 'added': return '신규'
        case 'deleted': return '삭제'
        case 'renamed': return '이름변경'
        default: return '수정'
    }
}

// ---------- `파일:라인` 참조 ----------
// 패널에서 줄을 골라 터미널에 넣는 기능(viewPanel.clickRefLine)이 쓰는 규칙들이다.
// 번호·경로·따옴표 판정은 전부 문자열 계산이라 여기 순수 함수로 두고 테스트로 못 박는다 —
// DOM 을 띄우지 않고는 확인할 수 없는 곳에 두면 회귀를 잡을 방법이 없다.

/** 윈도우 드라이브 접두(`D:`) — 이게 보이면 경로 비교를 대소문자 무시로 한다 */
const WIN_DRIVE_RE = /^[A-Za-z]:/

/** 경로 구분자를 `/` 로 맞춘다 — git 은 `/` 를, Tabby 의 cwd 는 OS 것(윈도우는 `\`)을 준다 */
function slash (p: string | null | undefined): string {
    return String(p ?? '').replace(/\\/g, '/')
}

/** 끝의 `/` 를 뗀다 (`D:/x/` 와 `D:/x` 가 다른 폴더로 비교되지 않게) */
function trimTail (p: string): string {
    return p.length > 1 ? p.replace(/\/+$/, '') : p
}

/**
 * 참조에 쓸 줄번호 — **신(新) 파일 기준**이다.
 *
 * 유니파이드 diff 에는 구/신 번호가 둘 다 있는데, 참조를 받는 에이전트는 **지금 디스크에 있는
 * 파일을 열어 본다.** 그 파일에서 맞는 번호는 신 번호뿐이다(구 번호는 커밋 전 원본의 좌표라
 * 작업트리와 어긋난다). 그래서 추가줄·문맥줄은 `newNo` 를 쓴다.
 *
 * **삭제줄은 `null` 을 돌려준다 = 참조 불가.** 삭제된 줄은 지금 파일에 없으므로 어떤 번호를
 * 붙여도 거짓이 된다. "직전 신 번호" 로 대신하면 `file:42` 가 삭제된 내용이 아니라 **엉뚱하게
 * 남아 있는 42번 줄**을 가리키고, 에이전트는 그 줄을 자신 있게 고친다 — 조용히 틀리는 쪽보다
 * 참조를 못 만들고 이유를 말하는 쪽이 낫다. 헝크 머리줄(`@@`)도 내용이 아니라 머리라 제외한다.
 */
export function refLineNo (line: DiffLine | null | undefined): number | null {
    if (!line || line.kind === 'del' || line.kind === 'hunk') {
        return null
    }
    const no = line.newNo
    return typeof no === 'number' && Number.isFinite(no) && no > 0 ? Math.floor(no) : null
}

/**
 * git 이 낸 저장소 루트 기준 경로를 절대경로로 바꾼다 (`/` 형태로).
 *
 * `path.join` 을 쓰지 않는 이유 — 윈도우에서 `\` 로 되돌아오는데, 참조 문자열은 git 이 보여 준
 * 모양(`src/a.ts`)과 같아야 사람이 화면과 대조할 수 있다. `/` 는 윈도우 셸·에이전트 모두 받는다.
 */
export function joinRefPath (root: string | null | undefined, rel: string): string {
    const r = slash(rel)
    if (!r) {
        return ''
    }
    const base = trimTail(slash(root))
    if (!base || r.startsWith('/') || WIN_DRIVE_RE.test(r)) {
        return r
    }
    return base + '/' + r
}

/**
 * 절대경로를 **그 탭의 cwd 기준 상대경로**로 줄인다. cwd 밖이면 절대경로를 그대로 돌려준다.
 *
 * 왜 cwd 기준인가 — 참조를 받는 에이전트는 그 탭의 cwd 에서 돌고 있어서 `src/a.ts` 가 곧바로
 * 열린다. 반대로 저장소 루트 기준을 그대로 넘기면 cwd 가 하위 폴더일 때 어긋난다.
 * cwd 밖(예: cwd 가 하위 폴더인데 파일은 상위에 있음)은 `../` 로 올라가지 않고 절대경로로 준다 —
 * 짧게는 되지만 에이전트가 cwd 밖 파일을 못 여는 경우가 있고, 그때 원인이 보이지 않는다.
 */
export function refPathFrom (abs: string, cwd: string | null | undefined): string {
    const a = slash(abs)
    if (!a) {
        return ''
    }
    const c = trimTail(slash(cwd))
    if (!c) {
        return a
    }
    // 윈도우 경로는 대소문자를 가리지 않는다 — `D:\Proj` 와 `d:/proj` 는 같은 폴더다.
    // POSIX 에서는 정말 다른 폴더일 수 있으므로 드라이브 접두가 보일 때만 무시한다
    const win = WIN_DRIVE_RE.test(a) || WIN_DRIVE_RE.test(c)
    const ka = win ? a.toLowerCase() : a
    const kc = win ? c.toLowerCase() : c
    if (ka === kc) {
        return a
    }
    return ka.startsWith(kc + '/') ? a.slice(c.length + 1) : a
}

/**
 * `파일:라인` 한 토큰을 만든다. 두 줄 이상이면 `파일:시작-끝`.
 *
 * **공백이 든 경로는 따옴표로 감싼다** — 그러지 않으면 셸이 두 인자로 쪼개 읽는다
 * (deck.service 의 `pasteDroppedPath` 와 같은 규칙, 같은 이유). 번호까지 함께 감싸서
 * 한 낱말로 남긴다. 경로에 따옴표 자체가 들어 있는 경우는 다루지 않는다 — 윈도우에서는
 * 파일명에 쓸 수 없는 글자이고, 드롭 붙여넣기도 같은 선에서 멈춰 있다.
 *
 * 번호가 없거나(0·NaN) 뒤집혀 있어도 값을 낸다 — 참조를 못 만들어 침묵하는 것보다 경로만이라도
 * 넣는 쪽이 사람이 이어 쓸 수 있다.
 */
export function formatLineRef (refPath: string, from?: number, to?: number): string {
    const p = String(refPath ?? '')
    if (!p) {
        return ''
    }
    const a = Number(from)
    const b = Number(to ?? from)
    const okA = Number.isFinite(a) && a > 0
    const okB = Number.isFinite(b) && b > 0
    let ref = p
    if (okA || okB) {
        const lo = Math.floor(Math.min(okA ? a : b, okB ? b : a))
        const hi = Math.floor(Math.max(okA ? a : b, okB ? b : a))
        ref = p + ':' + lo + (hi > lo ? '-' + hi : '')
    }
    return /\s/.test(ref) ? '"' + ref + '"' : ref
}

// ---------- 이 세션이 만진 것만 ----------
// 왜 필요한가 — `git diff HEAD` 는 **저장소가 커밋되지 않은 전부**를 낸다. 그게 맞는 저장소도
// 있지만, P4 워크스페이스 위에 git 을 얹어 쓰는 곳에서는 마지막 커밋 이후 sync 된 것이 전부
// 걸려 수백 개가 뜬다 (마지막 커밋이 한참 전이면 그 사이 받은 것이 전부 변경으로 잡힌다).
// 그 목록에서 "방금 에이전트가 뭘 고쳤나" 를 찾는 것은 불가능하다.
//
// 그래서 훅이 알려 준 **이번 세션이 만진 파일**로 목록을 좁힌다. 판정은 문자열 계산뿐이라
// 여기 순수 함수로 두고 테스트로 고정한다 (refLineNo·joinRefPath 를 여기 둔 것과 같은 이유).

/** 경로 비교용 열쇠 — 구분자를 `/` 로 맞추고, 윈도우 경로면 대소문자를 무시한다 */
function pathKey (p: string): string {
    const s = trimTail(slash(p))
    return WIN_DRIVE_RE.test(s) ? s.toLowerCase() : s
}

/**
 * 저장소 루트 기준 경로(`src/a.ts`)들 중 **만진 목록에 있는 것**만 남긴다.
 *
 * `touched` 는 훅이 준 절대경로다. 루트를 붙여 절대경로로 맞춘 뒤 비교한다 —
 * 반대로 touched 를 상대경로로 줄이면 루트 밖의 파일(다른 저장소·임시 폴더)이 조용히
 * 같은 이름에 걸린다.
 *
 * **빈 목록이면 그대로 돌려준다** = 필터를 걸 근거가 없다는 뜻(훅이 없는 에이전트, 아직 아무것도
 * 안 고친 세션). 이때 빈 화면을 보여 주면 "변경이 없다" 는 거짓말이 된다.
 */
export function filterTouched<T> (items: readonly T[], pathOf: (item: T) => string,
    root: string | null | undefined, touched: readonly string[]): T[] {
    const list = items ?? []
    if (!touched || !touched.length) {
        return [...list]
    }
    const want = new Set(touched.map(t => pathKey(t)))
    return list.filter(item => want.has(pathKey(joinRefPath(root, pathOf(item)))))
}

/**
 * `git status --porcelain` 에서 추적되지 않는 파일(`??`)의 경로만 뽑는다.
 *
 * 내용 diff 는 하지 않는다 — 새로 만든 파일은 전부 추가줄이라 diff 를 붙여도 정보가 없고,
 * 에이전트가 만든 큰 산출물(로그·이미지)이 그대로 딸려 들어와 패널이 굳는다.
 */
export function parseUntracked (text: string): string[] {
    const out: string[] = []
    for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
        if (!raw.startsWith('?? ')) {
            continue
        }
        const p = unquotePath(raw.slice(3))
        if (p) {
            out.push(p)
        }
    }
    return out
}
