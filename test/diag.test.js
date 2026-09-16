// 진단 로그의 계약을 고정한다. 이 파일이 지키는 것은 "남의 로그를 받아서 고칠 수 있나" 뿐이다 —
//
// ① **세션이 바뀌어도 지워지지 않는다** (옛 구현은 기동할 때마다 파일을 비웠다. 이 회귀가 제일 아프다)
// ② 세션 머리말에 **버전·환경·설정** 이 박힌다 (받은 로그가 어느 빌드의 것인지 스스로 말해야 한다)
// ③ 상한을 넘으면 `.1` 로 **회전**한다 (첨부할 수 있는 크기로 유지)
// ④ 예외·삼켜진 `catch` 가 로그에 **들어온다**, 단 같은 사유로 도배되지 않는다
// ⑤ 수집 묶음에 리포트와 로그가 담기고, 화면 원문은 **켤 때만** 들어간다 (사생활)
//
// 홈 디렉토리를 임시 폴더로 갈아서 돌린다 — 로그 경로가 모듈 로드 시점에 `os.homedir()` 로
// 정해지므로, require 전에 USERPROFILE/HOME 을 바꿔야 실제 홈의 로그를 건드리지 않는다.
const fs = require('fs')
const os = require('os')
const path = require('path')

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-diag-test-'))
process.env.USERPROFILE = home
process.env.HOME = home
if (os.homedir() !== home) {
    console.log(`  SKIP 홈을 임시 폴더로 못 바꿨다 (homedir=${os.homedir()})`)
    process.exit(0)
}

const diagModule = require('../.tmp/diag.js')
const {
    appendScreenLog, collectDiagBundle, configStamp, diag, diagCatch, diagException,
    diagMemory, diagOnce, installErrorCapture, pluginVersion, recentDiag, resetDiagOnce,
    startDiagSession, DIAG_PATH, DIAG_PREV_PATH, SCREEN_PATH,
} = diagModule

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

const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')
const lineCount = (text, needle) => text.split('\n').filter(l => l.includes(needle)).length

// ---------- 경로 ----------
check('진단 로그는 홈에 잡힌다', DIAG_PATH, path.join(home, '.agentdeck-diag.log'))
check('직전 세대는 .1', DIAG_PREV_PATH, DIAG_PATH + '.1')

// ---------- 버전 스탬프 ----------
// dist(빌드) 와 .tmp(테스트) 모두 `../package.json` 이 리포 루트라 같은 값을 읽는다
const declared = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
check('로그가 말하는 버전 = package.json', pluginVersion(), declared)

// ---------- 세션 머리말 ----------
startDiagSession({ tabby: '1.0.235', osRelease: '10.0.26100', config: { dock: 'right', useConPTY: false } })
diag('첫 세션의 한 줄')
let text = read(DIAG_PATH)
check('머리말에 세션 표시', text.includes('===== agentdeck session'), true)
check('머리말에 플러그인 버전', text.includes(`plugin=${declared}`), true)
check('머리말에 Tabby 버전', text.includes('tabby=1.0.235'), true)
check('머리말에 OS', text.includes('10.0.26100'), true)
check('머리말에 설정', text.includes('"useConPTY":false'), true)
check('머리말에 electron/node 자리', text.includes('node='), true)
check('한 줄에 ISO 시각이 붙는다', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z 첫 세션의 한 줄$/m.test(text), true)

// ---------- 재기동해도 남는다 (핵심 회귀) ----------
startDiagSession({ tabby: '1.0.235' })
diag('두 번째 세션의 한 줄')
text = read(DIAG_PATH)
check('옛 세션 줄이 살아 있다', text.includes('첫 세션의 한 줄'), true)
check('새 세션 줄도 있다', text.includes('두 번째 세션의 한 줄'), true)
check('세션 머리말이 두 개', lineCount(text, '===== agentdeck session'), 2)

// ---------- diagOnce ----------
diagOnce('k1', '한 번만 남을 줄')
diagOnce('k1', '한 번만 남을 줄')
check('같은 키는 한 번만', lineCount(read(DIAG_PATH), '한 번만 남을 줄'), 1)
resetDiagOnce('k1')
diagOnce('k1', '한 번만 남을 줄')
check('키를 풀면 다시 남는다', lineCount(read(DIAG_PATH), '한 번만 남을 줄'), 2)

// ---------- 예외 ----------
const err = new Error('터진 이유')
diagException('테스트자리', err)
text = read(DIAG_PATH)
check('예외 한 줄', text.includes('EXCEPTION 테스트자리 Error: 터진 이유'), true)
check('스택도 붙는다', /\n\s+at /.test(text), true)
diagException('널자리', null)
check('에러 객체가 없어도 남는다', read(DIAG_PATH).includes('EXCEPTION 널자리 (no error object)'), true)

