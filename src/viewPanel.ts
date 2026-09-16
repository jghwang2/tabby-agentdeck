/**
 * 결과물 미리보기 패널 — 터미널 옆에서 md·이미지·표·텍스트를 그대로 본다.
 *
 * 왜 필요한가: 에이전트가 만든 것이 문서(md)나 그림이면 터미널 안에서는 확인이 안 된다.
 * 지금까지는 탐색기로 나가서 열었고, 그 왕복이 "작업 결과를 안 보고 넘어가는" 이유였다.
 * Codex 앱의 오른쪽 패널이 하는 일과 같은 자리다.
 *
 * **어느 에이전트에도 매이지 않는다** — 보여줄 파일을 고르는 근거가 세 갈래인데 셋 다
 * 특정 CLI 의 기능이 아니다. ① 화면에 찍힌 경로를 줍는다(Claude·Codex·Gemini 가 모두 찍는다)
 * ② 사람이 경로를 넣거나 파일을 끌어다 놓는다 ③ 최근 목록에서 고른다.
 *
 * 이 파일이 하는 일은 DOM 과 파일 접근이다. 판정 로직(종류 분류·경로 줍기·최근 목록)은
 * viewer.ts 에, 마크다운 렌더는 markdown.ts 에 순수 함수로 있다 — dock.ts 를 deck.service 에서
 * 가른 것과 같은 이유(테스트로 묶기 위해서)다.
 */

import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { renderMarkdown, escapeHtml } from './markdown'
import {
    classify, isKnownExt, extractPaths, pushRecent, parseDelimited, delimiterFor, formatBytes,
    FollowMode, planFollow, isAutoFollowable,
} from './viewer'
import {
    DiffFile, DiffLine, parseUnifiedDiff, parseUntracked, formatStat, statusLabel,
    refLineNo, joinRefPath, refPathFrom, formatLineRef, filterTouched,
} from './gitDiff'
import {
    StatusEntry, parseStatus, stageArgs, unstageArgs, unstageFallbackArgs, commitArgs,
    validateMessage, formatStageSummary, hasStaged, stageLabel,
} from './gitCommit'

export type ViewSide = 'left' | 'right'

/**
 * 패널이 보여주는 두 갈래.
 * - `file` = 결과물 하나 (md·이미지·표·코드)
 * - `diff` = 작업트리의 변경 전체 (`git diff` 기준 — 어느 에이전트가 고쳤든 성립한다)
 *
 * 설정에 저장하지 않는다 — 어떤 파일을 보고 있었는지도 저장하지 않으므로 모드만 복원하면
 * 기동 직후 빈 `변경` 탭이 뜬다. 시작은 항상 `file` 이다.
 */
export type ViewMode = 'file' | 'diff'

export interface ViewHost {
    /** 패널을 얹을 `.window` */
    windowEl: HTMLElement
    getSide (): ViewSide
    getWidth (): number
    setWidth (px: number): void
    getRecentMax (): number
    /** 새 파일을 주웠을 때 읽어둘지·스스로 열지 (`viewerPreload` + `viewerAutoOpen`) */
    getFollowMode (): FollowMode
    /** 상대경로를 풀 기준 디렉토리 — 그 탭의 cwd. 모르면 null */
    cwdFor (tab: object): string | null
    /**
     * 이번 세션에서 에이전트가 고친 파일(절대경로). `변경` 탭의 '세션' 목록이 이걸 쓴다.
     *
     * **빈 배열 = "모른다"** (훅 없는 에이전트이거나 아직 안 고쳤다). 그래서 비면 좁히지 않는다.
     * 선택(optional)인 이유는 `sendText` 와 같다 — 배선이 없어도 패널은 동작해야 한다.
     */
    touchedFor? (tab: object): string[]
    /** 드래그가 끝났을 때 한 번 — config.save() 를 부르라는 뜻 */
    commit (): void
    /** 크기·열림 상태가 바뀌었으니 레이아웃을 다시 잡으라는 뜻 */
    relayout (): void
    /** 열림 상태를 설정에 적는다 (다음 기동에 복원) */
    setOpen (open: boolean): void
    /** 외부 링크를 기본 브라우저로 */
    openExternal (url: string): void
    /**
     * 고른 줄의 참조(`파일:라인`)를 **활성 탭 터미널에 넣는다.** 개행은 붙이지 않는다 —
     * 사용자가 앞뒤에 말을 붙일 자리를 남긴다.
     *
     * 돌려주는 값은 "보냈는가" — 보낼 팬이 없으면 false 를 주고, 그 사실은 패널이 문장으로 말한다.
     * **선택(optional)인 이유** — 배선이 아직 없어도 패널은 동작해야 한다(참조만 못 넣는다).
     */
    sendText? (text: string): boolean
}

export const VIEW_ID = 'agentdeck-view'

/** 패널이 이보다 좁으면 문서를 읽을 수 없다 */
export const MIN_VIEW_W = 260

/** 한 번에 읽어 들이는 글자 파일의 상한 — 이보다 크면 앞부분만 보여준다 */
const MAX_TEXT_BYTES = 1_500_000
/** 글자 파일에서 그리는 최대 줄 수 */
const MAX_TEXT_LINES = 4000
/** 표에서 그리는 최대 행/열 */
const MAX_TABLE_ROWS = 400
const MAX_TABLE_COLS = 60
/** data URL 로 만들 이미지의 상한 — 이보다 크면 안 읽는다 (렌더러 메모리에 그대로 올라간다) */
const MAX_IMAGE_BYTES = 25_000_000
/** 마크다운 안의 이미지를 data URL 로 바꿔 줄 상한 */
const MAX_INLINE_IMAGE_BYTES = 4_000_000
/** PTY 출력을 모아 두고 경로를 훑는 주기 (ms) — 조각마다 정규식을 돌리지 않기 위한 것 */
const SCRAPE_DEBOUNCE_MS = 400

/**
 * 편집 모드로 열 수 있는 글자 파일의 상한.
 *
 * 보기 상한(`MAX_TEXT_BYTES`)과 같은 값을 쓰되 **뜻이 다르다** — 보기는 앞부분만 읽어도 되지만
 * 편집은 저장할 때 파일 전체를 다시 쓰므로, 앞부분만 들고 저장하면 **뒷부분이 사라진다.**
 * 그래서 편집은 전체를 읽을 수 있을 때만 연다(`readTextAll` 이 잘렸다고 하면 보기 전용).
 */
const MAX_EDIT_BYTES = MAX_TEXT_BYTES

/** 검색에서 한 번에 표시하는 최대 일치 수 — 이보다 많으면 앞에서부터 이만큼만 오간다 */
const MAX_FIND_HITS = 2000
/** 그 사이 모아 두는 출력의 상한 (글자) */
const SCRAPE_BUFFER_MAX = 16384
/** 열어 둔 파일이 바뀌었는지 보는 주기 (ms) */
const WATCH_INTERVAL_MS = 1000

// ---------- `변경` 탭 (git) ----------
// 설정키를 새로 만들지 않고 모듈 상수로 둔다 — 이 수치들은 "패널이 굳지 않는 선" 이고
// 사용자가 고를 이유가 없다.
/** git 한 번에 기다려 주는 시간 (ms). 이보다 걸리면 저장소가 아니거나 잠겨 있는 것으로 본다 */
const GIT_TIMEOUT_MS = 5000
/** git 출력 상한 — package-lock 한 장만 바뀌어도 기본값 1MB 를 넘는다 */
const GIT_MAX_BUFFER = 32 * 1024 * 1024
/** 목록에 그리는 파일 수 상한 */
const MAX_DIFF_FILES = 200
/** 본문에 그리는 총 줄 수 상한 — DOM 노드가 이 수에 비례한다 */
const MAX_DIFF_LINES = 20000
/** 한 파일이 본문 예산을 다 먹지 않게 하는 파일별 상한 */
const MAX_DIFF_FILE_LINES = 4000
/** 추적되지 않는 파일 목록의 상한 */
const MAX_UNTRACKED = 100
/**
 * 자동 갱신 최소 간격 (ms). 에이전트가 파일을 연달아 고치면 훑기(400ms)마다 신호가 오는데,
 * 그때마다 git 을 돌리면 프로세스가 겹친다.
 */
const DIFF_AUTO_MS = 1500

// ---------- `파일:라인` 참조 ----------
/**
 * 참조를 넣은 뒤 안내줄이 켜진 채로 있는 시간 (ms).
 * 켜 둔 채로 놔두면 다음에 무엇이 새로 일어났는지 구별이 안 된다.
 */
const REF_FLASH_MS = 2500
/**
 * 직전에 넣은 참조에 **이어 붙일 수 있다고 보는 시간** (ms).
 *
 * 이보다 오래 지났으면 사람이 그 사이에 문장을 쳤다고 보고 참조를 처음부터 다시 넣는다 —
 * 프롬프트 내용을 우리가 읽을 수 없으므로 시간이 유일한 단서다.
 */
const REF_CHAIN_MS = 15000

const MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    svg: 'image/svg+xml',
}

/**
 * 여러 줄 git 출력에서 사람에게 보여줄 첫 줄만 뽑는다 — 패널의 알림줄은 한 줄이고,
 * git 은 실패 이유를 여러 줄(+빈 줄)로 쓴다.
 */
function firstLine (s: string): string {
    const t = String(s ?? '').split('\n').map(v => v.trim()).filter(v => v)[0] ?? ''
    return t.length > 200 ? t.slice(0, 200) + '…' : t
}

/**
 * 파일 한 줄에 붙일 꼬리말 — `12.3 KB · 22:41`. 사라졌으면 그 사실을 말한다.
 *
 * git 없이 그리는 목록(`noGit`)에서 쓴다. diff 를 못 만드는 자리라 **언제 얼마나** 가
 * 사람에게 남는 유일한 단서다. 시각은 날짜를 빼고 시:분만 — 이 목록은 지금 도는 세션의
 * 것이라 오늘 안이고, 폭이 좁은 패널에서 날짜까지 넣으면 경로가 밀린다.
 */
function fileNote (target: string): string {
    try {
        const st = fs.statSync(target)
        if (st.isDirectory()) {
            return '폴더'
        }
        const t = new Date(st.mtimeMs)
        const hh = String(t.getHours()).padStart(2, '0')
        const mm = String(t.getMinutes()).padStart(2, '0')
        return formatBytes(st.size) + ' · ' + hh + ':' + mm
    } catch {
        // 만졌지만 지금은 없다 — 에이전트가 지웠거나 옮겼다. 목록에서 빼지 않는다:
        // "사라졌다" 는 것 자체가 사람이 알아야 할 변화다
        return '지금은 없다'
    }
}

/** git 을 돌릴 자리인가 — 없거나 파일이면 false */
function isDir (target: string): boolean {
    try {
        return fs.statSync(target).isDirectory()
    } catch {
        return false
    }
}

function mimeOf (file: string): string {
    return MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

function dataUrl (file: string, limit: number): string | null {
    try {
        const st = fs.statSync(file)
        if (!st.isFile() || st.size > limit) {
            return null
        }
        return 'data:' + mimeOf(file) + ';base64,' + fs.readFileSync(file).toString('base64')
    } catch {
        return null
    }
}

/** BOM 을 떼고 읽는다 — 이 프로젝트의 .cs / .md 는 BOM 이 붙어 있는 것이 많다 */
function readTextHead (file: string, limit: number): { text: string, truncated: boolean } {
    const buf = fs.readFileSync(file)
    const cut = buf.length > limit
    let text = buf.slice(0, cut ? limit : buf.length).toString('utf8')
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1)
    }
    return { text, truncated: cut }
}

/**
 * 이 파일에 쓸 수 있나. **편집을 열기 전에** 본다 — 다 쳐 놓고 저장할 때야 알면 그 타이핑이
 * 통째로 헛일이 된다.
 *
 * 이 리포를 쓰는 환경에서 읽기 전용의 가장 흔한 정체는 **P4 에서 체크아웃하지 않은 파일**이다
 * (`p4 sync` 가 읽기 전용으로 내려 준다). 그래서 안내 문구가 `p4 edit` 를 같이 말한다.
 */
function isWritable (file: string): boolean {
    try {
        fs.accessSync(file, fs.constants.W_OK)
        return true
    } catch {
        return false
    }
}

/**
 * 편집용으로 파일 **전체**를 읽는다. 보기와 달리 앞부분만 읽어서는 안 된다 — 저장이 파일을
 * 통째로 다시 쓰기 때문이다. 한도를 넘으면 `truncated: true` 로만 알리고 편집을 열지 않는다.
 *
 * 원본의 **BOM 과 개행**을 같이 돌려주는 이유: 이 프로젝트의 `.cs`·`.md` 는 BOM 이 붙은 것이
 * 많고, 리포에 따라 CRLF 인 파일도 있다. textarea 는 값을 읽을 때 개행을 LF 로 정규화하므로,
 * 저장할 때 원래대로 되돌리지 않으면 **파일 전체가 바뀐 것으로 보인다**(P4/git diff 가 전 줄
 * 변경으로 뜬다).
 */
function readTextAll (file: string, limit: number): {
    text: string, truncated: boolean, bom: boolean, crlf: boolean,
} {
    const buf = fs.readFileSync(file)
    if (buf.length > limit) {
        return { text: '', truncated: true, bom: false, crlf: false }
    }
    let text = buf.toString('utf8')
    const bom = text.charCodeAt(0) === 0xfeff
    if (bom) {
        text = text.slice(1)
    }
    // 섞여 있으면 CRLF 로 본다 — 다수결이 아니라 "하나라도 CRLF 면 그 리포의 규칙" 이라는 뜻
    const crlf = text.indexOf('\r\n') >= 0
    return { text: crlf ? text.replace(/\r\n/g, '\n') : text, truncated: false, bom, crlf }
}

export class ViewPanel {
    private el: HTMLElement | null = null
    private bodyEl: HTMLElement | null = null
    private tabsEl: HTMLElement | null = null
    private titleEl: HTMLElement | null = null
    private footEl: HTMLElement | null = null
    private pathRow: HTMLElement | null = null
    private pathInput: HTMLInputElement | null = null
    private modesEl: HTMLElement | null = null
    private scopeBtn: HTMLButtonElement | null = null
    /**
     * `변경` 목록의 범위. `session` = 이번 세션이 만진 파일만, `all` = 저장소의 커밋 안 된 전부.
     *
     * **기본이 `session` 인 이유** — `git diff HEAD` 는 저장소 사정에 따라 수백 개가 나온다
     * (큰 워크스페이스 위의 git 오버레이에서는 흔한 일이다). 그 안에서 방금 에이전트가
     * 고친 것을 찾을 수는 없다. 설정에 저장하지 않는다 — 모드(`file`/`diff`)와 같은 이유로
     * 기동 때는 늘 기본값에서 시작한다.
     */
    private diffScope: 'session' | 'all' = 'session'
    /** 마지막 `변경` 갱신에서 범위 때문에 접힌 파일 수 — 안내줄이 쓴다 */
    private diffHidden = 0
    /** 마지막 좁히기의 입력·결과 (진단용, `__agentdeck.view().diffDebug`) */
    private diffDebug: unknown = null
    private commitEl: HTMLElement | null = null
    private commitInput: HTMLInputElement | null = null
    private commitBtn: HTMLButtonElement | null = null
    private commitSumEl: HTMLElement | null = null
    private commitNoteEl: HTMLElement | null = null
    private refNoteEl: HTMLElement | null = null

