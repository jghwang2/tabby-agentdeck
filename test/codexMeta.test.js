// Codex 세션 기록에서 모델·effort·컨텍스트·한도를 뽑는 규칙 — `npm test`
//
// 줄 모양은 전부 실측이다 (2026-09-14, `~/.codex/sessions/…/rollout-*.jsonl`):
//   turn_context            model="gpt-6-astra" effort="low"
//   session_meta            context_window · cwd · cli_version
//   event_msg/token_count   rate_limits.primary{used_percent:50, window_minutes:300, resets_at}
//                           rate_limits.secondary{used_percent:24, window_minutes:10080, resets_at}
//                           info.last_token_usage.total_tokens
const { createCodexState, feedCodexLine, feedCodexChunk, codexContextPct, codexLimits, emailFromIdToken } =
    require('../.tmp/codexMeta.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    if (g === w) {
        console.log(`  ok   ${name}`)
        pass++
    } else {
        console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`)
        fail++
    }
}

const meta = JSON.stringify({
    type: 'session_meta',
    payload: { session_id: 's1', cwd: 'D:\\Project\\demo\\app', cli_version: '0.154.0', context_window: 400000 },
})
const turn = (model, effort) => JSON.stringify({ type: 'turn_context', payload: { model, effort, cwd: 'D:\\Project\\demo\\app' } })
const tokens = (primary, secondary, used) => JSON.stringify({
    type: 'event_msg',
    payload: {
        type: 'token_count',
        rate_limits: { limit_id: 'codex', primary, secondary, plan_type: 'team' },
        info: used === undefined ? null : { last_token_usage: { total_tokens: used } },
    },
})
const W5H = { used_percent: 50.0, window_minutes: 300, resets_at: 1783686414 }
const W7D = { used_percent: 24.0, window_minutes: 10080, resets_at: 1784249737 }

// ---- 기본 ----
const s = createCodexState()
feedCodexChunk(s, [meta, turn('gpt-6-astra', 'low'), tokens(W5H, W7D, 40000)].join('\n') + '\n')
check('모델·effort', [s.model, s.effort], ['gpt-6-astra', 'low'])
check('cli 버전·cwd', [s.cliVersion, s.cwd], ['0.154.0', 'D:\\Project\\demo\\app'])
check('한도 두 칸이 5h/7d 자리로', codexLimits(s),
    { fiveHourPct: 50, fiveHourResetsAt: 1783686414, sevenDayPct: 24, sevenDayResetsAt: 1784249737 })
check('컨텍스트% = 마지막 요청 토큰 / 창 크기', codexContextPct(s), 10)

// ---- 마지막 값이 이긴다 (턴마다 새로 나온다) ----
feedCodexLine(s, turn('gpt-6-astra-mini', 'high'))
check('모델이 바뀌면 따라간다', [s.model, s.effort], ['gpt-6-astra-mini', 'high'])
feedCodexLine(s, tokens({ used_percent: 61, window_minutes: 300, resets_at: 9 }, W7D, 80000))
check('한도도 최신 값', codexLimits(s).fiveHourPct, 61)
check('컨텍스트%도 최신 값', codexContextPct(s), 20)

// ---- 비어 오는 값이 직전 사실을 지우지 않는다 (실측: primary:null 인 token_count 가 온다) ----
feedCodexLine(s, tokens(null, null, undefined))
check('빈 한도는 직전 값을 안 지운다', [codexLimits(s).fiveHourPct, codexLimits(s).sevenDayPct], [61, 24])
feedCodexLine(s, turn('gpt-6-astra-mini', null))
check('effort 가 null 이면 직전 값 유지', s.effort, 'high')

// ---- 모르면 null (지어내지 않는다) ----
const bare = createCodexState()
feedCodexChunk(bare, turn('gpt-6-astra', 'low') + '\n')
check('창 크기를 모르면 컨텍스트% 는 null', codexContextPct(bare), null)
check('한도 보고가 없으면 두 칸 다 null',
    [codexLimits(bare).fiveHourPct, codexLimits(bare).sevenDayPct], [null, null])
// 창 길이가 5h·7d 가 아니면 그 자리에 넣지 않는다 — 다른 길이의 값을 그리면 화면이 거짓말을 한다
const odd = createCodexState()
feedCodexLine(odd, tokens({ used_percent: 90, window_minutes: 60, resets_at: 5 }, null, 1))
check('낯선 창 길이(60분)는 5h 자리에 안 들어간다', codexLimits(odd).fiveHourPct, null)

// ---- cli 0.154.0: 창 크기가 옮겨 갔다 (2026-09-14 실측) ----
//
// `session_meta.context_window` 가 숫자에서 `{window_id: "…"}` 객체로 바뀌고, 진짜 토큰 수는
// `token_count.info.model_context_window` 로 갔다. 옛 코드는 객체를 숫자로 읽다 0 이 되어
// **컨텍스트% 칸이 통째로 사라졌다** (화면에 `7d 16%` 만 남았다). 두 자리 다 읽어야 한다.
const astra = createCodexState()
feedCodexLine(astra, JSON.stringify({
    type: 'session_meta',
    payload: { session_id: 'a1', cwd: 'D:\\Project', cli_version: '0.154.0',
        context_window: { window_id: '01a09f5e-feac-7b42-b31c-31ab31a1e73b' } },
}))
check('객체로 온 context_window 는 창 크기가 아니다 (0 그대로)', astra.contextWindow, 0)
feedCodexLine(astra, JSON.stringify({
    payload: {
        type: 'token_count',
        info: { last_token_usage: { total_tokens: 94025 }, model_context_window: 258400 },
        rate_limits: { primary: { used_percent: 16, window_minutes: 10080, resets_at: 1789897376 },
            secondary: null },
    },
}))
check('model_context_window 를 창 크기로 읽는다', astra.contextWindow, 258400)
check('컨텍스트% 가 살아난다 (94025/258400)', codexContextPct(astra), 36)
// 이 계정(prolite)은 5시간 창 자체가 없다 — primary 가 7일이고 secondary 는 null 이다.
// `5h` 가 비는 것은 결함이 아니라 **없는 값을 안 그리는 것**이다
check('primary 가 7일이면 7d 자리에 들어간다', codexLimits(astra).sevenDayPct, 16)
check('5시간 창이 없으면 5h 는 null (빈 자리를 지어내지 않는다)', codexLimits(astra).fiveHourPct, null)
// 옛 버전 호환 — `model_context_window` 가 없는 token_count 가 창 크기를 지우면 안 된다
feedCodexLine(astra, JSON.stringify({
    payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 129200 } } },
}))
check('키가 없는 token_count 는 창 크기를 안 지운다', astra.contextWindow, 258400)
check('그 뒤 컨텍스트% 도 계속 나온다 (129200/258400)', codexContextPct(astra), 50)

// ---- 증분 읽기의 반쪽 줄 ----
//
// 서비스는 2초마다 `size - lastSize` 만큼 읽는데 Codex 는 그동안에도 쓰고 있어, 읽은 청크의
// **마지막 줄은 대개 미완성**이다. 예전에는 그걸 그냥 버렸는데(`skipped++`) `lastSize` 는 이미
// 전진해 있어 **나머지 절반도 다음 판에서 버려졌다** — 턴 끝의 마지막 `token_count`(한도·
// 컨텍스트%)가 통째로 유실돼 값이 옛 상태로 굳었다 (2026-09-15 코드리뷰).
// 지금은 꼬리를 들고 있다가 다음 청크 앞에 이어 붙인다.
const part = createCodexState()
const whole = turn('gpt-6-astra', 'low')
const cut = Math.floor(whole.length / 2)
feedCodexChunk(part, whole.slice(0, cut))
check('반쪽 줄은 버리지 않고 들고 있는다', [part.model, part.skipped, part.pending.length], ['', 0, cut])
feedCodexChunk(part, whole.slice(cut) + '\n')
check('이어 붙인 줄이 정상 반영된다', [part.model, part.skipped, part.pending], ['gpt-6-astra', 0, ''])

// 진짜 깨진 줄(개행까지 온 것)은 여전히 버리고 센다
const broken = createCodexState()
feedCodexChunk(broken, '{"type":"turn_context","payl\n')
check('개행까지 온 깨진 줄은 버리고 센다', [broken.model, broken.skipped], ['', 1])

// 개행이 영영 안 오면 꼬리를 무한히 쌓지 않는다 (MAX_PENDING = 2MB)
const flood = createCodexState()
feedCodexChunk(flood, 'x'.repeat(3 * 1024 * 1024))
check('상한을 넘긴 꼬리는 버린다', [flood.pending.length, flood.dropped], [0, 1])

// ---- 계정 (JWT 가운데 조각) ----
const jwt = 'aaa.' + Buffer.from(JSON.stringify({ email: 'someone@example.com' })).toString('base64url') + '.bbb'
check('id_token 에서 메일', emailFromIdToken(jwt), 'someone@example.com')
check('깨진 토큰은 빈 문자열', emailFromIdToken('not-a-jwt'), '')
check('없으면 빈 문자열', emailFromIdToken(null), '')

console.log(`\ncodexMeta: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
