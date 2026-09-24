// 상태 자동 감지 — "진행중" 에서 제때 내려오는지가 핵심이다.
// Claude Code 는 놀고 있을 때도 하단 상태줄을 매초 다시 그리므로, 출력이 있다는 사실만으로
// 진행중을 유지하면 영원히 안 내려온다 (2026-09-01 실측: 세 탭 모두 진행중에 박혀 있었다).
const { applyOutput, applyTitle, forgetOutputBuffer, releaseLimited } = require('../.tmp/detect.js')

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

/**
 * WorkStatusService 의 최소 대역 — applyOutput 이 쓰는 것만 흉내낸다.
 *
 * `reason`(상태의 부연)은 진짜 서비스의 규약을 그대로 흉내낸다: 부연을 가질 수 있는 상태는
 * waiting·limited·error 뿐이고(status.service `REASON_STATUSES`) 나머지로 바뀌면 비워진다.
 * 그 규약을 여기서 대충 만들면 "이유가 언제 지워지는가" 를 이 파일로 검증할 수 없다
 */
const REASON_STATUSES = ['waiting', 'limited', 'error']
function makeStatus () {
    const s = {
        status: 'idle', pinned: false, label: '', reason: '',
        lastOutput: 0, busyMode: false, lastBusy: 0,
    }
    const clearReason = () => {
        if (!REASON_STATUSES.includes(s.status)) { s.reason = '' }
    }
    return {
        state: s,
        debug: { outputs: 0, oscHits: 0, titleHits: 0 },
        markOutput () { s.lastOutput = Date.now() },
        markBusy () { s.busyMode = true; s.lastBusy = Date.now() },
        isBusyMode () { return s.busyMode },
        setAuto (_tab, status) {
            if (s.pinned || s.status === status) { return }
            s.status = status
            clearReason()
        },
        setManual (_tab, status, label, reason) {
            s.status = status
            s.pinned = true
            if (label !== undefined) { s.label = label }
            s.reason = REASON_STATUSES.includes(status) ? (reason ?? '') : ''
        },
        get () { return s },
        resume () { if (s.status === 'waiting') { s.status = 'running'; s.reason = '' } },
    }
}

// 잔여 버퍼(tails)가 owner 단위로 유지되므로 케이스마다 새 owner 를 쓴다
let seq = 0
function newTab () { return { id: ++seq } }
const TAB = newTab()

// 0) 훅이 승인대기로 고정한 탭 — 사람이 승인하면 화면에 작업 중 문구가 돌아온다 → 진행중으로 올라와야 한다.
//    훅만으로는 못 잡는 구간이다: 승인 뒤 첫 훅(PostToolUse)은 도구가 끝난 뒤라 긴 빌드 동안 승인대기에 박힌다
//    (2026-09-07 실측). pinned 는 유지된다 (훅 지정을 자동 감지가 덮는 건 아니다)
{
    const st = makeStatus()
    const tab = newTab()
    st.setManual(tab, 'waiting')
    applyOutput(st, tab, tab, '  Claude Code 하단 상태줄만 다시 그림  ', true)
    check('승인대기 중 평시 출력은 그대로', st.state.status, 'waiting')
    applyOutput(st, tab, tab, '✳ Sautéing… (esc to interrupt · ↓ 20.1k tokens)', true)
    check('승인 뒤 작업 중 문구 -> running (pinned 여도)', st.state.status, 'running')
    check('pinned 유지', st.state.pinned, true)
    check('에이전트 탭으로 기억', st.state.busyMode, true)
    // 승인대기가 아닌 고정 상태(done)는 작업 중 문구가 보여도 건드리지 않는다 — 훅 우선
    const st2 = makeStatus()
    const tab2 = newTab()
    st2.setManual(tab2, 'done')
    applyOutput(st2, tab2, tab2, '✳ Thinking… (esc to interrupt)', true)
    check('done 고정은 작업 중 문구로 안 바뀐다', st2.state.status, 'done')
    // autoDetect 가 꺼져 있으면 이 승격도 하지 않는다 — 화면 추측은 전부 그 스위치 아래다
    const st3 = makeStatus()
    const tab3 = newTab()
    st3.setManual(tab3, 'waiting')
    applyOutput(st3, tab3, tab3, '✳ Thinking… (esc to interrupt)', false)
    check('autoDetect 꺼짐이면 승격 없음', st3.state.status, 'waiting')
}

