#!/usr/bin/env node
/**
 * **자동 업데이트 회귀** — "Tabby 를 닫지 않고 갈아끼운다" 를 끝까지 한 번 밟아 본다.
 *
 *   node tools/regress-update.js            # 전부
 *   node tools/regress-update.js --keep     # 끝나고 인스턴스를 남긴다 (눈으로 볼 때)
 *
 * ## 왜 격리 인스턴스가 따로 필요한가
 *
 * `tools/test-instance.ps1` 은 플러그인을 **junction** 으로 건다(작업 중인 소스가 그대로 뜬다).
 * 그건 개발 설치라 `canSelfUpdate` 가 막는다 — 막는 게 맞다. npm 이 소스 트리를 덮어쓴다.
 * 그래서 여기서는 **진짜 npm 설치본**을 깐 인스턴스를 따로 만든다.
 *
 * ## 어떻게 "새 버전" 을 만드나
 *
 * 배포된 버전을 깔면 그 안에 검증할 코드가 없다(리로드 복구는 이번 판에 들어갔다).
 * 그래서 **지금 소스로 tgz 를 두 벌** 만다 — 같은 코드에 버전만 다르게 —
 *  - 처음 설치: 버전을 한 칸 낮춘 tgz (= "옛 버전인 척")
 *  - 업데이트: 제 버전 그대로인 tgz 를 `-Spec` 으로 깔게 한다
 * 이러면 **양쪽 다 이번 판 코드**라, 짐을 쓰는 쪽과 읽는 쪽이 모두 검증 대상이 된다.
 *
 * ## 무엇을 고정하나
 *
 *  - `U1` 설치 전 상태 — 개발 설치가 아니고(`canSelfUpdate`) 버전이 낮다
 *  - `U2` Tabby 가 **떠 있는 채로** 설치가 끝난다 (npm 이 폴더를 갈아끼운다)
 *  - `U3` 설치 뒤 디스크 버전이 올라간다 (`installedVersion`)
 *  - `U4` 창이 새로 고쳐지고 **세션 탭이 그대로** 돌아온다 (개수 — Welcome 처럼 pty 없는 탭은 대상 아님)
 *  - `U5` 돌아온 탭이 **같은 pty** 다 (ptyID 동일 — 세션이 안 끊겼다는 유일한 증거)
 *  - `U6` 리로드 뒤 도는 코드가 **새 버전**이다 (`pluginVersion`)
 *  - `U7` Tabby 프로세스가 그대로다 (pid 동일 — "재시작이 아니라 리로드")
 */
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PORT = 9223
const BASE = path.join(process.env.LOCALAPPDATA, 'tabby-agentdeck-upd')
// **config 와 user-data 를 같은 폴더에 둔다.** 갈라 두면 Tabby 는 플러그인을 `userData/plugins`
// 에서 찾는데 우리 `pluginsDir()` 은 config 경로에서 유도해(`getConfigPath()/../plugins`)
// 서로 다른 폴더를 가리킨다 — 실측(2026-09-14): 설치는 `cfg\plugins` 로 갔는데 뜬 플러그인은
// 딴 것이라 U1·U3 이 엉뚱한 값을 쟀다. 한 폴더로 묶으면 제품이 보는 곳과 회귀가 보는 곳이 같다
const UD = path.join(BASE, 'ud')
const CFG = UD
const PLUGINS = path.join(UD, 'plugins')
const PKG_DIR = path.join(PLUGINS, 'node_modules', 'tabby-agentdeck')
const TABBY = path.join(process.env.LOCALAPPDATA, 'Programs', 'Tabby', 'Tabby.exe')
/** tgz 두 벌을 두는 곳 — `plugins/package.json` 이 `file:` 상대경로로 기억하므로 자리가 안정적이어야 한다 */
const TGZ_DIR = path.join(BASE, 'tgz')
const KEEP = process.argv.includes('--keep')

const cases = []
const add = (id, name, pass, detail) => {
    cases.push({ id, name, pass, detail })
    const mark = pass === null ? '· skip' : pass ? '  ok  ' : ' FAIL '
    console.log(`${mark} ${id} ${name}${detail ? ` — ${detail}` : ''}`)
}

const ps = (script, args = []) => spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { encoding: 'utf8' })

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * `.cmd` 는 `shell: true` 없이는 못 돈다 — Node 20 이 배치 파일 직접 실행을 막았다
 * (CVE-2024-27980 대응). 없으면 `spawnSync npm.cmd EINVAL` 로 떨어진다.
 */
const npm = (args, opts = {}) => execFileSync('npm.cmd', args, { encoding: 'utf8', shell: true, ...opts })

