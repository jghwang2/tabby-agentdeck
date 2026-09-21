/**
 * 미리보기 패널의 순수 로직 — 파일 종류 판정, PTY 출력에서 경로 줍기, 최근 목록 관리.
 *
 * DOM 도 fs 도 건드리지 않는다. 이 파일만 테스트로 묶어 두고(test/viewer.test.js),
 * 화면·파일 접근은 viewPanel.ts 가 맡는다 — dock.ts / deck.service.ts 를 가른 것과 같은 방식이다.
 *
 * **왜 에이전트 훅이 아니라 화면 출력에서 경로를 줍나 —** 훅이 있는 것은 Claude Code 뿐이다
 * (src/claudeHooks.ts). Codex·Gemini 도 같은 패널을 쓰게 하려면 셋이 공통으로 하는 일에
 * 기대야 하고, 그건 "만진 파일 경로를 화면에 찍는다" 다. 그래서 이 경로가 기본이고
 * 훅은 나중에 정확도를 더하는 보강일 뿐이다.
 */

export type ViewKind = 'markdown' | 'image' | 'table' | 'text' | 'binary'

/** 확장자로 판정한다 — 내용을 열어 보는 것은 패널이 하는 일이고 여기서는 분류만 한다 */
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
const MARKDOWN_EXT = ['md', 'markdown', 'mdx']
const TABLE_EXT = ['csv', 'tsv']
/** 글자로 열어도 되는 것 — 여기 없는 확장자는 열지 않고 크기만 알려준다 */
const TEXT_EXT = [
    'txt', 'log', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env',
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'py', 'rb', 'go', 'rs', 'java', 'kt',
    'c', 'h', 'cpp', 'hpp', 'cc', 'php', 'lua', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'psm1',
    'bat', 'cmd', 'html', 'htm', 'xml', 'svelte', 'vue', 'css', 'scss', 'sass', 'less',
    'diff', 'patch', 'gitignore', 'editorconfig', 'dockerfile', 'makefile', 'gradle', 'proto',
]

/** 최근 목록에 올릴 만한 확장자 — 위 목록 전부 + 눌러서 열 수 있는 것들 */
const KNOWN_EXT = new Set([...IMAGE_EXT, ...MARKDOWN_EXT, ...TABLE_EXT, ...TEXT_EXT])

