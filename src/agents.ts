/**
 * 에이전트 프로필 — "클로드든 코덱스든 제미나이든 같은 포맷으로 쓴다" 를 위한 단일 출처.
 *
 * 상태 감지(detect.ts)·이미지 붙여넣기 키(deck.service.ts)·입력창 머리글자(prompt.ts)가
 * 원래 각자 Claude Code 를 전제로 하드코딩돼 있었다. 새 CLI 를 하나 지원하려면 세 파일을
 * 따로 고쳐야 했고, 어떤 값이 실측이고 어떤 값이 짐작인지도 코드에서 구분되지 않았다.
 * 그래서 "무엇을 어떻게 알아보나" 를 프로필 한 덩이로 모았다 — 새 CLI 는 아래 배열에
 * 항목 하나를 더하는 것으로 끝난다.
 *
 * **이 파일은 순수하다** — DOM·fs·tabby 를 건드리지 않는다. 그래야 노드에서 바로 테스트된다.
 *
 * 값의 출처 표기 규칙: 실측된 값에는 근거(날짜·파일)를 적고, 관측이 없는 값에는
 * `근거 미확인` 을 적는다. 짐작을 실측처럼 적어두면 다음 사람이 그것을 근거로 또 짐작한다.
 */

export type AgentId = 'claude' | 'codex' | 'gemini' | 'unknown'

/**
 * 이미지 전용 클립보드일 때 흘려보낼 키.
 *
 * `config` 는 "이 에이전트가 무엇을 받는지 관측된 바가 없다" 는 뜻이다 — 그때는
 * 예전처럼 사용자 설정(`agentDeck.imagePasteKey`)을 쓴다. 관측 없는 키를 단정해 보내면
 * 아무 일도 안 일어나거나(Claude 에 0x16) 엉뚱한 문자가 입력창에 박힌다.
 */
export type ImagePasteKey = 'alt-v' | 'ctrl-v' | 'config'

