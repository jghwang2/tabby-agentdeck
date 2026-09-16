// 승인대기 이유 줄이기 — 훅이 보낸 Notification 문구가 배지에 붙을 짧은 한국어로 바뀌는지.
// 문구를 잘못 잡으면 6개 세션 중 어느 것을 먼저 승인할지 사이드바만 보고 정할 수 없다.
const { shortenReason, reasonFromScreen } = require('../.tmp/reason.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name}`)
        pass++
    } else {
        console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
        fail++
    }
}

// 도구 승인 — 도구 이름만 남는다
check('Bash 권한', shortenReason('Claude needs your permission to use Bash'), 'Bash 권한')
check('Edit 권한', shortenReason('Claude needs your permission to use Edit'), 'Edit 권한')
check('대소문자 무관', shortenReason('claude needs your PERMISSION TO USE Write'), 'Write 권한')
check('MCP 도구 이름도 통째로', shortenReason('Claude needs your permission to use mcp__my-server__FindSymbols'), 'mcp__my-server__FindSymbols 권한')

// 입력 대기
check('입력 대기', shortenReason('Claude is waiting for your input'), '입력 대기')

// 플랜 / 질문
check('플랜 승인', shortenReason('Claude wants to proceed with the plan'), '플랜 승인')
check('질문 응답 (question)', shortenReason('Claude has a question for you'), '질문 응답')
check('질문 응답 (answer)', shortenReason('Please answer to continue'), '질문 응답')

// 한도 도달 — StopFailure(rate_limit) 의 last_assistant_message. 리셋 시각만 남긴다
check('세션 한도 (·)', shortenReason("You've hit your session limit · resets 12pm (Asia/Seoul)"), '12pm 리셋')
check('주간 한도 (요일 포함)', shortenReason("You've reached your weekly limit · resets Monday 9am"), 'Monday 9am 리셋')
check('옛 문구 (reset at ... .)', shortenReason('Claude usage limit reached. Your limit will reset at 7pm (Asia/Seoul).'), '7pm 리셋')
check('리셋 시각 없으면 빈 값 (배지가 이미 한도 도달)', shortenReason('5-hour limit reached'), '')
check('한도 문구가 도구 권한으로 오인되지 않는다', shortenReason('Claude needs your permission to use RateLimit'), 'RateLimit 권한')

// 모르는 문구 — 앞 24자
check('모르는 문구는 24자', shortenReason('Something completely different happened here today'), 'Something completely dif')
check('짧은 문구는 그대로', shortenReason('Hello there'), 'Hello there')
check('공백 정리', shortenReason('  Hello   there  '), 'Hello there')

// 빈 값
check('빈 문자열은 빈 값', shortenReason(''), '')
check('undefined 도 빈 값', shortenReason(undefined), '')

// ---------- 화면에서 온 이유 (reasonFromScreen) ----------
// 훅이 없는 CLI 는 이유가 화면에만 있다. 원문은 docs/AGENT-OBSERVATION.md 채집 표.

// Gemini CLI 승인 대화상자 — 2026-09-08 국면③ 원문 (`gemini-3-waiting.json`)
check('gemini 도구 승인', shortenReason('Allow execution of [Shell]?'), 'Shell 권한')
check('테두리가 붙은 원문 그대로',
    reasonFromScreen('│ Allow execution of [Shell]?                    │'), 'Shell 권한')
check('대괄호 없는 형태도', shortenReason('Allow execution of WriteFile?'), 'WriteFile 권한')

// 선택지 줄은 이유가 아니다 — 커서만 움직인 재그리기 조각에 이 줄만 담겨 오는 일이 있다.
// 빈 값이어야 detect 가 앞서 잡은 이유("Shell 권한")를 지우지 않는다
check('선택지 줄(gemini 국면③ 원문)', reasonFromScreen('│ ● 1. Allow once   │'), '')
check('선택지 줄(claude)', reasonFromScreen('❯ 1. Yes'), '')
check('선택지 줄(번호만)', reasonFromScreen('  2. Allow always'), '')

// Codex CLI 한도 도달 — 2026-09-08 실측 원문. 리셋 시각이 원문에 없으니 빈 값이고,
// 배지는 `⛔ 한도 도달` 만 보여준다 (같은 말을 되풀이하지 않는다)
check('codex 한도 원문',
    reasonFromScreen('■ Usage limit reached. You\'ve reached your usage limit.'
        + ' Increase your limits to continue using codex.'), '')

// ANSI 제어열은 벗긴다 — TUI 한 줄에는 색·커서 이동이 여러 개 섞여 있다
check('CSI 제거',
    reasonFromScreen('\u001b[1m\u001b[38;5;12mClaude needs your permission to use Bash\u001b[0m'),
    'Bash 권한')
check('OSC 제거',
    reasonFromScreen('\u001b]0;title\u0007Allow execution of [Shell]?'), 'Shell 권한')
check('종결자 없이 걸쳐 온 ESC 도 글자로 새지 않는다',
    reasonFromScreen('\u001b Allow execution of [Shell]?'), 'Shell 권한')

// 모르는 화면 줄도 배지 한 줄을 넘기지 않는다 (테두리를 벗긴 뒤 24자)
check('모르는 화면 줄은 24자',
    reasonFromScreen('│ Something completely different happened here │'),
    'Something completely dif')
// 반블록 테두리(gemini 입력창)도 글자가 아니다
check('반블록 테두리는 지운다', reasonFromScreen('▄'.repeat(20)), '')
check('빈 줄', reasonFromScreen(''), '')
check('undefined 도 빈 값', reasonFromScreen(undefined), '')

console.log(`\nreason: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