// 1) 작업 중 표시가 있으면 진행중 + 그 탭을 에이전트로 기억한다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '✳ Thinking… (esc to interrupt)', true)
    check('작업 중 문구 -> running', st.state.status, 'running')
    check('작업 중 문구 -> busyMode 기억', st.state.busyMode, true)
}

// 2) 에이전트 탭에서 상태줄만 갱신되는 출력은 진행중의 근거가 아니다 (이번 버그의 핵심)
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '✳ Compacting… (esc to interrupt)', true)
    st.state.status = 'idle'
    applyOutput(st, tab, tab, '⏱1s  컨텍스트 사용량: 0%  현재 모델: Opus 5', true)
    check('에이전트 탭의 상태줄 갱신 -> 상태 유지', st.state.status, 'idle')
}

// 3) 스피너 문자만 있어도 작업 중으로 본다 (문구 없이 스피너만 바뀌는 프레임)
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '◐ 작업 중', true)
    check('스피너 문자 -> running', st.state.status, 'running')
}

// 4) 보통 셸은 예전대로 — 출력이 있으면 진행중
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, 'Compiling module 3/40...', true)
    check('보통 셸 출력 -> running', st.state.status, 'running')
    check('보통 셸 -> busyMode 아님', st.state.busyMode, false)
}

// 5) 승인 대기 패턴이 작업 중 표시보다 우선한다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, 'Do you want to proceed? (esc to interrupt)', true)
    check('승인 대기 -> waiting', st.state.status, 'waiting')
}

// 6) 훅이 보낸 OSC 는 모든 자동 판정을 이긴다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '\x1b]1337;AgentDeck=done;배포 완료\x07', true)
    check('OSC 통보 -> done', st.state.status, 'done')
    check('OSC 라벨', st.state.label, '배포 완료')
}

// 7) 자동 감지를 끄면 출력으로 상태를 바꾸지 않는다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '✳ Thinking… (esc to interrupt)', false)
    check('autoDetect=false -> 상태 유지', st.state.status, 'idle')
}

// 8) 처리한 OSC 가 잔여 버퍼에 남아 다음 출력에서 또 먹히면 안 된다.
//    완결된 OSC 는 짧아서 꼬리(256자) 안에 통째로 들어간다 — 잘라내지 않으면
//    그 뒤 모든 출력이 같은 상태로 덮어씌워진다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '\x1b]1337;AgentDeck=done;배포 완료\x07', true)
    st.state.status = 'idle'
    st.state.pinned = false
    applyOutput(st, tab, tab, 'Compiling module 3/40...', true)
    check('처리된 OSC 는 재사용되지 않는다', st.state.status, 'running')
}

// ---------- 에이전트 프로필 (agents.ts) ----------
// 위 8묶음은 프로필 인자를 **주지 않고** 부른다 — 그게 0.5.0 까지의 동작이고, 아래에서
// "인자를 생략하면 합집합" 이 그 동작과 같다는 것을 못 박는다.
const { profileFor, unionProfile, detectProfileFor } = require('../.tmp/agents.js')

// 9) 프로필을 생략한 것과 합집합을 명시로 넘긴 것이 같아야 한다 (기본 인자 배선 확인)
{
    const a = makeStatus()
    const b = makeStatus()
    const t1 = newTab()
    const t2 = newTab()
    applyOutput(a, t1, t1, '✳ Thinking… (esc to interrupt)', true)
    applyOutput(b, t2, t2, '✳ Thinking… (esc to interrupt)', true, unionProfile())
    check('생략 == 합집합 (작업중)', a.state.status, b.state.status)
    // 에이전트 탭으로 기억된 뒤 상태줄만 갱신되는 출력 — 양쪽 모두 상태를 유지해야 한다
    a.state.status = 'idle'
    b.state.status = 'idle'
    applyOutput(a, t1, t1, '⏱1s  컨텍스트 사용량: 0%', true)
    applyOutput(b, t2, t2, '⏱1s  컨텍스트 사용량: 0%', true, unionProfile())
    check('생략 == 합집합 (상태줄)', a.state.status, b.state.status)
    check('둘 다 상태 유지', a.state.status, 'idle')
}