export interface AgentProfile {
    id: AgentId
    /** 사람에게 보여줄 이름 (사이드바·진단에 쓴다) */
    label: string
    /**
     * 사이드바 줄 머리에 붙일 표식 (인라인 SVG 원문).
     *
     * **문자 글리프가 아니라 SVG 인 이유** — 에이전트들이 스스로 쓰는 글리프는
     * Claude `✳`·Gemini `✦` 처럼 둘 다 별 모양이라 12px 에서 형태로 갈리지 않는다
     * (색만 다르면 색각 이상에서 구분이 사라진다). 형태(육각·별·6방 별표)와 색을
     * 둘 다 다르게 주려면 도형을 직접 그려야 한다.
     *
     * 이 필드는 **상수 문자열이다** — 사용자 입력이 절대 섞이지 않으므로 읽는 쪽이
     * `innerHTML` 로 넣어도 안전하다(`deck.service.ts` `renderTab`). 그래서 여기에는
     * 상수만 넣고, 어떤 경우에도 런타임 값을 끼워 만들지 않는다.
     *
     * 빈 문자열이면 표식을 그리지 않는다(= 에이전트를 못 알아본 보통 셸 탭).
     */
    icon: string
    /** 프로세스 이름/명령줄에서 이 에이전트를 알아보는 조각 (소문자 비교) */
    processHints: string[]
    /** 탭 제목에서 알아보는 조각 (소문자 비교) */
    titleHints: string[]
    /** "사람 입력을 기다린다" 로 볼 화면 문구 */
    waitingPatterns: RegExp[]
    /** "지금 일하는 중" 으로 볼 화면 문구 */
    busyPatterns: RegExp[]
    /**
     * "사용량 한도에 걸려 턴이 끊겼다" 로 볼 화면 문구.
     *
     * 왜 대기·작업중과 따로 두나 — 한도는 둘 중 어느 것도 아니다. 사람이 승인할 것이 없고
     * 리셋 시각까지 기다려야 하는 상태라 배지·정렬·알림이 모두 다르게 취급한다
     * (`api.ts` `limited`, `order.ts`, `alert.service.ts`).
     *
     * 왜 필요했나 — 0.9.0 까지 `limited` 는 훅(`claudeHooks.ts` 의 `StopFailure`
     * `error=rate_limit`)으로만 왔고 **화면 문구 경로가 아예 없었다.** 그래서 훅이 없는
     * CLI(codex·gemini)는 한도에 걸려도 배지가 `running`/`error` 로 남았다.
     *
     * **`patternsProven` 규칙과의 관계** — 이것도 화면 문구이므로 위 세 필드와 똑같이 다룬다.
     * 실측이 없으면 `[]` 로 비우고, 실측이 없는 프로필의 판정에는 합집합 것이 쓰인다
     * (`detectProfileFor`). 합집합은 모든 프로필의 값을 모으므로(`buildUnion`), 한 프로필에서
     * 실측된 한도 문구는 `patternsProven: false` 인 프로필에서도 그대로 쓰인다 —
     * codex 가 정확히 그 경우다(한도 문구만 실측, 대기·작업중은 미관측).
     */
    limitedPatterns: RegExp[]
    /** 콘솔 제목에 넣는 작업중 표식(스피너 등) */
    busyTitleMarks: string[]
    /** 이미지 전용 클립보드일 때 흘려보낼 키 */
    imagePasteKey: ImagePasteKey
    /** 입력창 머리글자 후보 — 라벨을 읽는 쪽(prompt.ts)이 쓸 값. 여기서는 데이터만 들고 있는다 */
    promptHeads: string[]
    /**
     * 입력창에서 프롬프트를 뽑을 때 쓸 화면 모양 (`prompt.ts` 의 `PromptShape` 와 구조가 같다).
     *
     * **타입을 `prompt.ts` 에서 import 하지 않는다** — 그쪽은 순수 모듈이고 여기서 역참조하면
     * 의존이 한 바퀴 돈다. 구조만 맞으면 TS 가 받아준다.
     *
     * 생략하면 `prompt.ts` 의 기본값이 쓰인다. **claude 는 일부러 생략한다** — 그 기본값 자체가
     * Claude Code 2.1.x 실측으로 만들어진 값이라(`prompt.ts` `DEFAULT_PROMPT_SHAPE` 주석),
     * 여기서 좁혀 적으면 같은 값을 두 곳에 두게 되고 한쪽만 고쳐질 위험만 생긴다.
     */
    promptShape?: { heads?: string[], choiceWords?: string[], ruleChars?: string[] }
    /** 화면 깨짐 판정에 쓸 모양 (`screen.ts` 의 `ScreenShape` 와 구조가 같다). 위와 같은 이유로 claude 는 생략 */
    screenShape?: { ruleChars?: string[], heads?: string[], choiceWords?: string[] }
    /**
     * 화면 문구(`waitingPatterns` · `busyPatterns` · `limitedPatterns` · `busyTitleMarks`)가
     * **실측된** 프로필인가.
     *
     * false 면 상태 판정에는 이 프로필 대신 합집합의 문구를 쓴다(`detectProfileFor`).
     * 왜 이 갈래가 필요한가 — 프로필을 붙이는 순간 판정이 그 프로필 안으로 좁아지는데,
     * 관측이 없는 에이전트에서 그건 **개선이 아니라 퇴행**이다. 예를 들어 Codex 가 실제로
     * `esc to interrupt` 를 쓰거나 제목에 스피너를 넣는다면, 0.5.0 은 (합집합 하나로 모든 탭을
     * 판정했으므로) 그걸 잡았는데 프로필을 붙인 0.6.0 은 놓친다.
     * 그래서 **실측이 있는 값만 좁게 쓴다** — 실측되면 이 값을 true 로 올리면 된다.
     *
     * `imagePasteKey` 처럼 이미 실측된 필드는 이 값과 무관하게 프로필 것을 쓴다.
     */
    patternsProven: boolean
}

// ---------- 여러 에이전트가 함께 쓰는 조각 ----------
//
// 같은 정규식 객체를 공유한다. 합집합(unionProfile)이 이걸 중복 없이 합칠 수 있어야
// "프로필 없이 부르면 0.5.0 과 같은 동작" 이 유지되기 때문이다.

/** 터미널 앱을 가리지 않는 예/아니오 확인 — 셸 스크립트·CLI 가 다 쓴다 */
const CONFIRM_YN = /\(y\/n\)/i
const CONFIRM_YN_CAP = /\[y\/N\]/i
const PRESS_ENTER = /Press Enter to continue/i
/** 작업을 붙잡고 있는 동안에만 뜨는 취소 안내 — Claude 외의 TUI 도 흔히 쓴다 */
const CTRL_C_INTERRUPT = /ctrl\+c to (?:interrupt|cancel|stop)/i

