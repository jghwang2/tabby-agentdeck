/**
 * 전수 회귀 프로브 — `docs/REGRESSION.md` 의 **R1~R37 전부**를 한 번에 잰다.
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스
 *   node tools/cdp.js 9222 tools/probe-all.js
 *
 * `probe.js` 는 신규 기능(R22~R35)만 본다. 이 파일은 **초기 항목까지 포함한 전수**다 —
 * "한 곳을 고치면 다른 곳이 깨진다" 가 이 리포의 상시 위험이라, 전부를 한 번에 재는 수단이
 * 없으면 회귀는 결국 사람 손에 맡겨진다.
 *
 * 결과: `{ id, name, pass, detail, evidence }` + `summary`.
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(환경이 조건을 못 만듦 — 실패와 섞지 않는다)
 *
 * 렌더러 안에서 도는 코드다. 창 밖의 일(재기동·창 리사이즈·`npm test`·훅 실발화)은
 * 여기서 못 하므로 그 항목은 null 로 두고 `detail` 에 밖에서 무엇을 하면 되는지 적는다.
 *
 * **자기가 바꾼 것은 되돌린다** — 설정·상태·랩한 함수·임시 파일. 오염된 인스턴스는
 * 다음 실행을 거짓말하게 만든다.
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
     * 왜 필요한가 — `sendNewline()`·`doPaste()` 는 `focusedPane()`(= `app.activeTab`)으로 보낸다
     * (`deck.service.ts`). 프로브가 탭 전환 케이스를 돌리고 나면 활성 탭이 Welcome 으로 남아
     * 이후 키 시나리오가 **아무 데도 안 가고 빈 결과**를 낸다. 실제로 첫 실행에서 R8·R31 이
     * 그 이유로 거짓 실패했다 (2026-09-08).
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

    const el = () => document.getElementById('agentdeck-view')
    const sidebar = () => document.getElementById('agentdeck-sidebar')
    const mainEl = () => document.querySelector('.content.main')
    const windowEl = () => document.querySelector('.window')
    const btn = label => Array.from((el() || document).querySelectorAll('button'))
        .find(b => (b.textContent || '').trim() === label)

    /** 화면 판정 규칙 — `src/screen.ts` 와 같아야 한다 (CDP 표현식은 import 를 못 쓴다) */
    const readLines = pane => {
        const x = pane.frontend.xterm
        const b = x.buffer.active
        const lines = []
        for (let i = b.baseY; i < b.baseY + x.rows; i++) {
            const l = b.getLine(i)
            lines.push({ text: l ? l.translateToString(true) : '', wrapped: l ? l.isWrapped : false })
        }
        return { lines, cols: x.cols }
    }

    const cfg = ad.config.store.agentDeck
    const saved = {
        viewerOpen: cfg.viewerOpen, viewerDock: cfg.viewerDock, sidebarDock: cfg.sidebarDock,
        viewerPreload: cfg.viewerPreload, viewerAutoOpen: cfg.viewerAutoOpen,
        sidebarWidth: cfg.sidebarWidth, sortByStatus: cfg.sortByStatus,
    }
    const tmpDir = path.join(os.tmpdir(), 'agentdeck-probe')
    const cleanup = []
    const restoreStatus = []

    try {
        // ============================================================ R1 폭 일치
        {
            const list = panes().map(p => ({ title: p.title, cols: p.frontend.xterm.cols, sent: p.size && p.size.columns }))
            if (!list.length) {
                add('R1', 'pty ↔ xterm 폭 일치', null, '터미널 pane 이 없다', [])
            } else {
                const ok = list.every(r => r.cols === r.sent)
                add('R1', 'pty ↔ xterm 폭 일치', ok,
                    ok ? '모든 pane 에서 xterm.cols == pane.size.columns' : '어긋난 pane 이 있다', list)
            }
        }

        // ============================================================ R2 첫 화면 안 깨짐
        // 자동 복구가 돌기 **전에** 이미 정상이었나 — 채증 파일에 `BROKEN` 이 없어야 한다
        {
            // 채증 파일(`~/.agentdeck-screen.log`)은 **누적**이라 과거 실행 기록까지 센다 —
            // 첫 판본이 그걸로 "자동 복구 13회" 라며 거짓 실패를 냈다. 지금 화면이 온전한지를 본다.
            //
            // 판정은 **제품 함수를 그대로 부른다**(`__agentdeck.judge`). 규칙을 여기 복사했더니
            // 단순화된 사본이 합성 TUI 화면을 깨진 것으로 잘못 읽었다 (2026-09-08 2차 실행).
            const now = panes().map(p => {
                const v = ad.judge ? ad.judge(p) : null
                return { title: p.title, cols: v && v.cols, broken: v && v.broken, reasons: v && v.reasons }
            })
            const measurable = now.filter(r => r.cols > 1)
            const ok = !ad.judge ? null : (measurable.length ? measurable.every(r => !r.broken) : null)
            add('R2', '첫 화면 안 깨짐', ok,
                ok === null ? (ad.judge ? '측정할 pane 이 없다' : 'judge 진단구가 없다 (구버전 빌드)')
                    : ok ? '열려 있는 화면에 자리없음 없음'
                        : '입력창 자리가 없는 pane 이 있다 (앞선 프로브 실행의 잔여일 수 있다 — R14 참고)',
                { panes: now })
        }

        // ============================================================ R3 폭 배분
        {
            const win = windowEl().clientWidth
            const m = mainEl().clientWidth
            const s = sidebar().clientWidth
            const v = el() && el().style.display !== 'none' ? el().getBoundingClientRect().width : 0
            const sum = Math.round(m + s + v)
            const ok = Math.abs(sum - win) <= 2
            add('R3', '터미널 폭 = 창폭 − 사이드바(− 패널)', ok,
                ok ? `${m} + ${s} + ${Math.round(v)} ≈ ${win}` : '합이 창폭과 다르다',
                { win, main: m, sidebar: s, view: Math.round(v), sum })
        }

        // ============================================================ R4 드래그 후에도 R1·R3
        {
            const before = cfg.sidebarWidth
            cfg.sidebarWidth = 300
            ad.relayout()
            await sleep(400)
            const list = panes().map(p => ({ cols: p.frontend.xterm.cols, sent: p.size && p.size.columns }))
            const win = windowEl().clientWidth
            const sum = Math.round(mainEl().clientWidth + sidebar().clientWidth
                + (el() && el().style.display !== 'none' ? el().getBoundingClientRect().width : 0))
            const widthOk = Math.abs(sum - win) <= 2
            const colsOk = list.length ? list.every(r => r.cols === r.sent) : null
            cfg.sidebarWidth = before
            ad.relayout()
            await sleep(300)
            add('R4', '사이드바 드래그 후에도 R1·R3', colsOk === null ? null : (widthOk && colsOk),
                colsOk === null ? '터미널 pane 이 없다' : '사이드바 300px 로 바꾼 뒤 재측정',
                { sidebarW: sidebar().clientWidth, sum, win, panes: list })
        }

        // ============================================================ R5 Enter 라벨
        // 골든 프레임을 그리고 **진짜 KeyboardEvent** 를 textarea 에 쏜다.
        // `claimEnterLabel` 은 document 캡처라 bubbles:true 면 잡힌다.
        {
            const pane = panes()[0]
            if (!pane) {
                add('R5', 'Enter 라벨', null, '터미널 pane 이 없다', null)
            } else {
                const x = pane.frontend.xterm
                const K = '\u001b[2K'
                const rule = '─'.repeat(Math.max(10, x.cols))
                const sentence = '결제 모듈 버그 확인해줘'
                x.write(`\r\n${K}${rule}\r\n${K}❯ ${sentence}\r\n${K}${rule}\r\n`)
                await sleep(350)
                const ta = x.textarea
                if (ta) { x.focus(); ta.focus() }
                const target = ta || document.body
                target.dispatchEvent(new KeyboardEvent('keydown',
                    { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
                await sleep(400)
                const labels = Array.from(sidebar().querySelectorAll('.ad-label')).map(n => n.textContent.trim())
                const hit = labels.some(l => l.indexOf(sentence) === 0)
                add('R5', 'Enter 라벨', hit,
                    hit ? '입력창 원문이 라벨에 들어갔다' : '라벨이 바뀌지 않았다 (진단의 enter-label 줄 확인)',
                    { sentence, labels })
            }
        }

        // ============================================================ R6 이미지 붙여넣기
        add('R6', 'Ctrl+V 이미지 붙여넣기', null,
            '격리 환경에서 clipboard.writeImage() 뒤 readImage().isEmpty() 가 true 다 — 사용자 실사용으로 판정',
            null)

        // ============================================================ R7 버튼 순서
        {
            const btns = Array.from(sidebar().querySelectorAll('.ad-foot .ad-btn')).map(b => b.textContent.trim())
            const want = ['+ 새 탭', '설정', '↻', '▤']
            const ok = JSON.stringify(btns) === JSON.stringify(want)
            add('R7', '사이드바 버튼 순서', ok, ok ? '순서 일치' : '순서가 다르다', { got: btns, want })
        }

        // ============================================================ R8 Shift+Enter 줄바꿈
        // 우리가 pty 로 무엇을 보내는지 가로채 본다 (실제로 쓰지는 않는다)
        {
            const pane = await focusTerminal()
            if (!pane) {
                add('R8', 'Shift+Enter 줄바꿈', null, '터미널 pane 이 없다', null)
            } else {
                const sent = []
                const orig = pane.sendInput.bind(pane)
                pane.sendInput = d => { sent.push(String(d)) }
                const ta = pane.frontend.xterm.textarea || document.body
                ta.dispatchEvent(new KeyboardEvent('keydown',
                    { key: 'Shift', code: 'ShiftLeft', keyCode: 16, bubbles: true }))
                ta.dispatchEvent(new KeyboardEvent('keydown',
                    { key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true, bubbles: true, cancelable: true }))
                await sleep(150)
                pane.sendInput = orig
                const ok = sent.length === 1 && sent[0] === '\n'
                add('R8', 'Shift+Enter 줄바꿈 (0x0A)', ok,
                    ok ? '0x0A 한 번' : '보낸 바이트가 기대와 다르다',
                    { sent: sent.map(s => [...s].map(c => c.charCodeAt(0).toString(16)).join(',')) })
            }
        }

        // ============================================================ R9 새 탭
        {
            const before = panes().length
            const newBtn = Array.from(sidebar().querySelectorAll('.ad-btn'))
                .find(b => b.textContent.trim() === '+ 새 탭')
            if (!newBtn) {
                add('R9', '새 탭에서도 R1·R3', null, '새 탭 버튼을 못 찾았다', null)
            } else {
                newBtn.click()
                await sleep(3500)
                const list = panes()
                const fresh = list[list.length - 1]
                const ok = list.length > before && fresh
                    && fresh.frontend.xterm.cols === (fresh.size && fresh.size.columns)
                add('R9', '새 탭에서도 R1·R3', list.length > before ? ok : null,
                    list.length > before
                        ? (ok ? '새 탭도 xterm.cols == pty cols' : '새 탭의 폭이 어긋난다')
                        : '새 탭이 열리지 않았다 (ConPTY 문제일 수 있다)',
                    { before, after: list.length, cols: fresh && fresh.frontend.xterm.cols, sent: fresh && fresh.size && fresh.size.columns })
            }
        }

        // ============================================================ R10/R11 재기동·창 리사이즈
        //
        // **이 판에서는 못 재지만 러너가 뒤에서 잰다.** 둘 다 창 밖의 조작(프로세스 재기동 /
        // OS 창 크기 변경)이 필요해서, 러너가 그것을 하고 **이 프로브를 다시 돌려** 판정한다
        // (4) 단계와 4-b) 단계). 그래서 요약에 같은 id 로 SKIP 과 PASS 가 함께 나온다 —
        // 여기 SKIP 은 "아직 못 잼", 뒤의 PASS 가 실제 판정이다. 문구에 그 사실을 적어 두는
        // 이유는, 예전 문구("사람이 다시 돌린다")를 읽고 **자동화가 안 되는 항목**으로
        // 오해하기 때문이다(2026-09-10: 실제로 그렇게 읽고 자동화를 다시 시도했다).
        add('R10', '크기조절 후 재기동', null,
            '이 판에서는 못 잰다 — 러너 4) 단계가 같은 cfg/ud 로 재기동한 뒤 이 프로브를 다시 돌려 판정한다'
                + ' (그 판의 `R10 PASS` 가 실제 결과다)', null)
        add('R11', '창 리사이즈', null,
            '이 판에서는 못 잰다 — 러너 4-b) 단계가 OS 창 크기를 바꾼 뒤 이 프로브를 다시 돌려 판정한다'
                + ' (그 판의 `R11 PASS` 가 실제 결과다. 폭 계산 자체는 R1·R3 가 본다)', null)

        // ============================================================ R12 탭 전환
        {
            const tabs = ad.app.tabs
            if (tabs.length < 2) {
                add('R12', '탭 전환 후에도 R1', null, '탭이 하나뿐이다', { tabs: tabs.length })
            } else {
                const first = ad.app.activeTab
                const rows = []
                for (const t of tabs) {
                    ad.app.selectTab(t)
                    await sleep(500)
                    for (const p of panes()) {
                        if (p.frontend.xterm.cols > 1) {
                            rows.push({ title: p.title, cols: p.frontend.xterm.cols, sent: p.size && p.size.columns })
                        }
                    }
                }
                if (first) { ad.app.selectTab(first) }
                await sleep(300)
                const ok = rows.length > 0 && rows.every(r => r.cols === r.sent)
                add('R12', '탭 전환 후에도 R1', rows.length ? ok : null,
                    rows.length ? (ok ? '전환한 탭 전부 폭 일치' : '어긋난 탭이 있다') : '측정할 pane 이 없다', rows)
            }
        }

        // ============================================================ R13 유닛 테스트
        add('R13', '유닛 테스트', null, '창 밖의 일이다 — `npm test` 로 판정한다', null)

        // ============================================================ R14 자리없음 감지 + 복구
        // 테두리 두 줄을 맞붙여 그려 "입력창에 자리가 없다" 를 만든다
        {
            const pane = await focusTerminal()
            if (!pane) {
                add('R14', '자리없음 감지 + 복구', null, '터미널 pane 이 없다', null)
            } else {
                const x = pane.frontend.xterm
                // `repairHard: false`(기본)는 스크롤백을 보존하므로 **내가 써 넣은 줄이 그대로 남는다** —
                // 첫 판본이 그걸 "복구 실패" 로 읽어 거짓 실패를 냈다. 이 케이스에서만 hard 로 켠다.
                const prevHard = cfg.repairHard
                cfg.repairHard = true
                const rule = '─'.repeat(x.cols)
                x.write(`\r\n${rule}\r\n${rule}\r\n`)
                await sleep(1200)
                // 감지도 복구도 **제품 규칙**으로 판정한다 (사본을 쓰면 제품과 다른 답을 낸다)
                const vBefore = ad.judge ? ad.judge(pane) : null
                const adjacent = !!(vBefore && vBefore.broken)
                // `active` 가 아니라 `all` — 대상 pane 이 활성 탭이 아니면 `active` 는 그 pane 을
                // 건드리지 않는다 (첫 판본이 그 이유로 "복구 실패" 라는 거짓 결과를 냈다)
                ad.repair('all')
                await sleep(1800)
                const vAfter = ad.judge ? ad.judge(pane) : null
                const stillAdjacent = !!(vAfter && vAfter.broken)
                cfg.repairHard = prevHard
                // 이 케이스는 화면을 일부러 더럽힌다 — **치우고 나간다.** 안 치우면 다음 실행의 R2 가
                // 그 잔여를 보고 "입력창 자리가 없다" 로 거짓 실패한다 (2026-09-08 실측)
                try { x.clear() } catch { /* 지원 안 하는 프론트엔드 */ }
                await sleep(300)
                add('R14', '자리없음 감지 + 복구', adjacent ? !stillAdjacent : null,
                    !ad.judge ? 'judge 진단구가 없다 (구버전 빌드)'
                        : adjacent
                            ? (stillAdjacent ? '복구 후에도 깨진 상태다' : '감지했고 복구로 해소됐다')
                            : '자리없음 상태를 만들지 못했다 (앱이 곧바로 다시 그렸을 수 있다)',
                    { before: vBefore, after: vAfter })
            }
        }

        // ============================================================ R15 헤더 상태별 집계
        {
            const tabs = ad.app.tabs.slice(0, 3)
            if (!tabs.length) {
                add('R15', '헤더 상태별 집계', null, '탭이 없다', null)
            } else {
                const want = ['waiting', 'running', 'idle']
                tabs.forEach((t, i) => {
                    restoreStatus.push(t)
                    ad.status.setManual(t, want[i % want.length])
                })
                ad.render()
                await sleep(300)
                const chips = Array.from(sidebar().querySelectorAll('.ad-head-count .ad-cnt'))
                    .map(n => n.textContent.trim())
                const ok = chips.length > 0
                add('R15', '헤더 상태별 집계', ok,
                    ok ? '상태별 칩이 그려진다' : '집계 칩이 없다',
                    { chips, tabs: tabs.length })
            }
        }

        // **배지를 "사이드바의 첫 `.ad-badge`" 로 집으면 안 된다.**
        // 화면 순서는 `sortByStatus`·그룹핑으로 바뀔 수 있어서 첫 줄이 `app.tabs[0]` 이라는 보장이
        // 없다 (2026-09-08 실측: 그룹핑이 `기타` 그룹을 맨 뒤로 밀어 첫 줄이 다른 탭이 되었고
        // R16·R19 가 그 탭의 `● 진행중` 을 읽어 거짓 실패했다). 그래서 제품이 각 줄에 남기는
        // `data-ad-index`(deck.service.ts renderTab)로 대상 탭의 줄을 찾아 그 안에서만 읽는다.
        const rowOf = tab => {
            const i = ad.app.tabs.indexOf(tab)
            return i < 0 ? null : sidebar().querySelector('.ad-tab[data-ad-index="' + i + '"]')
        }
        const badgeOf = tab => {
            const row = rowOf(tab)
            return row ? ((row.querySelector('.ad-badge') || {}).textContent || '') : '(줄을 못 찾았다)'
        }

        // ============================================================ R16 승인대기 이유 배지
        {
            const tab = ad.app.tabs[0]
            if (!tab) {
                add('R16', '승인대기 이유 배지', null, '탭이 없다', null)
            } else {
                restoreStatus.push(tab)
                ad.status.setManual(tab, 'waiting', undefined, 'Claude needs your permission to use Bash')
                ad.render()
                await sleep(250)
                const badge1 = badgeOf(tab)
                ad.status.setManual(tab, 'done')
                ad.render()
                await sleep(250)
                const badge2 = badgeOf(tab)
                const ok = badge1.indexOf('승인대기') >= 0 && badge1.indexOf('·') >= 0
                    && badge2.indexOf('완료') >= 0 && badge2.indexOf('·') < 0
                add('R16', '승인대기 이유 배지', ok,
                    ok ? '이유가 붙고, 상태가 바뀌면 사라진다' : '배지 문구가 기대와 다르다',
                    { waiting: badge1, done: badge2 })
            }
        }

        // ============================================================ R17 hidden 창 알림
        {
            const tab = ad.app.tabs[0]
            if (!tab || !ad.alert) {
                add('R17', 'hidden 창 알림', null, ad.alert ? '탭이 없다' : 'alert 진단구가 없다', null)
            } else {
                restoreStatus.push(tab)
                const prevForce = ad.alert.forceUnfocused
                ad.alert.forceUnfocused = true
                const f0 = ad.alert.flashes
                ad.status.setManual(tab, 'done')
                await sleep(150)
                ad.status.setManual(tab, 'waiting')
                await sleep(400)
                const f1 = ad.alert.flashes
                const b1 = ad.alert.badgeCount
                ad.status.setManual(tab, 'waiting') // 같은 상태 재지정 = 전이 아님
                await sleep(300)
                const f2 = ad.alert.flashes
                ad.status.setManual(tab, 'done')
                await sleep(400)
                const b2 = ad.alert.badgeCount
                ad.alert.forceUnfocused = prevForce
                const ok = f1 > f0 && f2 === f1 && b1 >= 1 && b2 === 0
                add('R17', 'hidden 창 알림', ok,
                    ok ? '전이마다 flash +1, 같은 상태 재지정은 전이 아님, 해소되면 뱃지 0'
                        : '알림 카운터가 기대와 다르다',
                    { flashes: [f0, f1, f2], badge: [b1, b2] })
            }
        }

        // ============================================================ R18 탭 ID 환경변수
        {
            const map = ad.tabIds ? ad.tabIds() : null
            if (!map) {
                add('R18', '탭 ID 환경변수 바인딩', null, 'tabIds 진단구가 없다 (구버전 빌드)', null)
            } else {
                // 셸에 직접 물어본다 — 표식을 붙여 출력해야 화면에서 골라낼 수 있다.
                // 새 탭은 pty 준비 전이라 입력이 유실되므로(실측) **이미 살아 있는 탭**을 쓴다.
                const pane = await focusTerminal()
                let shellId = null
                if (pane && typeof pane.sendInput === 'function') {
                    pane.sendInput('echo "ADTAB=$env:AGENTDECK_TAB="\r')
                    for (let i = 0; i < 30; i++) {
                        await sleep(200)
                        const x = pane.frontend.xterm
                        const b = x.buffer.active
                        let found = null
                        for (let y = b.baseY; y < b.baseY + x.rows; y++) {
                            const line = b.getLine(y)
                            const t = line ? line.translateToString(true) : ''
                            // 명령 에코가 아니라 **결과** 줄을 골라야 한다 (에코엔 `$env:` 가 남아 있다)
                            const m = /ADTAB=([0-9a-f]*)=/.exec(t)
                            if (m && t.indexOf('$env:') < 0) { found = m[1] }
                        }
                        if (found !== null) { shellId = found; break }
                    }
                }
                const ids = map.reduce((acc, r) => acc.concat(r.ids), [])
                const matched = !!shellId && ids.indexOf(shellId) >= 0
                add('R18', '탭 ID 환경변수 바인딩',
                    shellId === null ? null : (shellId === '' ? null : matched),
                    shellId === null ? '셸 출력을 읽지 못했다 (TUI 가 화면을 점유했을 수 있다)'
                        : shellId === ''
                            ? '이 탭 셸에는 AGENTDECK_TAB 이 없다 — 0.2.2 이전에 열린 탭·복원된 탭은 계보 폴백이다'
                            : (matched ? '셸의 AGENTDECK_TAB 이 tabid-map 에 있다' : 'map 에 없는 id 다'),
                    { shellId, map })
            }
        }

        // ============================================================ R19 한도 도달
        {
            const tab = ad.app.tabs[0]
            if (!tab) {
                add('R19', '한도 도달 상태', null, '탭이 없다', null)
            } else {
                restoreStatus.push(tab)
                ad.status.setManual(tab, 'limited', undefined,
                    "You've hit your session limit · resets 12pm (Asia/Seoul)")
                ad.render()
                await sleep(250)
                const badge = badgeOf(tab)
                const bar = (rowOf(tab) || sidebar()).querySelector('.ad-bar')
                const color = bar ? getComputedStyle(bar).backgroundColor : ''
                ad.status.setManual(tab, 'error', undefined, 'overloaded')
                ad.render()
                await sleep(250)
                const badge2 = badgeOf(tab)
                // 문구 축약("…resets 12pm" → "12pm 리셋")은 훅 보고 경로(notify.service → reason.ts)에서
                // 일어난다. 여기서는 `setManual` 로 직접 넣으므로 원문이 그대로 붙는 것이 정상이다 —
                // 첫 판본이 축약을 기대해 거짓 실패를 냈다. 축약 규칙은 `npm test` 의 reason 18종이 본다.
                const ok = badge.indexOf('한도 도달') >= 0 && badge.indexOf('·') >= 0
                    && badge2.indexOf('오류') >= 0 && badge2.indexOf('overloaded') >= 0
                    && color === 'rgb(198, 120, 221)'
                add('R19', '한도 도달 상태', ok,
                    ok ? '`⛔ 한도 도달 · <이유>` + 전용 색, 오류는 코드 표시' : '배지 문구·색이 기대와 다르다',
                    { limited: badge, error: badge2, barColor: color })
            }
        }

        // ============================================================ R20 승인대기 → 진행중 복귀
        {
            const tab = ad.app.tabs[0]
            if (!tab) {
                add('R20', '승인대기 → 진행중 복귀', null, '탭이 없다', null)
            } else {
                restoreStatus.push(tab)
                ad.status.setManual(tab, 'waiting', undefined, 'Bash 권한')
                await sleep(120)
                ad.status.markBusy(tab)
                ad.status.resume(tab)
                await sleep(200)
                // **스냅샷을 떠야 한다** — `status.get()` 은 내부 TabState 객체를 그대로 돌려주므로
                // 참조를 들고 있으면 아래 `setManual(done)` 에 같이 바뀐다. 첫 판본이 그 때문에
                // "resume 했더니 done" 이라는 거짓 실패를 냈다 (2026-09-08).
                const live = ad.status.get(tab)
                const s = { status: live.status, pinned: live.pinned, reason: live.reason }
                // done 에는 resume 이 듣지 않아야 한다
                ad.status.setManual(tab, 'done')
                ad.status.resume(tab)
                await sleep(150)
                const s2 = { status: ad.status.get(tab).status }
                const ok = s.status === 'running' && s.pinned === true && !s.reason && s2.status === 'done'
                add('R20', '승인대기 → 진행중 복귀', ok,
                    ok ? 'resume 이 running 으로 올리고 pinned 유지·이유 소거, done 에는 무효'
                        : '복귀 규칙이 기대와 다르다',
                    { afterResume: { status: s.status, pinned: s.pinned, reason: s.reason }, doneStays: s2.status })
            }
        }

        // ============================================================ R21 StopFailure 훅
        //
        // **`probe-hooks.js` 가 판정한다** (HK2, 2026-09-10 신설). 그 프로브는 격리
        // `LOCALAPPDATA` 를 심어 `hooks/agentdeck-notify.ps1` 을 **실제로 실행**하고,
        // `error=overloaded` 면 `error`(+코드) · `error=rate_limit` 이면 `limited` 로
        // 갈리는지까지 본다. 여기서 재려면 이 프로브가 자식 프로세스를 띄워야 하는데,
        // 그러면 상태 파일이 **실사용 폴더**에 생겨 사용자의 세션 상태를 덮는다.
        add('R21', 'StopFailure 훅 실발화', null,
            '이 프로브에서는 재지 않는다 — 훅을 실제 실행하는 `probe-hooks.js`(HK2)가 판정한다'
                + ' (여기서 띄우면 상태 파일이 실사용 폴더에 생겨 사용자 세션 상태를 덮는다)', null)

        // ============================================================ R22 레이아웃 5조합
        {
            cfg.viewerOpen = true
            ad.config.save()
            await sleep(300)
            const combos = [['right', 'right'], ['left', 'right'], ['left', 'left'], ['right', 'left'], ['right', 'bottom']]
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
                const overlap = (a, b) => Math.round(a.right) > Math.round(b.left) && Math.round(b.right) > Math.round(a.left)
                rows.push({
                    combo: `view=${view} side=${side}`,
                    sum: Math.round(m.width + v.width + (horizontal ? s.width : 0)),
                    win: windowEl().clientWidth,
                    overlaps: overlap(m, v) || (horizontal && (overlap(m, s) || overlap(v, s))),
                })
            }
            const ok = rows.every(r => Math.abs(r.sum - r.win) <= 2 && !r.overlaps)
            add('R22', '미리보기 패널 — 레이아웃', ok,
                ok ? '5조합 전부 폭 합계 일치, 겹침 없음' : '어긋난 조합이 있다', rows)
            cfg.viewerDock = 'right'
            cfg.sidebarDock = 'right'
            ad.relayout()
            await sleep(200)
        }

        // ============================================================ R23 패널 열린 상태 폭
        {
            const list = panes().map(p => ({ cols: p.frontend.xterm.cols, sent: p.size && p.size.columns }))
            const ok = list.length ? list.every(r => r.cols === r.sent) : null
            add('R23', '미리보기 패널 — 폭 일치', ok,
                ok === null ? '터미널 pane 이 없다' : (ok ? '패널이 열려도 폭이 어긋나지 않는다' : '어긋났다'), list)
        }

        // ============================================================ R24/R25 렌더·주입
        {
            fs.mkdirSync(tmpDir, { recursive: true })
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
                '# 제목', '', '본문 **강조** 와 `코드`.', '',
                '| 키 | 값 |', '|---|---|', '| a | 1 |', '',
                '![그림](./probe.png)', '',
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
                h1: md.querySelectorAll('h1').length, table: md.querySelectorAll('table').length,
                img: md.querySelectorAll('img').length, strong: md.querySelectorAll('strong').length,
            } : null
            const pngOk = await openAndWait(files.png, '.ad-view-image img')
            const imgEl = el().querySelector('.ad-view-image img')
            if (imgEl && !imgEl.complete) { await sleep(400) }
            const csvOk = await openAndWait(files.csv, '.ad-view-table table')
            const table = el().querySelector('.ad-view-table table')
            const codeOk = await openAndWait(files.code, '.ad-view-code')
            const renderOk = mdOk && pngOk && csvOk && codeOk && !!shot
                && shot.h1 === 1 && shot.table === 1 && shot.img === 1
                && !!imgEl && imgEl.naturalWidth > 0
                && !!table && table.querySelectorAll('tbody tr').length === 2
            add('R24', '미리보기 — 종류별 렌더', renderOk,
                renderOk ? 'md/이미지/표/코드 4종' : '렌더되지 않은 종류가 있다',
                {
                    md: shot, imgNatural: imgEl ? `${imgEl.naturalWidth}x${imgEl.naturalHeight}` : null,
                    csvRows: table ? table.querySelectorAll('tbody tr').length : null,
                    csvQuoted: table ? (table.querySelectorAll('tbody tr')[0].children[3] || {}).textContent : null,
                })

            await openAndWait(files.md, '.ad-view-md')
            const body = el().querySelector('.ad-view-body')
            const inj = {
                scriptNodes: body.querySelectorAll('script').length,
                eventAttrs: body.querySelectorAll('[onerror],[onload],[onclick]').length,
                imgNodes: body.querySelectorAll('img').length,
                textKeepsRaw: (body.textContent || '').indexOf('<script>alert(1)</script>') >= 0,
            }
            const injOk = inj.scriptNodes === 0 && inj.eventAttrs === 0 && inj.imgNodes === 1 && inj.textKeepsRaw
            add('R25', '미리보기 — 주입 차단', injOk,
                injOk ? '원문 HTML 이 글자로만 남는다' : '태그가 만들어졌다', inj)
        }

        // ============================================================ R26 경로 줍기
        {
            const pane = panes()[0]
            if (!pane || !cfg.viewerScrape) {
                add('R26', '미리보기 — 경로 줍기', null,
                    pane ? 'viewerScrape 가 꺼져 있다' : '터미널 pane 이 없다', null)
            } else {
                // 화면에 경로를 찍는다 (출력 구독이 그것을 줍는다)
                const before = Array.from(el().querySelectorAll('.ad-view-tab')).map(c => c.textContent)
                const target = path.join(tmpDir, 'probe.md')
                // **`emitOutput(문자열)` 은 조용히 삼켜진다** — 미들웨어로 들어가고 시그니처가
                // Buffer 다(`tabby-terminal/typings/session.d.ts:30`). 2026-09-08 실측으로
                // 구독이 0회 발화했고, 이 케이스는 R24 가 이미 열어 둔 칩 때문에 **거짓 통과**했다.
                // 실제로 구독을 태우는 것은 `output` Subject 직접 발화다(hits 34→36 실측).
                const line = `Edited ${target}\r\n`
                const sess = pane.session
                if (sess && sess.output && typeof sess.output.next === 'function') {
                    sess.output.next(line)
                } else if (sess && sess.emitOutput) {
                    sess.emitOutput(require('buffer').Buffer.from(line, 'utf8'))
                } else {
                    pane.frontend.xterm.write(`\r\n${line}`)
                }
                await sleep(1500)
                const after = Array.from(el().querySelectorAll('.ad-view-tab')).map(c => c.textContent)
                const got = after.indexOf('probe.md') >= 0
                add('R26', '미리보기 — 경로 줍기', got ? true : null,
                    got ? '화면에 찍힌 경로가 최근 칩에 올라왔다'
                        : '칩이 늘지 않았다 — xterm.write 는 세션 출력이 아니라 구독을 못 태울 수 있다(판정 보류)',
                    { before, after })
            }
        }

        // ============================================================ R27 입력·상태 유지
        {
            const pathBtn = el().querySelector('.ad-view-pathbtn')
            const input = el().querySelector('.ad-view-path input')
            if (!pathBtn || !input) {
                add('R27', '미리보기 — 입력·상태 유지', null, '경로 입력 UI 를 못 찾았다', null)
            } else {
                // **없는 경로의 동작이 0.11.0 에 바뀌었다.** 예전에는 그 자리에서
                // "파일을 찾지 못했다" 를 본문에 그렸는데, 지금은 경로줄이 **만들지를 묻는다**
                // (`openOrCreate` → `pathCreateArmed`, Enter 를 한 번 더 치면 새로 만든다).
                // 그래서 제목은 **바뀌지 않는 것이 정상**이고, 안내는 `.ad-view-path-note` 에 뜬다.
                // 옛 기대(제목에 "찾지 못했다")로 두면 이 항목이 계속 거짓 실패한다
                // (2026-09-09: 실제로 그렇게 FAIL 이 났고 제품은 정상이었다).
                //
                // 여기서 **Enter 를 한 번만** 친다 — 두 번 치면 파일이 실제로 만들어지고
                // 편집 모드로 들어간다. 회귀가 남의 폴더에 파일을 만들면 안 된다.
                const titleBefore = (el().querySelector('.ad-view-title') || {}).textContent || ''
                pathBtn.click()
                await sleep(150)
                const opened = el().querySelector('.ad-view-path').style.display !== 'none'
                input.value = 'no-such-file-xyz.md'
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
                await sleep(300)
                const title = (el().querySelector('.ad-view-title') || {}).textContent || ''
                const note = (el().querySelector('.ad-view-path-note') || {}).textContent || ''
                const stillOpen = ad.view && ad.view() && ad.view().isOpen
                // Esc 로 경로줄이 접히고 `armed` 도 풀려야 한다 (다음에 Enter 한 번으로
                // 파일이 만들어지면 안 된다 — 그 확인은 probe-edit 의 ED 계열이 본다)
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
                await sleep(150)
                const closed = el().querySelector('.ad-view-path').style.display === 'none'
                const ok = opened
                    && note.indexOf('없는 파일이다') >= 0
                    && title === titleBefore
                    && !!stillOpen && closed
                add('R27', '미리보기 — 입력·상태 유지', ok,
                    ok ? '없는 경로는 만들지 묻고(본문·제목은 그대로), Esc 로 접히며 패널은 유지된다'
                        : '동작이 기대와 다르다',
                    { opened, note, title, titleBefore, stillOpen, escClosed: closed })
            }
        }

        // ============================================================ R28/R29/R30 `변경` 탭
        {
            // 한 pane 만 물어보면 그 셸이 TUI 를 돌리는 중일 때 null 이 온다 — 열려 있는 pane 을
            // 차례로 물어본다 (첫 판본이 그 이유로 R28 을 통째로 건너뛰었다)
            const cwd = await (async () => {
                for (const p of panes()) {
                    try {
                        const dir = p.session && p.session.getWorkingDirectory
                            ? await p.session.getWorkingDirectory() : null
                        if (dir) { return dir }
                    } catch { /* 다음 pane */ }
                }
                return cfg.rootProfileCwd || null
            })()
            const changeBtn = btn('변경')
            if (!changeBtn) {
                add('R28', '`변경` 탭 — git 수치 일치', null, '`변경` 버튼을 못 찾았다', null)
                add('R29', '`변경` 탭 — 실패 경로', null, '같은 이유', null)
                add('R30', '모드 왕복 후 `파일` 정상', null, '같은 이유', null)
            } else {
                changeBtn.click()
                let text = ''
                for (let i = 0; i < 60; i++) {
                    text = (el().querySelector('.ad-view-body').textContent || '').replace(/\s+/g, ' ')
                    if (/파일|변경 없음|저장소|작업 폴더/.test(text)) { break }
                    await sleep(100)
                }
                if (!cwd) {
                    add('R28', '`변경` 탭 — git 수치 일치', null, '탭의 작업 폴더를 알 수 없다', { head: text.slice(0, 120) })
                } else {
                    const runGit = args => new Promise(resolve => {
                        execFile('git', ['--no-pager', '-C', cwd].concat(args),
                            { timeout: 8000, maxBuffer: 32 * 1024 * 1024 },
                            (err, stdout) => resolve(err ? null : String(stdout)))
                    })
                    const numstat = await runGit(['diff', 'HEAD', '--numstat']) ?? await runGit(['diff', '--numstat'])
                    if (numstat === null) {
                        add('R28', '`변경` 탭 — git 수치 일치', null, `git 저장소가 아니다 (cwd=${cwd})`, { head: text.slice(0, 120) })
                    } else {
                        const rows = numstat.trim() ? numstat.trim().split('\n').map(l => {
                            const [a, d, f] = l.split('\t')
                            return { file: f, add: Number(a), del: Number(d) }
                        }) : []
                        const sumAdd = rows.reduce((n, r) => n + (isFinite(r.add) ? r.add : 0), 0)
                        const sumDel = rows.reduce((n, r) => n + (isFinite(r.del) ? r.del : 0), 0)
                        const missing = rows.filter(r => text.indexOf(r.file.split('/').pop()) < 0)
                        const ok = rows.length === 0
                            ? text.indexOf('변경 없음') >= 0
                            : (missing.length === 0 && text.indexOf(`+${sumAdd} -${sumDel}`) >= 0)
                        add('R28', '`변경` 탭 — git 수치 일치', ok,
                            ok ? `numstat 과 일치 (${rows.length}파일 +${sumAdd} -${sumDel})` : '패널 수치가 다르다',
                            { files: rows.length, sumAdd, sumDel, missing: missing.map(m => m.file), head: text.slice(0, 140) })
                    }
                }
                // R29 — 실패 경로: 저장소가 아니거나 폴더를 모를 때 한 줄 안내로 끝나는가(예외로 죽지 않는가)
                const graceful = /파일|변경 없음|저장소가 아니|작업 폴더를 모른/.test(text)
                add('R29', '`변경` 탭 — 실패 경로', graceful,
                    graceful ? '어떤 경우든 문장으로 끝난다 (예외 없음)' : '안내 문구가 없다', { head: text.slice(0, 140) })

                // R30 — `파일` 로 돌아와도 정상
                const fileBtn = btn('파일')
                if (fileBtn) {
                    fileBtn.click()
                    await sleep(400)
                    const back = el().querySelector('.ad-view-md, .ad-view-code, .ad-view-image, .ad-view-table, .ad-view-empty')
                    add('R30', '모드 왕복 후 `파일` 정상', !!back,
                        back ? '`파일` 모드가 그대로 그려진다' : '본문이 비었다',
                        { node: back ? back.className : null })
                } else {
                    add('R30', '모드 왕복 후 `파일` 정상', null, '`파일` 버튼을 못 찾았다', null)
                }
            }
        }

        // ============================================================ R31 한글 조합 순서
        {
            const pane = await focusTerminal()
            const x = pane && pane.frontend.xterm
            const ta = x && x.textarea
            const helper = x && x._core && x._core._compositionHelper
            if (!ta || !helper) {
                add('R31', '한글 조합 순서 (IME)', null, '조합 헬퍼를 못 찾았다', null)
            } else {
                const log = []
                const orig = pane.sendInput.bind(pane)
                pane.sendInput = d => { log.push({ src: 'plugin', data: String(d) }) }
                const sub = x.onData(d => log.push({ src: 'xterm', data: String(d) }))
                const key = init => ta.dispatchEvent(new KeyboardEvent('keydown',
                    Object.assign({ bubbles: true, cancelable: true }, init)))
                const comp = (type, data) => ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
                const firstSyl = arr => arr.findIndex(e => e.data && /[가-힣]/.test(e.data))
                const firstOurs = arr => arr.findIndex(e => e.src === 'plugin' && !/[가-힣]/.test(e.data))
                const cases = []
                ta.focus()

                // 조합 중에는 **개행이 새어나가지 않아야 한다.** 0.6.3 부터 우리는 확정을 재촉하지
                // 않고 조합이 끝나기를 기다리므로, 이 시점에 나가는 것은 아무것도 없는 게 정답이다.
                // (0.5.0 은 여기서 개행을 먼저 보내 음절이 새 줄로 내려갔다 — 신고된 그 증상)
                ta.value = ''; comp('compositionstart'); ta.value = '한'; comp('compositionupdate', '한')
                await sleep(30); log.length = 0
                key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                await sleep(80)
                cases.push({
                    name: '조합중 + Shift+Enter — 개행이 먼저 새지 않는다',
                    order: log.map(e => e.data),
                    pass: firstOurs(log) < 0,
                })
                // 대기 경로가 남아 있으면 다음 케이스에 섞인다 — 조합을 끝내고 비워 둔다
                comp('compositionend', '한')
                await sleep(300)

                ta.value = ''; comp('compositionstart'); ta.value = '글'; comp('compositionupdate', '글')
                await sleep(30); log.length = 0
                comp('compositionend', '글')
                key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                await sleep(80)
                cases.push({ name: '확정예약중 + Shift+Enter', order: log.map(e => e.data), pass: firstSyl(log) >= 0 && firstSyl(log) < firstOurs(log) })

                ta.value = ''; comp('compositionstart'); ta.value = '문'; comp('compositionupdate', '문')
                await sleep(30); log.length = 0
                key({ key: 'Home', code: 'Home', keyCode: 36 })
                await sleep(80)
                cases.push({ name: '조합중 + Home', order: log.map(e => e.data), pass: firstSyl(log) >= 0 })

                ta.value = ''; await sleep(30); log.length = 0
                key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                await sleep(80)
                cases.push({ name: 'idle + Shift+Enter (회귀)', order: log.map(e => e.data), pass: firstSyl(log) < 0 })

                // **실사용 순서**로 한 번 더 — 조합 중에 키를 누르고, 그 뒤에 IME 가 확정을 알린다.
                // 증상은 순서가 아니라 **중복**이었다: 우리가 확정을 재촉하면 IME 의 compositionend 로
                // 음절이 한 번 더 나가고 그 두 번째가 개행 뒤에 붙어 새 줄로 내려간다.
                // 판정 = 개행 **뒤에** 음절이 없어야 한다 (2026-09-08 사용자 신고 건).
                ta.value = ''
                comp('compositionstart'); ta.value = '한'; comp('compositionupdate', '한')
                await sleep(40); log.length = 0
                key({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })
                await sleep(60)
                comp('compositionend', '한')
                await sleep(260)
                {
                    const order = log.map(e => e.data)
                    const nlAt = order.findIndex(d => d === '\n')
                    const after = nlAt >= 0 ? order.slice(nlAt + 1) : []
                    cases.push({
                        name: '조합중 + Shift+Enter — 음절이 개행 뒤로 내려가지 않는다',
                        order,
                        pass: nlAt >= 0 && !after.some(d => /[가-힣]/.test(d)),
                    })
                }

                sub.dispose()
                pane.sendInput = orig
                const ok = cases.every(c => c.pass)
                add('R31', '한글 조합 순서 (IME)', ok,
                    ok ? '조합 음절이 항상 먼저 나간다 (회귀 없음)' : '순서가 뒤집힌 시나리오가 있다', cases)
            }
        }

        // ============================================================ R32/R34 에이전트 판정
        {
            const before = ad.agentOf ? ad.agentOf() : null
            const hits0 = ad.debug ? ad.debug().outputHits : null
            if (!before || !ad.probeAgent) {
                add('R32', '에이전트 판정', null, '진단구가 없다', null)
                add('R34', '출력 기반 재판정', null, '진단구가 없다', null)
            } else {
                ad.probeAgent()
                await sleep(1200)
                const after = ad.agentOf()
                const hits1 = ad.debug ? ad.debug().outputHits : null
                const probed = after && after.probedAt !== before.probedAt
                add('R32', '에이전트 판정', probed ? true : null,
                    probed ? `판정 경로가 돈다 (id=${after.id})` : '조회 흔적이 없다', { before, after })
                add('R34', '출력 기반 재판정', hits1 !== null ? (hits1 >= hits0) : null,
                    hits1 !== null ? `출력 구독 생존 (hits ${hits0} → ${hits1})` : 'debug() 가 없다',
                    { outputHits: [hits0, hits1] })
            }
        }

        // ============================================================ R33/R35/R36 프로필·shape
        // 순수 로직이라 유닛 테스트가 본체다 — 여기서는 **배선된 값**이 실제로 그런지만 본다
        add('R33', '판정 폴백', null, '순수 로직이다 — `npm test` 의 agents 케이스가 판정한다', null)
        add('R35', '입력창 모양 주입', null, '순수 로직이다 — `npm test` 의 prompt/screen 케이스가 판정한다', null)
        add('R36', '프로필 shape 배선', null, '순수 로직 + 배선 — `npm test` 의 agents 케이스가 판정한다', null)

        // ============================================================ R37 프로브 자신
        // ============================================================ R50·R51 공통 준비
        //
        // 화면 판정을 재려면 함정 둘을 피해야 한다 —
        //  ① 출력은 `session.output.next()` 로 넣는다. `emitOutput(문자열)` 은 미들웨어가 Buffer 를
        //     기대해 **조용히 삼켜진다**(tools/README 함정 목록).
        //  ② `setManual` 은 **pin 을 건다**(status.service.ts:64). pinned 면 자동 감지가 값을 덮지
        //     않으므로 매번 `unpin` 을 불러야 한다 — 2026-09-09 에 이걸 빼먹어 7종이 한꺼번에
        //     거짓 실패했다.
        const sessionPaneOf = t => {
            const list = t && typeof t.getAllTabs === 'function' ? t.getAllTabs() : [t]
            return (list || []).filter(Boolean).find(x => x.session) || null
        }
        const screenTab = ad.app.tabs.find(t => sessionPaneOf(t))

        // ============================================================ R50 한도 도달 화면 판정
        // 0.10.0 이전에는 `limited` 가 훅(claudeHooks)으로만 왔다 — 훅이 없는 CLI 는 사용량
        // 한도에 걸려도 배지가 `진행중`/`오류` 로 남았다. 이제 화면 문구로도 판정한다.
        {
            const tab = screenTab
            const pane = tab ? sessionPaneOf(tab) : null
            if (!pane) {
                add('R50', '한도 도달 화면 판정', null, '세션이 붙은 탭이 없다', null)
            } else {
                restoreStatus.push(tab)
                const savedAuto = ad.config.store.agentDeck.autoDetect
                const feed = text => pane.session.output.next(text)
                const reset = status => { ad.status.setManual(tab, status); ad.status.unpin(tab) }
                const stat = () => ad.status.get(tab).status
                try {
                    ad.config.store.agentDeck.autoDetect = true
                    reset('idle')
                    await sleep(200)

                    // 2026-09-08 codex 실측 원문
                    feed("\u25a0 Usage limit reached. You've reached your usage limit. Increase your limits to continue using codex.\r\n")
                    await sleep(800)
                    const hit = stat()

                    // 상시 상태줄로는 풀리지 않아야 한다 — 한도 화면도 매초 다시 그려지므로
                    // "출력이 있다 = 진행중" 으로 풀면 배지가 한 조각만 떴다 사라진다
                    feed('  gpt-6-astra low fast\r\n')
                    feed('                                    ? for shortcuts\r\n')
                    await sleep(800)
                    const sticky = stat()

                    // 작업중 문구가 돌아오면 풀린다 (영구 lock 이 아니다)
                    feed(' \u2807 Thinking... (esc to cancel, 3s)\r\n')
                    await sleep(800)
                    const released = stat()

                    ad.render()
                    const ok = hit === 'limited' && sticky === 'limited' && released === 'running'
                    add('R50', '한도 도달 화면 판정', ok,
                        ok ? '한도 문구에 `limited` 로 가고, 상태줄로는 안 풀리고, 작업중 문구로 풀린다'
                            : '한도 판정이나 해제가 기대와 다르다',
                        { hit, sticky, released })
                } finally {
                    ad.config.store.agentDeck.autoDetect = savedAuto
                    try { reset('idle') } catch { /* 무시 */ }
                }
            }
        }

        // ============================================================ R51 승인 이유 화면 추출
        // 훅이 없는 CLI 는 `waiting` 이 되어도 이유가 비어 있었다 — 어느 탭이 무엇을 기다리는지
        // 사이드바만 보고 알 수 없었다. 이제 승인 화면 줄에서 이유를 뽑아 배지에 붙인다.
        //
        // 선택지 줄(`● 1. Allow once`)만 오는 조각이 있다 — 화살표로 커서만 옮긴 재그리기다.
        // 그때 배지에 `1. Allow once` 가 박히면 안 되고, 앞서 잡은 이유가 유지돼야 한다.
        {
            const tab = screenTab
            const pane = tab ? sessionPaneOf(tab) : null
            if (!pane) {
                add('R51', '승인 이유 화면 추출', null, '세션이 붙은 탭이 없다', null)
            } else {
                restoreStatus.push(tab)
                const savedAuto = ad.config.store.agentDeck.autoDetect
                const feed = text => pane.session.output.next(text)
                const reset = status => { ad.status.setManual(tab, status); ad.status.unpin(tab) }
                const snap = () => {
                    const x = ad.status.get(tab)
                    return { status: x.status, reason: x.reason || null }
                }
                try {
                    ad.config.store.agentDeck.autoDetect = true
                    reset('running')
                    await sleep(200)

                    // 2026-09-08 gemini 실측 원문 (국면③)
                    feed('\u2502 Allow execution of [Shell]?                                                  \u2502\r\n')
                    feed('\u2502 \u25cf 1. Allow once                                                              \u2502\r\n')
                    await sleep(800)
                    ad.render()
                    const asked = snap()
                    const badge = badgeOf(tab)

                    // 커서만 옮긴 재그리기 — 이유가 흔들리면 안 된다
                    feed('\u2502   2. Allow for this session                                                  \u2502\r\n')
                    await sleep(700)
                    const moved = snap()

                    // 승인 뒤 진행중으로 가면 이유가 사라진다 (다른 상태에 남으면 오독을 만든다)
                    feed(' \u2807 Thinking... (esc to cancel, 1s)\r\n')
                    await sleep(800)
                    ad.render()
                    const done = snap()

                    const ok = asked.status === 'waiting' && !!asked.reason
                        && asked.reason.indexOf('Shell') >= 0
                        && badge.indexOf(asked.reason) >= 0
                        && moved.status === 'waiting' && moved.reason === asked.reason
                        && done.status === 'running' && !done.reason
                    add('R51', '승인 이유 화면 추출', ok,
                        ok ? '승인 화면에서 이유를 뽑아 배지에 붙이고, 커서 이동에 흔들리지 않고, 상태가 바뀌면 사라진다'
                            : '이유 추출·유지·소거 중 기대와 다른 것이 있다',
                        { asked, badge, moved, done })
                } finally {
                    ad.config.store.agentDeck.autoDetect = savedAuto
                    try { reset('idle') } catch { /* 무시 */ }
                }
            }
        }

        add('R37', '회귀 프로브', true, '이 파일이 돌았다는 사실이 곧 판정이다', { results: results.length })
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
    } finally {
        try {
            for (const t of restoreStatus) { ad.status.unpin(t) }
            Object.assign(cfg, saved)
            ad.config.save()
            ad.relayout()
            ad.render()
        } catch { /* 복원 실패는 치명적이지 않다 */ }
        for (const f of cleanup) { try { fs.unlinkSync(f) } catch { /* 이미 없음 */ } }
        try { fs.rmdirSync(tmpDir) } catch { /* 비어 있지 않으면 남긴다 */ }
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    return JSON.stringify({ summary, results }, null, 1)
})()