// ---------- 삼켜졌던 catch ----------
diagCatch('pty resize', new Error('세션이 닫혔다'))
diagCatch('pty resize', new Error('세션이 닫혔다'))
check('CATCH 한 줄로 남는다', lineCount(read(DIAG_PATH), 'CATCH pty resize'), 1)
diagCatch('pty resize', new Error('다른 사유'))
check('사유가 다르면 또 남는다', lineCount(read(DIAG_PATH), 'CATCH pty resize'), 2)

// ---------- console 캡처 ----------
installErrorCapture()
installErrorCapture() // 두 번 걸어도 이중 기록이 되면 안 된다
const originalError = console.error
console.error('[agentdeck] 콘솔로 나간 오류')
check('console.error 가 로그로 온다', lineCount(read(DIAG_PATH), 'CONSOLE error [agentdeck] 콘솔로 나간 오류'), 1)
console.error('[agentdeck] 콘솔로 나간 오류')
check('같은 메시지 연타는 한 번만', lineCount(read(DIAG_PATH), 'CONSOLE error [agentdeck] 콘솔로 나간 오류'), 1)
check('원래 console.error 는 살아 있다', typeof originalError, 'function')

// ---------- 메모리 사본 ----------
check('메모리에도 쌓인다', recentDiag(500).some(l => l.includes('두 번째 세션의 한 줄')), true)
check('kickLog 은 같은 배열', diagMemory() === diagMemory(), true)

// ---------- 회전 ----------
// 상한(2MB)을 넘기면 옛 분량이 `.1` 로 밀리고 새 파일은 머리말부터 시작한다.
// 굵은 줄로 키우는 이유 — 실제 성장 경로(diag() -> append())를 그대로 타야 회전 판정까지 검증된다
for (let i = 0; i < 9; i++) {
    diag('굵은 줄 ' + 'x'.repeat(256 * 1024))
}
diag('회전 뒤 첫 줄')
check('옛 분량은 .1 로 밀렸다', read(DIAG_PREV_PATH).includes('두 번째 세션의 한 줄'), true)
text = read(DIAG_PATH)
check('새 파일은 상한보다 훨씬 작다', text.length < 512 * 1024, true)
check('새 파일도 자기 세션을 말한다', text.includes('===== agentdeck session'), true)
check('회전 뒤 줄이 새 파일에 있다', text.includes('회전 뒤 첫 줄'), true)

// ---------- 화면 원문 ----------
appendScreenLog('===== 깨진 화면 원문\n  0 len=3 "abc"\n')
check('화면 원문은 따로 쌓인다', read(SCREEN_PATH).includes('깨진 화면 원문'), true)

// ---------- 설정 스탬프 ----------
const stamp = configStamp({ agentDeck: { enabled: true, sidebarDock: 'left', sidebarWidth: 0, sidebarHeight: 200, aspectW: 4, aspectH: 3 }, terminal: { useConPTY: false } })
check('설정 스탬프 dock', stamp.dock, 'left')
check('설정 스탬프 aspect', stamp.aspect, '4:3')
check('폭이 0 이면 높이를 적는다', stamp.sidebar, 200)
check('Tabby 쪽 useConPTY 도 담는다', stamp.useConPTY, false)
check('사적인 경로는 담지 않는다', 'rootProfileCwd' in stamp, false)

// ---------- 수집 묶음 ----------
const bundle = collectDiagBundle({ stamp: { tabby: '1.0.235' } })
check('리포트가 담긴다', bundle.files.includes('report.txt'), true)
check('진단 로그가 담긴다', bundle.files.includes('agentdeck-diag.log'), true)
check('직전 세대도 담긴다', bundle.files.includes('agentdeck-diag.log.1'), true)
check('화면 원문은 기본 제외', bundle.files.includes('agentdeck-screen.log'), false)
check('묶음 경로가 있다', fs.existsSync(bundle.path), true)
const withScreen = collectDiagBundle({ includeScreen: true })
check('켜면 화면 원문도 담긴다', withScreen.files.includes('agentdeck-screen.log'), true)

// 압축까지 됐으면 zip, 안 됐으면 폴더가 나온다 — 어느 쪽이든 사람이 열 수 있는 경로여야 한다
check('zip 이면 확장자가 .zip', bundle.zipped ? bundle.path.endsWith('.zip') : true, true)
const reportDir = bundle.zipped ? bundle.path.replace(/\.zip$/, '') : bundle.path
const report = read(path.join(reportDir, 'report.txt'))
check('리포트가 버전을 말한다', report.includes(`plugin=${declared}`), true)
check('리포트에 최근 진단이 들어간다', report.includes('회전 뒤 첫 줄'), true)

console.log(`\ndiag: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
