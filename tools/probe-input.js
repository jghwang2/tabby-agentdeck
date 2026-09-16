/**
 * 입력 경로 회귀 프로브 — 붙여넣기 · 우클릭 · 줄바꿈 · IME 대기 · 핫키 소유권.
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스 (메인이 띄운다)
 *   node tools/cdp.js 9222 tools/probe-input.js
 *
 * 왜 별도 프로브인가 — 이 플러그인이 존재하는 이유의 절반이 **입력 보정**(Ctrl+V 이중
 * 붙여넣기, Shift+Enter 오전송, Home/End 음절 끌림, 우클릭 2중 입력)인데 `probe-all.js` 가
 * 그 영역에서 재는 것은 R8(Shift+Enter 바이트)과 R31(IME 순서) 둘뿐이었다. 나머지 —
 * 기동 시 핫키 테이블 정리 결과, 우클릭 3분기, Ctrl+V 호출 횟수, 프로필별 이미지 키 — 는
 * 회귀 항목이 아예 없었다. 이 리포에서 가장 자주 재발한 사고가 바로 그 영역이다
 * (`docs/DEVELOPMENT.md` 0.6.3 절 · `deck.service.ts` ensurePasteHotkey / claimRightClick 주석).
 *
 * 결과 형식은 `probe-all.js` 와 같다: `{ id, name, pass, detail, evidence }` + `summary`.
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(환경이 조건을 못 만듦 — 실패와 섞지 않는다)
 *
 * id 는 `IN1`~`IN10` (+ `IN6B`). `docs/REGRESSION.md` 의 R 번호는 메인이 배리어에서 매긴다.
 *
 * **자기가 바꾼 것은 되돌린다** — 랩한 함수, 선택 영역, 조합 상태, Shift 눌림 추적.
 * `finally` 에서 장부(`restores`)를 역순으로 되감는다.
 *
 * **실사용 자원은 건드리지 않는다** — 클립보드는 읽기만 하고(`readText`/`readImage`), 쓰기
 * 경로(`pane.paste` / `frontend.copySelection`)는 전부 랩해서 **호출만 세고 통과시키지
 * 않는다**. 그래서 이 프로브를 돌려도 실제로 붙여넣어지거나 복사되는 것은 없다.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')

    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    // 리터럴 제어문자를 이 파일에 넣지 않는다 — 들어가면 git 이 바이너리로 취급해 grep·diff 가
    // 막힌다(실측 사고). 반면 제품 소스(`deck.service.ts`)는 리터럴 0x1B/0x16 을 쓰므로
    // IN6B 의 대조는 아래 이스케이프로 만든 문자열과 비교한다.
    const ESC = '\u001b'
    const SYN = '\u0016' // 리터럴 Ctrl+V (quoted-insert)
    const LF = '\n'  // 0x0A — Claude Code 가 줄바꿈으로 받는 바이트

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    /** 보낸 바이트를 사람이 읽게 — 글자로만 남기면 개행·ESC·빈문자열을 구별할 수 없다 */
    const hex = s => [...String(s)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')
    /** 그 케이스가 실제로 돌았나 — IN9 가 "안 돌아서 없는 줄" 과 "돌았는데 없는 줄" 을 갈라야 한다 */
    const ran = id => {
        const r = results.find(x => x.id === id)
        return !!r && r.pass !== null
    }

    const cfg = ad.config.store.agentDeck

    // ============================================================ 되돌리기 장부
    const restores = []
    /**
     * 살아 있는 함수를 랩한다. 되돌리기는 **원래 프로퍼티 상태**로 복구한다 —
     * 프로토타입 메서드(`pane.paste`, `frontend.copySelection`)에 원본을 그냥 대입하면
     * own 프로퍼티가 남아 프로토타입을 영구히 가린다. own 이 아니었으면 delete 한다.
     */
    const wrap = (obj, key, make) => {
        if (!obj || typeof obj[key] !== 'function') { return false }
        const hadOwn = Object.prototype.hasOwnProperty.call(obj, key)
        const prev = obj[key]
        obj[key] = make(prev.bind(obj))
        restores.push(() => {
            if (hadOwn) { obj[key] = prev } else { try { delete obj[key] } catch { obj[key] = prev } }
        })
        return true
    }
    /**
     * 제품의 진단 랩(`probeSendInput` / `probeWrite`)이 **내 랩 위에** 얹히는 경우를 정리한다.
     *
     * `doPaste` 는 붙여넣기 직전에 `pane.sendInput` / `session.write` 를 감싸고 플래그
     * (`__adSendInputProbe` / `__adWriteProbe`)를 세워 재랩을 막는다(deck.service.ts:1733·1756).
     * 내가 랩한 상태에서 그게 돌면 제품 랩이 내 랩을 orig 로 물고, 내가 되돌릴 때 함께 사라지는데
     * 플래그만 남아 제품이 다시 랩하지 못한다 — 진단 로그의 `sendInput len=` 줄이 영구히 죽는다.
     * 그래서 내 창 안에서 플래그가 새로 켜졌으면 플래그도 같이 지운다.
     */
    const forgetProbeFlag = (obj, flag) => {
        if (!obj) { return }
        const had = !!obj[flag]
        restores.push(() => {
            if (!had && obj[flag]) { try { delete obj[flag] } catch { obj[flag] = false } }
        })
    }
    /** 장부를 역순으로 되감는다 — 나중에 얹은 랩을 먼저 벗겨야 원래 함수가 돌아온다 */
    const restoreAll = () => {
        while (restores.length) {
            const undo = restores.pop()
            try { undo() } catch { /* 복원 실패는 치명적이지 않다 */ }
        }
    }

    // ============================================================ 공통 헬퍼 (probe-all.js 와 같은 규칙)
    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    /**
     * 터미널 pane 하나를 **활성 탭으로** 만들고 돌려준다.
     *
     * `doPaste`·`sendNewline`·`handleRightClick` 은 전부 `focusedPane()`(= `app.activeTab`)으로
     * 보낸다(deck.service.ts:1799). 활성 탭이 Welcome 이면 시나리오가 아무 데도 안 가고 빈
     * 결과를 낸다 — `probe-all.js` 가 첫 실행에서 R8·R31 을 그 이유로 거짓 실패시켰다(2026-09-08).
     */
    const focusTerminal = async () => {
        const list = panes()
        if (!list.length) { return null }
        const pane = list[0]
        const owner = ad.app.tabs.find(t => t === pane
            || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0))
        if (owner) { ad.app.selectTab(owner) }
        if (owner && typeof owner.focus === 'function' && owner !== pane) {
            try { owner.focus(pane) } catch { /* 분할 탭이 아니면 무시 */ }
        }
        await sleep(400)
        return pane
    }
    /**
     * 우클릭을 쏠 대상 엘리먼트.
     *
     * `inTerminalArea()` 는 `target.closest('.content.main')` 이 있고 사이드바 밖일 때만 참이다
     * (deck.service.ts:1896). xterm 엘리먼트가 그 조건을 만족하면 그것을 쓰고, 아니면
     * `.content.main` 자체를 쓴다 (`closest` 는 자기 자신도 센다).
     */
    const terminalTarget = pane => {
        const x = pane && pane.frontend && pane.frontend.xterm
        const elx = x && x.element
        if (elx && typeof elx.closest === 'function' && elx.closest('.content.main')) { return elx }
        return document.querySelector('.content.main')
    }
    const centerOf = el => {
        const box = el.getBoundingClientRect()
        return {
            clientX: Math.round(box.left + box.width / 2),
            clientY: Math.round(box.top + box.height / 2),
        }
    }
    const mouse = (target, type, at) => target.dispatchEvent(new MouseEvent(type,
        Object.assign({ button: 2, buttons: 2, bubbles: true, cancelable: true }, at)))
    const keyOn = (target, init) => target.dispatchEvent(new KeyboardEvent('keydown',
        Object.assign({ bubbles: true, cancelable: true }, init)))
    /**
     * Shift 눌림 추적을 지운다.
     *
     * `claimShiftEnterKey` 는 Shift 를 **자기가 따로 센다**(IME 가 shiftKey 를 지운 채
     * Enter 를 넘기기 때문, deck.service.ts:1363) 그리고 그 값을 STALE_MS=5000ms 동안 기억한다.
     * 안 지우면 앞 케이스의 Shift 가 남아 **맨 Enter 가 줄바꿈으로 잡혀** 거짓 실패한다.
     */
    const forgetShift = target => target.dispatchEvent(new KeyboardEvent('keyup',
        { key: 'Shift', code: 'ShiftLeft', keyCode: 16, bubbles: true }))

    // ============================================================ 진단 로그 — 시작 지점 기록
    // `~/.agentdeck-diag.log` 는 **누적**이다(기동 시 한 번만 비운다, deck.service.ts:322).
    // 과거 실행의 줄을 세면 IN9 가 거짓 통과한다 — `probe-all.js` 의 R2 가 실제로 그 함정을
    // 밟았다("자동 복구 13회" 거짓 실패). 그래서 시작 시점의 **바이트 오프셋**을 잡아 그
    // 뒤만 읽고, 파일이 줄어들어 있으면(프로브 도중 재기동) 줄 앞 ISO 시각 필터로 떨어진다.
    // **경로는 제품에게 묻는다.** 격리 인스턴스는 자기 폴더에 쓰므로(`AGENTDECK_DIAG_DIR`,
    // `src/diag.ts` 의 `logDir`) 홈으로 만들면 남의 파일을 읽고 "줄이 안 남았다" 로 거짓
    // 실패한다 (2026-09-09: IN9 이 그렇게 뒤집혔다). 진단구가 없는 낡은 빌드면 홈으로 떨어진다.
    const DIAG_PATH = (ad.diagPaths && ad.diagPaths().diag) || path.join(os.homedir(), '.agentdeck-diag.log')
    const startedAtIso = new Date().toISOString()
    let diagStart = 0
    try { diagStart = fs.statSync(DIAG_PATH).size } catch { diagStart = -1 }

    const diagTail = () => {
        try {
            const size = fs.statSync(DIAG_PATH).size
            if (diagStart >= 0 && size >= diagStart) {
                const len = size - diagStart
                if (len <= 0) { return '' }
                const fd = fs.openSync(DIAG_PATH, 'r')
                try {
                    const buf = Buffer.alloc(len)
                    fs.readSync(fd, buf, 0, len, diagStart)
                    return buf.toString('utf8')
                } finally { fs.closeSync(fd) }
            }
            // 파일이 줄어들었다 = 프로브 도중 재기동됐다. 줄 앞 ISO 시각으로 갈라낸다
            return fs.readFileSync(DIAG_PATH, 'utf8').split('\n').filter(l => {
                const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s/.exec(l)
                return m ? m[1] >= startedAtIso : false
            }).join('\n')
        } catch {
            return ''
        }
    }

    // ============================================================ 리포 루트 (IN6B 정적 대조용)
    /**
     * 렌더러의 cwd 는 Tabby 를 띄운 자리라 리포가 아니다. 가장 확실한 단서는 **플러그인이
     * 로드된 경로**다 — `test-instance.ps1` 이 `<ud>/plugins/node_modules/tabby-agentdeck` 를
     * 리포 루트로 junction 걸어 두므로(그 스크립트 주석: "작업 중인 소스가 그대로 뜬다")
     * 그 경로로 `src/` 가 그대로 보인다. 못 찾으면 메인이
     * `window.__agentdeckProbeRoot = '<리포경로>'` 를 먼저 넣어주면 된다.
     */
    const rootCandidates = () => {
        const out = []
        const push = v => { if (v && out.indexOf(v) < 0) { out.push(v) } }
        push(window.__agentdeckProbeRoot)
        const la = (typeof process !== 'undefined' && process.env && process.env.LOCALAPPDATA) || ''
        if (la) { push(path.join(la, 'tabby-agentdeck-test', 'ud', 'plugins', 'node_modules', 'tabby-agentdeck')) }
        try {
            for (const k of Object.keys(require.cache || {})) {
                const m = /^(.*[\\/]tabby-agentdeck)[\\/]/.exec(k)
                if (m) { push(m[1]) }
            }
        } catch { /* require.cache 를 못 본다 */ }
        try {
            let d = process.cwd()
            for (let i = 0; i < 6 && d; i++) {
                push(d)
                const up = path.dirname(d)
                if (up === d) { break }
                d = up
            }
        } catch { /* 무시 */ }
        return out
    }
    const findRepoRoot = () => {
        for (const c of rootCandidates()) {
            try {
                if (fs.existsSync(path.join(c, 'src', 'agents.ts'))
                    && fs.existsSync(path.join(c, 'src', 'deck.service.ts'))) { return c }
            } catch { /* 다음 후보 */ }
        }
        return null
    }

    try {
        // ============================================================ IN1 핫키 소유권
        // 기동 시 `ensurePasteHotkey` / `ensureNewlineHotkey` / `releaseHomeEndHotkey` 가
        // 정리해 둔 결과가 그대로인가.
        //
        // **제품 규칙으로 판정한다.** 예컨대 home/end 는 제품이 'Home'/'End' 토큰만 걸러내므로
        // (deck.service.ts:1160) "빈 배열" 을 판정 술어로 쓰면 애초에 키가 없어 undefined 인
        // 경우까지 거짓 실패한다. 빈 배열인지는 evidence(`table`)로 눈으로 본다.
        {
            const hk = ad.config.store.hotkeys || {}
            const arr = id => (Array.isArray(hk[id]) ? hk[id] : [])
            const subs = []
            const sub = (name, pass, why) => subs.push({ name, pass, why })

            // config.ts:392 의 기본값은 아직 `agentdeck-paste: ['Ctrl-V']` 다 — 그걸 기동 때
            // 걷어내는 것이 ensurePasteHotkey 의 일이므로, 남아 있으면 그 경로가 죽은 것이다.
            if (cfg.claimCtrlV === false) {
                sub('paste 에 Ctrl-V 없음', null,
                    'claimCtrlV 꺼짐 — 캡처 경로를 안 쓴다. (참고: ensurePasteHotkey 자체는 게이트가 없어 회수는 그대로 돈다, deck.service.ts:1059)')
                sub('agentdeck-paste 에 Ctrl-V 없음', null, '같은 사유')
            } else {
                sub('paste 에 Ctrl-V 없음', !arr('paste').includes('Ctrl-V'),
                    '순정 paste 에 Ctrl-V 가 남으면 캡처와 겹쳐 한 번 눌러 두 번 붙는다')
                sub('agentdeck-paste 에 Ctrl-V 없음', !arr('agentdeck-paste').includes('Ctrl-V'),
                    '핫키 경로는 폐지됐다 — 같은 keydown 이 두 경로로 들어와 1ms 간격 2회 발화한 실측이 있다')
            }
            if (cfg.releaseHomeEnd === false) {
                sub('home 에 Home/End 없음', null, 'releaseHomeEnd 꺼짐 — 핫키를 놓아주지 않는 설정이다')
                sub('end 에 Home/End 없음', null, 'releaseHomeEnd 꺼짐 — 같은 사유')
            } else {
                const held = id => arr(id).includes('Home') || arr(id).includes('End')
                sub('home 에 Home/End 없음', !held('home'),
                    '핫키가 잡고 있으면 tabby-local 이 즉시 ESC[H 를 쏴 조합 중 음절이 커서를 따라간다')
                sub('end 에 Home/End 없음', !held('end'), '같은 이유')
            }
            // 줄바꿈은 캡처(`claimShiftEnterKey`)가 주경로지만 핫키도 백업으로 살아 있어야 한다
            const nl = arr('agentdeck-newline')
            sub('agentdeck-newline 에 Ctrl-Enter·Shift-Enter 둘 다',
                nl.includes('Ctrl-Enter') && nl.includes('Shift-Enter'),
                'ensureNewlineHotkey 가 저장값에 Shift-Enter 를 보정해 넣는다 (deck.service.ts:1815)')
            // 옛 이름이 남아 있으면 matchActiveHotkey 가 그쪽을 먼저 골라 우리 핸들러가 통째로 죽는다
            const legacy = Object.keys(hk).filter(k => k.indexOf('workdeck') === 0)
            sub('workdeck-* 잔여 없음', legacy.length === 0,
                'config.yaml 삽입 순서로 옛 항목이 먼저 매칭된다 (tabby-core:21558 matches.sort)')

            const judged = subs.filter(s => s.pass !== null)
            const ok = judged.length ? judged.every(s => s.pass) : null
            add('IN1', '핫키 소유권 (Ctrl-V 회수 · Home/End 해제 · 줄바꿈 등록)', ok,
                ok === null ? '설정이 전부 꺼져 있어 판정할 항목이 없다'
                    : ok ? `핫키 테이블이 기동 정리 결과 그대로다 (판정 ${judged.length}종 전부 통과)`
                        : `어긋난 항목: ${judged.filter(s => !s.pass).map(s => s.name).join(', ')}`,
                {
                    subs,
                    table: {
                        paste: hk.paste,
                        'agentdeck-paste': hk['agentdeck-paste'],
                        home: hk.home,
                        end: hk.end,
                        'agentdeck-newline': hk['agentdeck-newline'],
                        legacy,
                    },
                    config: {
                        claimCtrlV: cfg.claimCtrlV, claimShiftEnter: cfg.claimShiftEnter,
                        releaseHomeEnd: cfg.releaseHomeEnd, imeOrderGuard: cfg.imeOrderGuard,
                    },
                })
        }

        // ============================================================ IN2~IN4 우클릭 3분기
        // 케이스마다 try 로 감싼다 — 하나가 터져도 나머지가 죽지 않게. (`probe-all.js` 는 통짜
        // try 라 앞 케이스의 예외가 뒤 전부를 건너뛴다. 여기는 랩·이벤트가 많아 그 위험이 크다.)
        //
        // 간격 규칙: `lastRightHandledAt` 중복 가드 150ms(deck.service.ts:1885) 와
        // `lastPasteAt` 중복 가드 PASTE_DEDUPE_MS=80ms(:1554) 보다 넉넉히 띄운다.
        const rcPane = await focusTerminal()
        const rcTarget = rcPane ? terminalTarget(rcPane) : null
        const menuMs = cfg.rightClickMenuMs ?? 250
        const rcSkip = cfg.claimRightClick === false
            ? 'claimRightClick 꺼짐 — 순정(tabby-terminal) 경로가 처리한다'
            : (!rcPane ? '터미널 pane 이 없다' : (!rcTarget ? '.content.main 을 못 찾았다' : null))

        // ---------- IN2 우클릭(짧게) + 선택 없음 → 붙여넣기
        if (rcSkip) {
            add('IN2', '우클릭(짧게) — 선택 없으면 붙여넣기', null, rcSkip, null)
        } else {
            try {
                const pasteCalls = []
                const copyCalls = []
                // **통과시키지 않는다** — 실제로 붙거나 복사되면 화면·클립보드가 오염된다
                const okPaste = wrap(rcPane, 'paste', () => () => { pasteCalls.push(1) })
                wrap(rcPane.frontend, 'copySelection', () => () => { copyCalls.push(1) })
                forgetProbeFlag(rcPane, '__adSendInputProbe')
                forgetProbeFlag(rcPane.session, '__adWriteProbe')
                // 선택이 남아 있으면 복사 분기로 새므로 확실히 비운다
                try { rcPane.frontend.clearSelection() } catch { /* 지원 안 하는 프론트엔드 */ }
                await sleep(150)
                // 이 케이스가 남긴 줄만 보려고 시작 위치를 잡는다 — 앞 케이스의 `paste image` 를
                // 이 케이스 것으로 읽으면 엉뚱하게 판정 불가로 떨어진다
                const diagAt = diagTail().length

                const at = centerOf(rcTarget)
                mouse(rcTarget, 'mousedown', at)
                await sleep(60) // menuMs(기본 250) 보다 **짧게** — 이게 붙여넣기 분기의 조건이다
                mouse(rcTarget, 'mouseup', at)
                // rightclick 경로는 네이티브 paste 를 PASTE_NATIVE_WAIT_MS(60ms) 기다린 뒤 폴백한다
                await sleep(450)

                // 클립보드가 이미지 전용이면 doPaste 가 sendImagePasteKey 로 빠진다(:1566) —
                // 그건 IN6 의 영역이고 여기서는 **판정 불가**로 갈라야 한다 (실패가 아니다)
                const imageBranch = /paste image app=/.test(diagTail().slice(diagAt))
                const pass = !okPaste ? null
                    : imageBranch ? null
                        : (pasteCalls.length === 1 && copyCalls.length === 0)
                add('IN2', '우클릭(짧게) — 선택 없으면 붙여넣기', pass,
                    !okPaste ? 'pane.paste 가 함수가 아니다'
                        : imageBranch ? '클립보드가 이미지 전용이어서 텍스트 붙여넣기 분기를 타지 않았다 (IN6 참조)'
                            : pass ? `held≈60ms < ${menuMs}ms → pane.paste() 1회, copySelection 0회`
                                : `pane.paste ${pasteCalls.length}회 / copySelection ${copyCalls.length}회 (기대 1 / 0)`,
                    {
                        pasteCalls: pasteCalls.length, copyCalls: copyCalls.length, menuMs, imageBranch,
                        // claimRightClick 은 기동 때 순정 처리를 끈다(:1850) — 그 흔적도 같이 남긴다
                        terminalRightClick: ad.config.store.terminal && ad.config.store.terminal.rightClick,
                    })
            } catch (e) {
                add('IN2', '우클릭(짧게) — 선택 없으면 붙여넣기', false, `예외: ${(e && e.message) || e}`, null)
            }
            restoreAll()
        }

        // ---------- IN3 우클릭(길게) → 컨텍스트 메뉴
        if (rcSkip) {
            add('IN3', '우클릭(길게) — 컨텍스트 메뉴', null, rcSkip, null)
        } else {
            try {
                await sleep(400) // lastRightHandledAt(150ms) 가드 넘기기
                // **`.ad-menu` 가 아니다.** `.ad-menu` 는 사이드바의 상태 지정 메뉴
                // (`showStatusMenu`, deck.service.ts:2812)다. 터미널 롱프레스는
                // `pane.platform.popupContextMenu(await pane.buildContextMenu(), ev)`(:1913) —
                // Electron **네이티브** 메뉴라 DOM 에 노드가 생기지 않는다. 그래서 관측은 그
                // 호출을 랩해서 하고 **통과시키지 않는다**: 네이티브 메뉴는 모달이라 열리면
                // CDP 평가가 멈출 수 있고, 안 열었으니 닫을 것도 없다(오염 0).
                const popups = []
                const okPopup = wrap(rcPane.platform, 'popupContextMenu',
                    () => menu => { popups.push(Array.isArray(menu) ? menu.length : -1) })
                const pasteCalls = []
                wrap(rcPane, 'paste', () => () => { pasteCalls.push(1) })
                const buildable = typeof rcPane.buildContextMenu === 'function'

                const at = centerOf(rcTarget)
                const holdMs = menuMs + 150 // menuMs 보다 **길게** 눌러야 메뉴 분기다
                mouse(rcTarget, 'mousedown', at)
                await sleep(holdMs)
                mouse(rcTarget, 'mouseup', at)
                await sleep(600) // buildContextMenu 가 async 다 — await 한 틱 뒤에 popup 이 불린다

                const pass = (okPopup && buildable) ? (popups.length === 1 && pasteCalls.length === 0) : null
                add('IN3', '우클릭(길게) — 컨텍스트 메뉴', pass,
                    !okPopup ? 'pane.platform.popupContextMenu 가 없다 (Electron 플랫폼이 아니다)'
                        : !buildable ? 'pane.buildContextMenu 가 없다 (터미널 탭이 아니다)'
                            : pass ? `held≈${holdMs}ms ≥ ${menuMs}ms → popupContextMenu 1회, 붙여넣기 0회`
                                : `popupContextMenu ${popups.length}회 / paste ${pasteCalls.length}회 (기대 1 / 0)`,
                    {
                        popupCalls: popups.length, menuItemCounts: popups,
                        pasteCalls: pasteCalls.length, menuMs, holdMs,
                        adMenuNodes: document.querySelectorAll('.ad-menu').length,
                    })
            } catch (e) {
                add('IN3', '우클릭(길게) — 컨텍스트 메뉴', false, `예외: ${(e && e.message) || e}`, null)
            }
            restoreAll()
            // 방어적 청소 — 어떤 경로로든 메뉴가 떴으면 여기서 닫는다. 남으면 다음 프로브가 오염된다
            try {
                document.querySelectorAll('.ad-menu').forEach(n => n.remove())
                document.dispatchEvent(new KeyboardEvent('keydown',
                    { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
            } catch { /* 무시 */ }
        }

        // ---------- IN4 우클릭(짧게) + 선택 있음 → 복사
        if (rcSkip) {
            add('IN4', '우클릭(짧게) — 선택 있으면 복사', null, rcSkip, null)
        } else {
            try {
                await sleep(400)
                const x = rcPane.frontend.xterm
                // 화면에 **이미 있는** 글자를 고른다 — 일부러 써 넣으면 그 줄을 치우려고
                // `xterm.clear()` 를 불러야 하고 그러면 스크롤백이 날아간다
                // (`probe-all.js` R14 가 그 대가를 치른다).
                const findRow = () => {
                    const b = x.buffer.active
                    for (let i = b.baseY + x.rows - 1; i >= b.baseY; i--) {
                        const l = b.getLine(i)
                        const t = l ? l.translateToString(true) : ''
                        if (t.trim().length >= 2) { return { abs: i, text: t } }
                    }
                    return null
                }
                let hit = findRow()
                let wroteMarker = false
                if (!hit) {
                    // 빈 화면 — 고를 글자가 없다. 판정 불가로 두기보다 표식 한 줄을 그린다
                    x.write('\r\nagentdeck-probe-selection\r\n')
                    await sleep(300)
                    wroteMarker = true
                    hit = findRow()
                }
                let selection = ''
                if (hit && typeof x.select === 'function') {
                    // xterm 의 select(column, row, length) 에서 row 는 **절대 버퍼 행**이다
                    x.select(0, hit.abs, Math.max(2, hit.text.trim().length))
                    await sleep(150)
                    try { selection = rcPane.frontend.getSelection() || '' } catch { selection = '' }
                }

                const copyCalls = []
                const clearCalls = []
                const pasteCalls = []
                // 클립보드를 **덮지 않는다** — 호출만 세고 통과시키지 않는다. 사용자가 담아 둔
                // 클립보드를 프로브가 날려버리면 그것만으로 사고다.
                const okCopy = wrap(rcPane.frontend, 'copySelection', () => () => { copyCalls.push(1) })
                // clearSelection 은 **통과시킨다** — 프로브가 만든 선택이 제품 경로로 치워져야 한다
                wrap(rcPane.frontend, 'clearSelection', orig => () => { clearCalls.push(1); return orig() })
                wrap(rcPane, 'paste', () => () => { pasteCalls.push(1) })

                if (selection) {
                    const at = centerOf(rcTarget)
                    mouse(rcTarget, 'mousedown', at)
                    await sleep(60) // 짧게 — 길게 누르면 메뉴 분기로 간다(IN3)
                    mouse(rcTarget, 'mouseup', at)
                    await sleep(400)
                }

                const pass = (!okCopy || !selection) ? null
                    : (copyCalls.length === 1 && clearCalls.length >= 1 && pasteCalls.length === 0)
                add('IN4', '우클릭(짧게) — 선택 있으면 복사', pass,
                    !okCopy ? 'frontend.copySelection 이 함수가 아니다'
                        : !selection ? '선택을 만들지 못했다 (화면에 고를 글자가 없거나 xterm.select 가 없다) — 클립보드는 건드리지 않았다'
                            : pass ? `선택 ${selection.length}자 → copySelection 1회 + clearSelection, 붙여넣기 0회`
                                : `copySelection ${copyCalls.length} / clearSelection ${clearCalls.length} / paste ${pasteCalls.length} (기대 1 / 1+ / 0)`,
                    {
                        selectionLen: selection.length, selectionHead: selection.slice(0, 24),
                        copyCalls: copyCalls.length, clearCalls: clearCalls.length,
                        pasteCalls: pasteCalls.length, wroteMarker,
                        note: '클립보드 쓰기는 랩으로 막았다 — 실사용 클립보드 무변경',
                    })
            } catch (e) {
                add('IN4', '우클릭(짧게) — 선택 있으면 복사', false, `예외: ${(e && e.message) || e}`, null)
            }
            restoreAll()
            // 선택이 남으면 다음 우클릭이 복사 분기로 새고 화면에도 하이라이트가 남는다
            try { rcPane.frontend.clearSelection() } catch { /* 무시 */ }
        }

        // ============================================================ IN5 Ctrl+V 텍스트 — 정확히 1회
        // **이 리포의 옛 사고다** — 핫키와 캡처가 겹쳐 한 번 눌러 두 번 붙었다
        // (`.agentdeck-diag.log` 에 hotkey-paste 가 1ms 간격 2회, deck.service.ts:1050).
        // 지금은 캡처가 전파를 끊고 doPaste 가 80ms 중복 가드까지 두므로 정확히 1회여야 한다.
        {
            const pane = await focusTerminal()
            const ta = pane && pane.frontend.xterm.textarea
            if (cfg.claimCtrlV === false) {
                add('IN5', 'Ctrl+V 텍스트 — pane.paste() 정확히 1회', null,
                    'claimCtrlV 꺼짐 — 캡처가 Ctrl+V 를 받지 않는다 (리터럴 0x16 을 앱에 넘기는 설정)', null)
            } else if (!pane || !ta) {
                add('IN5', 'Ctrl+V 텍스트 — pane.paste() 정확히 1회', null,
                    pane ? 'xterm textarea 를 못 찾았다' : '터미널 pane 이 없다', null)
            } else {
                try {
                    await sleep(200) // PASTE_DEDUPE_MS(80ms) 넘기기
                    const pasteCalls = []
                    const okPaste = wrap(pane, 'paste', () => () => { pasteCalls.push(1) })
                    forgetProbeFlag(pane, '__adSendInputProbe')
                    forgetProbeFlag(pane.session, '__adWriteProbe')
                    try { pane.frontend.xterm.focus(); ta.focus() } catch { /* 포커스 실패는 치명적이지 않다 */ }
                    const diagAt = diagTail().length // 이 케이스가 남긴 줄만 본다 (IN2 주석 참고)

                    // xterm 의 숨은 textarea 는 `isPlainInput` 에서 제외된다(deck.service.ts:1529) —
                    // 즉 여기로 쏴야 실사용과 같은 경로다. 설정 화면의 INPUT 이면 제품이 손대지 않는다.
                    keyOn(ta, { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true })
                    await sleep(400)

                    const imageBranch = /paste image app=/.test(diagTail().slice(diagAt))
                    const pass = !okPaste ? null : imageBranch ? null : (pasteCalls.length === 1)
                    add('IN5', 'Ctrl+V 텍스트 — pane.paste() 정확히 1회', pass,
                        !okPaste ? 'pane.paste 가 함수가 아니다'
                            : imageBranch ? '클립보드가 이미지 전용이어서 텍스트 분기를 타지 않았다 (IN6 참조)'
                                : pass ? 'pane.paste() 1회 — 이중 붙여넣기 회귀 없음'
                                    : `pane.paste() ${pasteCalls.length}회 (기대 1). 2회면 핫키·캡처가 다시 겹친 것이다`,
                        {
                            pasteCalls: pasteCalls.length, imageBranch,
                            hotkeyPaste: (ad.config.store.hotkeys || {})['agentdeck-paste'],
                        })
                } catch (e) {
                    add('IN5', 'Ctrl+V 텍스트 — pane.paste() 정확히 1회', false, `예외: ${(e && e.message) || e}`, null)
                }
                restoreAll()
            }
        }

        // ============================================================ IN6 이미지 전용 클립보드 분기
        // 격리 환경에서는 `clipboard.writeImage()` 뒤 `readImage().isEmpty()` 가 true 라
        // 이 분기를 **만들 수 없다** (`tools/README.md` "사람이 해야 하는 것" R6).
        // 대신 `clipboardHasImageOnly` 가 실제로 보는 값을 같은 방법으로 읽어 남긴다
        // (`require('electron').clipboard`, deck.service.ts:137). 읽기만 하므로 클립보드 무변경.
        // 키 매핑 자체는 IN6B 가 정적으로 판정한다.
        {
            let cb = null
            try { cb = require('electron').clipboard } catch { cb = null }
            if (!cb) {
                try {
                    const req = window.require || globalThis.require
                    cb = req ? req('electron').clipboard : null
                } catch { cb = null }
            }
            let seen = null
            if (cb) {
                try {
                    const hasImage = !cb.readImage().isEmpty()
                    const text = cb.readText() || ''
                    // 제품 판정식 그대로: `hasImage && text.trim() === ''` (deck.service.ts:1791)
                    seen = { hasImage, textLen: text.length, imageOnly: hasImage && text.trim() === '' }
                } catch (e) {
                    seen = { error: String((e && e.message) || e) }
                }
            }
            add('IN6', '이미지 전용 클립보드 분기', null,
                cb
                    ? '판정 불가 — 격리 환경은 클립보드에 이미지를 넣을 수 없다(writeImage 후 readImage().isEmpty()===true). '
                        + `clipboardHasImageOnly 가 지금 보는 값만 남긴다: imageOnly=${seen && seen.imageOnly}`
                    : 'Electron clipboard 를 얻지 못했다 — 제품도 이때 텍스트 붙여넣기로 떨어진다(:1782)',
                {
                    clipboard: seen,
                    agent: ad.agentOf ? ad.agentOf() : null,
                    config: { pasteImageWithCtrlV: cfg.pasteImageWithCtrlV, imagePasteKey: cfg.imagePasteKey },
                })
        }

        // ============================================================ IN6B 프로필별 이미지 키 (정적 대조)
        // 실측된 규약: Claude=`ESC v`(1b 76), Codex=`0x16`, Gemini=관측 없음(`config` 폴백)
        // (`src/agents.ts` 각 프로필 주석 · `docs/DEVELOPMENT.md` "이미지 키는 반대다" 절).
        // 런타임에서 이 분기를 만들 수 없으니 **소스를 읽어** 규약과 코드가 아직 같은지 본다.
        {
            const root = findRepoRoot()
            if (!root) {
                add('IN6B', '프로필별 이미지 키 매핑 (정적 대조)', null,
                    '리포 루트를 못 찾았다 — 메인이 평가 전에 `window.__agentdeckProbeRoot = "<리포경로>"` 를 넣어주면 판정된다',
                    { tried: rootCandidates() })
            } else {
                try {
                    const agentsSrc = fs.readFileSync(path.join(root, 'src', 'agents.ts'), 'utf8')
                    const deckSrc = fs.readFileSync(path.join(root, 'src', 'deck.service.ts'), 'utf8')
                    // 프로필 블록을 `id: '<이름>'` 부터 다음 프로필의 `id: '` 까지로 잘라 그 안을 읽는다
                    const keyOfProfile = id => {
                        const at = agentsSrc.indexOf(`id: '${id}'`)
                        if (at < 0) { return null }
                        const next = agentsSrc.indexOf("id: '", at + 5)
                        const block = agentsSrc.slice(at, next < 0 ? agentsSrc.length : next)
                        const m = /imagePasteKey:\s*'([^']+)'/.exec(block)
                        return m ? m[1] : null
                    }
                    const got = {
                        claude: keyOfProfile('claude'),
                        codex: keyOfProfile('codex'),
                        gemini: keyOfProfile('gemini'),
                    }
                    const want = { claude: 'alt-v', codex: 'ctrl-v', gemini: 'config' }
                    const mapOk = got.claude === want.claude && got.codex === want.codex && got.gemini === want.gemini
                    // 그 라벨이 실제로 어떤 **바이트**가 되는지 — `sendImagePasteKey` 의 삼항식
                    // (deck.service.ts:1622). 제품 소스에는 리터럴 0x16 / 0x1B 가 박혀 있다.
                    const at = deckSrc.indexOf("const key = mode === 'ctrl-v' ?")
                    const line = at < 0 ? '' : deckSrc.slice(at, at + 60)
                    const bytesOk = at >= 0 && line.indexOf(`'${SYN}'`) >= 0 && line.indexOf(`'${ESC}v'`) >= 0
                    add('IN6B', '프로필별 이미지 키 매핑 (정적 대조)', mapOk && bytesOk,
                        !mapOk ? `agents.ts 의 imagePasteKey 가 실측 규약과 다르다 (got=${JSON.stringify(got)} want=${JSON.stringify(want)})`
                            : !bytesOk ? "sendImagePasteKey 의 바이트 매핑이 ctrl-v→0x16 / 그 외→0x1B 0x76 이 아니다"
                                : "claude='alt-v'→ESC v(1b 76), codex='ctrl-v'→0x16, gemini='config'(관측 없음) — 규약 일치",
                        {
                            root, profiles: got, want,
                            // 리터럴 제어문자를 결과에 그대로 싣지 않는다 — 16진수로만 남긴다
                            bytesLineHex: hex(line.slice(0, 48)),
                            runtimeAgent: ad.agentOf ? ad.agentOf() : null,
                        })
                } catch (e) {
                    add('IN6B', '프로필별 이미지 키 매핑 (정적 대조)', null,
                        `소스를 읽지 못했다: ${(e && e.message) || e}`, { root })
                }
            }
        }

        // ============================================================ IN7 Shift+Enter / Ctrl+Enter / 맨 Enter
        // 각각 0x0A 를 **한 번**, 맨 Enter 는 0x0A 를 보내지 **않아야** 한다(전송이므로).
        // 랩 위치는 `pane.sendInput` — `sendNewline()` 이 그것으로 쓴다(deck.service.ts:1944).
        // xterm 이 자기 경로로 0x0D 를 흘리는 것은 `session.write` 라 여기 안 잡힌다(정상).
        {
            const pane = await focusTerminal()
            const ta = pane && pane.frontend.xterm.textarea
            if (cfg.claimShiftEnter === false) {
                add('IN7', 'Shift+Enter / Ctrl+Enter 줄바꿈 (0x0A 1회) · 맨 Enter 는 전송', null,
                    'claimShiftEnter 꺼짐 — 캡처 경로를 안 쓴다 (핫키만 남는다)', null)
            } else if (!pane || !ta) {
                add('IN7', 'Shift+Enter / Ctrl+Enter 줄바꿈 (0x0A 1회) · 맨 Enter 는 전송', null,
                    pane ? 'xterm textarea 를 못 찾았다' : '터미널 pane 이 없다', null)
            } else {
                try {
                    const sent = []
                    wrap(pane, 'sendInput', () => d => { sent.push(String(d)) })
                    forgetProbeFlag(pane, '__adSendInputProbe')
                    try { ta.focus() } catch { /* 무시 */ }
                    // **맨 Enter 는 라벨을 바꾼다.** `claimEnterLabel` 이 화면에서 프롬프트를 읽어
                    // `status.setLabel` 을 부르는데(deck.service.ts:1475), 셸 프롬프트(`PS C:\…>`)도
                    // 일반 머리글자 `>` 에 걸린다. 프로브가 사이드바 라벨을 바꿔 놓고 나가면
                    // 다음 프로브·사람 눈에 그게 실제 작업 이름으로 보인다 — 원값을 되돌린다.
                    // (문자열이라 `status.get()` 의 살아있는 객체 문제는 없다 — probe-all.js R20 참고)
                    const labelTab = ad.app.activeTab
                    const labelBefore = labelTab && ad.status.get ? ad.status.get(labelTab).label : null

                    const shoot = async init => {
                        forgetShift(ta) // Shift 추적 초기화 (케이스 간 오염 차단 — 위 forgetShift 주석)
                        await sleep(140)
                        sent.length = 0
                        keyOn(ta, init)
                        await sleep(250) // sendToPane plan=now 는 동기, defer 는 setTimeout 0
                        return sent.slice()
                    }
                    const shiftEnter = await shoot({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                    const ctrlEnter = await shoot({ key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true })
                    const bareEnter = await shoot({ key: 'Enter', code: 'Enter', keyCode: 13 })
                    forgetShift(ta)
                    const labelAfter = labelTab && ad.status.get ? ad.status.get(labelTab).label : null
                    if (labelTab && labelBefore !== null && labelAfter !== labelBefore) {
                        try { ad.status.setLabel(labelTab, labelBefore) } catch { /* 복원 실패는 치명적이지 않다 */ }
                    }

                    const oneLf = list => list.length === 1 && list[0] === LF
                    const cases = [
                        { name: 'Shift+Enter → 0x0A 1회', bytes: shiftEnter.map(hex), pass: oneLf(shiftEnter) },
                        { name: 'Ctrl+Enter → 0x0A 1회', bytes: ctrlEnter.map(hex), pass: oneLf(ctrlEnter) },
                        // **맨 Enter 는 `0x0D` 가 나가는 것이 정상이다.** 그건 우리가 쓴 게 아니라
                        // xterm 이 자기 키 경로로 흘린 것이고, Tabby 는 `onData → sendInput` 로
                        // 잇기 때문에 `pane.sendInput` 을 랩하면 그것까지 잡힌다
                        // (2026-09-08 실측: `bytes: ['0d']` 로 거짓 실패했다. `tools/README.md` 의
                        //  "하네스가 거짓말하는 지점" 과 같은 부류다).
                        // 우리가 보지 말아야 할 것은 **줄바꿈(0x0A)** 뿐이다.
                        {
                            name: '맨 Enter → 줄바꿈(0x0A)이 나가지 않는다',
                            bytes: bareEnter.map(hex),
                            pass: bareEnter.map(hex).indexOf('0a') < 0,
                        },
                    ]
                    const ok = cases.every(c => c.pass)
                    add('IN7', 'Shift+Enter / Ctrl+Enter 줄바꿈 (0x0A 1회) · 맨 Enter 는 전송', ok,
                        ok ? '두 조합 모두 0x0A 한 번, 맨 Enter 에는 0x0A 가 없다(0x0D 는 xterm 의 정상 전송)'
                            : `어긋난 케이스: ${cases.filter(c => !c.pass).map(c => c.name).join(', ')}`,
                        { cases, label: { before: labelBefore, after: labelAfter, restored: labelAfter !== labelBefore } })
                } catch (e) {
                    add('IN7', 'Shift+Enter / Ctrl+Enter 줄바꿈 (0x0A 1회) · 맨 Enter 는 전송', false,
                        `예외: ${(e && e.message) || e}`, null)
                }
                restoreAll()
            }
        }

        // ============================================================ IN8 IME 대기 경로
        // 0.6.3 에서 고친 그 버그다 — 확정을 재촉하면 IME 가 compositionend 로 음절을 한 번 더
        // 보내고 그 두 번째가 개행 뒤에 붙어 **음절이 새 줄로 내려간다**
        // (`docs/DEVELOPMENT.md` 0.6.3 절, 실측 2026-09-08: `한` → `ESC[H` → `한`).
        //
        // 판정 셋: ① 조합 중에는 우리 바이트가 **아무것도** 안 나간다
        //          ② compositionend 뒤 `음절 → 0x0A` 순서로 나간다
        //          ③ **개행 뒤에 음절이 없다**
        // `probe-all.js` R31 과 겹쳐도 좋다 — 저기는 순서, 여기는 입력 경로 관점이다.
        {
            const pane = await focusTerminal()
            const x = pane && pane.frontend.xterm
            const ta = x && x.textarea
            const helper = x && x._core && x._core._compositionHelper
            if (cfg.imeOrderGuard === false) {
                add('IN8', 'IME 조합 중 Shift+Enter — 개행이 새지 않고 음절이 뒤로 안 밀린다', null,
                    'imeOrderGuard 꺼짐 — 0.4.0 까지의 동작(즉시 쓰기)이 정상이다', null)
            } else if (!ta || !helper) {
                add('IN8', 'IME 조합 중 Shift+Enter — 개행이 새지 않고 음절이 뒤로 안 밀린다', null,
                    !ta ? 'xterm textarea 를 못 찾았다'
                        : '조합 헬퍼(_core._compositionHelper)를 못 찾았다 — xterm 내부 구조가 바뀌었다',
                    null)
            } else {
                let sub = null
                try {
                    const log = []
                    wrap(pane, 'sendInput', () => d => { log.push({ src: 'plugin', data: String(d) }) })
                    forgetProbeFlag(pane, '__adSendInputProbe')
                    sub = x.onData(d => log.push({ src: 'xterm', data: String(d) }))
                    const comp = (type, data) => ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
                    try { ta.focus() } catch { /* 무시 */ }
                    forgetShift(ta)
                    await sleep(140)

                    // ① 조합 중 + Shift+Enter — 이 시점에 나가는 것은 아무것도 없어야 한다.
                    //    0.5.0 은 여기서 개행을 먼저 보내 음절이 새 줄로 내려갔다.
                    ta.value = ''
                    comp('compositionstart')
                    ta.value = '한'
                    comp('compositionupdate', '한')
                    await sleep(40)
                    log.length = 0
                    keyOn(ta, { key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                    await sleep(140)
                    const during = log.slice()
                    // 우리(plugin)가 쓴 것 중 한글이 아닌 것 = 개행이 먼저 샌 것
                    const leaked = during.filter(e => e.src === 'plugin' && !/[가-힣]/.test(e.data))

                    // ② ③ compositionend → 음절 → 0x0A, 개행 뒤에 음절 없음.
                    //    writeAfterComposition 은 compositionend 뒤 한 틱 더 양보한다(:1301).
                    comp('compositionend', '한')
                    await sleep(450)
                    const order = log.map(e => e.data)
                    const nlAt = order.findIndex(d => d === LF)
                    const after = nlAt >= 0 ? order.slice(nlAt + 1) : []
                    const sylBefore = order.slice(0, nlAt < 0 ? order.length : nlAt).some(d => /[가-힣]/.test(d))

                    sub.dispose()
                    sub = null
                    // 대기 경로가 살아 있으면 다음 프로브에 섞인다 — 조합을 끝내고 비워 둔다
                    ta.value = ''
                    forgetShift(ta)

                    const cases = [
                        {
                            name: '조합중 Shift+Enter — 개행이 먼저 새지 않는다',
                            seen: during.map(e => `${e.src}:${hex(e.data)}`),
                            pass: leaked.length === 0,
                        },
                        {
                            name: 'compositionend 뒤 음절 → 0x0A 순서',
                            seen: order.map(hex),
                            pass: nlAt >= 0 && sylBefore,
                        },
                        {
                            name: '개행 뒤에 음절이 없다 (0.6.3 회귀)',
                            seen: after.map(hex),
                            pass: nlAt >= 0 && !after.some(d => /[가-힣]/.test(d)),
                        },
                    ]
                    const ok = cases.every(c => c.pass)
                    add('IN8', 'IME 조합 중 Shift+Enter — 개행이 새지 않고 음절이 뒤로 안 밀린다', ok,
                        ok ? '조합 중엔 아무것도 안 나가고, 확정 뒤 음절 → 개행 순서로 나간다 (plan=after-composition)'
                            : `어긋난 케이스: ${cases.filter(c => !c.pass).map(c => c.name).join(', ')}`,
                        cases)
                } catch (e) {
                    add('IN8', 'IME 조합 중 Shift+Enter — 개행이 새지 않고 음절이 뒤로 안 밀린다', false,
                        `예외: ${(e && e.message) || e}`, null)
                } finally {
                    if (sub) { try { sub.dispose() } catch { /* 이미 정리됨 */ } }
                }
                restoreAll()
            }
        }

        // ============================================================ IN10 Ctrl-V 핫키 회수
        // 기동 정리(`ensurePasteHotkey`)는 **`claimCtrlV` 와 무관하게** 순정 `paste`·
        // `agentdeck-paste` 에서 Ctrl-V 를 걷어낸다. 이건 갭이 아니라 요건이다 —
        // `claimCtrlV: false` 의 목적은 리터럴 0x16(quoted-insert)을 앱에 흘리는 것이고,
        // 핫키에 Ctrl-V 가 남아 있으면 HotkeysService 가 붙여넣기를 먼저 발화해 0x16 이
        // PTY 에 닿지 않는다. 2026-09-08 에 "게이트가 없다=결함" 으로 보고 게이트를 넣어봤다가
        // 이 이유로 되돌렸고, 그 판단을 여기서 잠근다.
        {
            const hk = ad.config.store.hotkeys
            if (!hk || !ad.rescanPasteHotkey) {
                add('IN10', 'Ctrl-V 핫키 회수', null,
                    hk ? 'rescanPasteHotkey 진단구가 없다' : '핫키 테이블이 없다', null)
            } else {
                const savedClaim = ad.config.store.agentDeck.claimCtrlV
                const savedPaste = Array.isArray(hk.paste) ? hk.paste.slice() : hk.paste
                const savedAd = Array.isArray(hk['agentdeck-paste']) ? hk['agentdeck-paste'].slice() : hk['agentdeck-paste']
                const run = claim => {
                    ad.config.store.agentDeck.claimCtrlV = claim
                    hk.paste = ['Ctrl-V', 'Ctrl-Shift-V']
                    hk['agentdeck-paste'] = ['Ctrl-V']
                    ad.rescanPasteHotkey()
                    return {
                        pasteHasCtrlV: (hk.paste || []).indexOf('Ctrl-V') >= 0,
                        adHasCtrlV: (hk['agentdeck-paste'] || []).indexOf('Ctrl-V') >= 0,
                        otherKept: (hk.paste || []).indexOf('Ctrl-Shift-V') >= 0,
                    }
                }
                try {
                    const on = run(true)
                    const off = run(false)

                    // 옛 이름(workdeck-*) 회수는 어느 갈래에서도 돈다 — 그건 잔재다
                    hk['workdeck-paste'] = ['Ctrl-V']
                    ad.rescanPasteHotkey()
                    const legacyGone = !('workdeck-paste' in hk)

                    const ok = !on.pasteHasCtrlV && !on.adHasCtrlV && on.otherKept
                        && !off.pasteHasCtrlV && !off.adHasCtrlV && off.otherKept
                        && legacyGone
                    add('IN10', 'Ctrl-V 핫키 회수', ok,
                        ok ? '켜든 끄든 Ctrl-V 만 걷어내고 다른 키는 남긴다 (0x16 경로 보전), 옛 이름도 회수'
                            : '회수가 설정에 따라 갈린다 — claimCtrlV=false 에서 0x16 을 못 보내게 된다',
                        { on, off, legacyGone })
                } finally {
                    ad.config.store.agentDeck.claimCtrlV = savedClaim
                    if (savedPaste === undefined) { delete hk.paste } else { hk.paste = savedPaste }
                    if (savedAd === undefined) { delete hk['agentdeck-paste'] } else { hk['agentdeck-paste'] = savedAd }
                    delete hk['workdeck-paste']
                    ad.config.save()
                }
            }
        }

        // ============================================================ IN9 진단 줄이 실제로 남았나
        // 실사용 판정의 **유일한 근거**가 이 로그다 (`tools/README.md`: OS IME 실제 조합은 사람이
        // 치고 `ime send=…` 줄로 분기를 확인한다). 비어 있으면 그 자체가 결함이다 — 기능이
        // 돌아도 다음 신고 때 어느 분기였는지 가를 수단이 사라진다.
        {
            const tail = diagTail()
            if (diagStart < 0 && !tail) {
                add('IN9', '진단 줄 (~/.agentdeck-diag.log)', null,
                    `진단 파일이 없다 (${DIAG_PATH}) — 홈 디렉토리에 쓸 수 없는 환경일 수 있다`, null)
            } else {
                const lines = tail.split('\n').filter(Boolean)
                const has = re => lines.some(l => re.test(l))
                // 위 시나리오가 남겨야 하는 줄. `ime send=` 는 sendToPane(:1249),
                // `newline (capture)` 는 claimShiftEnterKey(:1421), `paste (…)` 는 doPaste(:1587).
                const want = [
                    { name: 'ime send=newline', re: /ime send=newline/, need: ran('IN7') || ran('IN8') },
                    {
                        name: 'plan=after-composition (IME 대기 경로)',
                        re: /ime send=newline .*(plan=after-composition|wrote-after=)/,
                        need: ran('IN8'),
                    },
                    { name: 'newline (capture)', re: /newline \(capture\)/, need: ran('IN7') },
                    {
                        name: 'paste (ctrl-v|rightclick|fallback)',
                        re: /paste \((ctrl-v|rightclick|hotkey)\)|paste fallback/,
                        need: ran('IN2') || ran('IN5'),
                    },
                ]
                const checked = want.filter(w => w.need).map(w => ({ name: w.name, pass: has(w.re) }))
                const pass = checked.length ? checked.every(c => c.pass) : null
                add('IN9', '진단 줄 (~/.agentdeck-diag.log)', pass,
                    !checked.length ? '위 시나리오가 하나도 판정되지 않아 기대할 줄이 없다'
                        : pass ? `프로브 시작 이후 ${lines.length}줄 중 기대한 분기 ${checked.length}종이 전부 남았다`
                            : `안 남은 줄: ${checked.filter(c => !c.pass).map(c => c.name).join(', ')} — 진단이 죽으면 실사용 판정 근거가 없다`,
                    {
                        path: DIAG_PATH, startedAtIso, newLines: lines.length, checked,
                        sample: lines.filter(l => /ime send=|newline \(capture\)|paste |clipboard /.test(l)).slice(-12),
                    })
            }
        }
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
    } finally {
        restoreAll()
        // 남을 수 있는 것 셋 — 열린 메뉴 / 선택 / Shift 눌림 추적
        try { document.querySelectorAll('.ad-menu').forEach(n => n.remove()) } catch { /* 무시 */ }
        try {
            for (const p of panes()) {
                if (p.frontend && typeof p.frontend.clearSelection === 'function') { p.frontend.clearSelection() }
                const t = p.frontend && p.frontend.xterm && p.frontend.xterm.textarea
                if (t) { forgetShift(t) }
            }
        } catch { /* 무시 */ }
        try { ad.render() } catch { /* 무시 */ }
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    return JSON.stringify({ summary, results }, null, 1)
})()
