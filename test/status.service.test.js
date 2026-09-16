// status.service.ts — 사이드바가 보여주는 탭 상태의 상태기계.
//
// 왜 여기 테스트가 붙나: 이 파일은 Angular 의 `@Injectable` 데코레이터와 rxjs `Subject` 만 쓰고
// (tabby-core 는 타입으로만 import 해서 컴파일 결과에 require 조차 남지 않는다) DOM·Electron 을
// 만지지 않는다. 탭은 Map 의 키로만 쓰이므로 빈 객체 하나가 탭 노릇을 한다 — 그래서 그냥 돈다.
//
// 여기서 틀리면 사용자가 다치는 지점 —
//  ① 끝난 탭에 `승인대기 · Bash 권한` 이 남아 지금 나를 기다리는 것처럼 읽힌다 (reason 게이트)
//  ② 훅이 고정(pinned)한 탭이 자동 감지에 덮여 상태가 춤춘다
//  ③ 승인 후 긴 빌드 동안 `승인대기` 에 박힌다 (resume)
//  ④ 진행중에서 영영 안 내려온다 / 너무 빨리 내려온다 (tickIdle 의 busyMode 선택)
//  ⑤ 닫힌 탭이 states 에 쌓인다 — 2026-09-09 실측 PF9(탭 11개 닫아도 37→37)의 그 경로 (sweep)
const { WorkStatusService } = require('../.tmp/status.service.js')

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

const ALL = ['idle', 'running', 'waiting', 'limited', 'done', 'error']
// 부연(reason)을 들고 있을 수 있는 상태 — status.service 의 REASON_STATUSES 와 같아야 한다
const WITH_REASON = ['waiting', 'limited', 'error']
// 훅 고정에 유예 시계가 붙는 상태 — status.service 의 STALE_STATUSES 와 같아야 한다.
// `waiting`·`limited` 가 빠진 것이 이 목록의 요점이다 (조용한 것이 정상인 상태)
const STALE_STATUSES = ['running', 'done', 'error']

/** 이벤트 수를 세는 서비스 하나 */
function svc () {
    const s = new WorkStatusService()
    const box = { n: 0 }
    s.changed$.subscribe(() => box.n++)
    s.events = box
    return s
}

// ── 처음 보는 탭의 기본값 ────────────────────────────────────────────────────
// 사이드바는 매 틱 get() 을 부른다 — 여기서 이벤트가 나면 그리기 루프가 스스로를 깨운다
{
    const s = svc()
    const tab = {}
    const st = s.get(tab)
    check('처음 보는 탭은 idle', st.status, 'idle')
    check('처음엔 라벨 없음', st.label, '')
    check('처음엔 부연 없음', st.reason, '')
    check('처음엔 고정 아님', st.pinned, false)
    check('처음엔 출력 기록 없음', st.lastOutput, 0)
    check('처음엔 busyMode 아님', st.busyMode, false)
    check('처음엔 작업중 신호 없음', st.lastBusy, 0)
    check('since 는 지금', st.since > 0 && st.since <= Date.now(), true)
    check('get 은 같은 객체를 돌려준다 (매 틱 새로 만들면 상태가 리셋된다)', s.get(tab) === st, true)
    check('get 은 이벤트를 내지 않는다 (매 틱 불린다)', s.events.n, 0)
    const other = {}
    s.setManual(other, 'error', 'X', 'boom')
    check('탭끼리 상태가 섞이지 않는다', s.get(tab).status, 'idle')
}

// ── setAuto: 자동 감지 ──────────────────────────────────────────────────────
{
    const s = svc()
    const tab = {}
    s.setAuto(tab, 'running')
    check('자동 감지로 상태가 바뀐다', s.get(tab).status, 'running')
    check('바뀌면 이벤트 1회', s.events.n, 1)
    const since = s.get(tab).since
    s.setAuto(tab, 'running')
    check('같은 상태면 이벤트 없음 (매 출력마다 그리기를 깨우면 안 된다)', s.events.n, 1)
    check('같은 상태면 since 도 그대로', s.get(tab).since, since)
    s.setManual(tab, 'waiting', 'L', 'Bash 권한')
    s.setAuto(tab, 'idle')
    check('고정된 탭은 자동 감지가 못 덮는다', s.get(tab).status, 'waiting')
    // 지금까지 이벤트는 setAuto(running) 1 + setManual(waiting) 1 = 2. 막힌 setAuto 는 더하지 않는다
    check('고정된 탭은 이벤트도 안 낸다', s.events.n, 2)
    check('고정된 탭의 부연도 살아 있다', s.get(tab).reason, 'Bash 권한')
}

