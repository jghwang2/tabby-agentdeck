// 설정 창 '단축키' 절의 계산부 — `npm test`
//
// 여기서 지키는 것은 넷이다.
//  ① 키 이벤트 → Tabby 식 문자열이 Tabby 의 규칙(hotkeys.util.ts)과 같다
//  ② 겹침 판정이 **Tabby 순정 기본표**와 **agentdeck 기본표** 양쪽을 다 본다 (2026-09-17 유저:
//     "기존 단축키는 agentdeck 용 말고 tabby 순정이랑도 테스트 해야해")
//  ③ 순서·대소문자가 달라도 같은 키로 본다 (설정 파일에 `Ctrl-Shift-Alt-1` 같은 값이 있다)
//  ④ 강제로 가져오면 겹치는 쪽에서 그 키만 떼고, 나머지 바인딩은 남긴다
const fs = require('fs')
const path = require('path')
const K = require('../.tmp/keybind.js')

const root = path.join(__dirname, '..')
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
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

// ── Tabby 순정 기본표 (Windows/Linux) — 배포 번들에서 그대로 읽는다 ──
// 다윈 표가 같은 파일에 같이 있으므로 ⌘·⌥ 가 든 값은 건너뛴다. 파싱이 헛돌면 아래 표본 검사가 잡는다.
// 순정 표는 패키지 넷에 흩어져 있다 — core(탭·창), terminal(search·copy·split…), local, settings
const stock = {}
for (const pkg of ['tabby-core', 'tabby-terminal', 'tabby-local', 'tabby-settings']) {
    const file = path.join(root, 'node_modules', pkg, 'dist', 'index.js')
    if (!fs.existsSync(file)) { continue }
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/'?([a-z0-9-]+)'?\s*:\s*\[\s*((?:'[^']*'\s*,?\s*)+)\]/g)) {
        const vals = [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1])
        if (vals.some(v => /[⌘⌥]/.test(v))) { continue }
        stock[m[1]] = vals
    }
}
check('순정 표를 읽었다 — search 는 Ctrl-Shift-F', stock.search, ['Ctrl-Shift-F'])
check('순정 표 — rename-tab 은 Ctrl-Shift-R', stock['rename-tab'], ['Ctrl-Shift-R'])
check('순정 표 — tab-1 은 Alt-1', stock['tab-1'], ['Alt-1'])
check('순정 표 — focus-all-tabs 는 Ctrl-Alt-Shift-I', stock['focus-all-tabs'], ['Ctrl-Alt-Shift-I'])

// ── agentdeck 기본표 — config.ts 에서 그대로 읽는다 ──
const configSrc = read('src/config.ts')
const ours = {}
for (const m of configSrc.matchAll(/'(agentdeck-[a-z0-9-]+)': \[([^\]]*)\]/g)) {
    ours[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1])
}
check('agentdeck 표를 읽었다 — repair 는 Ctrl-R', ours['agentdeck-repair'], ['Ctrl-R'])
check('agentdeck 표 — jump-1 은 Ctrl-1', ours['agentdeck-jump-1'], ['Ctrl-1'])

/** 기동 뒤 실제 표 — 순정 + 우리, 그리고 ensure*Hotkey 가 떼어 낸 뒤의 모습 */
const live = { ...stock, ...ours, 'new-tab': [], 'rename-tab': [], 'close-pane': ['Ctrl-Q'] }
const W = 'win32'

// ① 키 이벤트 → 문자열
check('Ctrl+Shift+t → Ctrl-Shift-T (라틴 글자는 대문자)',
    K.keystrokeFromEvent({ key: 't', code: 'KeyT', ctrlKey: true, shiftKey: true }, W), 'Ctrl-Shift-T')
check('⌘+t (darwin) → ⌘-T',
    K.keystrokeFromEvent({ key: 't', code: 'KeyT', metaKey: true }, 'darwin'), '⌘-T')
check('Alt+↑ → Alt-Up (Arrow 접두를 뗀다)',
    K.keystrokeFromEvent({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }, W), 'Alt-Up')
check('Ctrl+1 → Ctrl-1 (Digit 접두를 뗀다)',
    K.keystrokeFromEvent({ key: '1', code: 'Digit1', ctrlKey: true }, W), 'Ctrl-1')
check('Shift 만 누르면 null (아직 조합 중)',
    K.keystrokeFromEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }, W), null)
check('Ctrl+- → Ctrl-- (키 자체가 - 인 경우)',
    K.keystrokeFromEvent({ key: '-', code: 'Minus', ctrlKey: true }, W), 'Ctrl--')
check('Shift+Enter → Shift-Enter',
    K.keystrokeFromEvent({ key: 'Enter', code: 'Enter', shiftKey: true }, W), 'Shift-Enter')
check('수식키 순서는 Ctrl · 메타 · 알트 · Shift 로 고정 (Tabby 와 같다)',
    K.keystrokeFromEvent({ key: 'i', code: 'KeyI', shiftKey: true, altKey: true, ctrlKey: true, metaKey: true }, W),
    'Ctrl-Win-Alt-Shift-I')