// 10) codex 프로필을 주면 codex 패턴으로 판정한다.
//     codex 의 화면 문구는 실측이 없어 일반 패턴(ctrl+c to interrupt / (y/n)) 만 들고 있다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, 'Working (ctrl+c to interrupt)', true, profileFor('codex'))
    check('codex 작업중 문구 -> running', st.state.status, 'running')
    check('codex 탭으로 기억', st.state.busyMode, true)
    const st2 = makeStatus()
    const tab2 = newTab()
    applyOutput(st2, tab2, tab2, 'Apply patch? (y/n)', true, profileFor('codex'))
    check('codex 확인 문구 -> waiting', st2.state.status, 'waiting')
}

// 11) 프로필을 주면 **다른 에이전트 전용** 표식은 근거가 아니다.
//     Claude 의 제목 스피너(◐)와 `esc to interrupt` 는 codex 프로필에 없으므로,
//     이미 에이전트 탭으로 기억된 상태에서는 아무 일도 일어나지 않아야 한다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, 'Working (ctrl+c to interrupt)', true, profileFor('codex'))
    st.state.status = 'idle'
    applyOutput(st, tab, tab, '◐ Sautéing… (esc to interrupt)', true, profileFor('codex'))
    check('codex 프로필은 claude 스피너를 무시', st.state.status, 'idle')
    // 같은 출력을 claude 프로필로 주면 진행중으로 올라간다 — 무시가 프로필 때문임을 확정한다
    const st2 = makeStatus()
    const tab2 = newTab()
    applyOutput(st2, tab2, tab2, '◐ Sautéing… (esc to interrupt)', true, profileFor('claude'))
    check('claude 프로필은 같은 출력을 잡는다', st2.state.status, 'running')
}

// ---------- 사용량 한도 (limited) ----------
// 0.9.0 까지 이 상태는 훅으로만 왔다 — 훅이 없는 CLI(codex·gemini)는 한도에 걸려도 배지가
// running/error 로 남았다. 아래는 전부 **실측 원문**으로 태운다 (docs/AGENT-OBSERVATION.md)

/** 2026-09-08 Codex CLI 실측 — 계정 사용량 한도 화면 */
const CODEX_LIMIT = '■ Usage limit reached. You\'ve reached your usage limit.'
    + ' Increase your limits to continue using codex.'
/** 같은 화면의 상시 상태줄·힌트 (한도로 잡히면 안 되는 줄들) */
const CODEX_STATUSLINE = 'gpt-6-astra low fast · ~\\AppData\\Local\\work'

// 12) 화면 문구로 한도를 판정한다
{
    // 프로필 없이(=합집합) — decorator 경로가 이렇게 부른다
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, CODEX_LIMIT, true)
    check('한도 문구 -> limited (프로필 생략=합집합)', st.state.status, 'limited')
    check('리셋 시각이 원문에 없으니 부연은 빈 값', st.state.reason, '')

    // codex 프로필 / 판정 프로필(합집합 폴백) 양쪽에서 같아야 한다
    const st2 = makeStatus()
    const t2 = newTab()
    applyOutput(st2, t2, t2, CODEX_LIMIT, true, profileFor('codex'))
    check('codex 프로필 -> limited', st2.state.status, 'limited')
    const st3 = makeStatus()
    const t3 = newTab()
    applyOutput(st3, t3, t3, CODEX_LIMIT, true, detectProfileFor('codex'))
    check('codex 판정 프로필 -> limited', st3.state.status, 'limited')

    // 진행중이던 탭도 한도로 내려간다 — 배지가 running 에 박혀 있던 것이 이 일감의 갭이다
    const st4 = makeStatus()
    const t4 = newTab()
    applyOutput(st4, t4, t4, 'Working (ctrl+c to interrupt)', true, profileFor('codex'))
    check('먼저 진행중', st4.state.status, 'running')
    applyOutput(st4, t4, t4, CODEX_LIMIT, true, profileFor('codex'))
    check('한도 문구가 진행중을 이긴다', st4.state.status, 'limited')

    // 화면 추측은 전부 autoDetect 스위치 아래다
    const st5 = makeStatus()
    const t5 = newTab()
    applyOutput(st5, t5, t5, CODEX_LIMIT, false, profileFor('codex'))
    check('autoDetect 꺼짐 -> 한도 판정 없음', st5.state.status, 'idle')

    // 훅/수동이 고정한 탭은 화면이 뒤엎지 않는다 (훅 우선 규약)
    const st6 = makeStatus()
    const t6 = newTab()
    st6.setManual(t6, 'done')
    applyOutput(st6, t6, t6, CODEX_LIMIT, true, profileFor('codex'))
    check('pinned 는 화면 한도 판정으로 안 바뀐다', st6.state.status, 'done')

    // gemini 는 한도 문구가 미관측이고 patternsProven=true 라 자기 것(빈 배열)을 쓴다 —
    // 짐작으로 다른 앱 문구를 빌려 쓰지 않는다는 규칙의 관측 가능한 결과다
    const st7 = makeStatus()
    const t7 = newTab()
    applyOutput(st7, t7, t7, CODEX_LIMIT, true, profileFor('gemini'))
    check('gemini 프로필은 codex 문구로 판정하지 않는다', st7.state.status !== 'limited', true)
}

