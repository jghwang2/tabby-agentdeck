/**
 * 탭 cwd 진실성 회귀 프로브 (CW1~CW5).
 *
 *   powershell -File tools/test-instance.ps1 -Cwd D:\Project\tabby-agentdeck
 *   node tools/cdp.js 9222 tools/probe-cwd.js
 *
 * **무엇을 보나 —** Tabby 의 윈도우 cwd 는 추정이다. `guessWindowsCWD` 가 PTY 출력 조각마다
 * 정규식(`/([a-zA-Z]:[^\:\[\]\?\"\<\>\|]+)/mi`)을 돌려 `X:\…` 로 보이는 첫 토큰을 cwd 로 삼고
 * (tabby-local dist/index.js:1316), `getWorkingDirectory()` 는 그것이 폴더인지 보지 않는다
 * (:1306 — `fs.access` 로 존재만 본다). 그래서 에이전트가 화면에 찍은 **파일 경로**가 그대로
 * 탭의 cwd 가 되고, 미리보기 `변경` 탭이 `git -C …\notes.py` 를 돌려
 * `fatal: cannot change to …: Invalid argument` 로 끝났다 (2026-09-11 실사용 실측).
 *
 * 그래서 두 겹을 잰다 — ① 훅이 말해 준 cwd 가 추정을 이긴다 ② 훅이 없어도 **폴더가 아닌 값은
 * 받지 않는다.** 덤으로 ③ 그 cwd 로 `변경` 탭이 실제로 git 을 돌리는지, ④ 설정 파일이
 * 화면을 가로채지 않는지(자동 열기 제외)까지 같은 자리에서 본다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary` (probe-all.js 와 같은 모양).
 *   pass=true 통과 / false 실패 / null = 판정 불가(환경이 조건을 못 만듦)
 *
 * **자기가 바꾼 것은 되돌린다** — 스텁한 `getWorkingDirectory`, 만든 픽스처, 연 패널, 쓴 상태 파일.
 * 상태 파일은 `%LOCALAPPDATA%\tabby-agentdeck\status` 라 실사용 Tabby 와 공용이다. 그래서
 * **격리 인스턴스의 tabId 를 실어 보낸다** — 실사용 쪽 표에는 없는 id 라 거기서는 `tabid-miss`
 * 로 버려지고(notify.service `resolveTab`) 남의 사이드바를 건드리지 않는다.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')

    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    const el = () => document.getElementById('agentdeck-view')
    const bodyText = () => {
        const b = el() && el().querySelector('.ad-view-body')
        return (b && b.textContent) || ''
    }
    const chips = () => Array.from((el() || document).querySelectorAll('.ad-view-tab')).map(c => c.textContent)
    const btn = label => Array.from((el() || document).querySelectorAll('button'))
        .find(b => (b.textContent || '').trim() === label)
    const view = () => (ad.view ? ad.view() : {})

    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    /** `__agentdeck.groups().cwdCache` 가 화면과 같은 원천이다 — 사본을 만들지 않는다 */
    const cwdOfIndex = i => {
        const row = (ad.groups().cwdCache || [])[i]
        return row ? row.dir : null
    }
    /** 출력 구독을 태운다 (xterm.write 는 구독을 못 태운다 — probe-viewer.js 머리주석) */
    const feed = (pane, text) => {
        const s = pane.session
        if (s && s.output && typeof s.output.next === 'function') {
            s.output.next(text)
            return 'output.next'
        }
        if (s && typeof s.emitOutput === 'function') {
            s.emitOutput(require('buffer').Buffer.from(text, 'utf8'))
            return 'emitOutput(Buffer)'
        }
        return null
    }

    const STATUS_DIR = ad.runtimePaths().status
    const SESSION_ID = 'adprobe-cwd'
    const STATUS_FILE = path.join(STATUS_DIR, SESSION_ID + '.json')
    /** 훅이 쓰는 것과 **같은 모양**의 보고를 남긴다 (hooks/agentdeck-notify.ps1 payload) */
    const report = (tabId, cwd) => {
        fs.mkdirSync(STATUS_DIR, { recursive: true })
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
            sessionId: SESSION_ID, status: 'running', ts: Date.now(), tabId, cwd,
        }), 'utf8')
    }

    /** 첫 터미널 탭을 확보한다 — 격리 인스턴스는 `Welcome` 탭만 들고 뜰 수 있다 */
    const ensurePane = async () => {
        if (panes().length) { return }
        const sb0 = document.getElementById('agentdeck-sidebar')
        const b = sb0 ? sb0.querySelector('.ad-new') : null
        if (!b) { return }
        b.click()
        for (let i = 0; i < 25 && !panes().length; i++) { await sleep(300) }
        // 셸이 프롬프트를 찍고 AGENTDECK_TAB 표가 채워질 때까지
        for (let i = 0; i < 15 && !((ad.tabIds()[0] || {}).ids || []).length; i++) { await sleep(300) }
    }
    await ensurePane()

    const pane0 = panes()[0]
    const tab0 = pane0 ? (ad.app.tabs.find(t => t === pane0 || (typeof t.getAllTabs === 'function'
        && t.getAllTabs().indexOf(pane0) >= 0)) ?? ad.app.tabs[0]) : ad.app.tabs[0]
    const tabIdRow = (ad.tabIds() || []).find(r => (r.ids || []).length) || (ad.tabIds() || [])[0]
    const tabId = tabIdRow ? (tabIdRow.ids || [])[0] : null
    const stubbed = []
    const madeTabs = []
    /** `변경` 탭 검사에 쓸 저장소 — 이 플러그인 자신 (없으면 CW4 는 판정 불가) */
    const REPO = 'D:\\Project\\tabby-agentdeck'
    /** 사이드바 `+ 새 탭` — 제품 경로로 탭을 여는 유일한 창구 (probe-perf.js 와 같은 이유) */
    const newTabBtn = () => {
        const sb = document.getElementById('agentdeck-sidebar')
        return sb ? sb.querySelector('.ad-new') : null
    }

    try {
        // ---------- CW1: 훅이 말해 준 cwd 가 탭 cwd 가 된다 ----------
        if (!tabId || !pane0) {
            add('CW1', '훅 보고의 cwd 가 탭에 반영된다', null,
                'tabId 나 터미널 패널이 없다 — 격리 인스턴스가 탭 하나로 떠 있어야 한다',
                { tabId, panes: panes().length })
        } else {
            const want = path.join(os.homedir(), '.claude')
            report(tabId, want)
            let got = null
            for (let i = 0; i < 12 && got !== want; i++) {
                await sleep(200)
                got = cwdOfIndex(ad.app.tabs.indexOf(tab0))
            }
            add('CW1', '훅 보고의 cwd 가 탭에 반영된다', got === want,
                got === want ? '' : '폴링(400ms) 12회 안에 안 잡혔다',
                { tabId, want, got })
        }

        // ---------- CW2: 훅 cwd 가 있으면 Tabby 의 추정이 덮지 못한다 ----------
        // 실사고 재현 — 에이전트가 화면에 찍은 스크래치패드 파일 경로를 추정이 물어 온 상황
        const FAKE_FILE = path.join(os.tmpdir(), 'adprobe_scratch.py')
        fs.writeFileSync(FAKE_FILE, '# probe\n', 'utf8')
        if (!pane0 || !pane0.session) {
            add('CW2', '훅 cwd 는 Tabby 추정에 덮이지 않는다', null, '터미널 세션이 없다', {})
        } else {
            const s = pane0.session
            const orig = s.getWorkingDirectory
            s.getWorkingDirectory = async () => FAKE_FILE
            stubbed.push(() => { s.getWorkingDirectory = orig })
            const how = feed(pane0, 'probe ' + FAKE_FILE + '\r\n')
            await sleep(900)
            const got = cwdOfIndex(ad.app.tabs.indexOf(tab0))
            add('CW2', '훅 cwd 는 Tabby 추정에 덮이지 않는다', how ? got !== FAKE_FILE : null,
                how ? '' : '출력 구독을 태울 수 없다',
                { fed: how, stubReturns: FAKE_FILE, got })
        }

        // ---------- CW3: 훅이 없어도 폴더가 아닌 추정값은 받지 않는다 ----------
        // 훅 보고를 지우고(= Codex·Gemini·맨 셸과 같은 상태) 같은 추정을 다시 먹인다
        if (!pane0 || !pane0.session) {
            add('CW3', '폴더가 아닌 추정값은 cwd 로 받지 않는다', null, '터미널 세션이 없다', {})
        } else {
            try { fs.unlinkSync(STATUS_FILE) } catch (e) { /* 이미 없다 */ }
            // 훅 값은 탭에 남아 있으므로 새 탭으로 본다 — 훅이 한 번도 안 붙은 탭이 이 검사의 대상이다
            const before = ad.app.tabs.length
            const nb = newTabBtn()
            if (nb) { nb.click() }
            for (let i = 0; i < 20 && ad.app.tabs.length <= before; i++) { await sleep(200) }
            const fresh = panes()[panes().length - 1]
            const freshTab = ad.app.tabs[ad.app.tabs.length - 1]
            if (ad.app.tabs.length > before) { madeTabs.push(freshTab) }
            if (ad.app.tabs.length <= before || !fresh || !fresh.session) {
                add('CW3', '폴더가 아닌 추정값은 cwd 로 받지 않는다', null,
                    '새 탭을 못 열었다 — 프로필/프로세스 문제', { before, after: ad.app.tabs.length })
            } else {
                const s2 = fresh.session
                const orig2 = s2.getWorkingDirectory
                s2.getWorkingDirectory = async () => FAKE_FILE
                stubbed.push(() => { s2.getWorkingDirectory = orig2 })
                const how = feed(fresh, 'probe ' + FAKE_FILE + '\r\n')
                await sleep(1200)
                const got = cwdOfIndex(ad.app.tabs.indexOf(freshTab))
                add('CW3', '폴더가 아닌 추정값은 cwd 로 받지 않는다', how ? got !== FAKE_FILE : null,
                    how ? '' : '출력 구독을 태울 수 없다',
                    { fed: how, stubReturns: FAKE_FILE, got })
            }
        }

        // CW3 가 연 탭을 정리하고 첫 탭으로 돌아온다 — 패널은 **활성 탭**을 보므로
        // 여기서 돌려놓지 않으면 뒤의 두 검사가 엉뚱한 탭을 재게 된다
        for (const t of madeTabs.splice(0)) { try { ad.app.closeTab(t, false) } catch (e) { /* 이미 닫혔다 */ } }
        try { ad.app.selectTab(tab0) } catch (e) { /* 탭이 하나뿐 */ }
        await sleep(600)

        // ---------- CW4: 그 cwd 로 `변경` 탭이 실제로 git 을 돌린다 ----------
        // 이미지 1 의 사고가 끝난 자리 — 저장소를 cwd 로 주면 목록이 나와야 한다
        if (!tabId || !fs.existsSync(path.join(REPO, '.git'))) {
            add('CW4', '`변경` 탭이 cwd 의 저장소를 읽는다', null,
                tabId ? REPO + ' 가 git 저장소가 아니다' : 'tabId 가 없다', { REPO })
        } else {
            report(tabId, REPO)
            await sleep(900)
            ad.view().setOpen(true)
            const b = btn('변경')
            if (b) { b.click() }
            let text = ''
            for (let i = 0; i < 15; i++) {
                await sleep(300)
                text = bodyText()
                if (/개 파일|변경 없음/.test(text)) { break }
            }
            const head = (el() && el().querySelector('.ad-view-status'))
            const stat = (head && head.textContent) || ''
            // **본문 글자로 실패를 판정하면 안 된다** — 이 저장소의 diff 안에는 실패 문구
            // ("Invalid argument", "폴더가 아니다")가 **소스 코드로** 들어 있어서 오탐이 난다
            // (2026-09-11 실측: CW4 가 그 이유로 false 였다). 실패는 구조로 본다 —
            // `renderDiffNote` 는 `.ad-view-empty` 를, 목록은 파일 줄(`.ad-view-file`)을 만든다
            const listed = /개 파일|변경 없음/.test(stat + text)
            const body = el() && el().querySelector('.ad-view-body')
            // **`.ad-view-empty` 가 있다고 실패가 아니다** (2026-09-15 실측: 작업트리가 깨끗한 채로
            // 전수를 돌리니 CW4 만 false 였고 CW6 은 같은 이유로 null 이었다). git 이 제대로
            // 답했는데 변경이 0개면 `renderDiff` 도 그 노드로 **「변경 없음」**을 그린다
            // (`viewPanel.ts renderDiff`). 실패 안내(`renderDiffNote`)와 구조가 같아서 노드 유무로는
            // 안 갈린다 — 갈리는 것은 **그 안내가 무슨 말을 하느냐**와 **파일 줄이 그려졌느냐**다.
            // 본문 글자로 판정하지 말라는 규칙(위 주석)은 **diff 본문**에 이 저장소의 소스가
            // 실려 오기 때문이고, 안내 문구 자체는 제품이 고른 한 문장이라 그 함정이 없다
            const fileNodes = body ? body.querySelectorAll('.ad-view-diff-file').length : 0
            const emptyEl = body && body.querySelector('.ad-view-empty')
            const emptyText = (emptyEl && emptyEl.textContent) || ''
            const cleanNote = /변경 없음|이 세션이 만진 파일은 아직 없다/.test(emptyText)
            const broke = !!emptyEl && !cleanNote
            const ok = listed && !broke && (fileNodes > 0 || cleanNote)
            add('CW4', '`변경` 탭이 cwd 의 저장소를 읽는다', ok,
                ok ? '' : (broke ? '실패 안내가 떠 있다' : 'git 결과가 안 나왔다'),
                { cwd: REPO, listed, broke, fileNodes, empty: emptyText.slice(0, 80),
                  stat: stat.slice(0, 120), body: text.slice(0, 240) })
        }

        // ---------- CW6: `변경` 목록이 이 세션이 만진 파일로 좁혀진다 ----------
        // 훅이 `file` 을 보고하면 목록이 그 파일만 남고, `전체` 로 바꾸면 저장소 전부가 돌아온다.
        // diff 를 만드는 것은 여전히 git 이다 — 좁히는 것은 **목록뿐**이라는 것을 여기서 못 박는다
        // **보고할 파일은 지금 git 변경 목록에서 고른다.** 예전엔 `src/viewer.ts` 를 박아 뒀는데, 좁히기는
        // "만진 파일 ∩ git 변경" 이라 그 파일이 변경 목록에 없으면 결과가 0줄이 되어 제품이 옳아도 FAIL 이 났다
        // (2026-09-14 실측: viewer.ts 는 커밋돼 변경 16개에 없었고 `diffDebug` 가 `touched=[viewer.ts] kept=0`).
        // 저장소 파일을 고쳐서 픽스처를 만들지는 않는다 — 사용자 작업트리를 건드리게 된다
        let changed = []
        try {
            changed = require('child_process').execFileSync('git', ['-C', REPO, 'diff', '--name-only', 'HEAD'],
                { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean)
        } catch (e) { changed = [] }
        if (!tabId || !fs.existsSync(path.join(REPO, '.git')) || changed.length < 2) {
            add('CW6', '`변경` 은 이 세션이 만진 파일만 그린다', null,
                changed.length < 2 ? `저장소 변경 파일이 ${changed.length}개다 — 좁혀졌는지 보려면 2개 이상 필요` : 'tabId 나 저장소가 없다',
                { changed })
        } else {
            const pick = changed[0]
            const one = path.join(REPO, ...pick.split('/'))
            const pickRe = new RegExp(pick.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
            fs.mkdirSync(STATUS_DIR, { recursive: true })
            fs.writeFileSync(STATUS_FILE, JSON.stringify({
                sessionId: SESSION_ID, status: 'running', ts: Date.now(), tabId, cwd: REPO, file: one,
            }), 'utf8')
            await sleep(1200)
            // **`변경` 을 그냥 누르면 안 된다** — 이미 그 모드면 `setMode` 가 조기 반환이라
            // 아무것도 다시 읽지 않는다(2026-09-11 실측: CW4 가 남긴 옛 목록을 그대로 재서 FAIL).
            // 사람이 하는 것과 같은 왕복(파일 → 변경)으로 확실히 한 번 다시 읽게 한다
            const fileBtn0 = btn('파일')
            if (fileBtn0) { fileBtn0.click() }
            await sleep(400)
            const modeBtn = btn('변경')
            if (modeBtn) { modeBtn.click() }
            await sleep(2000)
            const names = () => Array.from((el() || document).querySelectorAll('.ad-view-diff-name'))
                .map(n => n.textContent)
            const scoped = names()
            const scopeEl = (el() || document).querySelector('.ad-view-scope')
            const scopeLabel = (scopeEl && scopeEl.textContent) || ''
            if (scopeEl) { scopeEl.click() }
            await sleep(1500)
            const all = names()
            const allLabel = ((el() || document).querySelector('.ad-view-scope') || {}).textContent || ''
            // 되돌려 놓는다 — 다음 검사·사람이 볼 화면의 기본은 '세션' 이다
            const back = (el() || document).querySelector('.ad-view-scope')
            if (back && allLabel === '전체') { back.click() }
            const ok = scopeLabel === '세션' && scoped.length === 1 && pickRe.test(scoped[0] || '')
                && allLabel === '전체' && all.length > scoped.length
            add('CW6', '`변경` 은 이 세션이 만진 파일만 그린다', ok,
                ok ? '' : '좁히기나 전체 되돌리기가 안 됐다',
                // `diffDebug` 를 같이 싣는다 — 실패했을 때 "보고가 안 왔다"(touched 빈 배열)와
                // "경로가 안 맞는다"(touched 는 있는데 kept=0)를 이것 없이는 가를 수 없다
                { reported: one, scopeLabel, scoped, allLabel, allCount: all.length, debug: view().diffDebug })
        }

        // ---------- CW7: git 이 없는 폴더에서도 만진 파일 목록은 나온다 ----------
        // 이 패널의 목적은 "에이전트가 방금 뭘 건드렸나" 다. git 은 거기에 diff 를 더하는 도구일 뿐,
        // 없다고 탭이 죽으면 안 된다 (2026-09-11 유저 지적: "git 으로 관리 안 하는 경로는?")
        // **`%TEMP%` 를 쓰면 안 된다** — git 은 상위 폴더를 끝까지 거슬러 올라가며 `.git` 을 찾는다.
        // 이 PC 는 홈(`C:\Users\junggon`)이 통째로 저장소라 `%TEMP%` 아래도 전부 그 저장소 안이고,
        // 그래서 첫 판이 "75개 숨김"(홈 저장소의 변경)으로 나왔다 (2026-09-11 실측).
        // 저장소 밖 자리를 직접 고르고, 그래도 안이면 판정 불가로 둔다.
        const outsideRepo = base => {
            let cur = base
            for (let i = 0; i < 24; i++) {
                if (fs.existsSync(path.join(cur, '.git'))) { return false }
                const up = path.dirname(cur)
                if (up === cur) { return true }
                cur = up
            }
            return true
        }
        const plainBase = ['D:\\Project', 'D:\\', os.tmpdir()].find(b => {
            try { return fs.existsSync(b) && outsideRepo(b) } catch (e) { return false }
        })
        if (!tabId || !plainBase) {
            add('CW7', 'git 없는 폴더에서도 만진 파일을 그린다', null,
                tabId ? '이 PC 에는 저장소 밖 폴더가 없다 (홈까지 git 이면 검사 불가)' : 'tabId 가 없다',
                { plainBase: plainBase || null })
        } else {
            const plain = fs.mkdtempSync(path.join(plainBase, 'ad-nogit-'))
            const f1 = path.join(plain, 'note.md')
            const f2 = path.join(plain, 'data.json')
            fs.writeFileSync(f1, '# probe\n', 'utf8')
            fs.writeFileSync(f2, '{}\n', 'utf8')
            // **새 세션 id 로 보고한다** — 앞 검사들이 같은 세션에 쌓아 둔 파일이 목록에 섞이면
            // 개수를 셀 수 없다. 덤으로 "같은 탭에서 세션이 바뀌면 앞 세션 목록을 버린다" 규칙
            // (notify.service.bind)도 여기서 같이 확인된다 — 2개만 남아야 맞다
            const nogitId = SESSION_ID + '-nogit'
            const nogitFile = path.join(STATUS_DIR, nogitId + '.json')
            const sendNogit = f => fs.writeFileSync(nogitFile, JSON.stringify({
                sessionId: nogitId, status: 'running', ts: Date.now(), tabId, cwd: plain, file: f,
            }), 'utf8')
            sendNogit(f1)
            await sleep(900)
            sendNogit(f2)
            await sleep(900)
            const fb = btn('파일')
            if (fb) { fb.click() }
            await sleep(400)
            const db = btn('변경')
            if (db) { db.click() }
            await sleep(2500)
            const body = el() && el().querySelector('.ad-view-body')
            const text = (body && body.textContent) || ''
            const rows = Array.from((body || document).querySelectorAll('[data-ad-open]'))
                .map(n => n.getAttribute('data-ad-open'))
            const commit = el() && el().querySelector('.ad-view-commit')
            const commitHidden = !commit || commit.style.display === 'none'
            const ok = /만진 파일 2개/.test(text) && rows.length === 2
                && rows.indexOf(f1) >= 0 && rows.indexOf(f2) >= 0
                && /git 저장소가 아니다/.test(text) && commitHidden
            add('CW7', 'git 없는 폴더에서도 만진 파일을 그린다', ok,
                ok ? '' : '목록·안내·커밋줄 중 하나가 기대와 다르다',
                { cwd: plain, rows, commitHidden, body: text.slice(0, 200) })
            try { fs.unlinkSync(nogitFile) } catch (e) { /* 이미 없다 */ }
            try { fs.unlinkSync(f1); fs.unlinkSync(f2); fs.rmdirSync(plain) } catch (e) { /* 남아도 무해 */ }
        }

        // ---------- CW8: 서브에이전트 개수는 훅이 센다 (대화기록 훑기가 아니라) ----------
        // `SubagentStart`/`SubagentStop` 을 훅 모양 그대로 넣어 사이드바 `❖N` 이 따라오는지 본다.
        // 대화기록을 건드리지 않으므로, 숫자가 맞으면 그것은 **훅 경로로만** 나온 값이다
        if (!tabId) {
            add('CW8', '서브에이전트 개수는 훅이 센다', null, 'tabId 가 없다', {})
        } else {
            const agentSid = SESSION_ID + '-agents'
            const agentFile = path.join(STATUS_DIR, agentSid + '.json')
            // 훅이 보내는 것과 **같은 모양**: 증분이 아니라 지금 도는 목록 전체(스냅샷)
            const live = []
            const sendAgents = (event, id, type) => {
                const i = live.findIndex(a => a.id === id)
                if (i >= 0) { live.splice(i, 1) }
                if (event === 'start') { live.push({ id, type, at: Date.now() }) }
                fs.writeFileSync(agentFile, JSON.stringify({
                    sessionId: agentSid, ts: Date.now(), tabId, agents: live.slice(),
                }), 'utf8')
            }
            const sendAgent = (event, id, type) => sendAgents(event, id, type)
            const badge = () => {
                const sb2 = document.getElementById('agentdeck-sidebar')
                const chips = sb2 ? Array.from(sb2.querySelectorAll('.ad-subagents')) : []
                return chips.map(c => c.textContent).join(',')
            }
            sendAgent('start', 'ag-1', 'general-purpose')
            await sleep(700)
            sendAgent('start', 'ag-2', 'general-purpose')
            await sleep(700)
            sendAgent('start', 'ag-3', 'Explore')
            await sleep(900)
            const after3 = badge()
            sendAgent('stop', 'ag-2', 'general-purpose')
            await sleep(900)
            const after2 = badge()
            // 같은 id 를 두 번 꺼도 음수가 되지 않아야 한다 (모르는 id 의 stop 은 무해)
            sendAgent('stop', 'ag-2', 'general-purpose')
            await sleep(700)
            const afterDup = badge()
            sendAgent('stop', 'ag-1', 'general-purpose')
            await sleep(500)
            sendAgent('stop', 'ag-3', 'Explore')
            await sleep(900)
            const afterAll = badge()
            const info = (ad.hookInfo() || []).find(r => r.agentHook)
            const ok = after3 === '❖3' && after2 === '❖2' && afterDup === '❖2' && afterAll === ''
                && !!info
            add('CW8', '서브에이전트 개수는 훅이 센다', ok,
                ok ? '' : '배지가 훅 보고를 따라오지 않는다',
                { after3, after2, afterDup, afterAll, agentHook: !!info })
            try { fs.unlinkSync(agentFile) } catch (e) { /* 이미 없다 */ }
        }

        // ---------- CW5: 설정 파일은 화면을 가로채지 않는다 (칩에는 쌓인다) ----------
        if (!pane0) {
            add('CW5', '설정 파일은 자동으로 안 띄운다', null, '터미널 패널이 없다', {})
        } else {
            const fx = path.join(os.tmpdir(), 'adprobe_settings_fixture')
            fs.mkdirSync(fx, { recursive: true })
            const cfgFile = path.join(fx, 'settings.json')
            const workFile = path.join(fx, 'work_note.md')
            fs.writeFileSync(cfgFile, '{"probe":true}\n', 'utf8')
            fs.writeFileSync(workFile, '# probe\n', 'utf8')
            const fileBtn = btn('파일')
            if (fileBtn) { fileBtn.click() }
            await sleep(300)
            feed(pane0, 'wrote ' + cfgFile + '\r\n')
            await sleep(900)
            const afterCfg = ((el() && el().querySelector('.ad-view-title')) || {}).textContent || ''
            const chipHasCfg = chips().some(c => /settings\.json/.test(c))
            feed(pane0, 'wrote ' + workFile + '\r\n')
            await sleep(900)
            const afterWork = ((el() && el().querySelector('.ad-view-title')) || {}).textContent || ''
            const ok = !/settings\.json/.test(afterCfg) && /work_note\.md/.test(afterWork) && chipHasCfg
            add('CW5', '설정 파일은 자동으로 안 띄운다 (칩에는 쌓인다)', ok,
                ok ? '' : '설정 파일이 화면을 가져갔거나, 작업 파일이 안 떴거나, 칩에도 안 쌓였다',
                { afterCfg: afterCfg.slice(0, 120), afterWork: afterWork.slice(0, 120), chipHasCfg, chips: chips() })
            try { fs.unlinkSync(cfgFile); fs.unlinkSync(workFile); fs.rmdirSync(fx) } catch (e) { /* 남아도 무해 */ }
        }
    } finally {
        for (const undo of stubbed) { try { undo() } catch (e) { /* 이미 사라진 세션 */ } }
        for (const t of madeTabs) { try { ad.app.closeTab(t, false) } catch (e) { /* 이미 닫혔다 */ } }
        try { fs.unlinkSync(STATUS_FILE) } catch (e) { /* 이미 없다 */ }
        try { fs.unlinkSync(path.join(os.tmpdir(), 'adprobe_scratch.py')) } catch (e) { /* 이미 없다 */ }
        try { ad.view().setOpen(false) } catch (e) { /* 패널이 없다 */ }
    }

    const pass = results.filter(r => r.pass === true).length
    const fail = results.filter(r => r.pass === false).length
    const skip = results.filter(r => r.pass === null).length
    return JSON.stringify({ results, summary: { pass, fail, skip } }, null, 1)
})()
