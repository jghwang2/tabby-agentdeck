/**
 * 터미널 화면에 그려진 입력창에서 지금 쓰여 있는 프롬프트를 뽑아낸다.
 *
 * 타이핑을 따로 세지 않고 화면을 읽는 이유 — 붙여넣기·↑ 히스토리·자동완성·IME 로 들어온 글자는
 * 키 이벤트로 안 오거나 원문과 다르다. 화면에 실제로 그려진 것이 곧 보낼 내용이다.
 *
 * 입력창 모양은 앱·버전마다 다르다. 옛 Claude Code / Codex 는 테두리 상자였고
 *   ╭────────────────────╮
 *   │ > 프롬프트 내용      │
 *   ╰────────────────────╯
 * Claude Code 2.1.x 는 상자를 버리고 위아래 가로선 사이에 한 줄만 그린다.
 *   ────────────────────────
 *   ❯ 프롬프트 내용
 *   ────────────────────────
 *     ? for shortcuts
 * 머리글자도 ASCII `>` 가 아니라 `❯`(U+276F) 다 — 2026-09-01 화면 캡처로 확인.
 * `>` 만 찾던 정규식이 이걸 못 잡아 라벨이 한 번도 안 바뀌었다.
 *
 * 머리를 못 찾으면 빈 문자열을 준다 — 일반 셸이나 y/n 확인 같은 데서 엉뚱한 라벨이 박히느니
 * 라벨을 그대로 두는 편이 낫다.
 *
 * 화면 버퍼를 직접 받지 않고 줄 배열만 받는 순수 함수로 둔다 (xterm 없이 검증할 수 있게).
 *
 * **모양은 밖에서 주입한다** (`PromptShape`). 위 실측은 전부 Claude Code 화면이고,
 * Codex·Gemini 는 머리글자도 테두리도 다를 수 있다. 상수를 파일에 박아 두면 에이전트가
 * 늘 때마다 이 순수 함수를 고쳐야 한다 — 대신 글자 묶음을 인자로 받아 두면 에이전트별
 * 프로필이 그 자리에 값을 꽂는다. 인자를 안 주면 `DEFAULT_PROMPT_SHAPE`(= 여태 쓰던 값)다.
 */

/**
 * 입력창을 찾는 데 쓰는 글자 묶음.
 *
 * 정규식이 아니라 **문자/단어 배열**로 받는 이유 — 프로필이 정규식을 들고 있으면
 * 이스케이프·플래그 실수가 프로필 쪽으로 번지고 사람이 읽기도 어렵다. 데이터만 받고
 * 조립은 여기서 한 번만 한다 (그리고 캐시한다 — 아래 `promptCache`).
 */
export interface PromptShape {
    /** 입력창 머리글자 후보. 여러 글자짜리 머리(`>>>` 등)도 그대로 받는다 */
    heads: string[]
    /** 머리글자를 쓰지만 프롬프트가 아닌 줄 — 선택지 커서(`❯ Yes`)의 그 단어들 */
    choiceWords: string[]
    /** 입력창 아래 테두리로 볼 문자 */
    ruleChars: string[]
}

/**
 * 여태 쓰던 값 그대로 — Claude Code 2.1.x 실측 기준 (2026-09-01 화면 캡처).
 *
 * - `heads`: ASCII `>` 와 꺾쇠 계열(❯ › ❭ ➜). Claude Code 2.1.x 는 `❯`(U+276F).
 * - `choiceWords`: 같은 꺾쇠를 선택지 커서로도 쓴다 (`❯ 1. Yes`). 번호 목록은 아래
 *   조립부에서 항상 배제하고, `Yes`/`No` 같은 무번호 선택지는 이 단어 목록으로 배제한다.
 * - `ruleChars`: 입력창 아래 테두리에 쓰이는 가로선 문자. ASCII `-` 도 넣어 둔다 —
 *   상자형 입력창을 ASCII 로 그리는 앱(`+------+`)이 있다.
 */
export const DEFAULT_PROMPT_SHAPE: PromptShape = {
    heads: ['>', '❯', '›', '❭', '➜'],
    choiceWords: ['Yes', 'No'],
    ruleChars: ['─', '━', '═', '-'],
}