// ③ 정규화·표기
check('Shift-Ctrl-X 는 Ctrl-Shift-X 와 같은 키', K.strokesEqual('Shift-Ctrl-X', 'Ctrl-Shift-X', W), true)
check('Ctrl-Shift-Alt-1 (설정 파일 표기) 은 Ctrl-Alt-Shift-1 과 같은 키', K.strokesEqual('Ctrl-Shift-Alt-1', 'Ctrl-Alt-Shift-1', W), true)
check('대소문자 무시 (Tabby 매칭과 같다)', K.strokesEqual('ctrl-shift-f', 'Ctrl-Shift-F', W), true)
check('Ctrl-- 파싱 → 키는 -', K.parseStroke('Ctrl--'), { mods: ['Ctrl'], key: '-' })
check('표기: Ctrl-Shift-T → Ctrl+Shift+T', K.displayStroke('Ctrl-Shift-T', W), 'Ctrl+Shift+T')
check('표기: Ctrl-- → Ctrl+-', K.displayStroke('Ctrl--', W), 'Ctrl+-')
check('표기: 정규 순서로 고쳐서 보여 준다', K.displayStroke('Shift-Ctrl-X', W), 'Ctrl+Shift+X')

// ② 겹침 — 순정
check('Ctrl-Shift-F 는 순정 search 와 겹친다', K.findConflicts('Ctrl-Shift-F', live, [], W), ['search'])
check('Shift-Ctrl-Alt-I (순서 다름) 도 순정 focus-all-tabs 와 겹친다',
    K.findConflicts('Shift-Ctrl-Alt-I', live, [], W), ['focus-all-tabs'])
check('Ctrl-R 은 기동 뒤 표에서는 우리 repair 하고만 겹친다 (rename-tab 은 뗐다)',
    K.findConflicts('Ctrl-R', live, [], W), ['agentdeck-repair'])
check('Ctrl-Shift-R 은 순정 원표에서는 rename-tab 과 겹친다 (뗀 이유)',
    K.findConflicts('Ctrl-Shift-R', stock, [], W), ['rename-tab'])
check('Alt-1 은 순정 tab-1 과 겹친다', K.findConflicts('Alt-1', live, [], W), ['tab-1'])
// ② 겹침 — agentdeck
check('Ctrl-O 는 우리 view 와 겹친다', K.findConflicts('Ctrl-O', live, [], W), ['agentdeck-view'])
check('Ctrl-Q 는 close-pane 과 겹친다 (우리가 채운 순정 항목)', K.findConflicts('Ctrl-Q', live, [], W), ['close-pane'])
check('두 번 누르는 열의 마지막이 같아도 겹침이 아니다',
    K.findConflicts('C', { x: [['Ctrl-A', 'C']] }, [], W), [])
check('문자열 하나로 저장된 값도 읽는다 (Tabby 가 허용하는 형태)',
    K.findConflicts('Ctrl-K', { y: 'Ctrl-K' }, [], W), ['y'])

// 계획 — 자기 자신은 겹침에서 빠진다
const item = id => K.KEY_ITEMS.find(i => i.id === id)
check('KEY_ITEMS 는 README 표의 항목 11개', K.KEY_ITEMS.length, 11)
check('순정 분할 항목 둘이 들어 있다 (좌우 · 위아래)',
    K.KEY_ITEMS.filter(i => i.stock).map(i => i.id), ['split-right', 'split-bottom', 'close-pane'])
check('순정 표 — split-right 는 Ctrl-Shift-S, split-bottom 은 Ctrl-Shift-D', [stock['split-right'], stock['split-bottom']], [['Ctrl-Shift-S'], ['Ctrl-Shift-D']])
check('Ctrl-Shift-S 는 순정 split-right 와 겹친다', K.findConflicts('Ctrl-Shift-S', live, [], W), ['split-right'])
check('KEY_ITEMS 의 agentdeck id 가 전부 기본표에 있다',
    K.KEY_ITEMS.filter(i => !i.jump && !i.stock && !ours[i.id]).map(i => i.id), [])
let plan = K.planBinding(live, item('agentdeck-view'), 'Ctrl-O', W)
check('view 에 자기 키를 다시 누르면 겹침 없음', plan.conflicts, [])
plan = K.planBinding(live, item('agentdeck-repair'), 'Ctrl-O', W)
check('repair 에 Ctrl-O 를 주면 view 와 겹친다', plan.conflicts, ['agentdeck-view'])
check('계획의 표기는 사람 표기', plan.display, 'Ctrl+O')
plan = K.planBinding(live, item('agentdeck-repair'), 'Shift-Ctrl-F', W)
check('repair 에 Shift-Ctrl-F → 순정 search 와 겹친다 (정규화해서 써넣는다)',
    [plan.conflicts, plan.writes], [['search'], { 'agentdeck-repair': 'Ctrl-Shift-F' }])

// jump 묶음
plan = K.planBinding(live, item('agentdeck-jump'), 'Alt-3', W)
check('jump 에 Alt-3 → 아홉 개를 Alt-1…Alt-9 로 쓴다',
    Object.entries(plan.writes).map(([k, v]) => `${k}=${v}`),
    Array.from({ length: 9 }, (_, i) => `agentdeck-jump-${i + 1}=Alt-${i + 1}`))
