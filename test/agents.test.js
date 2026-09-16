// 에이전트 프로필 — "클로드든 코덱스든 제미나이든 같은 포맷으로" 의 뿌리다.
// 여기서 지키는 것 두 가지:
//   ① 판정 순서 (프로세스 우선, claude 는 맨 뒤 — 경로에 `claude` 가 섞여 나오므로)
//   ② 합집합이 Claude 패턴을 전부 품는지 — detect 를 프로필 없이 부를 때의 0.5.0 동작이 여기 걸려 있다
const {
    AGENT_PROFILES, UNKNOWN_PROFILE, identifyAgent, profileFor, unionProfile, detectProfileFor,
} = require('../.tmp/agents.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name} -> ${got}`)
        pass++
    } else {
        console.log(`  FAIL ${name} -> ${got} (기대: ${want})`)
        fail++
    }
}

// 1) 프로세스 이름이 첫 근거다
{
    check('프로세스 claude', identifyAgent('C:/Users/x/AppData/npm/claude.exe claude', ''), 'claude')
    check('프로세스 codex', identifyAgent('node codex', ''), 'codex')
    check('프로세스 gemini', identifyAgent('node gemini', ''), 'gemini')
}

// 2) 프로세스에서 못 알아내면 제목으로 떨어진다 (npm 전역 래퍼를 거치면 명령줄이 node/pwsh 로만 보인다)
{
    check('제목 폴백 claude', identifyAgent('pwsh node', 'claude — 결제 버그'), 'claude')
    check('제목 폴백 codex', identifyAgent('pwsh node', '◐ codex 작업중'), 'codex')
    check('프로세스가 제목보다 우선', identifyAgent('codex', 'claude'), 'codex')
}

// 3) 경로에 `claude` 가 섞인 codex 세션 — codex 를 먼저 봐야 한다.
//    옛 detectAgentApp 이 codex 를 claude 보다 먼저 본 이유가 이것이고, 그 성질을 유지한다
{
    check('경로에 .claude 가 섞여도 codex',
        identifyAgent('node C:/Users/x/.claude/tools/codex.js', ''), 'codex')
    check('제목에도 섞였을 때 codex', identifyAgent('', 'codex (~/.claude 설정 편집)'), 'codex')
}

// 4) 모르는 것은 unknown — 보통 셸이 에이전트로 잡히면 안 된다
{
    check('보통 셸', identifyAgent('pwsh.exe conhost.exe', 'D:\\Project'), 'unknown')
    check('빈 입력', identifyAgent('', ''), 'unknown')
    check('null 도 죽지 않는다', identifyAgent(null, undefined), 'unknown')
}

// 5) profileFor 는 항상 프로필을 준다 — 호출부에 null 검사를 강요하지 않는다
{
    check('profileFor claude', profileFor('claude').id, 'claude')
    check('profileFor unknown -> 합집합', profileFor('unknown').id, 'unknown')
    check('profileFor 없는 id -> 합집합', profileFor('cursor').id, 'unknown')
    check('profileFor undefined -> 합집합', profileFor(undefined).id, 'unknown')
    check('unionProfile == UNKNOWN_PROFILE', unionProfile() === UNKNOWN_PROFILE, true)
}

// 6) 프로필의 필수 필드는 비어 있을 수 없다 — 새 에이전트를 추가할 때 반쯤 채우고 끝내는 것을 막는다.
//    화면 문구(waiting/busy)와 제목 스피너는 실측이 없으면 비워 두는 것이 규칙이라 여기서 요구하지 않는다
{
    check('프로필 3종', AGENT_PROFILES.length, 3)
    for (const p of AGENT_PROFILES) {
        check(`${p.id} label`, !!p.label, true)
        check(`${p.id} processHints`, p.processHints.length > 0, true)
        check(`${p.id} titleHints`, p.titleHints.length > 0, true)
        check(`${p.id} promptHeads`, p.promptHeads.length > 0, true)
        check(`${p.id} imagePasteKey`, ['alt-v', 'ctrl-v', 'config'].includes(p.imagePasteKey), true)
        check(`${p.id} 배열 필드 존재`,
            Array.isArray(p.waitingPatterns) && Array.isArray(p.busyPatterns)
            && Array.isArray(p.limitedPatterns) && Array.isArray(p.busyTitleMarks), true)
    }
}