export function extensionOf (file: string): string {
    const base = String(file ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
    const dot = base.lastIndexOf('.')
    if (dot <= 0) {
        // 확장자가 없는 관용 파일들 (Dockerfile, Makefile …)
        return base.toLowerCase()
    }
    return base.slice(dot + 1).toLowerCase()
}

export function classify (file: string): ViewKind {
    const ext = extensionOf(file)
    if (IMAGE_EXT.includes(ext)) {
        return 'image'
    }
    if (MARKDOWN_EXT.includes(ext)) {
        return 'markdown'
    }
    if (TABLE_EXT.includes(ext)) {
        return 'table'
    }
    if (TEXT_EXT.includes(ext)) {
        return 'text'
    }
    return 'binary'
}

/** 미리보기로 열어 볼 가치가 있는 확장자인가 — PTY 에서 주운 경로를 거르는 데 쓴다 */
export function isKnownExt (file: string): boolean {
    return KNOWN_EXT.has(extensionOf(file))
}

/**
 * ANSI 제어 시퀀스와 TUI 가 그리는 테두리 문자를 걷어낸다.
 *
 * 경로를 주우려면 필요하다 — 에이전트 TUI 는 `│ Edited src/a.ts │` 처럼 테두리 안에 글자를
 * 그리고, 색을 붙이려고 경로 중간에 SGR 을 끼워 넣기도 한다.
 */
export function stripAnsi (data: string): string {
    return String(data ?? '')
        // CSI (색·커서 이동 등) / OSC (제목 등) / 단독 ESC 시퀀스
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b[@-Z\\-_]/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        // 박스 드로잉·블록 문자는 공백으로 (경로에 붙어 있으면 토큰이 깨진다)
        .replace(/[\u2500-\u257f\u2580-\u259f]/g, ' ')
}

/**
 * 경로처럼 보이는 토큰.
 *
 * 세 갈래를 본다 — Windows 절대경로(`D:\a\b.md`), POSIX 절대/상대경로(`/a/b.md`, `src/a.ts`),
 * 그리고 구분자 없는 파일명(`hero.tsx`). 마지막 갈래가 필요한 이유는 에이전트가 `Edited hero.tsx`
 * 처럼 파일명만 찍는 경우가 많아서다 (스크린샷의 Codex 도 그렇다).
 */
/**
 * 경로 글자에 `À-￿` 를 넣는 이유 — 한글 파일명(`docs/소개.md`)을 놓치지 않기 위해서다.
 * `\w` 는 u 플래그 없이는 ASCII 만 본다. 대신 그 범위에 딸려 오는 기호(`…`, `→`, 전각 괄호)는
 * 아래 PUNCT 로 걸러낸다.
 */
const PATH_CHAR = '[\\w\\u00c0-\\uffff.@+~-]'
const PATH_RE = new RegExp(
    '(?:[A-Za-z]:[\\\\/]|\\.{0,2}[\\\\/])?'
    + '(?:' + PATH_CHAR + '+[\\\\/])*' + PATH_CHAR + '+\\.[A-Za-z0-9]{1,8}',
    'g',
)

/** 경로에 들어갈 수 없는 기호 — 하나라도 있으면 경로가 아니다 (잘림 표시 `…`, 화살표, 전각 문자) */
const PUNCT = /[\u2000-\u206f\u2190-\u2bff\u3000-\u303f\uff00-\uffef]/

/** 경로 뒤에 붙어 오는 문장부호 — 잘라낸다 */
const TRAILING = /[),.;:'"`\]}]+$/

/**
 * 출력 한 조각에서 파일 경로 후보를 뽑는다.
 *
 * 여기서는 **후보까지만** 낸다 — 실제로 있는 파일인지, 상대경로를 어느 cwd 로 푸는지는
 * 패널이 fs 로 확인한다. 순수 함수로 남겨 두면 규칙을 테스트로 고정할 수 있다.
 *
 * 걸러내는 것: 확장자를 모르는 것 / 잘려서 `…` 이 들어간 것 / URL / 버전 번호처럼 보이는 것.
 */
export function extractPaths (data: string): string[] {
    const clean = stripAnsi(data)
    const out: string[] = []
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    PATH_RE.lastIndex = 0
    while ((m = PATH_RE.exec(clean)) !== null) {
        let token = m[0].replace(TRAILING, '')
        if (!token || PUNCT.test(token)) {
            continue
        }
        // URL 의 일부(`example.com/a.png`)는 로컬 파일이 아니다
        const before = clean.slice(Math.max(0, m.index - 3), m.index)
        if (/:\/\/?$/.test(before) || /^https?$/i.test(token.split(/[\\/]/)[0] ?? '')) {
            continue
        }
        if (!isKnownExt(token)) {
            continue
        }
        // `1.2.3` / `v0.3.0` 같은 버전 문자열이 확장자 규칙에 걸리는 것을 막는다
        if (/^[vV]?[\d.]+$/.test(token)) {
            continue
        }
        token = token.replace(/^\.[\\/]/, '')
        if (!seen.has(token)) {
            seen.add(token)
            out.push(token)
        }
    }
    return out
}

/**
 * 자동으로 **띄우지는 않을** 파일 — 에이전트·에디터의 설정 파일들.
 *
 * 왜 거르나 — 에이전트는 기동할 때 자기 설정 파일 경로를 화면에 찍는 일이 잦다(훅 경고, 권한
 * 안내 등). 그러면 세션을 열자마자 미리보기가 `settings.json` 으로 갈린다. 사람이 그때 보려던
 * 것은 방금 만든 작업 파일이지 설정이 아니다 (2026-09-11 유저 지적: "무조건 열어줄 이유는 없어").
 *
 * **목록(칩)에서는 빼지 않는다.** 설정 파일을 진짜로 손볼 때는 칩을 눌러 열면 되고, 그때는
 * 사람이 명시로 고른 것이라 이 규칙과 어긋나지 않는다. 거르는 것은 "스스로 띄우기"뿐이다.
 *
 * 이름만 보는 이유 — 같은 파일이 `~/.claude/`, 프로젝트 `.claude/`, `.vscode/` 어디에나 있고
 * 폴더까지 조건에 넣으면 한 곳이 늘 빠진다. 반대로 이름이 이 꼴인 **작업 대상** 파일을 자동으로
 * 안 띄우는 손해는 칩 한 번 누르는 것으로 끝난다.
 */
const AUTO_FOLLOW_SKIP_RE = /^(?:\.?claude\.json|settings(?:\.[\w-]+)?\.json)$/i

/** Agent instructions are background context, not artifacts merely because a read prints their path. */
export function isInstructionFile (file: string): boolean {
    const base = String(file ?? '').split(/[\\/]/).pop() ?? ''
    return /^(?:claude(?:\.local)?|agents(?:\.override)?|skill)\.md$/i.test(base)
}

/**
 * 이 파일을 **스스로 띄워도 되는가** (`false` = 칩에만 쌓고 화면은 그대로 둔다).
 */
export function isAutoFollowable (file: string): boolean {
    const base = String(file ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
    return !!base && !AUTO_FOLLOW_SKIP_RE.test(base)
}

/**
 * 최근 목록에 하나를 얹는다 (같은 것은 위로 올리고, 최대 개수를 넘으면 뒤를 버린다).
 * 원본을 바꾸지 않고 새 배열을 돌려준다 — 렌더가 이전 배열과 비교할 수 있어야 한다.
 */
export function pushRecent (list: readonly string[], file: string, max: number): string[] {
    const next = [file, ...list.filter(f => f !== file)]
    return next.slice(0, Math.max(1, max))
}

/**
 * CSV/TSV 한 장을 표로 가른다.
 *
 * 따옴표로 감싼 칸(`"a,b"`)과 그 안의 이스케이프(`""`)까지만 본다 — 기획데이터를 편집하는
 * 도구가 아니라 눈으로 확인하는 미리보기라서 그 이상은 필요하지 않다.
 */
export function parseDelimited (text: string, delimiter = ','): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    const src = String(text ?? '').replace(/\r\n?/g, '\n')
    for (let i = 0; i < src.length; i++) {
        const ch = src[i]
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    cell += '"'
                    i++
                } else {
                    quoted = false
                }
            } else {
                cell += ch
            }
            continue
        }
        if (ch === '"') {
            quoted = true
        } else if (ch === delimiter) {
            row.push(cell)
            cell = ''
        } else if (ch === '\n') {
            row.push(cell)
            rows.push(row)
            row = []
            cell = ''
        } else {
            cell += ch
        }
    }
    if (cell || row.length) {
        row.push(cell)
        rows.push(row)
    }
    return rows
}