// 전수①: setManual 의 부연 게이트 (6 상태 x 부연 있음/없음)
// 부연을 가질 수 없는 상태에 문구가 남으면 완료된 탭이 승인 대기처럼 읽힌다
{
    const s = new WorkStatusService()
    let calls = 0
    const bad = []
    for (const st of ALL) {
        for (const given of ['이유있음', undefined]) {
            const tab = {}
            s.setManual(tab, 'waiting', 'L0', '먼저 있던 부연')
            s.setManual(tab, st, 'L1', given)
            calls++
            const want = WITH_REASON.includes(st) ? (given ?? '') : ''
            const got = s.get(tab).reason
            if (got !== want) {
                bad.push(`${st} given=${given}: ${got} (기대 ${want})`)
            }
            if (s.get(tab).status !== st || s.get(tab).pinned !== true) {
                bad.push(`${st}: 상태/고정이 안 걸렸다`)
            }
        }
    }
    check('전수①: setManual 호출 수 (6 상태 x 2)', calls, 12)
    check('전수①: 부연은 waiting/limited/error 에만 남는다', bad.length ? bad[0] : 0, 0)

    const tab = {}
    s.setManual(tab, 'running')
    check('label 을 생략하면 기존 라벨을 지우지 않는다', s.get(tab).label, '')
    s.setLabel(tab, '이름')
    s.setManual(tab, 'done')
    check('label 생략 시 기존 이름 유지', s.get(tab).label, '이름')
}

// 전수②: resume 은 waiting 에서만 (6 상태)
// 승인한 순간을 훅이 알려주지 않아 화면 신호로 올리는 경로다 — 다른 상태에서 뛰면
// 완료된 탭이 다시 진행중으로 살아난다
{
    const bad = []
    let calls = 0
    for (const st of ALL) {
        const s = svc()
        const tab = {}
        s.setManual(tab, st, 'L', '부연')
        const before = s.events.n
        s.resume(tab)
        calls++
        const now = s.get(tab)
        if (st === 'waiting') {
            if (now.status !== 'running' || now.reason !== '' || now.pinned !== true || s.events.n !== before + 1) {
                bad.push(`waiting: ${now.status}/${now.reason}/${now.pinned}/ev${s.events.n - before}`)
            }
        } else if (now.status !== st || s.events.n !== before) {
            bad.push(`${st}: ${now.status} ev${s.events.n - before}`)
        }
    }
    check('전수②: resume 호출 수 (6 상태)', calls, 6)
    check('전수②: waiting 만 진행중으로, 나머지는 무동작', bad.length ? bad[0] : 0, 0)
}

// ── unpin: 수동 고정 풀기 ───────────────────────────────────────────────────
{
    const s = svc()
    const tab = {}
    s.setManual(tab, 'waiting', 'L', 'Bash 권한')
    s.unpin(tab)
    check('고정을 풀면 idle', s.get(tab).status, 'idle')
    check('고정 해제', s.get(tab).pinned, false)
    check('idle 은 부연을 가질 수 없다', s.get(tab).reason, '')
    check('풀린 뒤엔 자동 감지가 다시 먹는다', (s.setAuto(tab, 'running'), s.get(tab).status), 'running')
}

