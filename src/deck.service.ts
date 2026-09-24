import * as fs from 'fs'
import { monitorEventLoop, PerformanceTrace, perfNow } from './performance'
import { Injectable, NgZone, Optional } from '@angular/core'
import { LocaleService } from 'tabby-core'
import { Lang, pickLang } from './i18n'
import { sidebarText, sidebarMarkup, sidebarReset, sidebarReason, RESET_COPY } from './sidebarI18n'
import { newlineSequence, canRepairComposer } from './terminalInput'
import { installCursorVisibilityFix } from './cursorVisibility'
import { identifyScreenAgent, isLiveCodexScreen, TerminalAgentTracker } from './screenAgent'
import { installCodexWheel } from './codexWheel'
import { installCodexKeys } from './codexKeys'
import { AppService, ConfigService, BaseTabComponent, HostWindowService, HotkeysService, PlatformService, ProfilesService } from 'tabby-core'
import { SettingsTabComponent } from 'tabby-settings'
import { WorkStatusService } from './status.service'
import { WorkNotifyService } from './notify.service'
import { SessionSlots } from './sessionSlots'
import { applyOutput, applyTitle, releaseLimited, stripTitleMarker } from './detect'
import { AGENT_PROFILES, AgentId, AgentProfile, detectProfileFor, identifyAgent, profileFor, unionProfile } from './agents'
import { STATUS_STYLES, WorkStatus } from './api'
import { extractPrompt } from './prompt'
import { formatMeta, MetaGauge, MetaInput } from './meta'
import { readAccounts, addAccount, removeAccount, SavedAccount, accountHome, prepareAccount, loginAccount, AccountRequestError } from './accounts'
import { storageEnvironment } from './storagePaths'
import { getAccountQuotas, ensureAccountSession, recordAccountUsage, registerAccountSource, maintainAccountSessions } from './accountSession'
import { openAccountBrowser } from './accountBrowser'
import { judgeScreen, INPUT_TAIL, isGhostRuleRow, isRuleRow, sizeInSync, ScreenLine } from './screen'
import { CompositionHelperLike, flushComposition, planSend, readCompositionState } from './ime'
import { DockController, DockSide, DOCK_SIDES, isDockSide, isHorizontalDock } from './dock'
import { countByStatus, DropPlace, planEdgeScroll, planTabMove, sortTabsByStatus, statusRank } from './order'
import { collapseIdOf, foldGroupKey, GroupCollapseState, groupKeyOf, groupTabs, isStoredCollapsed, resolveGroupCollapseFor, TabGroup, UNGROUPED_LABEL } from './group'
import { projectRootCacheSnapshot, projectRootOf } from './project-root'
import { JUMP_SLOTS, NavRow, navRowsOf, pickCloseTarget, pickJumpTarget, stepNavIndex } from './nav'
import { SessionLedgerService } from './sessionLedger.service'
import { SessionSearchPanel } from './sessionSearchPanel'
import { ResumeRow, formatWhen, resumeCommand, resumeRowsFor } from './sessionLedger'
import { ViewPanel, ViewSide, MIN_VIEW_W } from './viewPanel'
import { followModeOf, migrateFollow } from './viewer'
import { appendScreenLog, collectDiagBundle, configStamp, diag, diagCatch, diagMemory, diagOnce, installErrorCapture, resetDiagOnce, startDiagSession, DIAG_PATH, DIAG_PREV_PATH, SCREEN_PATH } from './diag'

const SIDEBAR_ID = 'agentdeck-sidebar'
const BODY_CLASS = 'agentdeck-active'
/** 배경 이미지 레이어를 터미널 영역으로 자르는 중일 때 body 에 붙는 클래스 (styles.scss 참조) */
const BG_CLIP_CLASS = 'ad-bg-clip'

/** 판정 결과를 pane 마다 기억해 두는 시간 (`profileMemo`) */
const PROFILE_MEMO_MS = 250

/** 터미널이 이보다 좁아지거나 낮아지지 않게 막는다 — 드래그로 사이드바를 끝까지 밀어도 */
const MIN_TERM_W = 320
const MIN_TERM_H = 160
/** 사이드바가 이보다 작아지면 목록을 읽을 수 없다 — 드래그로도 이 밑으로는 안 내려간다 */
const MIN_SIDEBAR_W = 140
const MIN_SIDEBAR_H = 90

/**
 * 줄을 잡아 끈 것으로 인정하는 최소 이동 거리 (px).
 *
 * `dock.ts` 의 `DRAG_THRESHOLD` 와 같은 값으로 둔다 — 같은 사이드바에서 헤더는 도킹 드래그,
 * 줄은 순서 드래그인데 문턱이 다르면 어느 쪽은 손이 떨려도 발화하고 어느 쪽은 안 한다.
 * 이 문턱이 곧 "클릭으로 탭 선택" 과 "끌어서 옮기기" 를 가르는 선이다.
 */
const ROW_DRAG_THRESHOLD = 5
/** 삽입선 두께 (px) — 줄 사이 여백(styles.scss `.ad-tab` margin-bottom 3px)보다 얇지 않게 */
const REORDER_LINE_PX = 2
/** "지금은 순서를 못 바꾼다" 안내가 떠 있는 시간 (ms) — 읽고 이해할 만큼만 */
const REORDER_NOTE_MS = 2600
/**
 * 드래그 중 자동 스크롤이 걸리는 목록 가장자리 띠의 두께 (px).
 *
 * 줄 하나(약 34px — `.ad-tab` 의 padding 14 + 제목 17 + margin 3)와 비슷하게 둔다.
 * 띠가 줄보다 좁으면 "목록 끝에 갖다 대기" 가 픽셀 사냥이 되고, 넓으면 목록 가운데
 * 근처에서도 화면이 흐르기 시작해 **보이는 줄에 놓는 평범한 드롭**을 방해한다.
 * 짧은 목록에서 앞·뒤 띠가 겹쳐 어디에 놓아도 스크롤되는 일을 막으려고 실제로는 목록
 * 길이의 1/3 로 한 번 더 깎는다 (`dragScrollSpeed`).
 *
 * **설정으로 빼지 않았다** — 이 값은 줄 높이에서 나온 것이고 줄 높이는 설정이 아니다.
 * 사람이 정하고 싶은 것은 "이 동작을 쓸지" 이고 그것만 `dragAutoScroll` 로 열어 뒀다.
 */
const DRAG_SCROLL_BAND_PX = 32
/**
 * 자동 스크롤 속도 (px/s) — 띠의 **안쪽 경계**에서 MIN, 가장자리에 완전히 붙였을 때 MAX.
 *
 * 왜 한 값이 아니라 비례인가 — 한 값만 쓰면 "한두 줄만 더 보기" 와 "목록 끝까지 가기" 중
 * 하나는 반드시 불편하다(느리면 답답하고 빠르면 지나친다). 띠 안으로 커서를 얼마나
 * 밀어넣었는지가 곧 속도가 되면 두 조작이 같은 손짓 하나에 들어온다.
 * 줄 높이 ~34px 기준 MIN 은 초당 4줄쯤(눈으로 따라갈 수 있다), MAX 는 초당 24줄쯤이라
 * 탭 40개 목록을 2초 안에 끝에서 끝까지 훑는다.
 */
const DRAG_SCROLL_MIN_PPS = 150
const DRAG_SCROLL_MAX_PPS = 800
/**
 * 한 tick 이 인정하는 최대 경과시간 (ms) — 3프레임쯤.
 *
 * 속도를 **프레임이 아니라 시간으로** 곱하는 이유는 120Hz 모니터에서 두 배로 빨라지지 않게
 * 하는 것인데(px/프레임 으로 두면 그렇게 된다), 그러면 반대 위험이 생긴다: 창이 잠깐 멈췄다
 * 돌아오면(GC·다른 창으로 전환) rAF 간격이 수백 ms 가 되고 그것을 그대로 곱하면 목록이
 * 한 번에 튀어 사용자가 짚어 둔 자리를 지나쳐 버린다. 느려지는 것보다 튀는 것이 나쁘다.
 */
const DRAG_SCROLL_MAX_DT_MS = 50

/** Ctrl+V 를 눌렀을 때 xterm 의 네이티브 paste 가 오는지 기다려보는 시간 */
const PASTE_NATIVE_WAIT_MS = 60
/**
 * 같은 한 번의 붙여넣기가 여러 경로로 들어왔을 때 뒤엣것을 버리는 창(ms).
 *
 * 사람이 Ctrl+V 를 연타해도 이보다 빠를 수 없다(실측된 중복은 1ms 간격이었다).
 * claimCtrlVKey 로 경로를 하나로 모았어도, 그게 안 먹는 상황(포커스가 xterm 밖 등)을
 * 대비한 마지막 보험이다.
 */
const PASTE_DEDUPE_MS = 80
/** 붙여넣기 계측 창 — 두 번째 write 가 늦게 와도 놓치지 않게 넉넉히 둔다 */
const PASTE_PROBE_MS = 5000
/** 입력창을 찾으려고 화면 아래에서 훑어 올라갈 줄 수 — 여러 줄 프롬프트를 덮을 만큼만 */
const PROMPT_SCAN_ROWS = 14

/**
 * 복구할 때 Ctrl+L 을 보내기까지 기다리는 시간.
 * 앞선 흔들기(`nudgePtyRedraw`)가 60ms 뒤에 폭을 되돌리므로, 앱이 그 두 번째 SIGWINCH 로
 * 새 폭을 받아들인 다음에 "다시 그려라" 가 도착해야 한다. 순서가 뒤집히면 옛 폭으로 다시 그린다.
 */
const REPAIR_REDRAW_DELAY_MS = 180
/** 복구 뒤 화면을 다시 재는 시각 — 앱이 새 프레임을 다 그릴 만큼은 기다린다 */
const SNAP_AFTER_MS = 1500
/** 진단 로그 — devtools 를 못 여는 상황에서도 밖에서 읽을 수 있게 파일로 남긴다 */
/**
 * 화면 깨짐 검사를 출력이 멈춘 뒤 이만큼 기다렸다 한다.
 * TUI 가 한 프레임을 여러 번의 write 로 그리므로, 그리는 도중에 읽으면 멀쩡한 화면도 깨져 보인다.
 */
const SCREEN_CHECK_DEBOUNCE_MS = 700
/**
 * pty 크기를 고친 뒤 같은 값을 다시 보내는 시점 (ms).
 * 세션 초기화 직후의 resize 는 유실되므로(syncPtySize 주석) 시간을 벌려 몇 번 더 던진다.
 */
const PTY_RESIZE_RETRY_MS = [150, 400, 900, 1800, 3000]
/**
 * 탭이 열린 뒤 "지금 xterm 이 쓰는 크기" 를 pty 에 알려 주는 시점 (ms).
 *
 * 순정이 못 메우는 구멍이 딱 하나 남아 있다 — **새 탭.** Tabby 는 프론트엔드의 첫 `resize$`
 * 값으로 세션을 스폰하므로(tabby-local `initializeSession(this.size…)`), 그 스냅샷이
 * 레이아웃 확정보다 이르면 pty 만 좁게 태어난다. 그 뒤 xterm 이 넓어져도 **크기 변화
 * 이벤트가 나지 않으므로** ResizeObserver 도 fit() 도 아무것도 보내지 않는다(fit 은 열/행이
 * 이미 맞으면 no-op). 아무도 pty 에 알려주지 않아 그대로 굳는다.
 *
 * 실측(2026-09-02, 격리 인스턴스): 평범하게 연 새 탭 3개가 전부 `xterm=88 / pane.size=88`
 * 인데 pty 는 72 였고, TUI 는 72 폭으로 그려 테두리 두 줄이 73·88 로 어긋났다.
 * 같은 값(`session.resize(88, 39)`)을 **한 번** 보내자 즉시 정상으로 돌아왔다.
 *
 * 그래서 되살린 개입은 이것 하나뿐이다 — "현재 크기를 몇 번 알려준다". 흔들기(cols-1 ↔ cols)도,
 * 250ms 감시 루프도, fit 강제도 아니다. 값이 이미 맞으면 SIGWINCH 가 나지 않아 무해하고,
 * xterm 을 건드리지 않으므로 그리는 중인 프레임과 경쟁하지도 않는다.
 */
const TAB_OPEN_ANNOUNCE_MS = [250, 800, 1800]
/** 화면 깨짐 주기 검사 간격 (ms) — 출력 구독이 없는 탭도 잡기 위한 그물 */
const SCREEN_SWEEP_MS = 2000
/**
 * 조합이 끝나기를 기다려 주는 시간 (ms).
 *
 * 이 시간이 지나면 동기 확정을 시키고 쓴다 — IME 가 `compositionend` 를 안 내는 경우
 * (창 포커스가 빠지는 등)에 입력이 영영 안 나가는 것을 막는 안전장치다. 사람이 조합을
 * 끝내는 데 걸리는 시간보다 넉넉해야 하지만, 개행이 눈에 띄게 늦어서도 안 된다.
 */
const IME_WAIT_MS = 400
/**
 * 잔상을 지울 때 마지막 테두리에서 위로 몇 행까지 같은 입력창 블록으로 볼지.
 *
 * 4 였을 때는 **Ctrl+Enter 로 여러 줄이 된 입력창**의 위 테두리에 닿지 못해
 * 시작행이 아래 테두리로 잡히고 입력창 **아래**를 지웠다 — 잔상은 그대로 남는다
 * (2026-09-09 실사용 스샷: 위 테두리 + 입력 3줄 + 아래 테두리).
 */
const INPUT_BLOCK_ROWS = 12
/**
 * 자동복구 예산(`autoRepairMaxPerTab`)을 되돌리기까지 화면이 온전해야 하는 시간.
 *
 * 예산은 "같은 깨짐에 무한히 손대지 않는다" 는 안전장치인데, 카운터를 한 번도 되돌리지
 * 않아 **탭이 살아 있는 동안 영구히** 소진됐다 — 며칠씩 켜 두는 탭에서는 뒤에 온 진짜
 * 깨짐이 통째로 방치된다. 그렇다고 온전해지자마자 되돌리면 깨짐↔복구가 번갈아 오는
 * 화면에서 예산이 무한이 되어 안전장치가 사라진다. 그래서 **오래 온전할 때만** 되돌린다.
 */
const AUTO_REPAIR_REFILL_MS = 60000
/** 탭 cwd 캐시를 다시 물어보는 간격 (ms) */
const CWD_TTL_MS = 3000
/**
 * cwd 를 아직 못 알아낸 탭을 다시 묻기까지의 최소 간격.
 *
 * 0 이면(=TTL 을 통째로 건너뛰면) 출력 조각마다 OS 호출이 된다 — 2026-09-09 실측으로
 * 조각 24개에 34회였다(PF6). 반대로 `CWD_TTL_MS` 를 그대로 쓰면 조용한 탭이 오래
 * `기타` 그룹에 남는다. 400ms 는 사람이 그룹이 바뀌는 것을 눈치채지 못하는 범위이면서
 * 초당 호출을 2~3회로 묶는다.
 */
const CWD_MISS_MS = 400
/**
 * cwd 를 못 알아낸 탭을 **출력 없이도** 몇 번까지 더 물어볼지.
 *
 * `touchCwd` 는 출력이 흐를 때 불린다. 그래서 아무것도 찍지 않는 탭은 재시도 기회가
 * 없는데, 세션이 붙는 중이던 첫 조회가 빈손이면 그대로 `기타` 그룹에 남고 미리보기의
 * `변경` 탭도 "작업 폴더를 모른다" 로 끝난다 (2026-09-09 실측: 새 탭이 조용하면 재현).
 * 그래서 1초 tick 이 미상 탭만 이 횟수까지 다시 묻는다 — 20회면 약 20초 안에 잡히고,
 * 끝내 cwd 를 안 주는 셸(SSH 등)에서는 그 뒤 조용해진다(출력이 올 때만 다시 시도).
 */
const CWD_MISS_MAX = 20
/**
 * 이 경로가 **폴더**인가. 없거나 파일이면 false.
 *
 * cwd 후보를 받아들이기 전 관문이다 — Tabby 의 윈도우 cwd 는 출력에서 주운 추정이고
 * 폴더인지 확인하지 않는다(`touchCwd` 주석). 동기 호출인 이유: 판정 결과로 캐시에 넣을지가
 * 갈리는데 그 사이 다른 보고가 끼어들면 순서가 뒤집힌다. TTL 뒤에만 불리는 자리라 비용도 없다.
 */
function isDirectory (target: string): boolean {
    try {
        return fs.statSync(target).isDirectory()
    } catch {
        // 사라진 폴더·권한 없음 — 어느 쪽이든 cwd 로 쓸 수 없다
        return false
    }
}
/**
 * cwd 를 모르는 탭들의 그룹을 설정(`collapsedGroups`)에 적을 때 쓰는 키.
 *
 * 실제 그룹 키는 정규화된 경로(`D:/project/a`)뿐이라 괄호로 시작하는 이 토큰과는 겹칠 수 없다.
 */
/**
 * 탭에서 도는 에이전트를 다시 물어보는 간격 (ms).
 *
 * `session.getChildProcesses()` 는 OS 호출이다 — 출력 조각마다 부르면 안 된다.
 * 그래서 세션이 붙을 때와 제목이 바뀔 때만, 그것도 이 간격을 두고 묻는다.
 * 셸에서 `claude` 를 나중에 직접 띄우는 경우가 있으니 한 번 unknown 이어도 다시 본다.
 */
const AGENT_PROBE_TTL_MS = 10000
/** 자식이 아직 없는 래퍼 탭을 다시 훑는 간격과 횟수 */
const EMPTY_TAB_RETRY_MS = 400
const EMPTY_TAB_RETRY_MAX = 20

/** 우리가 쓰는 부분만 추린 Electron clipboard — electron 패키지를 devDependency 로 끌어오지 않으려고 */
interface ElectronClipboard {
    writeText (text: string): void
    readImage (): { isEmpty (): boolean }
    readText (): string
}

let cachedClipboard: ElectronClipboard | null | undefined

/**
 * Electron 의 clipboard 를 런타임에 가져온다.
 *
 * `import { clipboard } from 'electron'` 을 쓰면 타입 때문에 electron 패키지(200MB+)를
 * devDependency 로 받아야 한다. Tabby 렌더러는 nodeIntegration 이 켜져 있어(`fs` 를 그냥 import 한다)
 * window.require 로 바로 집을 수 있으므로 그쪽을 쓴다.
 */
function getClipboard (): ElectronClipboard | null {
    if (cachedClipboard !== undefined) {
        return cachedClipboard
    }
    // webpack externals 에 'electron' 이 있어(webpack.config.js) 이 require 는 번들되지 않고
    // 런타임에 Tabby 가 그대로 넘겨준다 — 다른 모듈에서 `fs` 를 그냥 import 하는 것과 같은 경로다.
    // window.require 는 contextIsolation 이 켜지면 사라지므로 폴백으로만 둔다.
    try {
        cachedClipboard = require('electron')?.clipboard ?? null
    } catch (e: any) {
        cachedClipboard = null
        diagCatch('clipboard require(electron)', e)
    }
    if (!cachedClipboard) {
        try {
            const req = (window as any).require ?? (globalThis as any).require
            cachedClipboard = req?.('electron')?.clipboard ?? null
        } catch (e: any) {
            cachedClipboard = null
            diagCatch('clipboard window.require', e)
        }
    }
    if (!cachedClipboard) {
        // 이미지 붙여넣기가 통째로 안 되는 상태다. 사유 없이는 "붙여넣기가 안 된다" 제보를 가를 수 없다
        diagOnce('clipboard-missing', 'clipboard 없음 — 이미지 붙여넣기 불가')
    }
    return cachedClipboard
}

function clampPct (value: unknown): number {
    const n = typeof value === 'number' && isFinite(value) ? value : 100
    return Math.min(100, Math.max(0, Math.round(n)))
}

/**
 * `#RRGGBB` / `#RRGGBBAA` 에 불투명도(%)를 입힌다.
 * 100% 면 알파를 떼어 원래 6자리로 되돌린다 — 설정을 되돌리면 원상복구되게 하려는 것.
 * 해석할 수 없는 형식(rgb(), 색이름 등)은 건드리지 않고 그대로 돌려준다.
 */
function withAlpha (color: string, pct: number): string {
    const m = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(color.trim())
    if (!m) {
        return color
    }
    const rgb = '#' + m[1]
    if (pct >= 100) {
        return rgb
    }
    const alpha = Math.round(pct * 255 / 100).toString(16).padStart(2, '0')
    return rgb + alpha
}

/**
 * 검색어와 후보 필드를 비교 가능한 꼴로 접는다.
 *
 * 세 가지를 한꺼번에 처리한다 —
 *  1) 대소문자 무시.
 *  2) 경로 구분자 통일(`\` -> `/`). 후보에는 cwd 원문이 들어오고 Windows 셸은 `\` 를 주는데,
 *     사용자는 `d:\project` 로도 `d:/project` 로도 친다. 접지 않으면 어느 한쪽이 항상 0건이다.
 *  3) 유니코드 정규화(NFC). 한글은 같은 글자를 두 가지로 적을 수 있고(macOS 가 주는 경로는 NFD),
 *     Windows IME 가 주는 입력은 NFC 다 — 눈에 같아 보이는 글자가 안 맞는 사고를 막는다.
 */
export function foldSearchText (raw: string | null | undefined): string {
    if (typeof raw !== 'string' || !raw) {
        return ''
    }
    let s = raw
    try {
        s = s.normalize('NFC')
    } catch {
        // normalize 가 없는 런타임 — 정규화만 못 하고 나머지 접기는 그대로 돈다
    }
    return s.toLowerCase().replace(/\\/g, '/')
}

/**
 * 검색어를 토큰으로 쪼갠다 — 공백으로 끊고 빈 조각을 버린다.
 *
 * 왜 통째로 안 찾고 쪼개나 — `root api` 처럼 **여러 조각의 AND** 가 사람이 기대하는 동작이다.
 * 폴더가 `Root` 이고 제목에 `api` 가 든 세션을 좁히려면 조각마다 따로 봐야 한다.
 * 통째로 부분문자열을 찾으면 그런 조합은 영원히 0건이 된다.
 */
export function searchTokens (query: string | null | undefined): string[] {
    return foldSearchText(query).split(/\s+/).filter(t => t.length > 0)
}

/**
 * 후보 필드들이 검색 토큰을 전부 만족하나 — 토큰끼리는 AND, 필드끼리는 OR.
 *
 * 토큰이 없으면(검색어가 비었거나 공백뿐) **항상 참**이다. 필터가 없는 상태와 화면이 같아야 한다.
 */
export function matchesSearchTokens (fields: ReadonlyArray<string | null | undefined>, tokens: readonly string[]): boolean {
    if (!tokens.length) {
        return true
    }
    const folded: string[] = []
    for (const f of fields) {
        const s = foldSearchText(f)
        if (s) {
            folded.push(s)
        }
    }
    return tokens.every(t => folded.some(f => f.includes(t)))
}

/**
 * 드래그가 끝난 이유. `moved` 만 순서를 바꾼 것이고 나머지는 전부 취소다.
 *
 * `blocked-sort`(상태순 정렬 게이트)와 `no-target`(놓을 자리가 없었다)을 가른 이유 —
 * 둘 다 "안 옮겨졌다" 로 끝나지만 전자는 **막은 것**이고 후자는 **받을 자리가 없었던 것**이다.
 * 회귀가 이 둘을 구별하지 못하면 게이트가 빠져도 초록으로 남는다.
 */
export type DragEndReason = 'moved' | 'below-threshold' | 'blocked-sort' | 'esc' | 'cancel' | 'no-target'

/** 놓을 자리를 거부한 이유 (`dropTargetAt` 이 null 을 준 갈래) */
export type DropReject = 'outside-list' | 'other-group' | 'self' | 'gone' | 'no-row' | 'stale-index' | null

/**
 * AgentDeck 본체.
 *
 * 하는 일 두 가지 —
 *  1) 터미널 뷰포트(.content.main)를 창 높이 기준 4:3 폭으로 고정하고
 *  2) 그때 남는 왼쪽 공간에 탭 목록 + 작업 상태 사이드바를 그린다.
 *
 * Tabby 순정 탭바는 CSS 로 감추고 이 사이드바가 탭 관리를 대신한다.
 * Angular 컴포넌트 대신 순수 DOM 을 쓰는 이유는 appRoot 템플릿에 컴포넌트를
 * 꽂는 공식 확장점이 없기 때문 — DOM 직접 조작이 Tabby 버전 변화에 더 견딘다.
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckService {
    private readonly sessionSlots = new SessionSlots<BaseTabComponent>()
    private pendingSessionOpens = 0

    private syncSessionSlots (): void {
        this.notify.setNavigationRefresh(() => this.syncSessionSlots())
        const tabs = this.app.tabs.filter(tab => !(tab instanceof SettingsTabComponent))
        const panes = (tab: any): any[] => typeof tab.getAllTabs === 'function' ? tab.getAllTabs() : [tab]
        this.sessionSlots.reconcile(tabs, tab => {
            const value = panes(tab).map(pane => pane.profile?.options?.env?.AGENTDECK_SLOT).find(Boolean)
            return value ? Number(value) : null
        })
        for (const tab of tabs) {
            const number = this.sessionSlots.numberOf(tab)
            if (number === null) { continue }
            for (const pane of panes(tab)) {
                if (pane.profile?.options && pane.profile.options.env?.AGENTDECK_SLOT !== String(number)) {
                    pane.profile = { ...pane.profile, options: { ...pane.profile.options,
                        env: { ...pane.profile.options.env, AGENTDECK_SLOT: String(number) } } }
                }
            }
        }
        this.notify.publishNavigationContext(tabs.map(tab => {
            const slot = this.sessionSlots.numberOf(tab)
            const sessionIds = this.notify.sessionIdsOf(tab)
            return `Human slot ${slot ?? 'unassigned'}: `
                + (sessionIds.length ? `session IDs ${sessionIds.join(', ')}` : 'tab open; session not registered (not addressable yet)')
                + `; title=${JSON.stringify(String(tab.customTitle || tab.title || '').slice(0, 160))}`
                + `; ${this.notify.mailboxConnectionState(tab)}`
                + (sessionIds.length > 1 ? ' (split panes: ask which session; never choose by last activity)' : '')
        }).filter(Boolean).join('\n'))
        const newButton = this.sidebar?.querySelector('.ad-new') as HTMLButtonElement | null
        if (newButton) {
            newButton.disabled = this.sessionSlots.full
            if (this.sessionSlots.full) { newButton.title = this.sidebarLang === 'ko' ? '세션 9개가 열려 있습니다. 하나를 닫아 주세요.' : 'All 9 session slots are occupied. Close a session first.' }
        }
    }
    private sidebar: HTMLElement | null = null
    private listEl: HTMLElement | null = null
    /** 사이드바 하단 "지금 이 탭" 줄 (모델·계정·한도). 목록과 버튼 줄 사이에 고정된다 */
    private nowEl: HTMLElement | null = null
    private accountPopup: HTMLElement | null = null
    private accountPopupTab: BaseTabComponent | null = null
    private accountSwitchBusy = false
    /** 지난 세션 서랍 — 목록 **밖**, "지금 이 탭" 줄 바로 위. 펼치면 위로 자란다 */
    private resumeEl: HTMLElement | null = null
    private historySearchPanel: SessionSearchPanel | null = null
    private windowEl: HTMLElement | null = null
    private mainEl: HTMLElement | null = null
    private observer: ResizeObserver | null = null
    private editing: BaseTabComponent | null = null
    /**
     * 줄을 끌어 순서를 바꾸는 중일 때의 상태 (null 이면 드래그 중이 아니다).
     *
     * `moved` 가 false 인 구간은 **아직 클릭일 수도 있는** 무장 상태다 — 그 사이에는 화면도
     * 멈추지 않고 삽입선도 그리지 않는다. dock.ts 의 `dragArmed`/`dragging` 와 같은 두 단계다.
     */
    private drag: {
        tab: BaseTabComponent
        row: HTMLElement
        from: { x: number, y: number }
        moved: boolean
        target: { tab: BaseTabComponent, place: DropPlace } | null
        line: HTMLElement | null
        /**
         * 마지막으로 본 포인터 좌표.
         *
         * 자동 스크롤은 **커서가 멈춘 뒤에도** 돌아야 한다(가장자리에 대고 가만히 있는 것이
         * 이 기능의 조작 방법이다). 그때 놓일 자리를 다시 재려면 좌표가 필요한데 이벤트는
         * 더 오지 않으므로 여기 남겨 둔다.
         */
        at: { x: number, y: number }
        /**
         * 이 드래그가 자동 스크롤로 움직인 누적 거리(px)와 그 축.
         * 루프가 서고 다시 돌아도 지워지지 않는다 — 끝난 뒤 `lastDrag()` 의 증거가 된다.
         */
        scrolled: { px: number, axis: 'x' | 'y' | null }
        /**
         * 지금 돌고 있는 자동 스크롤 rAF 루프 (null = 안 돌고 있다).
         *
         * **드래그 상태 안에 두는 것이 핵심이다.** 별도 필드로 두면 드래그가 끝났는데 루프만
         * 남는 길이 생긴다 — 이 저장소는 이미 Map 누수와 타이머 잔여로 값을 치렀다.
         * 여기 있으면 `endRowDrag` 한 곳에서 반드시 걷히고, tick 도 `this.drag` 가 자기
         * 것이 아니면 스스로 멈춘다(이중 안전망).
         */
        scroll: { raf: number, prev: number, axis: 'x' | 'y' } | null
        detach: () => void
    } | null = null
    /**
     * 드래그로 끝난 pointerup 뒤에 따라오는 click 을 한 번 삼킨다.
     *
     * 줄의 click 은 탭 선택이다(`renderTab`). 순서를 옮기고 손을 뗀 것까지 선택으로 읽으면
     * 옮길 때마다 활성 탭이 바뀌어 터미널 화면이 튄다 — 사용자는 순서만 만졌다고 생각한다.
     *
     * **낡은 가드가 남을 수 있다** — 목록 밖에서 손을 떼면 click 이 아예 오지 않으므로 켜 둔
     * 가드를 아무도 안 쓴다. 그러면 그 다음의 정당한 클릭이 삼켜진다. 그래서 소비뿐 아니라
     * **모든 pointerdown 첫 줄에서 끈다**(`armRowDrag`) — click 은 언제나 같은 줄의
     * pointerdown 뒤에 오므로, 이렇게 두면 시간에 기대지 않고도 항상 새 값이 된다.
     */
    private dragClickGuard = false
    /**
     * 마지막 드래그가 어떻게 끝났나 — 회귀가 **의도한 이유로** 취소됐는지 보게 남긴다.
     *
     * 결과(순서 불변)만으로는 부족하다: 낡은 `data-ad-index` 로 대상을 못 찾아 취소된 것과
     * 사용자가 Esc 를 눌러 취소된 것이 결과가 같아서, 판정이 초록인 채로 규칙이 썩는다.
     */
    private lastDragEnd: {
        reason: DragEndReason
        drop: DropReject
        committed: boolean
        at: number
        /** 이 드래그가 자동 스크롤로 흘린 거리(px)와 축 — 끝난 뒤에야 확인할 수 있는 증거다 */
        scrolled: { px: number, axis: 'x' | 'y' | null }
    } | null = null
    /** `dropTargetAt` 이 방금 자리를 거부한 이유 (성공이면 null) */
    private dropReject: DropReject = null
    /**
     * 검색 입력창. **`.ad-list` 밖**에 산다 — `render()` 가 목록의 innerHTML 을 비우므로
     * 안에 두면 한 글자 칠 때마다 입력창이 새로 만들어져 포커스와 IME 조합이 날아간다.
     */
    private searchEl: HTMLInputElement | null = null
    /**
     * 지금 걸린 검색어. **설정에 저장하지 않는다.**
     * 다음 기동에 남아 있으면 목록이 좁혀진 채로 떠서 "탭이 사라졌다" 로 읽힌다 —
     * 이 기능에서 가장 위험한 실패 모양이다. 필터는 지금 이 순간의 도구다.
     */
    private searchQuery = ''
    /** 지금 걸린 상태 필터(헤더 칩 클릭). 검색어와 같은 이유로 저장하지 않는다 */
    private statusFilter: WorkStatus | null = null
    /** 검색창에서 IME 조합이 도는 중인가 — 조합 중의 Esc 는 조합 취소이므로 검색을 지우면 안 된다 */
    private searchComposing = false
    /**
     * 키보드로 짚어 둔 줄 (null 이면 아무 줄도 안 짚었다).
     *
     * **선택(활성 탭)과 다른 값이다.** ↑↓ 는 이 값만 움직이고 `app.selectTab` 은 부르지 않는다 —
     * 이동만으로 탭이 바뀌면 세션을 여섯 개쯤 띄워 둔 사람이 목록을 훑을 수 없다. 줄을 지날 때마다
     * 활성 탭이 바뀌고, 그때마다 터미널이 다시 그려지고(폭 적용·refit) 화면이 튀며, 돌고 있는
     * 탭을 지나가면 그 출력이 화면을 채운다. 그래서 "보고 있는 줄" 과 "쓰고 있는 탭" 을 갈랐고,
     * 둘을 합치는 지점은 Enter 하나다 (`activateNav`).
     *
     * **DOM 이 아니라 여기에 둔다.** `render()` 는 목록을 통째로 다시 만들므로(`innerHTML = ''`)
     * 줄에 얹은 상태는 매 렌더에 날아간다 — 라벨 편집이 `editing` 에, 드래그가 `drag.tab` 에
     * 대상을 객체로 들고 있는 것과 같은 이유다. 인덱스가 아니라 **탭 객체 / 그룹 키**로 들고 있는
     * 근거는 `NavRow` 주석에 있다(인덱스는 탭이 하나 닫히면 다른 줄을 가리킨다).
     */
    private navFocus: NavRow<BaseTabComponent> | null = null
    private renderQueued = false
    /** Shift 물리 키가 눌려 있나 — IME 조합을 거친 Enter 는 shiftKey 가 지워져 온다 */
    private shiftDownAt = 0
    /** rAF 가 멈춘 상황(창 가려짐)을 대비한 렌더 폴백 타이머 */
    private renderTimer: any = null
    /** 직전에 적용한 폭 — 같은 값이면 DOM 을 다시 건드리지 않는다 */
    private lastTermW = -1
    private lastSidebarW = -1
    /** 직전에 적용한 도킹 방향 — 크기가 같아도 방향이 바뀌면 다시 그려야 한다 */
    private lastDock: DockSide | null = null
    /**
     * 판정 결과를 pane 마다 **짧게** 기억한다 — `profileForPane` 은 화면에 글자를 쓸 때마다
     * 불리는 자리라(커서 보정의 `enabled`, 키보드, 주기 검사) 매번 처음부터 다시 정하면
     * ① 답이 판마다 흔들려 화면이 깜빡이고 ② 버퍼 60줄 훑기가 write 마다 돈다.
     *
     * 무효화 배선을 따로 두지 않고 **짧은 유통기한**으로 끝낸다 — 훅이 다른 에이전트를
     * 말하면 그 다음 판(최대 PROFILE_MEMO_MS 뒤)에 반영되고, 사람 눈에는 즉시나 다름없다.
     * 세션(pty)이 갈리면 그 자체로 무효다 — 같이 적어 두고 비교한다.
     */
    private profileMemo = new WeakMap<any, {
        at: number, session: any,
        profile: AgentProfile | undefined,
        /** 이 pty 에서 **마지막으로 확실히 알아낸** 정체 — 모르겠다는 답이 이걸 지우지 못한다 */
        known: AgentProfile | undefined,
    }>()
    /**
     * 회귀가 못 박아 둔 pane/tab 의 에이전트 (`__agentdeck.pinAgent`).
     *
     * **제품 동작에는 아무도 여기에 쓰지 않는다** — 비어 있는 Map 이고 `profileForPane` 이
     * `size` 만 본다. 회귀가 끝나면 프로브가 스스로 비운다(`pinAgent(target, null)`).
     * 배포본에 남는 것을 허용하는 이유는 `judge`·`agentOf` 와 같다 — 검증 도구가 제품 규칙의
     * 사본을 들지 않게 하려면 제품이 창구를 열어 주는 편이 싸다.
     */
    private pinnedAgents = new WeakMap<any, AgentId>()
    /**
     * 지금 못 박혀 있는 개수 — `WeakMap` 에는 `size` 가 없다.
     *
     * 굳이 `WeakMap` 인 이유: 이 진단구는 배포 번들에도 실리는데, 프로브가 예외로 죽어
     * `pinAgent(target, null)` 을 못 부르면 강한 Map 은 그 pane 과 xterm 버퍼를 영원히 붙든다.
     * 세는 값만 따로 두면 평소 경로(`profileForPane`)는 정수 비교 한 번으로 끝난다.
     */
    private pinnedCount = 0
    /** 직전 창 박스의 왼쪽 위 (`left:top`) — 크기가 같아도 자리가 옮겨지면 다시 앉혀야 한다 */
    private lastBoxKey = ''
    /** 경계선 드래그(크기)와 헤더 드래그(도킹 방향)를 맡는다 */
    private dock: DockController | null = null
    private refitQueued = false

    /** 결과물 미리보기 패널 (viewPanel.ts) — 사이드바 반대편에 앉는다 */
    private view: ViewPanel | null = null
    private lastViewW = -1
    private lastViewSide: ViewSide | null = null
    /**
     * 탭별 작업 디렉토리 캐시.
     *
     * 미리보기 패널이 화면에서 주운 상대경로(`src/a.ts`)를 풀 때 필요하다. `getWorkingDirectory()`
     * 는 비동기이고 OS 호출이라 출력 조각마다 부를 수 없어서, 필요할 때 한 번 받아 두고
     * `CWD_TTL_MS` 동안 재사용한다 (cd 로 옮겨 다녀도 그 정도면 따라간다).
     */
    private cwdCache = new WeakMap<BaseTabComponent, { dir: string | null, at: number, misses?: number }>()
    /**
     * 지난 세션 목록에서 "이미 열림" 으로 그린 줄이 가리키는 탭 — `세션id -> 탭`.
     * 매 렌더마다 `liveSessionIds()` 가 다시 채운다(탭이 닫히면 그 줄은 이어받기로 돌아간다).
     */
    private resumeTabs = new Map<string, BaseTabComponent>()

    /**
     * 이 서비스의 출력 구독이 실제로 몇 번 돌았나 (진단용).
     *
     * decorator(`decorator.ts`)도 같은 `output$` 를 구독하므로, 상태 감지가 정상으로 보여도
     * **이쪽 구독은 안 돌고 있을 수 있다.** 그 둘을 가릴 수단이 없어서 검증 중에 막혔다
     * (2026-09-08). `__agentdeck.debug()` 로 읽는다.
     */
    private outputHits = 0
    /**
     * 탭별로 판정한 에이전트 (`agents.ts`).
     *
     * 상태 감지 패턴·이미지 붙여넣기 키가 에이전트마다 다르므로, 출력마다 프로세스 트리를
     * 묻지 않으려면 한 번 알아낸 것을 여기 기억해 둬야 한다. 채우는 시점은 세션이 붙을 때와
     * 제목이 바뀔 때 (`probeAgent`, TTL = `AGENT_PROBE_TTL_MS`).
     */
    private tabAgents = new WeakMap<BaseTabComponent, AgentId>()
    private paneAgents = new WeakMap<object, { session: any, tracker: TerminalAgentTracker }>()
    /** 마지막으로 프로세스 트리를 물어본 시각 — OS 호출이라 TTL 로 묶는다 */
    private agentProbedAt = new WeakMap<BaseTabComponent, number>()
    /** 이미 감시를 건 래퍼 탭 / pane — 중복 구독 방지 */
    private watched = new WeakSet<BaseTabComponent>()
    private watchedPanes = new WeakSet<BaseTabComponent>()
    /** 화면 깨짐 검사 예약 타이머 — pane 당 하나만 돈다 */
    private screenCheckTimers = new WeakMap<BaseTabComponent, any>()
    /** 빈 래퍼 탭을 다시 훑은 횟수 */
    private emptyTabRetries = new WeakMap<BaseTabComponent, number>()
    /** 마지막 화면 판정 결과 — 상태가 바뀔 때만 채증하려고 들고 있는다 */
    private screenObs = new WeakMap<BaseTabComponent, { broken: boolean, reason: string, streak?: number }>()
    /** 마지막 자동 복구 시각 — 쿨다운 판정용 */
    private autoRepairAt = new WeakMap<BaseTabComponent, number>()
    /** 자동 복구 횟수 — 오탐으로 무한히 흔드는 것을 막는다 */
    private autoRepairCount = new WeakMap<BaseTabComponent, number>()
    /** 이 탭 화면이 온전해진 시각 — 예산 회복 판정에만 쓴다 (`AUTO_REPAIR_REFILL_MS`) */
    private autoRepairHealthySince = new WeakMap<BaseTabComponent, number>()
    /** 우클릭 누른 시각 — 길게 누르면 컨텍스트 메뉴로 분기 */
    private rightDownAt = 0
    /** 직전 우클릭 처리 시각 — 같은 클릭이 두 번 들어오는 걸 막는다 */
    private lastRightHandledAt = 0
    /** xterm 이 네이티브 paste 로 붙여넣은 마지막 시각 — Ctrl+V 이중 입력 방지 */
    private nativePasteAt = 0
    /** 직전에 붙여넣기를 처리한 시각 — 같은 클릭/키가 여러 경로로 들어와도 한 번만 붙인다 */
    private lastPasteAt = 0
    /** 이 시각까지는 PTY 로 나가는 입력을 진단 로그에 남긴다 (붙여넣기가 두 번 들어가는지 보려고) */
    private pasteProbeUntil = 0

    constructor (
        private app: AppService,
        private config: ConfigService,
        private status: WorkStatusService,
        private hotkeys: HotkeysService,
        private profiles: ProfilesService,
        private hostWindow: HostWindowService,
        private platform: PlatformService,
        // 서브에이전트 개수를 물어보는 창구(`subagentsOf`). 순환 의존이 아니다 —
        // notify 쪽은 deck 을 모른다(상태는 `status.service` 를 거쳐 만난다)
        private notify: WorkNotifyService,
        // 지난 세션 원장. deck 이 라벨·cwd 를 아는 유일한 자리라 적는 쪽도 여기다
        private ledger: SessionLedgerService,
        private zone: NgZone,
        @Optional() private locale: LocaleService | null = null,
    ) { }

    private get sidebarLang (): Lang {
        return pickLang(this.locale?.getLocale() || this.config.store.language || navigator.language)
    }

    private ui (key: string, params?: Record<string, string | number>): string {
        return sidebarText(key, this.sidebarLang, params)
    }

    private uiMarkup (html: string): string {
        return sidebarMarkup(html, this.sidebarLang)
    }

    private refreshSidebarLanguage (): void {
        const root = document.getElementById(SIDEBAR_ID)
        if (!root) { return }
        const input = root.querySelector<HTMLInputElement>('.ad-search-input')
        if (input) { input.placeholder = this.ui('세션 검색 (제목 · 작업이름 · 폴더)') }
        for (const [selector, title, text] of [
            ['.ad-search-clear', '검색·필터 지우기 (Esc)', ''],
            ['.ad-now-account', '계정 선택', ''],
            ['.ad-new', '새 탭', '+ 새 탭'],
            ['.ad-settings', '설정', '설정'],
            ['.ad-repair', '화면 복구 (모든 탭 다시 그리기)', ''],
            ['.ad-viewtoggle', '미리보기 패널 (md · 이미지 · 표)', ''],
        ]) {
            const el = root.querySelector<HTMLElement>(selector)
            if (el) { el.title = this.ui(title); if (text) { el.textContent = this.ui(text) } }
        }
    }

    init (): void {
        const maintain = () => { void maintainAccountSessions(this.app.tabs.map(tab => this.notify.metaOf(tab)).filter(Boolean)).catch(() => {}) }
        maintain()
        const accountTimer = setInterval(maintain, 60000)
        window.addEventListener('beforeunload', () => clearInterval(accountTimer), { once: true })
        this.app.ready$.subscribe(() => this.zone.runOutsideAngular(() => {
            // 진단 로그는 setup 보다 먼저 연다 — `.window` 를 못 찾아 배치를 포기하는 경로도
            // 로그에 남아야 하고, 세션 스탬프(버전·환경)는 그 판정보다 앞에 찍혀야 한다
            startDiagSession({
                tabby: this.platform.getAppVersion?.(),
                osRelease: this.platform.getOSRelease?.(),
                config: this.diagConfig(),
            })
            installErrorCapture()
            // 원장 스캔이 끝나면 다시 그린다 — 스캔은 비동기라 첫 렌더에는 목록이 비어 있다
            this.ledger.onChange = () => this.scheduleRender()
            // setup 도중 예외가 나면 그 뒤 배선(탭 감시, 흔들기 예약)이 통째로 죽는데
            // 콘솔을 안 보면 알 길이 없다. 진단 파일에 남겨 밖에서 읽을 수 있게 한다
            try {
                this.setup()
            } catch (e: any) {
                this.diag(`setup ERROR ${e?.message ?? e}`)
                throw e
            }
        }))
    }

    /**
     * 같은 키로는 한 번만 남기는 진단.
     * relayout 처럼 초당 여러 번 불리는 자리에서 조기 return 사유를 남길 때 쓴다
     */
    private diagOnce (key: string, line: string): void {
        diagOnce(key, line)
    }

    /** 진단 한 줄 — 회전·시각 표기·메모리 보관은 `diag.ts` 가 한다 */
    private diag (line: string): void {
        diag(line)
    }

    /** 세션 머리말에 넣을 설정 — 고르는 기준은 `diag.ts` 의 `configStamp` 에 적혀 있다 */
    private diagConfig (): Record<string, any> {
        return configStamp(this.config.store)
    }

    private setup (): void {
        this.windowEl = document.querySelector('.window')
        this.mainEl = document.querySelector('.content.main')
        if (!this.windowEl) {
            console.warn('[agentdeck] .window 를 찾지 못해 레이아웃을 적용하지 않는다')
            return
        }

        this.diag(`setup start tabs=${this.app.tabs.length}`)

        this.migrateFollowConfig()
        this.buildSidebar()
        this.buildView()
        this.applyEnabled()
        this.applyOpacity()
        this.disableBackgroundThrottling()
        this.ensurePasteHotkey()
        this.ensureSplitHotkeys()
        this.ensureNewTabHotkey()
        this.ensureRepairHotkey()
        this.ensureClosePaneHotkey()
        this.ensureNewlineHotkey()
        this.releaseHomeEndHotkey()
        this.guardHomeEndComposition()
        this.claimCtrlVKey()
        this.claimCtrlWKey()
        this.claimShiftEnterKey()
        this.claimEnterLabel()
        this.claimRightClick()
        this.claimFileDrop()

        // xterm 의 네이티브 paste 를 관측만 한다 (doPaste 의 이중 입력 방지용).
        // 캡처 단계라 xterm 핸들러의 stopPropagation 보다 먼저 돈다.
        document.addEventListener('paste', () => {
            this.nativePasteAt = Date.now()
            this.diag(`native-paste`)
        }, true)

        // 탭 변화 -> 사이드바 다시 그림
        // 탭 복원은 ready$ 보다 늦게 끝나므로 목록이 바뀔 때마다 감시 대상을 다시 훑는다
        // (watched WeakSet 이 중복 구독을 막는다)
        this.app.tabsChanged$.subscribe(() => {
            for (const tab of this.app.tabs) {
                this.watchTab(tab)
            }
            this.scheduleRender()
        })
        // 탭을 바꾸면 그 탭은 숨어 있던 동안 폭 0 이라 refit 을 건너뛰었다 — 지금 맞춰준다
        this.app.activeTabChange$.subscribe(() => {
            // 미리보기의 최근 목록은 탭마다 따로다 — 보고 있는 탭 것으로 바꿔 준다
            this.view?.setActiveTab(this.app.activeTab ?? null)
            this.scheduleRender()
            this.scheduleRefit()
        })
        this.app.tabOpened$.subscribe(tab => {
            this.watchTab(tab)
            // 새 탭은 xterm 은 맞는 폭으로 열리는데 pty 만 옛 폭으로 남는 일이 있다 (syncPtySize 주석)
            this.scheduleRefit()
            this.scheduleRender()
        })
        this.app.tabClosed$.subscribe(() => {
            // 닫힌 탭의 상태를 버린다. `decorator.detach` 만으로는 새는 경로가 있다
            // (분할 탭의 자식이 detach 될 때 부모가 아직 목록에 있으면 그냥 지나간다 —
            //  `status.service` 의 `sweep` 주석에 실측값). 여기서 목록을 기준으로 한 번 훑는다.
            this.status.sweep(this.app.tabs)
            this.scheduleRender()
        })

        // 세션이 이미 열린 채 복원된 탭들도 감시 대상에 넣는다
        for (const tab of this.app.tabs) {
            this.watchTab(tab)
        }
        this.status.changed$.subscribe(() => this.scheduleRender())
        // 모델·한도는 상태와 다른 통로로 온다(statusLine 래퍼). 상태가 그대로인 채 한도만
        // 오르는 일이 흔하므로 여기서 따로 렌더를 부른다 — 안 그러면 다음 상태 변화까지 옛 값이 남는다
        this.notify.onMetaChange = () => this.scheduleRender()
        this.config.changed$.subscribe(() => {
            this.applyEnabled()
            this.applyOpacity()
            // 검색 줄 on/off 는 설정 창에서 바뀐다 (끄면 걸려 있던 필터도 같이 지운다)
            this.applySearchBox()
            // 설정 창에서 패널을 여닫았을 수도 있다 — 값이 같으면 아무 일도 하지 않는다.
            // remember=false: 방금 설정에서 온 값을 되쓰지 않는다(무한 왕복 방지)
            this.view?.setOpen(!!this.config.store.agentDeck.viewerOpen, false)
            this.relayout()
            this.scheduleRender()
        })

        // 화면 깨짐 주기 검사. 출력 구독(scheduleScreenCheck)이 더 정밀하지만, 구독이 붙지
        // 못한 탭에서는 아무도 보지 않게 되므로 그물을 하나 더 둔다. 활성 탭만 본다 —
        // 숨은 탭은 폭이 0 이라 판정할 근거가 없다.
        setInterval(() => this.sweepScreens(), SCREEN_SWEEP_MS)

        // 창 크기 변화 -> 4:3 폭 재계산
        this.observer = new ResizeObserver(() => this.relayout())
        this.observer.observe(this.windowEl)
        window.addEventListener('resize', () => this.relayout())

        // 핫키 처리는 여기서 — provider 쪽에서 하면 HotkeysService 와 순환 의존이 된다
        this.hotkeys.hotkey$.subscribe(hotkey => {
            if (hotkey === 'agentdeck-toggle') {
                this.config.store.agentDeck.enabled = !this.config.store.agentDeck.enabled
                this.config.save()
            }
            if (hotkey === 'agentdeck-newline') {
                this.sendNewline()
            }
            if (hotkey === 'agentdeck-paste') {
                this.doPaste('hotkey')
            }
            if (hotkey === 'agentdeck-repair' && this.config.store.agentDeck.claimRepairKey !== false) {
                this.repair('all')
            }
            if (hotkey === 'agentdeck-view') {
                this.view?.toggle()
            }
            // 사이드바 `+ 새 탭` 버튼과 같은 경로 — 버튼 핸들러(`buildSidebar`)와 동일하게 zone 안에서.
            // 게이트가 꺼져 있으면 순정 `new-tab` 이 살아 있으므로 여기서 또 열면 둘이 된다
            if (hotkey === 'agentdeck-new-tab' && this.config.store.agentDeck.claimNewTabKey !== false) {
                this.zone.run(() => { void this.openNewTab() })
            }
            // 처리를 여기서 하는 이유는 위와 같다 — provider 에서 HotkeysService 를 주입하면
            // 순환 의존이다(`hotkeys.ts` 주석). 선언만 그쪽에 있고 동작은 전부 이 파일이다
            if (hotkey === 'agentdeck-focus-list') {
                this.toggleKeyboardNav()
            }
            // 유닛 L 이 `hotkeys.ts` 에 선언만 하고 넘긴 것 — 처리는 여기서만 할 수 있다
            // (provider 에서 HotkeysService 를 주입하면 순환 의존이 된다, `hotkeys.ts` 주석)
            if (hotkey === 'agentdeck-view-mode') {
                this.view?.toggleMode()
            }
            // `agentdeck-jump-1` … `agentdeck-jump-9` — 사이드바에 보이는 순서로 N 번째 세션.
            // 자리 수는 선언과 같은 상수(`hotkeys.ts` JUMP_SLOTS)에서 온다
            const jump = /^agentdeck-jump-(\d+)$/.exec(hotkey)
            if (jump) {
                this.jumpToRow(Number(jump[1]))
            }
        })

        // 경과 시간 갱신 + running -> idle 자동 복귀
        setInterval(() => this.tick(), 1000)
        monitorEventLoop()

        this.relayout()
        this.render()
        this.diag(`setup done tabs=${this.app.tabs.length} enabled=${this.enabled} mainEl=${!!this.mainEl}`)

        // 개발/진단용 — devtools 나 CDP 에서 내부 상태를 들여다볼 수 있게 노출한다.
        //
        // **덮지 말고 합친다.** 다른 서비스도 여기에 자기 진단구를 붙이는데(`alert.service` 의
        // `alert`, `notify.service` 의 `tabIds`), 통째로 재할당하면 **우리보다 먼저 붙인 것이
        // 조용히 사라진다**. 실측(2026-09-08): notify 는 `init()` 즉시 붙고 이 코드는 `ready$`
        // 뒤에 도므로 `tabIds` 가 지워져 R18 이 "진단구가 없다" 로 판정됐다. alert 는 자기도
        // `ready$` 안에서 붙어 우연히 살아남았을 뿐이다.
        const g = window as any
        g.__agentdeck = Object.assign(g.__agentdeck ?? {}, {
            app: this.app,
            config: this.config,
            status: this.status,
            relayout: () => this.relayout(),
            render: () => this.render(),
            /**
             * 검색·상태 필터를 코드에서 걸어 본다 (회귀용).
             *
             * 사람 손으로는 입력창에 치는 것이 유일한 경로인데, 프로브는 포커스·IME 조합을
             * 재현할 수 없어 화면 결과만 재려면 이 문이 필요하다. 입력창 값도 같이 맞춰 준다 —
             * 화면과 내부 상태가 어긋난 채로 판정하면 그 판정을 못 믿는다.
             */
            setFilter: (query?: string | null, status?: WorkStatus | null) => {
                this.searchQuery = typeof query === 'string' ? query : ''
                this.statusFilter = status ?? null
                if (this.searchEl) {
                    this.searchEl.value = this.searchQuery
                }
                this.syncSearchUi()
                this.render()
                return { query: this.searchQuery, status: this.statusFilter }
            },
            repair: (scope: 'active' | 'all' = 'all') => this.repair(scope),
            /**
             * 순서 재배열을 좌표 없이 시켜 본다 (회귀용) — **드롭과 같은 경로**(`applyReorder`)를 탄다.
             *
             * 드래그 자체는 합성 포인터로도 흉내낼 수 있다(document 리스너를 쓰고
             * `setPointerCapture` 를 쓰지 않는다 — tools/README 의 함정 목록 참고). 그래도 이 문을
             * 여는 이유는 **결과 검증**이다: 옮긴 뒤 `app.tabs` 가 어떻게 됐는지를 프로브가
             * 자기 사본으로 계산하지 않고 제품에게 물어야 한다.
             */
            reorder: (from: number, to: number, place: DropPlace = 'before') => {
                const before = [...this.app.tabs]
                const a = before[from]
                const b = before[to]
                if (!a || !b) {
                    return { ok: false, reason: '없는 탭 인덱스', order: before.map((_, i) => i) }
                }
                // `place` 는 런타임에 아무 문자열이나 올 수 있다(프로브가 부르는 문이다). 검사하지
                // 않으면 `'atfer'` 같은 오타가 조용히 `before` 로 처리되어 **프로브가 재는 것과
                // 제품이 한 일이 어긋난다** — 회귀가 초록인데 규칙은 안 검증된 상태가 된다.
                if (place !== 'before' && place !== 'after') {
                    return { ok: false, reason: `place 가 before/after 가 아니다: ${String(place)}`, order: before.map((_, i) => i) }
                }
                // **드래그가 막히는 조건은 여기서도 막아야 한다.** 이 진단구는 드래그를 좌표 없이
                // 재현하는 용도라, 게이트를 안 지나면 "화면에서는 막히는데 진단구로는 된다" 가 되어
                // 회귀가 게이트를 검증할 수 없다 (2026-09-09 실측: `sortByStatus` 를 켠 채로도
                // `ok: true` 가 나왔다). 상태순 정렬 중에는 옮겨도 다음 렌더에 제자리로 돌아간다.
                if (this.config.store.agentDeck.sortByStatus) {
                    return {
                        ok: false,
                        reason: '상태순 정렬이 켜져 있어 순서를 바꿀 수 없다',
                        order: before.map((_, i) => i),
                    }
                }
                const ok = this.applyReorder(a, b, place)
                this.render()
                // 새 순서를 **옛 인덱스로** 적어 돌려준다 — `[1,0,2]` 면 0번과 1번이 자리를 바꿨다는 뜻
                return { ok, order: this.app.tabs.map(t => before.indexOf(t)) }
            },
            /**
             * **마지막** 드래그가 어떻게 끝났나 + 목록이 흐르는 축.
             *
             * `reorderDrag()` 와 따로 둔 이유 — 그쪽은 드래그가 끝나면 `null` 이 되고 회귀가 그
             * `null` 로 "드래그 상태가 남지 않았다" 를 판정한다(RO4). 끝난 뒤의 사유를 거기 얹으면
             * 그 계약이 깨진다.
             *
             * `flowsSideways` 를 여는 까닭은 프로브가 `sidebarDock` 으로 축을 **다시 계산**하지
             * 않게 하는 것이다 — 규칙 사본은 제품이 규칙을 바꿔도 옛 규칙으로 계속 초록이 된다.
             */
            lastDrag: () => ({
                end: this.lastDragEnd,
                flowsSideways: this.listFlowsSideways(),
                dock: this.dockSide,
                clickGuard: this.dragClickGuard,
                /**
                 * 지금 목록이 스크롤되는 축 (null = 넘치지 않는다). 드래그 중이 아닐 때도 답한다 —
                 * 회귀가 "스크롤할 화면이 아니다" 를 **실패가 아니라 판정 불가**로 적으려면
                 * 그 사실을 제품에게 물어야 한다. 프로브가 도킹으로 다시 계산하면 규칙 사본이 된다.
                 */
                scrollAxis: this.listScrollAxis(),
                autoScroll: this.config.store.agentDeck.dragAutoScroll,
            }),
            /** 지금 드래그 상태 — 삽입선이 어디를 가리키는지·취소가 먹었는지를 프로브가 되읽는다 */
            reorderDrag: () => {
                const d = this.drag
                if (!d) {
                    return null
                }
                const axis = this.listScrollAxis()
                return {
                    moved: d.moved,
                    from: this.app.tabs.indexOf(d.tab),
                    target: d.target ? { index: this.app.tabs.indexOf(d.target.tab), place: d.target.place } : null,
                    line: !!d.line,
                    /**
                     * 자동 스크롤 상태. `axis` 는 제품이 고른 스크롤 축, `speed` 는 **지금 좌표에서**
                     * 나오는 속도(0 = 스크롤할 이유 없음)다 — 회귀가 띠 판정·정지 조건을 제품 규칙으로
                     * 되읽게 하려고 여는 것이다(임계 폭·속도표를 프로브가 베끼면 사본이 낡는다).
                     * `active` 는 루프가 실제로 돌고 있나 = 타이머 잔여 판정의 근거.
                     */
                    scroll: {
                        axis,
                        active: !!d.scroll,
                        speed: axis ? Math.round(this.dragScrollSpeed(axis)) : 0,
                        px: Math.round(d.scrolled.px),
                        at: { x: d.at.x, y: d.at.y },
                    },
                }
            },
            /**
             * 키보드 내비게이션 상태를 **좌표 없이** 되읽는다 (회귀용).
             *
             * 이동 규칙은 여기서 다시 적지 않는다 — 키는 합성 이벤트로 실제 경로에 태울 수 있다:
             * `document.querySelector('.ad-list').dispatchEvent(new KeyboardEvent('keydown',`
             * ` { key: 'ArrowDown', bubbles: true }))`. 리스너가 그 엘리먼트에 걸려 있으므로
             * 사람이 누른 것과 같은 코드가 돈다. 그래서 이 문이 여는 것은 ① 지금 상태
             * ② 진입/해제(포커스는 CDP 로 주기 번거롭다) 두 가지뿐이다 — `groups()`·`judge()` 를
             * 연 것과 같은 이유로 규칙의 사본을 만들지 않는다.
             *
             * `activeTabIndex` 를 같이 주는 까닭 — **포커스와 선택이 갈렸는지**는
             * "`index` 는 움직였는데 `activeTabIndex` 는 그대로" 로만 확인할 수 있다.
             * `owner` 는 지금 키를 받는 주인이다: `list`/`search` 가 아니면 우리는 아무것도
             * 가로채지 않는다는 뜻이고, 그것이 "터미널로 새지 않는다" 의 반쪽 증거다.
             */
            focusNav: (op?: 'list' | 'search' | 'off') => {
                if (op === 'list') {
                    this.focusList('keep')
                }
                if (op === 'search') {
                    this.focusSearch()
                }
                if (op === 'off') {
                    this.releaseKeyboard()
                }
                const all = this.app.tabs
                const { rows, index } = this.navPlan()
                const desc = (r: NavRow<BaseTabComponent>) => r.kind === 'head'
                    ? { kind: 'head', key: r.key, tabIndex: -1 }
                    : { kind: 'tab', key: null, tabIndex: all.indexOf(r.tab) }
                const active = document.activeElement
                const ring = this.listEl?.querySelector('.ad-nav-focus') as HTMLElement | null
                return {
                    mode: this.navMode,
                    index,
                    count: rows.length,
                    focused: this.navFocus ? desc(this.navFocus) : null,
                    /** 화면에 보이는 순서 그대로 — 프로브가 `renderPlan` 을 재계산하지 않게 */
                    rows: rows.map(desc),
                    /** 지금 활성 탭 (= 선택). 이동으로 이 값이 움직이면 포커스 분리가 깨진 것이다 */
                    activeTabIndex: this.app.activeTab ? all.indexOf(this.app.activeTab) : -1,
                    /** 링이 실제로 그려진 줄 — DOM 이 상태를 따라왔는지 좌표 없이 본다 */
                    ring: ring
                        ? { tab: ring.classList.contains('ad-tab'), adIndex: ring.dataset.adIndex ?? null }
                        : null,
                    owner: active === this.listEl ? 'list'
                        : active === this.searchEl ? 'search'
                            : (active as HTMLElement | null)?.className || 'other',
                    searchVisible: this.navSearchVisible(),
                    wrap: !!this.config.store.agentDeck.keyboardNavWrap,
                    enabled: this.config.store.agentDeck.keyboardNav !== false,
                }
            },
            /**
             * `Ctrl-N` 을 **제품 경로 그대로** 태운다 (`jumpToRow`) — 프로브가 줄 번호 산술을
             * 사본으로 들고 있지 않게. 돌려주는 값은 `focusNav()` 와 같은 모양이라 "몇 번째
             * 줄로 갔나" 를 좌표 없이 본다.
             *
             * 키 자체(`Ctrl-1` 이 이 id 로 오는가)는 여기로 재지 않는다 — 그건 Tabby 의
             * 핫키 표가 하는 일이고, 선언·묶기·처리 세 곳의 일치는 `test/hotkeys.test.js` 가
             * 소스로 본다. 여기서 재는 것은 **화면 순서대로 골랐는가** 하나다
             */
            jump: (slot: number) => {
                this.jumpToRow(slot)
                const all = this.app.tabs
                const { rows } = this.navPlan()
                return {
                    slot,
                    slots: Array.from({ length: JUMP_SLOTS }, (_, i) => {
                        const target = this.sessionSlots.get(i + 1)
                        return { number: i + 1, tabIndex: target ? all.indexOf(target) : -1 }
                    }),
                    activeTabIndex: this.app.activeTab ? all.indexOf(this.app.activeTab) : -1,
                    focusedTabIndex: this.navFocus && this.navFocus.kind === 'tab'
                        ? all.indexOf(this.navFocus.tab) : -1,
                    navMode: this.navMode,
                    /** 보이는 줄 중 **탭 줄만** 화면 순서대로 (헤더 제외) — 기대값의 출처 */
                    tabRows: rows.filter(r => r.kind === 'tab')
                        .map(r => all.indexOf((r as { kind: 'tab', tab: BaseTabComponent }).tab)),
                    /** 핫키가 실제로 묶여 있나 — ConfigProvider 기본값이 살아 있는지 */
                    bound: (this.config.store.hotkeys ?? {})[`agentdeck-jump-${slot}`] ?? null,
                }
            },
            view: () => this.view,
            openFile: (file: string) => this.view?.openFile(file),
            /**
             * 기동 때 하는 핫키 정리를 **다시 한 번** 돌린다.
             *
             * `ensurePasteHotkey` 는 `ready$` 안에서 딱 한 번 도는데, 그 안의 `claimCtrlV`
             * 게이트는 설정에 따라 갈리므로 회귀에서 양쪽 갈래를 재려면 재실행이 필요하다.
             * 하는 일이 "핫키 테이블에서 Ctrl-V 를 빼는 것" 뿐이라 여러 번 불러도 결과가 같다.
             */
            rescanPasteHotkey: () => this.ensurePasteHotkey(),
            /**
             * 지금 화면의 그룹 구성을 **제품 계산 그대로** 돌려준다 (`groupsFor` + `foldGroupKey`).
             *
             * 왜 여는가 — 검증 도구가 그룹 규칙(라벨 사전순·`기타` 를 맨 뒤·키 폴딩)을 사본으로
             * 들고 있으면 그 사본이 낡는다. `judge()`·`profiles()` 를 연 것과 같은 이유다.
             * `cwd` 를 같이 주는 이유는 따로 있다 — 그룹이 안 갈릴 때 원인이 "캐시가 비었다" 인지
             * "폴딩이 합쳤다" 인지 이것 없이는 가를 수 없다 (2026-09-08 GR6~GR14 가 그래서
             * `판정 불가` 로 9개 한꺼번에 빠졌다).
             */
            groups: () => {
                const all = this.app.tabs
                // **화면과 같은 계산을 쓴다** — `render()` 와 공유하는 `renderPlan()`.
                // 여기서 규칙을 다시 적으면 그 사본이 낡는다(프로브가 헤더 생략 조건을
                // 재계산하던 것이 마지막 사본이었고, 그것을 없애려고 이 값을 연다).
                const rp = this.renderPlan()
                const idx = (g: TabGroup<BaseTabComponent>) => g.tabs.map(t => all.indexOf(t))
                return {
                    cwdCache: all.map((t, i) => ({
                        index: i,
                        title: String(t.title ?? '').slice(0, 40),
                        dir: this.cwdCache.get(t)?.dir ?? null,
                        at: this.cwdCache.get(t)?.at ?? null,
                        // 이 탭의 cwd 에서 찾아낸 프로젝트 루트 (`null` = 못 찾음 → cwd 자체가 키)
                        projectRoot: projectRootOf(this.cwdCache.get(t)?.dir ?? null),
                    })),
                    // 지금까지 탐지해 둔 폴더→루트 — 그룹이 안 갈릴 때 "탐지가 아직" 인지
                    // "루트가 같아서" 인지 이것 없이는 가를 수 없다 (cwd 를 같이 여는 것과 같은 이유)
                    projectRoots: projectRootCacheSnapshot(),
                    /**
                     * 그룹 계산 결과 (헤더 생략과 무관하게 `groupsFor` 가 낸 것).
                     *
                     * `collapsed` 는 **설정에 저장된 값**이고 `collapsedEffective` 는 화면에
                     * 실제로 접히는지다. 둘을 가른 이유 — 검색 중에는 매칭이 있는 접힌 그룹을
                     * 임시로 펴 보이는데(`collapseReason: 'filter-open'`), `collapsed` 를 그
                     * 유효값으로 바꿔 버리면 회귀 GR8·GR9("제품이 **저장값으로** 접힘이라
                     * 판정하는가")의 의미가 흔들린다.
                     */
                    list: rp.groups.map(g => ({
                        key: g.key,
                        label: g.label,
                        collapsed: this.isGroupCollapsed(g.key),
                        collapsedEffective: rp.collapseOf(g).collapsed,
                        collapseReason: rp.collapseOf(g).reason,
                        tabIndexes: idx(g),
                    })),
                    /** 헤더를 실제로 그리는가 — 이 조건을 프로브가 재계산하지 않게 연다 */
                    withHeads: rp.withHeads,
                    /** 실제 렌더 계획 (헤더 생략 시 평면 한 덩이). 화면 순서의 정답이다 */
                    plan: rp.plan.map(g => ({
                        key: g.key,
                        label: g.label,
                        // 화면 그대로 — 헤더를 안 그리면 접힘을 적용하지 않는다
                        collapsed: rp.withHeads && rp.collapseOf(g).collapsed,
                        collapseReason: rp.collapseOf(g).reason,
                        tabIndexes: idx(g),
                    })),
                    /**
                     * `render()` 가 실제로 줄을 그린 탭들의 `app.tabs` 인덱스
                     * (`sortByStatus` 적용 후 + 검색·상태 필터 통과분).
                     * 이게 없으면 검증 도구가 정렬을 끄고서만 그룹핑을 잴 수 있다 —
                     * "정렬 + 그룹핑" 조합 화면이 회귀 대상에서 빠진다.
                     */
                    tabsUsedByRender: rp.visible.map(t => all.indexOf(t)),
                    /** 집계 칩이 센 모집단 — 필터가 걸려도 전체다 (`render` 주석의 근거) */
                    tabsForCounts: rp.tabs.map(t => all.indexOf(t)),
                    /** 지금 걸린 검색·상태 필터 — 화면이 좁혀진 이유를 프로브가 되읽을 수 있게 */
                    filter: { query: this.searchQuery, status: this.statusFilter, active: rp.filtering },
                    sortByStatus: !!this.config.store.agentDeck.sortByStatus,
                    fold: (k: string) => foldGroupKey(k),
                }
            },
            /**
             * 지난 세션 목록을 **제품 계산 그대로** 돌려준다 (`resumeRowsFor` + 원장 상태).
             *
             * `groups()` 와 같은 이유로 연다 — 검증 도구가 "어느 세션이 어느 그룹에 붙나" 를
             * 사본으로 재계산하면 그 사본이 낡는다. 화면에 그려졌는지는 프로브가 DOM
             * (`.ad-resume`)과 대조해 판정한다.
             */
            sessions: () => {
                const cfg = this.config.store.agentDeck
                const live = this.liveSessionIds()
                const records = this.ledger.records()
                return {
                    ledger: this.ledger.snapshot(),
                    /** 원장+디스크를 합친 전체 (그룹 필터 전) */
                    records: records.map(r => ({ ...r })),
                    /** 지금 탭이 들고 있는 세션 */
                    live: [...live.keys()],
                    enabled: cfg.resumeList !== false,
                    expanded: this.isResumeExpanded(null),
                    /**
                     * 서랍에 실제로 그릴 줄 — 화면 순서의 정답이다.
                     *
                     * 그룹별로 나뉘어 있던 것을 **바닥 서랍 하나**로 합쳤다 (2026-09-14).
                     * 프로브가 그룹을 훑을 이유가 사라졌으므로 여기도 평면 한 벌이다.
                     */
                    rows: resumeRowsFor(records, {
                        groupKeys: null,
                        keyOf: cwd => groupKeyOf(cwd, projectRootOf),
                        fold: foldGroupKey,
                        live,
                        days: Number(cfg.resumeListDays) || 0,
                        limit: Number(cfg.resumeListLimit) || 0,
                        hidden: new Set<string>(Array.isArray(cfg.resumeHidden) ? cfg.resumeHidden : []),
                        now: Date.now(),
                    }).map(r => ({ sessionId: r.sessionId, label: r.label, cwd: r.cwd,
                        lastStatus: r.lastStatus, openTabId: r.openTabId })),
                }
            },
            /** 원장 스캔을 지금 한 번 돌린다 (프로브가 기다릴 수 있게 Promise 를 준다) */
            rescanSessions: () => this.ledger.refresh(true),
            // 에이전트 판정 상태 — 진단 로그는 값이 바뀔 때만 찍히므로 "조회가 돌았는지" 를
            // 로그만으로는 가를 수 없다 (2026-09-08 검증 중 실제로 막혔다)
            debug: () => ({ outputHits: this.outputHits, decorator: this.status.debug }),
            /**
             * 화면 판정을 **제품과 같은 규칙으로** 돌려준다 (`judgeScreen`).
             *
             * 검증 도구가 규칙을 복사해 가지면 그 사본이 낡는다 — `tools/verdict.js` 가 이미
             * 그래서 "규칙을 고치면 양쪽을 같이 고칠 것" 이라는 주석을 달고 있다. 프로브는
             * 복사 대신 이걸 부른다(2026-09-08: 단순화한 사본이 fakebox 화면을 깨진 것으로
             * 잘못 읽어 R2·R14 가 거짓 실패했다).
             */
            /**
             * 에이전트 프로필을 **제품 모듈 그대로** 돌려준다.
             *
             * 왜 필요한가 — 검증 도구가 프로필을 보려면 방법이 두 가지뿐이었다: 값을 복사해 갖거나
             * `.tmp/agents.js`(= `npm test` 컴파일 산출물)를 require 하거나. 전자는 사본이 낡고
             * (`tools/verdict.js` 가 이미 그 문제를 주석으로 달고 있다), 후자는 `npm test` 를 한 번도
             * 안 돌렸으면 파일이 없고 돌렸어도 `src` 보다 낡을 수 있다 — 관측 도구가 낡은 값을 보고
             * "프로필이 이렇다" 고 말하는 것이 가장 나쁜 결과다 (2026-09-08 유닛 M 지적).
             *
             * 정규식은 JSON 으로 나가지 않으므로 `source`/`flags` 로 펼쳐서 준다.
             */
            profiles: () => {
                const dump = (p: AgentProfile) => ({
                    id: p.id,
                    label: p.label,
                    // 사이드바 표식 — 관측 도구가 "이 줄에 붙은 SVG 가 그 프로필 것인가" 를
                    // 사본 없이 대조할 수 있게 원문 그대로 준다
                    icon: p.icon,
                    processHints: p.processHints,
                    titleHints: p.titleHints,
                    waitingPatterns: p.waitingPatterns.map(r => ({ source: r.source, flags: r.flags })),
                    busyPatterns: p.busyPatterns.map(r => ({ source: r.source, flags: r.flags })),
                    busyTitleMarks: p.busyTitleMarks,
                    imagePasteKey: p.imagePasteKey,
                    promptHeads: p.promptHeads,
                    promptShape: p.promptShape ?? null,
                    screenShape: p.screenShape ?? null,
                    patternsProven: p.patternsProven,
                })
                return {
                    list: AGENT_PROFILES.map(dump),
                    union: dump(unionProfile()),
                    // 판정에 실제로 쓰이는 형태 — 실측 없는 프로필은 문구가 합집합으로 떨어진다
                    effective: AGENT_PROFILES.map(p => dump(detectProfileFor(p.id))),
                    // 식별도 **제품 함수 그대로** 부를 수 있게 열어 둔다 — 관측 도구가 판정 순서
                    // (claude 를 맨 뒤에 두는 규칙)를 복사해 갖지 않도록
                    identify: (processNames: string, title: string) => identifyAgent(processNames, title),
                    /**
                     * 실측 없는 프로필의 안전장치가 실제로 작동하는지 — **판정을 여기서 한다.**
                     *
                     * 그 판정의 기준은 "합집합과 **같은 배열 객체**(`===`)" 인데, 진단구는 정규식을
                     * JSON 으로 펼쳐 주므로 밖에서는 동일성을 볼 수 없다. 관측 도구가 내용 비교로
                     * 대신하면 "우연히 같은 내용" 과 "실제로 같은 객체" 를 못 가른다 —
                     * 그래서 제품 안에서 확인한 결과만 boolean 으로 넘긴다 (2026-09-08).
                     */
                    fallback: AGENT_PROFILES.map(p => {
                        const eff = detectProfileFor(p.id)
                        const u = unionProfile()
                        return {
                            id: p.id,
                            patternsProven: p.patternsProven,
                            // 실측 없는 프로필: 화면 문구 셋이 합집합 **그 객체** 여야 한다
                            usesUnionPatterns: eff.waitingPatterns === u.waitingPatterns
                                && eff.busyPatterns === u.busyPatterns
                                && eff.busyTitleMarks === u.busyTitleMarks,
                            // 실측 있는 프로필: 자기 배열을 그대로 써야 한다
                            usesOwnPatterns: eff.waitingPatterns === p.waitingPatterns
                                && eff.busyPatterns === p.busyPatterns
                                && eff.busyTitleMarks === p.busyTitleMarks,
                            shapesDropped: !eff.promptShape && !eff.screenShape,
                            // 좁히지 않는 것은 화면 문구뿐 — 실측된 값은 프로필 것을 유지한다
                            imagePasteKeyKept: eff.imagePasteKey === p.imagePasteKey,
                            catchesClaudeBusy: eff.busyPatterns.some(r => r.test('esc to interrupt')),
                        }
                    }),
                }
            },
            judge: (pane?: any) => {
                const target = pane ?? this.focusedPane()
                const read = target ? this.readScreen(target) : null
                if (!read) {
                    return null
                }
                return {
                    ...judgeScreen(read.lines, read.cols, this.profileForPane(target)?.screenShape),
                    cols: read.cols,
                }
            },
            /**
             * 회귀용 — 이 pane(또는 탭)을 그 에이전트로 **못 박는다**. `id` 가 없으면 푼다.
             *
             * 화면 감시·복구는 Claude pane 에서만 돈다(`canRepairComposer`). 회귀가 그 경로를
             * 재려면 pane 하나를 claude 로 보이게 해야 하는데, 진짜 claude 를 띄우는 길은
             * 로그인 상태와 기동 시간에 기대 회귀를 흔든다. 그래서 창구만 연다.
             * 되돌리는 것은 부르는 쪽 책임이다 — 안 풀면 그 pane 의 판정이 계속 고정된다.
             */
            pinAgent: (target?: any, id?: string | null) => {
                const t = target ?? this.focusedPane()
                if (!t) {
                    return { pinned: false, why: 'pane 을 못 찾았다' }
                }
                const had = this.pinnedAgents.has(t)
                if (id) {
                    this.pinnedAgents.set(t, String(id) as AgentId)
                    if (!had) { this.pinnedCount++ }
                } else {
                    this.pinnedAgents.delete(t)
                    if (had) { this.pinnedCount = Math.max(0, this.pinnedCount - 1) }
                }
                return { pinned: !!id, size: this.pinnedCount }
            },
            agentOf: (tab?: BaseTabComponent) => {
                const root = tab ?? this.app.activeTab
                const pane = root ? this.firstPane(root) : undefined
                const observed = pane ? this.paneAgents.get(pane) : undefined
                return root
                    ? {
                        id: this.tabAgents.get(root) ?? null,
                        // 훅이 말한 것(1순위) — `id`(추측 캐시)와 갈라 봐야 "왜 그 프로필로 잡혔나" 가 잡힌다
                        hookId: this.notify?.agentOf?.(root) ?? null,
                        effectiveId: pane ? this.profileForPane(pane)?.id ?? 'unknown' : 'unknown',
                        streamId: observed?.session === pane?.session ? observed?.tracker.id ?? null : null,
                        probedAt: this.agentProbedAt.get(root) ?? 0,
                    }
                    : null
            },
            probeAgent: (tab?: BaseTabComponent) => {
                const root = tab ?? this.app.activeTab
                if (root) {
                    this.agentProbedAt.delete(root)
                    void this.probeAgent(root, 'manual')
                }
            },
            kickLog: diagMemory(),
            /**
             * 진단 묶음을 만들고 경로를 돌려준다 — 설정 창의 "진단 로그 모으기" 와 같은 동작.
             * 콘솔에서 쓰는 경로도 남겨 두는 이유: 설정 창을 열 수 없을 만큼 깨진 상태에서도 채증이 돼야 한다
             */
            /**
             * 진단 로그가 **지금 어디에 쓰이는지** 알려준다.
             *
             * 검증 도구가 `os.homedir()` 로 경로를 만들어 두면, 격리 인스턴스가 자기 폴더에
             * 쓰기 시작한 순간(`AGENTDECK_DIAG_DIR`, `diag.ts` 의 `logDir`) 남의 파일을 읽고
             * "아무 줄도 안 남았다" 로 거짓 실패한다 — 2026-09-09 에 IN9·PR4·PR5 가 그렇게
             * 한꺼번에 뒤집혔다. 경로는 제품에게 물어야 한다.
             */
            diagPaths: () => ({ diag: DIAG_PATH, prev: DIAG_PREV_PATH, screen: SCREEN_PATH }),
            collectDiag: (includeScreen = false) => collectDiagBundle({
                includeScreen,
                stamp: {
                    tabby: this.platform.getAppVersion?.(),
                    osRelease: this.platform.getOSRelease?.(),
                    config: configStamp(this.config.store),
                },
            }),
        })
    }

    // ---------- 화면 복구 ----------

    /**
     * 깨진 화면을 사람이 직접 되살린다 — 창을 복원→최대화로 흔드는 것을 코드로 대신한다.
     *
     * 자동 경로(`watchSize`)는 "xterm 과 pty 의 크기가 어긋났다" 를 보고 고치는데, 그 감시는
     * 탭이 열리고 `sizeWatchMs`(기본 6초) 동안만 돈다. 그 뒤에 깨지는 경우가 남는다 —
     * 두 크기는 서로 맞는데 **TUI 가 들고 있는 프레임만** 옛것인 상황이다. 크기가 이미 같으니
     * 커널은 SIGWINCH 를 내지 않고, 앱은 다시 그릴 이유를 영영 못 받는다. 증상은
     * "statusline 이 사라지고 입력창 구분선이 중간에서 끊긴다" (2026-09-01 실측).
     *
     * 그래서 복구는 크기를 맞추는 것으로 끝내지 않고 **항상 한 번 흔든다**(`nudgePtyRedraw`).
     * 어긋남이 없어도 무해하다 — 폭이 한 칸 줄었다 돌아올 뿐이고 xterm 은 건드리지 않는다.
     *
     * @param scope `active` = 지금 보고 있는 탭만, `all` = 열려 있는 모든 탭
     */
    repair (scope: 'active' | 'all' = 'all'): void {
        const trace = new PerformanceTrace('repair')
        const targets = scope === 'active' && this.app.activeTab
            ? [this.app.activeTab]
            : this.app.tabs
        this.diag(`repair scope=${scope} tabs=${targets.length}`)

        // 1) 사이드바 폭부터 다시 잰다 — 어긋남의 출발점이 대개 여기다
        trace.step('layout', () => this.relayout())

        // 2) 레이아웃이 실제로 반영된 다음에 재야 한다 (scheduleRefit 과 같은 이유로 두 프레임)
        requestAnimationFrame(() => requestAnimationFrame(() => {
            trace.mark('frames-ready', `scope=${scope} tabs=${targets.length}`)
            for (const tab of targets) {
                const anyTab = tab as any
                const panes: BaseTabComponent[] = typeof anyTab.getAllTabs === 'function'
                    ? anyTab.getAllTabs()
                    : [tab]
                for (const pane of panes) {
                    this.repairPane(pane, trace)
                }
            }
        }))
    }

    /**
     * 복구 한 pane 분 — **화면을 지우고 앱에게 처음부터 다시 그리게 한다.**
     *
     * 흔들기(`nudgePtyRedraw`)만으로는 안 고쳐지는 경우가 실제로 있다(2026-09-01 유저 확인).
     * 이유는 흔들기가 고치는 대상이 하나뿐이라서다 — 그건 "앱이 폭을 잘못 알고 있다" 를 푼다.
     * 그런데 깨진 화면에는 그 말고도 두 가지가 더 얹혀 있다.
     *
     *  - **xterm 쪽 잔상**: 옛 폭으로 그려진 글자가 셀에 그대로 남아 있다. 앱이 다시 그려도
     *    앱은 자기가 쓴 자리만 덮으므로, 그 바깥(옛 프레임의 오른쪽·아래)은 영영 안 지워진다.
     *  - **터미널 상태**: 스크롤 영역(DECSTBM)·줄바꿈 모드·속성이 옛 크기 기준으로 잡혀 있으면
     *    새로 그린 것까지 어긋난 자리에 들어간다.
     *
     * 그래서 순서가 있다 — ① 크기를 맞추고 ② `reset()` 으로 터미널 상태와 화면을 비우고
     * ③ 그래도 앱은 자기가 이미 그렸다고 믿고 있으니 흔들어 SIGWINCH 를 주고
     * ④ 마지막으로 `Ctrl+L`(0x0C) 을 보내 "전부 다시 그려라" 를 명시로 시킨다.
     * ③ 만으로 부족했던 이유가 ①②④ 가 빠져서였다.
     *
     * `reset()` 은 스크롤백을 함께 지운다. 지난 대화를 남기고 싶으면 `repairHard: false` —
     * 그때는 예전처럼 크기 정합 + 흔들기까지만 한다.
     */
    private repairPane (pane: BaseTabComponent, trace?: PerformanceTrace): void {
        const cfg = this.config.store.agentDeck
        const anyPane = pane as any
        const frontend = anyPane.frontend
        const xterm = frontend?.xterm
        // 숨겨진 탭은 컨테이너 폭이 0 이라 fit 하면 1열로 줄어든다 — 크기는 건드리지 않고
        // 다시 선택될 때 Tabby 가 재측정하게 둔다
        const host = xterm?.element?.parentElement
        if (!host?.clientWidth || !host?.clientHeight) {
            return
        }

        const before = this.readScreen(pane)
        trace?.mark('screen-read')
        const beforeVerdict = before ? judgeScreen(before.lines, before.cols, this.profileForPane(pane)?.screenShape) : null
        this.snapshot(pane, `manual-before ${beforeVerdict
            ? (beforeVerdict.broken ? beforeVerdict.reasons.join(' / ') : '판정=정상')
            : '읽을 수 없음'}`)

        // ① 크기 정합 — 여기가 어긋나 있으면 뒤 단계가 전부 헛돈다
        try {
            frontend?.fitAddon?.fit?.()
        } catch {
            // 아직 붙는 중이다 — 아래 단계만이라도 태운다
        }
        this.syncPtySize(pane, frontend)
        trace?.mark('fit-and-sync')

        // ② 잔상 지우기 — 입력창 영역만 비운다 (대화는 남는다)
        if (before) {
            this.clearInputArea(pane, before)
        }

        // ②-b 그래도 안 되면 터미널 상태까지 초기화 (스크롤백이 날아가므로 기본은 끔)
        if (cfg.repairHard === true) {
            try {
                xterm?.reset?.()
            } catch {
                // 프론트엔드가 막 떨어졌다
            }
        }
        try {
            xterm?.refresh?.(0, (xterm.rows ?? 1) - 1)
        } catch { }

        // ③ 크기가 이미 맞아도 무조건 흔든다 — 이 함수를 부르는 이유 자체가 "맞는데 깨졌다" 다
        trace?.mark('clear-and-refresh')
        this.nudgePtyRedraw(pane, trace)

        // ④ `Ctrl+L` — **기본으로 보내지 않는다** (`repairSendRedrawKey` 기본 끔).
        //    Claude Code 가 이걸 "화면 지우기" 로 받아 보고 있던 대화를 스크롤백으로 밀어내는 것을
        //    2026-09-11 채증으로 확정했다(`sendRedrawKey` 주석). ①~③ 이 이미 고치므로 없어도 된다.
        //    켜 둔 경우에만 보내고, 흔들기가 도착한 뒤여야 하므로 nudge 되돌리기(60ms)보다 뒤에 둔다.
        if (cfg.repairSendRedrawKey === true) {
            setTimeout(() => this.sendRedrawKey(pane), REPAIR_REDRAW_DELAY_MS)
        }

        // ⑤ 채증 — "↻ 를 눌렀는데 안 고쳐진다" 를 감이 아니라 파일로 가른다.
        //    누른 직후와 다시 그려진 뒤를 짝으로 남긴다.
        setTimeout(() => {
            const after = this.readScreen(pane)
            const still = after ? judgeScreen(after.lines, after.cols, this.profileForPane(pane)?.screenShape) : null
            this.snapshot(pane, `manual-after ${still ? (still.broken ? '아직 깨짐: ' + still.reasons.join(' / ') : '복구됨') : '읽을 수 없음'}`)
            trace?.mark('after-snapshot')
        }, SNAP_AFTER_MS)
    }

    /**
     * `Ctrl+L`(0x0C) 을 보낸다 — **기본 경로가 아니다** (`repairSendRedrawKey`, 기본 끔).
     *
     * **"거의 모든 TUI 가 이걸 전체 재렌더로 받는다" 는 틀린 전제였다** (2026-09-11 채증으로 확정).
     * Claude Code 는 이걸 **화면 지우기**로 받는다 — 지운 뒤 자기 입력창만 다시 그리므로
     * 보고 있던 대화가 통째로 스크롤백으로 밀려난다. `.agentdeck-screen.log` 06:04:52→54 의
     * `manual-before`(0~77행 전부 내용) → `manual-after`(73~77행만 남음) 가 그 증거이고,
     * `clear input area row=73/78` 이 73행 아래만 지웠음을 진단 로그가 확인해 준다.
     * 즉 0~72행을 날린 것은 우리 지우기가 아니라 이 키다.
     *
     * 그래서 복구의 기본 수단은 이 키가 아니라 **잔상 지우기 + 크기 정합/흔들기**다.
     * 자세한 근거와 켜는 기준은 `config.ts` 의 `repairSendRedrawKey` 주석에 있다.
     */
    private sendRedrawKey (pane: BaseTabComponent): void {
        const anyPane = pane as any
        if (typeof anyPane.sendInput !== 'function' || !anyPane.session?.open) {
            return
        }
        this.diag(`repair redraw-key ctrl-l`)
        // 사람이 ↻ 를 누른 경로라 조합 중일 일은 사실상 없지만, pty 직접 쓰기는 예외 없이
        // 한 진입점을 지나게 둔다 — 세션이 막 닫혔을 때의 예외도 sendToPane 이 삼킨다.
        this.sendToPane(anyPane, 'redraw-key', () => anyPane.sendInput('\x0c'))
    }

    /**
     * 입력창 영역에 남은 **옛 프레임 잔상만** 지운다 (대화 = 스크롤백은 그대로 둔다).
     *
     * 복구가 계속 실패하던 진짜 이유가 여기 있었다 (2026-09-02 실측).
     * `nudge` 도 `Ctrl+L` 도 하는 일은 "앱아 다시 그려라" 뿐인데, **앱은 자기가 쓰는 자리만 덮는다.**
     * 그래서 옛 폭으로 그려진 줄이 `❯` 자리를 차지하고 있으면 아무도 그걸 못 지운다 —
     * 채증 원문이 그 모양이었다 (`.agentdeck-screen.log` 06:02:27):
     *
     *   72 len=275 "        "   ← 위 테두리가 있어야 할 자리, 공백
     *   73 len=276 "────…"      ← ❯ 자리에 옛 프레임(276) 잔상
     *   74 len=277 "────…"      ← 앱이 새로 그린 아래 테두리(277, 정상)
     *
     * 앱은 이미 277 로 제대로 그리고 있는데 73 행 잔상 때문에 계속 깨짐으로 남았다.
     * `auto-after 아직 깨짐` 이 두 번 연속 찍힌 게 이것이다.
     *
     * 그래서 **터미널 쪽에서 직접 지운다** — 입력창 첫 테두리 행으로 커서를 옮기고
     * `ESC[J`(커서부터 화면 끝까지)로 비운다. 이건 화면만 비우고 스크롤백은 건드리지 않으므로
     * `xterm.reset()`(스크롤백까지 날아감)과 다르다. 커서는 `ESC7`/`ESC8` 로 저장·복원해
     * 앱이 들고 있는 커서 위치와 어긋나지 않게 한다. 지운 뒤 `Ctrl+L` 을 보내면 앱이
     * 자기 UI 를 그 빈 자리에 다시 그린다.
     */
    private clearInputArea (pane: BaseTabComponent, read: { lines: ScreenLine[], cols: number }): boolean {
        if (!canRepairComposer(this.profileForPane(pane)?.id)) {
            return false
        }
        const xterm = (pane as any).frontend?.xterm
        if (!xterm || typeof xterm.write !== 'function') {
            return false
        }
        const lines = read.lines
        const shape = this.profileForPane(pane)?.screenShape
        // 하단 INPUT_TAIL 행 안에서만 본다 — 대화 이력에 남아 있는 옛 입력창까지 지우면 안 된다
        const from = Math.max(0, lines.length - INPUT_TAIL)
        // **잔상이 얹힌 테두리도 테두리로 친다.** 2026-09-09 실사용 스샷의 위 테두리가 바로
        // 그 모양이었는데(가로선 사이에 전각 글자 3개), 순수 가로선만 찾던 옛 코드는 이 행을
        // 못 보고 시작행을 아래 테두리로 잡아 **입력창 아래**를 지웠다 — 잔상은 그대로 남는다.
        const border = (i: number): boolean =>
            isRuleRow(lines[i].text, shape) || isGhostRuleRow(lines[i].text, read.cols, shape)
        let last = -1
        for (let i = lines.length - 1; i >= from; i--) {
            if (border(i)) {
                last = i
                break
            }
        }
        if (last < 0) {
            return false
        }
        // 마지막 테두리에서 위로 INPUT_BLOCK_ROWS 행까지 같은 입력창 블록으로 본다
        let start = last
        for (let i = last - 1; i >= Math.max(from, last - INPUT_BLOCK_ROWS); i--) {
            if (border(i)) {
                start = i
            }
        }
        const row = start + 1
        this.diag(`clear input area row=${row}/${lines.length}`)
        try {
            xterm.write(`7[${row};1H[J8`)
        } catch {
            return false
        }
        return true
    }

    // ---------- 화면 깨짐 자동 감지 ----------

    /**
     * 출력이 잠잠해지면 화면이 온전한지 본다.
     *
     * TUI 는 한 프레임을 여러 번의 write 로 그리므로, 그리는 도중에 읽으면 멀쩡한 화면도
     * 깨져 보인다. 그래서 마지막 출력에서 `SCREEN_CHECK_DEBOUNCE_MS` 만큼 조용해진 뒤에만 본다.
     */
    private scheduleScreenCheck (pane: BaseTabComponent): void {
        // 감지·채증은 복구와 분리한다 — `autoRepairScreen` 이 꺼져 있어도 관측은 계속한다.
        // (2026-09-02: 이 게이트가 채증까지 막아 실사용 재현이 통째로 증거 없이 지나갔다)
        if (!this.screenObservingEnabled()) {
            return
        }
        const prev = this.screenCheckTimers.get(pane)
        if (prev) {
            clearTimeout(prev)
        }
        this.screenCheckTimers.set(pane, setTimeout(() => {
            this.screenCheckTimers.delete(pane)
            this.checkScreen(pane)
        }, SCREEN_CHECK_DEBOUNCE_MS))
    }

    /** 감지·채증이 켜져 있나 — 복구(`autoRepairScreen`)와는 별개다 */
    private screenObservingEnabled (): boolean {
        const cfg = this.config.store.agentDeck
        return cfg.screenWatch !== false || !!cfg.autoRepairScreen
    }

    /** 화면을 판정해 채증하고, 복구가 켜져 있으면 조용히 고친다 */
    private checkScreen (pane: BaseTabComponent): void {
        // 2026-09-13: real logs misclassified Codex's "─ Worked for 1m 29s ─"
        // as a damaged Claude border and ran auto-repair. Do not diagnose or
        // mutate another agent's screen using Claude's composer geometry.
        if (!canRepairComposer(this.profileForPane(pane)?.id)) {
            return
        }
        const cfg = this.config.store.agentDeck
        const read = this.readScreen(pane)
        if (!read) {
            return
        }
        const verdict = judgeScreen(read.lines, read.cols, this.profileForPane(pane)?.screenShape)

        // ---- 관측 (복구와 무관하게 항상) ----
        // 상태가 바뀔 때만 남긴다 — 2초마다 도는 그물이라 매번 찍으면 파일이 같은 줄로 찬다.
        const prevObs = this.screenObs.get(pane)
        const reason = verdict.reasons.join(' / ')
        // 같은 깨짐이 몇 번 연속으로 보였나 — TUI 가 한 프레임을 여러 write 로 그리는 도중을
        // 잡으면 멀쩡한 화면도 한 번은 깨져 보인다. 그 중간 프레임에 손대지 않으려고 센다.
        const streak = verdict.broken ? ((prevObs?.broken ? (prevObs.streak ?? 0) : 0) + 1) : 0
        const changed = !prevObs || prevObs.broken !== verdict.broken || prevObs.reason !== reason
        this.screenObs.set(pane, { broken: verdict.broken, reason, streak })
        if (changed) {
            if (verdict.broken) {
                this.snapshot(pane, `detect 깨짐 ${reason}`)
            } else if (prevObs?.broken) {
                // 우리가 아무것도 안 했는데 스스로 돌아왔다 — 트리거를 가르는 중요한 단서다
                this.snapshot(pane, 'detect 스스로 복구됨')
            }
        }

        if (!verdict.broken) {
            this.refillAutoRepairBudget(pane)
            return
        }
        // 깨진 동안은 온전 시계를 접어 둔다 — 깨짐↔복구가 번갈아 오는 화면에서
        // 옛 시각이 남아 있으면 다음 온전 샘플 한 번에 예산이 되살아난다
        this.autoRepairHealthySince.delete(pane)
        if (!cfg.autoRepairScreen) {
            return
        }
        // 한 번 스친 중간 프레임은 건드리지 않는다 — 2초 그물이므로 기본값 2 는 "2초 넘게
        // 깨진 채로 있다" 는 뜻이다. 예전에 자동복구가 타이핑 중에 튀어나와 체감을 망친 것이
        // 이 조건이 없어서였다 (2026-09-02 항목 27).
        if (streak < (cfg.autoRepairMinStreak ?? 2)) {
            return
        }

        const anyPane = pane as any
        const now = Date.now()
        const last = this.autoRepairAt.get(pane) ?? 0
        const count = this.autoRepairCount.get(pane) ?? 0
        const max = cfg.autoRepairMaxPerTab ?? 5
        const cooldown = cfg.autoRepairCooldownMs ?? 4000

        // 쿨다운/한도에 걸려 아무것도 하지 않을 때는 로그도 남기지 않는다 —
        // 주기 검사가 2초마다 돌므로 판정이 오탐이면 진단 파일이 같은 줄로 가득 찬다
        if (now - last < cooldown) {
            return
        }
        if (max > 0 && count >= max) {
            this.diagOnce(`auto-repair-cap`,
                `screen auto-repair 한도 도달 (${count}/${max}) — 더 고치지 않는다.`
                + ` 사이드바 ↻ 로 직접 복구할 것. 마지막 판정: ${verdict.reasons.join(' / ')}`)
            return
        }
        // **크기가 어긋난 동안에는 손대지 않는다.**
        //
        // 오늘(2026-09-09) 실사용 채증 8건을 갈라 보니 정확히 둘로 나뉜다 —
        //   ⓐ `xterm.cols != pty(sent)` 인 4건(00:46:54 280/283 · 01:13:20 281/279 ·
        //      01:59:08 221/281 · 02:34:21 282/280)은 전부 **리사이즈 중간 프레임**이었다.
        //      화면 덤프는 앱 기준으로 완전히 정상이고(`──(283)/❯/──(283)`) 0~3초 만에
        //      **스스로** 돌아왔다 — Tabby 순정이 pty 까지 맞춘다.
        //   ⓑ 크기가 맞는(281==281) 4건(02:07:45~02:08:01)은 그 탭에서 띄운 자식 프로세스의
        //      stdout(`(node:…) DeprecationWarning`, `Unable to find latest version on Keygen`)이
        //      TUI 프레임을 덮어쓴 **진짜 깨짐**이고 26초를 버텼다. 이쪽만 잔상 지우기로 고쳐진다.
        //
        // 2026-09-02 에 자동복구를 껐던 이유(`fit`+`nudge` 로 실사용 4/4 실패, 화면만 흔들림)가
        // 바로 ⓐ 에 손을 댄 것이었다. 그래서 그 유형은 아예 건드리지 않는다 — 감지·채증은 계속한다.
        const xterm = anyPane.frontend?.xterm
        const xcols = xterm?.cols
        const xrows = xterm?.rows
        if (!sizeInSync(xcols, xrows, anyPane.size?.columns, anyPane.size?.rows)) {
            this.diagOnce('auto-repair-resizing',
                `screen 자동복구 보류 — 크기가 어긋나 있다 (xterm ${xcols}x${xrows}`
                + ` vs pty ${anyPane.size?.columns}x${anyPane.size?.rows}). 리사이즈 중간 프레임은`
                + ` 순정이 곧 맞춘다 — 이 줄은 처음 한 번만 남긴다`)
            return
        }
        this.diag(`screen BROKEN cols=${read.cols}`
            + ` sent=${anyPane.size?.columns}x${anyPane.size?.rows} ${verdict.reasons.join(' / ')}`)
        // 고치기 **전에** 화면 원문을 남긴다 — 복구가 덮어쓰면 증거가 사라진다
        this.snapshot(pane, `auto-before ${verdict.reasons.join(' / ')}`)
        this.autoRepairAt.set(pane, now)
        this.autoRepairCount.set(pane, count + 1)
        this.diag(`screen auto-repair #${count + 1}`)

        // 자동 경로가 하는 일은 **사이드바 ↻ 를 한 번 눌러 주는 것**뿐이다 —
        // 잔상 지우기(`clearInputArea`) → `Ctrl+L`. 크기는 위 가드에서 이미 맞다고 확인했으니
        // `fit`·`syncPtySize`·`nudgePtyRedraw` 는 태우지 않는다. 그 셋이 화면을 흔들어
        // 체감을 망친 범인이었다("최대화됐다 다시 깨지네", 2026-09-02).
        // 스크롤백을 지우는 hard 복구도 하지 않는다 — 자동 경로에서 오탐 한 번에 지난 대화가
        // 날아가면 손해가 크다(`repairHard` 는 사람이 켤 때만).
        //
        // 잔상을 지우면 앱이 **자기 렌더 주기에** 그 자리를 다시 그린다 — 앱은 자기가 쓰는
        // 자리만 덮으므로, 지우지 않으면 옛 줄이 `❯` 자리를 계속 차지한다.
        // `Ctrl+L` 로 재렌더를 재촉하던 것은 기본에서 뺐다 — Claude Code 가 그걸 화면 지우기로
        // 받아 대화를 밀어냈다(`sendRedrawKey` 주석). 자동 경로에서 그게 터지면 더 나쁘다.
        this.clearInputArea(pane, read)
        if (cfg.repairSendRedrawKey === true) {
            setTimeout(() => this.sendRedrawKey(pane), REPAIR_REDRAW_DELAY_MS)
        }
        // 복구가 실제로 먹혔는지 같은 파일에 이어 남긴다 — 앱이 다시 그릴 시간을 준다
        setTimeout(() => {
            const after = this.readScreen(pane)
            const still = after ? judgeScreen(after.lines, after.cols, this.profileForPane(pane)?.screenShape) : null
            this.snapshot(pane, `auto-after ${still ? (still.broken ? '아직 깨짐: ' + still.reasons.join(' / ') : '복구됨') : '읽을 수 없음'}`)
        }, SNAP_AFTER_MS)
    }

    /**
     * 화면이 `AUTO_REPAIR_REFILL_MS` 넘게 온전하면 이 탭의 자동복구 예산을 되돌린다.
     *
     * 되돌리는 곳이 아예 없던 것이 결함이었다 — `autoRepairCount` 는 pane 이 살아 있는 동안
     * 단조증가만 해서, 며칠 켜 두는 탭은 `autoRepairMaxPerTab`(기본 3)회를 쓰고 나면 그 뒤의
     * 모든 깨짐을 방치했다. 반대로 온전해지자마자 되돌리면 예산이 사실상 무한이 되므로
     * (깨짐 → 복구 → 온전 → 깨짐 … 이 그대로 반복된다) **오래 온전할 때만** 되돌린다.
     */
    private refillAutoRepairBudget (pane: BaseTabComponent): void {
        if (!this.autoRepairCount.get(pane)) {
            this.autoRepairHealthySince.delete(pane)
            return
        }
        const now = Date.now()
        const since = this.autoRepairHealthySince.get(pane)
        if (!since) {
            this.autoRepairHealthySince.set(pane, now)
            return
        }
        if (now - since < AUTO_REPAIR_REFILL_MS) {
            return
        }
        this.autoRepairCount.delete(pane)
        this.autoRepairHealthySince.delete(pane)
        resetDiagOnce('auto-repair-cap')
        this.diag(`screen auto-repair 예산 회복`
            + ` (화면이 ${Math.round((now - since) / 1000)}초 동안 온전했다)`)
    }

    /** 활성 탭의 pane 들을 한 번씩 본다 (주기 그물) */
    private sweepScreens (): void {
        if (!this.enabled || !this.screenObservingEnabled()) {
            return
        }
        const tab = this.app.activeTab
        if (!tab) {
            return
        }
        const anyTab = tab as any
        const panes: BaseTabComponent[] = typeof anyTab.getAllTabs === 'function'
            ? anyTab.getAllTabs()
            : [tab]
        for (const pane of panes) {
            this.checkScreen(pane)
        }
    }

    /** 판정에 넣을 화면 줄과 폭 — 숨겨진 탭이나 아직 안 붙은 프론트엔드는 건너뛴다 */
    private readScreen (pane: BaseTabComponent): { lines: ScreenLine[], cols: number } | null {
        const anyPane = pane as any
        const xterm = anyPane.frontend?.xterm
        const buf = xterm?.buffer?.active
        if (!buf || typeof buf.getLine !== 'function' || !(xterm.cols > 1)) {
            return null
        }
        // 숨겨진 탭은 컨테이너 폭이 0 이라 xterm 이 1열로 줄어 있다 — 판정 대상이 아니다
        const host = xterm.element?.parentElement
        if (!host?.clientWidth) {
            return null
        }
        const lines: ScreenLine[] = []
        // 읽는 도중에 버퍼가 갈릴 수 있다 — `xterm.reset()`(repairHard)·프론트엔드 교체가 그렇다.
        // 이 함수는 2초 그물에서 불리므로 예외가 새면 그 인터벌이 통째로 죽는다.
        // 못 읽었으면 판정을 건너뛰는 것이 맞다.
        try {
            for (let y = buf.baseY; y <= buf.baseY + xterm.rows - 1; y++) {
                const line = buf.getLine(y)
                lines.push({
                    text: line?.translateToString(false) ?? '',
                    wrapped: !!line?.isWrapped,
                })
            }
        } catch {
            return null
        }
        return { lines, cols: xterm.cols }
    }

    /**
     * 화면 원문을 통째로 남긴다 — 깨짐 채증용.
     *
     * 판정 이유만 남기면 다음에 또 "왜 그렇게 됐는지" 를 추측하게 된다. 행 번호·wrap 플래그·
     * 길이까지 그대로 적어 두면 `❯` 가 어느 행에 있었는지, 테두리가 몇 칸이었는지가 확정된다.
     * before/after 를 짝으로 남기므로 복구가 실제로 먹혔는지도 이 파일에서 바로 갈린다.
     */
    private snapshot (pane: BaseTabComponent, tag: string): void {
        const read = this.readScreen(pane)
        if (!read) {
            return
        }
        const anyPane = pane as any
        const xterm = anyPane.frontend?.xterm
        const head = `\n===== ${new Date().toISOString()} ${tag}`
            + ` cols=${read.cols} rows=${xterm?.rows} sent=${anyPane.size?.columns}x${anyPane.size?.rows}`
            + ` title=${JSON.stringify(pane.title ?? '')} =====`
        const body = read.lines
            .map((l, i) => ({ i, t: l.text.replace(/\s+$/, ''), w: l.wrapped }))
            .filter(l => l.t)
            .map(l => `${String(l.i).padStart(3)} w=${l.w ? 1 : 0} len=${l.t.length} ${JSON.stringify(l.t)}`)
        appendScreenLog([head, ...body, ''].join('\n'))
    }

    // ---------- 세션 감시 ----------

    /**
     * 탭(그리고 그 안의 모든 pane)의 PTY 출력을 구독한다.
     *
     * TerminalDecorator 는 프론트엔드 첫 리사이즈 시점에만 붙어서 복원된 탭 등을
     * 놓치는 경우가 있다. 이쪽은 탭이 목록에 들어오는 즉시 붙으므로 그 빈틈을 메운다.
     * 같은 출력을 decorator 와 둘 다 먹어도 상태 설정이 멱등이라 결과는 같다.
     */
    private watchTab (root: BaseTabComponent): void {
        const anyRoot = root as any

        if (!this.watched.has(root)) {
            this.watched.add(root)

            // 제목은 래퍼 탭이 자식 것을 위임받으므로 여기서 받는 게 가장 확실하다
            if (anyRoot.titleChange$) {
                anyRoot.titleChange$.subscribe((title: string) => {
                    // 제목이 바뀌는 순간은 "셸에서 방금 에이전트를 띄웠다" 일 수 있다 — 그때 한 번 더 본다
                    // (TTL 로 묶여 있어 제목이 자주 바뀌어도 프로세스 트리를 매번 묻지는 않는다)
                    void this.probeAgent(root, 'title-change')
                    applyTitle(this.status, root, title, this.config.store.agentDeck.autoDetect,
                        this.profileForTab(root))
                })
            }
            if (anyRoot.title) {
                applyTitle(this.status, root, anyRoot.title, this.config.store.agentDeck.autoDetect,
                    this.profileForTab(root))
            }
            // 나중에 분할로 추가되는 pane 도 따라간다
            if (anyRoot.tabAdded$) {
                anyRoot.tabAdded$.subscribe((pane: BaseTabComponent) => this.watchPane(root, pane))
            }
        }

        // pane 은 래퍼보다 늦게 붙는 경우가 있으므로 호출될 때마다 다시 훑는다
        // (래퍼만 보고 한 번에 끝내면 목록에 먼저 들어온 빈 SplitTab 을 잡고 끝나버린다)
        const panes: BaseTabComponent[] = typeof anyRoot.getAllTabs === 'function'
            ? anyRoot.getAllTabs()
            : [root]
        this.diag(`watchTab panes=${panes.length}`)
        for (const pane of panes) {
            this.watchPane(root, pane)
        }

        // 래퍼(SplitTabComponent)가 자식보다 먼저 목록에 들어오는 경우가 있다. 그때 여기서
        // panes=0 을 보고 물러나면, 자식이 붙어도 다시 훑을 계기가 없어 그 탭은 영영
        // 감시 밖에 남는다 — 상태 감지·Enter 라벨·화면 검사가 전부 안 돈다
        // (2026-09-01 실측: 기동 직후 첫 탭에서 `watchTab panes=0` 만 두 번 찍히고
        //  `session bind` 가 한 번도 없었다). 그래서 비어 있으면 잠시 뒤 다시 본다.
        if (!panes.length) {
            const tries = (this.emptyTabRetries.get(root) ?? 0) + 1
            this.emptyTabRetries.set(root, tries)
            if (tries <= EMPTY_TAB_RETRY_MAX) {
                setTimeout(() => {
                    if (this.app.tabs.includes(root)) {
                        this.watchTab(root)
                    }
                }, EMPTY_TAB_RETRY_MS)
            }
        }
    }

    private watchPane (root: BaseTabComponent, pane: BaseTabComponent): void {
        if (this.watchedPanes.has(pane)) {
            return
        }
        this.watchedPanes.add(pane)
        this.diag(`watchPane ${(pane as any).constructor?.name}`)
        const anyPane = pane as any
        const bind = (session: any) => {
            this.installCodexCursorFix(pane)
            if (!session || !session.output$) {
                return
            }
            // pty 가 어떤 폭으로 태어났는지 남긴다. Tabby 는 프론트엔드의 **첫** resize$ 값으로
            // 세션을 스폰하므로(tabby-local: initializeSession(this.size...) -> spawn cols),
            // 그 스냅샷이 우리 레이아웃보다 이르면 pty 만 옛 폭으로 굳는다 — 그 순간이 여기 찍힌다.
            this.diag(`session bind`
                + ` xterm=${anyPane.frontend?.xterm?.cols}x${anyPane.frontend?.xterm?.rows}`
                + ` paneSize=${anyPane.size?.columns}x${anyPane.size?.rows}`)
            // 어떤 에이전트가 도는 탭인지 여기서 한 번 알아낸다 — 출력마다 물어볼 수 없는 값이다
            // (getChildProcesses 는 OS 호출). 아직 셸만 떠 있으면 unknown 이고, 그때는
            // 합집합 패턴으로 판정하다가 제목이 바뀌는 시점에 다시 본다.
            void this.probeAgent(root, 'session-bind')
            session.output$.subscribe((data: string) => {
                // 아직 못 알아낸 탭만 다시 물어본다 — **셸을 먼저 열고 나중에 `claude` 를 치는 흐름**이
                // 가장 흔한데, 그때 제목이 안 바뀌면 session-bind 때의 unknown 이 영영 굳는다
                // (2026-09-08 실측: 자식 프로세스가 codex.exe 인데 진단은 `id=unknown` 그대로).
                // TTL(AGENT_PROBE_TTL_MS)이 조회 빈도를 막고, 한 번 알아낸 탭은 이 갈래를 타지 않는다
                this.outputHits++
                const observed = this.paneAgents.get(pane)
                if ((this.tabAgents.get(root) ?? 'unknown') === 'unknown'
                    || (observed?.session === anyPane.session && observed?.tracker.id === 'unknown')) {
                    void this.probeAgent(root, 'output')
                }
                applyOutput(this.status, root, pane, data, this.config.store.agentDeck.autoDetect,
                    this.profileForTab(root))
                // 화면에 찍힌 파일 경로를 주워 미리보기 패널의 최근 목록에 쌓는다.
                // 에이전트를 가리지 않는 경로다 — Claude·Codex·Gemini 가 모두 만진 파일을 찍는다.
                // 조각마다 정규식을 돌리지 않는다 (패널이 모아서 400ms 마다 한 번 훑는다)
                if (this.view && this.config.store.agentDeck.viewerScrape) {
                    this.view.noteOutput(root, data)
                }
                // cwd 캐시는 미리보기 패널 설정(viewerScrape) 안에 있으면 안 된다 — 사이드바
                // 프로젝트 그룹(group.ts)도 이 캐시를 원천으로 쓰므로, 패널 옵션을 끈 사람은
                // 모든 탭이 `기타` 그룹으로 떨어진다. TTL(CWD_TTL_MS=3초)이 조회 빈도를 막으니
                // 출력 조각마다 불려도 비용은 WeakMap 조회 한 번이다.
                this.touchCwd(root, pane)
                // 출력이 멈춘 뒤 화면이 온전한지 본다 (그리는 도중에 읽으면 멀쩡한 화면도 깨져 보인다)
                this.scheduleScreenCheck(pane)
            })
        }
        bind(anyPane.session)
        if (anyPane.sessionChanged$) {
            anyPane.sessionChanged$.subscribe((session: any) => bind(session))
        }

        // 프론트엔드가 붙는 도중에 우리가 폭을 바꿨으면 그 변경은 유실될 수 있다
        // (Tabby 는 attach() 맨 끝에서야 ResizeObserver 를 건다) — 준비되면 fit 한 번으로 깨워 준다.
        // 여기서 하는 건 `fitAddon.fit()` 뿐이다. 그 뒤는 순정 경로가 이어받는다
        // (fit → xterm onResize → Tabby 가 session.resize). 우리가 pty 에 직접 쏘지 않는다.
        if (anyPane.frontendReady$) {
            anyPane.frontendReady$.subscribe(() => {
                this.installCodexCursorFix(pane)
                this.scheduleRefit()
                this.announceSizeOnOpen(pane)
                // 작업 폴더는 **태어날 때 한 번** 물어 둔다. 출력 구독에만 맡기면 아무것도
                // 찍지 않는 탭(열어 두고 안 쓰는 셸)이 영영 `기타` 그룹에 남는다.
                this.touchCwd(root, pane)
            })
        }
        // frontendReady 는 replay 가 없는 맨 Subject 라, 복원된 탭의 프론트엔드가 우리보다
        // 먼저 붙어버리면 위 구독은 영영 못 받는다. 이벤트와 무관하게 한 번 더 예약한다 —
        // 같은 크기를 두 번 알려도 SIGWINCH 가 안 나므로 무해하다.
        this.announceSizeOnOpen(pane)
    }

    private installCodexCursorFix (pane: BaseTabComponent): void {
        installCodexKeys((pane as any).frontend,
            () => process.platform === 'win32' && this.profileForPane(pane)?.id === 'codex',
            data => this.sendToPane(pane as any, 'codex-question-key', () => (pane as any).sendInput(data)))
        installCodexWheel((pane as any).frontend,
            () => process.platform === 'win32' && this.profileForPane(pane)?.id === 'codex',
            data => (pane as any).sendInput(data))
        installCursorVisibilityFix((pane as any).frontend,
            data => {
                this.observePaneAgent(pane, data)
                return process.platform === 'win32' && this.profileForPane(pane)?.id === 'codex'
            },
            () => this.diag('codex cursor: repaired non-private CSI 25 visibility sequence'),
            summary => this.diag(`cursor-path tab=${JSON.stringify(pane.title)} ${summary}`))
    }

    private observePaneAgent (pane: any, data: string): void {
        let state = this.paneAgents.get(pane)
        if (!state || state.session !== pane.session) {
            state = { session: pane.session, tracker: new TerminalAgentTracker() }
            this.paneAgents.set(pane, state)
        }
        state.tracker.write(data)
    }

    /**
     * 탭이 열린 뒤 몇 차례, **지금 xterm 이 쓰는 크기를 pty 에 알려준다.**
     *
     * 순정이 유일하게 못 메우는 구멍(새 탭에서 pty 만 좁게 태어남)을 메우는 최소 개입이다.
     * 자세한 근거와 실측은 `TAB_OPEN_ANNOUNCE_MS` 주석에 있다.
     *
     * 하지 않는 것 — xterm 은 건드리지 않고(fit 도 resize 도), 폭을 흔들지 않으며,
     * 감시 루프도 돌지 않는다. 그 셋이 예전에 화면을 깨뜨린 장본인이다.
     */
    private announceSizeOnOpen (pane: BaseTabComponent): void {
        const anyPane = pane as any
        for (const delay of TAB_OPEN_ANNOUNCE_MS) {
            setTimeout(() => {
                const x = anyPane.frontend?.xterm
                const session = anyPane.session
                if (!session?.open || typeof session.resize !== 'function' || !(x?.cols > 1)) {
                    return
                }
                const prev = anyPane.size
                if (prev?.columns !== x.cols || prev?.rows !== x.rows) {
                    this.diag(`announce size ${prev?.columns}x${prev?.rows}`
                        + ` -> ${x.cols}x${x.rows} (+${delay}ms)`)
                }
                try {
                    session.resize(x.cols, x.rows)
                    anyPane.size = { columns: x.cols, rows: x.rows }
                } catch (e: any) {
                    // 세션이 막 닫혔다 — 흔한 사유지만 그 밖의 실패도 여기로 오므로 남긴다
                    diagCatch('announce-size resize', e)
                }
            }, delay)
        }
    }

    // 흔들기 장치는 전부 폐지했다 (2026-09-02).
    //
    // 여기에 있던 것들 — `scheduleWindowKick`(기동 시 창 복원→최대화), `scheduleRedrawKick`,
    // `kickPtySize`(탭당 한 번 cols-1 ↔ cols) — 는 모두 "순정이 크기를 못 맞춘다" 는 전제에서
    // 나온 우회책이었다. 전제가 틀렸다: Tabby 는 xterm `ResizeObserver` → `fitAddon.fit()` →
    // `session.resize()` 로 스스로 맞춘다. 우리가 폭만 정해 주면 된다.
    // 이 흔들기들은 순정 수렴과 경쟁하며 프레임을 반쯤 그린 상태를 남겨 화면을 깨뜨렸다.
    // 수동 복구(`repairPane`)는 여전히 흔든다 — 거기는 사용자가 명시로 요청한 경로다.

    /**
     * 우리 새 탭 키와 겹치는 순정 `new-tab` 키만 걷어낸다. 기본은 Ctrl+T / ⌘+T다.
     *
     * 순정 처리자(`tabby-local` LocalTerminalModule → `terminal.openTab()`)는 같은 `hotkey$` 를
     * 구독하고 있어서, 두 id 에 같은 키가 매여 있으면 HotkeysService 가 하나만 고르긴 하지만
     * (길이 같은 후보 중 config 삽입 순서 앞의 것 — `ensurePasteHotkey` 주석) 그게 어느 쪽일지는
     * 저장 순서에 달려 있다. 표에서 떼는 것이 유일하게 확실한 방법이다.
     *
     * `claimNewTabKey: false` 면 건드리지 않는다 — 그때는 우리 핸들러도 무시하므로(hotkey$ 구독)
     * 순정 그대로다. 게이트를 켰다 끄면 뗀 키는 되살리지 않는다: 사람이 손으로 바꾼 표를 우리가
     * 다시 덮는 것이 더 나쁘고, 설정 창에서 한 줄이면 복구된다.
     */
    private ensureNewTabHotkey (): void {
        const hotkeys = this.config.store.hotkeys
        if (!hotkeys || this.config.store.agentDeck.claimNewTabKey === false) {
            return
        }
        const ours: string[] = Array.isArray(hotkeys['agentdeck-new-tab']) ? hotkeys['agentdeck-new-tab'] : []
        const theirs: string[] = Array.isArray(hotkeys['new-tab']) ? hotkeys['new-tab'] : []
        const kept = theirs.filter(k => !ours.includes(k))
        if (kept.length !== theirs.length) {
            hotkeys['new-tab'] = kept
            this.config.save()
            this.diag(`hotkeys new-tab claimed: theirs=${JSON.stringify(theirs)} -> ${JSON.stringify(kept)} ours=${JSON.stringify(ours)}`)
        }
    }

    private ensureSplitHotkeys (): void {
        const hotkeys = this.config.store.hotkeys
        if (!hotkeys) { return }
        let changed = false
        for (const [id, oldKey, key] of [
            ['split-right', 'Ctrl-Shift-S', 'Ctrl-S'],
            ['split-bottom', 'Ctrl-Shift-D', 'Ctrl-D'],
        ]) {
            const current = hotkeys[id]
            // Preserve custom bindings and explicitly disabled shortcuts.
            if (Array.isArray(current) && current.length === 1 && current[0] === oldKey) {
                hotkeys[id] = [key]
                changed = true
            }
        }
        if (changed) { this.config.save() }
    }

    /**
     * 순정 `close-pane`(포커스된 분할 패널 닫기)이 비어 있으면 `closePaneKey` 로 채운다.
     *
     * 왜 필요한가 — Tabby 기본표는 `close-pane: []` 로 온다(config.yaml hotkeys). 패널을 닫는
     * 다른 길은 우클릭 컨텍스트 메뉴인데 agentdeck 이 짧은 우클릭을 복사/붙여넣기로 가져가
     * (`claimRightClick`) 길게 눌러야만 메뉴가 뜬다. 셸에 `exit` 를 치는 방법만 남는다.
     *
     * 채우기만 하고 빼앗지는 않는다 — `ensureNewTabHotkey` 와 달리 순정 처리자와 경쟁하는
     * 것이 아니라 순정 처리자를 **쓰는** 것이므로 표에 키를 넣어 주면 끝이다. 사람이 이미
     * 무언가 매어 두었으면(비어 있지 않으면) 그대로 둔다. `closePaneKey` 가 빈 문자열이면 건너뛴다.
     */
    private ensureClosePaneHotkey (): void {
        const hotkeys = this.config.store.hotkeys
        const key = String(this.config.store.agentDeck.closePaneKey ?? '').trim()
        if (!hotkeys || !key) {
            return
        }
        const theirs: string[] = Array.isArray(hotkeys['close-pane']) ? hotkeys['close-pane'] : []
        if (theirs.length > 0) {
            return
        }
        hotkeys['close-pane'] = [key]
        this.config.save()
        this.diag(`hotkeys close-pane filled: ${JSON.stringify(hotkeys['close-pane'])}`)
    }

    /**
     * 우리 복구 키와 겹치는 순정 `rename-tab` 키만 걷어낸다. 기본은 Ctrl+R이다.
     *
     * 방식과 이유는 `ensureNewTabHotkey` 와 같다 — 같은 키가 두 id 에 매여 있으면 어느 쪽이
     * 발화할지 저장 순서에 달리므로 표에서 떼는 것만이 확실하다. 탭 이름 바꾸기는 사이드바
     * 더블클릭이 주 경로라 키를 잃어도 아쉽지 않다.
     *
     * 옛 기본값 이관 — 2026-09-17 전에는 기본이 `Ctrl-Shift-U` 였고 Tabby 는 기본값도 config.yaml 에
     * 그대로 써 두므로, 사람이 손대지 않은 표에도 `['Ctrl-Shift-U']` 가 남아 있다. **정확히 옛 기본값
     * 하나뿐일 때만** 새 기본값으로 바꾼다 — 다른 값이면 사람이 고른 것이니 건드리지 않는다.
     *
     * `claimRepairKey: false` 면 건드리지 않고 우리 핸들러도 무시한다(hotkey$ 구독). 게이트를 켰다
     * 끄면 뗀 키는 되살리지 않는다 — `ensureNewTabHotkey` 와 같은 판단.
     */
    private ensureRepairHotkey (): void {
        const hotkeys = this.config.store.hotkeys
        if (!hotkeys || this.config.store.agentDeck.claimRepairKey === false) {
            return
        }
        let changed = false
        const cur: string[] = Array.isArray(hotkeys['agentdeck-repair']) ? hotkeys['agentdeck-repair'] : []
        if (cur.length === 1 && cur[0] === 'Ctrl-Shift-U') {
            hotkeys['agentdeck-repair'] = ['Ctrl-R']
            changed = true
        }
        const ours: string[] = Array.isArray(hotkeys['agentdeck-repair']) ? hotkeys['agentdeck-repair'] : []
        const theirs: string[] = Array.isArray(hotkeys['rename-tab']) ? hotkeys['rename-tab'] : []
        const kept = theirs.filter(k => !ours.includes(k))
        if (kept.length !== theirs.length) {
            hotkeys['rename-tab'] = kept
            changed = true
        }
        if (changed) {
            this.config.save()
            this.diag(`hotkeys repair claimed: ours=${JSON.stringify(ours)} rename-tab=${JSON.stringify(theirs)} -> ${JSON.stringify(kept)}`)
        }
    }

    /**
     * Ctrl+V 를 **핫키 테이블에서 걷어낸다** (실제 처리는 claimCtrlVKey 가 한다).
     *
     * 예전에는 여기서 `agentdeck-paste` 에 Ctrl-V 를 등록했는데, 그러면 한 번 눌러 두 번 붙는
     * 경우가 남았다. Tabby 는 같은 keydown 을 **두 경로**로 HotkeysService 에 밀어 넣기 때문이다 —
     * xterm 의 커스텀 키 핸들러(`tabby-terminal/dist/index.js:40789` keyboardEventHandler →
     * `hotkeysService.pushKeyEvent`)와, document 에 걸린 core 리스너(`tabby-core:21425`).
     * `pushKeyEvent` 앞에 `timeStamp` 중복 가드가 있지만(`tabby-core:21451`) 그건 **같은**
     * 이벤트 객체일 때만 먹고, 두 경로가 서로 다른 이벤트(keydown/keyup 등)로 들어오면
     * `emitHotkeyOn` 이 두 번 나간다(실측: hotkey-paste 가 1ms 간격 2회, `.agentdeck-diag.log`).
     *
     * 그래서 핫키에 기대지 않고 캡처 단계에서 직접 한 번만 처리한다 — 우클릭을 claimRightClick
     * 으로 가져온 것과 같은 이유·같은 방식이다. 순정 `paste` 쪽에 Ctrl-V 가 남아 있어도 캡처가
     * 먼저 먹고 전파를 끊으므로 발화하지 않지만, 설정 화면이 헷갈리지 않게 양쪽 모두에서 뺀다.
     *
     * 대가: 터미널 앱에 리터럴 Ctrl+V(0x16, quoted-insert)를 보낼 수 없다.
     * 그게 필요하면 `agentDeck.claimCtrlV: false`. 그때도 **핫키 회수는 그대로 한다** —
     * 이유는 본문 주석(핫키에 남기면 붙여넣기가 먼저 발화해 0x16 이 PTY 에 닿지 못한다).
     */
    private ensurePasteHotkey (): void {
        const hotkeys = this.config.store.hotkeys
        if (!hotkeys) {
            return
        }
        let changed = false

        // 옛 이름(workdeck-*)으로 저장된 핫키가 config.yaml 에 남아 있으면 Ctrl-V 가 그쪽에
        // 먼저 매칭돼 우리 핸들러가 통째로 죽는다 — HotkeysService.matchActiveHotkey 는
        // 길이가 같은 후보 중 config 삽입 순서로 앞선 것 하나만 고르고, 옛 항목이 먼저 저장돼 있다
        // (tabby-core/dist/index.js:21558 matches.sort → matches[0].id).
        for (const legacy of ['workdeck-paste', 'workdeck-newline', 'workdeck-toggle']) {
            if (legacy in hotkeys) {
                delete hotkeys[legacy]
                changed = true
            }
        }

        // 지난 버전이 넣어둔 Ctrl-V 를 회수한다. 남겨두면 캡처 경로와 겹쳐 다시 2중이 될 수 있다.
        //
        // **여기에 `claimCtrlV` 게이트를 두면 안 된다** — 2026-09-08 에 "설정을 꺼도 회수가 도니까
        // 갭이다" 로 보고 게이트를 넣어봤다가 되돌렸다. 그 설정의 목적은 *리터럴* Ctrl+V(0x16,
        // quoted-insert)를 터미널 앱에 흘리는 것이고, 순정 `hotkeys.paste` 에 Ctrl-V 가 남아 있으면
        // HotkeysService 가 붙여넣기를 먼저 발화해 **0x16 이 PTY 에 영영 닿지 않는다**. 즉 게이트를
        // 넣는 순간 그 설정이 아무 일도 못 하게 된다. 꺼둔 상태에서 붙여넣기는 순정
        // `Ctrl+Shift+V`·`Shift+Insert` 나 우클릭으로 한다 (README `키` 절에 그대로 적혀 있다).
        //
        // 되돌려도 잃는 것이 없다 — `claimCtrlV` 를 다시 켜면 붙여넣기는 캡처 경로가 처리하므로
        // 핫키 테이블이 비어 있어도 Ctrl+V 가 그대로 동작한다.
        for (const id of ['agentdeck-paste', 'paste']) {
            const keys: string[] = Array.isArray(hotkeys[id]) ? hotkeys[id] : []
            if (keys.includes('Ctrl-V')) {
                hotkeys[id] = keys.filter(k => k !== 'Ctrl-V')
                changed = true
            }
        }

        if (changed) {
            this.config.save()
        }
        this.diag(`hotkeys paste=${JSON.stringify(hotkeys.paste)} `
            + `agentdeck-paste=${JSON.stringify(hotkeys['agentdeck-paste'])} `
            + `legacy=${Object.keys(hotkeys).filter(k => k.startsWith('workdeck')).join(',') || 'none'}`)
    }

    /**
     * Ctrl+V 를 document **캡처 단계**에서 한 번만 처리한다.
     *
     * 캡처는 xterm 의 textarea 리스너보다도 먼저 돌기 때문에, 여기서 전파를 끊으면
     * 그 뒤에 있는 경로(xterm 커스텀 키 핸들러 → pushKeyEvent, core 의 document 리스너,
     * xterm 이 Ctrl+V 를 0x16 으로 바꿔 PTY 에 흘리는 기본 동작, 브라우저 네이티브 paste)가
     * 통째로 죽는다. 몇 개가 겹쳐 걸려 있든 붙여넣기는 정확히 한 번이 된다 —
     * 핫키로 받던 시절 남아 있던 2중 입력의 해법이다(ensurePasteHotkey 주석에 원인).
     *
     * 단, 설정 화면 같은 **평범한 입력 필드**에서는 손대지 않는다. 거기서는 Ctrl+V 가
     * 브라우저 기본 붙여넣기여야 하고, 우리가 가로채면 아예 못 붙여넣게 된다.
     */
    private claimCtrlVKey (): void {
        document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (!this.config.store.agentDeck.claimCtrlV) {
                return
            }
            if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                return
            }
            // 한글 입력 상태에서는 key 가 'ㅍ' 로 오기도 한다 — 물리 키(code)를 같이 본다
            if ((event.key || '').toLowerCase() !== 'v' && event.code !== 'KeyV') {
                return
            }
            if (this.isPlainInput(event.target) || this.isDeckUiKey(event.target)) {
                return
            }
            event.preventDefault()
            event.stopPropagation()
            this.zone.runOutsideAngular(() => this.doPaste('ctrl-v'))
        }, true)
    }

    /**
     * `Ctrl+W` — 지금 탭을 닫는다. **`keyboardNav` 에 매달려 있다**(`keyboardCloseTab` 주석).
     *
     * 핫키(`hotkeys` 테이블)로 두지 않은 이유가 이 기능의 핵심이다. Tabby 핫키는 **등록되어
     * 있는 것만으로 키를 먹는다** — 우리 처리부에서 설정을 보고 no-op 하더라도 키는 이미
     * 터미널에 닿지 못한다. 그런데 셸·에이전트 CLI 에서 `Ctrl+W` 는 **앞 단어 지우기**(0x17)로
     * 늘 쓰는 키다. 즉 "설정을 껐는데 Ctrl+W 가 죽어 있다" 가 되는데, 그건 이 기능을 끈 사람에게
     * 가장 나쁜 결과다. 캡처 리스너로 두면 **우리가 안 잡을 때 키가 아무 손상 없이 흐른다**.
     * (`claimCtrlVKey` 가 캡처로 간 이유는 달랐다 — 핫키 경로의 2중 발화. 결론만 같다.)
     *
     * 그래서 `preventDefault` 는 **닫을 탭이 실제로 정해졌을 때만** 한다. 고르는 규칙은
     * `nav.ts` 의 `pickCloseTarget` 이고(목록이 키보드를 가졌으면 포커스 줄, 아니면 활성 탭),
     * 그 함수가 `null` 을 주는 경우 — 그룹 헤더 포커스, 이미 닫힌 탭 — 에는 키를 흘린다.
     *
     * 설정 화면 같은 보통 입력 필드(`isPlainInput`)에서도 비켜 준다. 사이드바 안에서 난 키는
     * **목록이 키보드를 가진 때만** 받는다(`isDeckUiKey`) — 검색창은 `isPlainInput` 이 먼저
     * 걸러내고, 나머지(버튼 등)에서 온 `Ctrl+W` 는 우리 것이 아니다.
     *
     * 닫기는 사이드바 `✕` 와 **같은 경로**다 — `closeTab(tab, true)` 이므로 돌아가는 프로세스가
     * 있으면 Tabby 가 평소처럼 확인을 띄운다. 여기서 그 확인을 건너뛰면 키 하나로 세션이
     * 사라진다(에이전트가 일하는 중일 수도 있다).
     */
    private claimCtrlWKey (): void {
        document.addEventListener('keydown', (event: KeyboardEvent) => {
            const cfg = this.config.store.agentDeck
            if (!this.enabled || cfg.keyboardNav === false || cfg.keyboardCloseTab === false) {
                return
            }
            if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                return
            }
            // 한글 입력 상태에서는 key 가 'ㅈ' 로 온다 — 물리 키(code)를 같이 본다 (claimCtrlVKey 와 같은 이유)
            if ((event.key || '').toLowerCase() !== 'w' && event.code !== 'KeyW') {
                return
            }
            if (this.isPlainInput(event.target)) {
                return
            }
            const inList = this.navMode === 'list'
            if (!inList && this.isDeckUiKey(event.target)) {
                return
            }
            const tab = pickCloseTarget({
                inList,
                focus: this.navFocus,
                active: this.app.activeTab ?? null,
                tabs: this.app.tabs,
            })
            if (!tab) {
                this.diag(`ctrl-w skip inList=${inList} focus=${this.navFocus?.kind ?? 'none'}`)
                return
            }
            event.preventDefault()
            event.stopPropagation()
            this.diag(`ctrl-w close inList=${inList} tabs=${this.app.tabs.length}`)
            this.zone.run(() => { void this.app.closeTab(tab, true) })
        }, true)
    }

    /**
     * Home / End 를 Tabby 핫키 테이블에서 걷어내 xterm 순정 경로로 돌려준다.
     *
     * 증상: 한글 마지막 음절이 조합 중일 때 Home/End 를 누르면 그 음절이 **커서를 따라간다**
     * (2026-09-08 사용자 보고). 방향키는 멀쩡하다 — 그 차이가 곧 원인이다.
     *
     * 방향키는 핫키가 아니라서 xterm 의 키 경로를 그대로 탄다. 거기서는 조합 중에 아무 키나
     * 들어오면 `CompositionHelper.keydown` 이 `_finalizeComposition(false)` 로 조합을
     * **동기 전송**하고(`tabby-terminal/dist/index.js:44098`, `:44120` triggerDataEvent) 그다음
     * 방향키를 보낸다 — 글자 먼저, 이동 나중이라 순서가 맞는다.
     *
     * Home/End 는 그 경로를 못 탄다. Tabby 가 `hotkeys.home` / `hotkeys.end` 로 선점해서
     * `tabby-local/dist/index.js:613` 이 `sendInput('[H')` 를 **즉시** 쏘기 때문이다.
     * xterm 을 거치지 않으니 조합 확정은 `compositionend` 경로로 밀리는데, 그쪽
     * `_finalizeComposition(true)` 는 `setTimeout(..., 0)` 로 **비동기 전송**이다
     * (`tabby-terminal/dist/index.js:44110`). 결국 커서 이동이 먼저 나가고 음절이 한 틱 뒤에
     * 도착한다 — 앱은 옮겨간 자리에 글자를 찍는다.
     *
     * 그래서 고치는 방법은 핸들러를 더 얹는 게 아니라 **핫키를 놓아주는 것**이다. 비워두면
     * xterm 이 Home/End 를 방향키와 똑같이 처리한다(조합 확정 → 키 전송). 되돌리려면
     * `agentDeck.releaseHomeEnd: false` 후 설정에서 다시 지정하면 된다.
     */
    private releaseHomeEndHotkey (): void {
        if (!this.config.store.agentDeck.releaseHomeEnd) {
            return
        }
        const hotkeys = this.config.store.hotkeys
        if (!hotkeys) {
            return
        }
        let changed = false
        for (const id of ['home', 'end']) {
            const keys: string[] = Array.isArray(hotkeys[id]) ? hotkeys[id] : []
            const kept = keys.filter(k => k !== 'Home' && k !== 'End')
            if (kept.length !== keys.length) {
                hotkeys[id] = kept
                changed = true
            }
        }
        if (changed) {
            this.config.save()
        }
        this.diag(`hotkeys home=${JSON.stringify(hotkeys.home)} `
            + `end=${JSON.stringify(hotkeys.end)}`)
    }

    /**
     * Home / End 를 눌렀을 때 조합 중인 음절을 **먼저 확정**시킨다 (막지는 않는다).
     *
     * 왜 `releaseHomeEndHotkey` 위에 한 겹을 더 얹는가 — 핫키를 놓아주는 것만으로는 부족했다.
     * 실사용 `%APPDATA%\tabby\config.yaml:71-72` 가 이미 `home: []` / `end: []` 인데도 같은
     * 증상이 재발했다 (2026-09-08 사용자 재보고). 즉 그 키를 pty 에 직접 쓰는 경로가 Tabby
     * 핫키 말고도 남아 있다는 뜻이다. 누가 쓰든 우리가 **먼저** 확정을 끝내 두면 순서가 맞는다.
     *
     * 그래서 이 리스너는 캡처 단계에 걸되 **아무것도 막지 않는다**(preventDefault 금지).
     * 캡처는 Tabby 핫키·xterm 키 핸들러보다 먼저 돌기 때문에, 이 시점에 동기 확정을 끝내면
     * 그다음 누가 `\x1b[H` 를 쏘든 음절이 이미 나가 있다.
     *
     * `releaseHomeEndHotkey` 는 그대로 둔다 — 방향키와 같은 경로로 돌려주는 것이 여전히 옳고
     * (xterm 이 확정과 키 전송의 순서를 스스로 지킨다), 이건 그 경로가 다시 선점당했을 때를 위한
     * 두 번째 겹이다. 둘 다 켜져 있어도 확정이 두 번 나가지는 않는다 — 첫 확정 뒤에는
     * `isComposing === false` 라 `readCompositionState` 가 `idle` 로 읽어 아무 일도 하지 않는다.
     *
     * 판정은 이벤트 필드가 아니라 **헬퍼의 살아있는 상태**로 한다. 한글 IME 를 거친 이벤트는
     * `isComposing`·수식키가 지워진 채 도착하는 것이 실측됐다 (`claimShiftEnterKey` 주석).
     */
    private guardHomeEndComposition (): void {
        document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (!this.config.store.agentDeck.imeOrderGuard) {
                return
            }
            const key = event.key
            if (key !== 'Home' && key !== 'End' && event.code !== 'Home' && event.code !== 'End') {
                return
            }
            if (this.isPlainInput(event.target) || this.isDeckUiKey(event.target)) {
                return // 우리 패널의 보통 입력창 — 터미널이 아니다
            }
            const pane = this.focusedPane()
            const helper = this.compositionHelper(pane)
            const state = readCompositionState(helper)
            const plan = planSend(state)
            // **여기서는 확정을 재촉하지 않는다.** 조합 중에 우리가 동기 확정시키면 IME 가 뒤이어
            // `compositionend` 를 쏘고 xterm 이 음절을 한 번 더 보내, 그 두 번째가 커서 이동 뒤에
            // 나가 음절이 따라가 보인다 (Shift+Enter 에서 실측한 것과 같은 기전 — `ime.ts` planSend).
            //
            // Home/End 는 이미 핫키에서 놓아줬으므로(`releaseHomeEndHotkey`) xterm 이 방향키와
            // 똑같이 처리한다 — 즉 xterm 의 `keydown` 이 **자기 경로에서 동기 확정을 먼저** 한다.
            // 우리가 할 일은 그 경로를 방해하지 않는 것뿐이고, 남길 것은 진단 한 줄이다.
            // (그 경로가 다시 선점당해 증상이 재발하면 이 줄이 어느 분기였는지 알려준다.)
            this.diag(`ime home-end key=${key} keyCode=${event.keyCode} `
                + `${this.describeComposition(helper)} evComposing=${event.isComposing} `
                + `state=${state} plan=${plan}`)
        }, true)
    }

    /**
     * pty 에 바이트를 쓰는 **공통 진입점** — 조합 중인 음절보다 먼저 나가지 않게 순서를 맞춘다.
     *
     * xterm 을 거치지 않고 `sendInput`/`paste` 로 직접 쓰는 경로는 조합 동기 확정을 트리거하지
     * 않는다 (기전은 `ime.ts` 머리주석에 xterm 원문과 함께). 그래서 쓰기 직전에 조합 상태를 보고
     *   - 조합 중이면 동기 확정을 시킨 뒤 쓴다 (방향키가 하는 일을 그대로)
     *   - 확정 전송이 예약돼 있으면 우리가 한 틱 뒤로 물러난다 (같은 `setTimeout(…,0)` 큐의 뒤)
     *   - 그 외에는 그냥 쓴다
     * 로 갈라 준다. 상태를 못 읽으면(`unknown`) 그냥 쓴다 — 이 훅이 정상 입력을 막는 일은
     * 없어야 한다. `imeOrderGuard: false` 로 끄면 0.4.0 까지의 동작 그대로다.
     */
    private sendToPane (pane: any, tag: string, write: () => void): void {
        const run = (): void => {
            try {
                write()
            } catch {
                // 세션이 막 닫혔다 (defer 로 한 틱 늦게 쓸 때 특히) — 조용히 넘긴다
            }
        }
        if (!this.config.store.agentDeck.imeOrderGuard) {
            run()
            return
        }
        const helper = this.compositionHelper(pane)
        const state = readCompositionState(helper)
        const plan = planSend(state)
        this.diag(`ime send=${tag} ${this.describeComposition(helper)} `
            + `state=${state} plan=${plan}`)
        if (plan === 'defer') {
            setTimeout(run, 0)
            return
        }
        if (plan === 'after-composition') {
            this.writeAfterComposition(pane, tag, run)
            return
        }
        run()
    }

    /**
     * 조합이 끝난 **뒤에** 우리 바이트를 쓴다.
     *
     * 왜 확정을 재촉하지 않나 — 우리가 동기 확정시켜도 IME 는 자기 일정대로 `compositionend` 를
     * 또 쏘고, xterm 이 그때 음절을 한 번 더 보낸다. 그 두 번째 전송이 우리 개행 뒤에 나가면
     * **음절이 새 줄로 내려간다**(사용자가 신고한 증상, `ime.ts` planSend 주석에 실측).
     * 그래서 IME 의 생애주기를 건드리지 않고 그것이 끝나기를 기다린다.
     *
     * `compositionend` 가 온 그 순간이 아니라 **그 안에서 예약된 전송이 나간 뒤**에 써야 하므로
     * 한 틱(`setTimeout 0`)을 더 준다 — xterm 의 `_finalizeComposition(true)` 가 같은 큐를 쓴다.
     *
     * 조합이 끝나지 않는 경우(IME 가 이벤트를 안 내거나 창 포커스가 빠짐)를 대비해
     * `IME_WAIT_MS` 뒤에는 동기 확정을 시키고 쓴다 — 입력이 영영 안 나가는 것이 최악이다.
     */
    private writeAfterComposition (pane: any, tag: string, run: () => void): void {
        const ta = (() => {
            try {
                return pane?.frontend?.xterm?.textarea ?? null
            } catch {
                return null
            }
        })()
        if (!ta) {
            // 기다릴 곳이 없다 — 예전처럼 동기 확정 후 쓴다
            const flushed = flushComposition(this.compositionHelper(pane), this.compositionTextLength(pane))
            this.diag(`ime send=${tag} no-textarea flushed=${flushed}`)
            run()
            return
        }
        let done = false
        const fire = (why: string): void => {
            if (done) {
                return
            }
            done = true
            ta.removeEventListener('compositionend', onEnd)
            clearTimeout(timer)
            this.diag(`ime send=${tag} wrote-after=${why}`)
            // 조합 확정 전송(setTimeout 0)이 먼저 나가게 한 틱 양보한다
            setTimeout(run, 0)
        }
        const onEnd = (): void => fire('compositionend')
        const timer = setTimeout(() => {
            // 조합이 끝나지 않았다 — 더 기다리면 입력이 사라진 것처럼 보인다
            const flushed = flushComposition(this.compositionHelper(pane), this.compositionTextLength(pane))
            this.diag(`ime send=${tag} timeout flushed=${flushed}`)
            fire('timeout')
        }, IME_WAIT_MS)
        ta.addEventListener('compositionend', onEnd, { once: true })
    }

    /**
     * pane 의 xterm 에서 조합 헬퍼를 집는다.
     *
     * `_core._compositionHelper` 는 xterm 내부다(`tabby-terminal/dist/index.js:50042` 에서 생성).
     * 언제 사라져도 이상하지 않으므로 못 찾으면 null 을 주고, 판정은 `unknown`(= 기존 동작)으로
     * 떨어진다. 예외를 밖으로 내보내면 입력 자체가 막히므로 절대 던지지 않는다.
     */
    private compositionHelper (pane: any): CompositionHelperLike | null {
        try {
            return pane?.frontend?.xterm?._core?._compositionHelper ?? null
        } catch {
            return null
        }
    }

    /** 동기 확정이 읽을 textarea 길이 — 낡은 `_compositionPosition.end` 를 메우는 값 (ime.ts 참조) */
    private compositionTextLength (pane: any): number {
        try {
            const value = pane?.frontend?.xterm?.textarea?.value
            return typeof value === 'string' ? value.length : 0
        } catch {
            return 0
        }
    }

    /** 진단 한 줄에 넣을 헬퍼 원본값 — 판정(state)만 남기면 오판을 가릴 수 없다 */
    private describeComposition (helper: CompositionHelperLike | null): string {
        if (!helper) {
            return 'helper=none'
        }
        try {
            return `isComposing=${helper.isComposing} sending=${helper._isSendingComposition}`
        } catch {
            return 'helper=unreadable'
        }
    }

    /**
     * Shift+Enter / Ctrl+Enter 를 document **캡처 단계**에서 직접 줄바꿈으로 바꾼다.
     *
     * 핫키(`agentdeck-newline`)에만 맡겼더니 한글을 치다 누르면 절반쯤 줄바꿈이 아니라
     * **전송**이 됐다 (2026-09-08 사용자 보고: "50% 정도는 그냥 enter 로 들어간다").
     * 진단로그에 증거가 남아 있다 — 오발신 순간 `enter-label` 이 발화했는데
     * (`.agentdeck-diag.log` 00:54:59 `enter-label text="지금도 그랬"`), 그 핸들러는
     * 수식키가 하나라도 눌려 있으면 맨 앞에서 빠져나간다. 즉 그 Enter 는 **shiftKey 가
     * 지워진 채** 도착했다. 한글 IME 가 조합을 확정하며 Enter 를 한 번 삼키고, 뒤이어
     * 내보내는 이벤트에는 Shift 상태를 싣지 않는 것이다. Shift 가 없으니 `Shift-Enter`
     * 핫키에 매칭될 리 없고, xterm 은 평범한 Enter 로 0x0D 를 PTY 에 흘린다 —
     * 쓰다 만 문장이 그대로 전송된다.
     *
     * 그래서 이벤트가 알려주는 수식키를 믿지 않고 **Shift 눌림을 우리가 따로 센다**.
     * Shift 자체의 keydown/keyup 은 조합과 무관하게 그대로 오므로 IME 를 타지 않는다.
     * 세어 둔 값이 썩는 것(키업 유실)을 막으려고 창 포커스가 나가거나, Shift 없이 평범한
     * 글자가 들어오거나, 오래 묵으면(STALE_MS) 스스로 잊는다.
     *
     * 조합 중(`isComposing`/keyCode 229)인 Enter 는 손대지 않는다. 그건 "이 음절을
     * 확정해라" 는 신호고 여기서 막으면 마지막 글자가 확정되지 못한 채 줄만 넘어간다.
     * 확정이 끝나면 Enter 가 한 번 더 오니 그때 잡으면 글자 순서도 어긋나지 않는다.
     *
     * 캡처에서 전파를 끊는 이유는 claimCtrlVKey 와 같다 — 뒤에 걸린 경로(xterm 커스텀 키
     * 핸들러 → pushKeyEvent, core 의 document 리스너, xterm 이 Enter 를 0x0D 로 흘리는
     * 기본 동작)를 통째로 죽여야 줄바꿈이 정확히 한 번이 된다.
     */
    private claimShiftEnterKey (): void {
        const STALE_MS = 5000
        const forget = (): void => {
            this.shiftDownAt = 0
        }
        const isShiftKey = (event: KeyboardEvent): boolean =>
            event.key === 'Shift' || (event.code || '').startsWith('Shift')

        window.addEventListener('blur', forget)
        document.addEventListener('keyup', (event: KeyboardEvent) => {
            if (isShiftKey(event)) {
                forget()
            }
        }, true)

        document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (isShiftKey(event)) {
                this.shiftDownAt = Date.now()
                return
            }
            if (!this.config.store.agentDeck.claimShiftEnter) {
                return
            }
            const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter'
            // Shift 없이 평범한 글자가 들어왔다 = Shift 는 확실히 떼어져 있다 (키업 유실 자가복구)
            if (!isEnter && !event.shiftKey && !event.getModifierState('Shift')) {
                forget()
                return
            }
            if (!isEnter || event.altKey || event.metaKey) {
                return
            }
            if (event.isComposing || event.keyCode === 229) {
                return // 조합 확정용 Enter — 확정된 뒤에 한 번 더 온다
            }
            const tracked = this.shiftDownAt > 0 && Date.now() - this.shiftDownAt < STALE_MS
            const shift = event.shiftKey || event.getModifierState('Shift') || tracked
            if (!shift && !event.ctrlKey) {
                return // 맨 Enter 는 전송이다 — 건드리지 않는다
            }
            if (this.isPlainInput(event.target) || this.isDeckUiKey(event.target)) {
                return
            }
            event.preventDefault()
            event.stopPropagation()
            this.diag(`newline (capture) shiftKey=${event.shiftKey} `
                + `modState=${event.getModifierState('Shift')} tracked=${tracked} ctrl=${event.ctrlKey}`)
            this.sendNewline()
        }, true)
    }

    /**
     * Enter 를 눌러 프롬프트를 보낼 때, 그 프롬프트 원문을 작업 라벨로 삼는다.
     *
     * 왜 이게 필요한가 — 라벨을 채우는 다른 경로(훅·콘솔 제목)는 둘 다 배포판에서 못 믿는다.
     * 훅은 사용자가 `~/.claude/settings.json` 을 손봐야 돌고, 플러그인이 그걸 대신 깔아줄 수도 없다.
     * 콘솔 제목은 Claude Code 가 세션 첫 작업을 요약해 한 번 박고 그 뒤로 갱신하지 않는다
     * (2026-08-28 실측: 작업이 네 번 바뀌는 동안 `◑ sendInput 한 줄 vs 두 줄 원인 파악` 그대로).
     * 그래서 설정이 하나도 없는 상태에서 라벨을 최신으로 유지할 수 있는 건 이 경로뿐이다.
     *
     * **Enter 만 잡는다.** Shift+Enter / Ctrl+Enter 는 줄바꿈이라(agentdeck-newline) 아직 전송이
     * 아니고, 그때 라벨을 바꾸면 쓰다 만 문장이 박힌다. 수식키가 하나라도 눌려 있으면 그냥 흘린다.
     * IME 조합 중의 Enter(한글 확정)도 전송이 아니므로 제외한다.
     *
     * 관측만 하고 이벤트는 절대 막지 않는다 — 여기서 preventDefault 하면 프롬프트가 안 보내진다.
     */
    private claimEnterLabel (): void {
        document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
                return // 줄바꿈이지 전송이 아니다
            }
            if (event.key !== 'Enter' && event.code !== 'Enter' && event.code !== 'NumpadEnter') {
                return
            }
            if (event.isComposing || event.keyCode === 229) {
                return // 한글 조합 확정용 Enter
            }
            if (this.isPlainInput(event.target) || this.isDeckUiKey(event.target)) {
                return
            }

            // **한도 도달은 여기서 풀린다.** 사용자가 새 지시를 보냈다는 것이 "다시 쓸 수 있게
            // 됐다" 의 가장 이른 신호다. 화면 출력으로는 풀지 않는다 — 한도 화면도 상태줄을 계속
            // 다시 그려서 "출력이 있다 = 진행중" 으로 풀면 배지가 한 조각만 떴다 사라진다
            // (`detect.ts` 의 sticky 가드). `limited` 가 아니거나 사용자가 직접 지정한(pinned)
            // 상태면 no-op 이라 Enter 마다 불려도 안전하다.
            //
            // **`enterAsLabel` 가드보다 위에 있어야 한다.** 아래로 내려가면 라벨 기능을 끈
            // 사용자에게는 이 해제 경로가 통째로 죽는다 (한도는 라벨과 무관한 기능이다).
            const limitedTab = this.app.activeTab
            if (limitedTab) {
                releaseLimited(this.status, limitedTab)
            }

            if (!this.config.store.agentDeck.enterAsLabel) {
                return
            }
            const pane = this.focusedPane()
            if (!pane) {
                this.diag(`enter-label skipped (no pane)`)
                return
            }
            // 화면은 아직 프롬프트가 지워지기 전이다 — 캡처 단계라 앱이 Enter 를 보기 전에 읽는다
            const text = this.readPromptLine(pane)
            // 상태는 루트 탭 단위로 관리한다 (watchTab 이 app.tabs 로 감시하는 것과 같은 단위)
            const tab = this.app.activeTab
            // 어느 프로필로 읽었는지 같이 남긴다 — 이 줄이 라벨 회귀를 가르는 유일한 근거라,
            // shape 를 주입하기 시작한 뒤로는 "어떤 규칙으로 읽었나" 까지 있어야 원인을 좁힐 수 있다
            this.diag(`enter-label text="${text}" tab=${tab ? 'yes' : 'no'}`
                + ` profile=${this.profileForPane(pane)?.id ?? 'default'}`)
            if (!text || !tab) {
                return
            }
            this.status.setLabel(tab, text)
        }, true)
    }

    /**
     * xterm 화면 버퍼에서 지금 입력창에 쓰여 있는 프롬프트를 읽는다 (판정은 extractPrompt).
     *
     * 화면 맨 아래가 아니라 **커서 줄**을 기준점으로 잡는다. Claude Code 는 대화가 짧으면
     * 입력창을 화면 위쪽에 두고 그 아래를 전부 빈 줄로 남기는데(2026-08-28 실측), 아래 14줄만
     * 읽으면 빈 줄만 걸려 프롬프트를 영영 못 찾는다 — 라벨이 안 바뀌던 원인이 이것이다.
     * 커서는 항상 입력 중인 줄에 있고, 여러 줄 프롬프트면 마지막 줄에 있으니 거기서 위로 훑으면
     * `> ` 머리를 만난다. 커서 아래는 힌트 줄이라 애초에 읽지 않는 편이 정확하다.
     */
    private readPromptLine (pane: any): string {
        const xterm = pane.frontend?.xterm
        const buf = xterm?.buffer?.active
        if (!buf || typeof buf.getLine !== 'function') {
            this.diag(`enter-label no-buffer frontend=${pane.frontend ? 'yes' : 'no'} xterm=${xterm ? 'yes' : 'no'}`)
            return ''
        }
        const read = (from: number, to: number): string[] => {
            const lines: string[] = []
            for (let y = Math.max(0, from); y <= to; y++) {
                lines.push(buf.getLine(y)?.translateToString(true) ?? '')
            }
            return lines
        }
        const cursor = buf.baseY + (buf.cursorY ?? 0)
        const nearCursor = read(cursor - PROMPT_SCAN_ROWS, cursor)
        const shape = this.profileForPane(pane)?.promptShape
        const byCursor = extractPrompt(nearCursor, shape)
        if (byCursor) {
            return byCursor
        }
        // 커서가 입력창 밖에 있을 때의 폴백 — 화면 전체를 아래에서 위로 훑는다
        const byScreen = extractPrompt(read(buf.baseY, buf.baseY + xterm.rows - 1), shape)
        if (!byScreen) {
            // 두 경로가 다 빈손이면 화면이 어떻게 생겼는지 남긴다.
            // 이게 없어서 "입력창 못 찾음" 과 "버퍼를 못 읽음" 을 못 갈랐다 (2026-09-01).
            const dump = nearCursor.slice(-4)
                .map(l => JSON.stringify(l.slice(0, 60)))
                .join(' | ')
            this.diag(`enter-label miss baseY=${buf.baseY} cursorY=${buf.cursorY} rows=${xterm.rows} tail=${dump}`)
        }
        return byScreen
    }

    /** 터미널이 아닌 보통 입력 필드(설정 화면 등)인지 — 거기서는 Ctrl+V 를 건드리지 않는다 */
    private isPlainInput (target: EventTarget | null): boolean {
        const el = target as HTMLElement | null
        if (!el || typeof el.closest !== 'function') {
            return false
        }
        // xterm 이 키 입력을 받는 숨은 textarea 는 터미널이지 입력 필드가 아니다
        if (el.classList?.contains('xterm-helper-textarea') || el.closest('.xterm')) {
            return false
        }
        return el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName)
    }

    /**
     * 이 키가 **우리 사이드바 안에서** 났나 — 그렇다면 터미널 몫이 아니다.
     *
     * `isPlainInput` 과 나란히 쓰는 두 번째 가드다. 그 함수는 "보통 입력 필드냐" 를 보므로
     * 검색창(`<input>`)은 이미 걸러 주지만, 키보드 내비게이션은 목록(`.ad-list`, DIV)이
     * 포커스를 갖는다 — 태그로는 터미널과 구별되지 않는다. 그대로 두면 목록에서 누른 Enter 가
     * 캡처 단계의 `claimEnterLabel` 에 먼저 걸려 **엉뚱한 탭의 화면을 읽어 라벨로 박고**,
     * Shift+Enter 는 `claimShiftEnterKey` 가 0x0A 를 pty 로 보낸다. 우리 리스너는 target
     * 단계라 캡처보다 늦게 돌아 끊을 수 없으니, 비켜 주는 쪽이 캡처여야 한다.
     *
     * 기존 동작은 바뀌지 않는다 — 이 판정이 참이 되는 상황은 **사이드바가 포커스를 가진 때**뿐이고,
     * 그런 상태는 이 기능이 생기기 전에는 검색창(이미 `isPlainInput` 이 비켜 줬다) 외에 없었다.
     */
    private isDeckUiKey (target: EventTarget | null): boolean {
        const el = target as HTMLElement | null
        if (!el || typeof el.closest !== 'function') {
            return false
        }
        return !!el.closest('#' + SIDEBAR_ID)
    }

    /**
     * Ctrl+V 붙여넣기 — 클립보드가 이미지면 Alt+V 로 넘긴다.
     *
     * 터미널 붙여넣기는 "클립보드 텍스트를 키 입력처럼 PTY 에 써넣는" 동작이다
     * (`tabby-terminal/dist/index.js:41842` paste() → readClipboard() → sendInput).
     * PTY 는 바이트 스트림이라 이미지가 지나갈 방법 자체가 없고, 클립보드는 OS 자원이라
     * 터미널 안에서 도는 앱은 손댈 수 없다 — 그래서 이미지는 조용히 사라진다.
     *
     * Claude Code 는 이걸 자기가 OS 클립보드를 직접 읽어서 푼다. Alt+V(= ESC v)가 그
     * "지금 클립보드를 읽어라" 신호다. 즉 Ctrl+V 와 Alt+V 는 붙여넣는 주체가 다르다
     * (Ctrl+V = 터미널이 넣어줌 / Alt+V = 앱이 직접 읽음). 사용자가 그걸 구분할 이유는 없으니
     * 클립보드에 이미지만 있을 때 Ctrl+V 가 알아서 ESC v 를 대신 보낸다.
     *
     * 텍스트가 같이 들어 있으면(엑셀·워드 복사 등) 텍스트 붙여넣기를 유지한다 — 그쪽이 의도이므로.
     */
    private doPaste (source: string): void {
        // 한 번의 Ctrl+V / 우클릭이 여러 경로로 들어오는 일이 있다 (ensurePasteHotkey 주석 참고).
        // 어느 경로가 먼저 오든 처음 것만 살린다 — 사람 연타는 이 창보다 느리다.
        const now = Date.now()
        if (now - this.lastPasteAt < PASTE_DEDUPE_MS) {
            this.diag(`paste ignored (dup ${now - this.lastPasteAt}ms, ${source})`)
            return
        }
        this.lastPasteAt = now

        const pane = this.focusedPane()
        if (!pane) {
            return
        }
        const imageOnly = this.clipboardHasImageOnly()
        this.diag(`paste probe enabled=${this.config.store.agentDeck.pasteImageWithCtrlV} imageOnly=${imageOnly} sendInput=${typeof pane.sendInput}`)
        if (this.config.store.agentDeck.pasteImageWithCtrlV
            && imageOnly
            && typeof pane.sendInput === 'function') {
            // 이미지 전용 클립보드 — 텍스트 붙여넣기는 어차피 아무것도 못 넣으므로
            // "네가 직접 클립보드를 읽어라" 키를 흘려보낸다 (sendImagePasteKey 주석 참고)
            void this.sendImagePasteKey(pane)
            return
        }
        if (typeof pane.paste !== 'function') {
            return
        }
        // 붙여넣기 한 번이 PTY 에 몇 번 써지는지 본다 (우클릭 2중 입력 추적용).
        // 창을 열어둔 동안의 입력만 남긴다 — 상시 켜두면 사람이 타이핑한 것까지 다 찍힌다.
        this.pasteProbeUntil = Date.now() + PASTE_PROBE_MS
        this.probeSendInput(pane)
        this.probeWrite(pane)
        // 텍스트 붙여넣기는 xterm 이 네이티브 paste 이벤트로 이미 처리한다
        // (tabby-terminal/dist/index.js:5383 에서 textarea/element 에 handlePasteEvent 등록).
        // 그런데도 우리가 무조건 paste() 를 부르면 한 번 눌러 두 번 붙는다.
        // 그래서 네이티브가 오는지 잠깐 보고, 안 오면(터미널 textarea 가 포커스를 못 잡은 경우 등)
        // 그제야 우리가 붙인다 — 어느 쪽이든 정확히 한 번이 된다.
        this.diag(`paste (${source})`)
        if (source === 'ctrl-v') {
            // 캡처 단계에서 이미 preventDefault 했으므로 네이티브 paste 는 오지 않는다 — 기다릴 것 없이 바로 붙인다
            this.sendToPane(pane, 'paste-ctrl-v', () => void pane.paste())
            return
        }
        const startedAt = Date.now()
        setTimeout(() => {
            if (this.nativePasteAt >= startedAt) {
                this.diag(`paste skipped (native handled)`)
                return
            }
            this.diag(`paste fallback`)
            this.sendToPane(pane, 'paste-fallback', () => void pane.paste())
        }, PASTE_NATIVE_WAIT_MS)
    }

    /**
     * 이미지 전용 클립보드일 때 터미널 앱에 "네가 클립보드를 직접 읽어라" 키를 흘려보낸다.
     *
     * 어떤 키인지는 앱마다 다르다 (2026-08-28 실측):
     *   - Claude Code: ESC v 만 받는다. 리터럴 0x16 은 5회 보내도 이미지가 들어가지 않았다
     *     (`.agentdeck-diag.log` 09:33:47~48 `paste image (ctrl-v)` 5줄, 화면에는 아무 변화 없음).
     *     claude.exe 안의 `ctrl+v ... paste images` 문구는 자기가 키 이벤트를 직접 볼 때의 안내였고,
     *     PTY 로 들어온 0x16 에는 반응하지 않는다.
     *   - Codex: 0x16 을 자기 붙여넣기로 받고, ESC v 는 모른다.
     * 그래서 탭에서 도는 앱을 보고 갈라 보내고, 못 알아내면 설정값(`imagePasteKey`)을 쓴다.
     */
    private async sendImagePasteKey (pane: any): Promise<void> {
        const found = await this.detectAgentApp(pane)
        const profile = profileFor(found.id)
        const configured = this.config.store.agentDeck.imagePasteKey
        // 프로필의 `config` 는 "이 에이전트가 무엇을 받는지 관측된 바 없다" 는 뜻 —
        // 그때만 사용자 설정값으로 떨어진다 (claude=alt-v, codex=ctrl-v 는 실측값이다)
        const mode = profile.imagePasteKey === 'config' ? configured : profile.imagePasteKey
        const key = mode === 'ctrl-v' ? '' : 'v'
        this.diag(`paste image app=${found.id} via=${found.via} mode=${mode} `
            + `bytes=${[...key].map(c => c.charCodeAt(0)).join(',')}`)
        // doPaste 쪽이 아니라 여기서 진입점을 지난다 — 위 detectAgentApp 을 await 하는 동안
        // 조합 상태가 바뀌므로, 실제로 쓰는 시점에 다시 읽는 편이 정확하다.
        this.sendToPane(pane, 'paste-image', () => pane.sendInput(key))
    }

    /**
     * 터미널 위에 **파일을 끌어다 놓았을 때** 무엇을 할지 물어본다.
     *
     * 순정 Tabby 는 그 경로를 터미널에 붙여넣는다(`cat <경로>` 를 쉽게 만드는 유용한 동작이다).
     * 그런데 미리보기 패널이 생긴 뒤로는 "그 파일을 보고 싶어서" 끌어놓는 경우가 더 많은데,
     * 패널이 닫혀 있으면 경로만 붙고 아무것도 안 열린다(2026-09-09 유저 지적).
     *
     * 그래서 캡처 단계에서 드롭을 가로채고 **둘 중 하나를 고르게** 한다 —
     * `패널에 띄우기` / `경로 붙여넣기`. 자동으로 화면을 바꾸지 않는 이유는 붙여넣기만 원했던
     * 사람의 화면을 빼앗지 않기 위해서다(유저: "한번 물어보긴 해야 할 듯").
     *
     * `viewerDropOpen` 이 `always`/`paste` 면 묻지 않고 그 선택을 하고, `never` 면 아예
     * 개입하지 않아 순정 동작이 그대로 돈다.
     */
    private claimFileDrop (): void {
        const overPanel = (target: EventTarget | null): boolean => {
            const el = target as HTMLElement | null
            return !!el?.closest?.('#agentdeck-view, #agentdeck-sidebar')
        }
        // dragover 에서 preventDefault 를 하지 않으면 브라우저가 drop 을 아예 안 만든다
        document.addEventListener('dragover', (e: DragEvent) => {
            if (this.config.store.agentDeck.viewerDropOpen === 'never' || overPanel(e.target)) {
                return
            }
            if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
                return
            }
            e.preventDefault()
        }, true)

        document.addEventListener('drop', (e: DragEvent) => {
            const mode = this.config.store.agentDeck.viewerDropOpen
            // 패널·사이드바 위 드롭은 그쪽 핸들러가 처리한다 (viewPanel.installDrop)
            if (mode === 'never' || overPanel(e.target)) {
                return
            }
            const file = e.dataTransfer?.files?.[0] as any
            const raw = file?.path || e.dataTransfer?.getData('text/plain') || ''
            const target = String(raw).trim().replace(/^"|"$/g, '')
            if (!target) {
                return
            }
            // 여기서 막지 않으면 순정 붙여넣기가 같이 일어나 "붙여넣기" 버튼이 무의미해진다
            e.preventDefault()
            e.stopPropagation()
            if (mode === 'always') {
                this.openDroppedInPanel(target)
                return
            }
            if (mode === 'paste') {
                this.pasteDroppedPath(target)
                return
            }
            this.askFileDrop(target)
        }, true)
    }

    /** 끌어다 놓은 파일을 미리보기 패널에서 연다 (패널이 닫혀 있으면 열면서) */
    private openDroppedInPanel (file: string): void {
        this.view?.setOpen(true, false)
        this.view?.openFile(file)
    }

    /**
     * 끌어다 놓은 경로를 터미널에 넣는다 — 순정 Tabby 가 하던 그 일이다.
     *
     * 공백이 든 경로는 따옴표로 감싼다. 그러지 않으면 셸이 두 인자로 쪼개 읽는다.
     * **개행은 붙이지 않는다** — 사용자가 앞에 `cat` 을 붙일 여지를 남긴다.
     */
    private pasteDroppedPath (file: string): void {
        const pane = this.firstPane(this.app.activeTab as BaseTabComponent)
        if (!pane) {
            return
        }
        const text = /\s/.test(file) ? `"${file}"` : file
        this.sendToPane(pane, 'drop-paste', () => pane.sendInput(text))
    }

    /**
     * 드롭 확인 배너. **OS 모달이 아니라 인라인 카드**다 —
     * 모달은 터미널 흐름을 끊고, CDP 로 자동 검증할 수 없다(`showMessageBox` 는 프로브가
     * 응답할 방법이 없어 회귀가 그 자리에서 멈춘다).
     */
    private askFileDrop (file: string): void {
        document.getElementById('agentdeck-drop-ask')?.remove()
        const name = file.split(/[\\/]/).pop() || file
        const card = document.createElement('div')
        card.id = 'agentdeck-drop-ask'
        card.className = 'ad-drop-ask'
        card.innerHTML = [
            '<div class="ad-drop-ask-msg"></div>',
            '<div class="ad-drop-ask-row">',
            this.uiMarkup('  <button class="ad-drop-ask-view">패널에 띄우기</button>'),
            this.uiMarkup('  <button class="ad-drop-ask-paste">경로 붙여넣기</button>'),
            this.uiMarkup('  <button class="ad-drop-ask-close" title="아무것도 하지 않는다">✕</button>'),
            '</div>',
            '<label class="ad-drop-ask-again">',
            this.uiMarkup('  <input type="checkbox" class="ad-drop-ask-again-box"> 다시 묻지 않기'),
            '</label>',
        ].join('')
        const msg = card.querySelector('.ad-drop-ask-msg') as HTMLElement
        // 파일명은 사용자 데이터다 — innerHTML 로 넣지 않는다
        msg.textContent = this.ui('{name} 을 어떻게 할까요?', { name })
        msg.title = file

        const again = () => (card.querySelector('.ad-drop-ask-again-box') as HTMLInputElement)?.checked === true
        const remember = (mode: 'always' | 'paste') => {
            if (again()) {
                this.config.store.agentDeck.viewerDropOpen = mode
                this.config.save()
            }
        }
        const close = () => card.remove()
        card.querySelector('.ad-drop-ask-view')?.addEventListener('click', () => {
            remember('always')
            this.openDroppedInPanel(file)
            close()
        })
        card.querySelector('.ad-drop-ask-paste')?.addEventListener('click', () => {
            remember('paste')
            this.pasteDroppedPath(file)
            close()
        })
        card.querySelector('.ad-drop-ask-close')?.addEventListener('click', close)
        document.body.appendChild(card)
        // 방치하면 화면에 남는다 — 사용자가 아무것도 고르지 않은 것도 하나의 선택이다
        setTimeout(() => {
            if (document.getElementById('agentdeck-drop-ask') === card) {
                close()
            }
        }, 15000)
    }

    /**
     * 이 탭에서 도는 에이전트 CLI 가 뭔지 — 상태 감지 패턴과 이미지 붙여넣기 키가 앱마다 다르다.
     *
     * **훅이 말해 준 값이 추측보다 앞선다** (`notify.agentOf`). 훅 스크립트는
     * `-Agent claude|codex|gemini` 로 불리므로 자기가 누구인지 알고 있다. 명령줄(WMI)·탭 제목
     * 추측은 훅이 없는 탭의 폴백이고 흔들린다: npm 전역 래퍼로 띄운 gemini 는 자식이
     * `node.exe` 하나뿐이고 제목에도 이름이 없었다(2026-09-08 실측).
     *
     * 단 **프로세스 이름이 에이전트를 확실히 가리키면 그것이 훅보다 앞선다.** 훅 값은 보고한
     * 세션이 살아 있을 때만 사실이고, 그 세션이 끝났다고 알려 주는 훅은 없다 — 같은 탭에서
     * claude 를 끄고 훅 없는 codex 를 띄우면 옛 값이 남는다. (자식이 없는 것은 근거로 쓰지 않는다 —
     * 빈 목록은 믿을 만한 종료 신호가 아니다. 그래서 claude 를 끄고 맨 셸로 남은 탭은 다음 훅 보고 전까지 옛 값을 든다.)
     *
     * 순서: 프로세스 이름(확실할 때) → 훅 → 그 pid 의 명령줄(WMI) → 탭 제목. 어느 조각으로
     * 무엇을 알아보는지는 `agents.ts` 의 프로필이 정한다 — 이 함수는 근거를 모으기만 한다.
     *
     * `via` 를 함께 돌려주는 이유: 나중에 "왜 codex 로 잡혔나" 를 가르려면 훅이 말한 것인지
     * 프로세스에서 나온 판정인지 제목(신뢰도가 낮다)에서 나온 판정인지가 유일한 단서다.
     */
    private async detectAgentApp (pane: any): Promise<{ id: AgentId, via: 'hook' | 'proc' | 'cmdline' | 'title' | 'none' }> {
        const root = (this.app.getParentTab?.(pane) ?? pane) as BaseTabComponent
        const hooked = this.notify?.agentOf?.(root) ?? null
        let pids: number[] = []
        try {
            const procs: any[] = await pane.session?.getChildProcesses?.() ?? []
            const names = procs.map(x => `${x?.command ?? ''} ${x?.name ?? ''}`).join(' ')
            const byProc = identifyAgent(names, '')
            if (byProc !== 'unknown') {
                // **훅 값은 "그 세션이 살아 있는 동안" 의 사실이다.** 같은 탭에서 claude 를 끄고
                // 훅이 없는 codex 를 띄우면 훅은 아무 말도 안 하므로 옛 `claude` 가 남는다.
                // 프로세스 이름이 **다른 에이전트를 확실히** 가리키면 그게 지금의 사실이니 훅 값을 버린다
                if (hooked && hooked !== byProc) {
                    this.notify?.forgetAgent?.(root)
                    this.forgetHookStatus(root)
                    this.diag(`agent hook stale hook=${hooked} proc=${byProc}`)
                }
                return { id: byProc, via: 'proc' }
            }
            pids = procs.map(x => Number(x?.pid)).filter(n => Number.isInteger(n) && n > 0)
            if (hooked && !pids.length) {
                // **"자식이 없다 = 에이전트가 끝났다" 로 보지 않는다** — 빈 목록은 믿을 만한 종료 신호가
                // 아니다. 격리 인스턴스에서 **처음 연 터미널 탭 외의 탭은** `ping` 이 응답을 찍고 있는데도
                // `getChildProcesses()` 가 `[]` 였다(winpty·ConPTY 둘 다, 2026-09-14 실측). SSH 처럼
                // 프로세스 트리를 못 읽는 세션도 같은 값을 낸다. 그 규칙을 두면 훅 정체가 판정마다 지워진다.
                // 물어볼 pid 조차 없으므로 여기서 끝낸다
                return { id: hooked, via: 'hook' }
            }
            // **자식은 있는데 이름으로 못 가린 것은 "모르겠다" 가 아니다.**
            // npm 전역 래퍼로 띄운 CLI 는 자식이 `node.exe` 하나뿐이라 이름으로는 영영 안 잡힌다.
            // 그 상태에서 훅 값을 그대로 믿으면 같은 탭에서 claude 를 끄고 codex 를 띄워도 영영
            // claude 로 남는다 — 아래 명령줄 폴백이 바로 그 경우를 위해 있는데 훅 때문에 도달하지
            // 못했다(2026-09-15 지적). 그래서 **pid 가 있으면 훅이 있어도 명령줄까지 물어본다.**
        } catch {
            // 프로세스 트리를 못 읽는 세션(SSH 등) — 훅이 말한 것이 있으면 그걸, 없으면 아래 제목으로
            if (hooked) {
                return { id: hooked, via: 'hook' }
            }
        }

        // **npm 전역 래퍼로 띄운 CLI 는 이름만으로는 영영 unknown 이다.**
        // 2026-09-08 실측: gemini 를 띄운 탭의 자식 프로세스는 `{ pid, command: 'node.exe' }`
        // 하나뿐이고 제목도 `◇  Ready (work)` 라 `gemini` 라는 글자가 어디에도 없다. 그런데
        // 그 pid 의 **명령줄**에는 그대로 들어 있다 —
        //   "…/node.exe" C:/Users/…/npm/node_modules/@google/gemini-cli/bundle/gemini.js
        // 그래서 이름으로 못 가렸을 때만 pid 로 명령줄을 한 번 묻는다. 이름으로 잡히는
        // 경우(claude 처럼 자기 실행 파일로 뜨는 앱)에는 이 경로가 아예 돌지 않는다.
        const cmdline = await this.commandLinesOf(pids)
        if (cmdline) {
            const byCmd = identifyAgent(cmdline, '')
            if (byCmd !== 'unknown') {
                // 이름으로 갈렸을 때(위 `byProc`)와 같은 규칙이다 — **낡은 훅 값을 여기서도 버린다.**
                // 이 자리를 빼먹으면 비동기 판정만 맞고 `hookAgent` 에는 옛 정체가 남아, 훅 값을
                // 제일 먼저 보는 동기 경로(`resolveProfileForPane`)가 계속 옛 답을 낸다.
                // 그게 곧 커서 보정·키보드가 쓰는 자리라 화면에 그대로 나타난다.
                if (hooked && hooked !== byCmd) {
                    this.notify?.forgetAgent?.(root)
                    this.forgetHookStatus(root)
                    this.diag(`agent hook stale hook=${hooked} cmdline=${byCmd}`)
                }
                return { id: byCmd, via: 'cmdline' }
            }
        }

        const title = `${pane.title ?? ''} ${pane.customTitle ?? ''}`
        const byTitle = identifyAgent('', title)
        return { id: byTitle, via: byTitle === 'unknown' ? 'none' : 'title' }
    }

    /**
     * 훅이 고정해 둔 **상태**도 함께 버린다 — 정체(`forgetAgent`)를 버리는 자리에서 같이 부른다.
     *
     * 정체만 버리면 절반이다. 같은 탭에서 claude 를 끄고 다른 CLI 를 띄우면 `hookAgent` 는
     * 지워지지만 `status` 는 여전히 `pinned` 라(`setManual` 이 세운다) 새 CLI 의 출력이
     * `setAuto` 로 아무리 들어와도 전부 무시된다 — 배지가 **끝난 세션의 마지막 상태**(보통
     * `완료`나 `진행중`)에 박혀 있게 된다. 훅이 없는 CLI 로 갈아탔으면 그 탭에는 배지를
     * 되살릴 길이 영영 없다.
     *
     * `unpin` 은 상태를 idle 로 되돌린다 — 지금 그 탭에서 도는 것은 **다른 프로그램**이고,
     * 옛 세션의 상태를 물려받을 이유가 없다. 새 CLI 에도 훅이 있으면 첫 보고가 다시 고정한다.
     */
    private forgetHookStatus (root: BaseTabComponent): void {
        if (this.status.get(root).pinned) {
            this.status.unpin(root)
        }
    }

    /**
     * 그 pid 들의 명령줄을 한 줄로 이어 돌려준다 (식별 폴백 전용).
     *
     * 비용이 있는 호출이라 **이름·제목으로 못 가렸을 때만** 부른다. 호출 빈도는 `probeAgent`
     * 의 TTL(`AGENT_PROBE_TTL_MS`)이 잡아 준다 — 출력 조각마다 도는 경로가 아니다.
     *
     * pid 는 **숫자만** 통과시킨다. 값을 명령에 이어 붙이는 자리라, 여기서 걸러내지 않으면
     * 그대로 셸에 넘어간다.
     */
    private async commandLinesOf (pids: number[]): Promise<string | null> {
        const clean = pids.filter(n => Number.isInteger(n) && n > 0).slice(0, 8)
        if (!clean.length) {
            return null
        }
        try {
            // eslint-disable-next-line
            const { execFile } = require('child_process')
            const isWin = process.platform === 'win32'
            const file = isWin ? 'powershell' : 'ps'
            const args = isWin
                // Win32_Process 의 CommandLine 이 우리가 원하는 그 문자열이다.
                // wmic 은 Windows 11 에서 폐기 대상이라 쓰지 않는다.
                ? ['-NoProfile', '-NonInteractive', '-Command',
                    `Get-CimInstance Win32_Process -Filter "${clean.map(n => `ProcessId=${n}`).join(' or ')}"`
                    + ' | Select-Object -ExpandProperty CommandLine']
                : ['-o', 'args=', '-p', clean.join(',')]
            return await new Promise<string | null>(resolve => {
                const child = execFile(file, args, { timeout: 4000, windowsHide: true },
                    (err: any, stdout: string) => resolve(err && !stdout ? null : String(stdout ?? '')))
                child.on('error', () => resolve(null))
            })
        } catch {
            return null
        }
    }

    /**
     * 이 탭의 에이전트를 알아내 기억한다 — 출력 경로에서 프로세스 트리를 묻지 않기 위한 캐시.
     *
     * TTL(`AGENT_PROBE_TTL_MS`)로 묶는다. 세션이 붙는 시점에는 셸만 떠 있고 사용자가 그 뒤
     * `claude` 를 직접 띄우는 경우가 흔해서, 한 번 unknown 이어도 제목이 바뀔 때 다시 본다.
     * 반대로 이미 알아낸 탭이 일시적으로 unknown 으로 읽히면(프로세스 트리 조회 실패 등)
     * 기억을 지우지 않는다 — 지웠다가 합집합으로 되돌아가면 판정이 왔다갔다 한다.
     */
    private async probeAgent (root: BaseTabComponent, why: string): Promise<void> {
        const now = Date.now()
        if (now - (this.agentProbedAt.get(root) ?? 0) < AGENT_PROBE_TTL_MS) {
            return
        }
        this.agentProbedAt.set(root, now)
        const pane = this.firstPane(root)
        if (!pane) {
            return
        }
        const session = pane.session
        const observed = this.paneAgents.get(pane)
        const found = await this.detectAgentApp(pane)
        if (pane.session !== session) { return }
        // A fresh process result can recover a stream identity invalidated by
        // a console title. The tab cache may belong to an exited application.
        // `hook` 은 여기 넣지 않는다 — 훅 값은 `profileForPane` 이 직접 쓰고, 추적기에 박으면
        // 훅 값을 버린 뒤에도(`forgetAgent`) 추적기에 남아 옛 정체가 계속 이긴다(2026-09-14 ML11 실측)
        if (found.id !== 'unknown' && (found.via === 'proc' || found.via === 'cmdline')
            && observed && this.paneAgents.get(pane) === observed && observed.session === session
            && observed.tracker.id === 'unknown') {
            observed.tracker.id = found.id
            this.diag(`agent stream recovered id=${found.id} via=${found.via}`)
        }
        const prev = this.tabAgents.get(root)
        if (found.id === 'unknown' && prev && prev !== 'unknown') {
            return
        }
        this.tabAgents.set(root, found.id)
        if (found.id !== prev) {
            this.diag(`agent tab=${JSON.stringify(root.title ?? '')}`
                + ` id=${found.id} via=${found.via} (${why})`)
        }
    }

    /** 그 탭의 첫 pane — 프로세스 트리를 물어볼 대상. 래퍼 탭(SplitTab)이면 자식 중 첫 번째 */
    private firstPane (root: BaseTabComponent): any {
        const anyRoot = root as any
        const panes: BaseTabComponent[] = typeof anyRoot.getAllTabs === 'function'
            ? anyRoot.getAllTabs()
            : [root]
        return panes[0] ?? null
    }

    /**
     * 상태 감지에 넘길 프로필 — **아직 모르면 넘기지 않는다.**
     *
     * `undefined` 를 주면 detect 쪽 기본값(합집합)이 쓰이고, 그게 0.5.0 까지의 판정과 같다.
     * 판정 전이나 판정 실패(보통 셸)에 특정 에이전트 프로필을 씌우면, 그 에이전트에 없는
     * 문구를 못 잡아 예전보다 못해진다.
     */
    /**
     * pane 으로 들어오는 경로(화면 읽기·깨짐 판정)에서 쓰는 프로필.
     *
     * 상태는 root 탭 단위로 들고 있으므로(SplitTab 래퍼) pane 을 부모로 올려서 찾는다 —
     * `decorator.ts` 의 `rootOf` 와 같은 규칙이다. 정규화하지 않으면 자식에 쓰고 부모를 읽어
     * 영영 매칭되지 않는다.
     */
    private profileForPane (pane: any): AgentProfile | undefined {
        // 회귀는 **가짜 `this`** 로 이 함수를 직접 부른다(`test/regression.cjs`).
        // 그 객체에는 프로토타입 메서드가 없으므로 본체를 프로토타입에서 꺼내 부르고,
        // 캐시도 없으면 건너뛴다 — 이 파일이 `notify?.`·`paneAgents?.` 를 쓰는 이유와 같다.
        const resolve = AgentDeckService.prototype.resolveProfileForPane
        if (!this.profileMemo) {
            return resolve.call(this, pane)
        }
        const memo = this.profileMemo.get(pane)
        const now = Date.now()
        const sameSession = !!memo && memo.session === pane?.session
        if (sameSession && now - memo!.at < PROFILE_MEMO_MS) {
            return memo!.profile
        }
        let profile = resolve.call(this, pane)
        // **"모르겠다" 는 이미 알던 것을 지우지 않는다.**
        //
        // 한 pty 에서 두 CLI 가 동시에 돌 수는 없으므로, 한번 확실히 알아낸 정체는 그 pty 가
        // 살아 있는 동안 유효하다. 다른 CLI 로 바꿔 띄우면 그쪽 훅 보고가 덮고
        // (`notify.service` 의 hookAgent), 프로세스·명령줄 근거도 그때 바뀐다.
        //
        // 이 규칙이 없으면 화면 추적이 잠깐 헷갈릴 때마다 정체가 `undefined` 로 떨어지고,
        // 그 순간 커서 보정이 꺼져 Codex 의 hide/show 가 그대로 화면에 닿는다 — 그게 곧
        // 깜빡임이다 (2026-09-15 실측: 854번 중 65번이 그렇게 새어 화면에서는 16% 가 꺼졌다).
        if (!profile && sameSession) {
            profile = memo!.known
        }
        this.profileMemo.set(pane, {
            at: now,
            session: pane?.session,
            profile,
            known: profile ?? (sameSession ? memo!.known : undefined),
        })
        return profile
    }

    /** `profileForPane` 의 본체 — 캐시를 거치지 않는 실제 판정 */
    private resolveProfileForPane (pane: any): AgentProfile | undefined {
        try {
            const root = (this.app.getParentTab?.(pane) ?? pane) as BaseTabComponent
            // **회귀 전용 못** (`__agentdeck.pinAgent`). 평소에는 비어 있고 `size` 검사 한 번으로 끝난다.
            //
            // 왜 필요한가 — 화면 감시(`checkScreen`)는 2026-09-13 부터 Claude pane 에서만 돈다
            // (`canRepairComposer`). 그 게이트는 옳지만, 그 바람에 회귀(PR4·PR5)가 격리 인스턴스의
            // PowerShell pane 에 깨진 화면을 그려 놓고 "감시가 안 돈다" 로 **거짓 실패**하게 됐다
            // (2026-09-14 실측: judge 는 broken 인데 채증 0바이트, effectiveId=unknown).
            // 진짜 claude 를 띄워 재는 길은 로그인 상태·기동 시간에 기대므로 회귀로 불안정하다.
            // `?.` 는 필수다 — 이 함수는 회귀가 **가짜 `this`** 로 직접 부른다
            // (`test/regression.cjs`: `profileForPane.call({app, notify}, tab)`).
            // 그 객체에 없는 필드를 그냥 읽으면 try/catch 가 삼켜 `undefined` 가 되고,
            // 회귀는 "프로필을 못 찾는다" 로 뒤집힌다. 이 메서드가 `notify?.`·`paneAgents?.` 를
            // 쓰는 이유도 같다.
            if (this.pinnedCount > 0) {
                const pinned = this.pinnedAgents.get(pane) ?? this.pinnedAgents.get(root)
                if (pinned) {
                    return detectProfileFor(pinned)
                }
            }
            // **훅이 말한 값이 있으면 화면을 읽지 않는다.** 아래 경로들은 "화면이 이렇게 생겼으니
            // codex 겠지" 류의 추정이다. 에이전트가 직접 말한 것이 있으면 그걸 쓴다.
            // 훅 값이 낡는 경우(그 에이전트가 끝나고 다른 CLI 가 뜸)는 `detectAgentApp` 이
            // 프로세스 트리로 걸러 `forgetAgent` 로 지운다 — 여기는 동기 경로라 프로세스를 묻지 않는다
            const hooked = this.notify?.agentOf?.(root)
            if (hooked) {
                return detectProfileFor(hooked)
            }
            const state = this.paneAgents?.get(pane)
            const x = pane?.frontend?.xterm
            const buffer = x?.buffer?.active
            const current = state?.session === pane.session ? state : undefined
            // Rendering, keyboard, wheel and the periodic screen check all use
            // this path. Recover from the live UI even if process/title probes
            // failed; never reuse a previous PTY's visible terminal contents.
            if (buffer && (!state || current) && (!current?.tracker.id || current.tracker.id === 'unknown')) {
                const visible = Array.from({ length: x.rows }, (_, i) =>
                    buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '')
                if (isLiveCodexScreen(visible)) {
                    const tracker = current?.tracker ?? new TerminalAgentTracker()
                    tracker.id = 'codex'
                    this.paneAgents?.set(pane, { session: pane.session, tracker })
                    this.tabAgents?.set(root, 'codex')
                    this.diag?.('agent stream recovered id=codex via=live-screen')
                    return detectProfileFor('codex')
                }
            }
            // **`unknown` 은 답이 아니라 "모른다" 다.** 예전에는 여기서 곧장 `undefined` 로 끝냈는데,
            // 화면 추적기는 출력에 따라 수시로 `unknown` 이 되므로 판정이 `codex ↔ undefined` 로 진동했다.
            // 이 값은 write 마다 불리는 자리라(커서 보정의 `enabled`), 진동이 곧 화면 깜빡임이 된다 —
            // 2026-09-15 실측: 30초에 `calls 473 / active 45`, 즉 428번이 "codex 아님" 으로 지나갔다.
            // 모를 때는 **마지막으로 알던 값**으로 내려간다 (아래 `profileForTab`).
            if (state?.session === pane.session && state?.tracker.id && state.tracker.id !== 'unknown') {
                return detectProfileFor(state.tracker.id)
            }
            const known = this.profileForTab(root)
            // Claude always keeps its existing input/rendering path. A cached
            // Codex identity may outlive that process when a shell is reused.
            if (known && known.id !== 'codex') { return known }
            if (!buffer) { return known }
            const from = Math.max(0, buffer.baseY - 60)
            const lines: string[] = []
            for (let i = from; i < buffer.baseY + x.rows; i++) {
                lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
            }
            const id = identifyScreenAgent(lines)
            if (id === 'claude') { return detectProfileFor('claude') }
            if (known) { return known }
            return id === 'unknown' ? undefined : detectProfileFor(id)
        } catch {
            return undefined
        }
    }

    private profileForTab (root: BaseTabComponent): AgentProfile | undefined {
        // 훅이 말한 것이 먼저다 — `tabAgents` 는 추측(프로세스·제목·화면)의 캐시다
        const hooked = this.notify?.agentOf?.(root)
        if (hooked) {
            return detectProfileFor(hooked)
        }
        const id = this.tabAgents.get(root)
        // `detectProfileFor` — 화면 문구가 실측되지 않은 에이전트(codex/gemini)는 판정 패턴만
        // 합집합으로 떨어진다. 프로필을 붙였다는 이유로 판정이 0.5.0 보다 나빠지면 안 된다
        return id && id !== 'unknown' ? detectProfileFor(id) : undefined
    }

    /**
     * pane.sendInput 을 한 번 감싸 PTY 로 나간 입력을 진단 로그에 남긴다.
     *
     * 붙여넣기 한 번에 텍스트가 두 번 들어가는 증상은 "우리가 두 번 불렀는지" 와
     * "한 번 불렀는데 PTY 에 두 번 써졌는지" 를 갈라야 원인이 잡힌다. 이 계측이 그 경계다.
     * `pasteProbeUntil` 창 안에서만 기록하므로 평소 타이핑은 남지 않는다.
     */
    private probeSendInput (pane: any): void {
        if (!pane || pane.__adSendInputProbe || typeof pane.sendInput !== 'function') {
            return
        }
        const orig = pane.sendInput.bind(pane)
        pane.__adSendInputProbe = true
        pane.sendInput = (data: any, ...rest: any[]) => {
            if (Date.now() < this.pasteProbeUntil) {
                const text = typeof data === 'string' ? data : String(data)
                this.diag(`sendInput len=${text.length} `
                    + `head=${JSON.stringify(text.slice(0, 24))} from=${this.callSite()}`)
            }
            return orig(data, ...rest)
        }
    }

    /**
     * PTY 로 나가는 최종 관문(session.write)을 랩핑한다.
     *
     * pane.sendInput 만 보면 그걸 거치지 않는 경로를 놓친다 — 실측(2026-08-28 09:44:03)에서
     * 우클릭 한 번에 sendInput 은 154바이트 1회뿐인데 화면에는 두 번 들어갔다. 즉 두 번째는
     * 우리 계측 밖의 경로다. session.write 는 어느 경로든 마지막에 지나가므로 여기서 잡힌다.
     */
    private probeWrite (pane: any): void {
        const session = pane?.session
        if (!session || session.__adWriteProbe || typeof session.write !== 'function') {
            return
        }
        const orig = session.write.bind(session)
        session.__adWriteProbe = true
        session.write = (data: any, ...rest: any[]) => {
            if (Date.now() < this.pasteProbeUntil) {
                const text = typeof data === 'string' ? data : String(data)
                this.diag(`write len=${text.length} `
                    + `head=${JSON.stringify(text.slice(0, 24))} from=${this.callSite()}`)
            }
            return orig(data, ...rest)
        }
    }

    /** 호출 지점 몇 프레임 — 두 번째 붙여넣기를 누가 넣는지 보려고 */
    private callSite (): string {
        return (new Error().stack ?? '').split(String.fromCharCode(10)).slice(3, 7)
            .map(l => l.trim().replace(/^at\s+/, '')).join(' <- ')
    }

    /** 클립보드에 이미지가 있고 텍스트는 비어 있는지 */
    private clipboardHasImageOnly (): boolean {
        const cb = getClipboard()
        if (!cb) {
            // Electron clipboard 를 못 쓰는 환경(웹 빌드 등) — 텍스트 붙여넣기로 떨어진다
            this.diag(`clipboard unavailable`)
            return false
        }
        try {
            const hasImage = !cb.readImage().isEmpty()
            const text = cb.readText()
            this.diag(`clipboard hasImage=${hasImage} textLen=${text.length}`)
            return hasImage && text.trim() === ''
        } catch (err) {
            this.diag(`clipboard read failed: ${err}`)
            return false
        }
    }

    /** 분할된 탭이면 래퍼가 아니라 실제 포커스된 pane 을 돌려준다 */
    private focusedPane (): any {
        const active = this.app.activeTab as any
        if (!active) {
            return null
        }
        return typeof active.getFocusedTab === 'function'
            ? (active.getFocusedTab() ?? active)
            : active
    }

    /**
     * 줄바꿈 핫키에 Shift+Enter 를 보정해 넣는다.
     *
     * config.yaml 에 이미 `agentdeck-newline` 이 저장돼 있으면 ConfigProvider 의 defaults 는
     * 무시되므로(저장값이 이긴다) 기동 시 코드로 채워 넣어야 한다 — ensurePasteHotkey 와 같은 이유.
     */
    private ensureNewlineHotkey (): void {
        const hotkeys = this.config.store.hotkeys
        if (!hotkeys || !Array.isArray(hotkeys['agentdeck-newline'])) {
            return
        }
        const list: string[] = hotkeys['agentdeck-newline']
        if (list.includes('Shift-Enter')) {
            return
        }
        hotkeys['agentdeck-newline'] = [...list, 'Shift-Enter']
        this.config.save()
    }

    // ---------- 우클릭 ----------

    /**
     * 우클릭 처리를 agentdeck 이 가져온다.
     *
     * 증상: 우클릭 한 번에 클립보드가 두 번 들어갔다.
     * 원인: Tabby 의 우클릭 처리는 터미널 host 엘리먼트에 건 버블 단계 mouseup 리스너인데
     * (`tabby-terminal/dist/index.js:40972` 에서 등록, `detach()` 는 이 리스너를 떼지 않는다)
     * 프론트엔드가 같은 host 에 다시 attach 되면 리스너가 겹쳐 붙어 mouseEvent$ 가 한 클릭에
     * 두 번 발화한다. 그러면 `handleRightMouseUp` 이 두 번 돌아 paste() 도 두 번 나간다.
     *
     * 해결: Tabby 쪽 처리를 끄고(terminal.rightClick = 'off') document 캡처 단계에서
     * 우리가 한 번만 처리한다. 캡처는 host 리스너보다 먼저 돌기 때문에 몇 개가 겹쳐 붙어 있든
     * stopPropagation 으로 전부 차단된다. 동작 자체는 Tabby 의 'clipboard' 모드와 동일하게 —
     * 선택이 있으면 복사, 없으면 붙여넣기, 길게 누르면 컨텍스트 메뉴 — 유지한다.
     */
    private claimRightClick (): void {
        if (!this.config.store.agentDeck.claimRightClick) {
            return
        }
        // Tabby 자체 처리를 꺼서 리스너가 겹쳐도 아무 일이 없게 만든다 (이중 안전장치)
        if (this.config.store.terminal && this.config.store.terminal.rightClick !== 'off') {
            this.config.store.terminal.rightClick = 'off'
            this.config.save()
        }

        document.addEventListener('mousedown', ev => {
            if (ev.button !== 2 || !this.inTerminalArea(ev)) {
                return
            }
            this.rightDownAt = Date.now()
            // mouseup 만 막으면 mousedown 이 xterm 까지 내려가 마우스 리포트가 PTY 로 나간다.
            // Claude Code 처럼 마우스 트래킹을 켠 앱은 그 우클릭 리포트(ESC [ < 2 ; x ; y M)를
            // 자기 붙여넣기 신호로 받아 스스로 클립보드를 읽는다 — 우리 paste 와 합쳐 두 번 붙는다
            // (2026-08-28 실측: .agentdeck-diag.log 09:49:08.616 에 "[<2;172;35M" 전송,
            //  플러그인 write 는 클릭당 1회뿐인데 화면에는 2회 들어감).
            ev.preventDefault()
            ev.stopPropagation()
        }, { capture: true })

        // 우클릭에 딸려오는 contextmenu 도 캡처에서 끊는다 (메뉴는 길게 누를 때 우리가 직접 띄운다)
        document.addEventListener('contextmenu', ev => {
            if (this.inTerminalArea(ev)) {
                ev.preventDefault()
                ev.stopPropagation()
            }
        }, { capture: true })

        document.addEventListener('mouseup', ev => {
            if (ev.button !== 2 || !this.inTerminalArea(ev)) {
                return
            }
            ev.preventDefault()
            ev.stopPropagation()

            // 같은 물리 클릭이 두 번 들어오면(리스너 중복) 뒤엣것은 버린다
            const now = Date.now()
            if (now - this.lastRightHandledAt < 150) {
                return
            }
            this.lastRightHandledAt = now

            const held = now - this.rightDownAt
            void this.handleRightClick(ev, held)
        }, { capture: true })
    }

    /** 사이드바가 아니라 터미널 뷰포트 안에서 일어난 이벤트인지 */
    private inTerminalArea (ev: MouseEvent): boolean {
        const target = ev.target as HTMLElement | null
        if (!target || typeof target.closest !== 'function') {
            return false
        }
        return !!target.closest('.content.main') && !target.closest(`#${SIDEBAR_ID}`)
    }

    private async handleRightClick (ev: MouseEvent, heldMs: number): Promise<void> {
        const pane = this.focusedPane()
        if (!pane) {
            return
        }

        const menuMs = this.config.store.agentDeck.rightClickMenuMs ?? 250
        if (heldMs >= menuMs) {
            if (typeof pane.buildContextMenu === 'function' && pane.platform) {
                pane.platform.popupContextMenu(await pane.buildContextMenu(), ev)
            }
            return
        }

        const selection = typeof pane.frontend?.getSelection === 'function'
            ? pane.frontend.getSelection()
            : ''
        if (selection) {
            pane.frontend.copySelection()
            pane.frontend.clearSelection()
        } else {
            // 우클릭 붙여넣기도 Ctrl+V 와 같은 경로를 타게 한다 (이미지면 Alt+V 위임)
            this.doPaste('rightclick')
        }
    }

    /**
     * 포커스된 pane 에 0x0A(LF) 를 보낸다 — Ctrl+J 가 보내는 것과 같은 바이트다.
     * Claude Code 는 이걸 줄바꿈으로 받고, Enter(0x0D) 는 전송으로 받는다.
     * Enter 를 눌러 줄을 넘기지 않으려는 것이므로 CR 을 섞으면 안 된다.
     */
    private sendNewline (): void {
        const pane = this.focusedPane()
        if (!pane) {
            return
        }
        if (typeof pane.sendInput === 'function') {
            // 조합 중인 음절이 이 LF 보다 먼저 나가게 순서를 맞춘다 (sendToPane 주석).
            // Shift+Enter 로 조합 중인 음절이 새 줄로 따라가던 원인이 바로 이 직접 쓰기다
            // (2026-09-08 사용자 재보고) — 여기는 xterm 을 거치지 않으므로 동기 확정이 걸리지 않는다.
            const sequence = newlineSequence(this.profileForPane(pane)?.id)
            this.diag(`newline agent=${this.profileForPane(pane)?.id ?? 'unknown'} sequence=${JSON.stringify(sequence)}`)
            this.sendToPane(pane, 'newline', () => pane.sendInput(sequence))
        }
    }

    // ---------- 레이아웃 ----------

    private get enabled (): boolean {
        return this.config.store.agentDeck.enabled
    }

    private applyEnabled (): void {
        document.body.classList.toggle(BODY_CLASS, this.enabled)
        if (this.sidebar) {
            this.sidebar.style.display = this.enabled ? '' : 'none'
        }
        // 레이아웃을 끄면 미리보기도 같이 숨는다 (열림 상태는 설정에 그대로 남긴다)
        this.view?.setVisible(this.enabled)
        if (!this.enabled && this.mainEl) {
            for (const prop of ['flex', 'width', 'max-width', 'height',
                'margin-left', 'margin-right', 'margin-top', 'margin-bottom']) {
                this.mainEl.style.removeProperty(prop)
            }
            // 폭을 되돌렸으니 메모도 무효화하고 터미널에 새 폭을 알린다
            this.lastTermW = -1
            this.lastSidebarW = -1
            this.lastViewW = -1
            this.lastViewSide = null
            this.lastDock = null
            this.lastBoxKey = ''
            this.scheduleRefit()
        }
        this.syncBackgroundClip()
    }

    /**
     * tabby-background 의 이미지 레이어를 터미널 영역(`.content.main`)에 맞춰 자른다.
     *
     * 그 레이어는 `position: fixed` 라 viewport 좌표를 쓰므로 `getBoundingClientRect()` 값을
     * 그대로 CSS 변수로 내리면 된다 (styles.scss 가 `!important` 로 덮어쓴다).
     * relayout 직후에는 인라인 폭이 아직 레이아웃에 반영되지 않았을 수 있어 rAF 한 번 뒤에 잰다.
     * 꺼져 있으면(또는 agentdeck 비활성) 클래스와 변수를 걷어 순정(창 전체)으로 되돌린다.
     */
    private syncBackgroundClip (): void {
        const root = document.documentElement
        const clear = (): void => {
            document.body.classList.remove(BG_CLIP_CLASS)
            for (const v of ['--ad-bg-left', '--ad-bg-top', '--ad-bg-width', '--ad-bg-height']) {
                root.style.removeProperty(v)
            }
        }
        if (!this.enabled || !this.config.store.agentDeck.clipBackgroundToTerminal || !this.mainEl) {
            clear()
            return
        }
        requestAnimationFrame(() => {
            if (!this.enabled || !this.mainEl) {
                clear()
                return
            }
            const r = this.mainEl.getBoundingClientRect()
            if (r.width <= 0 || r.height <= 0) {
                return
            }
            root.style.setProperty('--ad-bg-left', Math.round(r.left) + 'px')
            root.style.setProperty('--ad-bg-top', Math.round(r.top) + 'px')
            root.style.setProperty('--ad-bg-width', Math.round(r.width) + 'px')
            root.style.setProperty('--ad-bg-height', Math.round(r.height) + 'px')
            document.body.classList.add(BG_CLIP_CLASS)
        })
    }

    /**
     * 터미널/사이드바 배경에 알파를 넣어 tabby-background 의 배경 이미지가 비치게 한다.
     *
     * 배경 이미지는 `.content-tab-active::before` 로 **모든 내용 뒤에** 깔린다. 그래서
     * 그 위를 덮는 두 면이 불투명하면 이미지는 어디에도 보이지 않는다 —
     *  (1) 터미널: xterm 이 컬러스킴 background 색으로 셀을 직접 칠한다 (CSS 로는 못 뚫는다)
     *  (2) 사이드바 / .window: 우리가 넣은 불투명 배경
     * (1) 은 Tabby 가 xterm 을 `allowTransparency: true` 로 만들기 때문에 색에 알파만 넣으면 된다.
     * config.yaml 을 손으로 고쳐도 Tabby 가 종료할 때 메모리 값으로 덮어써 되돌아가므로,
     * ensurePasteHotkey 와 같은 이유로 여기서 코드로 보정한다.
     */
    private applyOpacity (): void {
        const cfg = this.config.store.agentDeck
        const termPct = clampPct(cfg.terminalOpacity)
        const sidePct = clampPct(cfg.sidebarOpacity)

        // 사이드바 / 창 여백 — CSS 변수로 내려보낸다 (styles.scss 가 폴백을 들고 있다)
        const root = document.documentElement
        if (sidePct >= 100) {
            root.style.removeProperty('--ad-panel-bg')
        } else {
            root.style.setProperty('--ad-panel-bg', `rgba(30, 33, 39, ${sidePct / 100})`)
        }

        // 터미널 — 컬러스킴 배경색에 알파를 붙인다
        const scheme = this.config.store.terminal?.colorScheme
        if (!scheme?.background) {
            return
        }
        const next = withAlpha(scheme.background, termPct)
        // 컬러스킴 기반 배경을 쓰도록 못 박는다 — 테마 배경으로 떨어지면 알파가 무시된다
        const wantMode = termPct < 100 ? 'colorScheme' : this.config.store.terminal.background
        if (next === scheme.background && wantMode === this.config.store.terminal.background) {
            // 이미 적용돼 있다. 여기서 save 를 부르면 changed$ 가 다시 우리를 부른다
            return
        }
        scheme.background = next
        this.config.store.terminal.background = wantMode
        this.config.save()
    }

    /** 지금 사이드바가 붙어 있는 방향 (설정값이 망가져 있으면 오른쪽으로 본다) */
    private get dockSide (): DockSide {
        const v = this.config.store.agentDeck.sidebarDock
        return isDockSide(v) ? v : 'right'
    }

    /**
     * 배치의 기준이 되는 **눈에 보이는** 창 영역 — viewport 와 `.window` 의 교집합.
     *
     * `windowEl.clientWidth` 를 그대로 쓰면 안 된다. `.window` 의 박스가 viewport 보다 넓어져
     * 있는 화면이 실제로 나온다 (2026-09-14 실측: 설정 탭에서 터미널 오른쪽에 100px 쯤 빈 띠가
     * 남고, 사이드바는 그만큼 화면 밖으로 밀려 검색창·줄이 오른쪽에서 잘렸다). 그 폭으로 나누면
     * 사이드바 몫의 일부가 화면 밖에 떨어지고, 화면 안에서는 아무도 안 쓰는 띠로 보인다.
     * 보이는 범위로 잘라 두면 창이 어떤 크기든 그 안에서만 나눈다.
     */
    private visibleBox (): { left: number, top: number, width: number, height: number } {
        const r = this.windowEl!.getBoundingClientRect()
        const vw = document.documentElement.clientWidth || window.innerWidth || r.width
        const vh = document.documentElement.clientHeight || window.innerHeight || r.height
        const left = Math.max(r.left, 0)
        const top = Math.max(r.top, 0)
        return {
            left,
            top,
            width: Math.max(0, Math.round(Math.min(r.right, vw) - left)),
            height: Math.max(0, Math.round(Math.min(r.bottom, vh) - top)),
        }
    }

    /**
     * 절대 배치의 기준점 — 컨테이닝 블록(위치 지정 조상의 **패딩 박스**) 왼쪽 위를 viewport 좌표로.
     *
     * `right: 0` 으로 가장자리에 붙이던 것을 실좌표(`left`)로 바꾼 이유가 이것이다 —
     * 그 `0` 이 어느 박스의 오른쪽인지가 화면마다 다르고, 그 박스가 화면보다 넓으면
     * 사이드바가 화면 밖에 앉는다. 기준점을 재서 좌표를 직접 주면 어느 쪽이든 같은 자리다.
     */
    private anchorOrigin (): { left: number, top: number } {
        const parent = this.sidebar?.offsetParent as HTMLElement | null
        // 위치 지정 조상이 없으면 기준은 초기 컨테이닝 블록(viewport)이다.
        // `offsetParent` 는 그때 body 를 돌려주지만 컨테이닝 블록은 body 가 아니다
        if (!parent || getComputedStyle(parent).position === 'static') {
            return { left: 0, top: 0 }
        }
        const r = parent.getBoundingClientRect()
        const cs = getComputedStyle(parent)
        return {
            left: r.left + (parseFloat(cs.borderLeftWidth) || 0),
            top: r.top + (parseFloat(cs.borderTopWidth) || 0),
        }
    }

    /**
     * 사이드바가 차지할 크기를 px 로 정한다 — 좌/우면 폭, 상/하면 높이.
     *
     * 사용자가 경계선을 한 번이라도 끌었으면 그 값(`sidebarWidth`/`sidebarHeight`)이 진실이다.
     * 아직 안 끌었다면(폭이 0) 예전처럼 화면비로 터미널 폭을 역산해 남는 만큼을 사이드바가 갖는다.
     */
    private sidebarExtent (availW: number, availH: number, winH: number): number {
        const cfg = this.config.store.agentDeck
        if (isHorizontalDock(this.dockSide)) {
            const minSidebar = cfg.sidebarMin || 200
            const maxSidebar = Math.max(cfg.sidebarMax || 560, minSidebar)
            let want = cfg.sidebarWidth || 0
            if (!want) {
                // 화면비를 지킨다는 가정에서 터미널 폭을 높이로 역산하고 남는 폭을 사이드바에 준다
                const ratio = (cfg.aspectW || 4) / (cfg.aspectH || 3)
                let termW = Math.round(availH * ratio)
                termW = Math.min(termW, availW - minSidebar)
                termW = Math.max(termW, MIN_TERM_W)
                want = availW - termW
            }
            // 손으로 끈 값은 설정의 min/max 를 넘어설 수 있다 — 마우스가 우선이므로
            // 목록이 읽히는 최소 폭과 터미널이 남을 최대 폭까지만 막는다
            const hardMin = cfg.sidebarWidth ? MIN_SIDEBAR_W : minSidebar
            const hardMax = Math.max(availW - MIN_TERM_W, hardMin)
            const softMax = cfg.sidebarWidth ? Math.max(maxSidebar, cfg.sidebarWidth) : maxSidebar
            return Math.min(Math.max(want, hardMin), softMax, hardMax)
        }
        // 세로 도킹은 창 높이를 기준으로 잡는다 — 터미널 높이(availH)는 사이드바를 뺀 값이라
        // 그걸로 클램프하면 잴 때마다 값이 줄어드는 되먹임이 생긴다
        const want = cfg.sidebarHeight || 200
        return Math.min(Math.max(want, MIN_SIDEBAR_H), Math.max(winH - MIN_TERM_H, MIN_SIDEBAR_H))
    }

    /** 사이드바를 창 한쪽에 붙이고, 남는 자리를 `.content.main` 이 갖게 한다 */
    private relayout (): void {
        if (!this.enabled || !this.windowEl) {
            this.diagOnce('relayout-skip-enabled', `relayout skipped enabled=${this.enabled} windowEl=${!!this.windowEl}`)
            return
        }
        // appRoot 가 늦게 렌더되는 경우가 있어 매번 다시 찾는다
        if (!this.mainEl) {
            this.mainEl = document.querySelector('.content.main')
        }
        if (!this.mainEl) {
            this.diagOnce('relayout-skip-mainel', 'relayout skipped mainEl=null')
            return
        }

        // 나누는 기준은 **보이는 영역**이다 (visibleBox 주석)
        const box = this.visibleBox()
        const availW = box.width
        // 화면비로 폭을 역산할 때 쓰는 높이는 터미널이 실제로 쓰는 높이여야 한다.
        // 창 높이를 쓰면 탭바 등을 뺀 만큼 폭이 과대 계산돼 사이드바가 좁아진다
        const availH = this.mainEl.clientHeight || box.height
        if (!availW || !availH) {
            return
        }

        const side = this.dockSide
        const horizontal = isHorizontalDock(side)

        // 미리보기 패널이 먼저 자기 폭을 갖고, 사이드바는 그 나머지 안에서 화면비를 계산한다.
        // **여기서 4:3 이 완화된다** — 패널을 열면 터미널이 그만큼 좁아진다(사이드바는 안 줄어든다).
        // 반대로 하면(터미널 4:3 고정) 창이 좁을 때 패널이 열릴 자리가 없다 (2026-09-08 결정).
        const viewSide = this.viewSide
        // 패널이 써도 되는 폭 = 창폭 − 터미널 최소 − 사이드바 최소.
        // 이 계산이 없으면 좁은 창에서 패널이 터미널 자리까지 먹는다
        const viewRoom = availW - MIN_TERM_W - (horizontal ? MIN_SIDEBAR_W : 0)
        const viewW = Math.round(this.view?.extent(viewRoom) ?? 0)
        const layoutW = Math.max(availW - viewW, MIN_TERM_W)
        let extent = Math.round(this.sidebarExtent(layoutW, availH, box.height))
        // 사이드바/패널이 가로로 먹는 몫을 빼고 남는 것이 터미널 폭이다
        const sideW = horizontal ? extent : 0
        const leftPad = (side === 'left' ? sideW : 0) + (viewSide === 'left' ? viewW : 0)
        const rightPad = (side === 'right' ? sideW : 0) + (viewSide === 'right' ? viewW : 0)
        let termW = availW - leftPad - rightPad

        // 터미널 폭을 문자 셀의 정수배로 깎는다.
        //
        // 셀 폭으로 나누어떨어지지 않으면 오른쪽에 셀 하나가 안 되는 자투리가 남는데,
        // fit() 은 그 자투리를 두고 창이 몇 px 만 흔들려도 열 수가 오르내린다. 열 수가 바뀔 때마다
        // pty 에 새 크기가 나가고 TUI 는 전체를 다시 그린다 — 화면이 깜빡이고 어긋날 틈이 생긴다.
        // 정수배로 맞춰 두면 자투리가 사라져 열 수가 흔들리지 않는다. 깎아 낸 픽셀은 사이드바가 갖는다.
        // 한때 이 자리에서 터미널 폭을 문자 셀의 정수배로 깎았다. 자투리 픽셀을 없애려던 건데
        // 오히려 화면이 계속 밀리는 원인이 됐다 — 셀 폭은 폰트가 자리를 잡는 동안 조금씩 다르게
        // 잡히고(2026-09-01 실측: 같은 창에서 termW 가 1977 -> 1970 -> 1974 로 진동),
        // 폭이 바뀔 때마다 pty 를 다시 맞추고 TUI 를 다시 그리게 만들었다.
        // 폭은 사용자가 정한 사이드바 크기에서 곧장 나오는 값 하나로 고정하는 편이 안정적이다.
        // 남는 자투리는 어차피 배경색이라 눈에 띄지 않는다.
        extent = Math.round(extent)
        termW = Math.round(termW)

        // 값이 그대로면 DOM 을 건드리지 않는다 — relayout 은 탭/상태가 바뀔 때마다 불리므로
        // 매번 스타일을 다시 쓰면 xterm 이 불필요하게 재측정한다
        // 미리보기 패널의 방향도 메모에 넣어야 한다 — 폭이 그대로인 채 좌↔우만 바뀌는 경우가
        // 있고(설정 변경), 그때 여기서 되돌아가면 패널이 옛 자리에 남는다 (2026-09-08 실측)
        // 창 박스가 **자리만** 옮긴 경우도 다시 그려야 한다 — 폭·몫이 그대로여도 절대 좌표가
        // 달라지므로, 여기서 되돌아가면 사이드바가 옛 자리에 남는다
        const boxKey = box.left + ':' + box.top
        if (termW === this.lastTermW && extent === this.lastSidebarW && side === this.lastDock
            && viewW === this.lastViewW && viewSide === this.lastViewSide && boxKey === this.lastBoxKey) {
            return
        }
        this.lastBoxKey = boxKey
        this.lastTermW = termW
        this.lastSidebarW = extent
        this.lastDock = side
        this.lastViewW = viewW
        this.lastViewSide = viewSide

        // 기동 직후 흔들기(rearm kick)는 폐지했다 — 아래 relayout 주석 참고.

        // 사이드바는 창 위에 절대 배치한다. flex 자식으로 두면 도킹 방향을 바꿀 때마다
        // `.window` 의 flex-direction 을 뒤집어야 하고, 그러면 같은 줄에 있는 profile-tree 까지
        // 따라 움직인다. 절대 배치면 우리 것만 옮기면 된다.
        // 가장자리 붙이기(`right: 0`)가 아니라 **잰 좌표**로 앉힌다 — anchorOrigin 주석 참고
        const origin = this.anchorOrigin()
        if (this.sidebar) {
            const s = this.sidebar.style
            s.position = 'absolute'
            s.left = Math.round(box.left - origin.left + (side === 'right' ? box.width - extent : 0)) + 'px'
            s.top = Math.round(box.top - origin.top + (side === 'bottom' ? box.height - extent : 0)) + 'px'
            s.right = 'auto'
            s.bottom = 'auto'
            s.width = (horizontal ? extent : box.width) + 'px'
            s.height = (horizontal ? box.height : extent) + 'px'
            for (const d of DOCK_SIDES) {
                this.sidebar.classList.toggle('ad-dock-' + d, d === side)
            }
        }

        // 터미널이 차지할 자리.
        //
        // 가로 도킹에서는 폭을 px 로 못 박는다. margin 만 주고 flex 에게 남는 폭을 맡겨 봤더니
        // (2026-09-01) xterm 이 fit 할 때 잡는 폭과 TUI 가 아는 폭이 어긋나 입력창이 깨졌다 —
        // 가로선과 입력 텍스트가 한 줄에 섞여 wrap 되는 그 증상이다. 폭을 직접 주면 xterm host 가
        // 재는 값이 곧 우리가 정한 값이라 어긋날 여지가 없다.
        // 세로 도킹은 폭을 건드릴 필요가 없고, `h-100`(height:100%) 때문에 margin 만으로는
        // 그만큼 창 밖으로 넘치므로 높이를 대신 깎는다.
        // 미리보기 패널도 사이드바와 같은 자리를 나눠 쓴다 — 같은 쪽에 붙었으면 사이드바가
        // 창 가장자리(바깥), 패널이 터미널 쪽(안)이다
        const viewOuter = side === viewSide ? sideW : 0
        this.view?.layout(viewSide, {
            left: Math.round(box.left - origin.left
                + (viewSide === 'left' ? viewOuter : box.width - viewW - viewOuter)),
            top: Math.round(box.top - origin.top),
            width: viewW,
            height: box.height,
        })

        const m = this.mainEl.style
        // 폭을 못 박아야 하는 경우: 가로 도킹이거나, 세로 도킹이어도 미리보기 패널이 폭을 먹을 때
        if (horizontal || viewW > 0) {
            // 왼쪽에 붙은 것(사이드바/패널)만큼 앞자리를 비운다.
            // 오른쪽 것들은 고정폭만으로 자리가 남는다 (둘 다 절대 배치라서)
            m.marginLeft = leftPad + 'px'
            m.marginRight = '0'
            // 여백을 적은 **뒤에** 실제 시작점을 재서 오른쪽 경계까지 정확히 채운다.
            // `termW` 는 "보이는 폭에서 몫을 뺀 값" 이라 `.content.main` 이 창 왼쪽에서
            // 시작한다는 가정이 깔려 있다 — 앞에 형제가 있거나 박스가 어긋나 있으면
            // 그만큼 오른쪽에 빈 띠가 남는다. 시작점을 재면 그 가정이 필요 없다.
            const startX = this.mainEl.getBoundingClientRect().left
            termW = Math.max(MIN_TERM_W, Math.round(box.left + box.width - rightPad - startX))
            m.flex = '0 0 ' + termW + 'px'
            m.width = termW + 'px'
            m.maxWidth = termW + 'px'
        } else {
            m.removeProperty('flex')
            m.removeProperty('width')
            m.removeProperty('max-width')
            m.marginLeft = '0'
            m.marginRight = '0'
        }
        if (horizontal) {
            m.removeProperty('height')
            m.marginTop = '0'
            m.marginBottom = '0'
        } else {
            m.marginTop = side === 'top' ? extent + 'px' : '0'
            m.marginBottom = side === 'bottom' ? extent + 'px' : '0'
            // **`important` 가 필요하다.** `.content.main` 에는 부트스트랩 `h-100` 클래스가 붙어
            // 있고 그 규칙이 `height: 100% !important` 라, 평범한 인라인 스타일은 진다.
            // 그래서 상하 도킹에서 터미널 높이가 전혀 줄지 않았다 — bottom 이면 아래쪽이
            // 사이드바에 가리고, top 이면 그만큼 창 밖으로 넘쳤다
            // (2026-09-02 실측, 창 1100x700 / 사이드바 200: 인라인은 `calc(100% - 200px)` 인데
            //  computed 는 `700px`, host 는 top 에서 `1070x670@y=215` 로 하단 185px 가 잘렸다).
            m.setProperty('height', 'calc(100% - ' + extent + 'px)', 'important')
        }

        this.dock?.syncHandle()
        this.syncBackgroundClip()
        // 우리가 하는 일은 여기까지다 — **폭을 정해 `.content.main` 에 적고 fit 한 번.**
        //
        // 2026-09-02 방향 전환(유저 지적): "Tabby 는 창 크기가 어떻든 알아서 줄맞춤 되잖아?" 맞다.
        // 순정 경로는 xterm `ResizeObserver` → `fitAddon.fit()` → `session.resize()` 이고,
        // 우리가 폭만 정해 주면 그 뒤는 Tabby 가 스스로 계산한다.
        // 예전에는 "순정이 우리 CSS 변경을 못 따라온다"고 보고 보정을 4겹 쌓았다 —
        // relayout 시 fit / `watchSize`(250ms 마다 fit+resize, 6초) / `syncPtySize` 재전송 사슬 /
        // `nudgePtyRedraw`(cols-1↔cols 흔들기). 그 겹침이 순정 수렴과 경쟁하면서
        // 프레임을 반쯤 그린 상태를 남겼고, 그게 실사용 깨짐의 정체였다(항목 24~28 은 전부 그 부작용).
        // 전제도 로그로 반박됐다 — 폭은 탭이 생기기 전에 이미 확정돼 있는데도
        // (`rearm kick termW -1->2000 panes=0`) 새 탭 xterm 이 254 로 뜬다. 그건 레이아웃 확정 전의
        // 초기 측정값일 뿐이고 순정 옵저버가 어차피 수렴시킨다.
        // 그래서 자동 보정은 전부 걷어냈다. 남은 건 이 fit 하나(순정 경로를 깨우는 용도)다.
        this.scheduleRefit()
        // 폭이 어긋나는 사고를 다시 만나면 이 줄이 실제 값을 알려 준다 —
        // 우리가 정한 값(termW)과 브라우저가 실제로 준 폭(clientWidth)이 다르면 그게 원인이다
        this.diag(`relayout dock=${side} avail=${availW}x${availH}`
            + ` extent=${extent} termW=${termW} mainW=${this.mainEl.clientWidth}`)
    }

    /**
     * 폭을 바꿨으면 터미널에 반드시 알려야 한다.
     *
     * Tabby 의 xterm 프론트엔드는 창(OS 창) 리사이즈에 맞춰 재측정하지만,
     * 우리처럼 CSS 로만 `.content.main` 폭을 바꾸면 그 경로를 타지 않는다.
     * 그러면 xterm 의 열 수는 넓어졌는데 pty 는 옛 폭 그대로라, Claude Code 같은
     * 전체화면 TUI 가 화면보다 좁게 그리고 오른쪽에 지워지지 않은 잔상이 남는다
     * (2026-08-28 실측: 입력창 구분선이 화면 중간에서 끊기고 옛 statusline 이 우측에 박혀 있었다.
     *  창을 복원→최대화로 흔들면 OS 리사이즈 경로를 타서 즉시 정상 복구됐다).
     *
     * fitAddon.fit() 이 xterm 의 onResize 를 발화시키고, Tabby 가 그걸 받아
     * session.resize() 로 pty 까지 내려보낸다. 값이 같으면 xterm 이 이벤트를 내지 않으므로
     * 여분 호출은 무해하다.
     */
    private scheduleRefit (): void {
        if (this.refitQueued) {
            return
        }
        this.refitQueued = true
        // 레이아웃이 실제로 반영된 뒤에 재야 한다 — 한 프레임으로는 아직 옛 폭이 잡힌다
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.refitQueued = false
            this.refitTerminals()
        }))
        // attach() 가 아직 진행 중이면 위 fit 이 무시될 수 있다. fit 은 크기가 같으면
        // 아무 일도 안 하므로 한 번 더 늦게 때려도 무해하다
        setTimeout(() => this.refitTerminals(), 500)
    }

    private refitTerminals (): void {
        for (const tab of this.app.tabs) {
            const anyTab = tab as any
            const panes: BaseTabComponent[] = typeof anyTab.getAllTabs === 'function'
                ? anyTab.getAllTabs()
                : [tab]
            for (const pane of panes) {
                const frontend = (pane as any).frontend
                const fitAddon = frontend?.fitAddon
                if (!fitAddon || typeof fitAddon.fit !== 'function') {
                    continue
                }
                // 숨겨진 탭은 컨테이너 폭이 0 이라 fit 하면 1열짜리로 줄어든다 — 건너뛴다.
                // 그 탭은 다시 선택될 때 Tabby 가 알아서 재측정한다
                const host = frontend.xterm?.element?.parentElement
                if (!host || !host.clientWidth || !host.clientHeight) {
                    continue
                }
                try {
                    fitAddon.fit()
                } catch {
                    // 아직 붙지 않은 프론트엔드 — 다음 relayout 때 다시 잡힌다
                }
                // 여기서 끝낸다. 예전에는 뒤이어 `syncPtySize` 로 pty 에 직접 크기를 쐈는데,
                // fit() 이 이미 순정 경로(onResize → session.resize)를 태우므로 중복이고,
                // 그 중복이 순정 수렴과 경쟁해 화면을 깨뜨렸다 (2026-09-02).
            }
        }
    }

    /**
     * pty 크기를 xterm 이 실제로 그리고 있는 크기에 강제로 맞춘다.
     *
     * `fitAddon.fit()` 은 xterm 의 열/행이 이미 맞으면 onResize 를 내지 않는다. 그런데 새 탭은
     * xterm 은 우리가 줄여 놓은 폭으로 제대로 열리는데 **세션(pty)만** 생성 시점의 옛 폭으로 남는
     * 경우가 있다. 이때 fit() 은 no-op 이라 pty 가 영영 안 고쳐지고, TUI 가 처음 화면을 다시
     * 그리는 순간(줄바꿈 등) 오른쪽에 옛 폭 잔상이 남는다 — 창 복원→최대화로 흔들면 OS 리사이즈
     * 경로를 타서 그제야 맞는다(2026-08-28 실측, 새 탭에서 재현).
     *
     * 그래서 fit() 뒤에 pty 로 직접 한 번 더 내려보낸다. 같은 값이면 pty 쪽에서 무시되므로 무해하다.
     */
    private syncPtySize (pane: BaseTabComponent, frontend: any): void {
        const cols = frontend?.xterm?.cols
        const rows = frontend?.xterm?.rows
        if (!cols || !rows) {
            return
        }
        const anyPane = pane as any
        const session = anyPane.session
        if (!session || !session.open || typeof session.resize !== 'function') {
            return
        }
        // 이 경로는 지금까지 조용했다. 그래서 "언제 pty 폭이 바뀌었나" 가 로그에 안 남아
        // 어긋남 사고를 만나도 발생 지점을 못 짚었다 (watchSize 의 `size fix` 만 남았다).
        // 값이 실제로 달라질 때만 남긴다 — 같은 값 재전송은 매 refit 마다 일어나므로 시끄럽다.
        const prev = anyPane.size
        if (prev?.columns !== cols || prev?.rows !== rows) {
            this.diag(`pty resize ${prev?.columns}x${prev?.rows}`
                + ` -> ${cols}x${rows}`)
        }
        try {
            session.resize(cols, rows)
            anyPane.size = { columns: cols, rows }
        } catch (e: any) {
            // 세션이 막 닫혔다 — 다음 refit 때 다시 잡힌다
            diagCatch('pty resize', e)
            return
        }

        // **보냈다고 도착한 것이 아니다.**
        //
        // 세션이 막 열린 직후의 `session.resize()` 는 pty 에 닿지 못하고 유실된다
        // (2026-09-01 실측: `size fix 254x78 -> 280x78` + `pty resize` + `redraw nudge` 가
        //  모두 돌고 `pane.size` 도 280 으로 남았는데, 같은 탭 셸에 물어보니 `PTYW=254`.
        //  같은 호출을 몇 초 뒤에 CDP 로 하면 그때는 정상 반영된다 — 초기화 경합이다).
        // 그런데 `pane.size` 에 낙관적으로 280 을 적어 두므로, 크기 감시(watchSize)는
        // "이제 맞다" 고 보고 손을 뗀다. 그 뒤에 뜨는 TUI 는 254 폭으로 첫 화면을 그린다.
        //
        // 그래서 값이 실제로 바뀐 경우에만 같은 크기를 몇 번 더 보낸다. pty 크기가 이미
        // 그 값이면 아무 일도 일어나지 않으므로(SIGWINCH 도 안 난다) 재전송은 무해하다.
        if (prev?.columns !== cols || prev?.rows !== rows) {
            for (const delay of PTY_RESIZE_RETRY_MS) {
                setTimeout(() => {
                    const now = anyPane.frontend?.xterm
                    // 그동안 폭이 또 바뀌었으면 그쪽 경로가 새 값을 보낸다 — 옛 값을 덮어쓰지 않는다
                    if (!anyPane.session?.open || now?.cols !== cols || now?.rows !== rows) {
                        return
                    }
                    try {
                        anyPane.session.resize(cols, rows)
                    } catch (e: any) {
                        // 세션이 닫혔다
                        diagCatch('pty resize retry', e)
                    }
                }, delay)
            }
        }
    }

    /**
     * pty 크기만 한 칸 줄였다 되돌려 TUI 가 화면을 다시 그리게 한다. **수동 복구 전용.**
     *
     * 자동 경로에서는 전부 걷어냈다 — 이 흔들기가 순정 수렴과 경쟁하며 깨진 화면을
     * 만들어 왔다(2026-09-02). 남겨 둔 이유는 `repairPane`(사이드바 `↻` / `agentdeck-repair`)
     * 때문이다. 거기서는 사용자가 "지금 깨졌으니 고쳐라" 를 명시로 눌렀고, 크기를 맞추는
     * 것만으로는 앱이 다시 그리지 않는 경우가 실제로 있다 — 폭이 **실제로 바뀌어야**
     * SIGWINCH 가 나가므로 한 칸 흔들어 두 번 내보낸다. 뒤이어 `Ctrl+L` 이 따라간다.
     *
     * 좁힌 값을 `pane.size` 에 그대로 적는다. 되돌리기가 유실됐는데 낙관적으로 `cols` 를
     * 적어 두면 아무도 어긋남을 못 보고 한 열 좁은 채로 굳는다(옛 버그).
     */
    private nudgePtyRedraw (pane: BaseTabComponent, trace?: PerformanceTrace): void {
        const anyPane = pane as any
        const session = anyPane.session
        const cols = anyPane.frontend?.xterm?.cols
        const rows = anyPane.frontend?.xterm?.rows
        if (!session?.open || typeof session.resize !== 'function' || !(cols > 1) || !(rows > 1)) {
            return
        }
        this.diag(`redraw nudge ${cols}x${rows}`)
        try {
            session.resize(cols - 1, rows)
            anyPane.size = { columns: cols - 1, rows }
            const restoreAt = perfNow() + 60
            setTimeout(() => {
                if (!anyPane.session?.open) {
                    return
                }
                // 되돌릴 값은 "지금" 의 xterm 폭이다 — 흔드는 사이 사이드바가 움직였을 수 있다
                this.syncPtySize(pane, anyPane.frontend)
                trace?.mark('pty-restored', `timerLagMs=${Math.max(0, perfNow() - restoreAt).toFixed(1)}`)
            }, 60)
        } catch {
            // 세션이 막 닫혔다
        }
    }

    // 크기 감시(`watchSize` / `watchAllSizes`)도 폐지했다 (2026-09-02).
    //
    // 250ms 마다 `fitAddon.fit()` + `session.resize()` 를 6초간 쏘던 장치다. 목적은
    // "xterm 은 넓어졌는데 pty 는 옛 폭" 을 잡는 것이었는데, 그 어긋남은 순정
    // ResizeObserver 가 이미 수렴시킨다. 우리 감시는 그 수렴 도중의 중간값을 보고
    // 계속 끼어들었고, 끝에 `nudgePtyRedraw` 흔들기까지 붙여 화면을 깨뜨렸다.
    // 순정이 정말 못 맞추는 경우가 나오면 `screenWatch` 채증에 남는다 — 그때 근거를 갖고 되켠다.

    // ---------- 사이드바 DOM ----------

    private buildSidebar (): void {
        const el = document.createElement('div')
        el.id = SIDEBAR_ID
        el.innerHTML = [
            '<div class="ad-head">',
            '  <span class="ad-head-title">AGENT DECK</span>',
            '  <span class="ad-head-count"></span>',
            '</div>',
            // 검색 줄은 헤더와 목록 **사이**에 둔다. 목록 안에 넣으면 render() 가 지우고,
            // 헤더 안에 넣으면 200px 사이드바에서 제목·집계 칩과 자리를 다툰다.
            '<div class="ad-search">',
            '  <input class="ad-search-input" type="text" spellcheck="false"',
            '         placeholder="' + this.ui('세션 검색 (제목 · 작업이름 · 폴더)') + '">',
            this.uiMarkup('  <button class="ad-search-clear" type="button" title="검색·필터 지우기 (Esc)">&times;</button>'),
            '</div>',
            '<div class="ad-list"></div>',
            // 지난 세션 서랍. **목록 밖, "지금 이 탭" 줄 바로 위**에 고정한다
            // (2026-09-14 유저: "지난세션을 항상 여기 위에 붙이고 위로 펼쳐지게 하자").
            // 줄 순서가 [목록][헤더] 인 것도 그래서다 — 헤더가 제자리에 박혀 있고
            // 펼친 목록이 그 **위로** 자라야 "위로 펼쳐진다" 가 된다.
            '<div class="ad-resume-drawer" hidden>',
            '  <div class="ad-resume-rows"></div>',
            '  <div class="ad-resume-head"></div>',
            '</div>',
            // "지금 이 탭" 줄. 목록 **밖**에 둔다 — 목록 안이면 render() 가 매번 지우고,
            // 검색이 아무것도 못 찾은 화면(목록이 빈 상태)에서도 이 줄은 남아 있어야 한다
            '<div class="ad-now" hidden>',
            '  <div class="ad-now-title"></div>',
            this.uiMarkup('  <button type="button" class="ad-now-account" title="계정 선택" aria-haspopup="dialog"></button>'),
            '  <div class="ad-now-gauges"></div>',
            '</div>',
            '<div class="ad-foot">',
            this.uiMarkup('  <button class="ad-btn ad-new" title="새 탭">+ 새 탭</button>'),
            this.uiMarkup('  <button class="ad-btn ad-settings" title="설정">설정</button>'),
            // 화면이 깨졌을 때 누르는 자리 — 창을 복원→최대화로 흔들던 것을 대신한다.
            // 자주 쓰는 두 버튼(새 탭·설정) 뒤에 둔다 (2026-09-01 유저 요청)
            this.uiMarkup('  <button class="ad-btn ad-repair" title="화면 복구 (모든 탭 다시 그리기)">↻</button>'),
            this.uiMarkup('  <button class="ad-btn ad-viewtoggle" title="미리보기 패널 (md · 이미지 · 표)">▤</button>'),
            '</div>',
        ].join('\n')

        // 순정 탭바보다 뒤(오른쪽)에 놓는다 — 왼쪽에 두면 세로로 길어 허전하다는 피드백(2026-08-28)
        this.windowEl.appendChild(el)
        this.sidebar = el
        this.listEl = el.querySelector('.ad-list')
        this.nowEl = el.querySelector('.ad-now')
        this.resumeEl = el.querySelector('.ad-resume-drawer')
        this.wireSearch(el)
        this.wireListKeys(this.listEl)

        el.querySelector('.ad-new').addEventListener('click', () => {
            this.zone.run(() => { void this.openNewTab() })
        })
        el.querySelector('.ad-repair').addEventListener('click', () => {
            this.zone.run(() => this.repair('all'))
        })
        el.querySelector('.ad-settings').addEventListener('click', () => {
            this.zone.run(() => this.openSettings())
        })
        el.querySelector('.ad-viewtoggle').addEventListener('click', () => {
            this.zone.run(() => this.view?.toggle())
        })

        // 크기/도킹은 설정 창이 아니라 마우스로 맞춘다.
        // 드래그 중에는 relayout 이 초당 수십 번 불리므로 config.save() 는 손을 뗄 때만 부른다.
        this.dock = new DockController({
            sidebar: el,
            windowEl: this.windowEl,
            // 끌 때도 relayout 과 **같은 기준**을 써야 한다 (dock.ts getBox 주석)
            getBox: () => this.visibleBox(),
            getDock: () => this.dockSide,
            setDock: side => {
                this.config.store.agentDeck.sidebarDock = side
            },
            getSize: side => {
                const cfg = this.config.store.agentDeck
                if (!isHorizontalDock(side)) {
                    return cfg.sidebarHeight || 0
                }
                // 지금 좌/우로 붙어 있다면 화면에 실제로 적용된 폭이 가장 정확하다
                // (자동 계산 상태면 sidebarWidth 가 0 이라 물어봐야 소용이 없다)
                return isHorizontalDock(this.dockSide) && this.lastSidebarW > 0
                    ? this.lastSidebarW
                    : (cfg.sidebarWidth || 0)
            },
            setSize: px => {
                const cfg = this.config.store.agentDeck
                if (isHorizontalDock(this.dockSide)) {
                    cfg.sidebarWidth = px
                } else {
                    cfg.sidebarHeight = px
                }
            },
            commit: () => this.zone.run(() => this.config.save()),
            relayout: () => this.relayout(),
        })
        this.dock.install()
    }

    /**
     * 검색창 배선.
     *
     * 키 이벤트를 여기서 끊는 이유는 `startLabelEdit` 와 같다 — 안 끊으면 터미널로 새어 나간다.
     * 캡처 단계 리스너들(Ctrl+V·Shift+Enter·Enter 라벨)은 `isPlainInput` 이 이 입력창을
     * "터미널이 아닌 보통 입력 필드" 로 판정해 이미 비켜 준다(INPUT 태그 + .xterm 밖).
     */
    private wireSearch (root: HTMLElement): void {
        const input = root.querySelector('.ad-search-input') as HTMLInputElement | null
        const clear = root.querySelector('.ad-search-clear') as HTMLElement | null
        if (!input) {
            return
        }
        this.searchEl = input
        // **`input` 이벤트만 본다.** keydown 으로 값을 읽으면 IME 조합 중에는 아직 반영되지 않은
        // 값을 보게 되어 한글이 한 박자 늦고, 붙여넣기·마우스로 지우기도 놓친다.
        // 조합 중에도 `input` 은 조합 중인 글자를 담아 오므로 좁혀지는 것이 바로 보인다.
        input.addEventListener('input', () => {
            this.searchQuery = input.value
            this.syncSearchUi()
            this.render()
        })
        input.addEventListener('compositionstart', () => {
            this.searchComposing = true
        })
        input.addEventListener('compositionend', () => {
            this.searchComposing = false
        })
        input.addEventListener('keydown', ev => {
            ev.stopPropagation()
            // ↓ = 결과 목록으로 내려간다. `<input>` 에서 ↑↓ 의 브라우저 기본 동작은 한 줄 입력이라
            // 커서를 맨 앞/맨 뒤로 보내는 것뿐인데, ↓(맨 뒤)는 End 와 겹쳐 잃는 것이 없다.
            // **↑ 는 넘기지 않는다** — 검색창 위에는 아무것도 없고, 치던 검색어를 고치려면 커서를
            // 앞으로 보내는 그 기본 동작이 필요하다. 목록에서 검색창으로 돌아오는 길은 첫 줄에서의
            // ↑ 다(`moveNav`) — 화면상 검색창이 목록 **위**에 있으니 방향이 그대로 맞는다.
            if (ev.key === 'ArrowDown' || ev.code === 'ArrowDown') {
                // 조합 중의 방향키는 IME 것이다(후보 고르기) — 건드리지 않는다
                if (this.searchComposing || ev.isComposing || !this.navReady) {
                    return
                }
                ev.preventDefault()
                // **항상 첫 줄로 들어간다.** 검색어를 방금 고친 사람이 원하는 것은 첫 결과이고,
                // 지난 포커스는 이미 필터 밖일 수도 있다.
                this.focusList('first')
                return
            }
            if (ev.key !== 'Escape' && ev.code !== 'Escape') {
                return
            }
            // **조합 중의 Esc 는 IME 의 조합 취소다.** 그때 검색을 지우면 한글을 쓰다 만 사람이
            // 쓴 것을 통째로 잃는다 — 조합만 취소되도록 흘려보낸다.
            if (this.searchComposing || ev.isComposing) {
                return
            }
            ev.preventDefault()
            // 지우기와 나가기의 순서는 `navEscape` 한 곳에서 정한다 (목록의 Esc 와 같아야 한다)
            this.navEscape()
        })
        clear?.addEventListener('click', () => {
            this.clearFilters()
            // 지우고 나면 계속 칠 차례다 — 포커스를 입력창에 남긴다
            this.searchEl?.focus()
        })
        this.applySearchBox()
    }

    /** 검색어와 상태 필터를 한 번에 지운다 — Esc 와 `✕` 가 같은 곳으로 온다("전체 목록으로") */
    private clearFilters (): void {
        this.searchQuery = ''
        this.statusFilter = null
        if (this.searchEl) {
            this.searchEl.value = ''
        }
        this.syncSearchUi()
        this.render()
    }

    /** 검색어가 있을 때만 `✕` 를 보여준다 — 빈 칸 옆의 지우기 버튼은 무엇을 지우는지 알 수 없다 */
    private syncSearchUi (): void {
        const row = this.sidebar?.querySelector('.ad-search') as HTMLElement | null
        row?.classList.toggle('has-query', !!this.searchQuery.trim() || !!this.statusFilter)
    }

    /**
     * 검색 줄을 보일지 (`searchBox` 설정).
     *
     * **끌 때 필터도 같이 지운다.** 입력창만 감추고 검색어를 남기면 목록이 좁혀진 이유가
     * 화면에서 사라진다 — 사용자에게는 탭이 사라진 것과 구분되지 않는다.
     */
    private applySearchBox (): void {
        const row = this.sidebar?.querySelector('.ad-search') as HTMLElement | null
        const on = this.config.store.agentDeck.searchBox !== false
        if (row) {
            row.style.display = on ? '' : 'none'
        }
        if (!on && (this.searchQuery || this.statusFilter)) {
            this.clearFilters()
        }
    }

    /**
     * 상태 칩 클릭 = 그 상태만 보기, 한 번 더 누르면 해제.
     *
     * 왜 새 UI 대신 칩인가 — 칩은 이미 헤더에 있고, 이미 상태별 개수를 급한 순서로 보여준다
     * (`order.ts` STATUS_ORDER). 사용자가 `⏸ 2` 를 보고 "그 둘이 어디 있나" 를 찾는 순간이
     * 곧 필터가 필요한 순간이라, 누를 자리와 알고 싶은 것이 같은 픽셀에 있다.
     * 드롭다운을 새로 두면 같은 정보를 두 군데서 말하게 되고, 200px 짜리 사이드바
     * (`sidebarMin`)에서 검색창 옆에 그것을 놓을 자리도 없다.
     */
    private toggleStatusFilter (status: WorkStatus): void {
        this.statusFilter = this.statusFilter === status ? null : status
        this.syncSearchUi()
        this.render()
    }

    /**
     * 이 탭이 지금 걸린 필터를 통과하나.
     *
     * 매칭 후보는 **사용자가 그 줄에서 눈으로 보는 것 + 그 줄이 속한 그룹**이다 —
     * 제목(`customTitle` 우선, `[AD:...]` 표식은 뗀 것), 작업 이름(라벨), 작업 폴더 경로.
     * 그룹 라벨은 폴더 경로의 뒷조각이라(`group.ts` `groupLabelOf`) 경로를 후보에 넣으면
     * 라벨로 검색한 것도 같이 걸린다. cwd 를 아직 모르는 탭은 `기타` 그룹으로 묶이므로
     * 그 이름도 후보에 넣는다 — 화면에 그렇게 적혀 있으니 그것으로 찾을 수 있어야 한다.
     */
    private tabMatchesFilter (tab: BaseTabComponent, tokens: readonly string[], status: WorkStatus): boolean {
        if (this.statusFilter && status !== this.statusFilter) {
            return false
        }
        if (!tokens.length) {
            return true
        }
        const dir = this.cwdCache.get(tab)?.dir ?? null
        return matchesSearchTokens([
            stripTitleMarker(tab.customTitle || tab.title || ''),
            this.status.get(tab).label,
            dir,
            dir ? null : this.ui(UNGROUPED_LABEL),
        ], tokens)
    }

    /**
     * 옛 미리보기 설정(`viewerFollowMode` 목록 / 그보다 옛 `viewerFollow` boolean)을
     * 토글 두 개(`viewerPreload`/`viewerAutoOpen`)로 옮긴다 — **기동 때 한 번.**
     *
     * 읽는 시점에 옛 값을 보는 방식으로 두지 않은 이유: 토글은 boolean 이라 "아직 안 골랐다" 를
     * 담을 자리가 없다. 빈 값을 그대로 두면 화면에는 꺼져 보이는데 동작은 켜져 있게 된다.
     * 그래서 한 번 적고 **옛 키를 기본값으로 비운다** — 안 비우면 다음 기동에 또 옮기면서
     * 사람이 방금 바꾼 토글을 덮는다.
     */
    private migrateFollowConfig (): void {
        const cfg = this.config.store.agentDeck
        const moved = migrateFollow(cfg.viewerFollowMode, cfg.viewerFollow)
        if (!moved) {
            return
        }
        cfg.viewerPreload = moved.preload
        cfg.viewerAutoOpen = moved.autoOpen
        cfg.viewerFollowMode = ''
        cfg.viewerFollow = true
        this.config.save()
        this.diag(`migrate follow -> preload=${moved.preload} autoOpen=${moved.autoOpen}`)
    }

    /**
     * 결과물 미리보기 패널을 만든다 (viewPanel.ts).
     *
     * 사이드바와 같은 방식으로 `.window` 위에 절대 배치하고, 위치·폭은 relayout 이 정한다.
     * 열림 상태는 설정(`viewerOpen`)에 남겨 다음 기동에 그대로 복원한다 — 문서를 띄워 놓고
     * 쓰는 사람에게는 그게 기본 화면이기 때문이다.
     */
    private buildView (): void {
        if (!this.windowEl) {
            return
        }
        const cfg = () => this.config.store.agentDeck
        this.view = new ViewPanel({
            windowEl: this.windowEl,
            getSide: () => this.viewSide,
            getWidth: () => cfg().viewerWidth || 420,
            setWidth: px => {
                cfg().viewerWidth = px
            },
            getRecentMax: () => cfg().viewerRecentMax || 12,
            // 토글 두 개(`viewerPreload`/`viewerAutoOpen`)를 모드로 접는다.
            // 옛 목록값은 기동 때 `migrateFollowConfig` 가 이 둘로 옮기고 비운다
            getFollowMode: () => followModeOf(cfg().viewerPreload, cfg().viewerAutoOpen),
            // 상대경로는 그 탭의 cwd 로 푼다. 아직 못 물어봤으면 작업 루트라도 써 본다.
            // 훅이 말해 준 값(`cwdOf`)이 있으면 그게 1순위다 — 캐시는 출력이 흘러야 채워지므로
            // 조용한 탭에서는 훅 값이 먼저 와 있다 (그리고 추정보다 정확하다)
            cwdFor: tab => this.notify.cwdOf(tab as BaseTabComponent)
                || this.cwdCache.get(tab as BaseTabComponent)?.dir
                || cfg().rootProfileCwd
                || null,
            // `변경` 탭의 '세션' 목록 — 훅이 보고한 "이번 세션이 고친 파일". 훅이 없는 탭은 빈 배열
            touchedFor: tab => this.notify.touchedOf(tab as BaseTabComponent),
            commit: () => this.zone.run(() => this.config.save()),
            relayout: () => this.relayout(),
            setOpen: open => this.zone.run(() => {
                cfg().viewerOpen = open
                this.config.save()
            }),
            openExternal: url => this.platform.openExternal(url),
            // 미리보기 패널에서 고른 줄의 `파일:라인` 을 활성 탭 터미널에 넣는다.
            // 쓰기는 `sendToPane` 을 거친다(조합 중이면 확정을 기다리고, 진단 로그를 남긴다).
            // **개행은 붙이지 않는다** — 사용자가 앞뒤에 말을 붙일 자리를 남긴다
            // (끌어다 놓은 경로를 넣는 `pasteDroppedPath` 와 같은 규칙).
            sendText: (text: string) => {
                const tab = this.app.activeTab
                const pane = tab ? this.firstPane(tab as BaseTabComponent) : null
                if (!pane || !text) {
                    return false
                }
                this.sendToPane(pane, 'ref-paste', () => pane.sendInput(text))
                return true
            },
        })
        this.view.install()
        this.view.setActiveTab(this.app.activeTab ?? null)
        if (cfg().viewerOpen) {
            // 지난 세션의 열림 상태 복원 — 설정에 되쓰지 않는다(remember=false)
            this.view.setOpen(true, false)
        }
    }

    /** 미리보기 패널이 붙는 방향 (설정값이 망가져 있으면 오른쪽) */
    private get viewSide (): ViewSide {
        return this.config.store.agentDeck.viewerDock === 'left' ? 'left' : 'right'
    }

    /**
     * 이 탭의 작업 디렉토리를 캐시에 채운다.
     *
     * 미리보기 패널이 화면에서 주운 상대경로를 풀 때 쓴다. `getWorkingDirectory()` 는 비동기
     * OS 호출이라 출력 조각마다 부를 수 없으므로 `CWD_TTL_MS` 주기로만 갱신한다.
     */
    private touchCwd (root: BaseTabComponent, pane: BaseTabComponent): void {
        const now = Date.now()
        const hit = this.cwdCache.get(root)
        // **훅이 말해 준 값이 있으면 그것으로 끝낸다 — Tabby 의 추정은 보지도 않는다.**
        //
        // 윈도우의 `getWorkingDirectory()` 는 사실상 추정이다: PTY 출력에서 `X:\…` 로 보이는 첫
        // 토큰을 cwd 로 삼고(tabby-local dist/index.js:1316 `guessWindowsCWD`), 그것이 폴더인지는
        // 확인하지 않는다(:1306, `fs.access` 만 본다). 그래서 에이전트가 화면에 찍은 파일 경로가
        // 그대로 cwd 가 되어 `변경` 탭이 `git -C …\notes.py` 를 돌렸다 (2026-09-11 실측).
        // 훅 경로(notify.service `cwdOf`)는 에이전트가 자기 cwd 를 직접 말해 주는 것이라 추정이 아니다.
        const hooked = this.notify.cwdOf(root)
        if (hooked) {
            if (hit?.dir !== hooked) {
                this.cwdCache.set(root, { dir: hooked, at: now, misses: 0 })
                this.scheduleRender()
            }
            return
        }
        // **아직 한 번도 못 알아낸 탭은 짧은 간격으로 다시 묻는다.**
        //
        // TTL(3초)은 "이미 아는 값을 너무 자주 다시 묻지 않기" 위한 것이다. 그런데 첫 조회가
        // 빈손이면(세션이 붙는 중이거나 셸이 프롬프트를 아직 안 찍었을 때) 그 빈 값에도 TTL 이
        // 걸려, 다음 출력이 3초 안에 오는 탭은 계속 막히고 **조용한 탭은 영영 `기타` 에 남았다**
        // (2026-09-08 실측: 탭 둘을 연달아 열면 먼저 연 쪽이 25초 뒤에도 `dir: null`, 그 때문에
        //  다중 그룹 회귀 9종이 판정 불가로 빠졌다).
        //
        // 그래서 미상 탭은 TTL 을 건너뛰게 했는데, 그 대가가 2026-09-09 에 숫자로 나왔다 —
        // **조각 24개를 흘리는 동안 `getWorkingDirectory()` 가 34회**(PF6). cwd 를 끝내 못
        // 알려주는 셸(SSH 등)에서는 출력 조각마다 OS 호출이고 탭 수에 곱해진다.
        // 지금은 미상 탭에 **짧은 백오프**(`CWD_MISS_MS`)를 둔다: 조용한 탭도 곧 다시 묻고
        // (수백 ms 안에 제 그룹으로 옮겨온다), 시끄러운 탭에서 조각마다 묻는 일은 사라진다.
        const ttl = hit?.dir ? CWD_TTL_MS : CWD_MISS_MS
        if (hit && now - hit.at < ttl) {
            return
        }
        // 미상인 동안은 조회 횟수를 센다 — 1초 tick 이 이 값으로 재시도를 멈출 시점을 안다
        const misses = hit?.dir ? 0 : (hit?.misses ?? 0) + 1
        this.cwdCache.set(root, { dir: hit?.dir ?? null, at: now, misses })
        const session = (pane as any).session
        if (!session?.getWorkingDirectory) {
            return
        }
        Promise.resolve(session.getWorkingDirectory())
            .then((dir: string | null) => {
                // **폴더가 맞는지 여기서 거른다.** 윈도우에서 이 값은 출력에서 주운 추정이고
                // (`guessWindowsCWD`), Tabby 는 존재 여부만 확인하므로 **파일 경로가 그대로 나온다.**
                // 그대로 받으면 `git -C <파일>` 이 `Invalid argument` 로 죽고, 상대경로 풀기도
                // 전부 어긋난다. 거른 값 대신 **직전에 알던 폴더를 그대로 둔다** — 파일의 상위
                // 폴더로 바꾸지 않는다. 그 상위 폴더(예: 스크래치패드)는 탭의 작업 폴더가 아니라
                // 그저 화면에 지나간 경로라, 그걸 받아들이면 틀린 값을 조용히 확정하게 된다.
                if (dir && isDirectory(dir)) {
                    this.cwdCache.set(root, { dir, at: Date.now(), misses: 0 })
                    // 그룹이 방금 정해졌으면 화면도 그것을 반영해야 한다 — 캐시만 바꾸면
                    // 다음 상태 변화 때까지 사이드바가 옛 그룹을 보여준다 (`render` 는 tick 에서만)
                    this.scheduleRender()
                }
            })
            .catch(() => {
                // 셸이 알려주지 않는 환경 — 절대경로만 주워도 쓸 만하다
            })
    }

    /** 설정에 지정된 기본 프로필(기본값 agentdeck:root)로 새 탭을 연다 */
    private async openNewTab (): Promise<void> {
        this.syncSessionSlots()
        if (this.sessionSlots.occupied + this.pendingSessionOpens >= JUMP_SLOTS) { return }
        this.pendingSessionOpens++
        try {
            const wanted = this.config.store.terminal.profile
            const profiles = await this.profiles.getProfiles()
            const profile = profiles.find(p => p.id === wanted) ?? profiles[0]
            if (profile) {
                const options = (profile as any).options || {}
                await this.profiles.openNewTabForProfile({ ...profile,
                    options: { ...options, env: storageEnvironment(options.env) } } as any)
            }
        } finally { this.pendingSessionOpens-- }
    }

    private openSettings (): void {
        this.app.openNewTabRaw({ type: SettingsTabComponent })
    }

    /**
     * 사이드바 다시 그리기를 한 번으로 모은다.
     *
     * rAF 만 쓰면 **창이 가려졌을 때 상태가 늦게 반영된다.** Chromium 은 창이 hidden
     * (최소화·완전 가려짐) 이 되면 rAF 를 아예 멈추고 타이머도 스로틀한다. 그러면
     * 훅이 보낸 done 은 메모리에 즉시 반영됐는데 화면만 옛 상태로 남아 있다가,
     * 1초 tick(그것도 스로틀되면 더 늦게)이 와야 그려진다 — "작업중이 한참 뒤에야 완료로 바뀐다"
     * 의 정체가 이것이다(2026-08-28). 시작 쪽이 빨라 보이는 건 그때는 사용자가 방금
     * 창에 입력해서 창이 떠 있기 때문일 뿐이다.
     *
     * 그래서 rAF 와 짧은 타이머를 같이 걸고 **먼저 오는 쪽이 그린다**. 창이 떠 있으면
     * 지금까지와 똑같이 다음 프레임에, 가려져 있으면 타이머가 대신 그린다.
     */
    private scheduleRender (): void {
        if (this.renderQueued) {
            return
        }
        this.renderQueued = true
        const run = () => {
            if (!this.renderQueued) {
                return
            }
            this.renderQueued = false
            if (this.renderTimer) {
                clearTimeout(this.renderTimer)
                this.renderTimer = null
            }
            this.render()
            this.relayout()
        }
        requestAnimationFrame(run)
        this.renderTimer = setTimeout(run, 50)
    }

    /**
     * 창이 가려져 있어도 타이머·rAF 가 계속 돌게 한다.
     *
     * 위 scheduleRender 의 타이머 폴백은 "타이머가 제때 돈다" 를 전제로 하는데,
     * Chromium 은 hidden 페이지의 타이머를 1초로 묶고 5분 넘게 가려져 있으면
     * **분당 1회**까지 떨어뜨린다. 그 상태에서는 폴백조차 늦다.
     * Electron 의 backgroundThrottling 을 꺼서 이 계층을 통째로 없앤다.
     */
    private disableBackgroundThrottling (): void {
        if (!this.config.store.agentDeck.keepRenderingWhenHidden) {
            return
        }
        try {
            const req = (window as any).require ?? (globalThis as any).require
            const win = req?.('@electron/remote')?.getCurrentWindow?.()
            win?.webContents?.setBackgroundThrottling?.(false)
        } catch {
            // remote 를 못 잡아도 위 타이머 폴백은 살아 있다 (조금 늦을 뿐)
        }
    }

    private tick (): void {
        if (!this.enabled) {
            return
        }
        let dirty = false
        const idleAfter = this.config.store.agentDeck.idleAfterMs || 2500
        // 훅이 고정한 `진행중` 탭의 유예 — 0 이면 끈 것이다(`config.ts staleAfterMs`).
        // `|| 300000` 을 쓰지 않는다: 그러면 사람이 0 으로 꺼 놓은 것이 기본값으로 되살아난다
        const stale = this.config.store.agentDeck.staleAfterMs ?? 300000
        for (const tab of this.app.tabs) {
            if (this.status.tickIdle(tab, idleAfter, stale)) {
                dirty = true
            }
            // **작업 폴더를 아직 못 알아낸 탭은 출력이 없어도 다시 묻는다 — 단 활성 탭만.**
            //
            // `touchCwd` 는 출력 구독에서만 불리므로, 아무것도 찍지 않는 탭은 재시도 기회가
            // 없다 — 세션이 붙는 중이던 첫 조회가 빈손이면 영영 `기타` 그룹이고 `변경` 탭도
            // "작업 폴더를 모른다" 로 끝난다(2026-09-09 실측).
            //
            // **활성 탭으로 한정하는 이유**: 처음에는 전 탭을 매초 물었는데, 그러면 닫히는
            // 중인 탭의 `session.getWorkingDirectory()` 를 건드려 프로세스가 조용히 사라지는
            // 판이 생겼다(회귀 러너에서 탭을 만들고 닫는 프로브 구간마다 재현. `try/catch` 로는
            // 못 막는다 — 네이티브 pty 핸들 쪽이다). 활성 탭은 파괴 중일 가능성이 낮고,
            // 미리보기가 보는 것도 활성 탭의 cwd 다. 배경 탭은 출력이 흐를 때나 활성으로
            // 바뀔 때 잡히므로 그룹도 곧 정리된다.
            // 훅이 알려 준 폴더는 **출력을 기다리지 않고** 캐시에 반영한다.
            // `touchCwd` 는 출력 구독에서만 불리는데, 에이전트가 폴더를 옮긴 직후에 아무것도
            // 찍지 않으면 사이드바 그룹과 `변경` 탭이 옛 폴더에 머문다. WeakMap 조회 한 번이라
            // 매초 전 탭을 훑어도 비용이 없고, 위의 `getWorkingDirectory()` 와 달리 OS 를
            // 건드리지 않으므로 배경 탭·파괴 중인 탭에 물어도 안전하다
            const hooked = this.notify.cwdOf(tab)
            if (hooked && this.cwdCache.get(tab)?.dir !== hooked) {
                this.cwdCache.set(tab, { dir: hooked, at: Date.now(), misses: 0 })
                dirty = true
            }
            if (tab === this.app.activeTab) {
                try {
                    const hit = this.cwdCache.get(tab)
                    if (!hit?.dir && (hit?.misses ?? 0) < CWD_MISS_MAX) {
                        const pane = this.firstPane(tab)
                        if (pane) {
                            this.touchCwd(tab, pane)
                        }
                    }
                } catch {
                    // 파괴 중인 탭 — 다음 tick 에 다시 본다
                }
            }
        }
        this.syncLedger()
        // 서브에이전트 개수는 `notify.service` 의 2초 스캔이 갱신하는데 렌더를 부르는 경로가
        // 없다 — 경과시간을 끈 사람에게도 숫자가 흐르게 여기서 같이 그린다. 비용은 이미
        // 기본값(`showElapsed: true`)으로 매초 그리던 것과 같다
        if (dirty || this.config.store.agentDeck.showElapsed || this.config.store.agentDeck.subagentCount !== false) {
            this.render()
        }
    }

    /**
     * 살아 있는 세션의 라벨·cwd·상태를 원장에 적는다 (매초).
     *
     * **여기가 적는 유일한 자리다.** 세 조각이 각각 다른 곳에 있기 때문이다 —
     * 세션↔탭은 `notify`, 라벨·상태는 `status.service`, cwd 는 이 서비스의 `cwdCache`.
     * 한 곳에서 모아 적지 않으면 셋이 어긋난 원장이 남는다.
     *
     * 매초 파일을 쓰지는 않는다 — `note` 가 값이 그대로면 저장을 예약하지 않고, 예약도 2초로 모은다.
     */
    private syncLedger (): void {
        if (this.config.store.agentDeck.resumeList === false) {
            return
        }
        let live: Map<string, BaseTabComponent>
        try {
            live = this.notify.liveSessions()
        } catch {
            return
        }
        for (const [sid, tab] of live) {
            if (!this.app.tabs.includes(tab)) {
                continue
            }
            const st = this.status.get(tab)
            this.ledger.note(sid, {
                cwd: this.cwdCache.get(tab)?.dir ?? null,
                label: st.label,
                status: st.status,
            })
        }
    }

    /**
     * 사이드바를 **무엇을 어떤 순서로** 그릴지 한 번에 계산한다 (그리지는 않는다).
     *
     * `render()` 와 진단구(`__agentdeck.groups()`)가 **같은 계산을 공유하기 위해** 뽑았다.
     * 예전에는 이 규칙이 `render()` 안에만 있어서, 검증 도구가 헤더 생략 조건을
     * `list.filter(key!==null).length > 1` 로 **다시 적어야** 했다. 그런 사본은 낡는다 —
     * 이 저장소가 `judge()`·`profiles()`·`groups()` 를 연 이유가 전부 그것이다.
     */
    private renderPlan (): {
        /** 전체 탭(정렬 적용). **집계 칩의 기준** — 필터로 줄지 않는다 */
        tabs: readonly BaseTabComponent[]
        /** 필터를 통과해 실제로 줄이 그려지는 탭들 (그룹핑·헤더 생략·plan 의 입력) */
        visible: readonly BaseTabComponent[]
        groups: Array<TabGroup<BaseTabComponent>>
        withHeads: boolean
        plan: Array<TabGroup<BaseTabComponent>>
        statusOf: (tab: BaseTabComponent) => WorkStatus
        /** 검색어나 상태 필터가 하나라도 걸려 있나 */
        filtering: boolean
        /**
         * 그 그룹이 **화면에서** 접히는가 (저장값 + 검색 상태 + 매칭 수).
         *
         * `render()` 와 진단구가 같은 판정을 쓰기 위해 여기서 한 번만 만든다 —
         * 규칙 자체는 `group.ts` 의 `resolveGroupCollapseFor` 에 있고 여기서 되풀이하지 않는다.
         */
        collapseOf: (group: TabGroup<BaseTabComponent>) => GroupCollapseState
    } {
        const statusOf = (tab: BaseTabComponent): WorkStatus => this.status.get(tab).status
        // 정렬은 복사본에만 — app.tabs 의 순서(순정 탭바)는 그대로 둔다
        this.syncSessionSlots()
        const tabs = [...this.app.tabs].sort((a, b) =>
            (this.sessionSlots.numberOf(a) ?? 10) - (this.sessionSlots.numberOf(b) ?? 10))
        // **필터는 여기서 먹인다** — 그룹핑·헤더 생략·plan 이 전부 이 결과를 딛는다.
        // `render()` 안에서만 걸러내면 진단구(`__agentdeck.groups()`)가 화면과 어긋나고,
        // 그러면 회귀 프로브가 "제품이 배정한 탭 집합 != 화면의 줄 집합"(GR2)을 거짓 실패로 읽는다.
        // 이 함수를 뽑은 이유 자체가 그 사본 문제였다.
        //
        // 필터가 없으면 배열을 복사하지 않고 `tabs` 를 그대로 넘긴다 — 렌더는 초당 여러 번 돈다.
        const tokens = searchTokens(this.searchQuery)
        const filtering = tokens.length > 0 || !!this.statusFilter
        const visible = filtering
            ? tabs.filter(tab => this.tabMatchesFilter(tab, tokens, statusOf(tab)))
            : tabs
        const groups = this.groupsFor(visible)
        // 그룹이 하나뿐이면 헤더를 그리지 않는다 — 단일 프로젝트에서는 아무것도 가르지 못하면서
        // 세로 공간만 먹는다 — 그룹을 항상 계산해도 한 프로젝트만 쓰는 화면이 예전과 같은 이유다.
        //
        // **세는 것은 "작업 폴더를 아는 그룹" 뿐이다.** cwd 를 모르는 탭(Welcome 탭, 조회 실패)은
        // `기타` 그룹으로 모이는데, 그것까지 세면 Welcome 탭 하나 때문에 항상 2그룹이 되어
        // 단일 프로젝트에서도 헤더가 뜬다 — 생략 규칙이 사실상 무력화된다
        // (2026-09-08 배리어 실측: 같은 cwd 인데 헤더가 2개였다).
        const withHeads = false // Fixed human slots must not be regrouped or reordered.
        // **헤더를 안 그리기로 했으면 순서도 건드리지 않는다.**
        // `groupTabs` 는 그룹을 라벨순으로 정렬하고 `기타`(작업 폴더를 모르는 탭)를 맨 뒤로 붙인다
        // (group.ts:228-230). 헤더가 있으면 그게 보기 좋지만, 헤더가 없는 화면에서는 구분선이
        // 없으니 "그룹으로 묶여서 옮겨졌다" 는 것을 알 방법이 없다 — Welcome 탭이 이유 없이
        // 맨 아래로 내려간 것처럼만 보이고, 순정 탭바와의 순서 대응도 깨진다.
        // (2026-09-08 실측: 이 재배열 때문에 사이드바 첫 줄이 `app.tabs[0]` 이 아니게 되어
        //  R16·R19 가 다른 탭의 배지를 읽었다.)
        //
        // 평면으로 떨어질 때 담는 것은 **`visible`** 이다. `tabs`(전체)를 담으면 필터로 그룹이
        // 하나만 남는 순간 걸러낸 탭들이 통째로 되살아난다 — 헤더 생략 규칙과 필터가 부딪치는
        // 유일한 지점이라 여기만 조심하면 된다.
        const plan: Array<TabGroup<BaseTabComponent>> = withHeads
            ? groups
            : [{ key: null, label: UNGROUPED_LABEL, tabs: [...visible] }]
        // 접힘 판정은 순수 규칙에 맡긴다 — 검색 중 매칭이 있는 접힌 그룹은 **임시로** 펴 보이고,
        // 저장된 `collapsedGroups` 는 건드리지 않는다(검색을 지우면 같은 입력이 되어 복귀한다).
        const collapseOf = (group: TabGroup<BaseTabComponent>): GroupCollapseState =>
            resolveGroupCollapseFor(group, this.config.store.agentDeck.collapsedGroups, filtering)
        return { tabs, visible, groups, withHeads, plan, statusOf, filtering, collapseOf }
    }

    private render (): void {
        this.refreshSidebarLanguage()
        // 드래그가 진행 중이면 그리지 않는다. 목록을 다시 만들면 **끌고 있던 줄의 DOM 이 사라져**
        // 삽입선이 가리킬 대상도, 되돌아갈 자리도 없어진다 (라벨 편집 중에 안 그리는 것과 같은 이유).
        // 상태 갱신이 드래그가 끝날 때까지(수 초) 밀리는 것은 그 대가로 받아들인다 —
        // `endRowDrag` 가 끝에 반드시 한 번 그린다.
        if (!this.listEl || !this.enabled || this.editing || this.drag?.moved) {
            return
        }
        // 닫힌 탭을 가리키는 키보드 포커스를 먼저 버린다 (`pruneNavFocus` 주석)
        this.pruneNavFocus()
        const { tabs, visible, withHeads, plan, statusOf, filtering, collapseOf } = this.renderPlan()
        // **집계 칩은 전체(`tabs`) 기준이다.** 근거 둘 —
        //  1) 칩이 곧 상태 필터의 조작부다. 필터 기준으로 세면 `⏸` 을 누른 순간 다른 상태의 칩이
        //     사라져 다른 상태로 갈아탈 수도, 무엇을 놓치고 있는지 볼 수도 없다.
        //  2) 화면에서 줄이 사라졌는데 총계까지 줄면 "탭이 닫혔나" 로 읽힌다. 이 저장소는 이미
        //     같은 판단을 한 번 했다 — 그룹을 접어 줄이 사라져도 헤더 총계는 그대로 유지한다
        //     (그 성질을 회귀가 `headCountTitle` 로 고정해 두고 있다).
        this.renderHeadCount(tabs, statusOf)
        // **목록을 그리기 전에** 부른다. 아래 "검색 결과 없음" 은 여기서 되돌아가는데(early
        // return), 그 화면에서도 지금 탭의 모델·한도는 그대로 보여야 한다
        this.renderNow()
        // 지난 세션 서랍도 목록 밖이다 — **여기서** 그려야 아래 "검색 결과 없음" 으로
        // 되돌아가는 화면에서도 서랍이 낡은 내용으로 남지 않는다
        this.renderResumeDrawer()

        this.listEl.innerHTML = ''
        if (filtering && !visible.length) {
            // 빈 목록만 남기면 "탭이 다 닫혔다" 로 읽힌다 — 무엇도 걸리지 않았음을 한 줄로 말한다
            this.listEl.appendChild(this.renderEmpty(tabs.length))
            return
        }
        for (const group of plan) {
            // **화면에 접히는지**는 순수 규칙이 정한다 — 검색 중 매칭이 있는 접힌 그룹은
            // 임시로 펴진다(group.ts `resolveGroupCollapse`). 헤더를 안 그리는 화면에서는
            // 접힘을 적용하지 않는다(그 규칙은 예전부터 여기 있었다).
            const state: GroupCollapseState = withHeads
                ? collapseOf(group)
                : { collapsed: false, reason: 'open' }
            const collapsed = state.collapsed
            if (withHeads) {
                this.listEl.appendChild(this.renderGroupHead(group, state))
            }
            if (collapsed) {
                continue
            }
            for (const tab of group.tabs) {
                this.listEl.appendChild(this.renderTab(tab))
            }
        }
    }

    /**
     * 사이드바 하단의 "지금 이 탭" 줄 — 활성 탭에서 도는 모델·계정·컨텍스트%·한도.
     *
     * **활성 탭 하나만 그린다.** 줄마다 붙이지 않는 이유는 폭이다 — 200px 사이드바에서
     * 모델 이름과 한도 세 칸은 제목·상태 배지와 자리를 다툰다. 대신 탭을 바꾸면 다시 그려지는데,
     * 그건 따로 배선할 것도 없다(`activeTabChange$` 가 이미 `scheduleRender` 를 부른다).
     *
     * 값이 없으면 **줄을 통째로 접는다**(`hidden`). "알 수 없음" 을 그려 두면 자리만 차지하면서
     * "statusLine 래퍼가 안 걸렸다" 와 "걸렸는데 아직 첫 보고가 안 왔다" 가 화면에서 같아진다.
     */
    private async showAccountPicker (): Promise<void> {
        if (this.accountPopup) { this.accountPopup.remove(); this.accountPopup = null; return }
        const tab = this.app.activeTab
        const meta = this.notify.metaOf(tab)
        if (!tab || !meta || (meta.agent !== 'claude' && meta.agent !== 'codex')) { return }
        const provider = meta.agent
        const popup = document.createElement('div')
        popup.className = 'ad-account-picker'
        popup.setAttribute('role', 'dialog')
        popup.setAttribute('aria-label', this.ui('{provider} 계정 선택', { provider: provider === 'claude' ? 'Claude' : 'Codex' }))
        const heading = document.createElement('strong')
        heading.textContent = this.ui('{provider} 계정', { provider: provider === 'claude' ? 'Claude' : 'Codex' })
        const close = document.createElement('button')
        close.type = 'button'; close.textContent = '×'; close.className = 'ad-account-close'
        close.title = this.ui('닫기'); close.setAttribute('aria-label', this.ui('닫기'))
        const polls: ReturnType<typeof setInterval>[] = []
        const dismiss = () => { polls.forEach(clearInterval); popup.remove(); if (this.accountPopup === popup) { this.accountPopup = null } }
        close.onclick = dismiss
        popup.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } })
        popup.append(heading, close)
        const note = document.createElement('p')
        note.textContent = this.ui('현재 탭에서 선택한 계정으로 전환합니다.')
        popup.appendChild(note)
        const message = document.createElement('p')
        message.setAttribute('role', 'status')
        popup.appendChild(message)
        const add = document.createElement('button')
        add.type = 'button'; add.className = 'ad-account-add'; add.textContent = '+'
        add.title = this.ui('계정 추가'); add.setAttribute('aria-label', this.ui('계정 추가'))
        popup.appendChild(add)
        add.onclick = () => {
            if (popup.querySelector('.ad-account-form')) { return }
            const form = document.createElement('form')
            form.className = 'ad-account-form'
            const nameLabel = document.createElement('label')
            nameLabel.textContent = this.ui('계정 이름 (선택)')
            const displayName = document.createElement('input')
            displayName.type = 'text'; displayName.name = 'name'; displayName.autocomplete = 'off'
            nameLabel.appendChild(displayName)
            const accountLabel = document.createElement('label')
            accountLabel.textContent = this.ui('계정 (이메일)')
            const id = document.createElement('input')
            id.type = 'email'; id.name = 'account'; id.autocomplete = 'username'; id.required = true
            accountLabel.appendChild(id)
            const passwordLabel = document.createElement('label')
            passwordLabel.textContent = this.ui('비밀번호')
            const password = document.createElement('input')
            password.type = 'password'; password.name = 'password'; password.autocomplete = 'new-password'; password.required = true
            passwordLabel.appendChild(password)
            const notice = document.createElement('p')
            notice.className = 'ad-account-plaintext'
            notice.textContent = this.ui('계정과 비밀번호가 이 PC에 평문으로 저장됩니다.')
            const error = document.createElement('p')
            error.setAttribute('role', 'alert')
            const save = document.createElement('button')
            save.type = 'submit'; save.textContent = this.ui('저장')
            const cancel = document.createElement('button')
            cancel.type = 'button'; cancel.textContent = this.ui('취소')
            cancel.onclick = () => { password.value = ''; form.remove(); add.focus() }
            form.append(nameLabel, accountLabel, passwordLabel, notice, error, save, cancel)
            form.onsubmit = event => {
                event.preventDefault()
                if (this.accountSwitchBusy) { return }
                try {
                    addAccount(provider, id.value, password.value, undefined, displayName.value)
                    password.value = ''
                    dismiss()
                    if (this.app.activeTab === tab) { void this.showAccountPicker() }
                } catch (e: any) { error.textContent = this.ui(e.message) }
            }
            popup.insertBefore(form, message)
            displayName.focus()
        }
        document.body.appendChild(popup)
        this.accountPopup = popup
        this.accountPopupTab = tab
        close.focus()
        let accounts: SavedAccount[]
        try { accounts = readAccounts().filter(a => a.provider === provider) } catch (e: any) { message.textContent = this.ui(e.message); return }
        if (!accounts.length) { message.textContent = this.ui('+ 버튼으로 계정을 추가하세요.'); return }
        for (const account of accounts) {
            const button = document.createElement('button')
            button.type = 'button'; button.className = 'ad-account-option'
            const name = document.createElement('strong')
            const current = meta.account.toLowerCase() === account.id.toLowerCase()
            name.textContent = account.name + (current ? this.ui(' · 현재 계정') : '')
            const quota = document.createElement('span')
            quota.className = 'ad-now-gauges'
            quota.textContent = this.ui('잔량 조회 중…')
            const identity = document.createElement('span')
            identity.className = 'ad-account-email'; identity.textContent = account.id
            button.append(name, identity, quota)
            const row = document.createElement('div')
            row.className = 'ad-account-row'
            const remove = document.createElement('button')
            remove.type = 'button'; remove.className = 'ad-account-remove'
            remove.textContent = this.ui('목록에서 삭제')
            remove.setAttribute('aria-label', this.ui('목록에서 삭제') + ': ' + account.name)
            remove.onclick = () => {
                if (this.accountSwitchBusy) { return }
                try {
                    removeAccount(account)
                    dismiss()
                    if (this.app.activeTab === tab) { void this.showAccountPicker() }
                } catch (e: any) { message.textContent = this.ui(e.message) }
            }
            row.append(button, remove); popup.appendChild(row)
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.id)) {
                quota.textContent = this.ui('이메일 주소 전체를 입력하세요.'); button.disabled = true; continue
            }
            try { prepareAccount(account, meta.configDir || undefined) } catch { quota.textContent = this.ui('계정 저장 폴더를 준비하지 못했습니다.'); button.disabled = true; continue }
            registerAccountSource(account, meta.configDir)
            const refresh = () => {
                if (!popup.isConnected) { polls.forEach(clearInterval); return }
                for (const live of this.app.tabs.map(t => this.notify.metaOf(t)).filter(Boolean)) { recordAccountUsage(account, live) }
                void getAccountQuotas(account).then(snapshot => {
                if (!popup.isConnected) { return }
                const values = snapshot.values
                const limits: NonNullable<MetaInput['limits']> = {}
                for (const value of values) {
                    if (value.remaining === undefined) { continue }
                    const used = 100 - value.remaining
                    if (value.label === '5시간') { limits.fiveHourPct = used; limits.fiveHourResetsAt = value.resetsAt }
                    else if (value.label === '주간') { limits.sevenDayPct = used; limits.sevenDayResetsAt = value.resetsAt }
                    else { limits.scopedName = value.label; limits.scopedPct = used; limits.scopedResetsAt = value.resetsAt }
                }
                const gauges = formatMeta({ model: 'account', limits }, Date.now())?.gauges || []
                this.renderMetaGauges(quota, gauges)
                for (const value of values.filter(v => v.remaining === undefined && v.status)) {
                    const row = document.createElement('span')
                    row.className = 'ad-now-reset'
                    const available = RESET_COPY[this.sidebarLang] ?? RESET_COPY.en
                    row.textContent = `${value.label.toLowerCase()} · ${available[value.status === '사용 가능' ? 3 : 4]}`
                    quota.appendChild(row)
                    quota.hidden = false
                }
                if (!values.length) { quota.hidden = false; quota.textContent = this.ui('사용량 정보 없음') }
                if (snapshot.stale) {
                    const age = document.createElement('span')
                    age.className = 'ad-now-reset'
                    age.textContent = '⏱ ' + new Date(snapshot.ts).toLocaleString(this.locale?.getLocale() || undefined)
                    quota.appendChild(age)
                }
            }, (e: any) => { quota.textContent = this.sidebarLang === 'ko' ? e.message : this.ui('사용량 정보 없음') })
            }
            refresh()
            polls.push(setInterval(refresh, 60000))
            button.onclick = async () => {
                if (this.accountSwitchBusy) { return }
                if (!this.app.tabs.includes(tab)) { message.textContent = this.ui('원래 탭이 닫혔습니다. 계정 목록을 다시 여세요.'); return }
                if (current) { dismiss(); return }
                this.accountSwitchBusy = true
                popup.querySelectorAll<HTMLButtonElement>('.ad-account-option').forEach(b => { b.disabled = true })
                try {
                    message.textContent = this.ui('{name} 인증 확인 중…', { name: account.name })
                    try { await ensureAccountSession(account) } catch (error) {
                        if (!(error instanceof AccountRequestError) || error.kind !== 'auth') { throw error }
                        message.textContent = this.ui('{name}: 열린 브라우저에서 로그인하세요. 인증정보는 자동 저장됩니다.', { name: account.name })
                        await loginAccount(account, openAccountBrowser)
                    }
                    await ensureAccountSession(account)
                    if (!this.app.tabs.includes(tab)) {
                        message.textContent = this.ui('인증을 저장했습니다. 원래 탭이 닫혀 새 대화에서 계정을 선택해야 합니다.'); return
                    }
                    const latest = this.notify.metaOf(tab) || meta
                    let command = resumeCommand(latest.sessionId, false, provider)
                    // Accounts can also be selected before a CLI has a resumable conversation.
                    if (!command) { command = provider }
                    if (provider === 'codex') { command = command.replace(/^codex(?: |$)/, 'codex -c \'cli_auth_credentials_store="file"\' ') }
                    await this.switchAccountInTab(tab, account, command, latest.cwd)
                    dismiss()
                } catch (e: any) { message.textContent = this.sidebarLang === 'ko' && e.message ? e.message : this.ui('계정 전환에 실패했습니다. 다시 선택하세요.') }
                finally {
                    this.accountSwitchBusy = false
                    popup.querySelectorAll<HTMLButtonElement>('.ad-account-option').forEach(b => { b.disabled = false })
                }
            }
        }
    }

    private async switchAccountInTab (tab: BaseTabComponent, account: SavedAccount, command: string, cwd?: string): Promise<void> {
        const pane = this.firstPane(tab) as any
        if (!pane || pane.profile?.type !== 'local' || typeof pane.initializeSession !== 'function' || !pane.session) {
            throw new Error(this.ui('계정 전환에 실패했습니다. 다시 선택하세요.'))
        }
        const profiles = await this.profiles.getProfiles()
        const base: any = profiles.find(p => p.id === this.config.store.terminal.profile) || pane.profile
        if (!this.app.tabs.includes(tab) || base.type !== 'local') {
            throw new Error(this.ui('계정 전환에 실패했습니다. 다시 선택하세요.'))
        }
        const options = { ...base.options, cwd: cwd || pane.profile.options?.cwd,
            env: { ...base.options?.env, ...pane.profile.options?.env,
                [account.provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: accountHome(account) } }
        delete options.restoreFromPTYID
        for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE']) {
            options.env[key] = ''
        }
        const previous = pane.session
        // Detach first: a local session's close event would otherwise destroy its tab.
        pane.setSession(null)
        await previous.destroy()
        if (!this.app.tabs.includes(tab)) { return }
        pane.profile = { ...pane.profile, options }
        pane.sessionOptions = options
        pane.frontend?.xterm?.reset()
        pane.initializeSession(pane.size.columns, pane.size.rows)
        this.notify.setAccountHome(tab, account.provider, accountHome(account), account.id)
        this.sendResumeCommand(tab, command, pane.session)
        pane.session?.releaseInitialDataBuffer()
        this.diag('account switched in existing tab')
    }

    private renderNow (): void {
        if (this.accountPopup && this.accountPopupTab !== this.app.activeTab) {
            this.accountPopup.remove(); this.accountPopup = null; this.accountPopupTab = null
        }
        const el = this.nowEl
        if (!el) {
            return
        }
        const meta = this.notify.metaOf(this.app.activeTab as BaseTabComponent)
        const view = this.config.store.agentDeck.metaLine === false
            ? null
            : formatMeta(meta, Date.now())
        if (!view) {
            el.hidden = true
            return
        }
        el.hidden = false
        el.title = [
            view.title,
            view.account ? this.ui('계정: {value}', { value: view.account + (meta?.org ? ` (${meta.org})` : '') }) : '',
            meta?.version ? this.ui('버전: {value}', { value: meta.version }) : '',
            meta?.cwd ? this.ui('폴더: {value}', { value: meta.cwd }) : '',
            ...view.gauges.map(g => g.text + (g.resetText ? ' — ' + sidebarReset(g.resetText, this.sidebarLang) : '')),
        ].filter(Boolean).join('\n')
        const titleEl = el.querySelector('.ad-now-title') as HTMLElement
        titleEl.textContent = view.title
        const accountEl = el.querySelector('.ad-now-account') as HTMLElement
        const provider = this.notify.metaOf(this.app.activeTab as BaseTabComponent)?.agent
        const switchable = provider === 'claude' || provider === 'codex'
        accountEl.textContent = view.account || this.ui('계정 선택')
        accountEl.hidden = !view.account && !switchable
        ;(accountEl as HTMLButtonElement).disabled = !switchable
        accountEl.onclick = () => { void this.showAccountPicker() }
        const gaugeEl = el.querySelector('.ad-now-gauges') as HTMLElement
        this.renderMetaGauges(gaugeEl, view.gauges)
    }

    private renderMetaGauges (gaugeEl: HTMLElement, gauges: MetaGauge[]): void {
        gaugeEl.innerHTML = ''
        for (let i = 0; i < gauges.length; i++) {
            const g = gauges[i]
            // 칩(`ctx 0%`) 대신 **차오르는 막대**다 — 숫자만 있으면 "많이 썼나" 를 읽는 데
            // 머릿속에서 한 번 환산해야 하고, 11px 칩은 사이드바에서 잘 보이지도 않았다
            // (2026-09-14 유저: "이거 뭐 보이지도 않아"). 막대는 눈이 길이로 바로 읽는다.
            const row = document.createElement('div')
            row.className = `ad-now-gauge ad-now-${g.level}`
            // 리셋 시각은 줄에 따로 붙인다 — 줄 전체 tooltip 은 마우스가 이 줄 밖에 있을 때 나온다
            row.title = g.resetText ? `${g.text} — ${sidebarReset(g.resetText, this.sidebarLang)}` : g.text

            const label = document.createElement('span')
            label.className = 'ad-now-gauge-key'
            label.textContent = g.key
            const track = document.createElement('span')
            track.className = 'ad-now-bar'
            const fill = document.createElement('span')
            fill.className = 'ad-now-bar-fill'
            // 0% 도 칸이 보여야 한다 — 비어 있는 것과 값이 없는 것은 다르다(meta.ts gauge 주석)
            fill.style.width = g.pct + '%'
            track.appendChild(fill)
            const pct = document.createElement('span')
            pct.className = 'ad-now-gauge-pct'
            pct.textContent = g.pct + '%'

            row.appendChild(label)
            row.appendChild(track)
            row.appendChild(pct)
            gaugeEl.appendChild(row)

            // 리셋까지 남은 시간은 막대 **아래 줄**에 따로 찍는다 (2026-09-14 유저 지시).
            // 막대 뒤에 붙이면 그만큼 막대가 짧아지고 글자도 작아져 결국 안 읽힌다.
            //
            // 같은 시각에 풀리는 칸들은 **한 줄로 묶는다** — 7d 와 모델 주간 한도는 늘 같은 시각인데
            // 같은 문장을 두 번 적으면 줄만 늘고 읽을 것은 그대로다. 그래서 다음 칸의 리셋이
            // 달라지는 자리(또는 마지막 칸)에서만 한 번 찍는다.
            const next = gauges[i + 1]
            if (g.resetLine && (!next || next.resetLine !== g.resetLine)) {
                const line = document.createElement('div')
                line.className = 'ad-now-reset'
                line.textContent = sidebarReset(g.resetLine, this.sidebarLang)
                gaugeEl.appendChild(line)
            }
        }
        gaugeEl.hidden = !gauges.length
    }

    /**
     * 사이드바 바닥의 **지난 세션** 서랍 — `⟲ 지난 세션 128` 한 줄(기본 접힘)과, 펴면 그 목록.
     *
     * **목록(`.ad-list`) 밖, "지금 이 탭" 줄 바로 위에 고정된다.**
     * 예전에는 그룹마다 하나씩 목록 안에 달려 있었는데, 탭이 몇 개만 되어도 서랍이 화면 밖으로
     * 밀려나 "있는 줄도 몰랐다". 바닥에 붙여 두면 언제나 같은 자리에 있고, 펼치면 위로 자란다
     * (2026-09-14 유저 지시).
     *
     * **줄 수를 자르지 않는다** — 기록해 둔 세션은 전부 들어가고, 서랍은 다섯 줄 남짓만 보이는
     * 스크롤 상자다 (2026-09-14 유저: "기껏 저장한걸 굳이 안쓸 이유는 없을 듯").
     * 그러니 `resumeListLimit`·`resumeListDays` 의 기본값은 0(무제한)이다.
     *
     * 검색어가 걸려 있으면 **여기에도 적용한다**. 서랍이 목록 안에 있던 시절에는 검색 중에
     * 서랍을 통째로 감췄는데(걸러진 화면에 안 걸러진 줄이 섞이면 "검색 결과" 가 깨진다),
     * 이제는 늘 보이는 자리라 감추면 "검색하면 지난 세션이 사라진다" 가 된다.
     */
    private renderResumeDrawer (): void {
        const el = this.resumeEl
        if (!el) {
            return
        }
        const cfg = this.config.store.agentDeck
        if (cfg.resumeList === false) {
            el.hidden = true
            return
        }
        // 목록은 캐시에서 즉시 나온다. 스캔은 비동기로 돌고 끝나면 `onChange` 가 다시 그린다
        void this.ledger.refresh()
        const all = resumeRowsFor(this.ledger.records(), {
            // 그룹으로 거르지 않는다 — 바닥 서랍 하나가 Claude·Codex 가 남긴 전부를 든다
            groupKeys: null,
            keyOf: cwd => groupKeyOf(cwd, projectRootOf),
            fold: foldGroupKey,
            live: this.liveSessionIds(),
            days: Number(cfg.resumeListDays) || 0,
            limit: Number(cfg.resumeListLimit) || 0,
            hidden: new Set<string>(Array.isArray(cfg.resumeHidden) ? cfg.resumeHidden : []),
            now: Date.now(),
        })
        const rows = all
        // Search remains reachable even when the recent-list filters hide every row.
        el.hidden = false
        const expanded = this.isResumeExpanded(null)
        el.classList.toggle('expanded', expanded)

        const headEl = el.querySelector('.ad-resume-head') as HTMLElement
        this.fillResumeHead(headEl, rows.length, all.length, expanded)

        const rowsEl = el.querySelector('.ad-resume-rows') as HTMLElement
        if (!this.historySearchPanel) {
            this.historySearchPanel = new SessionSearchPanel({
                sources: () => this.ledger.historySources(),
                korean: () => this.sidebarLang === 'ko',
                searchLabel: () => this.ui('세션 검색 (제목 · 작업이름 · 폴더)'),
                changed: () => this.renderResumeDrawer(),
                resume: row => {
                    row.openTabId = this.liveSessionIds().get(row.sessionId) || null
                    this.zone.run(() => this.activateResume(row, false))
                },
            })
        }
        if (this.historySearchPanel.element.parentElement !== el) {
            el.insertBefore(this.historySearchPanel.element, rowsEl)
        }
        this.historySearchPanel.update(expanded)
        rowsEl.innerHTML = ''
        rowsEl.hidden = !expanded || this.historySearchPanel.active
        if (rowsEl.hidden) {
            return
        }
        for (const row of rows) {
            rowsEl.appendChild(this.renderResumeRow(row))
        }
        if (!rows.length) {
            const empty = document.createElement('div')
            empty.className = 'ad-resume-empty'
            empty.textContent = this.ui('검색어와 맞는 지난 세션이 없다')
            rowsEl.appendChild(empty)
        }
    }

    /** 지금 탭이 들고 있는 세션 — `세션id -> 탭 식별용 문자열`. 되돌아올 탭은 `resumeTabs` 가 들고 있다 */
    private liveSessionIds (): Map<string, string> {
        this.resumeTabs.clear()
        const out = new Map<string, string>()
        let live: Map<string, BaseTabComponent>
        try {
            live = this.notify.liveSessions()
        } catch {
            return out
        }
        for (const [sid, tab] of live) {
            if (!this.app.tabs.includes(tab)) {
                continue
            }
            out.set(sid, sid)
            this.resumeTabs.set(sid, tab)
        }
        return out
    }

    /** 지난 세션 서랍이 펴져 있나. `collapsedGroups` 와 **반대로 펼침을 적는다** — 기본이 접힘이라서 */
    private isResumeExpanded (key: string | null): boolean {
        const stored = this.config.store.agentDeck.resumeExpanded
        if (!Array.isArray(stored)) {
            return false
        }
        const id = collapseIdOf(key)
        return stored.some((k: unknown) => typeof k === 'string' && foldGroupKey(k) === foldGroupKey(id))
    }

    private toggleResumeExpanded (key: string | null): void {
        const cfg = this.config.store.agentDeck
        const id = collapseIdOf(key)
        const stored: string[] = Array.isArray(cfg.resumeExpanded)
            ? cfg.resumeExpanded.filter((k: unknown): k is string => typeof k === 'string')
            : []
        const kept = stored.filter(k => foldGroupKey(k) !== foldGroupKey(id))
        cfg.resumeExpanded = kept.length === stored.length ? [...stored, id] : kept
        this.config.save()
        this.render()
    }

    /**
     * 서랍 머리줄을 채운다 (엘리먼트는 사이드바를 만들 때 한 번 만들어 둔 것을 다시 쓴다).
     *
     * 머리줄만 `innerHTML` 을 다시 쓰지 않고 자리만 채우는 이유 — 여기에는 클릭 핸들러가
     * 붙어 있고, 렌더마다 노드를 갈아치우면 핸들러도 매번 다시 걸어야 한다.
     * 펼침 표시는 `▴`/`▾` 가 아니라 **위로 열린다는 방향** 그대로 쓴다.
     */
    private fillResumeHead (head: HTMLElement, shown: number, total: number, expanded: boolean): void {
        if (!head.firstChild) {
            head.innerHTML = [
                '<span class="ad-resume-glyph">⟲</span>',
                '<span class="ad-group-label"></span>',
                '<span class="ad-group-count"></span>',
                '<span class="ad-group-caret"></span>',
            ].join('')
            head.addEventListener('click', e => {
                e.preventDefault()
                e.stopPropagation()
                this.toggleResumeExpanded(null)
            })
        }
        head.classList.toggle('collapsed', !expanded)
        head.querySelector('.ad-group-label').textContent = this.ui('지난 세션')
        // 검색으로 좁혀졌으면 `보이는 수/전체` 를 같이 보인다 — 안 그러면 "기록이 줄었나" 로 읽힌다
        head.querySelector('.ad-group-count').textContent = shown === total
            ? String(total)
            : `${shown}/${total}`
        head.querySelector('.ad-group-caret').textContent = expanded ? '▾' : '▴'
        head.title = this.ui('닫힌 Claude Code · Codex 세션 — 누르면 그 대화를 이어받는다')
    }

    private renderResumeRow (row: ResumeRow): HTMLElement {
        const el = document.createElement('div')
        el.className = 'ad-resume' + (row.openTabId ? ' open' : '')
        el.innerHTML = [
            '<div class="ad-bar"></div>',
            '<div class="ad-body">',
            '  <div class="ad-title"></div>',
            '  <div class="ad-meta">',
            '    <span class="re-was"></span>',
            '    <span class="re-when"></span>',
            '  </div>',
            '</div>',
        ].join('\n')

        // 라벨이 비면 세션 id 앞자리로 대신한다 — 줄을 지우면 "이어받을 게 있는데 안 보인다" 가 된다
        const title = row.label || this.ui('세션 {id}', { id: row.sessionId.slice(0, 8) })
        const titleEl = el.querySelector('.ad-title') as HTMLElement
        titleEl.textContent = title
        // 지난 세션도 같은 표식을 단다 — 아래 `re-was` 가 이미 글자로 말하지만("Codex · 완료"),
        // 살아 있는 줄과 눈이 같은 자리에서 같은 것을 찾게 해야 목록 전체가 한 번에 훑힌다.
        // 원장은 claude/codex 만 안다(`sessionLedger.ts` SessionRecord.agent)
        this.decorateAgent(titleEl, profileFor(row.agent ?? 'claude'))

        const was = el.querySelector('.re-was') as HTMLElement
        if (row.openTabId) {
            was.textContent = this.ui('● 열림')
            was.className = 're-was live'
        } else {
            const style = STATUS_STYLES[row.lastStatus as WorkStatus]
            // 끝난 상태는 **흔적으로만** 남긴다 — 살아 있는 배지와 같은 세기로 칠하면
            // 죽은 줄이 도는 줄처럼 읽힌다. 색 대신 형태(점선 바 + 흐림)가 죽음을 말한다
            was.textContent = style ? this.ui(style.label) : ''
            was.className = 're-was' + (row.lastStatus ? ' s-' + row.lastStatus : '')
        }
        was.textContent = `${row.agent === 'codex' ? 'Codex' : 'Claude'} · ${was.textContent || this.ui('지난 세션')}`
        el.querySelector('.re-when').textContent = this.ui(formatWhen(row.lastSeen, Date.now()))

        el.title = title + '\n' + (row.openTabId
            ? this.ui('이미 열려 있다 — 누르면 그 탭으로 이동')
            : this.ui('누르면 새 탭에서 이어받는다 ({id})', { id: row.sessionId })
            + '\n' + this.ui('작업 폴더: {cwd}', { cwd: row.cwd || this.ui('모름') })
            + '\n' + this.ui('※ 대화만 돌아온다 — 그때 띄워 둔 서버·백그라운드 프로세스는 되살아나지 않는다'))

        el.addEventListener('click', e => {
            e.preventDefault()
            e.stopPropagation()
            this.zone.run(() => { void this.activateResume(row, false) })
        })
        el.addEventListener('contextmenu', e => {
            e.preventDefault()
            e.stopPropagation()
            this.zone.run(() => this.showResumeMenu(row, e as MouseEvent))
        })
        return el
    }

    /**
     * 필터에 걸린 것이 하나도 없을 때의 한 줄.
     *
     * **필터가 걸려 있을 때만** 그린다 — 탭이 정말 0개인 화면(기동 직후)에까지 이 문구를 넣으면
     * 필터와 무관한 상태를 필터 탓으로 읽게 된다. 전체 개수를 같이 적는 이유도 그것이다:
     * "탭은 그대로 있고 내 검색어가 안 걸렸을 뿐" 이 한 줄로 보여야 한다.
     */
    private renderEmpty (total: number): HTMLElement {
        const el = document.createElement('div')
        el.className = 'ad-empty'
        const parts: string[] = []
        const q = this.searchQuery.trim()
        if (q) {
            parts.push('"' + q + '"')
        }
        if (this.statusFilter) {
            parts.push(this.ui(STATUS_STYLES[this.statusFilter].label))
        }
        // 검색어는 사용자 입력이다 — textContent 로만 넣는다 (innerHTML 금지)
        el.textContent = this.ui('{filter}에 걸리는 세션이 없다 (전체 {total}개)', { filter: parts.join(' · '), total })
        el.title = this.ui('Esc 또는 ✕ 로 전체 목록으로 돌아간다')
        return el
    }

    /**
     * 탭을 프로젝트(작업 폴더) 그룹으로 나눈다. 규칙은 전부 `group.ts` 에 있다.
     *
     * cwd 는 **이미 채워져 있는 `cwdCache`** 만 본다 — 여기서 `getWorkingDirectory()` 를
     * 새로 부르면 렌더(초당 여러 번, `scheduleRender`)마다 OS 호출이 탭 수만큼 늘어난다.
     * 아직 캐시가 빈 탭은 `기타` 에 있다가, 출력이 흐를 때 `touchCwd` 가 채우면 제 그룹으로 옮겨온다.
     * 프로젝트 루트(`projectRootOf`)도 같은 성질이다 — 처음 보는 폴더는 그 순간엔 cwd 자체가
     * 키였다가, 탐지가 끝나면 저장소 루트로 합쳐진다.
     *
     * 비용은 탭 수만큼의 맵 조작 + 그룹 수²의 라벨 대조뿐이라(group.ts `groupTabs` 주석)
     * 캐시를 두지 않는다 — 캐시 무효화용 시그니처를 만드는 비용이 계산 비용과 같기 때문이다.
     */
    private groupsFor (tabs: readonly BaseTabComponent[]): Array<TabGroup<BaseTabComponent>> {
        // 프로젝트 경계는 **자동으로** 찾는다 (`project-root.ts`) — 조회는 캐시라 렌더를 막지
        // 않고, 처음 보는 폴더는 백그라운드 탐지가 끝나면 다시 그린다.
        return groupTabs(
            tabs,
            tab => this.cwdCache.get(tab)?.dir ?? null,
            cwd => projectRootOf(cwd, () => this.scheduleRender()),
        )
    }

    /** 설정에 남아 있는 접힌 그룹 키들 — 저장·비교는 항상 폴딩한 값으로 (group.ts `collapseIdOf`) */
    private collapsedKeys (): string[] {
        const raw = this.config.store.agentDeck.collapsedGroups
        return Array.isArray(raw) ? raw.map(k => foldGroupKey(String(k))) : []
    }

    /**
     * **설정에 저장된** 접힘 여부. 화면에 실제로 접히는지는 `renderPlan().collapseOf` 가 정한다
     * — 검색 중에는 매칭이 있는 그룹을 임시로 펴 보이기 때문이다(group.ts `resolveGroupCollapse`).
     *
     * 이 함수의 의미를 "유효 접힘" 으로 바꾸면 안 된다. 진단구 `groups().list[].collapsed` 와
     * 회귀 GR8·GR9 가 "제품이 **저장값으로** 접힘이라 판정하는가" 를 보고 있어서,
     * 그 값이 필터에 따라 흔들리면 두 항목의 의미가 무너진다.
     */
    private isGroupCollapsed (key: string | null): boolean {
        return isStoredCollapsed(key, this.config.store.agentDeck.collapsedGroups)
    }

    /**
     * 그룹 접기/펴기. 상태를 설정에 남겨 다음 기동에도 유지한다 —
     * 안 쓰는 프로젝트를 접어 두는 것이 목적인데 매번 다시 접어야 하면 의미가 없다.
     */
    private toggleGroup (key: string | null): void {
        const id = collapseIdOf(key)
        const keys = this.collapsedKeys()
        const next = keys.filter(k => k !== id)
        if (next.length === keys.length) {
            next.push(id)
        }
        this.zone.run(() => {
            this.config.store.agentDeck.collapsedGroups = next
            this.config.save()
        })
        this.render()
    }

    /**
     * 그룹 헤더 한 줄 — `▾ tabby-agentdeck  3`. 클릭하면 접힌다.
     *
     * 탭 줄들과 **형제로** 넣는다(그룹마다 감싸는 div 를 두지 않는다). 상/하 도킹은 목록을
     * 가로로 흘리는데(styles.scss `.ad-dock-top .ad-list`), 감싸면 그 flex 흐름이 그룹마다
     * 끊겨 탭이 세로로 쌓인다. 대신 헤더가 CSS 에서 한 줄을 다 차지해(`flex: 0 0 100%`) 줄을 가른다.
     */
    private renderGroupHead (group: TabGroup<BaseTabComponent>, state: GroupCollapseState): HTMLElement {
        const collapsed = state.collapsed
        const head = document.createElement('div')
        // `filter-open` = 저장된 접힘인데 검색에 걸린 세션이 있어 **임시로** 펴 둔 상태.
        // 사용자에게는 "왜 접어 뒀는데 펴져 있나" 가 보여야 하고, 검색을 지우면 다시 접힌다.
        head.className = collapsed
            ? 'ad-group-head collapsed'
            : (state.reason === 'filter-open' ? 'ad-group-head filter-open' : 'ad-group-head')
        head.innerHTML = [
            '<span class="ad-group-caret"></span>',
            '<span class="ad-group-label"></span>',
            '<span class="ad-group-count"></span>',
        ].join('')
        const caret = head.querySelector('.ad-group-caret') as HTMLElement
        const label = head.querySelector('.ad-group-label') as HTMLElement
        const count = head.querySelector('.ad-group-count') as HTMLElement
        caret.textContent = collapsed ? '▸' : '▾'
        // textContent 로만 넣는다 — 폴더 이름에 어떤 문자가 와도 마크업으로 해석되지 않게
        label.textContent = group.key === null ? this.ui(UNGROUPED_LABEL) : group.label
        // 개수는 접었을 때 특히 필요하다 — 접힌 그룹에 세션이 몇 개 숨어 있는지 보여야 한다
        count.textContent = String(group.tabs.length)
        // 임시로 펴 둔 이유를 꼬리말로 — 이 한 줄이 없으면 "접어 뒀는데 왜 보이나" 가 된다
        const why = state.reason === 'filter-open'
            ? this.ui(' · 검색에 걸린 세션이 있어 임시로 펴 둠 (검색을 지우면 다시 접힌다)')
            : ''
        head.title = (group.key
            ? this.ui('{folder} (탭 {count}개) — 클릭하면 접기/펴기', { folder: group.key, count: group.tabs.length })
            : this.ui('작업 폴더를 아직 모르는 탭 {count}개 — 클릭하면 접기/펴기', { count: group.tabs.length })) + why
        // 헤더도 키보드로 짚을 수 있다 — 거기서 Enter 는 접기/펴기다 (`activateNav`)
        if (this.isNavFocused({ kind: 'head', key: group.key })) {
            head.classList.add('ad-nav-focus')
        }
        head.addEventListener('click', () => this.toggleGroup(group.key))
        return head
    }

    /**
     * 헤더 오른쪽의 상태별 집계 — `⏸ 2  ● 3  ○ 1` 처럼 급한 순서로 놓는다.
     * 총 개수만 보이던 자리다. 세션을 여럿 띄우면 "몇 개가 나를 기다리나" 가 먼저 보여야 한다.
     *
     * 칩은 **상태 필터의 조작부도 겸한다** — 누르면 그 상태만 남고, 한 번 더 누르면 풀린다
     * (그 UI 를 고른 이유는 `toggleStatusFilter` 주석). 그래서 집계는 **항상 전체 탭 기준**이다:
     * 필터 기준으로 세면 다른 상태로 갈아타거나 필터를 풀 수단이 화면에서 사라진다(`render` 주석).
     * 0 인 상태는 그리지 않지만, **지금 걸어 둔 필터의 칩만은 0 이어도 남긴다.**
     * 동적 텍스트는 textContent 로만 넣는다 (innerHTML 금지).
     */
    private renderHeadCount (tabs: readonly BaseTabComponent[], statusOf: (tab: BaseTabComponent) => WorkStatus): void {
        const countEl = this.sidebar.querySelector('.ad-head-count') as HTMLElement | null
        if (!countEl) {
            return
        }
        countEl.innerHTML = ''
        countEl.title = this.ui('탭 {count}개', { count: tabs.length })
        const active = this.statusFilter
        const counts = countByStatus(tabs, statusOf)
        // 걸어 둔 필터의 칩은 **개수가 0 이 되어도 남긴다.** `countByStatus` 는 0 인 상태를
        // 빼는데(order.ts), 그 상태의 마지막 탭이 상태를 바꾸면 칩이 사라져 필터를 끌 수단이
        // 화면에서 없어진다 — 목록은 비었고 이유는 안 보이는 최악의 조합이 된다.
        if (active && !counts.some(c => c.status === active)) {
            counts.push({ status: active, count: 0 })
            counts.sort((a, b) => statusRank(a.status) - statusRank(b.status))
        }
        for (const { status, count } of counts) {
            const style = STATUS_STYLES[status]
            const chip = document.createElement('span')
            chip.className = status === active ? 'ad-cnt active' : 'ad-cnt'
            chip.style.setProperty('--ad-color', style.color)
            chip.title = status === active
                ? this.ui('{status} {count} — 클릭하면 필터 해제', { status: this.ui(style.label), count })
                : this.ui('{status} {count} — 클릭하면 이 상태만', { status: this.ui(style.label), count })
            chip.textContent = `${style.icon} ${count}`
            // `.ad-head` 는 도킹 방향을 바꾸는 드래그 핸들이다(dock.ts `installDockDrag`).
            // 거기서 pointerdown 이 시작되면 헤더가 포인터 캡처를 잡아 우리 click 이 헤더로
            // 되배달될 수 있다. dock.ts 는 `button, input` 만 예외로 두는데 칩은 span 이라
            // 그 예외에 안 걸리므로, 전파를 끊어 드래그가 아예 무장되지 않게 한다.
            chip.addEventListener('pointerdown', ev => ev.stopPropagation())
            chip.addEventListener('click', ev => {
                ev.stopPropagation()
                this.toggleStatusFilter(status)
            })
            countEl.appendChild(chip)
        }
        if (!tabs.length) {
            countEl.textContent = '0'
        }
    }

    /**
     * 제목 줄 머리에 에이전트 표식을 붙인다 — 어느 줄이 Claude 고 Codex 고 Gemini 인지
     * 글자를 읽지 않고 갈리게 (2026-09-14 요청: "뭐가 코덱스고 뭐가 클로드인지 구분이 안돼").
     *
     * **제목 텍스트를 건드리지 않는다.** 표식을 제목 문자열에 이어 붙이면 `.ad-title` 의
     * textContent 가 바뀌어 그것으로 줄을 찾는 회귀 프로브(`tools/probe-resume.js`)가 엉뚱한
     * 줄을 짚는다. 그래서 **글자가 없는 자식 노드**(빈 span + 인라인 SVG)로만 얹는다 —
     * 툴팁도 SVG 안 `<title>` 이 아니라 그 span 의 `title` 속성에 건다(같은 이유).
     *
     * 못 알아본 탭(보통 셸)에는 아무것도 그리지 않는다. 셋 중 하나를 고를 근거가 없을 때
     * 기본값을 그리면 "Claude 인 줄 알았는데 셸" 이라는 오독을 만든다.
     */
    private decorateAgent (titleEl: HTMLElement | null, profile: AgentProfile | undefined): void {
        if (!titleEl || !profile?.icon) {
            return
        }
        const mark = document.createElement('span')
        mark.className = 'ad-agent'
        mark.title = profile.label
        // 상수 SVG 만 들어온다 — 값의 출처는 `agents.ts` 의 ICON_* 리터럴뿐이고 사용자
        // 입력이 섞이는 경로가 없다 (AgentProfile.icon 주석)
        mark.innerHTML = profile.icon
        titleEl.insertAdjacentElement('afterbegin', mark)
    }

    private renderTab (tab: BaseTabComponent): HTMLElement {
        const st = this.status.get(tab)
        const style = STATUS_STYLES[st.status]
        const active = tab === this.app.activeTab

        const row = document.createElement('div')
        row.className = active ? 'ad-tab active' : 'ad-tab'
        row.style.setProperty('--ad-color', style.color)
        // 이 줄이 `app.tabs` 의 몇 번째 탭인지 남긴다. 화면 순서는 정렬(`sortByStatus`)·그룹핑으로
        // 얼마든지 바뀔 수 있어서, "n 번째 줄 = n 번째 탭" 이라는 가정을 두면 안 되기 때문이다
        // (회귀 프로브가 그 가정으로 다른 탭의 배지를 읽은 적이 있다). 없는 탭이면 -1.
        row.dataset.adIndex = String(this.app.tabs.indexOf(tab))
        const slot = this.sessionSlots.numberOf(tab)
        if (slot !== null) { row.dataset.adSlot = String(slot) }
        // 키보드 포커스 링. **`data-ad-index` 에 얹지 않는다** — 그 속성의 뜻은 `app.tabs`
        // 인덱스 하나뿐이고 회귀 R41·R16·R19·GR2 가 그것으로 대상 줄을 찾는다. 포커스는
        // 클래스로만 말한다(`.ad-nav-focus`, styles.scss)
        if (this.isNavFocused({ kind: 'tab', tab })) {
            row.classList.add('ad-nav-focus')
        }

        // [AD:...] 표식은 상태로 이미 반영했으니 제목에서는 지운다
        const tabTitle = stripTitleMarker(tab.customTitle || tab.title || '')
        // 세 줄은 서로 다른 것을 말한다 —
        //  1) 제목: 에이전트가 세션에 붙인 이름. 세션이 사는 동안 거의 안 바뀐다
        //     (Claude Code 는 시작 때 붙인 콘솔 제목을 계속 들고 있다, 2026-08-28 실측)
        //  2) 프롬프트: 마지막으로 보낸 지시. 작업이 넘어갈 때마다 바뀐다
        //  3) 상태: 지금 돌고 있는지 / 얼마나 됐는지
        // 예전에는 1과 2를 한 줄에 겹쳐 놓느라 둘 중 하나를 못 봤다.
        const title = tabTitle || this.ui('(제목 없음)')
        const elapsed = this.config.store.agentDeck.showElapsed
            ? this.formatElapsed(Date.now() - st.since)
            : ''

        row.innerHTML = [
            '<div class="ad-bar"></div>',
            '<div class="ad-body">',
            '  <div class="ad-title"></div>',
            // 라벨은 더블클릭하면 입력창으로 바뀐다(startLabelEdit) — 그때 줄이 무너지지 않게
            // 감싸는 줄을 따로 둔다
            '  <div class="ad-prompt"><span class="ad-label"></span></div>',
            '  <div class="ad-meta">',
            '    <span class="ad-badge"></span>',
            '    <span class="ad-elapsed"></span>',
            '  </div>',
            '</div>',
            this.uiMarkup('<button class="ad-close" title="탭 닫기">&times;</button>'),
        ].join('\n')

        // textContent 로만 넣는다 — 탭 제목에 어떤 문자가 와도 마크업으로 해석되지 않게
        const titleEl = row.querySelector('.ad-title') as HTMLElement
        titleEl.textContent = title
        this.decorateAgent(titleEl, this.profileForTab(tab))
        const labelEl = row.querySelector('.ad-label')
        // 아직 프롬프트가 없어도 줄은 남겨 둔다 — 줄 수가 들쭉날쭉하면 목록이 어지럽고,
        // 더블클릭으로 이름을 붙일 자리도 사라진다
        labelEl.textContent = st.label || '—'
        labelEl.classList.toggle('empty', !st.label)
        row.querySelector('.ad-elapsed').textContent = elapsed
        const badge = row.querySelector('.ad-badge') as HTMLElement
        // 승인대기 이유가 있으면 뒤에 붙인다 — "⏸ 승인대기 · Bash 권한". 여러 세션을 띄워 둔 사람이
        // 사이드바만 보고 지금 가서 승인할지 정할 수 있게. 원문은 title 로 마우스를 올리면 보인다
        const reason = sidebarReason(st.reason, this.sidebarLang)
        badge.textContent = style.icon + ' ' + this.ui(style.label) + (reason ? ' · ' + reason : '')
        badge.title = reason
        if (st.pinned) {
            badge.classList.add('pinned')
        }

        // 도는 서브에이전트 개수 — **상태 배지 바로 뒤, 경과시간 앞**에 끼운다.
        //
        // 왜 그 자리인가. 이 줄(`.ad-meta`)에는 이미 상태 배지(승인 이유·한도 문구까지 붙어
        // 길어질 수 있다)와 경과시간이 있고 경과시간은 `margin-left: auto` 로 오른쪽 끝에
        // 붙어 있다(styles.scss). ① "지금 몇 개가 도는가" 는 상태의 부연이라 배지 옆이 읽는
        // 순서에 맞다. ② 배지는 줄어들 수 있게(`flex: 0 1 auto` + 말줄임) 두고 이 칩만
        // `flex: 0 0 auto` 로 두면 이유 문구가 길어져도 **개수가 먼저 밀려나지 않는다**.
        // ③ 제목·프롬프트 줄에 얹으면 그 두 줄의 말줄임 폭을 먹어 제목이 잘린다.
        // 줄의 **직계 자식 구성은 그대로** 다 — 새 노드는 `.ad-meta` 안에만 들어가고
        // `data-ad-index` 의 뜻도 건드리지 않는다(회귀 R41·RO2·GR2 가 그것으로 줄을 찾는다).
        //
        // **0 개면 아무것도 그리지 않는다** — 모든 줄에 `0` 이 붙으면 그냥 노이즈다.
        // 표시/스캔의 on-off 게이트(`agentDeck.subagentCount`)는 `subagentsOf` 안에 하나만 있다.
        const sub = this.notify.subagentsOf(tab)
        if (sub) {
            const chip = document.createElement('span')
            chip.className = 'ad-subagents'
            chip.textContent = `❖${sub.running}`
            // 개수만으로는 무엇을 시켜 놨는지 모른다 — 목록과 경과 시간은 툴팁이 말한다.
            // 빈 문자열이면 `title` 을 아예 붙이지 않는다(빈 툴팁이 떠서 커서를 가리지 않게)
            if (sub.tooltip) {
                chip.title = sub.tooltip
            }
            badge.insertAdjacentElement('afterend', chip)
        }

        // 순서 드래그의 시작점 — 임계치를 넘기기 전에는 아무 일도 하지 않으므로 클릭을 가리지 않는다
        // Fixed slots deliberately do not register drag-to-reorder handlers.
        row.addEventListener('click', ev => {
            if ((ev.target as HTMLElement).closest('.ad-close')) {
                return
            }
            // 방금 끝난 것이 드래그였으면 이 click 은 그 부산물이다 (dragClickGuard 주석)
            if (this.dragClickGuard) {
                this.dragClickGuard = false
                return
            }
            // 마우스로 짚은 줄에서 키보드가 이어지게 — 핫키를 누르면 여기서 시작한다.
            // 링은 목록이 포커스를 가질 때만 그리므로(`isNavFocused`) 지금 화면은 바뀌지 않는다
            this.navFocus = { kind: 'tab', tab }
            this.zone.run(() => this.app.selectTab(tab))
        })
        row.addEventListener('dblclick', ev => {
            ev.preventDefault()
            this.startLabelEdit(row, tab)
        })
        row.addEventListener('contextmenu', ev => {
            ev.preventDefault()
            this.showStatusMenu(ev, tab)
        })
        row.querySelector('.ad-close').addEventListener('click', ev => {
            ev.stopPropagation()
            this.zone.run(() => { void this.app.closeTab(tab, true) })
        })
        return row
    }

    // ---------- 키보드 내비게이션 ----------

    /**
     * 키보드가 지금 어디를 갖고 있나 — **`document.activeElement` 가 유일한 출처다.**
     *
     * 플래그로 들고 있지 않는 이유: "우리가 키를 받는가" 는 곧 브라우저 포커스가 어디 있나이고,
     * 그 둘이 어긋나는 순간(다른 코드가 터미널을 다시 포커스하는 일은 흔하다 —
     * `selectTab` → `emitFocused` → `frontend.focus()`) 플래그를 믿은 쪽이 **터미널 입력을
     * 먹는다.** 파생값으로 두면 어긋날 수가 없다.
     */
    private get navMode (): 'off' | 'search' | 'list' {
        const el = document.activeElement
        if (el && el === this.searchEl) {
            return 'search'
        }
        if (el && el === this.listEl) {
            return 'list'
        }
        return 'off'
    }

    /** 키보드 조작을 받을 상태인가 — 끄면(`keyboardNav: false`) 진입 자체를 하지 않는다 */
    private get navReady (): boolean {
        return !!this.listEl && this.enabled && this.config.store.agentDeck.keyboardNav !== false
    }

    /** 검색창이 화면에 있나 (`applySearchBox` 와 같은 조건) — 위쪽 경계에서 나갈 곳이 있는지 */
    private navSearchVisible (): boolean {
        return !!this.searchEl && this.enabled && this.config.store.agentDeck.searchBox !== false
    }

    /**
     * 지금 화면의 이동 순서와 그 안에서의 포커스 위치. **매번 `renderPlan()` 에서 새로 받는다.**
     *
     * 사본을 들고 있지 않는 이유 — 정렬(`sortByStatus`)·검색·상태 필터·그룹 접힘이 전부 이
     * 계산에 걸려 있어서, 한 번 만들어 둔 목록은 다음 상태 변화에 곧 낡는다. 줄 수는 탭 수
     * 규모(수십)라 매 키마다 다시 계산해도 비용이 렌더 한 번보다 싸다.
     */
    private navPlan (): { rows: Array<NavRow<BaseTabComponent>>, index: number } {
        const { withHeads, plan, collapseOf } = this.renderPlan()
        const rows = navRowsOf(plan.map(group => ({
            key: group.key,
            tabs: group.tabs,
            head: withHeads,
            // 헤더를 안 그리는 화면에서는 접힘을 적용하지 않는다 — `render()` 와 같은 규칙
            collapsed: withHeads && collapseOf(group).collapsed,
        })))
        return { rows, index: this.navIndexIn(rows) }
    }

    /** 같은 줄을 가리키나 — 탭은 객체 동일성, 그룹은 폴딩한 키로 본다(`group.ts collapseIdOf`) */
    private sameNavRow (a: NavRow<BaseTabComponent>, b: NavRow<BaseTabComponent>): boolean {
        if (a.kind === 'tab' && b.kind === 'tab') {
            return a.tab === b.tab
        }
        if (a.kind === 'head' && b.kind === 'head') {
            return collapseIdOf(a.key) === collapseIdOf(b.key)
        }
        return false
    }

    /** 지금 포커스가 이 줄 목록의 몇 번째인가 — 없거나 화면에서 사라졌으면 -1 */
    private navIndexIn (rows: ReadonlyArray<NavRow<BaseTabComponent>>): number {
        const focus = this.navFocus
        if (!focus) {
            return -1
        }
        for (let i = 0; i < rows.length; i++) {
            if (this.sameNavRow(rows[i], focus)) {
                return i
            }
        }
        return -1
    }

    /** 이 줄에 포커스 링을 그려야 하나 — **목록이 키보드를 갖고 있을 때만** 그린다 */
    private isNavFocused (row: NavRow<BaseTabComponent>): boolean {
        return this.navMode === 'list' && !!this.navFocus && this.sameNavRow(row, this.navFocus)
    }

    /**
     * 닫힌 탭을 가리키는 포커스를 버린다 (`render()` 가 매번 부른다).
     *
     * **필터로 숨은 줄은 버리지 않는다** — 검색을 지우면 같은 줄로 돌아와야 한다. 그래서 판정
     * 기준은 `app.tabs` 에 남아 있는지 하나뿐이다(닫힌 탭은 영영 돌아오지 않는다). 이 정리가
     * 없으면 닫힌 탭 하나를 계속 붙들고 있게 되고, ↑↓ 를 눌러도 "없는 줄" 에서 시작한다.
     */
    private pruneNavFocus (): void {
        const focus = this.navFocus
        if (focus && focus.kind === 'tab' && !this.app.tabs.includes(focus.tab)) {
            this.navFocus = null
        }
    }

    /**
     * 목록에 키보드 포커스를 준다 (핫키 · 검색창 ↓).
     *
     * 포커스를 **`.ad-list` 엘리먼트에** 준다. 이 엘리먼트는 `render()` 가 innerHTML 만 비우고
     * 자신은 새로 만들지 않으므로(`buildSidebar` 에서 한 번 만든다) 렌더를 몇 번 왕복해도
     * 포커스가 살아남는다 — 줄(`.ad-tab`)에 포커스를 주면 매 렌더에 날아간다. 어느 줄인지는
     * DOM 이 아니라 `navFocus`(탭 객체 / 그룹 키)가 들고 있어서 역시 렌더에 지워지지 않는다.
     * 라벨 편집(`this.editing`)·드래그(`this.drag`)가 대상을 객체로 들고 있는 것과 같은 방식이다.
     */
    private focusList (where: 'keep' | 'first' | 'last' = 'keep'): boolean {
        if (!this.navReady) {
            return false
        }
        const { rows, index } = this.navPlan()
        if (!rows.length) {
            return false
        }
        if (where === 'last') {
            this.navFocus = rows[rows.length - 1]
        } else if (where === 'first' || index < 0) {
            this.navFocus = rows[0]
        }
        // **여기서 tabindex 를 준다** (배선 때가 아니라). tabindex 가 붙은 엘리먼트는 그 안을
        // 클릭해도 포커스를 받으므로, 배선 때 붙여 두면 이 기능을 끈 사람(`keyboardNav: false`)이
        // 목록 빈 자리를 클릭했을 때 키가 사이드바에 갇힌다 — 꺼 둔 기능이 만든 죽은 상태다.
        // -1 인 이유: Tab 순서에 넣지 않는다. 터미널에서 Tab 을 누른 사람이 사이드바로 튀면
        // 입력이 사라지고, 에이전트 CLI 는 Tab 을 자기 것으로 쓴다.
        this.listEl.tabIndex = -1
        // preventScroll: 포커스를 주는 것만으로 목록이 튀지 않게 — 어디로 스크롤할지는
        // `scrollNavIntoView` 가 포커스 줄 기준으로 정한다
        this.listEl.focus({ preventScroll: true })
        this.render()
        this.scrollNavIntoView()
        return true
    }

    /** 검색창으로 (목록 첫 줄에서 ↑ · 목록에서 Tab · 핫키인데 줄이 하나도 없을 때) */
    private focusSearch (): boolean {
        if (!this.navSearchVisible()) {
            return false
        }
        this.searchEl.focus()
        // 커서는 글 끝에 둔다 — 이어서 치는 것이 자연스럽다(select 하면 다음 글자가 다 지운다)
        try {
            const n = this.searchEl.value.length
            this.searchEl.setSelectionRange(n, n)
        } catch {
            // 일부 입력 타입은 선택 범위를 못 받는다 — 포커스만으로 충분하다
        }
        // 링을 지운다 — 포커스가 검색창으로 갔으니 `navMode` 는 이제 'search' 다
        this.render()
        return true
    }

    /**
     * 키보드를 터미널에 돌려준다 (Esc · Enter 로 탭을 고른 뒤).
     *
     * **먼저 우리 것을 blur 한다.** `frontend.focus()` 는 `setTimeout` 안에서 xterm 을 포커스하므로
     * (`tabby-terminal/dist/index.js:3415`) 그것만 부르면 이 함수가 끝난 시점에는 아직 포커스가
     * 우리에게 있고, 곧바로 그리는 화면에 링이 남는다. blur 는 동기라 `navMode` 가 즉시 'off' 가 된다.
     * blur 만 하고 끝내지 않는 이유도 분명하다 — 포커스가 `<body>` 에 앉으면 사이드바도 터미널도
     * 키를 못 받아 키보드가 죽은 것처럼 보인다.
     */
    private releaseKeyboard (): void {
        const el = document.activeElement
        if (el === this.listEl || el === this.searchEl) {
            (el as HTMLElement).blur()
        }
        const pane = this.focusedPane()
        if (typeof pane?.frontend?.focus === 'function') {
            pane.frontend.focus()
        } else {
            // 터미널이 아닌 탭(설정 화면 등) — 순정이 포커스를 배달하는 경로에 맡긴다
            (this.app.activeTab as any)?.emitFocused?.()
        }
        this.render()
    }

    /**
     * ↑↓ · Home · End.
     *
     * 경계 규칙은 순수 함수(`stepNavIndex`)가 정하고, 여기서는 **검색창으로 나가는 경계**만
     * 따로 본다: 검색 줄이 보이는 상태에서 첫 줄의 ↑ 는 항상 검색창이다. 감싸기(`keyboardNavWrap`)
     * 보다 이쪽을 앞에 두는 이유 — 검색↔목록 왕복이 이 기능의 요구사항이고, 감싸기를 켠 사람에게
     * 그 길이 사라지면 검색창으로 되돌아갈 키가 아예 없어진다(Tab 이 남지만 그건 우회로다).
     */
    private moveNav (step: number, to?: 'first' | 'last'): void {
        if (!this.navReady) {
            return
        }
        const { rows, index } = this.navPlan()
        if (!rows.length) {
            this.navFocus = null
            return
        }
        if (!to && step < 0 && index === 0 && this.navSearchVisible()) {
            this.focusSearch()
            return
        }
        const wrap = !!this.config.store.agentDeck.keyboardNavWrap
        const next = to === 'first'
            ? 0
            : to === 'last'
                ? rows.length - 1
                : stepNavIndex(rows.length, index, step, wrap)
        if (next < 0) {
            return
        }
        this.navFocus = rows[next]
        this.render()
        this.scrollNavIntoView()
    }

    /**
     * Enter — 탭 줄이면 그 탭으로 전환, 그룹 헤더면 접기/펴기.
     *
     * **여기가 포커스와 선택이 만나는 유일한 지점이다.** ↑↓ 로는 활성 탭이 바뀌지 않고
     * (그래야 훑어볼 수 있다, `navFocus` 주석), 사람이 "이거" 라고 말하는 순간이 Enter 다.
     * 탭을 골랐으면 이어서 할 일은 그 터미널에 치는 것이므로 키보드도 같이 넘긴다.
     * 헤더에서는 넘기지 않는다 — 접었다 펴 보는 것은 아직 목록을 훑는 중이다.
     */
    private activateNav (): void {
        const focus = this.navFocus
        if (!focus) {
            return
        }
        if (focus.kind === 'head') {
            this.toggleGroup(focus.key)
            this.scrollNavIntoView()
            return
        }
        if (!this.app.tabs.includes(focus.tab)) {
            return
        }
        this.zone.run(() => this.app.selectTab(focus.tab))
        this.releaseKeyboard()
    }

    /**
     * `Ctrl-N` — 사이드바에 **보이는 순서**로 N 번째 세션으로 간다 (`pickJumpTarget`).
     *
     * ↑↓ 와 달리 훑어보기가 아니라 **바로 전환**이다. 사람이 번호를 누르는 것은 이미 어디로
     * 갈지 정했다는 뜻이고, 포커스만 옮기면 Enter 를 한 번 더 눌러야 해서 키 두 번짜리
     * `Ctrl-L` + ↑↓ 와 다를 것이 없어진다.
     *
     * **키보드 내비게이션 모드에 들어가지 않는다.** 목록에 포커스를 주면 그 다음 타이핑이
     * 터미널로 안 가고(`navMode === 'list'`) 사람은 방금 연 세션에 곧바로 치려던 참이다.
     * 그래서 `navFocus` 만 그 줄로 맞춰 둔다 — 이어서 `Ctrl-L` 을 누르면 방금 간 줄에서
     * 훑기가 시작된다.
     *
     * 사이드바를 껐거나(`enabled: false`) 키보드 조작을 끈 사람(`keyboardNav: false`)에게는
     * 이 키도 없다 — `navReady` 하나로 판정한다. 사이드바가 안 보이는데 "보이는 순서로 N 번째"
     * 는 말이 되지 않고, 끈 기능의 키만 살아 있으면 터미널이 `Ctrl-N` 을 영영 못 받는다.
     */
    private jumpToRow (slot: number): void {
        if (!this.navReady || !Number.isInteger(slot) || slot < 1 || slot > JUMP_SLOTS) {
            return
        }
        this.syncSessionSlots()
        const tab = this.sessionSlots.get(slot)
        // 범위 밖이면 아무 일도 하지 않는다 (`pickJumpTarget` 주석). 닫히는 중인 탭도 거른다
        if (!tab || !this.app.tabs.includes(tab)) {
            return
        }
        this.navFocus = { kind: 'tab', tab }
        this.zone.run(() => this.app.selectTab(tab))
        this.diag(`jump slot=${slot}`)
    }

    /**
     * Esc — **보이는 것부터 되돌린다.** 걸린 검색어·상태 필터가 있으면 그것을 먼저 지우고
     * 포커스는 사이드바에 남기고, 지울 것이 없을 때 비로소 터미널로 나간다.
     *
     * 순서를 이렇게 정한 근거는 이 기능 밖에 있다 — `✕` 버튼의 title 이 이미
     * `검색·필터 지우기 (Esc)` 이고 빈 목록 안내도 `Esc 또는 ✕ 로 전체 목록으로 돌아간다` 라고
     * 적혀 있다(`renderEmpty`). 회귀 R52 도 그 계약을 본다. Esc 를 먼저 "나가기" 로 바꾸면
     * 화면에 적힌 말과 어긋나고, 좁혀진 목록을 남긴 채 포커스만 빠져 필터가 감춰진다 —
     * 이 저장소가 가장 위험하다고 적어 둔 실패 모양이다(`searchQuery` 주석).
     *
     * 검색창의 Esc 도 이 함수로 온다 — 규칙이 두 군데 있으면 갈린다.
     */
    private navEscape (): void {
        if (this.searchQuery.trim() || this.statusFilter) {
            this.clearFilters()
            return
        }
        this.releaseKeyboard()
    }

    /**
     * 핫키(`agentdeck-focus-list`) — 같은 키로 들어가고 나온다.
     *
     * 목록으로 들어간다(검색창이 아니라). 이 키를 누르는 목적은 "지금 뜬 세션 중에서 고르는 것"
     * 이고, 검색은 첫 줄에서 ↑ 한 번이면 닿는다. 반대로 검색창을 진입점으로 삼으면 세션이
     * 세 개뿐인 사람도 매번 빈 입력창을 지나가야 한다. 줄이 하나도 없으면(탭 0개 · 필터에
     * 아무것도 안 걸림) 검색창으로 보낸다 — 그때 사람이 할 수 있는 일은 검색어를 고치는 것뿐이다.
     */
    private toggleKeyboardNav (): void {
        if (!this.navReady) {
            return
        }
        if (this.navMode !== 'off') {
            this.releaseKeyboard()
            return
        }
        if (!this.focusList('keep')) {
            this.focusSearch()
        }
    }

    /**
     * 포커스 줄이 목록 밖으로 나갔으면 스크롤해 보여준다.
     *
     * **키로 옮겼을 때만** 부른다. 매 렌더(경과시간 tick 이 1초마다 돈다)마다 부르면 마우스로
     * 목록을 스크롤해 둔 사람의 화면을 계속 되돌린다. `block: 'nearest'` 라 이미 보이는 줄에는
     * 아무 일도 하지 않으므로, 목록이 길어져도 필요한 만큼만 움직인다
     * (탭이 많으면 화면 밖으로 못 나가던 것이 cycle 10 에서 남은 것으로 적혀 있었다).
     */
    private scrollNavIntoView (): void {
        const el = this.listEl?.querySelector('.ad-nav-focus') as HTMLElement | null
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }

    /**
     * 목록의 키보드 조작을 배선한다.
     *
     * 리스너를 **`.ad-list` 엘리먼트에** 건다 — 그것이 곧 "포커스가 없을 때는 아무것도
     * 가로채지 않는다" 의 보증이다. document 리스너 + 플래그로 하면 플래그가 어긋나는 순간
     * 터미널 입력을 먹는데, 이 파일은 이미 그 대가를 알고 있다(`claimCtrlVKey` 계열은 그래서
     * `isPlainInput` 가드를 달고 있다). 엘리먼트에 걸면 포커스가 여기 없는 동안 이벤트가
     * **아예 오지 않는다.**
     *
     * 처리한 키는 `preventDefault` + `stopPropagation` 으로 끊는다. 끊으면 Tabby core 의
     * document **버블** 리스너(`tabby-core/dist/index.js:6329` keydown → `pushKeyEvent`)까지
     * 죽으므로 핫키도 발화하지 않는다 — 우리 리스너는 target(`.ad-list`)에 걸려 있어 그보다
     * 먼저 돈다. 반대로 **캡처 단계**에 걸린 우리 리스너들(Ctrl+V · Shift+Enter · Enter 라벨 ·
     * Home/End IME)은 이보다 먼저 돌아 끊을 수 없으므로, 그쪽이 `isDeckUiKey` 로 사이드바에서
     * 난 키를 비켜 준다.
     *
     * 수식키(Ctrl·Alt·Meta)가 붙은 조합은 손대지 않는다 — 그건 Tabby 핫키의 몫이다
     * (Shift 는 예외: Shift+Tab 이 Tab 과 같은 뜻이어야 한다).
     */
    private wireListKeys (list: HTMLElement): void {
        // 여기서는 리스너만 건다 — 목록을 포커스 받을 수 있게 만드는 것(`tabIndex`)은
        // 진입 함수 `focusList` 가 한다(이유는 그쪽 주석).
        list.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (!this.navReady) {
                return
            }
            if (ev.ctrlKey || ev.altKey || ev.metaKey) {
                return
            }
            const key = ev.key
            const code = ev.code
            const stop = (): void => {
                ev.preventDefault()
                ev.stopPropagation()
            }
            if (key === 'ArrowDown' || code === 'ArrowDown') {
                stop()
                this.moveNav(1)
                return
            }
            if (key === 'ArrowUp' || code === 'ArrowUp') {
                stop()
                this.moveNav(-1)
                return
            }
            if (key === 'Home' || code === 'Home') {
                stop()
                this.moveNav(0, 'first')
                return
            }
            if (key === 'End' || code === 'End') {
                stop()
                this.moveNav(0, 'last')
                return
            }
            if (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter') {
                // 조합 확정용 Enter 는 우리 것이 아니다 (`claimEnterLabel` 과 같은 판정)
                if (ev.isComposing || ev.keyCode === 229) {
                    return
                }
                stop()
                this.activateNav()
                return
            }
            if (key === 'Escape' || code === 'Escape') {
                stop()
                this.navEscape()
                return
            }
            if (key === 'Tab' || code === 'Tab') {
                // 기본 동작으로 새면 사이드바도 터미널도 아닌 곳(툴바 버튼 등)에 포커스가 앉아
                // 키보드가 죽는다. 검색창이 있으면 거기로 보내고, 없으면 그냥 붙잡아 둔다
                stop()
                this.focusSearch()
                return
            }
        })
        // 포커스가 오갈 때 링을 맞춘다 — `navMode` 는 activeElement 로 판정하므로 다시
        // 그리기만 하면 된다. 줄을 마우스로 클릭했을 때도 여기로 들어오는데, 그때는 곧바로
        // `selectTab` → `frontend.focus()` 가 포커스를 터미널로 되가져가고(setTimeout, ~1ms)
        // 그건 rAF 보다 빨라 링이 그려지기 전에 상태가 되돌아간다.
        list.addEventListener('focus', () => this.scheduleRender())
        list.addEventListener('blur', () => this.scheduleRender())
    }

    // ---------- 줄 드래그로 순서 바꾸기 ----------

    /**
     * pointerdown — 아직 드래그로 단정하지 않는다(무장까지만).
     *
     * 이 줄 위에서 일어나는 조작이 이미 넷이다: 클릭=탭 선택, 더블클릭=라벨 편집,
     * 우클릭=상태 지정, `✕`=닫기. 그래서 **왼쪽 버튼 + 버튼/입력창 밖 + 임계치 초과** 세
     * 조건을 다 만족할 때만 드래그가 된다 (`dock.ts installDockDrag` 와 같은 규약).
     *
     * 뒤 이벤트를 줄이 아니라 **document 에서 캡처 단계로** 받는 이유 둘 —
     *  1) `setPointerCapture` 는 합성 포인터에서 던진다(tools/README 함정 목록). 캡처에
     *     기대면 회귀 프로브가 이 기능을 흉내낼 수 없다. document 리스너는 캡처가 없어도
     *     커서가 줄 밖으로 나가도 계속 온다.
     *  2) Esc 를 캡처 단계에서 먼저 잡아야 터미널·검색창으로 새지 않는다.
     */
    private armRowDrag (ev: PointerEvent, tab: BaseTabComponent, row: HTMLElement): void {
        // 새 손짓이 시작됐다 — 지난 드래그가 남긴 가드를 여기서 버린다 (dragClickGuard 주석)
        this.dragClickGuard = false
        if (ev.button !== 0 || this.drag || this.editing) {
            return
        }
        // 닫기 버튼과 라벨 입력창은 그쪽 일이다 (dock.ts 도 `button, input` 을 비켜 준다)
        if ((ev.target as HTMLElement).closest('button, input')) {
            return
        }
        const onMove = (e: PointerEvent) => this.dragMove(e)
        const onUp = (e: PointerEvent) => this.endRowDrag(true, e)
        const onCancel = () => this.endRowDrag(false, undefined, 'cancel')
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' && e.code !== 'Escape') {
                return
            }
            // 취소 경로 하나 — Esc. 여기서 끊지 않으면 터미널로 새고 검색 필터까지 지워진다
            e.preventDefault()
            e.stopPropagation()
            this.endRowDrag(false, undefined, 'esc')
        }
        document.addEventListener('pointermove', onMove, true)
        document.addEventListener('pointerup', onUp, true)
        document.addEventListener('pointercancel', onCancel, true)
        document.addEventListener('keydown', onKey, true)
        this.drag = {
            tab,
            row,
            from: { x: ev.clientX, y: ev.clientY },
            at: { x: ev.clientX, y: ev.clientY },
            moved: false,
            target: null,
            line: null,
            scrolled: { px: 0, axis: null },
            scroll: null,
            detach: () => {
                document.removeEventListener('pointermove', onMove, true)
                document.removeEventListener('pointerup', onUp, true)
                document.removeEventListener('pointercancel', onCancel, true)
                document.removeEventListener('keydown', onKey, true)
            },
        }
    }

    /** pointermove — 임계치를 넘기면 드래그로 승격하고, 그 뒤로는 놓일 자리를 계속 다시 잰다 */
    private dragMove (ev: PointerEvent): void {
        const d = this.drag
        if (!d) {
            return
        }
        if (!d.moved) {
            if (Math.hypot(ev.clientX - d.from.x, ev.clientY - d.from.y) < ROW_DRAG_THRESHOLD) {
                return
            }
            if (this.config.store.agentDeck.sortByStatus) {
                this.noteReorderBlocked()
                // 손짓은 드래그였다 — 뒤따라 오는 click(탭 선택)까지 먹지 않게 가드를 켠다.
                // 안내를 읽으려는 사람의 활성 탭이 바뀌면 터미널 화면까지 튄다.
                this.dragClickGuard = true
                this.endRowDrag(false, undefined, 'blocked-sort')
                return
            }
            d.moved = true
            d.row.classList.add('ad-dragging')
            // 드래그 중에는 커서를 옮기기 모양으로 — 줄마다 주는 것보다 한 곳에서 켜고 끄는 편이 안전하다
            document.body.classList.add('ad-reordering')
        }
        // 드래그 중의 텍스트 선택·브라우저 기본 자동 스크롤 같은 동작을 막는다
        // (목록 스크롤은 우리가 `dragScrollTick` 에서 직접 한다 — 브라우저 것은 축·속도·
        //  삽입선 갱신을 우리 규칙과 맞출 수 없다)
        ev.preventDefault()
        d.at = { x: ev.clientX, y: ev.clientY }
        this.refreshDropTarget()
        // 놓일 자리를 먼저 재고 **그 다음** 스크롤을 건다 — 순서가 반대면 커서를 띠에 넣는
        // 순간의 한 프레임 동안 삽입선이 스크롤 전 자리를 가리킨다
        this.armDragScroll()
    }

    /**
     * 지금 포인터 자리로 놓일 자리를 다시 재고 삽입선을 다시 그린다.
     *
     * 포인터가 움직였을 때(`dragMove`)와 **목록이 커서 아래에서 흘렀을 때**(`dragScrollTick`)
     * 둘 다 필요한 일이라 한 곳에 둔다. 스크롤 뒤 이것을 부르지 않으면 삽입선이 옛 자리에
     * 남아 "어디에 떨어질지 모르는 드래그" 가 되어, 자동 스크롤이 없애려던 문제로 돌아간다.
     *
     * 판정은 반드시 `dropTargetAt` 을 지난다 — 낡은 `data-ad-index` 검사(`stale-index`)를
     * 우회하는 지름길을 만들지 않는다.
     */
    private refreshDropTarget (): void {
        const d = this.drag
        if (!d) {
            return
        }
        d.target = this.dropTargetAt(d.at.x, d.at.y)
        this.drawReorderLine()
    }

    /**
     * 목록이 실제로 스크롤되는 축 — 도킹 방향으로 정하지 않고 **넘치는 쪽을 재서** 정한다.
     * 넘치지 않으면 null (= 자동 스크롤이 할 일이 없는 화면).
     *
     * 흐르는 축(`listFlowsSideways`)과 **스크롤되는 축이 다르다**는 것이 실측이다:
     * 상/하 도킹의 목록은 줄이 가로로 흐르지만 `flex-wrap: wrap` + `overflow-x: hidden`
     * 이라 넘치면 **아래로 감기고 세로로** 스크롤된다(`styles.scss` 의 `.ad-dock-top .ad-list`).
     * 그래서 흐름축을 그대로 스크롤축으로 쓰면 상/하 도킹에서 이 기능이 **조용히 아무것도
     * 안 하게** 된다. 흐름축은 두 축이 다 넘칠 때의 우선순위로만 쓴다 — 그때는 사용자가
     * 눈으로 따라가는 방향이 흐름축이다.
     */
    private listScrollAxis (): 'x' | 'y' | null {
        const el = this.listEl
        if (!el) {
            return null
        }
        // 1px 는 소수점 레이아웃에서 늘 생기는 잔차라 넘침으로 세지 않는다
        const canY = el.scrollHeight - el.clientHeight > 1
        const canX = el.scrollWidth - el.clientWidth > 1
        if (canY && canX) {
            return this.listFlowsSideways() ? 'x' : 'y'
        }
        if (canY) {
            return 'y'
        }
        return canX ? 'x' : null
    }

    /**
     * 지금 포인터 자리에서의 자동 스크롤 속도 (px/s). 0 이면 스크롤할 이유가 없다.
     *
     * **여기는 DOM 을 읽는 껍데기고 판단은 `planEdgeScroll` 이 한다** — 속도 램프·띠 겹침·
     * 끝 도달 같은 규칙이 rect 읽기와 한 함수에 있으면 그것을 검사할 방법이 없다.
     * 옮긴 뒤 `test/order.test.js` 가 전수로 잰다(`planTabMove`·`stepNavIndex` 와 같은 방식).
     */
    private dragScrollSpeed (axis: 'x' | 'y'): number {
        const el = this.listEl
        const d = this.drag
        if (!el || !d) {
            return 0
        }
        const r = el.getBoundingClientRect()
        const vertical = axis === 'y'
        return planEdgeScroll({
            pos: vertical ? d.at.y : d.at.x,
            near: vertical ? r.top : r.left,
            far: vertical ? r.bottom : r.right,
            cur: vertical ? el.scrollTop : el.scrollLeft,
            maxScroll: vertical
                ? el.scrollHeight - el.clientHeight
                : el.scrollWidth - el.clientWidth,
            bandPx: DRAG_SCROLL_BAND_PX,
            minPps: DRAG_SCROLL_MIN_PPS,
            maxPps: DRAG_SCROLL_MAX_PPS,
        })
    }

    /**
     * 포인터가 목록 가장자리 띠에 있으면 자동 스크롤 루프를 건다 (이미 돌고 있으면 그대로 둔다).
     *
     * **끌고 있을 때만 부른다** — `dragMove` 가 임계치를 넘긴 뒤의 유일한 호출자다.
     * 마우스가 목록 끝에 얹혀 있어도 드래그가 아니면 이 함수에 닿는 길이 없다(hover 리스너를
     * 두지 않은 이유가 그것이다).
     */
    private armDragScroll (): void {
        const d = this.drag
        if (!d || !d.moved) {
            return
        }
        // 끈 사람의 화면은 0.12.0 과 똑같아야 한다 (config `dragAutoScroll`)
        if (!this.config.store.agentDeck.dragAutoScroll) {
            return
        }
        const axis = this.listScrollAxis()
        if (!axis || (d.scroll && d.scroll.axis !== axis)) {
            // 축이 바뀌었으면(도킹 변경·목록 재구성) 옛 축의 루프는 버린다
            this.stopDragScroll(d)
            if (!axis) {
                return
            }
        }
        if (!this.dragScrollSpeed(axis)) {
            // 띠를 벗어났거나 끝에 닿았다 — 돌고 있던 루프를 여기서 끊는다
            this.stopDragScroll(d)
            return
        }
        if (d.scroll) {
            return
        }
        const s = { raf: 0, prev: performance.now(), axis }
        d.scroll = s
        d.scrolled.axis = axis
        s.raf = requestAnimationFrame(now => this.dragScrollTick(now))
    }

    /**
     * 자동 스크롤 한 프레임 — 목록을 조금 흘리고 **놓일 자리를 다시 잰다**.
     *
     * `render()` 를 부르지 않는다(부르면 끌고 있던 줄의 DOM 이 사라진다 — `render` 의 드래그
     * 가드). 여기서 만지는 것은 목록의 `scrollTop`/`scrollLeft` 와 삽입선뿐이다.
     * `scrollNavIntoView` 도 부르지 않는다 — 그건 키 이동의 몫이고, 여기서 부르면 방금
     * 흘린 화면을 포커스 줄 기준으로 되돌린다.
     */
    private dragScrollTick (now: number): void {
        const d = this.drag
        const el = this.listEl
        // 드래그가 끝났거나 다른 드래그로 바뀌었으면 루프도 여기서 끝난다 (누수 이중 안전망)
        if (!d || !d.scroll || !d.moved || !el) {
            return
        }
        const s = d.scroll
        const speed = this.dragScrollSpeed(s.axis)
        if (!speed) {
            this.stopDragScroll(d)
            return
        }
        const dt = Math.min(DRAG_SCROLL_MAX_DT_MS, Math.max(0, now - s.prev))
        s.prev = now
        const step = speed * dt / 1000
        const before = s.axis === 'y' ? el.scrollTop : el.scrollLeft
        if (s.axis === 'y') {
            el.scrollTop = before + step
        } else {
            el.scrollLeft = before + step
        }
        // **실제로 움직인 만큼**만 센다 — 끝에 닿으면 브라우저가 값을 깎으므로 요청값과 다르다
        d.scrolled.px += Math.abs((s.axis === 'y' ? el.scrollTop : el.scrollLeft) - before)
        // 줄이 커서 아래를 지나갔다 — 같은 좌표로 다시 판정해야 삽입선이 옛 자리에 남지 않는다
        this.refreshDropTarget()
        s.raf = requestAnimationFrame(t => this.dragScrollTick(t))
    }

    /** 자동 스크롤 루프를 끊는다 — 취소 없이 두면 드래그가 끝나도 프레임마다 계속 돈다 */
    private stopDragScroll (d: { scroll: { raf: number } | null }): void {
        if (!d.scroll) {
            return
        }
        cancelAnimationFrame(d.scroll.raf)
        d.scroll = null
    }

    /**
     * 이 좌표에 놓으면 어디로 가나 — 놓을 자리가 없으면 null(= 놓아도 아무 일 없음).
     *
     * **후보 집합을 `renderPlan()` 에서 받는다.** 화면 순서를 정하는 계산이 한 곳뿐이어야
     * 진단구(`__agentdeck.groups()`)와 화면이 어긋나지 않는다 — 이 파일에서 순서 규칙의
     * 사본을 만들지 않는 것이 그 함수를 뽑은 이유다.
     *
     * 후보는 **끌고 있는 탭이 속한 `plan` 그룹의 탭들**이다. 두 화면이 한 규칙으로 덮인다 —
     *  - 헤더가 없는 화면: `plan` 이 평면 한 덩이라(renderPlan) 후보 = 보이는 줄 전부.
     *  - 헤더가 있는 화면: 후보 = **같은 그룹 안**. 그룹 키는 작업 폴더(cwd)라 순서를 바꿔도
     *    그룹이 바뀌지 않으므로, 다른 그룹의 줄에 놓아 주면 그 줄은 사용자가 놓은 자리가 아니라
     *    자기 그룹 안으로 되돌아가 앉는다. "놓은 곳에 안 간다" 가 가장 나쁜 결과라, 다른 그룹
     *    위에서는 삽입선을 아예 그리지 않고 놓아도 취소로 끝낸다(무시).
     *
     * 필터가 걸려 줄이 숨은 화면에서는 숨은 탭이 사이에 남는다 — 그래도 **보이는 줄들의
     * 상대 순서**는 사용자가 놓은 그대로가 된다. 눈에 보이지 않는 탭의 자리를 짐작해 옮기는
     * 것보다 이쪽이 예측 가능하다.
     */
    private dropTargetAt (x: number, y: number): { tab: BaseTabComponent, place: DropPlace } | null {
        const reject = (why: DropReject) => {
            this.dropReject = why
            return null
        }
        const d = this.drag
        if (!d || !this.listEl) {
            return reject('gone')
        }
        const list = this.listEl.getBoundingClientRect()
        // 취소 경로 둘 — 목록 밖에 놓기
        if (x < list.left || x > list.right || y < list.top || y > list.bottom) {
            return reject('outside-list')
        }
        const { withHeads, plan } = this.renderPlan()
        const group = plan.find(g => g.tabs.includes(d.tab))
        if (!group || !this.app.tabs.includes(d.tab)) {
            // 끌던 탭이 화면에서 빠졌거나(필터) 닫혔다 — 놓을 자리를 정할 근거가 없다
            return reject('gone')
        }
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        const rowEl = el?.closest('.ad-tab') as HTMLElement | null
        if (!rowEl) {
            // 줄이 아닌 빈 자리. 헤더가 없는 화면에서만 "맨 끝" 으로 본다 —
            // 헤더가 있으면 그 빈 자리가 어느 그룹의 끝인지 화면상 정해지지 않는다
            if (withHeads || el?.closest('.ad-list') !== this.listEl) {
                return reject('no-row')
            }
            const last = group.tabs[group.tabs.length - 1]
            if (!last || last === d.tab) {
                return reject('self')
            }
            this.dropReject = null
            return { tab: last, place: 'after' }
        }
        // 대상 탭은 줄에 남아 있는 `data-ad-index`(= `app.tabs` 인덱스) 로 되찾는다.
        // 그 값의 뜻을 바꾸지 않는 이유는 `renderTab` 주석에 있다 (회귀가 그것으로 줄을 찾는다).
        const tab = this.app.tabs[Number(rowEl.dataset.adIndex)]
        if (!tab) {
            return reject('gone')
        }
        if (tab === d.tab) {
            return reject('self')
        }
        if (!group.tabs.includes(tab)) {
            return reject('other-group')
        }
        // **낡은 식별자를 걸러낸다.** 드래그 중에는 화면을 다시 그리지 않으므로(`render` 가드),
        // 그 사이 탭이 하나 닫히면 뒤쪽 줄들의 `data-ad-index` 가 한 칸씩 밀려 **다른 탭을**
        // 가리킨다 — 그대로 쓰면 사용자가 짚지 않은 탭을 옮긴다. 지금 인덱스로 되찾은 줄이
        // 방금 짚은 줄과 같은지 확인해 어긋나면 놓을 자리로 보지 않는다 (다음 렌더에 회복된다).
        if (this.rowElOf(tab) !== rowEl) {
            return reject('stale-index')
        }
        const r = rowEl.getBoundingClientRect()
        // 상/하 도킹은 목록이 가로로 흐른다(styles.scss `.ad-dock-top .ad-list`) — 축이 바뀐다
        const past = this.listFlowsSideways()
            ? x > (r.left + r.right) / 2
            : y > (r.top + r.bottom) / 2
        this.dropReject = null
        return { tab, place: past ? 'after' : 'before' }
    }

    /** 목록이 가로로 흐르나 (상/하 도킹) — 삽입선의 방향과 중점 판정 축이 여기서 갈린다 */
    private listFlowsSideways (): boolean {
        return !isHorizontalDock(this.dockSide)
    }

    /**
     * 놓일 자리를 삽입선으로 보여준다 (요구: 어디에 떨어질지 모르는 드래그는 쓸 수 없다).
     *
     * **`.ad-list` 안에 넣지 않는다.** 목록의 자식으로 두면 (1) `render()` 가 innerHTML 을
     * 비울 때 같이 날아가고, (2) 회귀 프로브가 목록의 자식을 순서대로 훑어 그룹 구성을 읽는데
     * (probe-group `sections`) 그 사이에 낯선 노드가 끼어든다. dock.ts 의 드롭 가이드와 같이
     * body 에 붙이고 `position: fixed` 로 화면 좌표에 그린다 — 사이드바의 `overflow: hidden`
     * 에도 잘리지 않는다.
     */
    private drawReorderLine (): void {
        const d = this.drag
        if (!d || !this.listEl) {
            return
        }
        if (!d.target) {
            // 놓을 자리가 없으면 선을 지운다 — 선이 남아 있으면 "놓으면 저기로 간다" 는 거짓말이 된다
            d.line?.remove()
            d.line = null
            return
        }
        const rowEl = this.rowElOf(d.target.tab)
        if (!rowEl) {
            return
        }
        if (!d.line) {
            const line = document.createElement('div')
            line.className = 'ad-reorder-line'
            document.body.appendChild(line)
            d.line = line
        }
        const r = rowEl.getBoundingClientRect()
        const list = this.listEl.getBoundingClientRect()
        const s = d.line.style
        const half = REORDER_LINE_PX / 2
        // **가로지르는 축도 가둔다.** 자동 스크롤이 들어온 뒤로는 목록 경계에 반쯤 걸린 줄을
        // 가리키는 일이 흔해졌는데(가장자리에 커서를 대고 있으면 그 자리의 줄이 늘 반쯤 잘려
        // 있다), 줄의 rect 를 그대로 쓰면 선이 사이드바 밖 터미널 위까지 뻗는다 —
        // 삽입선은 `position: fixed` 라 목록의 `overflow` 가 잘라 주지 않는다.
        const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
        if (this.listFlowsSideways()) {
            const x = d.target.place === 'after' ? r.right : r.left
            // 목록 밖으로 삐져나가지 않게 가둔다 — 맨 끝 줄의 뒤를 가리킬 때 특히
            s.left = Math.round(clampTo(x, list.left, list.right) - half) + 'px'
            const top = clampTo(r.top, list.top, list.bottom)
            const bottom = clampTo(r.bottom, list.top, list.bottom)
            s.top = Math.round(top) + 'px'
            s.width = REORDER_LINE_PX + 'px'
            // 줄이 통째로 밖에 있으면 0 이 되는데, 그러면 "어디에 놓이나" 가 화면에서 사라진다.
            // 그 좌표는 `dropTargetAt` 이 이미 후보로 인정한 자리라 1px 이라도 그려야 한다
            s.height = Math.max(1, Math.round(bottom - top)) + 'px'
        } else {
            const y = d.target.place === 'after' ? r.bottom : r.top
            const left = clampTo(r.left, list.left, list.right)
            const right = clampTo(r.right, list.left, list.right)
            s.left = Math.round(left) + 'px'
            s.top = Math.round(clampTo(y, list.top, list.bottom) - half) + 'px'
            s.width = Math.max(1, Math.round(right - left)) + 'px'
            s.height = REORDER_LINE_PX + 'px'
        }
    }

    /** 그 탭의 줄 엘리먼트 — 줄은 `data-ad-index`(= `app.tabs` 인덱스) 로만 찾는다 */
    private rowElOf (tab: BaseTabComponent): HTMLElement | null {
        const i = this.app.tabs.indexOf(tab)
        if (i < 0 || !this.listEl) {
            return null
        }
        return this.listEl.querySelector(`.ad-tab[data-ad-index="${i}"]`) as HTMLElement | null
    }

    /**
     * 드래그 종료 — `commit` 이 false 면 취소(원래 순서 그대로).
     *
     * 취소로 들어오는 길은 셋이다: Esc, `pointercancel`, 그리고 놓을 자리가 없는 곳에서
     * 손을 뗀 것(목록 밖 · 다른 그룹 위). 셋 다 `app.tabs` 를 건드리지 않고 화면만 되돌린다.
     */
    private endRowDrag (commit: boolean, ev?: PointerEvent, why?: DragEndReason): void {
        const d = this.drag
        if (!d) {
            return
        }
        this.dropReject = null
        if (commit && d.moved && ev) {
            // 놓은 좌표로 한 번 더 판정한다 — 마지막 pointermove 와 pointerup 사이에도 커서는 움직인다
            d.target = this.dropTargetAt(ev.clientX, ev.clientY)
        }
        const moved = d.moved
        const target = commit && moved ? d.target : null
        this.drag = null
        // 자동 스크롤을 **가장 먼저** 끊는다. 손을 떼거나 취소된 뒤에도 목록이 흐르면
        // 사용자가 방금 놓은 자리가 화면에서 미끄러진다 (`this.drag` 를 이미 비웠으므로
        // tick 은 다음 프레임에 스스로 멈추지만, 그 한 프레임도 그리지 않는다)
        this.stopDragScroll(d)
        d.detach()
        d.line?.remove()
        d.row.classList.remove('ad-dragging')
        document.body.classList.remove('ad-reordering')
        // 사유는 **부르는 쪽이 아는 것**(Esc·pointercancel·게이트)을 우선하고, 나머지는 결과로 정한다
        const note = (reason: DragEndReason) => {
            this.lastDragEnd = {
                reason,
                drop: this.dropReject,
                committed: reason === 'moved',
                at: Date.now(),
                scrolled: { px: Math.round(d.scrolled.px), axis: d.scrolled.axis },
            }
        }
        if (!moved) {
            // 임계치를 못 넘긴 것 = 그냥 클릭이었다. 선택 동작을 방해하지 않는다
            note(why ?? 'below-threshold')
            return
        }
        this.dragClickGuard = true
        note(why ?? (target ? 'moved' : 'no-target'))
        if (target) {
            this.applyReorder(d.tab, target.tab, target.place)
        }
        // 드래그 중 멈춰 뒀던 화면을 반드시 여기서 한 번 되살린다 (`render` 의 드래그 가드)
        this.render()
    }

    /**
     * `app.tabs` 를 실제로 재배열한다 — **순정과 같은 방법**이다.
     *
     * 근거: Tabby 의 탭바도 드롭을 받으면 그 배열을 제자리에서 흔들고 변경을 알린다 —
     * `moveItemInArray(this.app.tabs, event.previousIndex, event.currentIndex); this.app.emitTabsChanged()`
     * (`node_modules/tabby-core/dist/index.js` 의 `onTabsReordered`). 탭바 템플릿도
     * `*ngFor="let tab of app.tabs; let idx = index"` 로 그 배열을 그대로 읽고 trackBy 가 없어서,
     * 제자리 재배열 + 변경 감지가 곧 순정 탭바의 순서 변경이다.
     *
     * `AppService` 의 순서 API 는 이 조작에 못 쓴다 — `swapTabs(a, b)` 는 두 탭을 맞바꾸기만 해서
     * "사이에 끼워넣기" 를 표현할 수 없고(중간 탭들이 밀리지 않는다), `moveSelectedTabLeft/Right`
     * 는 활성 탭만 한 칸씩 옮긴다. 그래서 순정 탭바가 자기 드롭에 쓰는 경로를 그대로 쓴다.
     *
     * 배열 객체를 새것으로 갈아 끼우지 않는 이유도 같다 — 이미 `app.tabs` 를 들고 있는 곳이
     * 있어도 같은 배열을 보게 해야 한다(순정도 제자리에서 흔든다).
     * 포인터 이벤트는 Angular 밖이라 `zone.run` 안에서 바꿔 변경 감지를 태운다.
     */
    private applyReorder (tab: BaseTabComponent, to: BaseTabComponent, place: DropPlace): boolean {
        return false
        /* Legacy reorder retained for migration reference; fixed slots never reorder.
        const tabs = this.app.tabs
        const from = tabs.indexOf(tab)
        const at = tabs.indexOf(to)
        const order = planTabMove(tabs.length, from, at, place)
        if (!order) {
            // 제자리 드롭이거나 이미 닫힌 탭 — 순정 탭바를 다시 그릴 이유가 없다
            return false
        }
        const next = order.map(i => tabs[i])
        this.zone.run(() => {
            for (let i = 0; i < next.length; i++) {
                tabs[i] = next[i]
            }
            this.app.emitTabsChanged()
        })
        this.diag(`reorder ${from} -> ${at} ${place} order=${order.join(',')}`)
        return true
        */
    }

    /**
     * "지금은 순서를 바꿀 수 없다" 를 그 자리에서 한 줄로 알린다.
     *
     * `sortByStatus` 가 켜져 있으면 화면 순서를 상태가 정한다(`renderPlan`) — 옮겨 놓아도
     * 다음 렌더에 제자리로 돌아가므로 드래그가 무의미하다. 그래서 **막는다.**
     * 드래그를 계기로 그 설정을 대신 꺼 주지는 않는다: 사용자가 저장해 둔 설정을 곁동작으로
     * 뒤집는 것은 예측할 수 없고(다음 기동까지 남는다), 무엇이 바뀌었는지 화면에 단서도 없다.
     * 대신 막은 이유와 푸는 방법을 적어 보여준다.
     */
    private noteReorderBlocked (): void {
        if (!this.sidebar) {
            return
        }
        this.sidebar.querySelector('.ad-reorder-note')?.remove()
        const el = document.createElement('div')
        el.className = 'ad-reorder-note'
        // 고정 문구여도 textContent 로 넣는다 (이 파일의 규약 — innerHTML 에 본문 금지)
        el.textContent = this.ui('상태순 정렬이 켜져 있어 순서를 바꿀 수 없다 — 설정에서 끄면 끌어서 옮길 수 있다')
        this.sidebar.appendChild(el)
        setTimeout(() => el.remove(), REORDER_NOTE_MS)
    }

    /** 더블클릭 -> 작업 이름 인라인 편집 */
    private startLabelEdit (row: HTMLElement, tab: BaseTabComponent): void {
        this.editing = tab
        const holder = row.querySelector('.ad-label') as HTMLElement
        const input = document.createElement('input')
        input.className = 'ad-label-input'
        input.value = this.status.get(tab).label
        input.placeholder = this.ui('작업 이름')
        holder.replaceWith(input)
        input.focus()
        input.select()

        const finish = (commit: boolean) => {
            if (this.editing !== tab) {
                return
            }
            this.editing = null
            if (commit) {
                this.status.setLabel(tab, input.value.trim())
            }
            this.render()
        }
        // 터미널로 키가 새지 않도록 이벤트를 여기서 끊는다
        input.addEventListener('keydown', ev => {
            ev.stopPropagation()
            if (ev.key === 'Enter') {
                finish(true)
            }
            if (ev.key === 'Escape') {
                finish(false)
            }
        })
        input.addEventListener('blur', () => finish(true))
    }

    /**
     * 지난 세션 한 줄을 누른 결과 — **이미 열려 있으면 이어받지 않고 그 탭으로 보낸다.**
     *
     * 같은 세션을 두 탭에서 `--resume` 하면 두 프로세스가 같은 기록 파일에 덧쓴다.
     * 세션↔탭 매핑은 `notify` 가 이미 들고 있어 판정에 드는 비용이 없으니 막는다.
     */
    private async activateResume (row: ResumeRow, fork: boolean): Promise<void> {
        if (row.openTabId) {
            const tab = this.resumeTabs.get(row.openTabId)
            if (tab && this.app.tabs.includes(tab)) {
                this.app.selectTab(tab)
                return
            }
            // 그 사이 닫혔다 — 이어받기로 흘려보낸다
        }
        const command = resumeCommand(row.sessionId, fork, row.agent)
        if (!command) {
            this.diag(`resume 거부 sid=${row.sessionId}`)
            return
        }
        await this.openResumeTab(row, command)
    }

    /**
     * 이어받기용 새 탭.
     *
     * **프로필의 `command` 를 갈아끼우지 않고, 평소 프로필로 셸을 띄운 뒤 명령을 써 넣는다.**
     * 이유는 `sessionLedger.ts` 의 `resumeCommand` 주석에 있다 — 기존 `agentdeck:root` 프로필의
     * 인자(`-ExecutionPolicy Bypass`)가 npm 전역 `.ps1` 래퍼 문제를 이미 풀어 두었고,
     * claude 가 끝나도 셸이 남아 사람이 이어서 쓸 수 있다.
     *
     * **cwd 는 그 세션의 것으로 덮는다.** `--resume` 은 cwd 로 세션을 묶기 때문에(같은 세션도
     * 다른 폴더에서 띄우면 목록에 없다) 여기를 틀리면 이어받기 자체가 실패한다.
     */
    private async openResumeTab (row: ResumeRow, command: string, account?: SavedAccount): Promise<void> {
        this.syncSessionSlots()
        if (this.sessionSlots.occupied + this.pendingSessionOpens >= JUMP_SLOTS) { return }
        this.pendingSessionOpens++
        try {
            const wanted = this.config.store.terminal.profile
            const all = await this.profiles.getProfiles()
            const base = all.find(p => p.id === wanted) ?? all[0]
            if (!base) {
                this.diag('resume 프로필 없음')
                return
            }
            // 원본 프로필을 건드리지 않는다 — 설정에 저장되는 객체라 cwd 를 박으면 그 뒤
            // 새 탭이 전부 그 폴더에서 열린다
            const profile: any = {
                ...base,
                options: { ...(base as any).options, cwd: row.cwd || (base as any).options?.cwd,
                    env: storageEnvironment((base as any).options?.env) },
            }
            if (account) {
                profile.options.env = { ...(base as any).options?.env,
                    [account.provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: accountHome(account) }
                for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']) {
                    profile.options.env[key] = ''
                }
            }
            const tab = await this.profiles.openNewTabForProfile(profile)
            this.diag(`resume 탭 sid=${row.sessionId.slice(0, 8)} cwd=${profile.options?.cwd ?? '?'} tab=${tab ? 'yes' : 'null'}`)
            if (!tab) {
                if (account) { throw new Error(this.ui('새 계정 탭을 열지 못했습니다.')) }
                return
            }
            if (account) { this.notify.setAccountHome(tab, account.provider, accountHome(account), account.id) }
            // 라벨을 미리 물려준다 — 셸이 뜨고 claude 가 붙기까지 몇 초 동안 줄이 `—` 로 비어
            // 있으면 방금 무엇을 눌렀는지 사라진다. 사람이 Enter 를 치면 그때 덮인다
            if (row.label) {
                this.status.setLabel(tab, row.label)
            }
            this.sendResumeCommand(tab, command)
        } catch (e: any) {
            if (account) { throw new Error(this.ui('새 계정 탭을 열지 못했습니다.')) }
            diagCatch('resume 탭 열기', e)
        } finally { this.pendingSessionOpens-- }
    }

    /**
     * 갓 뜬 셸에 명령을 써 넣는다.
     *
     * **바로 쏘면 삼켜진다** — pty 는 열렸는데 셸이 아직 프롬프트를 안 그린 상태에서 쓴 바이트는
     * 어디에도 안 남는다(같은 이유로 `sendInput` 을 쓰는 다른 경로들도 프론트엔드 준비를 기다린다).
     * 그래서 출력이 한 번이라도 흐른 뒤에 보내고, 끝내 안 오면 정해진 시각에 한 번은 보낸다 —
     * 아무것도 안 보내고 조용히 끝나는 것이 제일 나쁜 결과다.
     */
    private sendResumeCommand (tab: BaseTabComponent, command: string, expectedSession?: any): void {
        /** 첫 출력(=셸이 프롬프트를 그렸다)을 보고 나서 더 기다리는 시간 */
        const RESUME_SETTLE_MS = 700
        /** 출력이 끝내 안 와도 여기서는 한 번 쏜다 — 아무것도 안 보내고 조용히 끝나는 게 제일 나쁘다 */
        const RESUME_GIVEUP_MS = 6000
        /** 세션이 붙기를 기다리는 간격 */
        const RESUME_POLL_MS = 200

        let sent = false
        let sub: any = null
        const fire = () => {
            if (sent) {
                return
            }
            const anyPane = this.firstPane(tab) as any
            if (expectedSession && (!this.app.tabs.includes(tab) || anyPane?.session !== expectedSession)) {
                sent = true
                sub?.unsubscribe?.()
                return
            }
            if (!anyPane || typeof anyPane.sendInput !== 'function') {
                return
            }
            sent = true
            sub?.unsubscribe?.()
            this.sendToPane(anyPane, 'resume', () => anyPane.sendInput(command + '\r'))
            this.diag('resume 명령 전송')
        }

        /**
         * **세션은 탭이 만들어진 직후엔 아직 없다** (2026-09-11 실측: `openNewTabForProfile` 이
         * 돌아온 시점에 `pane.session` 이 `undefined`). 그때 한 번만 보고 포기하면 구독이 영영
         * 안 걸려 매번 6초를 꽉 채우고서야 명령이 나간다. 그래서 붙을 때까지 짧게 되물어본다.
         */
        const t0 = Date.now()
        const arm = () => {
            if (sent || sub) {
                return
            }
            let pane: any = null
            try {
                pane = this.firstPane(tab)
                sub = pane?.session?.output$?.subscribe?.(() => setTimeout(fire, RESUME_SETTLE_MS))
            } catch (e: any) {
                diagCatch('resume 출력 구독', e)
                return
            }
            if (sub) {
                this.diag(`resume 구독 armed after=${Date.now() - t0}ms`)
                return
            }
            if (Date.now() - t0 < RESUME_GIVEUP_MS) {
                setTimeout(arm, RESUME_POLL_MS)
            }
        }
        arm()
        setTimeout(fire, RESUME_GIVEUP_MS)
    }

    /** 지난 세션 줄 우클릭 */
    private showResumeMenu (row: ResumeRow, ev: MouseEvent): void {
        const old = document.querySelector('.ad-menu')
        if (old) {
            old.remove()
        }
        const menu = document.createElement('div')
        menu.className = 'ad-menu'

        const items: Array<[string, () => void]> = []
        if (row.openTabId) {
            items.push([this.ui('이 탭으로 이동'), () => { void this.activateResume(row, false) }])
        } else {
            items.push([this.ui('새 탭에서 이어받기'), () => { void this.activateResume(row, false) }])
            // 분기는 기록을 복제한다 — 기본 동작으로 두면 목록이 비슷한 이름으로 불어난다
            items.push([this.ui('분기해서 이어받기'), () => { void this.activateResume(row, true) }])
        }
        items.push([this.ui('세션 ID 복사'), () => {
            try {
                this.platform.setClipboard?.({ text: row.sessionId })
            } catch (e: any) {
                diagCatch(this.ui('세션 ID 복사'), e)
            }
        }])
        items.push([this.ui('목록에서 숨기기'), () => this.hideResumeRow(row.sessionId)])

        for (const [label, action] of items) {
            const item = document.createElement('div')
            item.className = 'ad-menu-item'
            item.textContent = label
            item.addEventListener('click', () => {
                action()
                menu.remove()
            })
            menu.appendChild(item)
        }

        document.body.appendChild(menu)
        menu.style.left = ev.clientX + 'px'
        menu.style.top = Math.min(ev.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px'

        const close = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove()
                document.removeEventListener('mousedown', close)
            }
        }
        setTimeout(() => document.addEventListener('mousedown', close), 0)
    }

    /** 목록에서만 감춘다 — 기록 파일은 건드리지 않는다(그건 사람이 지울 일이다) */
    private hideResumeRow (sessionId: string): void {
        const cfg = this.config.store.agentDeck
        const stored: string[] = Array.isArray(cfg.resumeHidden)
            ? cfg.resumeHidden.filter((k: unknown): k is string => typeof k === 'string')
            : []
        if (!stored.includes(sessionId)) {
            cfg.resumeHidden = [...stored, sessionId]
            this.config.save()
        }
        this.render()
    }

    /** 우클릭 -> 상태 직접 지정 */
    private showStatusMenu (ev: MouseEvent, tab: BaseTabComponent): void {
        const old = document.querySelector('.ad-menu')
        if (old) {
            old.remove()
        }
        const menu = document.createElement('div')
        menu.className = 'ad-menu'

        const statuses: WorkStatus[] = ['running', 'waiting', 'limited', 'done', 'error', 'idle']
        const items: Array<[string, () => void]> = statuses.map(s => {
            const label = STATUS_STYLES[s].icon + ' ' + this.ui(STATUS_STYLES[s].label)
            const action = () => this.status.setManual(tab, s)
            return [label, action] as [string, () => void]
        })
        items.push([this.ui('↺ 자동 감지로'), () => this.status.unpin(tab)])
        for (const targetSessionId of this.notify.sessionIdsOf(tab)) {
            items.push([(this.sidebarLang === 'ko' ? '통신 대상 복사: ' : 'Copy message target: ') + targetSessionId, () => {
                getClipboard()?.writeText('AgentDeck target session ID: ' + targetSessionId
                    + '\nUse this exact toSessionId with agentdeck_send; do not resolve a human slot again.')
            }])
        }
        // 이 탭만 다시 그리기 — 사이드바 아래 ↻ 는 모든 탭이 대상이라 무거울 때가 있다
        items.push([this.ui('↻ 화면 복구'), () => {
            this.app.selectTab(tab)
            this.repair('active')
        }])

        for (const [label, action] of items) {
            const item = document.createElement('div')
            item.className = 'ad-menu-item'
            item.textContent = label
            item.addEventListener('click', () => {
                action()
                menu.remove()
            })
            menu.appendChild(item)
        }

        document.body.appendChild(menu)
        menu.style.left = ev.clientX + 'px'
        menu.style.top = Math.min(ev.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px'

        const close = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove()
                document.removeEventListener('mousedown', close)
            }
        }
        setTimeout(() => document.addEventListener('mousedown', close), 0)
    }

    private formatElapsed (ms: number): string {
        const s = Math.floor(ms / 1000)
        if (s < 60) {
            return this.ui('{n}초', { n: s })
        }
        const m = Math.floor(s / 60)
        if (m < 60) {
            return this.ui('{n}분', { n: m })
        }
        return this.ui('{h}시간 {m}분', { h: Math.floor(m / 60), m: m % 60 })
    }
}