// 13) **풀리는 길** — 한도가 영구 lock 이 되면 안 된다. 다만 화면 갱신 한 번으로는 안 풀린다
{
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, CODEX_LIMIT, true, profileFor('codex'))
    check('한도', st.state.status, 'limited')
    // 한도에 걸린 CLI 도 상태줄을 계속 다시 그린다 — 그 조각에 풀리면 배지가 한 조각만 ⛔ 였다 사라진다
    applyOutput(st, tab, tab, CODEX_STATUSLINE, true, profileFor('codex'))
    check('상태줄 갱신으로는 안 풀린다', st.state.status, 'limited')
    applyOutput(st, tab, tab, '? for shortcuts', true, profileFor('codex'))
    check('힌트 줄로도 안 풀린다', st.state.status, 'limited')
    // ① 작업 중 문구가 다시 보이면 풀린다 (사용량이 회복돼 실제로 도는 경우)
    applyOutput(st, tab, tab, 'Working (ctrl+c to interrupt)', true, profileFor('codex'))
    check('작업 중 문구가 보이면 풀린다', st.state.status, 'running')

    // ② 사용자가 새 프롬프트를 보낸 순간 (deck.service 의 claimEnterLabel 배선)
    const st2 = makeStatus()
    const t2 = newTab()
    applyOutput(st2, t2, t2, CODEX_LIMIT, true, profileFor('codex'))
    check('한도 (두 번째 케이스)', st2.state.status, 'limited')
    releaseLimited(st2, t2)
    check('새 프롬프트로 풀린다', st2.state.status, 'running')
    // 그 상태에서 또 불러도 아무 일 없다 (멱등 — Enter 마다 호출되는 자리다)
    releaseLimited(st2, t2)
    check('한도가 아닐 때는 건드리지 않는다', st2.state.status, 'running')

    // ③ 훅이 고정한 limited 는 훅이 풀어 준다 — 화면·Enter 가 뒤엎지 않는다
    const st3 = makeStatus()
    const t3 = newTab()
    st3.setManual(t3, 'limited', undefined, '12pm 리셋')
    releaseLimited(st3, t3)
    check('pinned limited 는 그대로', st3.state.status, 'limited')
    check('훅이 준 부연도 그대로', st3.state.reason, '12pm 리셋')
}

// 14) 오탐 방어 — 상시 상태줄·힌트 줄·다른 오류가 한도/대기로 잡히면 그 탭은 박힌다.
//     `no sandbox` 를 대기 후보로 올렸던 선례가 있어서(docs/AGENT-OBSERVATION.md) 줄마다 태운다
{
    const noise = [
        ['힌트 줄', '? for shortcuts'],
        ['상태줄 (no sandbox)', '~\\AppData\\Local\\work    no sandbox    Auto'],
        ['상태줄 (모델·경로)', CODEX_STATUSLINE],
        ['안내 문구만 온 뒷토막', 'Increase your limits to continue using codex.'],
        ['모델 거부 오류 (2026-09-08 원문)',
            '■ {"type":"error","status":400,"message":"The \'gpt-5.4\' model is not supported'
            + ' when using Codex with a ChatGPT account."}'],
        ['입력창 안내', '› Ask Codex to do anything'],
    ]
    for (const [name, line] of noise) {
        const st = makeStatus()
        const tab = newTab()
        applyOutput(st, tab, tab, line, true, detectProfileFor('codex'))
        check(`${name} 은 한도·대기가 아니다`,
            st.state.status !== 'limited' && st.state.status !== 'waiting', true)
    }
}