    // ---------- `파일:라인` 참조 ----------
    /**
     * 지금 고른 줄 (`파일` 은 절대경로, `변경` 은 저장소 루트 기준 경로 — DOM 의
     * `data-ad-ref-file` 값과 같은 문자열이다).
     *
     * **본문이 아니라 클래스 필드에 둔다.** `변경` 본문은 자동 갱신(DIFF_AUTO_MS)마다
     * innerHTML 을 다시 쓰므로 화면에 붙여 둔 강조(`ad-ref-sel`)는 그때 통째로 사라진다.
     * 여기에 두면 렌더 끝에 `applyRefSel()` 이 같은 줄에 클래스를 다시 붙일 수 있다 —
     * 커밋·찾기 줄을 본문 밖에 둔 것과 같은 사정이다.
     */
    private refSel: { file: string, from: number, to: number } | null = null
    /**
     * 마지막으로 터미널에 넣은 참조와 그 시각. 다음 참조가 이것의 접두면 **늘어난 꼬리만**
     * 보내 프롬프트에 `a.ts:12a.ts:12-20` 이 쌓이는 것을 막는다 (sendRef 참조).
     */
    private refLastSent: { text: string, at: number } | null = null
    /** 안내줄의 강조를 떼는 타이머 (REF_FLASH_MS) */
    private refFlashTimer: any = null

    private mode: ViewMode = 'file'
    /**
     * 지금 기다리는 git 호출의 번호. 응답이 돌아왔을 때 이 값이 바뀌어 있으면 버린다 —
     * 탭을 옮기거나 ⟳ 를 연달아 누르면 늦게 온 응답이 새 화면을 덮는다.
     */
    private diffSeq = 0
    /** 마지막 자동 갱신 시각 (ms) — DIFF_AUTO_MS 간격 제한용 */
    private diffAutoAt = 0
    /** `변경` 본문의 경로를 눌렀을 때 쓸 저장소 루트 (git 이 내는 경로가 이 기준이다) */
    private diffRoot: string | null = null
    /** 마지막으로 읽은 `git status` — 커밋 줄의 요약과 "올린 게 없다" 판정의 근거 */
    private statusEntries: StatusEntry[] = []
    /** 위 목록의 경로 색인 — 파일 목록 한 줄마다 딱지를 붙일 때 찾는다 */
    private statusByPath = new Map<string, StatusEntry>()
    /**
     * 커밋 버튼이 "확인 대기" 인가. **첫 누름은 확인만, 두 번째 누름이 실제 커밋이다** —
     * 커밋은 되돌리기 번거로운 부작용이라 한 번의 오클릭(또는 자동화의 맹목적 click)으로
     * 만들어지면 안 된다. 메시지를 고치거나 모드를 옮기면 풀린다.
     */
    private commitArmed = false
    /** git 이 도는 중 — 스테이지 딱지를 연달아 누르면 add/reset 이 겹쳐 순서가 뒤집힌다 */
    private gitBusy = false

    private opened = false
    /** 레이아웃 자체가 꺼져 있으면(agentDeck.enabled=false) 열려 있어도 그리지 않는다 */
    private visible = true
    /** 지금 보고 있는 파일 (절대경로) */
    private current: string | null = null
    /** 파일 감시 중인 경로 — 바꿀 때 반드시 해제한다 */
    private watching: string | null = null

    /** 탭별 최근 파일. 탭이 닫히면 같이 사라지도록 WeakMap */
    private recent = new WeakMap<object, string[]>()
    /**
     * 탭별로 **마지막에 보던 파일**. 최근 목록의 맨 앞과 다를 수 있다 — 사람이 칩에서 옛 파일을
     * 고르면 보고 있는 것은 그 파일이고 목록 맨 앞은 다른 것이다. 탭을 옮겼다 돌아왔을 때
     * 되돌아갈 자리는 "보던 것" 이지 "가장 최근에 만져진 것" 이 아니다.
     */
    private lastViewed = new WeakMap<object, string>()
    private activeTab: object | null = null

    /** 탭별 출력 버퍼와 훑기 타이머 */
    // ---------- 편집 ----------
    /**
     * 편집 중인가. 켜져 있으면 **화면을 남이 건드리지 못한다** — 파일 감시의 자동 재읽기,
     * 새 파일 따라가기(follow), 모드 전환이 모두 비켜 간다. 사람이 친 글자를 지우는 것보다
     * 화면이 잠깐 낡아 보이는 편이 낫다.
     */
    private editing = false
    private editArea: HTMLTextAreaElement | null = null
    private editBarEl: HTMLElement | null = null
    private editNoteEl: HTMLElement | null = null
    private editSaveBtn: HTMLButtonElement | null = null
    /** 편집을 연 시점의 원본 — 저장할 때 BOM·개행을 이대로 되돌리고, mtime 으로 외부 변경을 본다 */
    private editOrigin: {
        file: string, text: string, bom: boolean, crlf: boolean, mtimeMs: number, readOnly: boolean,
    } | null = null
    /** 읽기 전용 속성을 풀고 저장할지 확인 대기 — 덮어쓰기 확인과 같은 2단 규칙 */
    private editForceArmed = false
    /** `＋` 에 없는 경로를 넣었을 때, 만들지 확인 대기 중인 절대경로 */
    private pathCreateArmed: string | null = null
    /** 편집하는 동안 파일이 밖에서 바뀌었다 — 저장 버튼이 한 번 더 확인을 받는다 */
    private editStale = false
    /** 덮어쓰기 확인 대기 (커밋 버튼의 2단 확인과 같은 규칙) */
    private editOverwriteArmed = false

    // ---------- 찾기 ----------
    private findRow: HTMLElement | null = null
    private findInput: HTMLInputElement | null = null
    private findCountEl: HTMLElement | null = null
    /** 지금 표시 중인 일치 `<mark>` 들. 본문을 다시 그리면 통째로 버린다 */
    private findHits: HTMLElement[] = []
    private findIndex = -1

    private buffers = new WeakMap<object, string>()
    private scrapeTimers = new WeakMap<object, any>()

    private resizing = false

    constructor (private host: ViewHost) { }

    // ---------- 열고 닫기 ----------

    get isOpen (): boolean {
        return this.opened
    }

    /**
     * 지금 화면에 그려질 폭 (닫혀 있거나 숨어 있으면 0).
     * @param room 패널이 써도 되는 폭 — deck 이 터미널·사이드바의 최소치를 뺀 값을 넘겨준다
     */
    extent (room: number): number {
        if (!this.opened || !this.visible) {
            return 0
        }
        const want = this.host.getWidth() || 420
        return Math.min(Math.max(want, MIN_VIEW_W), Math.max(room, MIN_VIEW_W))
    }

    setOpen (open: boolean, remember = true): void {
        if (this.opened === open) {
            return
        }
        this.opened = open
        this.syncDisplay()
        if (remember) {
            this.host.setOpen(open)
        }
        if (open) {
            this.renderTabs()
            if (this.mode === 'diff') {
                this.refreshDiff()
            } else if (!this.applyTabFile()) {
                // 닫혀 있는 동안 탭을 옮겼거나 에이전트가 새 파일을 만졌으면 위에서 그렸다.
                // 여기까지 왔으면 대상이 그대로였다는 뜻인데, **그래도 다시 읽는다** —
                // 닫힌 동안에는 감시(`watch`)가 꺼져 있어 같은 파일이 고쳐진 것도 모르므로,
                // 안 읽으면 열었을 때 옛 내용이 그대로 남는다
                if (this.current) {
                    this.watch(this.current)
                    this.renderCurrent()
                } else {
                    this.renderEmpty()
                }
            }
        } else {
            this.unwatch()
            // 닫아 두고 다시 열었을 때 첫 누름이 곧바로 커밋이 되지 않게
            this.disarmCommit()
        }
        this.host.relayout()
    }

    toggle (): void {
        this.setOpen(!this.opened)
    }

    /** 레이아웃 on/off 를 따라간다 — 열림 상태는 건드리지 않는다 */
    setVisible (visible: boolean): void {
        if (this.visible === visible) {
            return
        }
        this.visible = visible
        this.syncDisplay()
        if (!visible) {
            this.unwatch()
        }
    }

    private syncDisplay (): void {
        if (this.el) {
            this.el.style.display = this.opened && this.visible ? 'flex' : 'none'
        }
    }

    // ---------- DOM ----------

