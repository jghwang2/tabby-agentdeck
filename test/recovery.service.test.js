// recovery.service.ts — "기동 시 탭 복원 끄기". Tabby 의 `recoverTabs` 를 false 에 묶는 규칙.
//
// 왜 여기 테스트가 붙나: `@Injectable` 데코레이터 말고는 Angular 를 쓰지 않고(tabby-core 는
// 타입 전용), 만지는 것은 넘겨받은 `config.store` 와 `window.localStorage` 뿐이다.
// (TS private 은 컴파일된 JS 에 남지 않아 enforce 를 직접 부른다)
//
// 여기서 틀리면 사용자가 다치는 지점 —
//  ① enforce 가 조건 없이 save() 하면 `config.changed$ -> enforce -> save -> changed$` 로
//     저장 루프가 돈다. 그 이른 return 이 루프를 끊는 유일한 장치다.
//  ② 끈 뒤에도 복원 목록이 남아 있으면 나중에 순정으로 되돌린 순간 낡은 탭들이 되살아난다.
//  ③ 순정(off)일 때 recoverTabs 를 계속 false 로 눌러 버리면 Tabby 기본 기능을 못 쓴다.
const { AgentDeckRecoveryService } = require('../.tmp/recovery.service.js')

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

function fakeConfig (store) {
    const cfg = { saves: 0, store, save () { cfg.saves++ } }
    return cfg
}

function svc (store) {
    const cfg = fakeConfig(store)
    // app 은 init() 의 구독에만 쓰인다
    return { cfg, s: new AgentDeckRecoveryService({}, cfg) }
}

// ── 토글 ────────────────────────────────────────────────────────────────────
{
    const { cfg, s } = svc({ agentDeck: {}, recoverTabs: true })
    s.setNoTabRecovery(true)
    check('켜면 Tabby 의 recoverTabs 를 끈다', cfg.store.recoverTabs, false)
    check('켠 상태를 기록', cfg.store.agentDeck.noTabRecovery, true)
    check('한 번 저장', cfg.saves, 1)
    s.setNoTabRecovery(false)
    check('끄면 Tabby 기본값(true)으로 되돌린다', cfg.store.recoverTabs, true)
    check('끈 상태를 기록', cfg.store.agentDeck.noTabRecovery, false)
    check('또 한 번 저장', cfg.saves, 2)
}

// 브라우저가 아닌 곳(window 없음)에서도 토글이 터지지 않아야 한다 —
// localStorage 를 못 지우는 것은 불편이고, 예외가 새면 설정 창이 죽는다
{
    const { cfg, s } = svc({ agentDeck: {}, recoverTabs: true })
    let threw = false
    try {
        s.setNoTabRecovery(true)
    } catch {
        threw = true
    }
    check('window 가 없어도 예외를 흘리지 않는다', threw, false)
    check('그래도 설정은 저장한다', cfg.saves, 1)
}

// 전수: enforce — 켜짐 여부(agentDeck 키 없음/false/true) x recoverTabs(true/false)
// 눌러야 할 때만 누르고, 누른 때만 저장한다
{
    const CASES = [
        ['agentDeck 키 없음', undefined],
        ['off', { noTabRecovery: false }],
        ['on', { noTabRecovery: true }],
    ]
    const bad = []
    let calls = 0
    for (const [name, agentDeck] of CASES) {
        for (const recoverTabs of [true, false]) {
            const { cfg, s } = svc({ agentDeck, recoverTabs })
            s.enforce()
            calls++
            // 켜져 있고(recoverTabs 가 참으로 돌아와 있고) 그때만 누른다
            const shouldPush = !!(agentDeck && agentDeck.noTabRecovery) && recoverTabs === true
            const wantValue = shouldPush ? false : recoverTabs
            if (cfg.store.recoverTabs !== wantValue) {
                bad.push(`${name}/${recoverTabs}: ${cfg.store.recoverTabs} (기대 ${wantValue})`)
            }
            if (cfg.saves !== (shouldPush ? 1 : 0)) {
                bad.push(`${name}/${recoverTabs}: 저장 ${cfg.saves} (기대 ${shouldPush ? 1 : 0})`)
            }
        }
    }
    check('전수: enforce 조합 수 (설정 3 x recoverTabs 2)', calls, 6)
    check('전수: 켜진 상태에서 되돌아온 값만 다시 누른다', bad.length ? bad[0] : 0, 0)
}

// 저장 루프 차단 — 이미 false 면 아무 일도 하지 않아야 config.changed$ 가 되돌아오지 않는다
{
    const { cfg, s } = svc({ agentDeck: { noTabRecovery: true }, recoverTabs: false })
    s.enforce()
    s.enforce()
    s.enforce()
    check('이미 꺼져 있으면 저장하지 않는다 (changed$ 저장 루프 차단)', cfg.saves, 0)
    // Tabby 설정 창에서 다시 켠 경우 -> 한 번 누르고, 그 뒤로는 조용하다
    cfg.store.recoverTabs = true
    s.enforce()
    s.enforce()
    check('되돌아오면 한 번만 누른다', cfg.saves, 1)
    check('누른 결과', cfg.store.recoverTabs, false)
}

console.log(`\nrecovery.service: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
