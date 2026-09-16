/**
 * 회귀 프로브 — `docs/REGRESSION.md` 의 R22~R35 를 CDP 로 한 번에 재는 도구.
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스 (실사용 Tabby 안 죽음)
 *   node tools/cdp.js 9222 tools/probe.js           # 여기
 *
 * 왜 만들었나 — 0.4.0~0.6.0 세 라운드에서 이 항목들을 **매번 임시 스크립트를 손으로 써서**
 * 검증했다. 그 스크립트는 스크래치패드에 있다가 사라지고, 다음 사람은 처음부터 다시 쓴다.
 * 판정 기준까지 같이 남겨야 "지난번엔 뭘 보고 통과라고 했나" 를 다시 묻지 않는다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` 배열 + `summary`.
 *   pass = true  통과
 *   pass = false 실패
 *   pass = null  **판정 불가** — 환경이 조건을 못 만들었다(저장소가 아님, 터미널 탭 없음 등).
 *                실패와 절대 섞지 않는다. 이 리포는 "근거 미확인" 을 실패와 구분한다.
 *
 * 사람 손이 필요해 여기서 다루지 않는 것: OS IME 실제 조합(CDP 로 구동 불가) ·
 * 실물 에이전트 승격 · 클립보드 이미지(격리 환경에서 writeImage 가 비어 온다).
 *
 * 프로브는 **자기가 바꾼 것을 되돌린다** — 설정·랩한 함수·임시 파일. 오염된 채로 두면
 * 다음 프로브가 거짓 결과를 낸다.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const { execFile } = require('child_process')

    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    /** 열려 있는 터미널 pane 들 (SplitTab 래퍼를 펼친다) */
    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }

    const el = () => document.getElementById('agentdeck-view')
    const sidebar = () => document.getElementById('agentdeck-sidebar')
    const mainEl = () => document.querySelector('.content.main')
    const windowEl = () => document.querySelector('.window')
    /** 패널 안에서 글자로 버튼을 찾는다 — 클래스 이름에 기대면 리팩터링에 바로 깨진다 */
    const btn = label => Array.from(el().querySelectorAll('button'))
        .find(b => (b.textContent || '').trim() === label)

    // 되돌릴 것들
    const cfg = ad.config.store.agentDeck
    const saved = {
        viewerOpen: cfg.viewerOpen,
        viewerDock: cfg.viewerDock,
        sidebarDock: cfg.sidebarDock,
        viewerPreload: cfg.viewerPreload,
        viewerAutoOpen: cfg.viewerAutoOpen,
    }
    const tmpDir = path.join(os.tmpdir(), 'agentdeck-probe')
    const cleanup = []

    try {
        // ---------------------------------------------------------------- R22 레이아웃
        // 통과 기준: 터미널 + 패널 + 사이드바 == 창폭, 셋이 겹치지 않음. 5조합 전부.
        {
            cfg.viewerOpen = true
            ad.config.save()
            await sleep(300)
            const combos = [
                ['right', 'right'], ['left', 'right'], ['left', 'left'], ['right', 'left'], ['right', 'bottom'],
            ]
            const rows = []
            for (const [view, side] of combos) {
                cfg.viewerDock = view
                cfg.sidebarDock = side
                ad.relayout()
                await sleep(120)
                const v = el().getBoundingClientRect()
                const s = sidebar().getBoundingClientRect()
                const m = mainEl().getBoundingClientRect()
                const horizontal = side === 'left' || side === 'right'
                const sum = Math.round(m.width + v.width + (horizontal ? s.width : 0))
                const win = windowEl().clientWidth
                const overlap = (a, b) => Math.round(a.right) > Math.round(b.left) && Math.round(b.right) > Math.round(a.left)
                rows.push({
                    combo: `view=${view} side=${side}`,
                    sum,
                    win,
                    fits: Math.abs(sum - win) <= 2,
                    overlaps: overlap(m, v) || (horizontal && (overlap(m, s) || overlap(v, s))),
                })
            }
            const ok = rows.every(r => r.fits && !r.overlaps)
            add('R22', '미리보기 패널 — 레이아웃', ok,
                ok ? '5조합 전부 폭 합계 일치, 겹침 없음' : '어긋난 조합이 있다', rows)
        }

        // ---------------------------------------------------------------- R23 폭 일치
        // 통과 기준: 패널이 열린 상태에서도 xterm.cols === pane.size.columns
        {
            cfg.viewerDock = 'right'
            cfg.sidebarDock = 'right'
            ad.relayout()
            await sleep(200)
            const list = panes().map(p => ({
                title: p.title,
                cols: p.frontend.xterm.cols,
                sent: p.size && p.size.columns,
            }))
            if (!list.length) {
                add('R23', '패널 열린 상태 폭 일치', null, '터미널 pane 이 없다', [])
            } else {
                const ok = list.every(r => r.cols === r.sent)
                add('R23', '패널 열린 상태 폭 일치', ok,
                    ok ? '모든 pane 에서 xterm.cols == pty cols' : '어긋난 pane 이 있다', list)
            }
        }

        // ---------------------------------------------------------------- R24/R25 렌더·주입
        // 픽스처를 직접 만들어 쓴다 — 리포 파일에 기대면 그 파일이 바뀔 때 프로브가 거짓말을 한다.
        {
            fs.mkdirSync(tmpDir, { recursive: true })
            // 1x1 PNG (투명) — 이미지 렌더가 data URL 을 실제로 디코드하는지 보는 최소 픽스처
            const png = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                'base64')
            const files = {
                md: path.join(tmpDir, 'probe.md'),
                png: path.join(tmpDir, 'probe.png'),
                csv: path.join(tmpDir, 'probe.csv'),
                code: path.join(tmpDir, 'probe.ts'),
            }
            fs.writeFileSync(files.png, png)
            fs.writeFileSync(files.csv, 'id,name,note\n1,alpha,"a,b"\n2,베타,two\n', 'utf8')
            fs.writeFileSync(files.code, 'const a: number = 1 < 2 ? 3 : 4\n', 'utf8')
            fs.writeFileSync(files.md, [
                '# 제목',
                '',
                '본문 **강조** 와 `코드`.',
                '',
                '| 키 | 값 |',
                '|---|---|',
                '| a | 1 |',
                '',
                '![그림](./probe.png)',
                '',
                // 주입 시도 — 태그가 되면 안 된다
                '<script>alert(1)</script> <img src=x onerror=alert(1)>',
            ].join('\n'), 'utf8')
            for (const f of Object.values(files)) { cleanup.push(f) }

            const openAndWait = async (file, sel) => {
                ad.openFile(file)
                for (let i = 0; i < 40; i++) {
                    if (el().querySelector(sel)) { return true }
                    await sleep(100)
                }
                return false
            }

            const mdOk = await openAndWait(files.md, '.ad-view-md')
            const md = el().querySelector('.ad-view-md')
            const shot = md ? {
                h1: md.querySelectorAll('h1').length,
                table: md.querySelectorAll('table').length,
                img: md.querySelectorAll('img').length,
                strong: md.querySelectorAll('strong').length,
            } : null
            const pngOk = await openAndWait(files.png, '.ad-view-image img')
            const imgEl = el().querySelector('.ad-view-image img')
            if (imgEl && !imgEl.complete) { await sleep(400) }
            const csvOk = await openAndWait(files.csv, '.ad-view-table table')
            const table = el().querySelector('.ad-view-table table')
            const codeOk = await openAndWait(files.code, '.ad-view-code')

            const renderOk = mdOk && pngOk && csvOk && codeOk
                && !!shot && shot.h1 === 1 && shot.table === 1 && shot.img === 1
                && !!imgEl && imgEl.naturalWidth > 0
                && !!table && table.querySelectorAll('tbody tr').length === 2
            add('R24', '미리보기 — 종류별 렌더', renderOk,
                renderOk ? 'md/이미지/표/코드 4종 모두 자기 모양으로' : '렌더되지 않은 종류가 있다',
                {
                    md: shot,
                    imgNatural: imgEl ? `${imgEl.naturalWidth}x${imgEl.naturalHeight}` : null,
                    csvRows: table ? table.querySelectorAll('tbody tr').length : null,
                    // 따옴표 안의 쉼표가 한 칸으로 남았는지 — CSV 파서의 핵심
                    csvQuoted: table
                        ? (table.querySelectorAll('tbody tr')[0].children[3] || {}).textContent
                        : null,
                    codeRendered: codeOk,
                })

            // R25 — 같은 md 를 다시 열고 주입 여부만 본다
            await openAndWait(files.md, '.ad-view-md')
            const body = el().querySelector('.ad-view-body')
            const inj = {
                scriptNodes: body.querySelectorAll('script').length,
                eventAttrs: body.querySelectorAll('[onerror],[onload],[onclick]').length,
                imgNodes: body.querySelectorAll('img').length,
                textKeepsRaw: (body.textContent || '').includes('<script>alert(1)</script>'),
            }
            const injOk = inj.scriptNodes === 0 && inj.eventAttrs === 0
                && inj.imgNodes === 1 && inj.textKeepsRaw
            add('R25', '미리보기 — 주입 차단', injOk,
                injOk ? '원문 HTML 이 글자로만 남는다' : '태그가 만들어졌다', inj)
        }

        // ---------------------------------------------------------------- R28 `변경` 탭
        // 통과 기준: 패널이 그린 파일별 ±카운트가 `git diff --numstat` 과 정확히 같다.
        {
            // **패널이 보는 저장소를 그대로 봐야 한다.** 처음엔 `process.cwd()`(= Tabby 프로세스)를
            // 썼다가 서로 다른 저장소를 비교해 거짓 실패를 냈다 — 패널은 홈 저장소를,
            // 프로브는 리포를 보고 있었다. 패널의 근거는 탭의 작업 폴더이므로 같은 것을 물어본다.
            // (`getWorkingDirectory()` 는 셸의 `cd` 를 따라오지 않고 탭이 태어난 폴더를 준다 —
            //  docs/DEVELOPMENT.md 함정 참고. 패널도 같은 값을 쓰므로 둘이 어긋나지 않는다.)
            const cwd = await (async () => {
                const p = panes()[0]
                try {
                    const dir = p && p.session && p.session.getWorkingDirectory
                        ? await p.session.getWorkingDirectory()
                        : null
                    return dir || ad.config.store.agentDeck.rootProfileCwd || null
                } catch {
                    return ad.config.store.agentDeck.rootProfileCwd || null
                }
            })()
            const changeBtn = cwd ? btn('변경') : null
            if (!cwd) {
                add('R28', '`변경` 탭 — git 수치 일치', null, '탭의 작업 폴더를 알 수 없다', null)
            } else if (!changeBtn) {
                add('R28', '`변경` 탭 — git 수치 일치', null, '`변경` 버튼을 못 찾았다', null)
            } else {
                changeBtn.click()
                let text = ''
                for (let i = 0; i < 60; i++) {
                    text = (el().querySelector('.ad-view-body').textContent || '').replace(/\s+/g, ' ')
                    if (text.includes('파일') || text.includes('변경 없음') || text.includes('저장소') || text.includes('작업 폴더')) { break }
                    await sleep(100)
                }
                // 패널이 본 저장소와 같은 곳을 우리도 본다
                // 패널과 **같은 폴백**을 써야 같은 근거가 된다 — 커밋이 하나도 없는 저장소는
                // `HEAD` 가 없어 `diff HEAD` 가 실패한다(실측: 홈 디렉토리 저장소가 그랬고,
                // 패널은 `diff` 로 폴백해 "변경 없음" 을 냈는데 프로브만 "저장소 아님" 으로 떨어졌다).
                const runGit = args => new Promise(resolve => {
                    execFile('git', ['--no-pager', '-C', cwd].concat(args),
                        { timeout: 8000, maxBuffer: 32 * 1024 * 1024 },
                        (err, stdout) => resolve(err ? null : String(stdout)))
                })
                const numstat = await runGit(['diff', 'HEAD', '--numstat'])
                    ?? await runGit(['diff', '--numstat'])
                if (numstat === null) {
                    add('R28', '`변경` 탭 — git 수치 일치', null,
                        `git 저장소가 아니거나 git 이 없다 (cwd=${cwd})`, { panelText: text.slice(0, 160) })
                } else {
                    const rows = numstat.trim() ? numstat.trim().split('\n').map(l => {
                        const [a, d, f] = l.split('\t')
                        return { file: f, add: Number(a), del: Number(d) }
                    }) : []
                    const missing = rows.filter(r => !text.includes(r.file.split('/').pop()))
                    const sumAdd = rows.reduce((n, r) => n + (isFinite(r.add) ? r.add : 0), 0)
                    const sumDel = rows.reduce((n, r) => n + (isFinite(r.del) ? r.del : 0), 0)
                    const shownSum = text.includes(`+${sumAdd} -${sumDel}`)
                    const ok = rows.length === 0
                        ? text.includes('변경 없음')
                        : (missing.length === 0 && shownSum)
                    add('R28', '`변경` 탭 — git 수치 일치', ok,
                        ok ? `numstat 과 일치 (${rows.length}파일 +${sumAdd} -${sumDel})`
                            : '패널 수치가 numstat 과 다르다',
                        { files: rows.length, sumAdd, sumDel, shownSum, missing: missing.map(m => m.file), head: text.slice(0, 160) })
                }
                const fileBtn = btn('파일')
                if (fileBtn) { fileBtn.click() }
            }
        }

        // ---------------------------------------------------------------- R31 한글 조합 순서
        // 통과 기준: 조합 중/확정예약 중에 우리 바이트보다 **음절이 먼저** pty 로 나간다.
        //
        // 함정(docs/DEVELOPMENT.md): compositionend 를 직접 쏘면 xterm 이 비동기 경로로 한 번 더
        // 보내 음절이 두 번 찍힌다. 그건 하네스 산물이라 **순서만** 보고 개수는 방향키와 대조한다.
        {
            const pane = panes()[0]
            if (!pane || !pane.session) {
                add('R31', '한글 조합 순서 (IME)', null, '터미널 pane 이 없다', null)
            } else {
                const x = pane.frontend.xterm
                const ta = x.textarea
                const helper = x._core && x._core._compositionHelper
                if (!ta || !helper) {
                    add('R31', '한글 조합 순서 (IME)', null,
                        'xterm 조합 헬퍼를 못 찾았다 (내부 구조 변경?)', { hasTextarea: !!ta, hasHelper: !!helper })
                } else {
                    const log = []
                    const orig = pane.sendInput.bind(pane)
                    // pty 에 실제로 쓰지 않는다 — 셸이 명령을 실행하면 다음 시나리오가 오염된다
                    pane.sendInput = d => { log.push({ src: 'plugin', data: String(d) }) }
                    const sub = x.onData(d => log.push({ src: 'xterm', data: String(d) }))
                    const key = init => ta.dispatchEvent(new KeyboardEvent('keydown',
                        Object.assign({ bubbles: true, cancelable: true }, init)))
                    const comp = (type, data) => ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
                    const firstSyllable = arr => arr.findIndex(e => e.data && /[가-힣]/.test(e.data))
                    const firstOurs = arr => arr.findIndex(e => e.src === 'plugin' && !/[가-힣]/.test(e.data))

                    const cases = []
                    ta.focus()

                    // ① 조합 중 + Shift+Enter
                    ta.value = ''
                    comp('compositionstart')
                    ta.value = '한'
                    comp('compositionupdate', '한')
                    await sleep(30)
                    log.length = 0
                    key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                    await sleep(80)
                    cases.push({ name: '조합중 + Shift+Enter', order: log.map(e => e.data), pass: firstSyllable(log) >= 0 && firstSyllable(log) < firstOurs(log) })

                    // ② 확정 예약 중 + Shift+Enter
                    ta.value = ''
                    comp('compositionstart')
                    ta.value = '글'
                    comp('compositionupdate', '글')
                    await sleep(30)
                    log.length = 0
                    comp('compositionend', '글')
                    key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                    await sleep(80)
                    cases.push({ name: '확정예약중 + Shift+Enter', order: log.map(e => e.data), pass: firstSyllable(log) >= 0 && firstSyllable(log) < firstOurs(log) })

                    // ③ 조합 없음 (회귀) — 우리 바이트만 나가야 한다
                    ta.value = ''
                    await sleep(30)
                    log.length = 0
                    key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                    await sleep(80)
                    cases.push({ name: 'idle + Shift+Enter (회귀)', order: log.map(e => e.data), pass: firstSyllable(log) < 0 })

                    sub.dispose()
                    pane.sendInput = orig
                    const ok = cases.every(c => c.pass)
                    add('R31', '한글 조합 순서 (IME)', ok,
                        ok ? '조합 음절이 항상 먼저 나간다 (회귀 없음)' : '순서가 뒤집힌 시나리오가 있다',
                        cases)
                }
            }
        }

        // ---------------------------------------------------------------- R32/R34 에이전트 판정
        // 실물 에이전트 승격은 여기서 못 만든다(새 탭에 곧바로 입력하면 pty 준비 전이라 유실된다).
        // 그래서 **판정 경로가 도는지**(probedAt 갱신)와 출력 구독이 사는지까지만 본다.
        {
            const before = ad.agentOf ? ad.agentOf() : null
            const hits0 = ad.debug ? ad.debug().outputHits : null
            if (!before || !ad.probeAgent) {
                add('R32', '에이전트 판정 경로', null, '진단구(agentOf/probeAgent)가 없다', null)
            } else {
                ad.probeAgent()
                await sleep(1200)
                const after = ad.agentOf()
                const hits1 = ad.debug ? ad.debug().outputHits : null
                const probed = after && before && after.probedAt !== before.probedAt
                add('R32', '에이전트 판정 경로', probed ? true : null,
                    probed
                        ? `조회가 돈다 (id=${after.id})`
                        : '조회 흔적이 없다 — 실물 에이전트 승격은 사람이 확인해야 한다',
                    { before, after, outputHits: [hits0, hits1] })
            }
        }

        // ---------------------------------------------------------------- R35 라벨 (실경로)
        // 프레임을 xterm 버퍼에 직접 그린다 — fakebox 는 타이핑을 에코하지 않아 키로는 못 만든다.
        // `ESC[2K`(줄 지우기)를 빼면 옛 프레임 잔여가 같은 행에 남아 라벨 끝에 붙는다.
        // 키는 이 프로브가 못 보내므로(별도 `--keys` 호출) 그리기까지만 하고 판정은 사람에게 넘긴다.
        {
            const pane = panes()[0]
            if (!pane) {
                add('R35', '입력창 라벨 (실경로)', null, '터미널 pane 이 없다', null)
            } else {
                const x = pane.frontend.xterm
                const rule = '─'.repeat(Math.max(10, x.cols))
                const K = '\u001b[2K'
                const sentence = '결제 모듈 버그 확인해줘'
                x.write(`\r\n${K}${rule}\r\n${K}❯ ${sentence}\r\n${K}${rule}\r\n`)
                x.focus()
                if (x.textarea) { x.textarea.focus() }
                await sleep(300)
                add('R35', '입력창 라벨 (실경로)', null,
                    '프레임을 그렸다. 이어서 `node tools/cdp.js 9222 --keys "Enter"` 를 보내고 '
                    + '사이드바 라벨(또는 ~/.agentdeck-diag.log 의 `enter-label text=`)이 그 문장인지 확인할 것',
                    { sentence, cols: x.cols })
            }
        }
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
    } finally {
        // 되돌리기 — 오염된 인스턴스는 다음 프로브를 거짓말하게 만든다
        try {
            Object.assign(cfg, saved)
            ad.config.save()
            ad.relayout()
        } catch { /* 설정 복원 실패는 치명적이지 않다 */ }
        for (const f of cleanup) {
            try { require('fs').unlinkSync(f) } catch { /* 이미 지워짐 */ }
        }
        try { require('fs').rmdirSync(tmpDir) } catch { /* 비어 있지 않으면 남긴다 */ }
    }

    const summary = {
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    return JSON.stringify({ summary, results }, null, 1)
})()