// 15) 화면 판정으로 waiting 이 될 때 **이유도 함께** 뽑는다.
//     여기까지는 훅이 있는 Claude 탭만 배지에 이유가 있었고, 화면으로 대기가 된 탭은 비어 있어서
//     여섯 탭 중 무엇을 먼저 승인할지 사이드바만 보고 정할 수 없었다
{
    // Gemini CLI 2026-09-08 국면③ 원문
    const st = makeStatus()
    const tab = newTab()
    applyOutput(st, tab, tab, '│ Allow execution of [Shell]?                    │', true,
        profileFor('gemini'))
    check('gemini 승인 대화상자 -> waiting', st.state.status, 'waiting')
    check('이유는 도구 이름', st.state.reason, 'Shell 권한')
    // 커서만 움직인 재그리기(선택지 줄만 든 조각)가 앞서 잡은 이유를 지우면 안 된다
    applyOutput(st, tab, tab, '│ ● 1. Allow once                                │', true,
        profileFor('gemini'))
    check('선택지 줄만 와도 승인대기 유지', st.state.status, 'waiting')
    check('이유도 유지', st.state.reason, 'Shell 권한')
    // 승인하면(작업 중 문구 복귀) 이유는 지워진다 — 남아 있으면 아직 기다리는 것처럼 읽힌다
    applyOutput(st, tab, tab, ' ⠇ Thinking... (esc to cancel, 6s)', true, profileFor('gemini'))
    check('승인 뒤 -> running', st.state.status, 'running')
    check('이유는 지워진다', st.state.reason, '')

    // 여러 줄이 한 조각에 와도 이유는 걸린 줄 하나에서만 나온다 (배지에 화면 덤프가 박히면 안 된다)
    const st2 = makeStatus()
    const t2 = newTab()
    applyOutput(st2, t2, t2, [
        '│ Shell ping -n 30 127.0.0.1                     │',
        '│ Allow execution of [WriteFile]?                │',
        '│ ● 1. Allow once                                │',
        '│   2. Allow always                              │',
    ].join('\r\n'), true, profileFor('gemini'))
    check('여러 줄 조각 -> waiting', st2.state.status, 'waiting')
    check('이유는 도구 이름 하나', st2.state.reason, 'WriteFile 권한')

    // Claude 화면 경로 — 훅이 없거나 못 미더울 때도 이유가 붙는다 (모르는 문구는 24자 상한)
    const st3 = makeStatus()
    const t3 = newTab()
    applyOutput(st3, t3, t3, 'Do you want to proceed?', true, profileFor('claude'))
    check('claude 화면 대기 -> waiting', st3.state.status, 'waiting')
    check('이유는 그 줄을 줄인 것', st3.state.reason, 'Do you want to proceed?')

    // 훅이 고정한 탭의 이유를 화면이 갈아치우지 않는다
    const st4 = makeStatus()
    const t4 = newTab()
    st4.setManual(t4, 'waiting', undefined, 'Bash 권한')
    applyOutput(st4, t4, t4, '│ Allow execution of [Shell]? │', true, profileFor('gemini'))
    check('pinned 의 이유는 훅 것 유지', st4.state.reason, 'Bash 권한')

    // 승인대기 이유가 한도 배지에 남으면 "지금 승인을 기다린다" 로 읽힌다 — 상태가 바뀌면 갈린다.
    // 합집합이라야 대기(gemini 실측)와 한도(codex 실측)를 한 프로필로 태울 수 있다
    const st5 = makeStatus()
    const t5 = newTab()
    applyOutput(st5, t5, t5, '│ Allow execution of [Shell]? │', true, unionProfile())
    check('먼저 승인대기 + 이유', st5.state.reason, 'Shell 권한')
    applyOutput(st5, t5, t5, CODEX_LIMIT, true, unionProfile())
    check('한도로 바뀐다', st5.state.status, 'limited')
    check('승인 이유는 남지 않는다', st5.state.reason, '')
}

