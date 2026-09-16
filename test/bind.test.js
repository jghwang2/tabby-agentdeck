// 훅 보고 -> 탭 매칭 규칙. 핵심은 "추측하지 않는다" — pids 가 왔는데 맞는 탭이 없으면 활성 탭으로
// 떨어지지 말고 null 을 돌려야 한다 (2026-09-02 실측: 끝난 세션의 done 이 새 탭에 박혔다).
const { pickTabByPids } = require('../.tmp/bind.js')

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

const tabA = { name: 'A' }
const tabB = { name: 'B' }
const tabs = new Map([[tabA, [59548]], [tabB, [61000, 61001]]])

// claude.exe(71344) <- 탭 셸(59548) <- Tabby(62764) <- explorer(13552)
let r = pickTabByPids([71344, 59548, 62764, 13552], tabs)
check('셸 PID 가 조상에 있으면 그 탭', r.tab, tabA)
check('  mode', r.mode, 'pid')

r = pickTabByPids([80000, 61001, 62764], tabs)
check('분할 패널 중 하나의 셸 PID 로도 맞는다', r.tab, tabB)

r = pickTabByPids([90000, 90001, 62764], tabs)
check('맞는 탭이 없으면 null', r.tab, null)
check('  활성 탭으로 추측하지 않는다', r.mode, 'pid-miss')

r = pickTabByPids(undefined, tabs)
check('pids 없는 옛 훅 보고는 legacy', r.mode, 'legacy')

r = pickTabByPids([], tabs)
check('빈 pids 도 legacy', r.mode, 'legacy')

r = pickTabByPids([71344, 59548], new Map([[tabA, []], [tabB, []]]))
check('탭 PID 를 하나도 모르면 legacy (SSH 등)', r.mode, 'legacy')

r = pickTabByPids([0, -1, 1.5, 59548], tabs)
check('쓰레기 PID 는 걸러도 맞는 건 맞는다', r.tab, tabA)

console.log(`\nbind: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