/** 렌더러에서 표현식 하나를 돌리고 값을 받는다 (`tools/cdp.js` 재사용) */
function evalInTabby (expression) {
    const file = path.join(os.tmpdir(), `agentdeck-regress-${Date.now()}.js`)
    fs.writeFileSync(file, expression, 'utf8')
    try {
        const out = execFileSync(process.execPath, [path.join(__dirname, 'cdp.js'), String(PORT), file],
            { encoding: 'utf8', timeout: 120000 })
        return JSON.parse(out)
    } finally {
        fs.rmSync(file, { force: true })
    }
}

/** 조건이 설 때까지 기다린다 — 리로드 중에는 CDP 붙기 자체가 실패하므로 예외도 그냥 넘긴다 */
async function waitFor (fn, ms, label) {
    const t0 = Date.now()
    for (;;) {
        try {
            const v = await fn()
            if (v) {
                return v
            }
        } catch { /* 아직 안 떴다 */ }
        if (Date.now() - t0 > ms) {
            throw new Error(`시간 초과: ${label}`)
        }
        await sleep(500)
    }
}

/** 이 회귀가 띄운 Tabby 만 고른다 — 실사용 Tabby 는 절대 건드리지 않는다 */
function ourTabbyPids () {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" | `
        + `Where-Object { $_.CommandLine -like '*tabby-agentdeck-upd*' } | `
        + 'Select-Object -ExpandProperty ProcessId'], { encoding: 'utf8' })
    return (r.stdout || '').split(/\s+/).filter(Boolean).map(Number)
}

