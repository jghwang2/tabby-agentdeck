// 핫키 하나가 살아 있으려면 **세 곳이 동시에** 맞아야 한다 —
//  ① 선언 (`hotkeys.ts` HotkeyProvider.provide) — 설정 창의 목록에 뜨는 것
//  ② 기본 묶기 (`config.ts` hotkeys) — 사람이 아무것도 안 해도 눌리는 것
//  ③ 처리 (`deck.service.ts` 의 `hotkey$` 구독) — 눌렀을 때 실제로 일어나는 일
//
// 어긋나도 **전부 조용하다.** 선언만 있으면 설정 목록에 뜨지만 눌러도 아무 일이 없고, 묶기만
// 있으면 터미널이 그 키를 영영 못 받는데 이유를 알 수 없고, 처리만 있으면 그 코드는 도달하지
// 않는다. `Ctrl-1…Ctrl-9`(agentdeck-jump-N)처럼 자리 수가 상수 하나(JUMP_SLOTS)에서 파생되는
// 묶음은 한쪽만 늘리기가 특히 쉬워서 여기서 세 곳을 대조한다.
//
// 소스 글자로 보는 이유 — `hotkeys.ts` 는 `devReload.service`(Angular/Tabby)를 import 해서
// 순수 모듈 컴파일 목록에 넣을 수 없다. `version.test.js` 가 파생 값들을 같은 방식으로 본다.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name} -> ${JSON.stringify(got)}`)
        pass++
    } else {
        console.log(`  FAIL ${name} -> ${JSON.stringify(got)} (기대: ${JSON.stringify(want)})`)
        fail++
    }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const hotkeysSrc = read('src/hotkeys.ts')
const navSrc = read('src/nav.ts')
const configSrc = read('src/config.ts')
const deckSrc = read('src/deck.service.ts')

// ── 자리 수의 단일 출처 ──
// `nav.ts` 에 둔다 — import 가 하나도 없는 모듈이라 누가 가져가도 순환이 안 생긴다.
// `hotkeys.ts` 에 두면 deck → hotkeys → devReload → reload → deck 고리가 된다
const slotsM = /export const JUMP_SLOTS = (\d+)/.exec(navSrc)
check('JUMP_SLOTS 가 nav.ts 에 선언돼 있다', !!slotsM, true)
check('hotkeys.ts 는 그것을 nav 에서 가져온다 (사본을 안 만든다)',
    /import \{ JUMP_SLOTS \} from '\.\/nav'/.test(hotkeysSrc)
    && !/export const JUMP_SLOTS/.test(hotkeysSrc), true)
const SLOTS = slotsM ? Number(slotsM[1]) : 0
check('JUMP_SLOTS 는 1 이상', SLOTS >= 1, true)

// ① 선언 — 반복문으로 JUMP_SLOTS 만큼 만든다 (하나씩 손으로 적으면 여기가 먼저 낡는다)
check('선언이 JUMP_SLOTS 를 쓴다',
    /length: JUMP_SLOTS[\s\S]{0,200}agentdeck-jump-\$\{i \+ 1\}/.test(hotkeysSrc), true)

// ② 기본 묶기 — config.ts 에 정확히 JUMP_SLOTS 개, 번호가 1..N 으로 빠짐없이
const bound = [...configSrc.matchAll(/'agentdeck-jump-(\d+)': \['Ctrl-(\d+)'\]/g)]
check('기본 묶기 개수 = JUMP_SLOTS', bound.length, SLOTS)
check('번호가 1..N 으로 빠짐없다',
    bound.map(m => Number(m[1])).join(','),
    Array.from({ length: SLOTS }, (_, i) => i + 1).join(','))
// 키와 번호가 어긋나면(Ctrl-3 이 5번째 세션) 아무도 못 알아챈다 — 눌러 보기 전까지 화면이 같다
check('Ctrl-N 의 N 이 세션 번호와 같다',
    bound.every(m => m[1] === m[2]), true)

// Tabby 순정과 겹치지 않는다 — 순정 Windows/Linux 기본은 `tab-N` = `Alt-N`, macOS 는 `⌘-N`.
// 겹치면 둘 다 도는데(HotkeysService 는 먼저 잡은 쪽만 주지 않는다) 어느 쪽이 이겼는지 화면으로는
// 안 보이고, 사람은 "가끔 엉뚱한 탭으로 간다" 로 겪는다
const tabbyDefaults = read('node_modules/tabby-core/dist/index.js')
const winTable = /'tab-1':\['Alt-1'\]/.test(tabbyDefaults)
check('Tabby 순정 tab-1 은 Alt-1 이다 (Ctrl-1 은 비어 있다)', winTable, true)
check('순정 기본값에 Ctrl-1 로 묶인 것이 없다', /:\['Ctrl-1'\]/.test(tabbyDefaults), false)

// ③ 처리 — deck.service 가 id 를 정규식으로 받아 JUMP_SLOTS 로 상한을 건다
check('deck.service 가 agentdeck-jump-N 을 처리한다',
    /\/\^agentdeck-jump-\(\\d\+\)\$\//.test(deckSrc), true)
check('deck.service 가 JUMP_SLOTS 를 nav 에서 가져온다 (순환 없는 쪽)',
    /import \{ JUMP_SLOTS, [^}]*\} from '\.\/nav'/.test(deckSrc)
    && !/from '\.\/hotkeys'/.test(deckSrc), true)