/**
 * 입력창 머리글자 — `prompt.ts` 의 `PROMPT_HEAD_RE`(정규식 `^[>❯›❭➜]\s*`) 와 같은 목록이다.
 *
 * 이 목록은 지금까지 에이전트를 가리지 않고 쓰였고 그대로 동작해 왔다. 그래서 codex/gemini
 * 프로필에도 같은 목록을 준다 — 그 두 앱의 화면을 따로 실측한 것은 아니지만(근거 미확인),
 * "지금 동작" 을 그대로 옮기는 쪽이 빈 목록을 주어 라벨 읽기를 죽이는 것보다 낫다.
 */
const GENERIC_PROMPT_HEADS = ['>', '❯', '›', '❭', '➜']

// ---------- 사이드바 표식 (인라인 SVG) ----------
//
// 세 가지를 지킨다 —
//  ① **형태가 서로 다르다**: 6방 별표(claude) / 육각 테두리(codex) / 4각 별(gemini).
//     색만 다르면 색각 이상에서 구분이 사라지고, 12px 로 줄면 비슷한 별끼리 뭉갠다.
//  ② **그 브랜드가 실제로 쓰는 색**: Anthropic 주황 · OpenAI 초록 · Google 파랑.
//  ③ **viewBox 16 고정**: 읽는 쪽이 width/height 로만 크기를 정한다.
//
// codex 의 육각은 OpenAI 매듭 로고의 **실루엣 근사**다 — 원본 path 를 정확히 옮긴 것이
// 아니므로(근거 미확인) 로고라고 부르지 않는다. 나머지 둘은 그 브랜드 마크의 모양 그대로다
// (Anthropic 의 별표, Gemini 의 4각 별).

/** Anthropic 주황(#D97757) 6방 별표 — Claude Code 가 제목에 쓰는 `✳` 와 같은 모양 */
const ICON_CLAUDE = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">'
    + '<g stroke="#d97757" stroke-width="2.1" stroke-linecap="round">'
    + '<path d="M8 1.7V14.3"/><path d="M2.55 4.85 13.45 11.15"/><path d="M2.55 11.15 13.45 4.85"/>'
    + '</g></svg>'

/** OpenAI 초록(#10A37F) 육각 테두리 — 매듭 로고의 실루엣 근사 */
const ICON_CODEX = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">'
    + '<path d="M8 1.4 13.7 4.7v6.6L8 14.6 2.3 11.3V4.7z"'
    + ' stroke="#10a37f" stroke-width="1.7" stroke-linejoin="round"/></svg>'

/** Google 파랑(#4285F4) 4각 별 — Gemini 브랜드 마크의 모양 그대로 */
const ICON_GEMINI = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
    + '<path fill="#4285f4" d="M8 0c0 4.418 3.582 8 8 8-4.418 0-8 3.582-8 8'
    + ' 0-4.418-3.582-8-8-8 4.418 0 8-3.582 8-8z"/></svg>'

/**
 * Claude Code 프로필.
 *
 * 모든 값이 `detect.ts`/`deck.service.ts` 에 있던 실측값 그대로다 — 옮기기만 했고 바꾸지 않았다.
 */
