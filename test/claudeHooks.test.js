// Claude Code 설정 병합 — 남의 설정 파일을 고치는 코드라 회귀가 나면 피해가 크다.
// 남이 걸어 둔 훅을 지우지 않는지, 두 번 눌러도 중복 등록되지 않는지가 핵심이다.
const { mergeHooks, stripHooks, isMerged } = require('../.tmp/claudeHooks.js')

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

const SCRIPT = 'D:/plugin/hooks/agentdeck-notify.ps1'
/** 사용자가 이미 쓰고 있던 남의 훅 — 우리 것과 공존해야 한다 */
const FOREIGN = {
    matcher: 'Edit|Write',
    hooks: [{ type: 'command', command: 'python D:/tools/other-hook.py pre' }],
}

// 1) 빈 설정에 걸면 아홉 이벤트가 생긴다 (상태 7 + 서브에이전트 생명주기 2)
{
    const out = mergeHooks({}, SCRIPT)
    check('아홉 이벤트에 걸린다', Object.keys(out.hooks).sort(),
        ['Notification', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure',
            'SubagentStart', 'SubagentStop', 'UserPromptSubmit'])
    check('설치 판정', isMerged(out), true)
    check('승인 뒤 복귀는 running', out.hooks.PostToolUse[0].hooks[0].command.endsWith('-Status running'), true)
    // 서브에이전트 이벤트는 **상태가 아니라 개수**를 움직인다 — `-Status` 가 붙으면 안 된다
    check('에이전트 시작은 -Subagent start', out.hooks.SubagentStart[0].hooks[0].command.endsWith('-Subagent start'), true)
    check('에이전트 종료는 -Subagent stop', out.hooks.SubagentStop[0].hooks[0].command.endsWith('-Subagent stop'), true)
    check('실패 종료는 error (rate_limit 은 스크립트가 limited 로)', out.hooks.StopFailure[0].hooks[0].command.endsWith('-Status error'), true)
}

// 1b) 옛 설치(세 이벤트만)는 설치 안 됨으로 본다 — 설정 창에서 다시 설치해야 새 이벤트가 붙는다
{
    const old = { hooks: {} }
    for (const ev of ['UserPromptSubmit', 'Notification', 'Stop']) {
        old.hooks[ev] = [{ matcher: '*', hooks: [{ type: 'command', command: `powershell -File "${SCRIPT}" -Status x` }] }]
    }
    check('옛 3이벤트 설치는 미설치 판정', isMerged(old), false)
    const out = mergeHooks(old, SCRIPT)
    // 상태 7 + 서브에이전트 생명주기 2(SubagentStart/Stop) = 9
    check('재설치하면 아홉 이벤트', Object.keys(out.hooks).length, 9)
    check('옛 항목은 중복되지 않는다', out.hooks.Stop.length, 1)
}

// 2) 남이 걸어 둔 훅은 남는다 (같은 이벤트를 공유해도)
{
    const before = { hooks: { UserPromptSubmit: [FOREIGN], PreToolUse: [FOREIGN] } }
    const out = mergeHooks(before, SCRIPT)
    check('같은 이벤트의 남의 훅 보존', out.hooks.UserPromptSubmit[0], FOREIGN)
    check('우리 훅이 뒤에 붙는다', out.hooks.UserPromptSubmit.length, 2)
    check('건드리지 않은 이벤트 보존', out.hooks.PreToolUse, [FOREIGN])
}

// 3) 두 번 걸어도 중복되지 않는다 (경로만 갈아끼운다)
{
    const once = mergeHooks({}, SCRIPT)
    const twice = mergeHooks(once, 'E:/other/hooks/agentdeck-notify.ps1')
    check('중복 등록 없음', twice.hooks.Stop.length, 1)
    check('새 경로로 갈아끼움',
        twice.hooks.Stop[0].hooks[0].command.includes('E:/other'), true)
}

// 4) 뗄 때 우리 것만 걷어낸다
{
    const before = { hooks: { UserPromptSubmit: [FOREIGN], PreToolUse: [FOREIGN] } }
    const out = stripHooks(mergeHooks(before, SCRIPT))
    check('남의 훅은 그대로', out.hooks.UserPromptSubmit, [FOREIGN])
    check('우리만 있던 이벤트는 키까지 지움', 'Stop' in out.hooks, false)
    check('제거 후 설치 판정', isMerged(out), false)
}

// 5) 원본 객체를 변형하지 않는다 (실패 시 되돌릴 수 있어야 한다)
{
    const before = { hooks: { Stop: [FOREIGN] } }
    const snapshot = JSON.stringify(before)
    mergeHooks(before, SCRIPT)
    stripHooks(before)
    check('원본 불변', JSON.stringify(before), snapshot)
}

// 6) 훅 키가 없거나 모양이 이상한 설정도 견딘다
{
    check('hooks 없음', isMerged({ theme: 'dark' }), false)
    check('hooks 가 배열', isMerged({ hooks: [] }), false)
    const out = mergeHooks({ hooks: { Stop: 'oops' } }, SCRIPT)
    check('문자열이던 값은 우리 것으로 대체', out.hooks.Stop.length, 1)
    check('빈 설정 제거도 안전', stripHooks({}), {})
}

// 7) 다른 설정 키는 손대지 않는다
{
    const out = mergeHooks({ model: 'opus', permissions: { allow: ['Bash'] } }, SCRIPT)
    check('무관한 키 보존', out.permissions, { allow: ['Bash'] })
    check('무관한 스칼라 보존', out.model, 'opus')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
