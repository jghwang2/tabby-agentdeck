/**
 * 터미널 화면이 깨졌는지 판정한다.
 *
 * "깨졌다" 의 정체는 하나다 — **TUI 가 아는 폭과 xterm 이 가진 폭이 다르다.**
 * 그러면 TUI 가 그린 한 행이 xterm 에서 두 행으로 접히거나(폭이 더 크다),
 * 행 오른쪽에 옛 프레임이 남는다(폭이 더 작다). 눈으로는 "입력창 구분선이 중간에서 끊긴다",
 * "가로선과 입력 텍스트가 한 줄에 섞인다" 로 보인다.
 *
 * 정상 화면의 모양은 실측해서 확정했다 (2026-09-01, Claude Code 2.1.x, CDP 로 xterm 버퍼 원문).
 * 사이드바를 켠 창(cols=280)과 순정 창(cols=360) 양쪽에서 완전히 같은 구조가 나왔다.
 *
 *   71 wrapped=0 len=278 "                    …           ● high · /effort"   ← 오른쪽 정렬 힌트
 *   72 wrapped=0 len=280 "──────────────────────────────────────────────────"  ← len == cols
 *   73 wrapped=1 len=  1 "❯"                                                  ← wrapped=1 이 정상
 *   74 wrapped=0 len=280 "──────────────────────────────────────────────────"  ← len == cols
 *   75 wrapped=0 len=155 "  ⚠ Transcript saving is off — …"
 *   76 wrapped=0 len= 58 "  ⏱ 1s  컨텍스트 사용량: …"
 *   77 wrapped=0 len= 38 "  ⏵⏵ auto mode on (shift+tab to cycle)"
 *
 * 여기서 놓치기 쉬운 세 가지 —
 *  - 가로선은 **cols 를 정확히 꽉 채운다**. 그래서 그 다음 줄에 `wrapped=1` 이 붙는 것은
 *    xterm 의 pending-wrap 이고 **정상이다**. `wrapped` 만 보고 깨졌다고 판정하면 안 된다.
 *  - 프롬프트 오른쪽에 오는 힌트(`● high · /effort`, `Try "how does …"`)는 **별도 줄**이다.
 *    프롬프트 줄과 같은 줄에 두 개의 머리(`❯`/`>`)가 보이면 그것이 깨진 화면이다.
 *  - **폭이 다 맞아도 깨진 화면이 있다.** 테두리 두 줄이 맞붙어 `❯` 가 들어갈 행이
 *    사라지는 모양인데, 두 테두리 모두 cols 를 꽉 채우므로 폭 기준 판정은 전부 통과한다
 *    (2026-09-02: 사람 눈으로도 이 도구로도 "정상" 이라고 오판했다). 그래서 폭만이 아니라
 *    **입력할 자리가 있는가**(테두리 사이 간격 ≥ 2)를 같이 본다.
 *
 * xterm 없이 검증할 수 있도록 줄 배열만 받는 순수 함수로 둔다.
 *
 * **글자 묶음은 밖에서 주입한다** (`ScreenShape`). 위 실측은 전부 Claude Code 화면이라
 * 테두리 문자·머리글자를 파일에 박아 두면 다른 에이전트가 늘 때 이 순수 함수를 고쳐야 한다.
 * 인자를 안 주면 `DEFAULT_SCREEN_SHAPE`(= 여태 쓰던 값)로 지금과 똑같이 판정한다.
 * **판정 규칙 자체(테두리가 cols 를 꽉 채운다, 테두리 사이 간격 ≥ 2)는 shape 로 빼지 않았다** —
 * 그건 글자 모양이 아니라 "가로선 2줄 + 입력줄 1줄" 이라는 배치 가정이고, 실측 근거가
 * Claude Code 화면 하나뿐이다. 다른 앱 실측이 생기면 그때 규칙을 손댈 자리다.
 */

/** 판정에 필요한 한 줄 — 오른쪽 공백을 떼어낸 본문과 xterm 의 wrap 플래그 */
export interface ScreenLine {
    text: string
    wrapped: boolean
}

export interface ScreenVerdict {
    broken: boolean
    /** 왜 깨졌다고 보는지 — 진단 로그에 그대로 남긴다 */
    reasons: string[]
}