// 전수③: tickIdle — 6 상태 x 고정 2 x busyMode 2 x lastOutput 3 x lastBusy 3
// busyMode 인 탭은 "작업중 신호"가 끊긴 시점부터, 아닌 탭은 출력이 끊긴 시점부터 잰다.
// 고른 쪽이 틀리면 상태줄을 매초 다시 그리는 에이전트 TUI 가 영원히 진행중으로 남는다.
// 0(=아직 한 번도 없음)이면 절대 내려오지 않아야 한다 — 방금 만든 탭을 idle 로 밀지 않기 위해.
{
    const IDLE_AFTER = 1000
    const now = Date.now()
    const STAMPS = [
        ['없음', 0],
        ['오래됨', now - 60000],
        ['방금', now],
    ]
    const bad = []
    let calls = 0
    for (const st of ALL) {
        for (const pinned of [false, true]) {
            for (const busyMode of [false, true]) {
                for (const [outName, lastOutput] of STAMPS) {
                    for (const [busyName, lastBusy] of STAMPS) {
                        const s = svc()
                        const tab = {}
                        const state = s.get(tab)
                        state.status = st
                        state.pinned = pinned
                        state.busyMode = busyMode
                        state.lastOutput = lastOutput
                        state.lastBusy = lastBusy
                        state.reason = '남아 있던 부연'
                        const got = s.tickIdle(tab, IDLE_AFTER)
                        calls++
                        const from = busyMode ? lastBusy : lastOutput
                        const want = !pinned && st === 'running' && from > 0 && Date.now() - from > IDLE_AFTER
                        const where = `${st} pinned=${pinned} busy=${busyMode} out=${outName} bus=${busyName}`
                        if (got !== want) {
                            bad.push(`${where}: ${got} (기대 ${want})`)
                        }
                        if (want && (s.get(tab).status !== 'idle' || s.get(tab).reason !== '')) {
                            bad.push(`${where}: idle 전환/부연 정리 실패`)
                        }
                        if (!want && s.get(tab).status !== st) {
                            bad.push(`${where}: 안 바꿔야 하는데 ${s.get(tab).status}`)
                        }
                        if (s.events.n !== 0) {
                            bad.push(`${where}: 이벤트를 냈다 (매 틱 호출이라 그리기 루프가 돈다)`)
                        }
                    }
                }
            }
        }
    }
    check('전수③: tickIdle 호출 수 (6 x 2 x 2 x 3 x 3)', calls, 216)
    check('전수③: 진행중 + 고정 아님 + 기준시각 있음 + 초과 일 때만 idle', bad.length ? bad[0] : 0, 0)
}