    install (): void {
        const el = document.createElement('div')
        el.id = VIEW_ID
        el.style.display = this.opened ? 'flex' : 'none'
        el.innerHTML = [
            '<div class="ad-view-head">',
            '  <span class="ad-view-title">미리보기</span>',
            '  <span class="ad-view-tools">',
            '    <button class="ad-view-btn ad-view-findbtn" title="찾기 (Ctrl+F)">🔍</button>',
            '    <button class="ad-view-btn ad-view-editbtn" title="편집 (저장 Ctrl+S)">✎</button>',
            '    <button class="ad-view-btn ad-view-pathbtn" title="경로로 열기">＋</button>',
            '    <button class="ad-view-btn ad-view-reload" title="다시 읽기">⟳</button>',
            '    <button class="ad-view-btn ad-view-close" title="패널 닫기">✕</button>',
            '  </span>',
            '</div>',
            '<div class="ad-view-path" style="display:none">',
            '  <input type="text" spellcheck="false" placeholder="D:/Project/... 또는 상대경로">',
            '  <span class="ad-view-path-note"></span>',
            '</div>',
            // 모드 스위치는 제목줄(＋ ⟳ ✕)을 건드리지 않고 따로 한 줄 쓴다 — 좁은 폭에서
            // 버튼이 접히면 ✕ 가 밀려나 패널을 닫을 수 없게 된다
            '<div class="ad-view-modes">',
            '  <button class="ad-view-mode ad-view-mode-on" data-ad-mode="file">파일</button>',
            '  <button class="ad-view-mode" data-ad-mode="diff">변경</button>',
            // `변경` 을 볼 때만 보이는 범위 스위치. 기본은 **이 세션이 만진 것만** —
            // 저장소 전체는 P4 위에 git 을 얹은 곳에서 수백 개가 나와 방금 고친 것을 못 찾는다
            '  <button class="ad-view-scope" style="display:none" title="변경 목록의 범위">세션</button>',
            '</div>',
            // 찾기 줄. 본문 밖에 두는 이유는 커밋 줄과 같다 — 본문은 갱신마다 다시 쓰므로
            // 안에 두면 입력하던 검색어가 지워진다
            '<div class="ad-view-find" style="display:none">',
            '  <input type="text" class="ad-view-find-input" spellcheck="false" placeholder="찾기">',
            '  <span class="ad-view-find-count"></span>',
            '  <button class="ad-view-btn ad-view-find-prev" title="이전 (Shift+Enter)">‹</button>',
            '  <button class="ad-view-btn ad-view-find-next" title="다음 (Enter)">›</button>',
            '  <button class="ad-view-btn ad-view-find-close" title="닫기 (Esc)">✕</button>',
            '</div>',
            '<div class="ad-view-tabs"></div>',
            // tabindex 를 주는 이유 — Ctrl+F 를 패널 안에서만 잡으려면 본문이 **포커스를 받을 수
            // 있어야** 한다. 본문을 한 번 누르면 그때부터 찾기 키가 통한다
            '<div class="ad-view-body" tabindex="0"></div>',
            // 편집 줄도 **본문 밖**이다 — 저장/취소 버튼이 본문 갱신에 지워지면 안 된다
            '<div class="ad-view-editbar" style="display:none">',
            '  <span class="ad-view-edit-note"></span>',
            '  <span class="ad-view-edit-btns">',
            '    <button class="ad-view-edit-save">저장</button>',
            '    <button class="ad-view-edit-cancel">취소</button>',
            '  </span>',
            '</div>',
            // 참조 안내줄도 **본문 밖**이다 — 자동 갱신이 본문을 다시 쓰는 동안에도 방금 넣은
            // 참조("넣었다 · src/a.ts:12")나 못 넣은 이유가 남아 있어야 한다
            '<div class="ad-view-ref" style="display:none"></div>',
            // 커밋 줄은 **본문 밖**에 둔다 — 본문은 갱신마다 innerHTML 을 다시 쓰므로(renderDiff)
            // 안에 두면 자동 갱신 한 번에 입력하던 메시지가 지워지고 리스너도 매번 다시 붙는다
            '<div class="ad-view-commit" style="display:none">',
            '  <div class="ad-view-commit-sum"></div>',
            '  <div class="ad-view-commit-row">',
            '    <input type="text" class="ad-view-commit-msg" spellcheck="false" placeholder="커밋 메시지">',
            '    <button class="ad-view-commit-go" disabled>커밋</button>',
            '  </div>',
            '  <div class="ad-view-commit-note"></div>',
            '</div>',
            '<div class="ad-view-foot"></div>',
            '<div class="ad-view-resize"></div>',
        ].join('\n')
        this.host.windowEl.appendChild(el)

        this.el = el
        this.bodyEl = el.querySelector('.ad-view-body')
        this.tabsEl = el.querySelector('.ad-view-tabs')
        this.titleEl = el.querySelector('.ad-view-title')
        this.footEl = el.querySelector('.ad-view-foot')
        this.pathRow = el.querySelector('.ad-view-path')
        this.pathInput = el.querySelector('.ad-view-path input')
        this.modesEl = el.querySelector('.ad-view-modes')
        this.commitEl = el.querySelector('.ad-view-commit')
        this.commitInput = el.querySelector('.ad-view-commit-msg')
        this.commitBtn = el.querySelector('.ad-view-commit-go')
        this.commitSumEl = el.querySelector('.ad-view-commit-sum')
        this.commitNoteEl = el.querySelector('.ad-view-commit-note')
        this.refNoteEl = el.querySelector('.ad-view-ref')
        this.editBarEl = el.querySelector('.ad-view-editbar')
        this.editNoteEl = el.querySelector('.ad-view-edit-note')
        this.editSaveBtn = el.querySelector('.ad-view-edit-save')
        this.findRow = el.querySelector('.ad-view-find')
        this.findInput = el.querySelector('.ad-view-find-input')
        this.findCountEl = el.querySelector('.ad-view-find-count')

        this.scopeBtn = el.querySelector('.ad-view-scope')

        this.modesEl!.addEventListener('click', (e: MouseEvent) => {
            const btn = (e.target as HTMLElement)?.closest?.('[data-ad-mode]') as HTMLElement | null
            if (btn) {
                this.setMode(btn.getAttribute('data-ad-mode') === 'diff' ? 'diff' : 'file')
            }
        })
        this.scopeBtn!.addEventListener('click', () => this.toggleScope())
        this.applyScopeLabel()

        el.querySelector('.ad-view-close')!.addEventListener('click', () => this.setOpen(false))
        el.querySelector('.ad-view-reload')!.addEventListener('click', () => this.reload())
        el.querySelector('.ad-view-pathbtn')!.addEventListener('click', () => this.togglePathRow())
        el.querySelector('.ad-view-editbtn')!.addEventListener('click', () => this.toggleEdit())
        el.querySelector('.ad-view-findbtn')!.addEventListener('click', () => this.openFind())
        el.querySelector('.ad-view-edit-save')!.addEventListener('click', () => this.saveEdit())
        el.querySelector('.ad-view-edit-cancel')!.addEventListener('click', () => this.cancelEdit())
        el.querySelector('.ad-view-find-next')!.addEventListener('click', () => this.stepFind(1))
        el.querySelector('.ad-view-find-prev')!.addEventListener('click', () => this.stepFind(-1))
        el.querySelector('.ad-view-find-close')!.addEventListener('click', () => this.closeFind())

        this.findInput!.addEventListener('input', () => this.runFind())
        this.findInput!.addEventListener('keydown', (e: KeyboardEvent) => {
            // 패널 입력창이다 — 터미널 핫키에 뺏기지 않게 여기서 끊는다 (경로 입력창과 같은 규칙)
            e.stopPropagation()
            if (e.key === 'Enter') {
                e.preventDefault()
                this.stepFind(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
                e.preventDefault()
                this.closeFind()
            }
        })

        /**
         * 패널 안에서만 Ctrl+F / Ctrl+S 를 잡는다.
         *
         * **터미널의 같은 키를 뺏지 않는다** — Ctrl+F 는 less·vim·에디터가 쓰는 키이고,
         * Tabby 핫키로 올리면 어느 탭에서 눌러도 패널이 열려 버린다. 패널 DOM 안에서
         * 일어난 키만 보므로, 본문을 한 번 누르거나 검색창·편집기에 있을 때만 동작한다.
         */
        el.addEventListener('keydown', (e: KeyboardEvent) => {
            const ctrl = e.ctrlKey || e.metaKey
            if (ctrl && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault()
                e.stopPropagation()
                this.openFind()
            } else if (ctrl && (e.key === 's' || e.key === 'S')) {
                if (this.editing) {
                    e.preventDefault()
                    e.stopPropagation()
                    this.saveEdit()
                }
            } else if (e.key === 'Escape' && this.editing && e.target === this.editArea) {
                e.preventDefault()
                e.stopPropagation()
                this.cancelEdit()
            }
        })
        this.pathInput!.addEventListener('keydown', (e: KeyboardEvent) => {
            // 터미널 핫키에 뺏기지 않게 여기서 끊는다 (입력창은 우리 DOM 이다)
            e.stopPropagation()
            if (e.key === 'Enter') {
                const v = this.pathInput!.value.trim()
                if (v) {
                    this.openOrCreate(v)
                }
            } else if (e.key === 'Escape') {
                this.togglePathRow(false)
            }
        })

        this.commitInput!.addEventListener('keydown', (e: KeyboardEvent) => {
            // 터미널 핫키에 뺏기지 않게 여기서 끊는다 (경로 입력창과 같은 이유)
            e.stopPropagation()
            if (e.key === 'Enter') {
                this.pressCommit()
            } else if (e.key === 'Escape') {
                this.disarmCommit()
                this.setCommitNote('')
            }
        })
        this.commitInput!.addEventListener('input', () => {
            // 메시지를 고치면 확인 대기를 푼다 — "확인" 을 눌러 둔 뒤 글자를 바꿨는데 확인이
            // 살아 있으면 사람이 읽지 않은 메시지로 커밋된다
            this.disarmCommit()
        })
        this.commitBtn!.addEventListener('click', () => this.pressCommit())

        // 본문 안의 링크 — 웹은 브라우저로, 로컬 파일은 이 패널에서 연다
        this.bodyEl!.addEventListener('click', (e: MouseEvent) => {
            const a = (e.target as HTMLElement)?.closest?.('[data-ad-link]') as HTMLElement | null
            if (!a) {
                return
            }
            e.preventDefault()
            const url = a.getAttribute('data-ad-link') ?? ''
            if (/^https?:/i.test(url)) {
                this.host.openExternal(url)
            } else {
                this.openFile(url.replace(/^file:\/\//, ''))
            }
        })

        // `변경` 본문의 두 가지 누르기 — 파일 목록은 그 파일 diff 로 스크롤, 경로는 파일 모드로 열기
        this.bodyEl!.addEventListener('click', (e: MouseEvent) => {
            const t = e.target as HTMLElement
            // 스테이지 딱지를 **먼저** 본다 — 딱지는 점프 버튼(`[data-ad-diff]`) 안에 들어 있어서
            // 순서를 바꾸면 딱지를 눌렀는데 스크롤만 하고 끝난다
            const stage = t?.closest?.('[data-ad-stage]') as HTMLElement | null
            if (stage) {
                e.preventDefault()
                this.toggleStage(stage.getAttribute('data-ad-stage') ?? '',
                    stage.getAttribute('data-ad-stage-act') === 'reset' ? 'reset' : 'add')
                return
            }
            const jump = t?.closest?.('[data-ad-diff]') as HTMLElement | null
            if (jump) {
                e.preventDefault()
                // id 는 우리가 `ad-diff-<번호>` 로 만들므로 선택자 이스케이프가 필요 없다
                const target = document.getElementById(jump.getAttribute('data-ad-diff') ?? '')
                target?.scrollIntoView(true)
                return
            }
            const open = t?.closest?.('[data-ad-open]') as HTMLElement | null
            if (open) {
                e.preventDefault()
                const file = open.getAttribute('data-ad-open') ?? ''
                if (file) {
                    this.openFile(file)
                }
            }
        })

        /**
         * 줄을 눌러 `파일:라인` 참조를 터미널에 넣는다 (`변경` diff 줄 · `파일` 코드 줄 공통).
         *
         * **이미 뜻이 있는 누르기를 가리지 않는다** — 파일명은 그 파일 diff 로 스크롤,
         * 스테이지 딱지는 `git add`/`reset`, 링크는 열기다. 그 중 하나에 걸렸으면 여기서
         * 손을 뗀다. 우발 `git add` 가 특히 위험해서 판정을 참조보다 먼저 둔다.
         */
        this.bodyEl!.addEventListener('click', (e: MouseEvent) => {
            const t = e.target as HTMLElement
            if (!t?.closest) {
                return
            }
            if (t.closest('[data-ad-stage],[data-ad-diff],[data-ad-open],[data-ad-link]')) {
                return
            }
            const row = t.closest('[data-ad-ref-line],[data-ad-ref-del]') as HTMLElement | null
            if (row) {
                this.clickRefLine(row, e.shiftKey)
            }
        })

        this.installDrop(el)
        this.installResize(el.querySelector('.ad-view-resize')!)
        this.renderEmpty()
    }

    /** 파일을 끌어다 놓으면 그걸 연다 — 탐색기·VS Code 탭 어느 쪽에서 끌어도 된다 */
    private installDrop (el: HTMLElement): void {
        el.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault()
            el.classList.add('ad-view-dropping')
        })
        el.addEventListener('dragleave', () => el.classList.remove('ad-view-dropping'))
        el.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault()
            el.classList.remove('ad-view-dropping')
            const file = e.dataTransfer?.files?.[0] as any
            const text = e.dataTransfer?.getData('text/plain')
            const target = file?.path || text
            if (target) {
                this.openFile(String(target).trim().replace(/^"|"$/g, ''))
            }
        })
    }

    /**
     * 터미널과 닿는 쪽 경계선을 끌어 폭을 바꾼다.
     *
     * **폭은 "잡은 순간의 폭 + 끈 거리" 로 잰다 — 창 가장자리부터 재면 안 된다.**
     * 사이드바와 패널이 같은 쪽에 붙으면 패널은 창 가장자리에서 사이드바 폭만큼 안쪽에 앉는데
     * (`deck.service.ts` relayout 의 `outerOffset`), `rect.right - clientX` 는 그 몫까지
     * 폭으로 세어 버린다. 그래서 잡자마자 사이드바 폭(200~560px)만큼 한 번 커지고, 사용자는
     * 그걸 도로 줄이는 것으로 조작을 시작하게 된다 (2026-09-11 유저 지적).
     * 델타 방식은 그 몫도, 손잡이 안에서 어디를 잡았는지도 상쇄되어 **튐이 아예 없다.**
     * (사이드바 `dock.ts` 가 절대 거리로 재는 것은 거기서만 맞다 — 사이드바는 창에 딱 붙는다.)
     */
    private installResize (handle: HTMLElement): void {
        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            this.resizing = true
            document.body.classList.add('ad-resizing')
            const startX = e.clientX
            // 기준은 **화면에 실제로 그려져 있는 폭**이다. 설정값(`getWidth`)을 쓰면 좁은 창에서
            // 또 튄다 — `extent()` 가 `room` 으로 깎아 그리는데 설정에는 안 깎인 값이 남아 있어서다.
            const startW = this.el?.getBoundingClientRect().width || this.host.getWidth()
            const move = (ev: MouseEvent) => {
                if (!this.resizing) {
                    return
                }
                // 오른쪽 패널은 커서가 왼쪽으로 갈수록 넓어지고, 왼쪽 패널은 그 반대다
                const delta = this.host.getSide() === 'right'
                    ? startX - ev.clientX
                    : ev.clientX - startX
                this.host.setWidth(Math.max(MIN_VIEW_W, Math.round(startW + delta)))
                this.host.relayout()
            }
            const up = () => {
                this.resizing = false
                document.body.classList.remove('ad-resizing')
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
                this.host.commit()
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
        })
    }

    /**
     * deck 의 relayout 이 정해 준 자리에 앉는다 (사이드바와 같은 방식으로 절대 배치).
     *
     * 네 값 모두 **컨테이닝 블록 좌표로 이미 풀린 실좌표**다 — 예전처럼 `right: outerOffset` 으로
     * 가장자리에 붙이면 그 가장자리가 화면 밖일 때 패널도 같이 밀려난다 (deck.service anchorOrigin).
     */
    layout (side: ViewSide, rect: { left: number, top: number, width: number, height: number }): void {
        if (!this.el) {
            return
        }
        const s = this.el.style
        s.position = 'absolute'
        s.left = rect.left + 'px'
        s.top = rect.top + 'px'
        s.right = 'auto'
        s.bottom = 'auto'
        s.width = rect.width + 'px'
        s.height = rect.height + 'px'
        this.el.classList.toggle('ad-view-left', side === 'left')
        this.el.classList.toggle('ad-view-right', side === 'right')
    }

    private togglePathRow (force?: boolean): void {
        if (!this.pathRow) {
            return
        }
        const show = force ?? this.pathRow.style.display === 'none'
        this.pathRow.style.display = show ? 'flex' : 'none'
        this.pathCreateArmed = null
        this.setPathNote('')
        if (show) {
            this.pathInput!.value = this.current ?? ''
            this.pathInput!.focus()
            this.pathInput!.select()
        }
    }

    private setPathNote (text: string): void {
        const note = this.el?.querySelector('.ad-view-path-note') as HTMLElement | null
        if (note) {
            note.textContent = text
            note.title = text
        }
    }

    /**
     * `＋` 에 넣은 경로를 연다. **없는 파일이면 만들어 준다** — 메모 한 장을 시작하려고
     * 탐색기로 나가는 것이 이 패널이 없애려던 왕복이다.
     *
     * 만들기는 **두 번째 Enter 에서만** 한다(커밋·덮어쓰기와 같은 2단 규칙). 오타로 친 경로에
     * 빈 파일이 조용히 생기면, 다음에 그 오타를 찾는 데 드는 시간이 아낀 시간보다 크다.
     * 만든 뒤에는 곧바로 편집으로 들어간다 — 빈 파일을 보여 줄 이유가 없다.
     */
    private openOrCreate (raw: string): void {
        const base = this.current ? path.dirname(this.current) : null
        const cwd = this.host.cwdFor(this.activeTab ?? {}) ?? base
        const found = this.resolve(raw, cwd, false) ?? this.resolve(raw, base, false)
        if (found) {
            this.pathCreateArmed = null
            this.setPathNote('')
            this.openFile(found)
            return
        }

        const absolute = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)
        if (!absolute && !cwd) {
            this.setPathNote('상대경로를 풀 작업 폴더를 모른다 — 절대경로로 넣는다')
            return
        }
        const target = path.normalize(absolute ? raw : path.join(cwd!, raw))
        // 폴더를 파일로 만들려는 것은 막는다 (경로 끝의 구분자나 실제 폴더)
        if (/[\\/]$/.test(raw)) {
            this.setPathNote('폴더 경로다 — 파일 이름까지 넣는다')
            return
        }
        try {
            if (fs.statSync(target).isDirectory()) {
                this.setPathNote('폴더다 — 파일 이름까지 넣는다')
                return
            }
        } catch {
            // 없는 경로다 — 아래에서 만든다
        }

        if (this.pathCreateArmed !== target) {
            this.pathCreateArmed = target
            this.setPathNote('없는 파일이다 — Enter 를 한 번 더 치면 새로 만든다')
            return
        }
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' })
        } catch (err: any) {
            this.setPathNote('만들지 못했다: ' + String(err?.message ?? err))
            return
        }
        this.pathCreateArmed = null
        this.setPathNote('')
        this.openFile(target)
        // 빈 파일이다 — 보여 줄 것이 없으니 바로 칠 수 있게 한다
        this.startEdit()
    }

    // ---------- 모드 (파일 / 변경) ----------

    get viewMode (): ViewMode {
        return this.mode
    }

    /** 스위치 모양만 맞춘다 — 그리기는 부르는 쪽이 한다 (두 번 그리지 않기 위해서) */
    private applyMode (mode: ViewMode): void {
        this.mode = mode
        if (this.modesEl) {
            for (const btn of Array.from(this.modesEl.querySelectorAll('[data-ad-mode]'))) {
                btn.classList.toggle('ad-view-mode-on', btn.getAttribute('data-ad-mode') === mode)
            }
        }
        if (mode === 'diff') {
            this.togglePathRow(false)
        } else {
            // `파일` 로 옮기면 커밋 줄을 감추고 확인 대기도 푼다 — 안 보이는 버튼이 armed 로
            // 남아 있으면 나중에 `변경` 으로 돌아온 첫 누름이 곧바로 커밋이 된다
            this.disarmCommit()
        }
        if (this.commitEl) {
            this.commitEl.style.display = mode === 'diff' ? 'block' : 'none'
        }
        if (this.scopeBtn) {
            this.scopeBtn.style.display = mode === 'diff' ? '' : 'none'
        }
        this.renderTabs()
    }

    /**
     * `변경` 목록의 범위를 바꾼다 (세션 ↔ 전체).
     *
     * git 을 다시 돌리지 않고 **이미 읽어 둔 결과를 다시 거르기만** 할 수도 있지만, 그러려면
     * 마지막 diff 원문을 들고 있어야 하고 그 사이에 파일이 또 바뀌면 화면이 과거를 보여준다.
     * git 한 번은 싸다(로컬 저장소 5초 상한) — 다시 읽는다.
     */
    private toggleScope (): void {
        this.diffScope = this.diffScope === 'session' ? 'all' : 'session'
        this.applyScopeLabel()
        if (this.mode === 'diff' && this.opened) {
            this.refreshDiff()
        }
    }

    private applyScopeLabel (): void {
        if (!this.scopeBtn) {
            return
        }
        const session = this.diffScope === 'session'
        this.scopeBtn.textContent = session ? '세션' : '전체'
        this.scopeBtn.classList.toggle('ad-view-scope-all', !session)
        this.scopeBtn.title = session
            ? '이 세션이 만진 파일만 보고 있다 — 누르면 저장소 전체'
            : '저장소의 커밋 안 된 변경 전부를 보고 있다 — 누르면 이 세션이 만진 것만'
    }

    setMode (mode: ViewMode): void {
        if (this.mode === mode) {
            return
        }
        // 편집 중 모드 전환도 파일 전환과 같은 규칙이다 (openFile 주석 참조)
        if (this.editing) {
            if (this.editArea && this.editOrigin && this.editArea.value !== this.editOrigin.text) {
                this.setEditNote('저장하지 않은 편집이 있다 — 저장하거나 취소한 뒤에 모드를 옮긴다')
                return
            }
            this.cancelEdit()
        }
        this.applyMode(mode)
        const wasOpen = this.opened
        if (!wasOpen) {
            // 닫혀 있었으면 setOpen 이 모드에 맞게 한 번 그린다 (diff 면 refreshDiff 까지)
            this.setOpen(true)
        }
        if (mode === 'diff') {
            if (wasOpen) {
                this.refreshDiff()
            }
        } else if (this.current) {
            // `변경` 을 보는 동안 파일이 바뀌었어도 감시 콜백은 그리지 않았다 — 여기서 최신을 읽는다
            this.renderCurrent()
        } else {
            this.renderEmpty()
        }
    }

    /**
     * `파일` ↔ `변경` 전환. 핫키(`agentdeck-view-mode`) 배선이 한 줄로 끝나게 public 으로 둔다 —
     * 핫키 처리는 deck.service 가 하고(HotkeysService 순환 의존 때문에 provider 에서는 못 한다),
     * 여기서 상태를 들고 있으므로 그쪽은 이 메서드만 부르면 된다.
     */
    toggleMode (): void {
        this.setMode(this.mode === 'diff' ? 'file' : 'diff')
    }

    // ---------- PTY 출력에서 경로 줍기 ----------

    /**
     * 출력 한 조각을 받아 둔다. 조각마다 정규식을 돌리지 않고 모았다가 400ms 마다 한 번 훑는다 —
     * 에이전트 TUI 는 상태줄을 매초 다시 그려서 조각이 초당 수십 개씩 온다.
     */
    noteOutput (tab: object, data: string): void {
        const buf = ((this.buffers.get(tab) ?? '') + data).slice(-SCRAPE_BUFFER_MAX)
        this.buffers.set(tab, buf)
        if (this.scrapeTimers.get(tab)) {
            return
        }
        this.scrapeTimers.set(tab, setTimeout(() => {
            this.scrapeTimers.delete(tab)
            this.scrape(tab)
        }, SCRAPE_DEBOUNCE_MS))
    }

    private scrape (tab: object): void {
        const buf = this.buffers.get(tab) ?? ''
        // 다음 조각으로 넘길 것은 **마지막 줄의 미완성 부분뿐이다.**
        // 경로는 줄바꿈을 넘지 못하므로 그 앞은 이미 다 본 것이고, 그걸 남겨 두면
        // 다음 훑기에서 같은 경로가 또 잡혀 최근 목록의 순서가 흔들린다
        // (2026-09-08 실측: 따라가기가 새 파일 대신 직전 파일을 다시 띄웠다)
        this.buffers.set(tab, buf.slice(buf.lastIndexOf('\n') + 1).slice(-256))
        if (!buf) {
            return
        }
        const cwd = this.host.cwdFor(tab)
        /** 처음 본 파일 — 따라가기(viewerFollow)가 띄울 대상 */
        let added: string | null = null
        /** 목록이 조금이라도 바뀌었나 — 순서만 바뀌어도 칩을 다시 그려야 한다 */
        let changed = false
        for (const token of extractPaths(buf)) {
            const abs = this.resolve(token, cwd)
            if (!abs) {
                continue
            }
            const list = this.recent.get(tab) ?? []
            if (list[0] === abs) {
                continue
            }
            // 이미 아는 파일이면 순서만 올린다 — **따라가기의 대상은 처음 본 파일뿐이다.**
            // 화면이 다시 그려질 때 옛 경로가 또 잡히는데, 그걸 열면 방금 만든 파일을 덮는다
            const known = list.includes(abs)
            this.recent.set(tab, pushRecent(list, abs, this.host.getRecentMax()))
            changed = true
            // 칩에는 무엇이든 쌓되, **스스로 띄울 대상에서는 설정 파일을 뺀다**
            // (`isAutoFollowable`, viewer.ts) — 에이전트가 기동하면서 찍는 설정 경로 때문에
            // 세션을 열자마자 화면이 `settings.json` 으로 갈리던 문제
            if (!known && isAutoFollowable(abs)) {
                added = abs
            }
        }
        if (!changed || tab !== this.activeTab) {
            return
        }
        this.renderTabs()
        // 여기서 **스스로 열어도 되는지**를 가른다 (`planFollow`, viewer.ts).
        //  - `open`   : 닫혀 있어도 연다 — 결과물이 나왔는데 사람이 `▤` 를 눌러야 보인다면
        //               그 왕복 때문에 결과물을 안 보고 넘어간다
        //  - `show`   : 열어 둔 동안에만 화면을 바꾼다. **자동으로 열지 않는다**
        //  - `stage`  : 닫혀 있다 — 그리지 않고 다음에 열 때 보일 대상만 갈아 둔다
        //  - `manual` : 아무것도 하지 않는다 — 경로는 위 칩에 이미 쌓였다
        // 편집 중이면 모드와 무관하게 따라가지 않는다 (사람이 치던 것을 밀어내지 않는다).
        const plan = planFollow(this.host.getFollowMode(), this.opened, this.editing)
        if (plan === 'none') {
            return
        }
        if (plan === 'stage') {
            // 닫힌 패널의 "읽어두기" — 그리는 일은 `setOpen(true)` 가 한다.
            // `lastViewed` 를 갈아 두는 것이 핵심이다: 이걸 안 하면 사람이 나중에 패널을 열었을 때
            // **아까 보던 옛 파일**이 뜬다(`applyTabFile` 이 lastViewed 를 먼저 본다).
            // `변경` 모드로 열려 있었다면 여는 순간 `setOpen` 이 `refreshDiff()` 를 부른다 —
            // 닫힌 채로 git 을 돌릴 이유가 없다. 그래도 대상은 적어 둔다(`파일` 로 돌아올 때 쓴다).
            if (added) {
                this.lastViewed.set(tab, added)
            }
            return
        }
        if (this.mode === 'diff') {
            // 파일이 바뀌었다는 신호이므로 변경 목록을 다시 뽑는다. **모드는 바꾸지 않는다** —
            // 사람이 `변경` 을 골라 둔 상태에서 화면이 파일로 튀면 그게 회귀다.
            // 닫혀 있었다면 고른 모드 그대로 연다
            if (plan === 'open') {
                this.setOpen(true)
            }
            this.maybeAutoDiff()
        } else if (added) {
            // openFile 이 안에서 setOpen(true) 를 부른다 — 이미 열려 있으면 그건 no-op 이다
            this.openFile(added)
        }
    }

    /** 후보 토큰을 실제로 있는 파일의 절대경로로 만든다 (없으면 null) */
    private resolve (token: string, cwd: string | null, requireKnownExt = true): string | null {
        // 확장자 게이트는 **화면에서 주울 때만** 필요하다 — TUI 가 찍은 글자 중 경로처럼 보이는
        // 것을 거르는 장치다. 사람이 명시로 여는 경로(칩·드롭·＋·본문 링크)에 같은 게이트를
        // 걸면, 실제로 있는 파일을 열었는데 "파일을 찾지 못했다" 고 말한다 — 거짓 안내이고
        // `renderBinary`("미리보기를 지원하지 않는 형식")는 도달할 수 없는 죽은 코드가 된다
        // (2026-09-08 회귀 TC 작성 중 발견: 존재하는 `.zip` 을 열면 "못 찾았다" 로 끝났다).
        if (requireKnownExt && !isKnownExt(token)) {
            return null
        }
        const tries: string[] = []
        if (path.isAbsolute(token) || /^[A-Za-z]:[\\/]/.test(token)) {
            tries.push(token)
        } else if (cwd) {
            tries.push(path.join(cwd, token))
        }
        for (const t of tries) {
            try {
                const st = fs.statSync(t)
                if (st.isFile()) {
                    return path.normalize(t)
                }
            } catch {
                // 없는 파일 — 화면 글자가 경로처럼 보였을 뿐이다
            }
        }
        return null
    }

    /** 활성 탭이 바뀌면 최근 목록도 그 탭 것으로 바꾼다 */
    setActiveTab (tab: object | null): void {
        if (this.activeTab === tab) {
            return
        }
        this.activeTab = tab
        this.pathCreateArmed = null
        // 참조는 **활성 탭** 터미널로 나간다 — 탭을 옮겼으면 직전에 넣은 참조는 저쪽 프롬프트에
        // 있다. 기억을 남겨 두면 다음 누름이 "꼬리만"(`-20`) 을 엉뚱한 터미널에 넣는다
        this.refLastSent = null
        // 탭이 바뀌면 **다른 저장소**일 수 있다. 화면에 남은 목록과 딱지가 이전 탭 것이면
        // 딱지를 누른 경로가 지금 보고 있는 저장소의 것이 아니게 되므로 상태를 비우고 다시 읽는다
        this.disarmCommit()
        if (this.opened) {
            this.renderTabs()
            if (this.mode === 'diff') {
                this.setStatus([])
                this.refreshDiff()
            }
        }
        // 본문도 그 탭 것으로 바꾼다 — 세션을 옮겼는데 옆에 남의 문서가 떠 있으면
        // 그 파일이 지금 탭의 것이라고 착각한다 (칩·`변경` 은 이미 탭별인데 본문만 안 그랬다)
        this.applyTabFile()
    }

    /**
     * 활성 탭이 마지막으로 보던 파일로 본문을 맞춘다.
     *
     * **열려 있을 때만 그린다.** 닫혀 있으면 `current` 만 바꿔 두고, `setOpen(true)` 가 다시 불러
     * 그때 그린다 — 탭을 옮긴 것만으로 패널이 열리면 안 되기 때문이다(패널이 저절로 열리는
     * 경우는 "새 결과물을 주웠을 때" 하나로 족하다).
     *
     * 돌려주는 값은 **"그렸는가"** — 부르는 쪽이 두 번 그리지 않으려고 본다 (`setOpen`).
     */
    private applyTabFile (): boolean {
        if (this.mode !== 'file') {
            return false
        }
        if (this.editing) {
            // 편집 중에는 본문을 건드리지 않는다 — 저장/취소 뒤에 따라온다
            this.setEditNote('다른 탭으로 옮겼다 — 저장하거나 취소하면 그 탭 파일로 넘어간다')
            return true
        }
        const tab = this.activeTab
        const want = tab
            ? this.lastViewed.get(tab) ?? (this.recent.get(tab) ?? [])[0] ?? null
            : null
        if (want === this.current) {
            return false
        }
        this.current = want
        this.closeFind()
        if (!this.opened) {
            return false
        }
        if (!want) {
            this.unwatch()
            this.renderEmpty()
            return true
        }
        this.watch(want)
        this.renderCurrent()
        return true
    }

    /** 사람이/훅이 알려 준 파일을 최근 목록에 얹는다 (열지는 않는다) */
    noteFile (tab: object, file: string): void {
        const abs = this.resolve(file, this.host.cwdFor(tab))
        if (!abs) {
            return
        }
        this.recent.set(tab, pushRecent(this.recent.get(tab) ?? [], abs, this.host.getRecentMax()))
        if (tab === this.activeTab && this.opened) {
            this.renderTabs()
        }
    }

    // ---------- 파일 열기 / 그리기 ----------

    openFile (file: string): void {
        const raw = String(file ?? '').trim()
        if (!raw) {
            return
        }
        // 저장하지 않은 편집이 있으면 다른 파일로 넘어가지 않는다 — 조용히 버리면 사람이 친
        // 글자가 소리 없이 사라진다. 고친 것이 없으면 그냥 편집을 접고 넘어간다
        if (this.editing) {
            if (this.editArea && this.editOrigin && this.editArea.value !== this.editOrigin.text) {
                this.setEditNote('저장하지 않은 편집이 있다 — 저장하거나 취소한 뒤에 다른 파일을 연다')
                return
            }
            this.cancelEdit()
        }
        const base = this.current ? path.dirname(this.current) : null
        // 사람이 지시한 경로다 — 확장자를 모르더라도 **파일이 있으면 연다**(위 resolve 주석).
        // 미리보기를 못 그리는 형식이면 `renderBinary` 가 "지원하지 않는 형식" 이라고 말한다
        const cwd = this.host.cwdFor(this.activeTab ?? {}) ?? base
        const abs = this.resolve(raw, cwd, false) ?? this.resolve(raw, base, false)
        // 파일을 열라는 지시는 모드 전환을 포함한다 — 칩·드롭·＋·본문 링크·`변경` 의 경로가
        // 모두 여기로 들어오는데, `변경` 을 보던 중이라면 그 자리에 파일을 그릴 수가 없다.
        // 그리기는 아래에서 하므로 여기서는 UI 만 맞춘다
        this.applyMode('file')
        if (!abs) {
            this.setOpen(true)
            this.renderMessage('파일을 찾지 못했다', raw)
            return
        }
        this.current = abs
        if (this.activeTab) {
            this.recent.set(this.activeTab, pushRecent(this.recent.get(this.activeTab) ?? [], abs, this.host.getRecentMax()))
            // 탭을 옮겼다 돌아오면 이 파일로 되돌아간다 (applyTabFile)
            this.lastViewed.set(this.activeTab, abs)
        }
        this.setOpen(true)
        this.togglePathRow(false)
        this.watch(abs)
        this.renderTabs()
        this.renderCurrent()
    }

    reload (): void {
        if (this.mode === 'diff') {
            this.refreshDiff()
        } else if (this.current) {
            this.renderCurrent()
        } else {
            this.renderEmpty()
        }
    }

    /** 파일이 바뀌면 다시 그린다 — 에이전트가 문서를 고치는 동안 옆에서 따라간다 */
    private watch (file: string): void {
        if (this.watching === file) {
            return
        }
        this.unwatch()
        this.watching = file
        try {
            fs.watchFile(file, { interval: WATCH_INTERVAL_MS }, (cur, prev) => {
                // `변경` 모드에서는 그리지 않는다 — 감시는 살려 두고(모드를 되돌릴 때 최신을
                // 다시 그린다) 화면만 건드리지 않는 것이다. 안 막으면 diff 본문을 덮어쓴다
                if (this.mode === 'file' && this.watching === file && cur.mtimeMs !== prev.mtimeMs) {
                    this.renderCurrent()
                }
            })
        } catch {
            // 감시가 안 되는 파일시스템 — ⟳ 로 다시 읽으면 된다
        }
    }

    private unwatch (): void {
        if (this.watching) {
            try {
                fs.unwatchFile(this.watching)
            } catch {
                // 이미 해제됨
            }
            this.watching = null
        }
    }

    private renderTabs (): void {
        if (!this.tabsEl) {
            return
        }
        const list = this.activeTab ? this.recent.get(this.activeTab) ?? [] : []
        this.tabsEl.innerHTML = ''
        for (const file of list) {
            const chip = document.createElement('button')
            chip.className = 'ad-view-tab' + (file === this.current ? ' ad-view-tab-on' : '')
            chip.textContent = path.basename(file)
            chip.title = file
            chip.addEventListener('click', () => this.openFile(file))
            this.tabsEl.appendChild(chip)
        }
        // 최근 파일 칩은 `파일` 모드의 것이다 — `변경` 에서는 자리만 차지한다
        this.tabsEl.style.display = list.length && this.mode === 'file' ? 'flex' : 'none'
    }

    private renderEmpty (): void {
        if (!this.bodyEl) {
            return
        }
        this.setTitle('미리보기', '')
        this.bodyEl.innerHTML = [
            '<div class="ad-view-empty">',
            '  <p>에이전트가 만진 파일이 여기 쌓인다.</p>',
            '  <ul>',
            '    <li>화면에 찍힌 경로를 자동으로 줍는다 (md · 이미지 · 표 · 코드)</li>',
            '    <li>파일을 이 자리에 끌어다 놓아도 된다</li>',
            '    <li><b>＋</b> 를 눌러 경로를 직접 넣을 수 있다</li>',
            '  </ul>',
            '</div>',
        ].join('')
        this.setFoot('')
    }

    private renderMessage (title: string, detail: string): void {
        if (!this.bodyEl) {
            return
        }
        this.setTitle(title, detail)
        this.bodyEl.innerHTML = '<div class="ad-view-empty"><p>' + escapeHtml(title) + '</p><p class="ad-view-dim">'
            + escapeHtml(detail) + '</p></div>'
        this.setFoot('')
    }

    private setTitle (title: string, tip: string): void {
        if (this.titleEl) {
            this.titleEl.textContent = title
            this.titleEl.title = tip
        }
    }

    private setFoot (text: string): void {
        if (this.footEl) {
            this.footEl.textContent = text
            this.footEl.title = text
        }
    }

    /**
     * 발밑 줄 **앞에** 한 마디를 붙인다 (예: `저장했다 · 1.2KB · …`).
     * 저장 직후처럼 "방금 무슨 일이 있었는지" 를 크기·시각과 같이 보여줄 때 쓴다 —
     * 다음 `renderCurrent` 가 발밑 줄을 다시 쓰면 저절로 사라진다.
     */
    private setFootNote (note: string): void {
        if (this.footEl) {
            const now = this.footEl.textContent ?? ''
            this.setFoot(now ? note + ' · ' + now : note)
        }
    }

    private renderCurrent (): void {
        const file = this.current
        if (!file || !this.bodyEl) {
            return
        }
        // 편집 중에는 **누구도 본문을 덮지 못한다** — 파일 감시가 부른 것이면 "밖에서 바뀜" 으로
        // 알리기만 하고 사람이 친 글자는 그대로 둔다. 덮어쓸지는 저장할 때 묻는다
        if (this.editing) {
            this.editStale = true
            this.refreshEditNote()
            return
        }
        // 본문을 다시 그리면 검색 표시는 통째로 버려진다 — 참조만 비우고, 찾기 줄이 열려 있으면
        // 새 본문에서 다시 찾는다
        this.findHits = []
        this.findIndex = -1
        let st: fs.Stats
        try {
            st = fs.statSync(file)
        } catch {
            this.renderMessage('파일이 사라졌다', file)
            return
        }
        this.setTitle(path.basename(file), file)
        this.setFoot(formatBytes(st.size) + ' · ' + new Date(st.mtimeMs).toLocaleString() + ' · ' + file)

        try {
            switch (classify(file)) {
                case 'image':
                    this.renderImage(file, st)
                    break
                case 'markdown':
                    this.renderMarkdownFile(file)
                    break
                case 'table':
                    this.renderTable(file)
                    break
                case 'text':
                    this.renderText(file)
                    break
                default:
                    this.renderBinary(file, st)
            }
        } catch (err: any) {
            this.renderMessage('읽지 못했다', String(err?.message ?? err))
        }
        this.bodyEl.scrollTop = 0
        this.syncEditButton()
        if (this.findRow && this.findRow.style.display !== 'none') {
            this.runFind()
        }
    }

    private renderImage (file: string, st: fs.Stats): void {
        const url = dataUrl(file, MAX_IMAGE_BYTES)
        if (!url) {
            this.renderMessage('이미지가 너무 크다', formatBytes(st.size) + ' — ' + file)
            return
        }
        this.bodyEl!.innerHTML = '<div class="ad-view-image"><img src="' + url + '" alt=""></div>'
    }

    private renderMarkdownFile (file: string): void {
        const { text, truncated } = readTextHead(file, MAX_TEXT_BYTES)
        const dir = path.dirname(file)
        const html = renderMarkdown(text, {
            resolveImage: src => {
                if (/^https?:/i.test(src)) {
                    // 원격 이미지는 렌더러가 직접 가져오게 둔다 (CSP 가 막으면 대체 텍스트가 보인다)
                    return src
                }
                const target = path.isAbsolute(src) || /^[A-Za-z]:[\\/]/.test(src) ? src : path.join(dir, src)
                return dataUrl(target, MAX_INLINE_IMAGE_BYTES)
            },
        })
        this.bodyEl!.innerHTML = '<div class="ad-view-md">' + html
            + (truncated ? '<p class="ad-view-dim">… 앞부분만 보여준다 (' + formatBytes(MAX_TEXT_BYTES) + ')</p>' : '')
            + '</div>'
    }

    private renderTable (file: string): void {
        const { text, truncated } = readTextHead(file, MAX_TEXT_BYTES)
        const rows = parseDelimited(text, delimiterFor(file))
        if (!rows.length) {
            this.renderMessage('빈 파일', file)
            return
        }
        const head = rows[0].slice(0, MAX_TABLE_COLS)
        const body = rows.slice(1, MAX_TABLE_ROWS + 1)
        const cell = (v: string) => '<td>' + escapeHtml(v ?? '') + '</td>'
        this.bodyEl!.innerHTML = '<div class="ad-view-table"><table><thead><tr><th class="ad-view-rownum">#</th>'
            + head.map(h => '<th>' + escapeHtml(h) + '</th>').join('')
            + '</tr></thead><tbody>'
            + body.map((r, i) => '<tr><td class="ad-view-rownum">' + (i + 1) + '</td>'
                + head.map((_h, c) => cell(r[c])).join('') + '</tr>').join('')
            + '</tbody></table>'
            + (rows.length > MAX_TABLE_ROWS + 1 || truncated
                ? '<p class="ad-view-dim">' + MAX_TABLE_ROWS + '행까지만 보여준다 (전체 ' + (rows.length - 1) + '행)</p>'
                : '')
            + '</div>'
    }

    private renderText (file: string): void {
        const { text, truncated } = readTextHead(file, MAX_TEXT_BYTES)
        const lines = text.split('\n')
        const shown = lines.slice(0, MAX_TEXT_LINES)
        const cut = truncated || lines.length > MAX_TEXT_LINES
        // 줄 번호를 같이 보여준다 — 코드 리뷰 때 `파일:라인` 을 확인하는 자리가 된다.
        //
        // **`<pre>` 두 장이 아니라 줄마다 한 칸(`.ad-cl`)으로 그린다** — 어느 줄을 눌렀는지
        // 알아야 참조를 만들 수 있고, 좌우로 놓은 `<pre>` 안에서는 클릭 지점을 줄로 되돌릴
        // 방법이 없다(글꼴 높이를 재서 나누는 것은 줄바꿈·확대에서 곧 어긋난다).
        // 마크다운·표는 대상이 아니다 — md 는 렌더된 문서라 줄 좌표가 없고, 표는 헤더 때문에
        // 표 행번호와 파일 줄번호가 어긋난다.
        const rows: string[] = ['<div class="ad-view-code ad-view-code-rows" data-ad-ref-file="'
            + escapeHtml(file) + '">']
        shown.forEach((text, i) => {
            const no = i + 1
            rows.push('<div class="ad-cl" data-ad-ref-line="' + no + '">'
                + '<span class="ad-cl-no">' + no + '</span>'
                + '<span class="ad-cl-tx">' + escapeHtml(text) + '</span></div>')
        })
        rows.push('</div>')
        this.bodyEl!.innerHTML = rows.join('')
            + (cut ? '<p class="ad-view-dim">… ' + MAX_TEXT_LINES + '줄까지만 보여준다 (전체 ' + lines.length + '줄)</p>' : '')
        // 다시 그렸으니 고른 줄의 강조를 되돌린다 (파일 감시가 부른 재렌더에서도 선택이 산다)
        this.applyRefSel()
    }

    private renderBinary (file: string, st: fs.Stats): void {
        this.bodyEl!.innerHTML = '<div class="ad-view-empty"><p>' + escapeHtml(path.basename(file)) + '</p>'
            + '<p class="ad-view-dim">미리보기를 지원하지 않는 형식 · ' + formatBytes(st.size) + '</p></div>'
    }

    // ---------- 편집 ----------
    //
    // 패널에서 고쳐 저장한다. 읽기만 되면 오타 하나에도 에디터를 따로 열어야 하고, 그 왕복이
    // 미리보기가 없애려던 것과 같은 종류의 낭비다.
    //
    // **보기 상한과 편집 상한이 다른 이유**는 `readTextAll` 머리주석에 있다 — 저장은 파일을
    // 통째로 다시 쓰므로 앞부분만 들고 열면 뒷부분이 사라진다. 그래서 전체를 읽을 수 있을
    // 때만 편집을 연다.

    /** 지금 보고 있는 것이 편집할 수 있는 글자 파일인가 (이미지·바이너리·`변경` 탭 제외) */
    private canEdit (): boolean {
        if (this.mode !== 'file' || !this.current) {
            return false
        }
        const kind = classify(this.current)
        return kind === 'text' || kind === 'markdown' || kind === 'table'
    }

    /** 편집 버튼의 표시 상태를 지금 화면에 맞춘다 */
    private syncEditButton (): void {
        const btn = this.el?.querySelector('.ad-view-editbtn') as HTMLElement | null
        if (!btn) {
            return
        }
        const usable = this.canEdit()
        btn.classList.toggle('ad-view-btn-on', this.editing)
        btn.style.opacity = usable || this.editing ? '' : '0.35'
        btn.title = this.editing ? '보기로 (Esc)' : usable ? '편집 (저장 Ctrl+S)' : '편집할 수 없는 형식이다'
    }

    private toggleEdit (): void {
        if (this.editing) {
            this.cancelEdit()
        } else {
            this.startEdit()
        }
    }

    private startEdit (): void {
        if (this.editing || !this.bodyEl) {
            return
        }
        const file = this.current
        if (!file || !this.canEdit()) {
            this.setEditNote('이 형식은 편집할 수 없다')
            return
        }
        let read: { text: string, truncated: boolean, bom: boolean, crlf: boolean }
        let st: fs.Stats
        try {
            st = fs.statSync(file)
            read = readTextAll(file, MAX_EDIT_BYTES)
        } catch (err: any) {
            this.setEditNote('읽지 못했다: ' + String(err?.message ?? err))
            return
        }
        if (read.truncated) {
            // 앞부분만 들고 저장하면 뒤가 날아간다 — 열지 않는 것이 유일하게 안전한 답이다
            this.setEditNote('너무 커서 편집할 수 없다 (' + formatBytes(MAX_EDIT_BYTES) + ' 넘음) — 보기 전용')
            this.showEditBar(true)
            return
        }

        this.closeFind()
        this.editing = true
        this.editStale = false
        this.editOverwriteArmed = false
        this.editForceArmed = false
        this.editOrigin = {
            file, text: read.text, bom: read.bom, crlf: read.crlf, mtimeMs: st.mtimeMs,
            readOnly: !isWritable(file),
        }

        const ta = document.createElement('textarea')
        ta.className = 'ad-view-edit'
        ta.spellcheck = false
        ta.value = read.text
        // 편집 중 타이핑이 터미널로 새면 안 된다. 위쪽 패널 리스너(Ctrl+S·Esc)는 캡처가 아니라
        // 버블이라 여기서 멈춰도 먼저 도달한다
        ta.addEventListener('keydown', (e: KeyboardEvent) => {
            const ctrl = e.ctrlKey || e.metaKey
            if (!(ctrl && (e.key === 's' || e.key === 'S' || e.key === 'f' || e.key === 'F')) && e.key !== 'Escape') {
                e.stopPropagation()
            }
        })
        ta.addEventListener('input', () => this.refreshEditNote())
        this.bodyEl.innerHTML = ''
        this.bodyEl.appendChild(ta)
        this.editArea = ta
        ta.focus()

        this.showEditBar(true)
        this.refreshEditNote()
        this.syncEditButton()
    }

    private cancelEdit (): void {
        if (!this.editing) {
            this.showEditBar(false)
            return
        }
        this.editing = false
        this.editArea = null
        this.editOrigin = null
        this.editStale = false
        this.editOverwriteArmed = false
        this.editForceArmed = false
        this.showEditBar(false)
        this.syncEditButton()
        this.renderCurrent()
    }

    private saveEdit (): void {
        if (!this.editing || !this.editArea || !this.editOrigin) {
            return
        }
        const origin = this.editOrigin
        const next = this.editArea.value
        if (next === origin.text && !this.editStale) {
            this.setEditNote('바뀐 것이 없다')
            return
        }

        // 편집하는 동안 밖에서 바뀌었나 — 마지막에 한 번 더 본다(감시가 못 잡는 경우도 있다).
        // 커밋 버튼과 같은 2단 확인: 첫 누름은 경고, 두 번째 누름이 실제로 덮어쓴다
        let outside = this.editStale
        try {
            outside = outside || fs.statSync(origin.file).mtimeMs !== origin.mtimeMs
        } catch {
            // 사라졌으면 아래 쓰기에서 잡힌다 (새로 만들어진다)
        }
        if (outside && !this.editOverwriteArmed) {
            this.editOverwriteArmed = true
            this.setEditNote('밖에서 바뀐 파일이다 — 다시 누르면 덮어쓴다')
            return
        }

        const body = origin.crlf ? next.replace(/\n/g, '\r\n') : next
        const write = () => fs.writeFileSync(origin.file, (origin.bom ? '﻿' : '') + body, 'utf8')
        try {
            write()
        } catch (err: any) {
            const code = String(err?.code ?? '')
            const denied = code === 'EPERM' || code === 'EACCES' || code === 'EROFS'
            if (!denied) {
                this.setEditNote('저장하지 못했다: ' + String(err?.message ?? err))
                return
            }
            // 읽기 전용이다. **말없이 속성을 풀지 않는다** — 이 환경에서 그 정체는 대개 P4 에서
            // 체크아웃하지 않은 파일이고, 체크아웃 없이 쓴 내용은 다음 `p4 sync` 에 조용히
            // 덮인다(읽기 전용 파일에 쓰는 도구는 같은 이유로 `p4 edit` 를 먼저 시도한다).
            // 그래서 사실을 말하고, 그래도 쓰겠다면 두 번째 누름에서만 속성을 푼다
            if (!this.editForceArmed) {
                this.editForceArmed = true
                this.setEditNote('읽기 전용이다 (P4 면 p4 edit 먼저) — 다시 누르면 속성을 풀고 저장한다')
                return
            }
            try {
                fs.chmodSync(origin.file, 0o666)
                write()
            } catch (err2: any) {
                this.setEditNote('저장하지 못했다: ' + String(err2?.message ?? err2))
                return
            }
        }

        this.editing = false
        this.editArea = null
        this.editOrigin = null
        this.editStale = false
        this.editOverwriteArmed = false
        this.editForceArmed = false
        this.showEditBar(false)
        this.setEditNote('')
        this.syncEditButton()
        this.renderCurrent()
        this.setFootNote('저장했다')
    }

    private showEditBar (on: boolean): void {
        if (this.editBarEl) {
            this.editBarEl.style.display = on ? 'flex' : 'none'
        }
        const btns = this.el?.querySelector('.ad-view-edit-btns') as HTMLElement | null
        if (btns) {
            // 편집이 아니라 안내만 띄운 경우(너무 큰 파일)에는 저장/취소를 숨긴다
            btns.style.display = this.editing ? '' : 'none'
        }
    }

    private setEditNote (text: string): void {
        if (this.editNoteEl) {
            this.editNoteEl.textContent = text
        }
        if (!this.editing && this.editBarEl && text) {
            this.editBarEl.style.display = 'flex'
        }
    }

    /** 편집 중 안내줄 — 바뀐 줄 수와 외부 변경을 알린다 */
    private refreshEditNote (): void {
        if (!this.editing || !this.editArea || !this.editOrigin) {
            return
        }
        const dirty = this.editArea.value !== this.editOrigin.text
        if (this.editSaveBtn) {
            this.editSaveBtn.disabled = !dirty && !this.editStale
        }
        // 글자를 고치면 확인 대기는 풀린다 (커밋 줄과 같은 규칙)
        this.editOverwriteArmed = false
        this.editForceArmed = false
        const marks: string[] = []
        marks.push(path.basename(this.editOrigin.file))
        if (this.editOrigin.bom) {
            marks.push('BOM')
        }
        marks.push(this.editOrigin.crlf ? 'CRLF' : 'LF')
        // 읽기 전용은 **열자마자** 말한다 — 저장할 때 알면 그때까지 친 것이 헛일이 된다
        if (this.editOrigin.readOnly) {
            marks.push('읽기 전용')
        }
        marks.push(dirty ? '고침' : '그대로')
        if (this.editStale) {
            marks.push('밖에서 바뀜')
        }
        this.setEditNote(marks.join(' · '))
    }

    // ---------- 찾기 ----------
    //
    // 본문에서 글자를 찾아 표시하고 오간다. 편집 중이면 textarea 안을 찾는다 — 같은 Ctrl+F 로
    // 두 상태를 다 덮어야 "패널 안에서는 이 키" 라는 규칙이 성립한다.

    private openFind (): void {
        if (!this.findRow || !this.findInput) {
            return
        }
        this.findRow.style.display = 'flex'
        this.findInput.focus()
        this.findInput.select()
        this.runFind()
    }

    private closeFind (): void {
        if (this.findRow) {
            this.findRow.style.display = 'none'
        }
        this.clearFindMarks()
        if (this.findCountEl) {
            this.findCountEl.textContent = ''
        }
    }

    /** 검색어가 바뀔 때마다 다시 찾는다 */
    private runFind (): void {
        const term = this.findInput?.value ?? ''
        this.clearFindMarks()
        if (!term) {
            if (this.findCountEl) {
                this.findCountEl.textContent = ''
            }
            return
        }
        if (this.editing && this.editArea) {
            this.findInTextarea(term, 0)
            return
        }
        this.markMatches(term)
        this.findIndex = this.findHits.length ? 0 : -1
        this.showFindHit()
    }

    /** 다음/이전 일치로 이동 */
    private stepFind (dir: number): void {
        const term = this.findInput?.value ?? ''
        if (!term) {
            return
        }
        if (this.editing && this.editArea) {
            this.findInTextarea(term, dir)
            return
        }
        if (!this.findHits.length) {
            this.markMatches(term)
            this.findIndex = this.findHits.length ? 0 : -1
        } else {
            this.findIndex = (this.findIndex + dir + this.findHits.length) % this.findHits.length
        }
        this.showFindHit()
    }

    /**
     * textarea 안 찾기 — 커서 위치부터 다음 일치를 골라 **선택**한다.
     * 본문 찾기와 달리 DOM 을 건드리지 않으므로 편집 내용이 흔들리지 않는다.
     */
    private findInTextarea (term: string, dir: number): void {
        const ta = this.editArea!
        const hay = ta.value.toLowerCase()
        const needle = term.toLowerCase()
        const total = needle ? hay.split(needle).length - 1 : 0
        if (!total) {
            this.setFindCount(0, 0)
            return
        }
        let at: number
        if (dir < 0) {
            const before = ta.selectionStart - 1
            at = hay.lastIndexOf(needle, Math.max(before - 1, 0))
            if (at < 0) {
                at = hay.lastIndexOf(needle)
            }
        } else {
            const from = dir > 0 ? ta.selectionStart + 1 : ta.selectionStart
            at = hay.indexOf(needle, from)
            if (at < 0) {
                at = hay.indexOf(needle)
            }
        }
        if (at < 0) {
            this.setFindCount(0, 0)
            return
        }
        ta.focus()
        ta.setSelectionRange(at, at + term.length)
        // 선택한 자리가 보이도록 대략적인 줄 위치로 스크롤한다 (textarea 는 scrollIntoView 가 없다)
        const line = ta.value.slice(0, at).split('\n').length - 1
        const lineH = Math.max(1, Math.round(ta.scrollHeight / Math.max(1, ta.value.split('\n').length)))
        ta.scrollTop = Math.max(0, line * lineH - ta.clientHeight / 2)
        const nth = hay.slice(0, at).split(needle).length
        this.setFindCount(nth, total)
    }

    /**
     * 본문 텍스트 노드를 훑어 일치마다 `<mark>` 를 넣는다.
     *
     * 본문을 다시 그리지 않고 감싸기만 하는 이유 — 줄 참조(`.ad-cl`)·표·마크다운이 저마다
     * 다른 구조라, 그리는 쪽을 고치면 네 군데를 같이 고쳐야 한다. 텍스트 노드만 건드리면
     * 어떤 구조에서도 성립하고, 지울 때는 `normalize()` 로 원래대로 돌아간다.
     */
    private markMatches (term: string): void {
        const root = this.bodyEl
        if (!root || !term) {
            return
        }
        const needle = term.toLowerCase()
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const targets: Text[] = []
        let node: Node | null
        while ((node = walker.nextNode())) {
            const t = node as Text
            if (t.data && t.data.toLowerCase().indexOf(needle) >= 0) {
                targets.push(t)
            }
        }
        for (const text of targets) {
            if (this.findHits.length >= MAX_FIND_HITS) {
                break
            }
            const parts: Node[] = []
            let rest = text.data
            let guard = 0
            while (guard++ < 500) {
                const at = rest.toLowerCase().indexOf(needle)
                if (at < 0) {
                    break
                }
                if (at > 0) {
                    parts.push(document.createTextNode(rest.slice(0, at)))
                }
                const mark = document.createElement('mark')
                mark.className = 'ad-find-hit'
                mark.textContent = rest.slice(at, at + term.length)
                parts.push(mark)
                this.findHits.push(mark)
                rest = rest.slice(at + term.length)
                if (this.findHits.length >= MAX_FIND_HITS) {
                    break
                }
            }
            if (!parts.length) {
                continue
            }
            if (rest) {
                parts.push(document.createTextNode(rest))
            }
            const frag = document.createDocumentFragment()
            parts.forEach(p => frag.appendChild(p))
            text.parentNode?.replaceChild(frag, text)
        }
    }

    /** `<mark>` 를 걷어내고 원래 텍스트로 되돌린다 */
    private clearFindMarks (): void {
        for (const mark of this.findHits) {
            const parent = mark.parentNode
            if (!parent) {
                continue
            }
            parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
            parent.normalize()
        }
        this.findHits = []
        this.findIndex = -1
    }

    private showFindHit (): void {
        this.findHits.forEach((m, i) => m.classList.toggle('ad-find-cur', i === this.findIndex))
        const cur = this.findHits[this.findIndex]
        if (cur) {
            cur.scrollIntoView({ block: 'center' })
        }
        this.setFindCount(this.findIndex + 1, this.findHits.length)
    }

    private setFindCount (nth: number, total: number): void {
        if (this.findCountEl) {
            this.findCountEl.textContent = total ? nth + '/' + total : '없음'
        }
    }

    // ---------- `변경` 탭 ----------

    /**
     * git 한 번. 실패도 값으로 돌려준다 — 저장소가 아니거나 git 이 없는 것은 흔한 상태이고
     * 예외로 던지면 패널이 빈 화면으로 남는다.
     */
    private runGit (dir: string, args: string[]): Promise<{ ok: boolean, out: string, err: string }> {
        return new Promise(resolve => {
            try {
                execFile('git', ['--no-pager', '-C', dir, ...args], {
                    encoding: 'utf8',
                    maxBuffer: GIT_MAX_BUFFER,
                    timeout: GIT_TIMEOUT_MS,
                    windowsHide: true,
                }, (err: any, stdout: string, stderr: string) => {
                    resolve({
                        ok: !err,
                        out: String(stdout ?? ''),
                        err: String(stderr || err?.message || ''),
                    })
                })
            } catch (e: any) {
                // spawn 자체가 못 뜨는 경우 (git 이 PATH 에 없다)
                resolve({ ok: false, out: '', err: String(e?.message ?? e) })
            }
        })
    }

    /** 자동 갱신 — 간격 제한을 지킨다 (에이전트가 연달아 고치면 신호가 초당 몇 번씩 온다) */
    private maybeAutoDiff (): void {
        const now = Date.now()
        if (now - this.diffAutoAt < DIFF_AUTO_MS) {
            return
        }
        this.diffAutoAt = now
        this.refreshDiff()
    }

    /**
     * 작업트리의 변경을 다시 읽어 그린다.
     *
     * **`diff HEAD` 를 쓰는 이유** — 스테이지에 올렸는지 여부는 "무엇이 바뀌었나" 와 상관이 없다.
     * 에이전트가 `git add` 를 했든 안 했든 사람이 보려는 것은 같은 것이고, 그냥 `git diff` 는
     * 스테이지에 올라간 변경을 감춰 버린다.
     */
    private refreshDiff (): void {
        if (!this.bodyEl) {
            return
        }
        const dir = this.host.cwdFor(this.activeTab ?? {})
        this.setTitle('변경', dir ?? '')
        if (!dir) {
            this.setStatus([])
            this.renderDiffNote('작업 폴더를 모른다',
                '이 탭의 cwd 를 아직 잡지 못했다 — 터미널에서 명령을 한 번 실행하면 잡힌다')
            return
        }
        if (!isDir(dir)) {
            // `git -C <파일>` 은 `fatal: cannot change to …: Invalid argument` 로 끝난다 —
            // 그 원문을 그대로 보여 주면 무슨 일인지 알 수 없다. cwd 가 어떻게 파일이 되는지는
            // deck.service `touchCwd` 주석 참고 (Tabby 의 윈도우 cwd 추정)
            this.setStatus([])
            this.renderDiffNote('작업 폴더가 폴더가 아니다', dir)
            return
        }
        const seq = ++this.diffSeq
        this.diffAutoAt = Date.now()
        if (!this.bodyEl.querySelector('.ad-view-diff')) {
            // 첫 진입에만 안내를 띄운다 — 갱신마다 화면을 비우면 스크롤이 튄다
            this.renderDiffNote('변경을 읽고 있다', dir)
        }

        Promise.all([
            this.runGit(dir, ['diff', 'HEAD', '--no-color']),
            this.runGit(dir, ['status', '--porcelain']),
            this.runGit(dir, ['rev-parse', '--show-toplevel']),
        ]).then(async ([diff, status, root]) => {
            let text = diff.out
            if (!diff.ok) {
                const msg = diff.err
                if (/not a git repository/i.test(msg)) {
                    this.noGit(seq, 'git 저장소가 아니다', dir,
                        '이 폴더는 git 으로 관리되지 않는다 — 무엇이 바뀌었는지(diff)는 비교할 기준이 없다')
                    return
                }
                if (/ENOENT|not recognized|command not found/i.test(msg)) {
                    this.noGit(seq, 'git 을 찾지 못했다', 'PATH 에 git 이 있어야 변경 내용을 비교할 수 있다',
                        'git 이 없어 diff 는 만들 수 없다')
                    return
                }
                if (/ambiguous argument .?HEAD|unknown revision|bad revision/i.test(msg)) {
                    // 커밋이 하나도 없는 새 저장소 — HEAD 가 없으니 기준 없이 뽑는다
                    const first = await this.runGit(dir, ['diff', '--no-color'])
                    text = first.out
                    if (!first.ok && !text) {
                        this.failDiff(seq, '변경을 읽지 못했다', first.err)
                        return
                    }
                } else if (!text) {
                    this.failDiff(seq, '변경을 읽지 못했다', msg)
                    return
                }
            }
            const allFiles = parseUnifiedDiff(text)
            const allUntracked = status.ok ? parseUntracked(status.out) : []
            this.diffRoot = root.ok ? root.out.trim() || dir : dir
            // **범위를 여기서 좁힌다** — git 명령에 경로를 넘기지 않는 이유: 세션이 만진 파일이
            // 수백 개면 명령줄 길이 상한에 걸리고, 그 목록이 저장소 밖 파일을 담고 있으면
            // git 이 통째로 실패한다(`fatal: ... outside repository`). 걸러 내는 쪽이 안전하다.
            const touched = this.diffScope === 'session' ? this.touchedNow() : []
            const files = filterTouched(allFiles, f => f.path, this.diffRoot, touched)
            const untracked = filterTouched(allUntracked, p => p, this.diffRoot, touched)
            this.diffHidden = (allFiles.length - files.length) + (allUntracked.length - untracked.length)
            // 좁히기가 예상과 다를 때 **"보고가 안 왔다" 와 "경로가 안 맞는다" 를 가르는** 자리.
            // 화면에는 숨긴 개수만 나오는데, 그것만으로는 목록이 비었는지 경로 모양이 어긋났는지
            // 알 수 없다 (2026-09-11 회귀에서 이것 없이 한 바퀴 돌았다). `__agentdeck.view().diffDebug`
            this.diffDebug = {
                root: this.diffRoot, scope: this.diffScope,
                touched: touched.slice(0, 5), all: allFiles.length, kept: files.length,
                sample: allFiles.slice(0, 5).map(f => f.path),
            }
            this.finishDiff(seq, () => {
                // 같은 `status --porcelain` 출력을 두 파서가 나눠 읽는다 — 추적안됨 목록(옛 동작)과
                // 스테이지 상태. git 을 한 번 더 부르면 두 결과가 서로 다른 시점을 보게 된다
                this.setStatus(status.ok ? parseStatus(status.out) : [])
                this.renderDiff(files, untracked, dir)
            })
        }).catch((err: any) => {
            // 파싱까지 포함해 어디서 터져도 패널은 문장을 남긴다
            this.failDiff(seq, '변경을 읽지 못했다', String(err?.message ?? err))
        })
    }

    /** 지금 탭에서 에이전트가 만진 파일 (없거나 배선이 없으면 빈 배열 = 좁히지 않는다) */
    private touchedNow (): string[] {
        return this.host.touchedFor?.(this.activeTab ?? {}) ?? []
    }

    /** 늦게 온 응답이 새 화면을 덮지 않게 — 번호와 모드가 그대로일 때만 그린다 */
    private finishDiff (seq: number, draw: () => void): void {
        if (seq === this.diffSeq && this.mode === 'diff' && this.bodyEl) {
            draw()
        }
    }

    /**
     * 실패 문장을 그리고 **스테이지 상태를 비운다.**
     * 상태를 남겨 두면 저장소를 못 읽는 화면에서 딱지·요약이 이전 저장소 것으로 남고,
     * 그 딱지를 누르면 지금 보고 있지 않은 저장소에 `git add` 가 나간다.
     */
    private failDiff (seq: number, title: string, detail: string): void {
        this.finishDiff(seq, () => {
            this.setStatus([])
            this.renderDiffNote(title, detail)
        })
    }

    /**
     * git 이 없거나 저장소가 아닐 때 — **그래도 이 세션이 만진 파일은 보여준다.**
     *
     * 왜 필요한가: 이 패널의 목적은 "에이전트가 방금 무엇을 건드렸나" 이고, 그 답은 훅이 이미
     * 알고 있다(`touchedFor`). git 은 거기에 **무엇이 어떻게 바뀌었는지**를 더해 주는 도구일 뿐이다.
     * 그런데 예전에는 git 이 없으면 안내 한 줄만 띄우고 끝나서, git 을 안 쓰는 폴더(스크립트 모음·
     * 기획 문서 폴더·임시 작업 폴더)에서 탭이 통째로 죽은 기능이 됐다 (2026-09-11 유저 지적).
     *
     * **줄 내용(diff)은 만들지 않는다** — 기준(HEAD)이 없으니 "무엇이 바뀌었다" 를 말할 근거가
     * 없고, 없는 근거를 지어내는 것보다 목록과 파일 크기·시각까지만 말하는 편이 정직하다.
     * 클릭하면 `파일` 탭에서 내용을 본다(추적 안 됨 목록과 같은 `data-ad-open` 경로).
     *
     * 훅이 없는 에이전트(Codex·Gemini)는 만진 목록이 비어 있으므로 예전처럼 안내만 남는다 —
     * 그 경우엔 정말로 보여줄 근거가 하나도 없다.
     */
    private noGit (seq: number, title: string, detail: string, why: string): void {
        const touched = this.touchedNow()
        if (!touched.length) {
            this.failDiff(seq, title, detail)
            return
        }
        const cwd = this.host.cwdFor(this.activeTab ?? {})
        this.diffRoot = null
        this.diffHidden = 0
        this.finishDiff(seq, () => {
            // 스테이지 상태·커밋 줄은 git 이 있어야 뜻이 있다 — 여기서는 통째로 감춘다
            this.setStatus([])
            this.setCommitVisible(false)
            const out: string[] = ['<div class="ad-view-diff">']
            out.push('<div class="ad-view-diff-sum">'
                + escapeHtml('이 세션이 만진 파일 ' + touched.length + '개') + '</div>')
            out.push('<p class="ad-view-dim">' + escapeHtml(title + ' — ' + why) + '</p>')
            out.push('<div class="ad-view-diff-list">')
            for (const abs of touched.slice(0, MAX_DIFF_FILES)) {
                const shown = refPathFrom(abs, cwd)
                out.push('<div class="ad-view-diff-u" data-ad-open="' + escapeHtml(abs) + '">'
                    + escapeHtml(shown) + ' <span class="ad-view-dim">'
                    + escapeHtml(fileNote(abs)) + '</span></div>')
            }
            if (touched.length > MAX_DIFF_FILES) {
                out.push('<p class="ad-view-dim">… 이후 생략</p>')
            }
            out.push('</div></div>')
            this.bodyEl!.innerHTML = out.join('')
            this.setFoot(detail)
        })
    }

    /** 커밋 줄은 git 이 있을 때만 뜻이 있다 — 모드와 별개로 여닫는다 */
    private setCommitVisible (show: boolean): void {
        if (this.commitEl) {
            this.commitEl.style.display = show && this.mode === 'diff' ? 'block' : 'none'
        }
    }

    private renderDiffNote (title: string, detail: string): void {
        if (!this.bodyEl) {
            return
        }
        this.bodyEl.innerHTML = '<div class="ad-view-diff"><div class="ad-view-empty"><p>'
            + escapeHtml(title) + '</p><p class="ad-view-dim">' + escapeHtml(detail) + '</p></div></div>'
        this.setFoot(detail)
    }

    private renderDiff (files: DiffFile[], untracked: string[], dir: string): void {
        // git 이 답한 자리다 — `noGit` 이 감춰 둔 커밋 줄을 되돌린다
        this.setCommitVisible(true)
        const shownFiles = files.slice(0, MAX_DIFF_FILES)
        const out: string[] = ['<div class="ad-view-diff">']

        // 요약줄에 **지금 보고 있는 범위**를 함께 적는다 — 숫자만 있으면 "이게 전부인가" 를
        // 알 수 없다. 좁혀서 가려진 게 있을 때만 그 수를 말한다(0 이면 군더더기다)
        const scopeNote = this.diffScope === 'session' && this.diffHidden > 0
            ? ' · 이 세션이 만진 것만 (' + this.diffHidden + '개 숨김)'
            : ''
        out.push('<div class="ad-view-diff-sum">' + escapeHtml(formatStat(files) + scopeNote) + '</div>')

        if (shownFiles.length) {
            out.push('<div class="ad-view-diff-list">')
            shownFiles.forEach((f, i) => {
                out.push('<button class="ad-view-diff-item" data-ad-diff="ad-diff-' + i + '">'
                    + '<span class="ad-view-diff-st ad-view-diff-st-' + f.status + '">'
                    + escapeHtml(statusLabel(f)) + '</span>'
                    + this.stageChipHtml(f.path)
                    + '<span class="ad-view-diff-name">' + escapeHtml(f.path) + '</span>'
                    + '<span class="ad-view-diff-num"><b class="ad-plus">+' + f.added + '</b>'
                    + '<b class="ad-minus">-' + f.removed + '</b></span></button>')
            })
            if (files.length > shownFiles.length) {
                out.push('<p class="ad-view-dim">… 이후 생략 (전체 ' + files.length + '개 파일)</p>')
            }
            out.push('</div>')
        }

        if (untracked.length) {
            // 내용은 붙이지 않는다 (gitDiff.parseUntracked 주석 참고) — 이름만 알려 준다
            const list = untracked.slice(0, MAX_UNTRACKED)
            out.push('<div class="ad-view-diff-untracked"><div class="ad-view-diff-sub">추적 안 됨 · '
                + untracked.length + '개</div>')
            for (const p of list) {
                // `?? dir/` 은 폴더 하나로 묶여서 온다 — 폴더는 열 수 없으니 이름만 보여준다
                const open = p.endsWith('/') ? '' : ' data-ad-open="' + escapeHtml(this.absOf(p)) + '"'
                // 폴더(`dir/`)도 딱지는 붙인다 — `git add -- dir/` 는 폴더째 올리는 정상 동작이고,
                // 새로 만든 산출물 폴더를 한 번에 올리는 것이 실제로 가장 흔한 조작이다
                // 딱지와 경로 사이의 공백은 **글자로** 넣는다 — 이 줄은 flex 가 아니라서
                // 스타일이 아직 없거나 좁아 접힐 때 `새파일docs/x.md` 로 붙어 읽힌다
                out.push('<div class="ad-view-diff-u"' + open + '>' + this.stageChipHtml(p)
                    + ' ' + escapeHtml(p) + '</div>')
            }
            if (untracked.length > list.length) {
                out.push('<p class="ad-view-dim">… 이후 생략</p>')
            }
            out.push('</div>')
        }

        if (!shownFiles.length && !untracked.length) {
            // **"변경 없음" 과 "범위가 좁아서 안 보인다" 는 다른 상황이다.** 후자를 같은 문장으로
            // 말하면 저장소에 변경이 없다는 거짓말이 되고, 사람은 `전체` 버튼을 누를 생각을 못 한다
            const narrowed = this.diffScope === 'session' && this.diffHidden > 0
            out.push('<div class="ad-view-empty"><p>'
                + (narrowed ? '이 세션이 만진 파일은 아직 없다' : '변경 없음') + '</p>'
                + '<p class="ad-view-dim">' + escapeHtml(narrowed
                    ? '저장소에는 ' + this.diffHidden + '개의 변경이 있다 — `전체` 로 보면 나온다'
                    : dir) + '</p></div>')
        }

        /** 본문 줄 예산 — 파일 하나가 다 먹지 않게 파일별 상한도 같이 본다 */
        let budget = MAX_DIFF_LINES
        shownFiles.forEach((f, i) => {
            out.push('<div class="ad-view-diff-file" id="ad-diff-' + i + '">')
            const title = f.oldPath ? f.oldPath + ' → ' + f.path : f.path
            out.push('<div class="ad-view-diff-fhead" data-ad-open="' + escapeHtml(this.absOf(f.path))
                + '" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</div>')
            if (f.binary) {
                out.push('<div class="ad-view-diff-note">바이너리 · 내용 비교 없음</div>')
            } else if (!f.lines.length) {
                out.push('<div class="ad-view-diff-note">내용 변경 없음</div>')
            } else {
                const cap = Math.min(f.lines.length, MAX_DIFF_FILE_LINES, Math.max(budget, 0))
                // 줄 참조가 어느 파일의 줄인지는 이 상자가 말한다 — git 이 낸 **저장소 루트 기준**
                // 경로 그대로 심고, 절대화·cwd 상대화는 sendRef 가 순수 함수로 한다
                out.push('<div class="ad-view-diff-lines" data-ad-ref-file="'
                    + escapeHtml(f.path) + '">')
                for (let n = 0; n < cap; n++) {
                    out.push(this.diffLineHtml(f.lines[n]))
                }
                out.push('</div>')
                budget -= cap
                if (cap < f.lines.length) {
                    out.push('<div class="ad-view-diff-note">… 이후 생략 (전체 ' + f.lines.length + '줄)</div>')
                }
            }
            out.push('</div>')
        })

        out.push('</div>')
        this.bodyEl!.innerHTML = out.join('')
        // **자동 갱신이 방금 본문을 통째로 덮었다** — 고른 줄의 강조를 여기서 되돌린다.
        // 선택은 클래스 필드(refSel)에 있으므로 갱신을 몇 번 거쳐도 살아 있다
        this.applyRefSel()
        this.setFoot(formatStat(files) + ' · ' + new Date().toLocaleTimeString() + ' 기준 · ' + dir)
    }

    /**
     * diff 한 줄. **원문은 반드시 이스케이프한 뒤 우리 태그만 붙인다** — 소스코드 안의
     * `<script>` 나 `onerror=` 가 태그가 되면 안 된다 (markdown.ts 와 같은 규칙).
     */
    private diffLineHtml (line: DiffLine): string {
        const mark = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
        const body = line.kind === 'hunk' ? line.text : mark + line.text
        // 참조에 쓸 번호는 **신 파일 기준**이다 (gitDiff.refLineNo 주석).
        // 번호가 없는 줄(삭제줄·헝크 머리줄)에는 번호를 심지 않고 `data-ad-ref-del` 만 붙인다 —
        // 눌러도 아무것도 보내지 않고 이유만 말한다. 직전 신 번호로 때우면 `file:42` 가
        // 삭제된 내용이 아니라 엉뚱하게 남아 있는 42번 줄을 가리키고, 에이전트는 그 줄을
        // 자신 있게 고친다. 조용히 틀리는 쪽보다 못 만들고 이유를 말하는 쪽이 낫다
        const no = refLineNo(line)
        const ref = no === null
            ? ' data-ad-ref-del="' + (line.kind === 'hunk' ? 'hunk' : 'del') + '"'
            : ' data-ad-ref-line="' + no + '"'
        return '<div class="ad-dl ad-dl-' + line.kind + '"' + ref + '>'
            + '<span class="ad-dl-no">' + (line.oldNo ?? '') + '</span>'
            + '<span class="ad-dl-no">' + (line.newNo ?? '') + '</span>'
            + '<span class="ad-dl-tx">' + escapeHtml(body) + '</span></div>'
    }

    /** git 이 내는 경로는 **저장소 루트 기준**이다 — 탭 cwd 로 풀면 하위 폴더에서 어긋난다 */
    private absOf (rel: string): string {
        const root = this.diffRoot
        return root ? path.join(root, rel) : rel
    }

    // ---------- `파일:라인` 참조 ----------
    //
    // 화면에서 고른 줄을 `src/a.ts:12` 한 낱말로 만들어 **활성 탭 터미널에 넣는다.**
    // 에이전트에게 자리를 알려 주려고 파일명을 다시 치고 줄번호를 세는 왕복이 이 패널이
    // 없애려던 것과 같은 종류의 낭비다.
    //
    // 번호·경로·따옴표 판정은 전부 `gitDiff.ts` 의 순수 함수(refLineNo · joinRefPath ·
    // refPathFrom · formatLineRef)가 한다 — 여기서 규칙을 다시 쓰지 않는다. 여기 있는 것은
    // DOM 에서 "무엇을 눌렀나" 를 읽고 그 함수들에 넘기는 배선뿐이다.
    //
    // **패널이 터미널에 직접 쓰지 않는다** — 쓰기는 host.sendText(deck.service 의 sendToPane)가
    // 맡는다. 거기에 한글 조합 중 입력 순서 보정과 진단 로그가 있다.

    /**
     * 줄을 눌렀다. Shift 면 직전에 고른 줄부터의 **범위**가 된다.
     *
     * 본문을 다시 그리지 않고 클래스만 갈아 끼운다 — 다시 그리면 스크롤이 튀고(긴 diff 에서
     * 방금 보던 자리를 잃는다) `변경` 은 git 을 한 번 더 돌린다.
     */
    private clickRefLine (row: HTMLElement, extend: boolean): void {
        // **드래그로 글자를 긁은 직후에도 click 이 한 번 온다.** 그때 참조를 넣으면 복사하려던
        // 조작이 터미널에 글자를 뿌린다 — 본문은 `user-select: text` 로 열어 둔 자리이고
        // 긁어 복사하는 것은 의도된 기능이다. 그래서 선택이 남아 있으면 아무것도 하지 않는다.
        // 범위 선택(Shift)은 브라우저가 글자 선택을 같이 늘리므로 이 규칙에서 빼고,
        // 늘어난 선택만 걷어낸다 (그대로 두면 파란 띠가 줄 강조와 겹쳐 읽기 어렵다)
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null
        if (!extend) {
            if (sel && !sel.isCollapsed && String(sel)) {
                return
            }
        } else if (sel && !sel.isCollapsed) {
            try {
                sel.removeAllRanges()
            } catch {
                // 선택을 못 지우는 경우 — 강조가 겹쳐 보일 뿐이라 그냥 넘어간다
            }
        }

        // 참조를 만들 수 없는 줄이다. **직전 신 번호로 때우지 않는다** (diffLineHtml 주석)
        const del = row.getAttribute('data-ad-ref-del')
        if (del !== null) {
            this.setRefNote(del === 'hunk'
                ? '헝크 머리줄은 내용이 아니다 — 아래 줄을 고르면 그 자리를 가리킨다'
                : '삭제된 줄은 지금 파일에 없다 — 옆 문맥줄을 고르면 그 자리를 가리킨다')
            return
        }
        const no = Number(row.getAttribute('data-ad-ref-line'))
        if (!Number.isFinite(no) || no <= 0) {
            return
        }
        const box = row.closest('[data-ad-ref-file]') as HTMLElement | null
        const key = box?.getAttribute('data-ad-ref-file') ?? ''
        if (!key) {
            this.setRefNote('어느 파일의 줄인지 몰라 참조를 만들지 못했다')
            return
        }

        // Shift 는 **직전 선택의 시작**에서 늘린다 — 12 를 고른 뒤 20 을 Shift 로 누르면 12-20,
        // 이어 15 를 누르면 12-15 다. 다른 파일이면 늘릴 자리가 없으니 그 줄 하나로 시작한다
        const prev = this.refSel
        const anchor = extend && prev && prev.file === key ? prev.from : no
        const from = Math.min(anchor, no)
        const to = Math.max(anchor, no)
        this.refSel = { file: key, from, to }
        this.applyRefSel()
        this.sendRef(key, from, to)
    }

    /**
     * 고른 줄에 `ad-ref-sel` 을 다시 붙인다. 본문을 그린 뒤마다 불린다 —
     * 상태는 `refSel`(클래스 필드)에 있어서 자동 갱신이 본문을 덮어도 선택이 산다.
     *
     * 경로를 CSS 선택자에 넣지 않고 값을 읽어 비교한다 — 경로에는 선택자 특수문자가
     * 들어올 수 있고(공백·괄호·`#`), 이스케이프를 우리가 다시 구현할 이유가 없다.
     */
    private applyRefSel (): void {
        if (!this.bodyEl) {
            return
        }
        for (const on of Array.from(this.bodyEl.querySelectorAll('.ad-ref-sel'))) {
            on.classList.remove('ad-ref-sel')
        }
        const sel = this.refSel
        if (!sel) {
            return
        }
        for (const box of Array.from(this.bodyEl.querySelectorAll('[data-ad-ref-file]'))) {
            if (box.getAttribute('data-ad-ref-file') !== sel.file) {
                continue
            }
            for (const row of Array.from(box.querySelectorAll('[data-ad-ref-line]'))) {
                const no = Number(row.getAttribute('data-ad-ref-line'))
                if (Number.isFinite(no) && no >= sel.from && no <= sel.to) {
                    row.classList.add('ad-ref-sel')
                }
            }
        }
    }

    /**
     * 참조 한 낱말을 만들어 터미널에 넣는다.
     *
     * `변경` 은 저장소 루트 기준 경로를, `파일` 은 절대경로를 상자에 심어 둔다 —
     * `joinRefPath` 가 이미 절대경로면 그대로 돌려주므로 두 갈래를 한 줄로 다룰 수 있다.
     * 그 다음 `refPathFrom` 이 **그 탭 cwd 기준**으로 줄이고, `formatLineRef` 가 번호와
     * 따옴표를 맡는다.
     */
    private sendRef (key: string, from: number, to: number): void {
        const cwd = this.host.cwdFor(this.activeTab ?? {})
        const text = formatLineRef(refPathFrom(joinRefPath(this.diffRoot, key), cwd), from, to)
        if (!text) {
            this.setRefNote('참조를 만들지 못했다 — 경로가 비어 있다')
            return
        }
        if (!this.host.sendText) {
            // 배선이 없어도 패널은 동작한다(ViewHost.sendText 가 optional 인 이유) — 다만
            // 사람이 눌렀는데 아무 일도 안 일어나면 안 되므로 사실을 문장으로 말한다
            this.setRefNote('터미널에 넣지 못했다 — 넣을 자리가 배선되지 않았다 · ' + text)
            return
        }

        // 직전에 넣은 것이 지금 참조의 **접두**면 늘어난 꼬리만 보낸다 (`a.ts:12` → `-20`).
        // 그러지 않으면 프롬프트에 `a.ts:12a.ts:12-20` 이 쌓이고, 그 줄을 사람이 손으로
        // 지워야 한다. REF_CHAIN_MS 가 지나면 그 사이에 문장을 쳤다고 보고 처음부터 넣는다.
        // 공백이 든 경로는 따옴표로 감싸이므로(formatLineRef) 꼬리를 이어 붙일 수 없다 —
        // `"a b.ts:12"` 뒤에 `-20"` 를 붙이면 따옴표가 어긋난다. 그때는 통째로 보낸다
        const now = Date.now()
        const prev = this.refLastSent
        const chain = !!prev && now - prev.at < REF_CHAIN_MS
            && text.length > prev.text.length && text.startsWith(prev.text)
            && prev.text[0] !== '"' && text[0] !== '"'
        const payload = chain ? text.slice(prev!.text.length) : text

        let ok = false
        try {
            ok = !!this.host.sendText(payload)
        } catch (err: any) {
            this.setRefNote('터미널에 넣지 못했다 · ' + String(err?.message ?? err))
            return
        }
        if (!ok) {
            // 보낼 팬이 없다(탭이 없거나 터미널이 아니다) — 넣은 것으로 기억하지 않는다.
            // 기억해 두면 다음 누름이 "꼬리만" 을 보내 프롬프트에 `-20` 만 남는다
            this.setRefNote('터미널에 넣지 못했다 — 넣을 터미널이 없다 · ' + text)
            return
        }
        // 터미널에 지금 남아 있는 것은 (꼬리만 보냈어도) 참조 전체다
        this.refLastSent = { text, at: now }
        this.setRefNote('넣었다 · ' + text + (chain ? ' (꼬리만)' : ''), true)
    }

    /**
     * 참조 안내줄. 방금 일어난 일일 때만(`flash`) 강조를 얹고 REF_FLASH_MS 뒤에 뗀다 —
     * 계속 켜져 있으면 다음에 무엇이 새로 일어났는지 구별이 안 된다.
     */
    private setRefNote (text: string, flash = false): void {
        const el = this.refNoteEl
        if (!el) {
            return
        }
        el.textContent = text
        el.title = text
        el.style.display = text ? 'block' : 'none'
        if (this.refFlashTimer) {
            clearTimeout(this.refFlashTimer)
            this.refFlashTimer = null
        }
        el.classList.toggle('ad-view-ref-on', !!text && flash)
        if (!text || !flash) {
            return
        }
        this.refFlashTimer = setTimeout(() => {
            this.refFlashTimer = null
            el.classList.remove('ad-view-ref-on')
        }, REF_FLASH_MS)
    }

    // ---------- 스테이지 · 커밋 ----------

    /**
     * 파일 한 줄에 붙는 스테이지 딱지.
     *
     * 글자는 **지금 상태**를, `title` 은 누르면 무엇이 되는지를 말한다 — 딱지가 동작을 가리키면
     * "올림" 이 "올렸다" 인지 "올린다" 인지 읽는 사람이 알 수 없다.
     * status 에 없는 경로면 **아무것도 붙이지 않는다.** 상태를 모르는 채로 누를 것을 주면
     * 사람이 의도하지 않은 것이 올라간다.
     */
    private stageChipHtml (rel: string): string {
        const entry = this.statusByPath.get(rel)
        if (!entry) {
            return ''
        }
        const act = entry.state === 'staged' ? 'reset' : 'add'
        let tip: string
        if (act === 'reset') {
            tip = '누르면 스테이지에서 내린다 — git reset -q -- ' + rel
        } else if (entry.state === 'conflict') {
            tip = '누르면 충돌 해결로 표시한다 — git add -- ' + rel
        } else {
            tip = '누르면 스테이지에 올린다 — git add -- ' + rel
        }
        return '<span class="ad-view-stage ad-view-stage-' + entry.state + '"'
            + ' data-ad-stage="' + escapeHtml(rel) + '" data-ad-stage-act="' + act + '"'
            + ' title="' + escapeHtml(tip) + '">' + escapeHtml(stageLabel(entry.state)) + '</span>'
    }

    /**
     * 읽어 온 status 를 기억하고 커밋 줄의 요약·버튼 잠금을 맞춘다.
     * **알림 문장(note)은 건드리지 않는다** — 자동 갱신이 1.5초마다 도는데 여기서 note 를 쓰면
     * 방금 한 조작의 결과("커밋했다" 등)가 곧바로 지워진다.
     */
    private setStatus (entries: StatusEntry[]): void {
        this.statusEntries = entries
        this.statusByPath = new Map<string, StatusEntry>()
        for (const e of entries) {
            this.statusByPath.set(e.path, e)
        }
        if (this.commitSumEl) {
            this.commitSumEl.textContent = formatStageSummary(entries)
        }
        this.syncCommitButton()
    }

    /** 버튼의 잠금·라벨을 상태에서 다시 계산한다 (상태를 바꾸는 곳마다 이걸 부른다) */
    private syncCommitButton (): void {
        const btn = this.commitBtn
        if (!btn) {
            return
        }
        // **메시지가 비면 아예 못 누른다** — 우발 커밋을 막는 첫 잠금이다 (둘째는 확인 대기,
        // 셋째는 gitCommit.commitArgs 가 빈 배열을 내는 것)
        btn.disabled = !validateMessage(this.commitInput?.value ?? '').ok || this.gitBusy
        btn.textContent = this.commitArmed ? '커밋 확인' : '커밋'
        btn.classList.toggle('ad-view-commit-armed', this.commitArmed)
        btn.title = this.commitArmed
            ? '한 번 더 누르면 실제로 커밋한다 (Esc 취소)'
            : '메시지를 넣고 두 번 눌러야 커밋된다 — git commit -m'
    }

    private setCommitNote (text: string): void {
        if (this.commitNoteEl) {
            this.commitNoteEl.textContent = text
            this.commitNoteEl.title = text
        }
    }

    private disarmCommit (): void {
        this.commitArmed = false
        this.syncCommitButton()
    }

    /**
     * 스테이지 토글. **사람이 딱지를 누른 경로에서만 불린다** — 자동 갱신(viewerFollow·파일 감시·
     * maybeAutoDiff)은 이 함수를 부르지 않는다.
     *
     * git 은 **저장소 루트**에서 돌린다. status/diff 가 내는 경로가 루트 기준이라 탭 cwd 에서
     * 돌리면 하위 폴더에서 "pathspec 이 없다" 가 된다 (absOf 와 같은 사정).
     */
    private async toggleStage (rel: string, act: 'add' | 'reset'): Promise<void> {
        if (!rel || this.gitBusy) {
            return
        }
        const dir = this.diffRoot ?? this.host.cwdFor(this.activeTab ?? {})
        if (!dir) {
            this.setCommitNote('작업 폴더를 몰라 스테이지를 바꾸지 못한다')
            return
        }
        const args = act === 'add' ? stageArgs([rel]) : unstageArgs([rel])
        if (!args.length) {
            return
        }
        this.gitBusy = true
        this.disarmCommit()
        try {
            let r = await this.runGit(dir, args)
            if (!r.ok && act === 'reset'
                && /ambiguous argument .?HEAD|unknown revision|bad revision|HEAD/i.test(r.err)) {
                // 커밋이 0개인 저장소 — reset 이 HEAD 를 못 푼다 (`변경` 탭이 `diff HEAD` 대신
                // `diff` 로 폴백해야 하는 것과 같은 사정). index 에서만 뺀다
                r = await this.runGit(dir, unstageFallbackArgs([rel]))
            }
            this.setCommitNote(r.ok
                ? (act === 'add' ? '스테이지에 올렸다 · ' : '스테이지에서 내렸다 · ') + rel
                : '스테이지를 바꾸지 못했다 · ' + (firstLine(r.err) || firstLine(r.out)))
        } catch (err: any) {
            // 예외로 죽지 않는다 — 실패도 문장으로 끝난다 (runGit 과 같은 규칙)
            this.setCommitNote('스테이지를 바꾸지 못했다 · ' + String(err?.message ?? err))
        } finally {
            this.gitBusy = false
            this.syncCommitButton()
        }
        this.refreshDiff()
    }

    /**
     * 커밋 버튼 / 입력창 Enter. **두 번 눌러야 커밋된다** — 첫 누름은 확인 대기(arm),
     * 두 번째 누름이 실행이다. 검증에 걸리면 첫 누름에서 이유만 말하고 끝난다.
     */
    private pressCommit (): void {
        if (this.gitBusy) {
            return
        }
        const msg = this.commitInput?.value ?? ''
        const v = validateMessage(msg)
        if (!v.ok) {
            this.disarmCommit()
            this.setCommitNote(v.reason ?? '커밋 메시지를 확인해야 한다')
            return
        }
        if (!hasStaged(this.statusEntries)) {
            // git 도 거절하지만 이유를 여기서 먼저 말한다 — "커밋했다" 를 기다리다 실패 문장을
            // 보는 것보다, 무엇을 해야 하는지(딱지를 눌러 올려라)를 듣는 것이 낫다
            this.disarmCommit()
            this.setCommitNote('스테이지에 올린 것이 없다 — 파일 목록의 딱지를 눌러 올려라')
            return
        }
        if (!this.commitArmed) {
            this.commitArmed = true
            this.syncCommitButton()
            this.setCommitNote('다시 누르면 커밋한다 (Esc 취소) · ' + formatStageSummary(this.statusEntries))
            return
        }
        this.runCommit(msg)
    }

    /** 실제 커밋. pressCommit 의 확인 단계를 지난 뒤에만 불린다 */
    private async runCommit (msg: string): Promise<void> {
        const args = commitArgs(msg)
        if (!args.length) {
            // 세 번째 잠금 — 여기까지 잘못 들어와도 인자가 없어 커밋이 만들어지지 않는다
            this.disarmCommit()
            this.setCommitNote('커밋 메시지를 확인해야 한다')
            return
        }
        const dir = this.diffRoot ?? this.host.cwdFor(this.activeTab ?? {})
        if (!dir) {
            this.disarmCommit()
            this.setCommitNote('작업 폴더를 몰라 커밋하지 못한다')
            return
        }
        this.gitBusy = true
        this.syncCommitButton()
        try {
            const r = await this.runGit(dir, args)
            if (r.ok) {
                // 성공하면 입력창을 비운다 — 같은 메시지가 남아 있으면 두 번 커밋되는 사고가 난다
                if (this.commitInput) {
                    this.commitInput.value = ''
                }
                this.setCommitNote('커밋했다 · ' + (firstLine(r.out) || firstLine(r.err)))
            } else {
                // 훅 거부·user.name 없음·스테이지 비었음 — git 은 이유를 stdout 에 쓰는 경우가 있다
                this.setCommitNote('커밋하지 못했다 · ' + (firstLine(r.err) || firstLine(r.out)))
            }
        } catch (err: any) {
            this.setCommitNote('커밋하지 못했다 · ' + String(err?.message ?? err))
        } finally {
            this.gitBusy = false
            this.commitArmed = false
            this.syncCommitButton()
        }
        this.refreshDiff()
    }

    dispose (): void {
        this.unwatch()
        // 안내줄 강조 타이머는 DOM 이 사라진 뒤에 깨어난다 — 남겨 두면 지운 노드를 건드린다
        if (this.refFlashTimer) {
            clearTimeout(this.refFlashTimer)
            this.refFlashTimer = null
        }
        this.el?.remove()
        this.el = null
        this.refNoteEl = null
    }
}