/**
 * 화면에서 입력창을 알아보는 데 쓰는 글자 묶음.
 *
 * 정규식이 아니라 문자 배열로 받는 이유는 `prompt.ts` 의 `PromptShape` 와 같다 —
 * 프로필이 이스케이프를 신경쓰지 않아도 되게. 조립·캐시는 이 파일이 한다.
 *
 * `prompt.ts` 와 타입을 공유하지 않고 각자 두는 이유 — 두 판정이 보는 것이 다르다.
 * 프롬프트 추출은 "입력창 아래 테두리" 하나만 알면 되고(그래서 ASCII `-` 도 받는다),
 * 화면 판정은 화면 전체를 훑으므로 테두리 문자를 더 좁게 잡아야 한다(아래 주석 참조).
 */
export interface ScreenShape {
    /** 가로선(입력창 위/아래 테두리)으로 볼 문자 */
    ruleChars: string[]
    /** 입력창 머리글자 후보 */
    heads: string[]
    /**
     * 선택지 커서로 쓰이는 단어 — 머리로 세지 않는다.
     * 선택(옵셔널)이라 프로필이 `ruleChars`·`heads` 만 줘도 된다.
     */
    choiceWords?: string[]
}

/**
 * 여태 쓰던 값 그대로 — Claude Code 2.1.x 실측 기준.
 *
 * `ruleChars` 에 ASCII `-` 가 없는 것은 의도다(원래 값 그대로 옮겼다). 이 판정은 화면
 * 전체를 훑기 때문에, `-` 를 넣으면 코드·마크다운 출력의 `-----` 줄이 입력창 테두리로
 * 세어지고 "폭이 안 맞는 테두리" 오탐이 쏟아진다. 실측 골든의 테두리는 전부 U+2500 계열이다.
 *
 * `choiceWords` 의 `Yes`/`No` 는 Claude Code 확인창 문구다 — 다른 에이전트·다른 언어에서는
 * 다른 단어이므로 상수로 박아 두지 않고 여기 기본값으로만 둔다.
 */
export const DEFAULT_SCREEN_SHAPE: ScreenShape = {
    ruleChars: ['─', '━', '═'],
    heads: ['>', '❯', '›', '❭', '➜'],
    choiceWords: ['Yes', 'No'],
}

/** shape 하나로 조립해 둔 정규식 묶음 */
interface ScreenRegex {
    /**
     * 가로선만으로 된 줄 (입력창 위/아래 테두리).
     * 두 글자까지 내려 잡는 이유 — 테두리가 화면 폭을 넘치면 다음 줄에 한두 칸짜리
     * 자투리로 떨어진다 (실측: cols=280 화면에 280칸 + `──` 2칸).
     */
    rule: RegExp
    /** 입력창 머리글자 — prompt.ts 와 같은 집합. 뒤가 줄 끝이어도(빈 입력창) 머리다 */
    head: RegExp
    /** 줄 어딘가에 있는 머리글자 — 가로선과 섞였는지 볼 때 쓴다 */
    headAnywhere: RegExp
    /** 선택지 커서(`❯ 1. Yes`)는 입력창 머리가 아니다 */
    choice: RegExp
    /** 가로선 문자 하나라도 있는지 */
    ruleChar: RegExp
    /** 줄 안의 가로선 문자를 **세려고** 쓴다 (전역). `.match()` 로만 쓸 것 */
    ruleCharAll: RegExp
}

// 아래 세 헬퍼는 `prompt.ts` 에도 같은 것이 있다. 공유 파일로 빼지 않은 이유 —
// 두 모듈은 순수 함수 단위로 따로 컴파일해 따로 테스트하고(`npm test` 가 파일 목록을
// 직접 나열한다), 서로를 import 하지 않는 것이 이 파일들의 규약이다. 열 줄을 아끼려고
// 의존을 만들 자리가 아니다.

/** 정규식 본문에 리터럴로 박아도 안전하게 (`-`·`]`·`\` 가 들어와도 안 깨지게) */
function reEscape (s: string): string {
    return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

/** 문자클래스 안에 박을 때 — 사고를 내는 건 `\`·`]`·`^`·`-` 넷이다 */
function classEscape (chars: string[]): string {
    return chars.join('').replace(/[\\\]^-]/g, '\\$&')
}