// 전수③-b: tickIdle 의 **고정 탭 유예**(staleAfterMs) — 6 상태 x busyMode 2 x since/out/busy 3^3
//
// 왜 이 전수가 생겼나 (2026-09-15) —
// 훅에는 "세션이 끝났다" 이벤트가 없다(claudeHooks.ts PLAN 은 UserPromptSubmit/PostToolUse/
// Notification/Stop 만 설치한다). 그래서 Ctrl+C 로 끊거나 창을 닫거나 CLI 가 죽으면 마지막
// `running` 이 그대로 남는데, 고정된 탭은 여기서 그냥 건너뛰었고 `setAuto` 도 pinned 를 무시하고
// `resume` 은 waiting 전용이라 **배지가 내려올 길이 한 개도 없었다.** 사이드바가 "작업중" 이라
// 말하는데 실은 죽어 있는 탭이 그것이다.
//
// 계약 세 가지를 한꺼번에 본다 —
//  ① 기척은 셋 다 인정한다 (훅 보고 since · PTY 출력 lastOutput · 작업중 신호 lastBusy 중 최신)
//  ② `waiting`·`limited` 는 대상이 아니다 (조용한 것이 정상 — 사람이 승인을 안 했거나 한도가 안 풀렸다)
//  ③ 푸는 것은 **고정**이고, `진행중` 일 때만 이어서 idle 로 내린다. `완료`·`오류` 는 글자를 남긴다 —
//    그 값은 실제로 있었던 일이고, 필요한 것은 다음 출력이 배지를 되살릴 수 있게 하는 것뿐이다
//    (CLI 를 끄고 같은 탭에서 셸을 써도 배지가 `완료` 에 박혀 있던 자리)
{
    const STALE = 10000
    const now = Date.now()
    const STAMPS = [
        ['없음', 0],
        ['오래됨', now - 60000],
        ['방금', now],
    ]
    const bad = []
    let calls = 0
    for (const st of ALL) {
        for (const busyMode of [false, true]) {
            for (const [sinceName, since] of STAMPS) {
                for (const [outName, lastOutput] of STAMPS) {
                    for (const [busyName, lastBusy] of STAMPS) {
                        const s = svc()
                        const tab = {}
                        const state = s.get(tab)
                        state.status = st
                        state.pinned = true
                        state.busyMode = busyMode
                        state.since = since
                        state.lastOutput = lastOutput
                        state.lastBusy = lastBusy
                        state.reason = '남아 있던 부연'
                        const got = s.tickIdle(tab, 1000, STALE)
                        calls++
                        // 기척 = 셋 중 최신. busyMode 로 갈리지 않는다 — 고정 탭은 훅이 말해 주므로
                        // 출력이 없어도 살아 있을 수 있고, 반대로 훅이 조용해도 화면은 돌 수 있다
                        const alive = Math.max(since, lastOutput, lastBusy)
                        const want = STALE_STATUSES.includes(st) && alive > 0 && Date.now() - alive > STALE
                        const where = `${st} busy=${busyMode} since=${sinceName} out=${outName} bus=${busyName}`
                        if (got !== want) {
                            bad.push(`${where}: ${got} (기대 ${want})`)
                        }
                        // 푸는 것은 **고정**이고, `진행중` 일 때만 이어서 idle 로 내린다 —
                        // `완료`·`오류` 는 실제로 있었던 일이라 글자를 지우지 않는다
                        if (want && s.get(tab).pinned !== false) {
                            bad.push(`${where}: 고정이 안 풀렸다 — 자동 감지가 계속 무시된다`)
                        }
                        if (want && st === 'running' && s.get(tab).status !== 'idle') {
                            bad.push(`${where}: idle 로 안 내려갔다 (${s.get(tab).status})`)
                        }
                        if (want && st !== 'running' && s.get(tab).status !== st) {
                            bad.push(`${where}: 글자를 바꿨다 (${s.get(tab).status}) — 고정만 풀어야 한다`)
                        }
                        if (want && st === 'running' && s.get(tab).reason !== '') {
                            bad.push(`${where}: 부연이 남았다`)
                        }
                        if (!want && (s.get(tab).status !== st || s.get(tab).pinned !== true)) {
                            bad.push(`${where}: 안 건드려야 하는데 ${s.get(tab).status}/pinned=${s.get(tab).pinned}`)
                        }
                        if (s.events.n !== 0) {
                            bad.push(`${where}: 이벤트를 냈다 (매 틱 호출이라 그리기 루프가 돈다)`)
                        }
                    }
                }
            }
        }
    }
    check('전수③-b: 호출 수 (6 x 2 x 3 x 3 x 3)', calls, 324)
    check('전수③-b: 진행중 + 기척 있음 + 유예 초과 일 때만 고정을 풀고 idle', bad.length ? bad[0] : 0, 0)
}

// staleAfterMs 를 안 주거나 0 이면 예전 그대로 — 고정 탭은 영영 안 내려온다.
// 기본값을 끄고 쓰는 사람의 화면이 0.17.0 이전과 같아야 한다
{
    const old = Date.now() - 3600000
    for (const arg of [undefined, 0, -1]) {
        const s = svc()
        const tab = {}
        Object.assign(s.get(tab), { status: 'running', pinned: true, since: old, lastOutput: old, lastBusy: old })
        check(`staleAfterMs=${arg} 이면 고정 탭은 안 내려온다`, s.tickIdle(tab, 1000, arg), false)
        check(`staleAfterMs=${arg} 이면 고정도 그대로`, s.get(tab).pinned, true)
    }
}

