/**
 * 문서용 스크린샷의 **화면을 만든다** (자르고 찍는 것은 `cdp.js --shot`).
 *
 *   powershell -File tools/test-instance.ps1
 *   node tools/shot-guide.js            # 아래 장면들을 순서대로 세우고 docs/guide/img/*.png 로 저장
 *
 * **왜 만들어 찍나 —** 그때그때의 화면을 찍으면 그림이 그 순간의 상태에 묶여 다시 만들 수
 * 없고, 문서가 설명하는 것과 화면이 어긋나도 알아채지 못한다. 이제 화면을 **지어서** 찍는다 —
 * 세션 이름·폴더·문서는 전부 이 파일 안의 샘플이고, 같은 명령이 언제나 같은 그림을 낸다.
 *
 * 장면은 `%TEMP%\agentdeck-guide\scene.txt` 로 고른다 (cdp.js 는 표현식 파일 하나만 받는다).
 * 만든 것(탭·임시 폴더·상태 파일)은 마지막 장면 `cleanup` 에서 되돌린다.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')

    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다' }) }

    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const ROOT = path.join(os.tmpdir(), 'agentdeck-guide')
    const scene = fs.existsSync(path.join(ROOT, 'scene.txt'))
        ? fs.readFileSync(path.join(ROOT, 'scene.txt'), 'utf8').trim()
        : 'overview'

    /**
     * 그림에 쓰는 작업 폴더와 세션. 문서가 설명하는 기능(그룹·상태·경과시간·승인 이유)이
     * 한 화면에 다 보이도록 고른 조합이다
     */
    const DEMO = [
        { dir: 'api-server',  label: '로그인 토큰 만료 버그',   status: 'running', ago: 25 },
        { dir: 'api-server',  label: '주문 API 타임아웃 재현',  status: 'waiting', reason: 'Bash 권한', ago: 7 },
        { dir: 'tools',       label: '빌드 캐시 정리 스크립트', status: 'idle',    ago: 25 },
        { dir: 'web-client',  label: '장바구니 합계 반올림',    status: 'done',    ago: 25 },
    ]

    const STATUS_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'tabby-agentdeck', 'status')
    const sid = i => `agentdeck-guide-${i}`
    /** 훅과 **같은 모양**의 보고 — 작업 폴더를 이 값으로 못 박는다(그룹 이름의 원천) */
    const report = (i, tabId, cwd) => {
        fs.mkdirSync(STATUS_DIR, { recursive: true })
        fs.writeFileSync(path.join(STATUS_DIR, sid(i) + '.json'), JSON.stringify({
            sessionId: sid(i), status: 'running', ts: Date.now(), tabId, cwd,
        }), 'utf8')
    }

    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    const newTabBtn = () => {
        const sb = document.getElementById('agentdeck-sidebar')
        return sb ? sb.querySelector('.ad-new') : null
    }

    if (scene === 'cleanup') {
        ad.config.store.agentDeck.resumeList = true
        ad.config.store.agentDeck.collapsedGroups = []
        const menu = document.querySelector('.ad-menu')
        if (menu) { menu.remove() }
        for (let i = 0; i < 8; i++) {
            try { fs.unlinkSync(path.join(STATUS_DIR, sid(i) + '.json')) } catch (e) { /* 이미 없다 */ }
        }
        try { ad.view().setOpen(false) } catch (e) { /* 패널이 없다 */ }
        for (const t of [...ad.app.tabs]) { try { ad.app.closeTab(t, false) } catch (e) { /* 이미 닫혔다 */ } }
        try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch (e) { /* 남아도 무해 */ }
        return JSON.stringify({ scene, cleaned: true })
    }

    // ── 한 번만: 폴더·탭·상태를 세운다 ──
    if (ad.app.tabs.length < DEMO.length) {
        // 지난 세션 서랍을 끈다 — 이 장면에 필요 없고, 돌리는 PC 마다 줄 수가 달라
        // 같은 그림이 안 나온다
        ad.config.store.agentDeck.resumeList = false
        // 창 기본값(Welcome 탭)은 터미널이 아니라 우리 샘플과 섞이면 줄이 하나 더 는다
        for (const t of [...ad.app.tabs]) {
            const isTerm = typeof t.getAllTabs === 'function'
                ? t.getAllTabs().some(p => p.frontend && p.frontend.xterm)
                : !!(t.frontend && t.frontend.xterm)
            if (!isTerm) { try { ad.app.closeTab(t, false) } catch (e) { /* 이미 닫혔다 */ } }
        }
        await sleep(400)
        for (const d of ['api-server', 'tools', 'web-client']) {
            fs.mkdirSync(path.join(ROOT, d), { recursive: true })
        }
        // 미리보기에 띄울 샘플 문서 — 가상의 버그 분석이다
        fs.writeFileSync(path.join(ROOT, 'api-server', '로그인_토큰_분석.md'), [
            '# 로그인 토큰 만료 — 원인', '',
            '## 결론', '',
            '`refresh_token` 의 TTL 이 access token 과 같아서, 갱신 시점에 둘이 함께 죽는다.', '',
            '| 무엇 | 어디 | 비고 |',
            '|---|---|---|',
            '| TTL 설정 | `AuthConfig.cs:48` | 두 토큰이 같은 상수를 쓴다 |',
            '| 갱신 경로 | `RefreshAsync()` | 만료 검사 전에 재발급한다 |', '',
            '## 재현', '',
            '1. 로그인 후 access token 만료까지 대기',
            '2. 갱신 요청 → 401',
            '3. 재로그인하면 정상', '',
        ].join('\n'), 'utf8')

        // `변경` 탭에 보여줄 **샘플 저장소**. 아무 폴더나 쓰면 그 PC 에 있는 것이 그대로
        // 목록이 되어 돌릴 때마다 다른 그림이 나온다 — 변경 내용까지 여기서 만든다
        try {
            const cpx = require('child_process')
            const repo = path.join(ROOT, 'web-client')
            const run = (args) => cpx.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true })
            if (!fs.existsSync(path.join(repo, '.git'))) {
                cpx.execFileSync('git', ['init', '-q', repo], { windowsHide: true })
                run(['config', 'user.email', 'sample@example.com'])
                run(['config', 'user.name', 'sample'])
                fs.writeFileSync(path.join(repo, 'cart.js'), [
                    'export function total (items) {',
                    '    let sum = 0',
                    '    for (const it of items) {',
                    '        sum += it.price * it.qty',
                    '    }',
                    '    return Math.round(sum)',
                    '}',
                    '',
                ].join('\n'), 'utf8')
                fs.writeFileSync(path.join(repo, 'README.md'), '# web-client\n\n샘플 저장소입니다.\n', 'utf8')
                run(['add', '-A'])
                run(['commit', '-q', '-m', 'first'])
                // 그림에 보일 변경 — 반올림 자리를 고치고 파일 하나를 새로 만든다
                fs.writeFileSync(path.join(repo, 'cart.js'), [
                    'export function total (items) {',
                    '    let sum = 0',
                    '    for (const it of items) {',
                    '        // 통화 단위로 먼저 반올림한다 — 합산 뒤에 하면 항목마다 오차가 쌓인다',
                    '        sum += Math.round(it.price * it.qty)',
                    '    }',
                    '    return sum',
                    '}',
                    '',
                ].join('\n'), 'utf8')
                fs.writeFileSync(path.join(repo, 'cart.test.js'),
                    "import { total } from './cart.js'\n\ntest('합계는 항목마다 반올림한다', () => {\n"
                    + "    expect(total([{ price: 1.5, qty: 3 }])).toBe(5)\n})\n", 'utf8')
            }
        } catch (e) { /* git 이 없으면 `변경` 그림만 밋밋해진다 */ }

        while (ad.app.tabs.length < DEMO.length) {
            const before = ad.app.tabs.length
            const b = newTabBtn()
            if (!b) { break }
            b.click()
            for (let i = 0; i < 30 && ad.app.tabs.length === before; i++) { await sleep(300) }
            if (ad.app.tabs.length === before) { break }
        }
        // 셸이 떠서 AGENTDECK_TAB 표가 채워질 때까지
        for (let i = 0; i < 20; i++) {
            if ((ad.tabIds() || []).filter(r => (r.ids || []).length).length >= DEMO.length) { break }
            await sleep(300)
        }
        const rows = ad.tabIds() || []
        DEMO.forEach((d, i) => {
            const id = ((rows[i] || {}).ids || [])[0]
            if (id) { report(i, id, path.join(ROOT, d.dir)) }
        })
        await sleep(1500)
    }

    /** 라벨·상태·경과시간을 못 박는다 (매 장면 다시 — 자동 감지가 건드릴 수 있다) */
    const applyRows = () => {
        ad.app.tabs.forEach((tab, i) => {
            const d = DEMO[i]
            if (!d) { return }
            ad.status.setManual(tab, d.status, d.label, d.reason || '')
            ad.status.get(tab).since = Date.now() - d.ago * 1000
        })
        ad.render()
    }
    applyRows()

    const view = () => ad.view()
    const setSearch = q => ad.setFilter(q, null)

    /** 그 그룹 줄을 화면에서 찾는다 — 헤더 라벨로 (키는 폴더 경로라 길다) */
    const headerByLabel = label => Array.from(
        document.querySelectorAll('#agentdeck-sidebar .ad-group-head')
    ).find(h => (h.textContent || '').includes(label))

    // 앞 장면이 남긴 것을 먼저 치운다 — 열린 메뉴는 **다음 그림을 통째로 덮고**(접힘 그림에
    // 상태 메뉴가 얹혀 나온 적이 있다) 접어 둔 그룹은 다음 화면의 줄 수를 바꾼다
    const openMenu = document.querySelector('.ad-menu')
    if (openMenu) { openMenu.remove() }
    ad.config.store.agentDeck.collapsedGroups = []

    switch (scene) {
        case 'overview':
            setSearch('')
            break
        case 'context': {
            // 줄 우클릭 = 상태 직접 지정 메뉴 (`showStatusMenu`). 제품 경로 그대로 태운다
            setSearch('')
            ad.render()
            await sleep(400)
            const row = document.querySelector('#agentdeck-sidebar .ad-tab')
            if (row) {
                const r = row.getBoundingClientRect()
                row.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true, cancelable: true,
                    clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 10),
                }))
            }
            break
        }
        case 'collapse': {
            // 두 그룹을 접는다 — 헤더를 실제로 눌러서 (설정값을 손으로 쓰면 키 형식이 어긋난다)
            setSearch('')
            ad.render()
            await sleep(400)
            for (const label of ['tools', 'web-client']) {
                const h = headerByLabel(label)
                if (h) { h.click(); await sleep(250) }
            }
            break
        }
        case 'search':
            setSearch('타임아웃')
            break
        case 'keyboard': {
            // 포커스 링을 **두 번째 탭 줄**에 둔다 (`alt` 가 말하는 그림). 첫 줄은 그룹 헤더라
            // 거기서 멈추면 "포커스와 선택이 다르다" 가 안 보인다 — 활성 탭은 그대로 다른 줄이다
            setSearch('')
            ad.focusNav('list')
            const list = document.querySelector('#agentdeck-sidebar .ad-list')
            for (let i = 0; i < 2; i++) {
                list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
                await sleep(200)
            }
            break
        }
        case 'viewer':
            setSearch('')
            view().setOpen(true)
            ad.openFile(path.join(ROOT, 'api-server', '로그인_토큰_분석.md'))
            break
        case 'diff': {
            setSearch('')
            // `변경` 은 **활성 탭의 작업 폴더**를 본다 — 샘플 저장소를 쓰는 탭으로 옮긴다
            const i = DEMO.findIndex(d => d.dir === 'web-client')
            const tab = ad.app.tabs[i]
            if (tab) { ad.app.selectTab(tab) }
            await sleep(600)
            view().setOpen(true)
            view().setMode('diff')
            break
        }
        default:
            break
    }
    await sleep(1200)
    ad.render()
    await sleep(400)
    return JSON.stringify({ scene, tabs: ad.app.tabs.length,
    groups: (ad.groups().list || []).map(g => g.label),
    collapsed: (ad.groups().list || []).filter(g => g.collapsedEffective).map(g => g.label),
    menu: !!document.querySelector('.ad-menu'),
    nav: ad.focusNav() })
})()