/** 이보다 짧으면 라벨로 쓰지 않는다 (y/n 응답 등) */
const MIN_PROMPT_LEN = 2
/** 사이드바에 들어가는 라벨 길이 */
export const MAX_LABEL_LEN = 40

/**
 * 입력창 테두리로 보고 떼어낼 글자 (`stripBox`). 앞과 뒤가 조금 다르다 — 원래 값 그대로다.
 *
 * shape 로 빼지 않은 이유 — 유니코드 박스드로잉은 앱이 달라도 같은 글자를 쓰고(실측: 옛
 * Claude Code·Codex 둘 다 `╭─╮`), 여백을 과하게 떼어내도 프롬프트 내용이 상하지 않는다.
 * 다만 **shape 가 머리라고 선언한 글자는 여기서 뺀다** — `|` 는 테두리이기도 하고
 * 셸 스타일 입력창의 머리이기도 해서, 안 빼면 머리를 테두리로 알고 떼어내 버린다
 * (그러면 `head` 정규식이 못 맞아 프롬프트를 통째로 놓친다).
 */
const BOX_LEAD = '│┃|╭╰┌└─╮╯┐┘'
const BOX_TAIL = '│┃|╮╯┐┘─'
/** 세로 테두리만 — 아래 테두리 줄(`│ ─── │`)의 좌우를 봐줄 때 쓴다 */
const BOX_VERT = '│┃|'

/** shape 하나로 조립해 둔 정규식 묶음 */
interface PromptRegex {
    /** 입력창의 첫 줄 표식 */
    head: RegExp
    /** 머리글자를 쓰지만 프롬프트가 아닌 줄 (선택지 커서) */
    choice: RegExp
    /** 입력창 아래 테두리 — 상자 모서리(╰└) 또는 가로선만으로 된 줄 */
    bottom: RegExp
    /** 줄 앞의 테두리·여백 */
    stripLead: RegExp
    /** 줄 뒤의 테두리·여백 */
    stripTail: RegExp
}

/**
 * 정규식 본문에 리터럴로 박아도 안전하게.
 * 프로필이 `-`·`]`·`\` 같은 글자를 머리로 줘도 조립이 깨지지 않아야 한다.
 */
function reEscape (s: string): string {
    return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

/** 문자클래스 안에 박을 때 — 여기서 사고를 내는 건 `\`·`]`·`^`·`-` 넷이다 */
function classEscape (chars: string[]): string {
    return chars.join('').replace(/[\\\]^-]/g, '\\$&')
}

/**
 * 후보들을 교대(`a|b|c`)로 조립한다. **긴 것을 먼저** 놓는다 —
 * `['>', '>>']` 를 순서대로 두면 `>` 가 `>>` 를 가로채 한 글자만 먹는다.
 */
function altOf (items: string[]): string {
    return [...items].sort((a, b) => b.length - a.length).map(reEscape).join('|')
}

/** 빈 배열·타입 이상값은 조용히 기본값으로 떨어뜨린다 (프로필 일부만 준 경우) */
function pick (given: string[] | undefined, fallback: string[]): string[] {
    if (!Array.isArray(given)) {
        return fallback
    }
    const kept = given.filter(s => typeof s === 'string' && s.length > 0)
    return kept.length ? kept : fallback
}

/**
 * 조립 결과 캐시. `extractPrompt` 는 Enter 마다 도니까 정규식 다섯 개를 매번 새로 만들지 않는다.
 *
 * 키를 shape **객체 신원**이 아니라 **내용**으로 잡는 이유 — 호출부가 객체 리터럴을
 * 그때그때 만들어 넘겨도(테스트가 그렇게 한다) 캐시가 맞는다. 키 계산(JSON 문자열 몇십 자)은
 * `new RegExp` 다섯 번보다 훨씬 싸다. 서로 다른 프로필 수만큼만 늘어나므로 상한도 사실상 있다.
 */
const promptCache = new Map<string, PromptRegex>()