const CLAUDE: AgentProfile = {
    id: 'claude',
    label: 'Claude Code',
    icon: ICON_CLAUDE,
    // `claude` 문자열은 경로(`~/.claude/...`)에도 섞여 나오므로 판정 순서를 뒤로 둔다 (MATCH_ORDER 주석)
    processHints: ['claude'],
    titleHints: ['claude'],
    waitingPatterns: [
        /Do you want to\b/i,
        /❯\s*1\.\s*Yes/,
        CONFIRM_YN,
        CONFIRM_YN_CAP,
        PRESS_ENTER,
    ],
    /**
     * 작업 중일 때만 화면에 내보내는 문구. 상태줄 갱신 같은 평시 출력과 구분하는 근거다 —
     * 이 문구는 일을 붙잡고 있는 동안에만 뜨고 끝나면 사라지므로, 사라진 시점부터 시간을 재면
     * 진행중에서 정확히 내려올 수 있다.
     */
    busyPatterns: [
        /esc to interrupt/i,
        CTRL_C_INTERRUPT,
        /\btokens?\b.{0,20}\besc\b/i,
    ],
    /**
     * **비운다 — 화면 원문이 채집된 바 없다.**
     *
     * 이 에이전트의 한도는 훅으로 온다(`claudeHooks.ts` `StopFailure` → 스크립트가
     * `error=rate_limit` 이면 `limited` 로 바꿔 보낸다). 훅이 실은 문구
     * (`You've hit your session limit · resets 12pm (Asia/Seoul)`)는 `last_assistant_message`
     * 이고 **PTY 출력 조각으로 관측한 것이 아니다** — 그것을 화면 패턴으로 옮겨 적으면
     * 실측이 아닌 값을 실측처럼 쓰는 것이다. 훅 경로가 이미 이 상태를 만들어 주므로 갭도 없다.
     * 화면 원문을 실제로 채집하면(`docs/AGENT-OBSERVATION.md` 절차) 그때 여기 넣는다.
     */
    limitedPatterns: [],
    /**
     * 작업 중일 때 콘솔 제목에 넣는 표식.
     * 별 모양과 원형 스피너 두 계열을 모두 쓴다 (2026-08-28 실측: "◐ WindowTitle 설정").
     */
    busyTitleMarks: ['✳', '✻', '✽', '✶', '✢', '◐', '◓', '◑', '◒'],
    /**
     * ESC v 만 받는다. 리터럴 0x16 은 5회 보내도 이미지가 들어가지 않았다
     * (2026-08-28 실측, `.agentdeck-diag.log` 09:33:47~48). claude.exe 안의
     * `ctrl+v ... paste images` 문구는 자기가 키 이벤트를 직접 볼 때의 안내였다.
     */
    imagePasteKey: 'alt-v',
    /** ASCII `>` 가 아니라 `❯`(U+276F) 를 쓴다 — 2026-09-01 화면 캡처로 확인 (prompt.ts 주석) */
    promptHeads: ['❯', '>'],
    // promptShape / screenShape 는 일부러 비운다 — prompt.ts·screen.ts 의 기본값이 곧 이
    // 에이전트의 실측값이라(그 화면을 보고 만든 규칙이다) 여기 옮겨 적으면 같은 값이 두 곳에
    // 생긴다. 화면 모양이 다른 에이전트가 나오면 그때 그 프로필에만 적는다.
    // 화면 문구 전부가 이 리포에서 실제로 관찰된 것이다 (위 개별 주석의 날짜)
    patternsProven: true,
}

/**
 * Codex CLI 프로필.
 *
 * 실측된 것 —
 *   - 이미지 붙여넣기: 0x16(ctrl-v) 를 자기 붙여넣기로 받고 ESC v 는 모른다 (2026-08-28 실측)
 *   - 입력창 머리글자는 `›`(U+203A) 다 — `› Ask Codex to do anything` (2026-09-08, 국면① 채집).
 *     기본 `promptHeads` 에 이미 있는 문자라 `promptShape` 가 필요 없다.
 *   - 배너 테두리는 박스 문자(`╭─╮│╰╯`)지만 **입력창에는 테두리가 없다** — 그래서
 *     `screenShape` 도 넣지 않는다 (없는 테두리를 찾게 만들면 상시 "깨짐" 이 된다).
 *   - 프로세스 **이름**으로는 안 잡힌다(자식이 `node.exe` 뿐). 제목도 `junggon` 이라 근거가 없다.
 *     잡히는 자리는 pid 의 명령줄이고, `deck.service.ts` 의 `commandLinesOf` 폴백이 읽어 준다.
 *
 * 화면 문구(대기·작업중)는 **여전히 관측하지 못했다.** 2026-09-08 시도가 국면②③ 을 못 만든
 * 이유는 두 단계였다 —
 *   ① 기본 모델 `gpt-5.4` 가 이 계정에서 거부됐다
 *      (`invalid_request_error … not supported when using Codex with a ChatGPT account`)
 *   ② `/model` 로 `gpt-6-astra low` 로 바꿔 그 벽은 넘었는데, 그 다음이 계정 사용량 한도였다
 *      (`■ Usage limit reached. You've reached your usage limit.`)
 * 둘 다 우리 코드와 무관한 계정 상태다. 그래서 `patternsProven` 은 false 를 유지한다 —
 * 합집합이 받쳐 주므로 프로필을 주지 않으면 예전과 똑같이 판정된다.
 *
 * 덧붙여 그 실패 화면이 **한도 도달 문구**를 하나 실측으로 남겼다(위 ②). 그 값은 이제
 * `limitedPatterns` 에 들어 있다 — 화면 문구로 `limited` 를 판정하는 경로가 생겼기 때문이다
 * (`detect.ts`). 대기·작업중이 여전히 미관측이라 `patternsProven` 은 false 그대로지만,
 * 합집합이 이 한도 문구를 품으므로(`buildUnion`) codex 탭도 그 문구로 판정된다.
 */