// 7) 회귀 방지의 핵심 — 합집합은 Claude 패턴을 **전부** 품어야 한다.
//    detect 를 프로필 없이 부르면 합집합이 쓰이고, 그게 0.5.0 판정과 같아야 하기 때문이다
{
    const claude = profileFor('claude')
    const u = unionProfile()
    const key = re => `${re.source} ${re.flags}`
    const uWaiting = u.waitingPatterns.map(key)
    const uBusy = u.busyPatterns.map(key)
    check('합집합 ⊇ claude 대기패턴',
        claude.waitingPatterns.every(re => uWaiting.includes(key(re))), true)
    check('합집합 ⊇ claude 작업중패턴',
        claude.busyPatterns.every(re => uBusy.includes(key(re))), true)
    check('합집합 ⊇ claude 제목스피너',
        claude.busyTitleMarks.every(m => u.busyTitleMarks.includes(m)), true)
    check('합집합 ⊇ claude 입력창 머리글자',
        claude.promptHeads.every(h => u.promptHeads.includes(h)), true)
    // 중복이 끼면 detect 가 같은 정규식을 두 번 돌린다 (결과는 같지만 낭비다)
    check('합집합 대기패턴 중복 없음', new Set(uWaiting).size, uWaiting.length)
    check('합집합 작업중패턴 중복 없음', new Set(uBusy).size, uBusy.length)
    check('합집합 스피너 중복 없음',
        new Set(u.busyTitleMarks).size, u.busyTitleMarks.length)
    // 이미지 키만은 합집합을 만들 수 없다 (키는 하나만 보낸다) — 예전처럼 설정값으로 떨어진다
    check('합집합 이미지 키는 설정값 폴백', u.imagePasteKey, 'config')
}

// 8) 실측된 이미지 붙여넣기 키 — 이게 바뀌면 이미지가 조용히 사라진다 (2026-08-28 실측)
{
    check('claude = ESC v', profileFor('claude').imagePasteKey, 'alt-v')
    check('codex = 0x16', profileFor('codex').imagePasteKey, 'ctrl-v')
    // gemini 는 관측이 없다 — 단정하지 않고 설정값으로 떨어뜨린다
    check('gemini = 근거 없음 -> 설정값', profileFor('gemini').imagePasteKey, 'config')
}