check('그 아홉 개는 순정 tab-1…tab-9 와 겹친다',
    plan.conflicts, Array.from({ length: 9 }, (_, i) => `tab-${i + 1}`))
plan = K.planBinding(live, item('agentdeck-jump'), 'Ctrl-Shift-X', W)
check('jump 에 숫자로 안 끝나는 키 → digit 오류', plan.error, 'digit')
check('jump 표기는 한 줄로 접는다', K.displayStrokes(live, item('agentdeck-jump'), W), ['Ctrl+1 … Ctrl+9'])
check('new-tab 표기는 바인딩마다 하나', K.displayStrokes(live, item('agentdeck-new-tab'), W), ['Ctrl+T', '⌘+T'])
check('미배정은 빈 목록', K.displayStrokes(live, item('agentdeck-toggle'), W), [])

// ④ 쓰기 — 강제면 겹치는 쪽에서 그 키만 뗀다
let t = JSON.parse(JSON.stringify(live))
t.search = ['Ctrl-Shift-F', 'F3']
plan = K.planBinding(t, item('agentdeck-repair'), 'Ctrl-Shift-F', W)
K.applyBinding(t, plan, false, W)
check('강제가 아니면 겹치는 쪽은 그대로', [t['agentdeck-repair'], t.search], [['Ctrl-Shift-F'], ['Ctrl-Shift-F', 'F3']])
t = JSON.parse(JSON.stringify(live))
t.search = ['Ctrl-Shift-F', 'F3']
const changed = K.applyBinding(t, plan, true, W)
check('강제면 search 에서 Ctrl-Shift-F 만 떼고 F3 은 남긴다', [t['agentdeck-repair'], t.search], [['Ctrl-Shift-F'], ['F3']])
check('바뀐 id 목록', changed, ['agentdeck-repair', 'search'])
// 두 번 누르는 열은 강제로도 건드리지 않는다
t = { a: [['Ctrl-A', 'C']], 'agentdeck-repair': ['Ctrl-Shift-R'] }
K.applyBinding(t, K.planBinding(t, item('agentdeck-repair'), 'C', W), true, W)
check('연속 누름 열은 그대로 남는다', t.a, [['Ctrl-A', 'C']])

// 기본값
const defaults = { ...ours, 'close-pane': ['Ctrl-Q'] }
t = JSON.parse(JSON.stringify(live))
check('처음엔 기본값', K.isDefaultBinding(t, item('agentdeck-repair'), defaults, W), true)
K.applyBinding(t, K.planBinding(t, item('agentdeck-repair'), 'Ctrl-Shift-F', W), true, W)
check('바꾸면 기본값이 아니다', K.isDefaultBinding(t, item('agentdeck-repair'), defaults, W), false)
K.resetBinding(t, item('agentdeck-repair'), defaults)
check('기본값으로 되돌리면 Ctrl-R', t['agentdeck-repair'], ['Ctrl-R'])
check('되돌린 뒤 기본값 판정', K.isDefaultBinding(t, item('agentdeck-repair'), defaults, W), true)
K.applyBinding(t, K.planBinding(t, item('agentdeck-jump'), 'Alt-5', W), false, W)
K.resetBinding(t, item('agentdeck-jump'), defaults)
check('jump 되돌리기는 아홉 개 전부', Array.from({ length: 9 }, (_, i) => t[`agentdeck-jump-${i + 1}`][0]),
    Array.from({ length: 9 }, (_, i) => `Ctrl-${i + 1}`))
check('대소문자만 다른 저장값도 기본값으로 본다', K.isDefaultBinding({ 'agentdeck-repair': ['ctrl-r'] }, item('agentdeck-repair'), defaults, W), true)

// README 표 ↔ 기본값 — 첫 화면에 적힌 키가 실제 기본값이다
const readme = read('README.md')
for (const [id, want] of [['agentdeck-new-tab', 'Ctrl+T'], ['agentdeck-focus-list', 'Ctrl+L'],
    ['agentdeck-view', 'Ctrl+O'], ['agentdeck-repair', 'Ctrl+R']]) {
    check(`README 가 ${id} 기본값 ${want} 을 적고 있다`,
        readme.includes('`' + want + '`') && K.displayStroke(ours[id][0], W) === want, true)
}

// 설정 컴포넌트 — 캡처는 window 캡처 단계에서 받고 전파를 끊는다 (Tabby·deck 리스너보다 먼저)
const settings = read('src/settings.component.ts')
check('설정 창이 window 캡처 단계에 keydown 을 건다',
    settings.includes("window.addEventListener('keydown', this.captureHandler, true)"), true)
check('받은 키는 즉시 전파를 끊는다', settings.includes('e.stopImmediatePropagation()'), true)
check('겹침 확인은 강제 적용(force=true)으로 이어진다', /commit\(this\.pending\.plan, true\)/.test(settings), true)

console.log(`\nkeybind: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