// Observed 2026-09-23: Codex MCP approval dialog and native window title.
export const CODEX_APPROVAL_PATTERNS = [
    /^[\t ]*Allow the [^\r\n]+ MCP server to run tool [^\r\n]+\?[\t ]*$/im,
    /^[\t ]*(?:[›>][\t ]*)?\d+\.[\t ]*(?:Always allow|Allow(?: for this session)?)[\t ]+Run the tool\b/im,
]
export const CODEX_WAITING_TITLE = /^\s*\[\s*!\s*\]\s*Action Required\s*\|/i
export const CODEX_BUSY_TITLE = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+/

const CODEX: AgentProfile = {
    id: 'codex',
    label: 'Codex CLI',
    icon: ICON_CODEX,
    processHints: ['codex'],
    titleHints: ['codex'],
    // MCP approval text observed in the 2026-09-23 user screenshot.
    waitingPatterns: [...CODEX_APPROVAL_PATTERNS, CONFIRM_YN, CONFIRM_YN_CAP, PRESS_ENTER],
    // 근거 미확인 — codex 가 실제로 무엇을 찍는지 관측 필요
    busyPatterns: [CTRL_C_INTERRUPT],
    /**
     * 한도 도달 화면 원문 (2026-09-08 실측, 위 ② · `docs/AGENT-OBSERVATION.md` Codex 표) —
     *   `■ Usage limit reached. You've reached your usage limit. Increase your limits to continue using codex.`
     *
     * 같은 뜻이 한 줄에 두 번 나오므로 둘 다 잡는다 — `applyOutput` 은 누적 버퍼가 아니라
     * **출력 조각 하나**에 `test` 하므로(`detect.ts`), 청크가 문장 사이에서 갈려도 하나는 살아남는다.
     * 오탐을 피해 **넣지 않은 것**:
     *   - `Increase your limits`(안내 문구) — 한도 국면이 아닌 요금제 안내에도 쓸 수 있는 말이고,
     *     청크 뒷토막만 왔을 때 판정이 서면 안 된다.
     *   - `■` 접두(codex 의 오류 표식) — 모델 거부 오류(위 ①)에도 붙는다. 국면 구분력이 없다.
     *   - `limit`/`usage` 단독 — 사용자가 그 단어를 화면에 띄우는 일이 흔하다.
     */
    limitedPatterns: [/usage limit reached/i, /reached your usage limit/i],
    // 근거 미확인 — 제목에 스피너를 넣는지 관측된 바 없다
    busyTitleMarks: [],
    imagePasteKey: 'ctrl-v',
    promptHeads: GENERIC_PROMPT_HEADS,
    // 화면 문구는 관찰된 바 없다 — 판정은 합집합을 쓴다 (patternsProven 주석)
    patternsProven: false,
}

/**
 * Gemini CLI 프로필.
 *
 * **2026-09-08 에 실제로 띄워 3국면(유휴·승인대기·작업중)을 채집했다** (Gemini CLI v0.58.0,
 * vertex-ai 인증, 격리 인스턴스 80x33). 절차와 원문은 `docs/AGENT-OBSERVATION.md` 의 채집 표.
 *
 * 이 CLI 의 특징은 **상태를 콘솔 제목으로 말한다**는 것이다 —
 *   유휴 `◇  Ready (work)` / 승인대기 `✋  Action Required (work)` / 작업중 `✦  Working… (work)`
 * 그래서 `busyTitleMarks` 에 `✦` 하나만 넣는다. `◇`(유휴)·`✋`(대기)를 넣으면 상시 진행중이
 * 되거나 대기를 진행중으로 덮어쓴다.
 *
 * 아직 못 채운 것: `imagePasteKey`(격리 환경에서 클립보드 이미지를 만들 수 없다 — R6·IN6 선례)
 * 라서 `'config'`(사용자 설정값) 폴백을 유지한다.
 */