/** 후보들을 교대(`a|b|c`)로. **긴 것을 먼저** — `>` 가 `>>` 를 가로채지 않게 */
function altOf (items: string[]): string {
    return [...items].sort((a, b) => b.length - a.length).map(reEscape).join('|')
}

/** 빈 배열·타입 이상값은 조용히 기본값으로 (프로필 일부만 준 경우) */
function pick (given: string[] | undefined, fallback: string[]): string[] {
    if (!Array.isArray(given)) {
        return fallback
    }
    const kept = given.filter(s => typeof s === 'string' && s.length > 0)
    return kept.length ? kept : fallback
}

/**
 * 조립 결과 캐시. `judgeScreen` 은 2초마다 **전 탭**에 도니까 정규식 다섯 개를
 * 매번 새로 만들지 않는다. 키를 객체 신원이 아니라 내용으로 잡는 이유는 `prompt.ts` 와 같다.
 */
const screenCache = new Map<string, ScreenRegex>()

function resolveShape (shape?: Partial<ScreenShape> | null): ScreenRegex {
    const ruleChars = pick(shape ? shape.ruleChars : undefined, DEFAULT_SCREEN_SHAPE.ruleChars)
    const heads = pick(shape ? shape.heads : undefined, DEFAULT_SCREEN_SHAPE.heads)
    const choiceWords = pick(shape ? shape.choiceWords : undefined, DEFAULT_SCREEN_SHAPE.choiceWords!)

    const key = JSON.stringify([ruleChars, heads, choiceWords])
    const hit = screenCache.get(key)
    if (hit) {
        return hit
    }

    const rule = classEscape(ruleChars)
    const head = altOf(heads)
    const made: ScreenRegex = {
        rule: new RegExp(`^[${rule}]{2,}$`),
        head: new RegExp(`^(?:${head})(?:\\s|$)`),
        headAnywhere: new RegExp(`(?:${head})(?:\\s|$)`),
        // 번호 목록은 앱과 무관하게 늘 선택지라 항상 배제한다. 무번호 선택지는 단어 목록으로.
        // 단어 끝을 `\b` 대신 `(?!\w)` 로 잠그는 이유 — 한글 선택지(`예`/`아니오`)는 마지막
        // 글자가 `\w` 가 아니어서 `\b` 가 생기지 않는다. 영문 단어에는 `\b` 와 결과가 같다.
        choice: new RegExp(`^(?:${head})\\s*(?:\\d+[.)]\\s|(?:${altOf(choiceWords)})(?!\\w))`, 'i'),
        ruleChar: new RegExp(`[${rule}]`),
        ruleCharAll: new RegExp(`[${rule}]`, 'g'),
    }
    screenCache.set(key, made)
    return made
}

/**
 * 입력창이 있는 구간 — 화면 맨 아래 이만큼만 본다.
 *
 * 입력창은 언제나 화면 맨 아래에 있고, 대화 이력에 남은 옛 입력창까지 같은 규칙으로 보면
 * 오탐이 쏟아진다. `deck.service.ts` 의 `clearInputArea` 가 잔상을 지울 때 쓰는 창과 같은 값이다.
 */
export const INPUT_TAIL = 16

