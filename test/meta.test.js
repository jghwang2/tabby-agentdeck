// 사이드바 하단 "지금 이 탭" 줄의 문구 규칙 — `npm test`
//
// 값은 전부 실측이다. statusLine stdin 원문은 2026-09-14 에 이 저장소에서 돌던 세션의
// `.tw-statusline-cache.json`(= Claude Code 가 statusLine 에 넘긴 JSON 그대로)에서 떴다:
//   model.display_name="Opus 5" / effort.level="high" / context_window.used_percentage=13
//   rate_limits.five_hour.used_percentage=91 / seven_day.used_percentage=15
const { formatMeta, formatReset, formatResetLine } = require('../.tmp/meta.js')

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

const NOW = 1789355000000
/** 실측 스냅샷 (위 주석 참조) */
const LIVE = {
    agent: 'claude',
    model: 'Opus 5',
    modelId: 'claude-opus-5',
    effort: 'high',
    version: '2.1.270',
    fastMode: false,
    account: 'someone@example.com',
    org: 'example-org',
    cwd: 'D:\\Project\\tabby-agentdeck',
    contextPct: 13,
    limits: { fiveHourPct: 91, fiveHourResetsAt: 1789372800, sevenDayPct: 15, sevenDayResetsAt: 1789830000 },
}

// ---- 제목 ----
check('제목 — 에이전트 · 모델 · effort', formatMeta(LIVE, NOW).title, 'Claude · Opus 5 · high')
check('제목 — effort 가 없으면 그 칸을 비우지 않고 뺀다',
    formatMeta({ ...LIVE, effort: '' }, NOW).title, 'Claude · Opus 5')
check('제목 — fast mode 는 표식을 붙인다',
    formatMeta({ ...LIVE, fastMode: true }, NOW).title, 'Claude · Opus 5 · high ⚡')
check('제목 — display_name 이 없으면 모델 id 로 떨어진다',
    formatMeta({ ...LIVE, model: '' }, NOW).title, 'Claude · claude-opus-5 · high')

// ---- 값이 없을 때: 지어내지 않는다 ----
check('모델을 모르면 줄 자체를 안 그린다 (null)',
    formatMeta({ ...LIVE, model: '', modelId: '' }, NOW), null)
check('보고가 없으면 null', formatMeta(null, NOW), null)

// ---- 게이지 ----
check('게이지 3종 — ctx · 5h · 7d',
    formatMeta(LIVE, NOW).gauges.map(g => g.text), ['ctx 13%', '5h 91%', '7d 15%'])
check('게이지 색 — 85%+ hot / 60%+ warn / 나머지 ok',
    formatMeta(LIVE, NOW).gauges.map(g => g.level), ['ok', 'hot', 'ok'])
check('경계 — 60 은 warn, 59 는 ok',
    formatMeta({ ...LIVE, contextPct: 60, limits: { ...LIVE.limits, fiveHourPct: 59 } }, NOW)
        .gauges.map(g => g.level), ['warn', 'ok', 'ok'])
// 0% 를 `!n` 으로 거르면 한도를 하나도 안 쓴 주가 "모른다" 로 보인다 — 실제로 흔한 화면이다
check('0% 는 값이다 (칸이 사라지지 않는다)',
    formatMeta({ ...LIVE, limits: { ...LIVE.limits, sevenDayPct: 0 } }, NOW)
        .gauges.map(g => g.text), ['ctx 13%', '5h 91%', '7d 0%'])
check('모르는 값(null)은 칸을 만들지 않는다',
    formatMeta({ ...LIVE, contextPct: null, limits: { fiveHourPct: 91, fiveHourResetsAt: 0 } }, NOW)
        .gauges.map(g => g.key), ['5h'])
check('한도 블록이 통째로 없어도 죽지 않는다',
    formatMeta({ agent: 'claude', model: 'Opus 5' }, NOW).gauges, [])

// ---- 리셋까지 남은 시간 ----
// resets_at 은 **초** 단위 epoch 다 (statusLine stdin 실측). ms 로 읽으면 전부 "곧 리셋" 이 된다
check('리셋 — 5시간 남음',
    formatReset(NOW / 1000 + 5 * 3600, NOW), '5시간 뒤 리셋')
check('리셋 — 1시간 30분 남음',
    formatReset(NOW / 1000 + 5400, NOW), '1시간 30분 뒤 리셋')