const GEMINI: AgentProfile = {
    id: 'gemini',
    label: 'Gemini CLI',
    icon: ICON_GEMINI,
    /**
     * 프로세스 **이름**으로는 안 잡힌다 — npm 전역 래퍼라 자식이 `node.exe` 하나뿐이다
     * (2026-09-08 실측: `{ pid, command: 'node.exe' }`). 잡히는 자리는 그 pid 의 명령줄
     * (`…/npm/node_modules/@google/gemini-cli/bundle/gemini.js`)이고,
     * `deck.service.ts` 의 `commandLinesOf` 폴백이 그것을 읽어 이 힌트에 걸어 준다.
     */
    processHints: ['gemini'],
    /**
     * 제목에는 `gemini` 라는 글자가 없다(`◇  Ready (work)`). 그래도 힌트를 남기는 이유는
     * 사용자가 탭 이름을 직접 `gemini` 로 바꿔 두는 경우가 실제로 있어서다 — 해가 없다.
     */
    titleHints: ['gemini'],
    /**
     * 승인 대화상자 원문 (국면③, `gemini-3-waiting.json`) —
     *   `│ Allow execution of [Shell]?                    │`
     *   `│ ● 1. Allow once                                │`
     * `[Shell]` 자리는 도구 이름마다 바뀌므로 `Allow execution of` 까지만 잡는다.
     * 선택지 줄은 커서(`●`)와 번호를 묶어서 본다 — `Allow` 만 보면 설명문에도 걸린다.
     */
    waitingPatterns: [
        /Allow execution of\b/i,
        /●\s*\d+\.\s*Allow once/,
    ],
    /**
     * 작업 중에만 뜨는 상태줄 (국면②, `gemini-2-busy.json`) —
     *   ` ⠇ Thinking... (esc to cancel, 6s)`
     * Claude 의 `esc to interrupt` 와 문구가 다르다(`cancel`). 끝나면 사라지는 줄이라
     * `busyPatterns` 의 요건(`detect.ts`: 사라지는 문구여야 한다)을 만족한다.
     * 브라유 스피너(`⠇`/`⠦`)는 표본마다 바뀌지만 **화면** 문자라 여기 넣지 않는다 —
     * `busyTitleMarks` 는 제목만 본다.
     */
    busyPatterns: [/esc to cancel/i],
    /**
     * **미관측 — 비운다.** 2026-09-08 채집은 3국면(유휴·작업중·승인대기)뿐이고 한도 국면은
     * 만들지 못했다. gemini 가 한도를 어떤 문구로 말하는지 본 적이 없으므로 짐작해 넣지 않는다.
     *
     * 이 프로필은 `patternsProven: true` 라 판정에 자기 값이 쓰인다 — 즉 codex 에서 실측된
     * 문구가 여기로 새어 들어오지 않는다. 그게 이 리포의 규칙("실측이 있을 때만 좁힌다")의
     * 반대편 대가다: gemini 탭은 한도 문구가 채집될 때까지 화면으로는 `limited` 가 되지 않는다.
     */
    limitedPatterns: [],
    /**
     * 작업 중 제목 마크 (국면② 10표본 전부 `✦  Working… (work)`).
     * 국면①은 `◇`, 국면③은 `✋` 였으므로 이 하나만 진행중의 근거다.
     */
    busyTitleMarks: ['✦'],
    // 판정 불가 — 격리 환경에서 클립보드 이미지를 만들 수 없다 (docs/AGENT-OBSERVATION.md)
    imagePasteKey: 'config',
    /** 입력창 머리는 ASCII `>` 다 (`>   Type your message or @path/to/file`) — 기본값에 이미 있다 */
    promptHeads: GENERIC_PROMPT_HEADS,
    /**
     * 입력창 테두리가 **반블록**이다 — 위 `▄`(U+2584), 아래 `▀`(U+2580), 둘 다 폭을 꽉 채운다.
     * 기본 테두리 문자(`─`/`━`/`═`)로는 이 입력창을 못 찾으므로 여기서 넓혀 준다.
     * 화면 판정(`screenShape`)에도 같은 문자를 주되 ASCII `-` 는 넣지 않는다 —
     * 코드·마크다운의 `-----` 이 테두리로 세어져 오탐이 쏟아진다(`src/screen.ts` 주석).
     */
    promptShape: { ruleChars: ['\u2584', '\u2580', '\u2500', '\u2501', '\u2550', '-'] },
    screenShape: { ruleChars: ['\u2584', '\u2580', '\u2500', '\u2501', '\u2550'] },
    // 위 값 전부가 2026-09-08 실측이다 (docs/AGENT-OBSERVATION.md 채집 표에 원문)
    patternsProven: true,
}