// 9) 판정 폴백 — **실측이 없는 프로필은 판정 패턴을 좁히지 않는다** (배리어 추가)
//
//    프로필을 붙이는 것만으로 판정이 그 프로필 안으로 좁아지면, 관측이 없는 에이전트에서는
//    개선이 아니라 퇴행이다 — 0.5.0 은 합집합 하나로 모든 탭을 판정했으므로 codex 가 실제로
//    `esc to interrupt` 를 찍고 있었다면 그때는 잡혔다. 그래서 `patternsProven` 이 false 인
//    프로필은 detect 에 넘길 때 그 세 필드만 합집합으로 갈아 준다.
{
    const u = unionProfile()
    const claudeD = detectProfileFor('claude')
    const codexD = detectProfileFor('codex')
    const geminiD = detectProfileFor('gemini')

    check('claude 는 실측이 있으니 자기 패턴 그대로',
        claudeD.busyPatterns === profileFor('claude').busyPatterns, true)
    check('codex 판정 대기패턴 = 합집합', codexD.waitingPatterns === u.waitingPatterns, true)
    check('codex 판정 작업중패턴 = 합집합', codexD.busyPatterns === u.busyPatterns, true)
    check('codex 판정 스피너 = 합집합', codexD.busyTitleMarks === u.busyTitleMarks, true)
    // gemini 는 2026-09-08 에 3국면을 실제로 채집했다 → 자기 패턴을 쓴다
    // (docs/AGENT-OBSERVATION.md 채집 표. 이 줄이 `=== union` 이던 시절의 기대는 실측 0건 전제였다)
    check('gemini 는 실측이 있으니 자기 패턴 그대로',
        geminiD.busyPatterns === profileFor('gemini').busyPatterns, true)
    check('gemini 판정이 `esc to cancel` 을 잡는다 (국면② 원문)',
        geminiD.busyPatterns.some(re => re.test(' \u2807 Thinking... (esc to cancel, 6s)')), true)
    check('gemini 판정이 승인 대화상자를 잡는다 (국면③ 원문)',
        geminiD.waitingPatterns.some(re => re.test('\u2502 Allow execution of [Shell]?')), true)
    check('gemini 판정이 선택지 줄도 잡는다 (국면③ 원문)',
        geminiD.waitingPatterns.some(re => re.test('\u2502 \u25cf 1. Allow once')), true)
    check('gemini 작업중 제목 마크 = 국면② 제목',
        geminiD.busyTitleMarks.some(m => '\u2726  Working\u2026 (work)'.includes(m)), true)
    // **유휴·대기 제목을 진행중으로 읽으면 안 된다** — 국면①은 `◇`, 국면③은 `✋` 였다
    check('gemini 유휴 제목(◇)은 진행중이 아니다',
        geminiD.busyTitleMarks.some(m => '\u25c7  Ready (work)'.includes(m)), false)
    check('gemini 대기 제목(✋)은 진행중이 아니다',
        geminiD.busyTitleMarks.some(m => '\u270b  Action Required (work)'.includes(m)), false)
    // 상시 상태줄에 걸리지 않아야 한다 — `no sandbox` 가 `yes/no` 후보로 잡히던 함정
    check('gemini 대기패턴이 상태줄에 안 걸린다',
        geminiD.waitingPatterns.some(re => re.test('~\\AppData\\Local\\work    no sandbox    Auto')), false)
    check('gemini 대기패턴이 유휴 입력창에 안 걸린다',
        geminiD.waitingPatterns.some(re => re.test('>   Type your message or @path/to/file')), false)
    // 0.5.0 이 잡던 것을 계속 잡는지 — 이게 이 갈래의 존재 이유다
    check('codex 판정이 esc to interrupt 를 잡는다',
        codexD.busyPatterns.some(re => re.test('esc to interrupt')), true)
    check('codex 판정이 Claude 스피너도 잡는다',
        codexD.busyTitleMarks.includes('\u25d0'), true)
    // 좁히지 않는 것은 화면 문구 셋뿐 — 실측된 값은 프로필 것을 그대로 쓴다
    check('codex 이미지 키는 프로필 것 유지', codexD.imagePasteKey, 'ctrl-v')
    check('codex 라벨 유지', codexD.id, 'codex')
    check('gemini 이미지 키는 설정값 유지', geminiD.imagePasteKey, 'config')
    // 모르는 아이디는 합집합 그대로 (재귀로 자기를 펼치지 않는다)
    check('unknown 은 합집합', detectProfileFor('unknown').busyPatterns === u.busyPatterns, true)
    check('합집합은 실측 표기가 켜져 있다', u.patternsProven, true)
}