// 훅이 계속 말하는 세션은 절대 안 내려온다 — 2분짜리 빌드 중 PostToolUse 하나로도 시계가 돈다
{
    const s = svc()
    const tab = {}
    const old = Date.now() - 3600000
    Object.assign(s.get(tab), { status: 'running', pinned: true, since: old, lastOutput: old, lastBusy: old })
    check('기척이 없으면 내려온다', s.tickIdle(tab, 1000, 10000), true)
    const s2 = svc()
    const tab2 = {}
    Object.assign(s2.get(tab2), { status: 'running', pinned: true, since: old, lastOutput: old, lastBusy: old })
    s2.setManual(tab2, 'running')   // 훅 보고 한 번 — since 가 갱신된다
    check('훅 보고가 오면 시계가 돈다', s2.tickIdle(tab2, 1000, 10000), false)
    check('보고 뒤에도 고정은 유지', s2.get(tab2).pinned, true)
}

// markOutput / markBusy — 기록만 하고 그리기를 깨우지 않는다 (PTY 출력마다 불린다)
{
    const s = svc()
    const tab = {}
    s.markOutput(tab)
    check('markOutput 이 시각을 남긴다', s.get(tab).lastOutput > 0, true)
    check('markOutput 은 이벤트 없음 (출력마다 불린다)', s.events.n, 0)
    check('markBusy 전엔 busyMode 아님', s.isBusyMode(tab), false)
    s.markBusy(tab)
    check('markBusy 뒤엔 busyMode', s.isBusyMode(tab), true)
    check('markBusy 가 신호 시각을 남긴다', s.get(tab).lastBusy > 0, true)
    check('markBusy 도 이벤트 없음', s.events.n, 0)
    s.setAuto(tab, 'running')
    s.setAuto(tab, 'idle')
    check('한 번 에이전트로 본 탭은 계속 busyMode (상태가 바뀌어도)', s.isBusyMode(tab), true)
}

// 전수④: sweep — 탭 5개의 모든 생존 조합(32)에서 죽은 것만 지운다
// Map 이라 참조를 직접 지워야 하고, 지우는 유일한 경로가 여기다
{
    const bad = []
    let calls = 0
    for (let mask = 0; mask < 32; mask++) {
        const s = svc()
        const tabs = [{}, {}, {}, {}, {}]
        tabs.forEach((t, i) => s.setAuto(t, i % 2 ? 'running' : 'waiting'))
        const alive = tabs.filter((_, i) => (mask >> i) & 1)
        const before = s.events.n
        const removed = s.sweep(alive)
        calls++
        const want = 5 - alive.length
        if (removed !== want) {
            bad.push(`mask=${mask}: ${removed} (기대 ${want})`)
        }
        // 지운 게 있을 때만 그리기를 깨운다
        const wantEv = want > 0 ? before + 1 : before
        if (s.events.n !== wantEv) {
            bad.push(`mask=${mask}: 이벤트 ${s.events.n - before}`)
        }
        // 살아남은 탭의 상태는 그대로여야 한다 (새로 만들면 상태가 idle 로 리셋된 것)
        for (const t of alive) {
            if (s.get(t).status === 'idle') {
                bad.push(`mask=${mask}: 살아있는 탭의 상태가 날아갔다`)
            }
        }
        // 두 번째 sweep 은 0 — 멱등
        if (s.sweep(alive) !== 0) {
            bad.push(`mask=${mask}: 두 번째 sweep 이 0 이 아니다`)
        }
    }
    check('전수④: sweep 조합 수 (탭 5개의 생존 조합)', calls, 32)
    check('전수④: 죽은 탭만 지우고 개수를 돌려준다', bad.length ? bad[0] : 0, 0)

    const s = svc()
    const tab = {}
    s.setManual(tab, 'waiting', 'L', 'r')
    s.forget(tab)
    check('forget 뒤엔 기본값으로 새로 시작', s.get(tab).status, 'idle')
    check('forget 은 이벤트를 낸다 (개수 배지가 줄어야 한다)', s.events.n, 2)
    check('빈 목록 sweep 은 0 (아직 탭이 없을 때)', new WorkStatusService().sweep([]), 0)
}

// 진단 카운터 — decorator 가 붙었는지 보는 유일한 창구라 초기값이 0 이어야 의미가 있다
{
    const s = new WorkStatusService()
    check('진단 카운터 초기값', `${s.debug.attached}${s.debug.outputs}${s.debug.oscHits}${s.debug.titleHits}`, '0000')
}

console.log(`\nstatus.service: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
