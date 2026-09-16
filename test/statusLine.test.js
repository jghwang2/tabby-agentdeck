// statusLine 감싸기/풀기 — `npm test`
//
// 남의 설정 파일(`~/.claude/settings.json`)을 고치는 코드라 회귀가 나면 피해가 크다.
// 여기서 지키는 계약은 셋이다:
//   ① 원래 걸려 있던 statusLine 을 잃어버리지 않는다 (안쪽으로 옮겨 두고 해제하면 되돌린다)
//   ② 두 번 감싸도 우리가 우리 자신을 안쪽에 넣지 않는다 (무한 고리)
//   ③ 우리 것이 아니면 건드리지 않는다
const { wrapStatusLine, unwrapStatusLine, isWrapped } = require('../.tmp/statusLine.js')

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

const SCRIPT = 'D:/plugin/hooks/agentdeck-statusline.mjs'
// 윈도우 경로로 넘겨도 명령줄에는 슬래시로 박혀야 한다 (statusLine.ts wrapStatusLine 주석)
const WIN_SCRIPT = 'D:\\plugin\\hooks\\agentdeck-statusline.mjs'
const OURS = { type: 'command', command: `node "${SCRIPT}"` }
// 다른 도구의 래퍼가 이미 한 겹 들어가 있는 모양
const THEIRS = {
    type: 'command',
    command: 'node "C:\\Users\\me\\.other-tool\\scripts\\statusline.mjs"',
}

// ---- ① 원래 것을 잃지 않는다 ----
const first = wrapStatusLine({ statusLine: THEIRS, hooks: { Stop: [] } }, SCRIPT)
check('감싸면 statusLine 이 우리 것으로 바뀐다', first.next.statusLine, OURS)
check('원래 명령은 안쪽으로 옮겨진다', first.inner, THEIRS)
check('다른 설정은 건드리지 않는다', first.next.hooks, { Stop: [] })
check('풀면 원래 것이 제자리로', unwrapStatusLine(first.next, first.inner).statusLine, THEIRS)

// ---- ② 두 번 감싸도 고리가 안 생긴다 ----
const second = wrapStatusLine(first.next, SCRIPT)
check('이미 우리 것이면 안쪽을 다시 옮기지 않는다 (null)', second.inner, null)
check('명령줄은 지금 경로로 갱신된다', second.next.statusLine, OURS)
check('경로가 바뀌어도 우리 것으로 알아본다',
    isWrapped({ statusLine: { type: 'command', command: 'node "X:/other/hooks/agentdeck-statusline.mjs"' } }), true)

check('윈도우 경로(백슬래시)도 명령줄에는 슬래시로 박힌다',
    wrapStatusLine({}, WIN_SCRIPT).next.statusLine, OURS)

// ---- ③ 남의 것은 건드리지 않는다 ----
check('우리 것이 아니면 풀어도 그대로',
    unwrapStatusLine({ statusLine: THEIRS }, null).statusLine, THEIRS)
check('남의 statusLine 은 우리 것이 아니다', isWrapped({ statusLine: THEIRS }), false)
check('statusLine 이 없으면 우리 것이 아니다', isWrapped({}), false)
check('command 가 아닌 형식도 우리 것이 아니다',
    isWrapped({ statusLine: { type: 'static', text: 'hi' } }), false)

// ---- 원래 statusLine 이 없던 사용자 ----
const fresh = wrapStatusLine({}, SCRIPT)
check('없던 사용자는 안쪽도 없다', fresh.inner, null)
check('풀면 키 자체가 사라진다 (빈 명령을 남기지 않는다)',
    Object.prototype.hasOwnProperty.call(unwrapStatusLine(fresh.next, null), 'statusLine'), false)

console.log(`\nstatusLine: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