function killOurs () {
    for (const pid of ourTabbyPids()) {
        spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force`])
    }
}

const CONFIG_YAML = `version: 4
profiles:
  - type: local
    id: local:upd-ps
    name: UpdPS
    options:
      command: powershell.exe
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass']
      cwd: ${BASE.replace(/\\/g, '/')}
    icon: fas fa-terminal
terminal:
  profile: local:upd-ps
  useConPTY: false
  rightClick: 'off'
  font: Consolas
  fontSize: 14
recoverTabs: false
enablePlugins: true
agentDeck:
  enabled: true
  autoUpdate: false
`

async function main () {
    // ── 준비 ────────────────────────────────────────────────────────────────
    console.log('tgz 두 벌 만드는 중 (npm pack — build:release + check-release 가 같이 돈다)…')
    fs.rmSync(TGZ_DIR, { recursive: true, force: true })
    fs.mkdirSync(TGZ_DIR, { recursive: true })

    // ① 새 버전 = 지금 소스 그대로
    const newName = npm(['pack', '--pack-destination', JSON.stringify(TGZ_DIR)], { cwd: ROOT })
        .trim().split(String.fromCharCode(10)).pop().trim()
    const tgzNew = path.join(TGZ_DIR, newName)
    const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

    // ② 옛 버전 = 같은 코드에 **버전만 한 칸 낮춘** 패키지.
    //
    // 설치본의 package.json 을 손으로 고치는 방법은 **안 통한다** — npm 은 `file:` 의존성을
    // 경로로 판정해서 "이미 그 tgz 다" 라며 폴더를 그대로 둔다(실측 2026-09-14: `added 1 package`
    // 라고 찍고도 1.1.2 그대로). 버전이 진짜 다른 패키지를 따로 말아야 업그레이드가 일어난다.
    const older = real.replace(/(\d+)$/, (_, n) => String(Math.max(0, Number(n) - 1)))
    const oldDir = path.join(TGZ_DIR, 'old')
    fs.mkdirSync(oldDir, { recursive: true })
    const manifestSrc = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    for (const item of ['dist', 'hooks', 'updater', 'install.ps1', 'CHANGELOG.md', 'README.ko.md']) {
        const from = path.join(ROOT, item)
        if (fs.existsSync(from)) {
            fs.cpSync(from, path.join(oldDir, item), { recursive: true })
        }
    }
    manifestSrc.version = older
    manifestSrc.scripts = {}   // prepack 이 여기서 또 돌면 안 된다 (빌드는 이미 끝났다)
    fs.writeFileSync(path.join(oldDir, 'package.json'), JSON.stringify(manifestSrc, null, 2), 'utf8')
    const oldName = npm(['pack', '--pack-destination', JSON.stringify(TGZ_DIR)], { cwd: oldDir })
        .trim().split(String.fromCharCode(10)).pop().trim()
    const tgzOld = path.join(TGZ_DIR, oldName)
    console.log(`  옛 ${older} = ${oldName} / 새 ${real} = ${newName}`)

    killOurs()
    await sleep(500)
    fs.rmSync(UD, { recursive: true, force: true })
    fs.mkdirSync(CFG, { recursive: true })
    fs.mkdirSync(PLUGINS, { recursive: true })
    fs.writeFileSync(path.join(CFG, 'config.yaml'), CONFIG_YAML, 'utf8')
    fs.writeFileSync(path.join(PLUGINS, 'package.json'), '{ "dependencies": {} }', 'utf8')

    console.log('격리 플러그인 폴더에 옛 버전 설치 중…')
    npm(['install', '--prefix', PLUGINS, '--no-audit', '--no-fund', JSON.stringify(tgzOld)], { stdio: 'pipe' })
    const manifest = path.join(PKG_DIR, 'package.json')

    // ── 기동 ────────────────────────────────────────────────────────────────
    //
    // **부모 환경을 반드시 씻는다.** 이 회귀는 보통 Tabby 안의 셸에서 돌고, 그 셸은
    // `NODE_PATH` 에 **실사용 플러그인 경로**(`%APPDATA%\tabby\plugins\node_modules` = 소스 junction)를
    // 물고 있다. Tabby 는 자기 경로를 그 **뒤에** 붙이므로 node 가 `tabby-agentdeck` 을 찾을 때
    // 소스 트리가 먼저 걸린다 — 격리 인스턴스인데 실사용 플러그인이 뜬다.
    // 실측(2026-09-14): `--user-data-dir` 은 제대로 먹었는데(`userData` 가 우리 폴더)
    // `marks={hasSrc:true,hasGit:true}` · `version=1.1.3`(설치본은 1.1.2) 이 나왔다.
    // 업데이트 로그는 실행마다 쌓인다 — **이번 실행분만** 봐야 지난 실행의 성공을 오늘 것으로 읽지 않는다
    const UPDATE_LOG = path.join(process.env.LOCALAPPDATA, 'tabby-agentdeck', 'update.log')
    const logBefore = fs.existsSync(UPDATE_LOG) ? fs.statSync(UPDATE_LOG).size : 0

    const env = { ...process.env, TABBY_CONFIG_DIRECTORY: CFG, AGENTDECK_DIAG_DIR: CFG }
    delete env.NODE_PATH
    delete env.TABBY_PLUGINS
    spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Start-Process -FilePath '${TABBY}' -ArgumentList '--user-data-dir=${UD}','--remote-debugging-port=${PORT}'`],
    { env, encoding: 'utf8' })

    await waitFor(() => evalInTabby('(function(){ return !!(window.__agentdeck && window.__agentdeck.update) })()'),
        60000, '플러그인 기동')
    const pidBefore = ourTabbyPids().sort().join(',')

    // ── U1 설치 전 상태 ──────────────────────────────────────────────────────
    const before = evalInTabby(`(function(){
        const u = window.__agentdeck.update
        return { version: u.version(), onDisk: u.installedVersion(), canSelfUpdate: u.canSelfUpdate(), marks: u.marks() }
    })()`)
    add('U1', '개발 설치가 아니고 버전이 낮다', before.canSelfUpdate && before.version === older,
        `version=${before.version} canSelfUpdate=${before.canSelfUpdate} marks=${JSON.stringify(before.marks)}`)

    // 탭 두 개를 열고 pty id 를 기억해 둔다 — 세션이 살아남았다는 증거는 이것뿐이다.
    // 탭은 **사이드바의 `+ 새 탭` 을 눌러** 연다(`probe-group.js` 와 같은 이유: `ProfilesService` 는
    // 진단구에 없어서 제품 경로로 여는 길이 이것뿐이다)
    const opened = evalInTabby(`(async function(){
        const ad = window.__agentdeck
        const app = ad.app
        const ptysOf = () => {
            const out = []
            for (const t of app.tabs) {
                const panes = typeof t.getAllTabs === 'function' ? t.getAllTabs() : [t]
                for (const p of panes) {
                    const id = p.session && typeof p.session.getID === 'function' ? p.session.getID() : null
                    if (id) { out.push(String(id)) }
                }
            }
            return out
        }
        // **세션 있는 탭**이 두 개가 될 때까지 연다. app.tabs 에는 Welcome 처럼 pty 가 없는 탭이
        // 섞이는데(기동 직후 한 장 떠 있다) 그건 복구 토큰이 없어 리로드 뒤 살아나지 않는다 —
        // 그걸 세면 "탭이 사라졌다" 고 오판한다 (실측 2026-09-14: tabs=2 인데 토큰은 1개였다)
        const btn = document.querySelector('#agentdeck-sidebar .ad-new')
        for (let i = 0; ptysOf().length < 2 && i < 5; i++) {
            if (btn) { btn.click() }
            await new Promise(r => setTimeout(r, 1500))
        }
        await new Promise(r => setTimeout(r, 1500))
        // 세션이 붙기 전에는 getID() 가 null 이다 — 두 개가 다 설 때까지 기다린다
        // (여기는 템플릿 문자열 안이라 역따옴표를 쓰면 문자열이 거기서 끊긴다)
        for (let i = 0; i < 20 && ptysOf().length < 2; i++) {
            await new Promise(r => setTimeout(r, 500))
        }
        return { tabs: app.tabs.length, ptys: ptysOf(), hadButton: !!btn }
    })()`)
    console.log(`  탭 ${opened.tabs}개, pty ${JSON.stringify(opened.ptys)}`)

    // ── U2·U3 설치 ──────────────────────────────────────────────────────────
    // 리로드가 곧바로 이어지므로 이 evaluate 는 응답을 못 받고 끊길 수 있다. 그건 실패가 아니다
    let outcome = null
    try {
        // 값을 객체로 감싼다 — cdp.js 는 문자열이면 따옴표 없이 그대로 찍어서 JSON.parse 가 깨진다
        outcome = evalInTabby('(async function(){ return { outcome: await window.__agentdeck.update'
            + `.installAndReload(${JSON.stringify(real)}, ${JSON.stringify(tgzNew.replace(/\\/g, '/'))}) } })()`)
    } catch (e) {
        outcome = `(응답 끊김: ${e.message.split('\n')[0]})`
    }
    console.log(`  installAndReload -> ${JSON.stringify(outcome)}`)

    // **바이트로 자른다.** 로그가 한글이라 `size`(바이트)로 문자열을 자르면 훨씬 멀리 잘려
    // 이번 실행분이 통째로 사라진다 (실측: U2 가 로그를 못 찾아 실패했다)
    const logText = fs.existsSync(UPDATE_LOG)
        ? fs.readFileSync(UPDATE_LOG).slice(logBefore).toString('utf8')
        : ''
    add('U2', 'Tabby 가 떠 있는 채로 설치가 끝났다',
        /InPlace — Tabby 종료를 기다리지 않는다/.test(logText) && /OK 설치 완료/.test(logText),
        logText.split('\n').filter(l => /InPlace|OK 설치|FAIL/.test(l)).slice(-2).join(' / '))

    const onDisk = JSON.parse(fs.readFileSync(manifest, 'utf8')).version
    add('U3', '디스크 버전이 올라갔다', onDisk === real, `${older} -> ${onDisk}`)

    // ── U4~U7 리로드 뒤 ─────────────────────────────────────────────────────
    const after = await waitFor(() => {
        const v = evalInTabby(`(function(){
            const ad = window.__agentdeck
            if (!ad || !ad.update) { return null }
            const app = ad.app
            const ptys = []
            for (const t of app.tabs) {
                const panes = typeof t.getAllTabs === 'function' ? t.getAllTabs() : [t]
                for (const p of panes) {
                    const id = p.session && typeof p.session.getID === 'function' ? p.session.getID() : null
                    if (id) { ptys.push(String(id)) }
                }
            }
            return { version: ad.update.version(), tabs: app.tabs.length, ptys: ptys }
        })()`)
        // 리로드 직후에는 복구가 아직 안 끝나 탭이 0~1 개다. 탭 수만 보면 세션이 붙기 전에
        // 통과해 pty 가 비어 보인다 — **pty 가 다 설 때까지** 기다린다
        return v && v.ptys.length >= opened.ptys.length ? v : null
    }, 90000, '리로드 후 탭 복구')

    // 세는 것은 **세션 있는 탭**이다 (위 `ptysOf` 주석) — Welcome 같은 빈 탭은 복구 대상이 아니다
    add('U4', '세션 탭이 그대로 돌아왔다', after.ptys.length === opened.ptys.length,
        `${opened.ptys.length}개 -> ${after.ptys.length}개 (app.tabs ${opened.tabs} -> ${after.tabs})`)
    add('U5', '같은 pty 다 (세션이 안 끊겼다)',
        JSON.stringify(after.ptys.slice().sort()) === JSON.stringify(opened.ptys.slice().sort()),
        `${JSON.stringify(opened.ptys)} -> ${JSON.stringify(after.ptys)}`)
    add('U6', '새 버전 코드가 돈다', after.version === real, `${before.version} -> ${after.version}`)
    const pidAfter = ourTabbyPids().sort().join(',')
    add('U7', 'Tabby 프로세스가 그대로다 (재시작이 아니다)', pidBefore === pidAfter,
        `pid ${pidBefore} -> ${pidAfter}`)

    if (!KEEP) {
        killOurs()
        fs.rmSync(TGZ_DIR, { recursive: true, force: true })
    }

    const fail = cases.filter(c => c.pass === false).length
    console.log(`\n${cases.length - fail} ok, ${fail} fail`)
    process.exit(fail ? 1 : 0)
}

main().catch(e => {
    console.error('ERR', e.message)
    if (!KEEP) {
        killOurs()
    }
    process.exit(1)
})