/**
 * xterm 이 가진 크기와 pty 에 알려 둔 크기가 **맞나**.
 *
 * 자동복구를 켤 수 있느냐가 이 하나에 달려 있다. 2026-09-09 실사용 채증 8건이 정확히 둘로 갈렸다 —
 *
 *   xterm != pty : 00:46:54 (280/283) · 01:13:20 (281/279) · 01:59:08 (221/281) · 02:34:21 (282/280)
 *                  → 전부 **리사이즈 중간 프레임**. 화면 덤프는 앱 기준 정상이고 0~3초 만에
 *                    스스로 돌아왔다. Tabby 순정이 pty 까지 맞춘다 — 우리가 손대면 화면만 흔들린다.
 *   xterm == pty : 02:07:45 ~ 02:08:01 (281/281, 4샘플)
 *                  → 자식 프로세스 stdout 이 TUI 를 덮어쓴 **진짜 깨짐**. 26초를 버텼고
 *                    `clearInputArea` + `Ctrl+L` 로 고쳐진다.
 *
 * 2026-09-02 에 자동복구를 껐던 "실사용 4/4 실패" 가 앞 유형에 손댄 것이었다.
 * 그래서 판정은 `judgeScreen`(화면 모양)과 **따로** 둔다 — 깨진 것은 맞는데 우리 일이 아닌 경우다.
 *
 * pty 크기를 아직 못 읽은 경우(`undefined`)는 **맞다고 본다** — 모르는 것을 이유로 복구를
 * 막으면 크기 정보가 없는 프론트엔드에서 기능이 통째로 죽는다.
 */
export function sizeInSync (xcols?: number, xrows?: number, sentCols?: number, sentRows?: number): boolean {
    if (!(typeof xcols === 'number' && xcols > 1)) {
        return true
    }
    if (typeof sentCols !== 'number' || typeof sentRows !== 'number') {
        return true
    }
    return sentCols === xcols && sentRows === xrows
}

/** 가로선 문자만으로 된 줄인가 (입력창 위/아래 테두리) */
export function isRuleRow (text: string, shape?: Partial<ScreenShape> | null): boolean {
    return resolveShape(shape).rule.test(text.trim())
}

/**
 * 테두리 행이 "거의 다 가로선" 이라고 볼 최소 비율.
 *
 * 문자열 길이로 `== cols` 를 볼 수 없어서 비율로 잰다 — xterm 의 `translateToString` 은
 * **전각 글자를 한 글자로** 돌려주므로(둘째 칸은 빈 셀) 한글이 섞인 행은 문자열 길이가
 * cols 보다 짧다 (실측 채증: cols=281 화면의 한글 행이 `len=134`).
 * 잔상은 몇 글자짜리라 가로선이 압도적으로 많다.
 */
const GHOST_RULE_RATIO = 0.6

/**
 * 잔상이 얹힌 테두리 행인가 — 양끝은 가로선인데 가운데에 옛 프레임 글자가 남았다.
 *
 * `judgeScreen` 의 같은 규칙을 밖에서도 쓰려고 뺐다. 복구(`clearInputArea`)가 입력창의
 * 시작 행을 찾을 때 이 행을 **테두리로 쳐 줘야** 잔상 위에서부터 지우기가 시작된다 —
 * 순수 가로선만 찾으면 이 행을 못 보고 입력창 아래를 지워 아무것도 안 고쳐진다.
 *
 * **양끝이 가로선인 줄만** 본다 — 상자형 입력창(`╭──╮`)은 모서리로 시작·끝나므로 안 걸린다.
 * 대화 출력의 짧은 구분선(`── 요약 ──`)은 가로선 비율에서 걸러진다.
 */
export function isGhostRuleRow (text: string, cols: number, shape?: Partial<ScreenShape> | null): boolean {
    const re = resolveShape(shape)
    const body = text.replace(/\s+$/, '')
    if (!(cols > 1) || body.length < 2 || re.rule.test(body)) {
        return false
    }
    if (!re.ruleChar.test(body[0]) || !re.ruleChar.test(body[body.length - 1])) {
        return false
    }
    const ruleCount = (body.match(re.ruleCharAll) || []).length
    return ruleCount >= cols * GHOST_RULE_RATIO
}

/**
 * @param lines 화면에 그려진 줄 배열 (위에서 아래로)
 * @param cols xterm 이 가진 화면 폭
 * @param shape 입력창 글자 묶음. 생략하면 `DEFAULT_SCREEN_SHAPE`(Claude Code 2.1.x 실측)
 */