check('상한을 JUMP_SLOTS 로 건다 (선언에 없는 번호로 안 들어간다)',
    /slot > JUMP_SLOTS/.test(deckSrc), true)
// 번호 이동은 순수 함수가 정한다 — 여기서 산술을 다시 적으면 그 사본이 낡는다(nav.ts 의 원칙)
check('고를 탭은 필터에 독립적인 고정 슬롯이 정한다',
    /this\.sessionSlots\.get\(slot\)/.test(deckSrc), true)
// 전환은 하되 키보드 내비게이션 모드로는 안 들어간다 — 들어가면 이어지는 타이핑이 터미널로 안 간다
check('전환만 하고 목록에 포커스를 주지 않는다',
    /private jumpToRow[\s\S]{0,900}?selectTab\(tab\)/.test(deckSrc)
    && !/private jumpToRow[\s\S]{0,900}?focusList\(/.test(deckSrc), true)

// ── 하단 버튼 세 개의 키 — 묶여 있고, 순정 기본표와 겹치지 않는다 ──
// 선언만 있고 묶기가 없으면 "설정에서 직접 매라" 는 뜻인데, 사이드바 버튼 셋은 매일 누르는 것이라
// 기본값이 있어야 한다(2026-09-16 요청). 순정과 겹치면 둘 다 도는데 어느 쪽이 이겼는지 안 보인다
const BUTTON_KEYS = { 'agentdeck-view': 'Ctrl-O', 'agentdeck-repair': 'Ctrl-R', 'agentdeck-focus-list': 'Ctrl-L' }
const firstKey = id => {
    const i = configSrc.indexOf(`'${id}': [`)
    if (i < 0) { return null }
    const m = /\['([^']+)'/.exec(configSrc.slice(i))
    return m ? m[1] : null
}
for (const [id, key] of Object.entries(BUTTON_KEYS)) {
    check(`${id} 기본 묶기 = ${key}`, firstKey(id), key)
    check(`${id} 를 deck.service 가 처리한다`, deckSrc.includes(`hotkey === '${id}'`), true)
}
check('Ctrl-Shift-O 는 순정 기본표에 없다', tabbyDefaults.includes("'Ctrl-Shift-O'"), false)
// 기본 복구 키는 Ctrl-R. 사용자가 순정 이름 바꾸기와 같은 키를 고르면 겹침을 해제한다.
check('Ctrl-Shift-R 은 순정 rename-tab 키다', tabbyDefaults.includes("'Ctrl-Shift-R'"), true)
check('ensureRepairHotkey 가 rename-tab 에서 우리 키를 뗀다',
    /ensureRepairHotkey[\s\S]{0,1500}?hotkeys\['rename-tab'\] = kept/.test(deckSrc), true)
check('옛 기본값 Ctrl-Shift-U 하나뿐이면 R 로 옮긴다',
    /cur\[0\] === 'Ctrl-Shift-U'[\s\S]{0,120}?\['Ctrl-R'\]/.test(deckSrc), true)
check('claimRepairKey=false 면 핸들러도 무시한다',
    deckSrc.includes("hotkey === 'agentdeck-repair' && this.config.store.agentDeck.claimRepairKey !== false"), true)

// 새 탭 기본은 Ctrl-T. 순정과 겹치는 사용자 지정 키 / macOS 키는 중복 해제한다.
check('agentdeck-new-tab 기본 묶기 = Ctrl-T', firstKey('agentdeck-new-tab'), 'Ctrl-T')
const localDefaults = read('node_modules/tabby-local/dist/index.js')
check('순정 new-tab 기본이 실제로 Ctrl-Shift-T 다 (대체할 대상이 맞다)',
    /'new-tab':\s*\[\s*'Ctrl-Shift-T'/.test(localDefaults), true)
check('순정 new-tab 에서 그 키를 떼는 코드가 있다 (ensureNewTabHotkey)',
    /private ensureNewTabHotkey[\s\S]{0,900}hotkeys\['new-tab'\] = kept/.test(deckSrc), true)
check('떼는 코드가 기동 때 불린다', /this\.ensureNewTabHotkey\(\)/.test(deckSrc), true)
check('게이트(claimNewTabKey)가 설정에 있다', /claimNewTabKey: true/.test(configSrc), true)
check('agentdeck-new-tab 를 deck.service 가 처리한다', deckSrc.includes("hotkey === 'agentdeck-new-tab'"), true)

// ── 선언과 처리가 서로를 빠뜨리지 않았나 (jump 말고도 전부) ──
// 선언에만 있고 처리가 없는 id 는 "설정 목록에 뜨는데 눌러도 아무 일 없는 키" 가 된다
const declared = [...hotkeysSrc.matchAll(/id: '(agentdeck-[a-z-]+)'/g)].map(m => m[1])
const handledLiteral = new Set([...deckSrc.matchAll(/hotkey === '(agentdeck-[a-z-]+)'/g)].map(m => m[1]))
const unhandled = declared.filter(id => !handledLiteral.has(id))
check('선언한 핫키는 모두 deck.service 가 처리한다 (jump 는 정규식이라 목록에 없다)',
    unhandled.join(','), '')

console.log(`\nhotkeys: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