/** 지원하는 에이전트 목록 — 새 CLI 는 여기에 한 덩이 추가하면 된다 */
export const AGENT_PROFILES: AgentProfile[] = [CLAUDE, CODEX, GEMINI]

/**
 * 식별 순서 — **claude 를 맨 뒤에 둔다.**
 *
 * `claude` 라는 문자열은 경로에 섞여 나온다(`~/.claude/...`, `claude-notes/`). codex 를
 * 먼저 보지 않으면 codex 세션이 claude 로 잡힐 수 있다. 옛 `detectAgentApp` 이 codex 를
 * claude 보다 먼저 본 이유가 이것이고, 그 성질을 그대로 유지한다.
 */
const MATCH_ORDER: AgentId[] = ['codex', 'gemini', 'claude']

/** 같은 정규식이 두 번 들어가지 않게 — 합집합을 만들 때 쓴다 */
function dedupeRe (list: RegExp[]): RegExp[] {
    const seen = new Set<string>()
    const out: RegExp[] = []
    for (const re of list) {
        const key = `${re.source}\u0000${re.flags}`
        if (!seen.has(key)) {
            seen.add(key)
            out.push(re)
        }
    }
    return out
}

function dedupeStr (list: string[]): string[] {
    return [...new Set(list)]
}

/**
 * 어느 에이전트인지 못 알아냈을 때 쓰는 프로필 = **모든 프로필의 합집합.**
 *
 * 0.5.0 까지의 동작이 정확히 이것이었다 — detect.ts 가 Claude 기준 패턴 하나로 모든 탭을
 * 판정했고, codex/gemini 에 우리가 추가로 넣은 패턴은 Claude 것의 부분집합이므로
 * 합집합은 그때의 목록과 같다. 그래서 프로필 없이 detect 를 부르면 예전과 결과가 같다
 * (test/detect.test.js 의 기존 17종이 그것을 고정한다).
 *
 * 이미지 키만은 합집합을 만들 수 없다(키는 하나만 보낼 수 있다) — `config` 로 두어
 * 예전처럼 사용자 설정값으로 떨어지게 한다.
 */
function buildUnion (): AgentProfile {
    return {
        id: 'unknown',
        label: '알 수 없음',
        // 합집합에는 표식을 두지 않는다 — 어느 에이전트인지 모른다는 뜻이므로 셋 중 하나를
        // 고를 근거가 없다. 그리지 않으면 그 줄은 "보통 셸" 로 읽힌다(그게 사실이다)
        icon: '',
        processHints: dedupeStr(AGENT_PROFILES.flatMap(p => p.processHints)),
        titleHints: dedupeStr(AGENT_PROFILES.flatMap(p => p.titleHints)),
        waitingPatterns: dedupeRe(AGENT_PROFILES.flatMap(p => p.waitingPatterns)),
        busyPatterns: dedupeRe(AGENT_PROFILES.flatMap(p => p.busyPatterns)),
        // 한도 문구도 여기서 모인다 — 이 한 줄이 "codex 는 patternsProven=false 인데 어떻게
        // 실측된 한도 문구로 판정되나" 의 답이다. detectProfileFor 가 그 프로필의 화면 문구를
        // 합집합으로 갈아 끼우고, 합집합에는 codex 자신이 실측한 문구가 들어 있다
        limitedPatterns: dedupeRe(AGENT_PROFILES.flatMap(p => p.limitedPatterns)),
        busyTitleMarks: dedupeStr(AGENT_PROFILES.flatMap(p => p.busyTitleMarks)),
        imagePasteKey: 'config',
        promptHeads: dedupeStr([...GENERIC_PROMPT_HEADS, ...AGENT_PROFILES.flatMap(p => p.promptHeads)]),
        // 합집합 자신은 "실측된 것을 다 모은 것" 이라 더 넓힐 대상이 없다 —
        // 이 값이 false 면 detectProfileFor 가 자기 자신을 다시 펼치려 든다
        patternsProven: true,
    }
}