function resolveShape (shape?: Partial<PromptShape> | null): PromptRegex {
    const heads = pick(shape ? shape.heads : undefined, DEFAULT_PROMPT_SHAPE.heads)
    const choiceWords = pick(shape ? shape.choiceWords : undefined, DEFAULT_PROMPT_SHAPE.choiceWords)
    const ruleChars = pick(shape ? shape.ruleChars : undefined, DEFAULT_PROMPT_SHAPE.ruleChars)

    const key = JSON.stringify([heads, choiceWords, ruleChars])
    const hit = promptCache.get(key)
    if (hit) {
        return hit
    }

    const head = altOf(heads)
    const rule = classEscape(ruleChars)
    // 머리로 쓰이는 글자는 테두리 목록에서 빼낸다 (위 BOX_LEAD 주석 참조)
    const headChars = new Set(heads.join(''))
    const lead = classEscape([...BOX_LEAD].filter(c => !headChars.has(c)))
    const tail = classEscape([...BOX_TAIL].filter(c => !headChars.has(c)))
    const vert = classEscape([...BOX_VERT].filter(c => !headChars.has(c)))
    const made: PromptRegex = {
        head: new RegExp(`^(?:${head})\\s*`),
        // 번호 목록(`1.` `2)`)은 어느 앱에서나 선택지라 shape 와 무관하게 항상 배제하고,
        // 무번호 선택지는 `choiceWords` 로 배제한다.
        //
        // 단어 끝을 `\b` 가 아니라 `(?!\w)` 로 잠그는 이유 — 한글 선택지(`예`/`아니오`)는
        // 마지막 글자가 `\w` 가 아니어서 뒤에 `\b` 가 생기지 않는다. `\b` 로 조립하면
        // 한글 단어는 영영 안 맞는다. 영문 단어(`Yes`/`No`)에는 `\b` 와 결과가 같다.
        choice: new RegExp(`^(?:${head})\\s*(?:\\d+[.)]\\s|(?:${altOf(choiceWords)})(?!\\w))`, 'i'),
        bottom: new RegExp(`^[\\s${vert}]*[${rule}]{3,}[\\s${vert}]*$|[╰└]`),
        stripLead: new RegExp(`^[\\s${lead}]+`),
        stripTail: new RegExp(`[\\s${tail}]+$`),
    }
    promptCache.set(key, made)
    return made
}

/** 입력창 테두리(│ ┃ 등)와 좌우 여백을 떼어낸 알맹이 */
function stripBox (line: string, re: PromptRegex): string {
    return line.replace(re.stripLead, '').replace(re.stripTail, '').trim()
}

/**
 * @param lines 화면에 그려진 줄 배열 (위에서 아래로)
 * @param shape 입력창 모양. 생략하면 `DEFAULT_PROMPT_SHAPE`(Claude Code 2.1.x 실측)
 */
export function extractPrompt (lines: string[], shape?: Partial<PromptShape> | null): string {
    const re = resolveShape(shape)
    // 아래에서 위로 머리 줄을 찾는다 (마지막 입력창이 곧 지금 입력창)
    let head = -1
    for (let i = lines.length - 1; i >= 0; i--) {
        const body = stripBox(lines[i], re)
        if (!re.head.test(body)) {
            continue
        }
        if (re.choice.test(body)) {
            return '' // 선택지 커서 — 여기서 위로 더 올라가면 옛 프롬프트를 주워온다
        }
        head = i
        break
    }
    if (head < 0) {
        return ''
    }
    const parts = [stripBox(lines[head], re).replace(re.head, '')]
    for (let i = head + 1; i < lines.length; i++) {
        if (re.bottom.test(lines[i])) {
            break // 입력창 끝 — 그 아래는 힌트 줄이라 프롬프트가 아니다
        }
        const body = stripBox(lines[i], re)
        if (body) {
            parts.push(body)
        }
    }
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (text.length < MIN_PROMPT_LEN) {
        return '' // y/n 같은 한 글자 응답 — 라벨로 쓸 것이 못 된다
    }
    return text.length > MAX_LABEL_LEN ? text.slice(0, MAX_LABEL_LEN).trimEnd() + '...' : text
}