export function judgeScreen (lines: ScreenLine[], cols: number, shape?: Partial<ScreenShape> | null): ScreenVerdict {
    const re = resolveShape(shape)
    const reasons: string[] = []
    if (!(cols > 1) || !lines.length) {
        return { broken: false, reasons: [] }
    }

    const rules: number[] = []
    const heads: number[] = []
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const body = line.text.replace(/\s+$/, '')
        if (!body) {
            continue
        }

        if (re.rule.test(body)) {
            rules.push(i)
            // 테두리는 화면 폭을 꽉 채운다. 짧으면 TUI 가 더 좁은 폭으로 그린 것이고,
            // 그보다 짧은 자투리 줄이면 넘쳐 접힌 꼬리다 — 어느 쪽이든 폭이 어긋났다.
            //
            // 2026-09-02: `cols - 1` 도 정상으로 봐주도록 한 번 완화했다가 되돌렸다.
            // 근거로 삼은 `len=279` 스냅샷이 **전부 깨짐으로 판정된 화면**이었고,
            // 같은 로그의 정상 표본(`auto-after 복구됨`)은 `len == cols == 280` 이었다.
            // 병상 표본을 정상 기준으로 삼으면 안 된다.
            if (body.length !== cols) {
                reasons.push(`rule@${i} len=${body.length} != cols=${cols}`)
            }
            continue
        }

        // **테두리 행 한가운데에 옛 프레임 글자가 남았다** (2026-09-09 실사용 스샷 픽셀 복원).
        //
        // Ctrl+Enter 로 입력창이 여러 줄로 자라면 화면이 한 줄 밀리는데, 앱은 자기가 아는
        // 자리에 테두리를 다시 그린다. 그 행에 있던 옛 글자는 앱이 덮지 않는 칸에 그대로 남는다.
        // 채증(387x157 스샷, 셀폭 7px·행높이 17px)의 테두리 행 잉크 구간이 그 증거다 —
        //   `19-46`(가로선) `49-57 63-71 77-85`(전각 글자 3개) `89-385`(가로선)
        //
        // 이 모양은 여태 **정상으로 통과했다.** 테두리 행이 순수 가로선이 아니라 `rules` 에
        // 안 들어가고, 머리글자가 없어 `mixed` 도 아니고, 그래서 `아래 테두리가 없다`·`lens 섞임`
        // 까지 전부 비껴간다. 판정의 구멍이었다 (재현 케이스는 test/screen.test.js 에 고정).
        //
        // 판정은 `isGhostRuleRow` 하나로 모아 뒀다 — 복구(`clearInputArea`)가 입력창의 시작
        // 행을 찾을 때 **같은 규칙**을 써야 "깨졌다고 하면서 그 자리를 못 지운다" 가 안 생긴다.
        // 화면 하단 구간(`INPUT_TAIL`)으로 좁히는 것은 여기서만 한다 — 대화 이력에 스크롤되어
        // 남은 옛 화면까지 깨짐으로 세면 오탐이 쏟아진다.
        if (i >= lines.length - INPUT_TAIL && isGhostRuleRow(body, cols, shape)) {
            reasons.push(`테두리 행에 옛 글자가 남았다@${i} ${JSON.stringify(body.slice(0, 40))}`)
        }

        // 가로선과 다른 글자가 한 줄에 섞였다.
        // 상자형 입력창(`╭──╮` / `│ > … │`)을 쓰는 앱도 있으므로, 머리글자가 같은 줄에
        // 함께 있을 때만 깨진 것으로 본다 — 그것이 "가로선과 입력 텍스트가 섞인" 그 증상이다.
        if (re.ruleChar.test(body) && re.headAnywhere.test(body)) {
            reasons.push(`mixed@${i} ${JSON.stringify(body.slice(0, 40))}`)
        }

        if (re.head.test(body) && !re.choice.test(body)) {
            heads.push(i)
        }
    }

    // 입력창 **안에** 머리가 두 개 이상 보인다 = 옛 프레임이 지워지지 않았다.
    //
    // 화면 전체의 머리 수를 세면 안 된다 — Claude Code 는 지난 사용자 프롬프트를
    // `❯ 내가 보낸 말` 로 대화 이력에 남기고, 큐에 쌓인 메시지도 같은 모양으로 나열한다.
    // 그래서 정상 화면에도 머리가 예사로 일곱 개 보인다 (2026-09-01 실측: `heads=7` 오탐으로
    // 자동 복구가 2초마다 헛돌았다). 판정은 입력창 테두리(가로선) 사이 구간에서만 한다.
    //
    // 판정은 **맨 아래 두 테두리** 사이에서만 한다. 위쪽 테두리를 `rules[0]` 으로 잡으면
    // 대화 이력에 스크롤되어 남은 옛 입력창의 테두리를 물어, 그 사이의 지난 프롬프트가
    // 전부 머리로 세어진다. 입력창은 언제나 화면 맨 아래에 있다.
    // 자투리 테두리(폭이 안 맞는 줄)는 위치 기준이 못 되므로 **화면 폭을 꽉 채운 것**만 쓴다.
    const fullRules = rules.filter(i => lines[i].text.replace(/\s+$/, '').length === cols)
    if (fullRules.length >= 2) {
        const bottom = fullRules[fullRules.length - 1]
        const top = fullRules[fullRules.length - 2]

        // **입력할 자리가 없다** — 테두리 두 줄이 맞붙어 `❯` 가 들어갈 행이 사라졌다.
        //
        // 이것이 2026-09-02 에 사람 눈으로도 도구로도 놓친 그 증상이다. 폭은 멀쩡해서
        // (테두리 둘 다 cols 를 꽉 채운다) 폭 기준 판정은 전부 통과해 버린다. 실측 픽셀:
        // 가로선 y=59 와 y=76 이 행높이(17px) 1행 간격, 그 사이 커서 글리프가 아래 선을 관통.
        // 정상이라면 두 테두리는 최소 한 행(입력줄)을 사이에 두므로 간격이 2 이상이다.
        if (bottom - top < 2) {
            reasons.push(`입력창에 자리가 없다 (테두리 ${top}·${bottom} 이 맞붙었다)`)
        } else {
            const inside = heads.filter(i => i > top && i < bottom).length
            // 머리가 0 개인 것은 깨짐으로 보지 않는다 — 선택지 커서(`❯ 1. Yes`)만 있는
            // 정상 화면이 그렇게 보인다 (choice 로 빼고 나면 머리가 0 이 된다).
            if (inside > 1) {
                reasons.push(`입력창 안 머리=${inside} (기대 1)`)
            }
        }
    }
    // **아래 테두리가 통째로 사라졌다.**
    //
    // 2026-09-02 실사용 실측(창 캡처 픽셀 스캔, 행높이 17px): 가로선이 `y=1295` 하나뿐이고
    // 프롬프트 글리프(y≈1304~1320) 아래 `y≈1329` 에 있어야 할 두 번째 가로선이 없었다.
    // 이 모양은 위 규칙들이 전부 통과한다 — 남은 테두리 하나는 폭을 꽉 채우고(폭 규칙 통과),
    // 테두리가 하나뿐이라 `fullRules.length >= 2` 가 거짓이라 자리 규칙도 건너뛰고,
    // `rules.length > 1` 도 거짓이라 섞임 규칙도 안 본다. 판정의 구멍이었다.
    //
    // 머리 **바로 위** 가 폭을 꽉 채운 테두리일 때만 본다. 그래야 3줄 입력창(`──/❯/──`)을
    // 쓰는 화면에만 적용되고, 테두리가 없는 일반 셸이나 상자형 입력창은 건드리지 않는다.
    // 대화 이력에 남은 옛 `❯ 내가 보낸 말` 도 안전하다 — 그 아래에는 현재 입력창의
    // 테두리가 있으므로 "아래에 테두리가 없다" 조건에 걸리지 않는다.
    if (heads.length && fullRules.length) {
        const head = heads[heads.length - 1]
        const topAttached = fullRules.includes(head - 1)
        const belowHead = fullRules.some(i => i > head)
        if (topAttached && !belowHead) {
            reasons.push(`입력창 아래 테두리가 없다 (머리@${head}, 위 테두리@${head - 1})`)
        }
    }

    // 테두리 길이가 서로 다르면 두 폭이 화면에 공존한다
    if (rules.length > 1) {
        const lens = new Set(rules.map(i => lines[i].text.replace(/\s+$/, '').length))
        if (lens.size > 1) {
            reasons.push(`rule lens=${[...lens].join(',')} (섞임)`)
        }
    }

    return { broken: reasons.length > 0, reasons }
}