export const UNKNOWN_PROFILE: AgentProfile = buildUnion()

/** 프로필을 모르는 상황(감지 전/실패)에서 쓰는 합집합 — 0.5.0 까지의 동작과 같다 */
export function unionProfile (): AgentProfile {
    return UNKNOWN_PROFILE
}

/** 아이디로 프로필을 집는다 — 모르는 아이디면 합집합을 준다(호출부에 null 검사를 강요하지 않는다) */
export function profileFor (id: AgentId | undefined | null): AgentProfile {
    return AGENT_PROFILES.find(p => p.id === id) ?? UNKNOWN_PROFILE
}

/**
 * **상태 판정(detect.ts)에 넘길** 프로필. 화면 문구가 실측되지 않은 에이전트는 그 세 필드만
 * 합집합으로 갈아 준다 — 나머지 필드(이미지 키·머리글자·라벨)는 프로필 것을 그대로 쓴다.
 *
 * 왜 이 함수가 따로 있나 — 프로필을 붙이는 것만으로 판정이 좁아지면 관측이 없는 에이전트에서는
 * **퇴행**이다. 0.5.0 은 합집합 하나로 모든 탭을 판정했으므로, 예컨대 Codex 가 실제로
 * `esc to interrupt` 를 찍고 있었다면 그때는 잡혔는데 프로필을 붙인 뒤로는 놓치게 된다
 * (유닛 C 가 그 리스크를 보고했고, 그래서 배리어에서 이 갈래를 넣었다).
 *
 * 즉 **좁히는 것은 실측이 있을 때만** 한다. Codex/Gemini 화면 문구가 관측되면 그 프로필의
 * `patternsProven` 을 true 로 올리면 이 함수가 자동으로 프로필 값을 쓴다.
 */
export function detectProfileFor (id: AgentId | undefined | null): AgentProfile {
    const profile = profileFor(id)
    if (profile.patternsProven) {
        return profile
    }
    const union = UNKNOWN_PROFILE
    return {
        ...profile,
        waitingPatterns: union.waitingPatterns,
        busyPatterns: union.busyPatterns,
        // 한도 문구도 같은 취급 — 합집합은 항상 프로필의 상위집합이라(모든 프로필을 flatMap)
        // 이 교체로 잃는 것이 없다. codex 는 이 줄 때문에 자기 실측 한도 문구를 계속 쓴다
        limitedPatterns: union.limitedPatterns,
        busyTitleMarks: union.busyTitleMarks,
        // 화면 모양도 같은 원칙이다 — 실측이 없으면 좁히지 않는다. shape 를 빼면 읽는 쪽이
        // 자기 기본값(= 지금까지의 동작)을 쓴다. 지금은 codex/gemini 가 shape 를 아예 안 들고
        // 있어 무의미해 보이지만, 나중에 누가 짐작으로 채워 넣어도 여기서 막힌다
        promptShape: undefined,
        screenShape: undefined,
    }
}

/**
 * 이 탭에서 도는 에이전트가 뭔지 — 프로세스 이름/명령줄을 먼저 보고, 없으면 탭 제목으로 본다.
 *
 * 프로세스를 먼저 보는 이유: npm 전역 래퍼를 거치면 명령줄이 node/pwsh 로만 보일 수 있어
 * 제목이 보조 근거가 되지만, 제목은 셸이 아무 문자열이나 넣을 수 있어 신뢰도가 낮다.
 * 두 근거 안에서의 에이전트 판정 순서는 `MATCH_ORDER` — claude 가 맨 뒤다.
 *
 * @param processNames 프로세스 트리에서 모은 `command name` 을 이어붙인 문자열
 * @param title 탭 제목(+ 사용자 지정 제목)
 */
export function identifyAgent (processNames: string, title: string): AgentId {
    const procs = (processNames ?? '').toLowerCase()
    for (const id of MATCH_ORDER) {
        if (profileFor(id).processHints.some(h => procs.includes(h))) {
            return id
        }
    }
    const t = (title ?? '').toLowerCase()
    for (const id of MATCH_ORDER) {
        if (profileFor(id).titleHints.some(h => t.includes(h))) {
            return id
        }
    }
    return 'unknown'
}