/** 확장자로 구분자를 고른다 */
export function delimiterFor (file: string): string {
    return extensionOf(file) === 'tsv' ? '\t' : ','
}

export function formatBytes (bytes: number): string {
    const n = Number(bytes)
    if (!isFinite(n) || n < 0) {
        return '?'
    }
    if (n < 1024) {
        return n + ' B'
    }
    if (n < 1024 * 1024) {
        return (n / 1024).toFixed(1) + ' KB'
    }
    return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * 새 파일을 주웠을 때 패널이 스스로 무엇을 할지.
 *
 *  - `open`   : 닫혀 있으면 **열면서** 띄운다
 *  - `show`   : 읽어만 둔다 — 열려 있으면 그 자리에 띄우고, 닫혀 있으면 **다음에 열 때** 보이게
 *               대상만 갈아 둔다 (기본). 스스로 열지는 않는다
 *  - `manual` : 아무것도 하지 않는다. 경로는 최근 칩에만 쌓이고 여닫기·고르기는 사람 몫이다
 *
 * 사용자에게는 이게 목록이 아니라 **토글 두 개**로 보인다 (`viewerPreload`/`viewerAutoOpen`) —
 * `followModeOf` 가 그 둘을 여기로 접는다. 안쪽을 셋으로 유지하는 이유는 판정이 세 갈래이고
 * (`planFollow`) 테스트가 그 표를 계약으로 박아 두었기 때문이다.
 */
export type FollowMode = 'open' | 'show' | 'manual'

const FOLLOW_MODES: readonly FollowMode[] = ['open', 'show', 'manual']

/**
 * 토글 두 개를 모드로 접는다.
 *
 *  - 읽어두기 끔                → `manual` (자동으로 열기는 의미가 없어진다)
 *  - 읽어두기 + 자동으로 열기   → `open`
 *  - 읽어두기만                 → `show` (기본)
 *
 * 두 축으로 가른 이유 — 목록 하나로는 "내용을 채워 둘까" 와 "화면을 빼앗아도 될까" 를 한 번에
 * 골라야 했다. 사람이 실제로 정하고 싶은 것은 그 둘이 따로다 (2026-09-10 유저 결정:
 * "읽어두기는 켜고, 자동으로 열기는 꺼라 — 내가 열면 그때까지 만진 게 보이면 된다").
 */
export function followModeOf (preload: unknown, autoOpen: unknown): FollowMode {
    if (preload === false) {
        return 'manual'
    }
    return autoOpen === true ? 'open' : 'show'
}

/**
 * 옛 설정을 토글 두 개로 옮긴다 — 기동 때 **한 번만** 돈다 (`migrateFollowConfig`).
 *
 * 고른 적이 없으면 `null` 을 주고, 그러면 새 기본값(읽어두기 ON / 자동열기 OFF)이 그대로 쓰인다.
 * 읽는 시점에 옛 값을 보는 방식(0.17.0 의 `followMode(raw, legacy)`)을 버린 이유는, 토글은
 * boolean 이라 "아직 안 골랐다" 를 표현할 자리가 없어서다 — 빈 값을 두면 토글이 꺼져 보이는데
 * 실제 동작은 켜져 있는 상태가 된다. 그래서 한 번 적고 옛 값을 비운다.
 */
export function migrateFollow (raw: unknown, legacy?: unknown): { preload: boolean, autoOpen: boolean } | null {
    const chosen = typeof raw === 'string' && (FOLLOW_MODES as readonly string[]).includes(raw)
        ? raw as FollowMode
        : legacy === false ? 'manual' : null
    if (!chosen) {
        return null
    }
    return { preload: chosen !== 'manual', autoOpen: chosen === 'open' }
}

/**
 * 새 파일을 주웠다 — 지금 무엇을 할까.
 *
 *  - `none`  : 아무것도 하지 않는다 (칩만 쌓인다)
 *  - `show`  : 이미 열려 있으니 그 자리에 띄운다
 *  - `open`  : 닫혀 있으니 열면서 띄운다
 *  - `stage` : 닫혀 있다 — 그리지 않고 **대상만 갈아 둔다.** 사람이 여는 순간 이 파일이 보인다
 *
 * `stage` 를 둔 이유 — 예전에는 이 자리가 `none` 이라, 닫아 두고 일하다 패널을 열면 **아까
 * 보던 옛 파일**이 떠 있었다(`lastViewed` 가 그때 멈춰 있었다). "작업 막 진행하다가 패널을
 * 열면 지금까지 건드린 것이 보여야 한다" 가 이 패널의 요점이므로, 열지는 않되 읽어는 둔다.
 *
 * **편집 중에는 무조건 `none`** 이다 — 자동으로 화면을 바꾸면 사람이 치던 것을 밀어낸다.
 * 모드보다 이 규칙이 앞선다.
 */
export function planFollow (mode: FollowMode, opened: boolean, editing: boolean): 'none' | 'show' | 'open' | 'stage' {
    if (editing || mode === 'manual') {
        return 'none'
    }
    if (opened) {
        return 'show'
    }
    return mode === 'open' ? 'open' : 'stage'
}