// 10) 화면 모양 주입 — 프로필의 shape 가 실제로 판정을 바꾸는가 (cycle 3 배선)
//
//    `deck.service` 가 프로필의 shape 를 `extractPrompt`/`judgeScreen` 에 넘긴다. 그 배선이
//    말뿐인지 아닌지는 **순수 모듈을 실제로 태워 봐야** 알 수 있다 — 여기서 같이 검증한다.
{
    const { extractPrompt, DEFAULT_PROMPT_SHAPE } = require('../.tmp/prompt.js')
    const { judgeScreen, DEFAULT_SCREEN_SHAPE } = require('../.tmp/screen.js')

    // claude 는 shape 를 들고 있지 않다 — 기본값이 곧 claude 실측값이라 두 곳에 두지 않는다
    check('claude promptShape 없음 (기본값이 곧 claude 값)',
        profileFor('claude').promptShape, undefined)
    check('claude screenShape 없음', profileFor('claude').screenShape, undefined)
    // 그래서 claude 배선은 기본값 경로와 결과가 같아야 한다 (라벨 회귀의 핵심)
    const lines = ['────────────', '\u276f 결제 모듈 버그 확인해줘', '────────────']
    check('claude shape 로 읽어도 기본값과 같은 라벨',
        extractPrompt(lines, profileFor('claude').promptShape), extractPrompt(lines))
    check('그 라벨이 실제 문장이다',
        extractPrompt(lines, profileFor('claude').promptShape), '결제 모듈 버그 확인해줘')

    // 관측 없는 프로필은 shape 를 갖지 못한다 (짐작을 넣어도 detectProfileFor 가 막는다)
    check('codex 는 shape 없음', profileFor('codex').promptShape, undefined)
    // gemini 입력창 테두리는 반블록(▄/▀)이라 기본 테두리 문자로는 못 찾는다 — shape 를 준다
    check('gemini 는 shape 를 갖는다', typeof profileFor('gemini').screenShape, 'object')
    check('gemini shape 에 반블록이 들어 있다',
        (profileFor('gemini').promptShape.ruleChars || []).includes('\u2584'), true)
    check('gemini screenShape 에는 ASCII - 를 넣지 않는다 (코드의 ----- 오탐)',
        (profileFor('gemini').screenShape.ruleChars || []).includes('-'), false)
    // 실측이 켜졌으니 detectProfileFor 가 shape 를 떨어뜨리지 않아야 한다
    check('gemini shape 가 판정까지 전달된다',
        detectProfileFor('gemini').screenShape === profileFor('gemini').screenShape, true)
    // 그리고 그 shape 로 실제 gemini 입력창을 읽어낸다 (국면② 원문 3줄)
    check('gemini 입력창을 그 shape 로 읽는다',
        extractPrompt([
            '\u2584'.repeat(80),
            ' > ping -n 30 127.0.0.1 을 실행해줘',
            '\u2580'.repeat(80),
        ], profileFor('gemini').promptShape),
        'ping -n 30 127.0.0.1 을 실행해줘')
    // **기본 shape 로는 테두리를 못 알아본다.** 머리글자(`>`)는 기본값에 있어 문장 자체는
    // 읽히지만, 아래 반블록 줄이 테두리로 인식되지 않아 **그 줄까지 라벨에 섞여 들어온다**.
    // (첫 기대는 `''` 였는데 실측은 `… ▀▀▀▀…` 였다 — 주입구가 고치는 것이 바로 이 오염이다)
    {
        const geminiBox = [
            '\u2584'.repeat(80),
            ' > ping -n 30 127.0.0.1 을 실행해줘',
            '\u2580'.repeat(80),
        ]
        const withShape = extractPrompt(geminiBox, profileFor('gemini').promptShape)
        const withDefault = extractPrompt(geminiBox)
        check('기본 shape 결과에는 테두리가 섞인다', withDefault.includes('\u2580'), true)
        check('shape 를 주면 섞이지 않는다', withShape.includes('\u2580'), false)
        check('그래서 두 결과가 다르다', withShape === withDefault, false)
    }
    const faked = { ...profileFor('codex'), promptShape: { heads: ['$'] }, screenShape: { heads: ['$'] } }
    check('patternsProven=false 면 shape 를 떨어뜨린다',
        detectProfileFor('codex').promptShape, undefined)
    check('짐작으로 채워도 판정에는 안 쓰인다 (faked 는 원본이 아니므로 참고용)',
        faked.patternsProven, false)

    // **주입구가 진짜로 동작하는지** — 머리글자가 `$` 인 가상의 TUI
    const dollar = ['============', '$ 다른 에이전트의 프롬프트', '============']
    check('기본 shape 로는 `$` 머리를 못 읽는다', extractPrompt(dollar), '')
    check('shape 를 주면 읽는다',
        extractPrompt(dollar, { heads: ['$'], ruleChars: ['='] }), '다른 에이전트의 프롬프트')
    // 화면 판정도 같은 방식으로 주입된다
    const rule = '='.repeat(20)
    const broken = [
        { text: rule, wrapped: false },
        { text: rule, wrapped: false },
    ]
    check('shape 를 주면 `=` 테두리도 판정 대상',
        judgeScreen(broken, 20, { ruleChars: ['='], heads: ['$'] }).broken, true)
    check('기본 shape 로는 `=` 를 테두리로 보지 않는다',
        judgeScreen(broken, 20).broken, false)
    // 기본값 자체가 바뀌면 claude 라벨이 죽는다 — 값으로 못 박는다
    check('기본 머리글자에 U+276F 가 있다', DEFAULT_PROMPT_SHAPE.heads.includes('\u276f'), true)
    check('기본 테두리에 U+2500 이 있다', DEFAULT_SCREEN_SHAPE.ruleChars.includes('\u2500'), true)
}