check('리셋 — 40분 남음', formatReset(NOW / 1000 + 2400, NOW), '40분 뒤 리셋')
check('리셋 — 지났으면 곧', formatReset(NOW / 1000 - 10, NOW), '곧 리셋')
check('리셋 — 값이 없으면 빈 문자열', formatReset(0, NOW), '')
check('실측 5h resets_at 을 그대로 넣으면 5시간 안쪽',
    formatMeta(LIVE, NOW).gauges[1].resetText, '4시간 57분 뒤 리셋')

// ---- 막대 아래 줄에 찍는 리셋 ----
// 마우스를 올려야만 보이던 것을 화면에 얹었다 (2026-09-14 유저 지시 — 막대 뒤가 아니라 아랫줄).
// `리셋` 만 뗀 것이라 **tooltip 과 값이 어긋날 수 없다** — 위 resetText 검사와 한 쌍이다.
check('아랫줄 리셋 — 1시간 30분 (분까지 그대로)', formatResetLine(NOW / 1000 + 5400, NOW), '1시간 30분 뒤')
check('아랫줄 리셋 — 40분', formatResetLine(NOW / 1000 + 2400, NOW), '40분 뒤')
check('아랫줄 리셋 — 하루 넘으면 일+시간', formatResetLine(NOW / 1000 + 50 * 3600, NOW), '2일 2시간 뒤')
check('아랫줄 리셋 — 지났으면 곧', formatResetLine(NOW / 1000 - 10, NOW), '곧')
check('아랫줄 리셋 — 값이 없으면 빈 문자열 (ctx 처럼 리셋이 없는 칸)', formatResetLine(0, NOW), '')
check('ctx 칸은 아랫줄 리셋이 비어 있다', formatMeta(LIVE, NOW).gauges[0].resetLine, '')
// 같은 시각에 풀리는 칸들이 한 줄을 같이 쓰려면 **문자열이 같아야** 한다 (deck.service renderNow)
check('7d 와 모델 주간 한도는 리셋 문자열이 같다',
    (g => g[2].resetLine === g[3].resetLine && !!g[2].resetLine)(
        formatMeta({ ...LIVE, limits: { ...LIVE.limits, sevenDayResetsAt: 1789830000,
            scopedName: 'Fable', scopedPct: 0, scopedResetsAt: 1789830000 } }, NOW).gauges), true)

// ---- 모델별 주간 한도 (Fable 등) ----
// statusLine stdin 에 없는 값이라 래퍼가 `/api/oauth/usage` 에서 따로 떠 온다
// (hooks/agentdeck-statusline.mjs). 이름이 계정마다 다르므로 **이름도 같이** 받는다.
check('scopedName 이 있으면 넷째 칸이 생긴다',
    formatMeta({ ...LIVE, limits: { ...LIVE.limits, scopedName: 'Fable', scopedPct: 7, scopedResetsAt: 0 } }, NOW)
        .gauges.map(g => g.key), ['ctx', '5h', '7d', 'fable'])
check('이름이 없으면 % 가 와도 칸을 만들지 않는다',
    formatMeta({ ...LIVE, limits: { ...LIVE.limits, scopedPct: 7 } }, NOW)
        .gauges.length, 3)
check('이름만 있고 % 를 못 받았으면 칸을 만들지 않는다 (0% 와 갈라야 한다)',
    formatMeta({ ...LIVE, limits: { ...LIVE.limits, scopedName: 'Fable', scopedPct: null } }, NOW)
        .gauges.length, 3)
check('0% 도 칸이 생긴다 (한 번도 안 쓴 주)',
    formatMeta({ ...LIVE, limits: { ...LIVE.limits, scopedName: 'Fable', scopedPct: 0 } }, NOW)
        .gauges[3].text, 'fable 0%')

// ---- 계정 · 툴팁 ----
check('계정 줄', formatMeta(LIVE, NOW).account, 'someone@example.com')
check('계정이 없으면 빈 문자열 (부르는 쪽이 줄을 접는다)',
    formatMeta({ ...LIVE, account: '' }, NOW).account, '')
check('툴팁에 계정·조직·버전·폴더가 다 들어간다',
    formatMeta(LIVE, NOW).tooltip.split('\n').slice(0, 4),
    ['Claude · Opus 5 · high', '계정: someone@example.com (example-org)', '버전: 2.1.270',
        '폴더: D:\\Project\\tabby-agentdeck'])

// ---- 다른 에이전트 ----
check('codex 도 같은 규칙',
    formatMeta({ agent: 'codex', model: 'gpt-6-astra', effort: 'low' }, NOW).title,
    'Codex · gpt-6-astra · low')
check('모르는 에이전트면 이름만 뺀다',
    formatMeta({ agent: 'whoknows', model: 'X' }, NOW).title, 'X')

console.log(`\nmeta: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