// Codex MCP trust approvals do not necessarily emit PermissionRequest.
{
    const { detectProfileFor } = require('../.tmp/agents.js')
    const profile = detectProfileFor('codex')
    const prompt = 'Allow the jira-search MCP server to run tool "jira_similar_issues"?'
    for (let split = 0; split <= prompt.length; split++) {
        const st = makeStatus(), tab = newTab()
        st.setManual(tab, 'running', 'keep label')
        applyOutput(st, tab, tab, prompt.slice(0, split), true, profile)
        applyOutput(st, tab, tab, prompt.slice(split), true, profile)
        check(`MCP approval split ${split}`, st.state.status, 'waiting')
        check(`MCP label split ${split}`, st.state.label, 'keep label')
        applyOutput(st, tab, tab, '\r\nenter to submit · esc to cancel', true, profile)
        // The decorator repeats this output with the fallback union profile.
        applyOutput(st, tab, tab, '\r\nenter to submit · esc to cancel', true)
        check(`approval footer stays waiting ${split}`, st.state.status, 'waiting')
        applyTitle(st, tab, '⠏ Review | Root', true, profile)
        check(`approval resumes ${split}`, st.state.status, 'running')
        check(`approval reason cleared ${split}`, st.state.reason, '')
    }
    for (const pinned of [false, true]) {
        const st = makeStatus(), tab = newTab()
        if (pinned) st.setManual(tab, 'running')
        applyTitle(st, tab, '[ ! ] Action Required | Review | Root', true, profile)
        check(`native approval title pinned=${pinned}`, st.state.status, 'waiting')
        applyOutput(st, tab, tab, '✳ footer redraw', true, profile)
        check(`stale spinner does not release pinned=${pinned}`, st.state.status, 'waiting')
        applyOutput(st, tab, tab, 'Working (esc to interrupt)', true, profile)
        check(`busy output releases pinned=${pinned}`, st.state.status, 'running')
    }
    for (const state of ['done', 'error', 'limited']) {
        const st = makeStatus(), tab = newTab()
        st.setManual(tab, state)
        applyTitle(st, tab, '[ ! ] Action Required | Review', true, profile)
        applyOutput(st, tab, tab, prompt, true, profile)
        check(`other pinned state protected ${state}`, st.state.status, state)
    }
    for (const text of [
        '  1. Allow                Run the tool and continue.',
        '› 3. Always allow         Run the tool and remember this choice for future calls.',
        '\x1b[36m' + prompt + '\x1b[0m',
    ]) {
        const st = makeStatus(), tab = newTab()
        applyOutput(st, tab, tab, text, true, profile)
        check('observed approval rendering', st.state.status, 'waiting')
    }
    for (const text of ['Always allow', '1. Allow', 'Explain: ' + prompt, 'Action Required documentation']) {
        const st = makeStatus(), tab = newTab()
        applyOutput(st, tab, tab, text, true, profile)
        check('ordinary prose is not approval', st.state.status === 'waiting', false)
    }
    const st = makeStatus(), tab = newTab()
    st.setManual(tab, 'running')
    applyOutput(st, tab, tab, prompt, false, profile)
    applyTitle(st, tab, '[ ! ] Action Required | Review', false, profile)
    check('auto detection disabled', st.state.status, 'running')
    applyOutput(st, tab, tab, prompt.slice(0, 30), true, profile)
    forgetOutputBuffer(tab)
    applyOutput(st, tab, tab, prompt.slice(30), true, profile)
    check('detached pane drops partial dialog', st.state.status, 'running')
    const unknown = makeStatus(), unknownTab = newTab()
    unknown.setManual(unknownTab, 'running')
    applyTitle(unknown, unknownTab, '[ ! ] Action Required | Review', true)
    check('native title before agent discovery', unknown.state.status, 'waiting')
    applyOutput(unknown, unknownTab, unknownTab, 'enter to submit · esc to cancel', true)
    check('unknown decorator preserves native approval', unknown.state.status, 'waiting')
    applyTitle(unknown, unknownTab, '⠏ Review | Root', true)
    check('unknown native title resumes observed approval', unknown.state.status, 'running')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
