// 탭 셸에 심는 AGENTDECK_TAB — id 생성 규칙과 tabId -> 탭 매칭. 핵심은 bind.test.js 와 같다:
// 맞는 탭이 없으면 null 이고, 활성 탭 같은 것으로 추측하지 않는다.
const { TAB_ENV, newTabId, pickTabByTabId } = require('../.tmp/tabenv.js')

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

check('환경변수 이름', TAB_ENV, 'AGENTDECK_TAB')

const id = newTabId()
check('id 는 12 hex 자리', /^[0-9a-f]{12}$/.test(id), true)
const many = new Set()
for (let i = 0; i < 2000; i++) {
    many.add(newTabId())
}
check('2000 개 뽑아도 겹치지 않는다', many.size, 2000)

const tabA = { name: 'A' }
const tabB = { name: 'B' }
const tabs = new Map([[tabA, ['aaaaaaaaaaaa']], [tabB, ['bbbbbbbbbbbb', 'cccccccccccc']]])

check('id 가 있는 탭', pickTabByTabId('aaaaaaaaaaaa', tabs), tabA)
check('분할 패널 중 하나의 id 로도 맞는다', pickTabByTabId('cccccccccccc', tabs), tabB)
check('앞뒤 공백은 무시한다', pickTabByTabId(' bbbbbbbbbbbb ', tabs), tabB)
check('모르는 id 는 null', pickTabByTabId('dddddddddddd', tabs), null)
check('tabId 없는 보고(옛 훅)는 null', pickTabByTabId(undefined, tabs), null)
check('빈 문자열도 null', pickTabByTabId('', tabs), null)
check('표가 비어 있으면 null', pickTabByTabId('aaaaaaaaaaaa', new Map()), null)

console.log(`\ntabenv: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