// 11) 사용량 한도 화면 문구 (`limitedPatterns`) — 0.9.0 까지 이 필드가 없었고, `limited` 는
//     훅(claudeHooks StopFailure)으로만 왔다. 그래서 훅이 없는 CLI 는 한도에 걸려도 배지가
//     running/error 로 남았다. 여기서 못 박는 것은 두 가지다:
//       ① 실측된 문구가 실제 원문에 걸리는가 ② 상시 화면(상태줄·힌트·다른 오류)에 안 걸리는가
{
    const u = unionProfile()
    const key = re => `${re.source} ${re.flags}`
    // 2026-09-08 Codex CLI 실측 원문 (docs/AGENT-OBSERVATION.md Codex 표, 국면① 시도 중 벽②)
    const CODEX_LIMIT = '■ Usage limit reached. You\'ve reached your usage limit.'
        + ' Increase your limits to continue using codex.'

    check('codex 한도 문구가 실측 원문을 잡는다',
        profileFor('codex').limitedPatterns.some(re => re.test(CODEX_LIMIT)), true)
    // 미관측은 비어 있어야 한다 — 관측되면 이 줄을 같이 고친다 (그게 이 파일의 규칙이다)
    check('claude 한도는 훅 경로 — 화면 문구 미관측',
        profileFor('claude').limitedPatterns.length, 0)
    check('gemini 한도 문구 미관측 (3국면에 한도 국면이 없었다)',
        profileFor('gemini').limitedPatterns.length, 0)

    // **patternsProven 규칙과 모순이 없는 근거** — codex 는 여전히 false 인데(대기·작업중 미관측)
    // 합집합이 그 프로필의 실측 한도 문구를 품으므로, 판정용 프로필로 갈아도 문구가 살아 있다
    check('codex 는 여전히 patternsProven=false', profileFor('codex').patternsProven, false)
    check('합집합 ⊇ codex 한도 문구',
        u.limitedPatterns.some(re => re.test(CODEX_LIMIT)), true)
    check('codex 판정 한도 문구 = 합집합',
        detectProfileFor('codex').limitedPatterns === u.limitedPatterns, true)
    check('codex 판정도 실측 원문을 잡는다',
        detectProfileFor('codex').limitedPatterns.some(re => re.test(CODEX_LIMIT)), true)
    // 실측이 켜진 프로필은 자기 것을 쓴다 — gemini 는 그래서 화면으로 한도 판정을 하지 않는다
    check('gemini 판정 한도 문구 = 자기 것(빈 배열)',
        detectProfileFor('gemini').limitedPatterns === profileFor('gemini').limitedPatterns, true)
    check('합집합 한도 문구 중복 없음',
        new Set(u.limitedPatterns.map(key)).size, u.limitedPatterns.length)

    // 오탐 방어 — 상시 화면이 한도로 잡히면 그 탭은 ⛔ 에 박히고 알림까지 울린다
    // (alert.service 의 ALERT_STATUSES 에 limited 가 있다)
    const noLimit = (name, line) =>
        check(name, u.limitedPatterns.some(re => re.test(line)), false)
    noLimit('힌트 줄은 한도가 아니다 (세 국면 전부에 있다)', '? for shortcuts')
    noLimit('상태줄은 한도가 아니다 (`no sandbox` 오탐 선례)',
        '~\\AppData\\Local\\work    no sandbox    Auto')
    noLimit('모델/경로 상태줄도 아니다', 'gpt-6-astra low fast · ~\\AppData\\Local\\work')
    noLimit('모델 거부 오류는 한도가 아니다 (2026-09-08 벽① 원문)',
        '■ {"type":"error","status":400,"message":"The \'gpt-5.4\' model is not supported'
        + ' when using Codex with a ChatGPT account."}')
    noLimit('청크 뒷토막(안내 문구)만으로는 판정하지 않는다',
        'Increase your limits to continue using codex.')

    // 한도 문구가 대기로 잡히면 탭이 영구 승인대기로 박힌다 (대기 오탐이 가장 비싸다)
    check('한도 문구는 대기가 아니다',
        u.waitingPatterns.some(re => re.test(CODEX_LIMIT)), false)
    check('한도 문구는 작업중도 아니다',
        u.busyPatterns.some(re => re.test(CODEX_LIMIT)), false)
}

// 6) 사이드바 표식 — 줄만 보고 어느 에이전트인지 갈리는가 (2026-09-14)
//
// 지키는 것은 셋이다. ① 지원하는 에이전트는 **전부** 표식을 갖는다 (새 CLI 를 추가하면서
// icon 만 빠뜨리면 그 줄만 조용히 맨몸이 된다). ② 표식이 **서로 다르다** — 같은 SVG 를
// 복붙해 색만 바꾸면 12px 에서 형태가 같아 구분이 색에만 걸린다. ③ 합집합은 표식이 없다
// (어느 에이전트인지 모르면서 셋 중 하나를 그리면 그게 오독의 원천이다).
{
    for (const p of AGENT_PROFILES) {
        check(`${p.id} 표식 있음`, typeof p.icon === 'string' && p.icon.startsWith('<svg'), true)
    }
    check('표식이 서로 다르다',
        new Set(AGENT_PROFILES.map(p => p.icon)).size, AGENT_PROFILES.length)
    check('합집합은 표식 없음', UNKNOWN_PROFILE.icon, '')
    // 판정용으로 좁혀도 표식은 프로필 것을 유지한다 — detectProfileFor 가 갈아 끼우는 것은
    // 화면 문구뿐이다. 여기가 깨지면 codex/gemini 줄에서 표식이 사라진다
    for (const p of AGENT_PROFILES) {
        check(`${p.id} 판정 프로필도 표식 유지`, detectProfileFor(p.id).icon, p.icon)
    }
    // 표식 안에는 런타임 값이 섞일 자리가 없어야 한다 — 읽는 쪽(deck.service `decorateAgent`)이
    // innerHTML 로 넣는 근거가 "상수뿐" 이라는 것 하나다
    for (const p of AGENT_PROFILES) {
        check(`${p.id} 표식에 스크립트 없음`, /<script|javascript:|on[a-z]+=/i.test(p.icon), false)
    }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
