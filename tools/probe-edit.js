/**
 * 패널 편집·찾기·탭전환·새 파일 회귀 프로브 (ED1~ED5 · FN1~FN2 · TB1 · CR1~CR2).
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스
 *   node tools/cdp.js 9222 tools/probe-edit.js
 *
 * probe-viewer.js 와 갈라 둔 이유 — 저 파일은 **파일을 쓰지 않는다**(읽고 그리는 것만 잰다).
 * 여기는 실제로 디스크에 저장하므로, 실패했을 때 "무엇이 파일을 건드렸나" 를 한 파일 안에서
 * 찾을 수 있어야 한다. 픽스처는 %TEMP% 아래에만 만들고 끝나면 지운다.
 *
 * **파일명은 `<stamp>-<이름>.<확장자>` 순서다** — 뒤에 stamp 를 붙이면 확장자가 `md-abc123` 이
 * 되어 `classify()` 가 글자 파일로 보지 않는다(2026-09-09 실측: 그 실수로 ED1~ED3·FN1·FN2 가
 * 통째로 거짓 실패했고 증거는 "이 형식은 편집할 수 없다" 였다).
 *
 * 결과: `{ id, pass, detail, ev }` + `summary` (probe-viewer.js 와 같은 모양).
 *   pass=true 통과 / false 실패 / **null = 판정 불가**(환경이 조건을 못 만듦)
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: 'no __agentdeck' }) }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const el = () => document.getElementById('agentdeck-view')
    const q = sel => (el() ? el().querySelector(sel) : null)
    const view = () => (ad.view ? ad.view() : null)
    const results = []
    const add = (id, pass, detail, ev) => results.push({ id, pass, detail, ev })

    const dir = path.join(os.tmpdir(), 'agentdeck-editfind')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = Date.now().toString(36)
    const made = []
    const fx = (name, text, enc) => {
        const p = path.join(dir, stamp + '-' + name)
        fs.writeFileSync(p, text, enc || 'utf8')
        made.push(p)
        return p
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
    const rootOf = pane => ad.app.tabs.find(t => t === pane
        || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0)) || null
    const titleOf = () => ((q('.ad-view-title')) || {}).textContent || ''

    const openAndWait = async (file, sel, tries = 60) => {
        ad.openFile(file)
        for (let i = 0; i < tries; i++) {
            if (q(sel)) { return true }
            await sleep(100)
        }
        return false
    }

    try {
        const vv = view()
        vv.setMode('file')
        vv.setOpen(true, false)
        await sleep(300)

        // ---------- ED1 편집 → 저장 (LF, BOM 없음) ----------
        {
            const f = fx('plain.md', '# 제목\n\n본문 한 줄.\n')
            await openAndWait(f, '.ad-view-md')
            q('.ad-view-editbtn').click()
            await sleep(300)
            const ta = q('textarea.ad-view-edit')
            const opened = !!ta
            const loaded = opened && ta.value === '# 제목\n\n본문 한 줄.\n'
            if (opened) {
                ta.value = '# 제목\n\n본문 두 줄.\n추가한 줄.\n'
                ta.dispatchEvent(new Event('input', { bubbles: true }))
            }
            await sleep(150)
            const barShown = q('.ad-view-editbar') && q('.ad-view-editbar').style.display === 'flex'
            q('.ad-view-edit-save').click()
            await sleep(500)
            const onDisk = fs.readFileSync(f, 'utf8')
            const backToView = !q('textarea.ad-view-edit')
            const ok = opened && loaded && barShown && backToView
                && onDisk === '# 제목\n\n본문 두 줄.\n추가한 줄.\n'
            add('ED1', ok, '편집 → 저장이 파일에 반영되고 보기로 돌아온다',
                { opened, loaded, barShown, backToView, onDisk: JSON.stringify(onDisk) })
        }

        // ---------- ED2 BOM + CRLF 보존 ----------
        {
            const f = fx('bomcrlf.txt', '﻿첫 줄\r\n둘째 줄\r\n')
            await openAndWait(f, '.ad-view-code')
            q('.ad-view-editbtn').click()
            await sleep(300)
            const ta = q('textarea.ad-view-edit')
            // textarea 안에서는 LF 로 보인다 (BOM 도 떼고 보여준다)
            const shownLF = !!ta && ta.value === '첫 줄\n둘째 줄\n'
            if (ta) {
                ta.value = '첫 줄\n둘째 줄\n셋째 줄\n'
                ta.dispatchEvent(new Event('input', { bubbles: true }))
            }
            await sleep(150)
            q('.ad-view-edit-save').click()
            await sleep(500)
            const raw = fs.readFileSync(f)
            const hasBom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF
            const txt = raw.toString('utf8')
            const crlfKept = txt.indexOf('\r\n') >= 0 && txt.indexOf('셋째 줄') >= 0
            const loneLf = /[^\r]\n/.test(txt.replace(/^﻿/, ''))
            add('ED2', shownLF && hasBom && crlfKept && !loneLf,
                'BOM 과 CRLF 가 저장에서 그대로 보존된다',
                { shownLF, hasBom, crlfKept, loneLf, sample: JSON.stringify(txt.slice(0, 30)) })
        }

        // ---------- ED3 편집 중 자동 갱신이 본문을 덮지 않는다 ----------
        {
            const f = fx('watched.md', '# 감시\n')
            await openAndWait(f, '.ad-view-md')
            q('.ad-view-editbtn').click()
            await sleep(300)
            const ta = q('textarea.ad-view-edit')
            if (ta) {
                ta.value = '# 사람이 친 것\n'
                ta.dispatchEvent(new Event('input', { bubbles: true }))
            }
            // 밖에서 파일이 바뀐 상황을 만든다 (감시 콜백이 renderCurrent 를 부른다)
            fs.writeFileSync(f, '# 밖에서 바뀜\n', 'utf8')
            await sleep(1800)
            const stillEditing = !!q('textarea.ad-view-edit')
            const kept = stillEditing && q('textarea.ad-view-edit').value === '# 사람이 친 것\n'
            const note = (q('.ad-view-edit-note') || {}).textContent || ''
            // 첫 저장은 경고, 두 번째가 덮어쓴다
            q('.ad-view-edit-save').click()
            await sleep(250)
            const warned = ((q('.ad-view-edit-note') || {}).textContent || '').indexOf('덮어쓴다') >= 0
            const notYet = fs.readFileSync(f, 'utf8') === '# 밖에서 바뀜\n'
            q('.ad-view-edit-save').click()
            await sleep(500)
            const finally_ = fs.readFileSync(f, 'utf8')
            add('ED3', kept && warned && notYet && finally_ === '# 사람이 친 것\n',
                '편집 중 외부 변경이 화면을 덮지 않고, 저장은 2단 확인을 받는다',
                { kept, note: note.slice(0, 40), warned, notYet, finally: JSON.stringify(finally_) })
        }

        // ---------- ED4 이미지는 편집 불가 ----------
        {
            const png = fx('tiny.png', Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                'base64'))
            await openAndWait(png, '.ad-view-image')
            q('.ad-view-editbtn').click()
            await sleep(300)
            const noEditor = !q('textarea.ad-view-edit')
            const note = (q('.ad-view-edit-note') || {}).textContent || ''
            add('ED4', noEditor && note.indexOf('편집할 수 없다') >= 0,
                '이미지는 편집 모드로 들어가지 않는다', { noEditor, note: note.slice(0, 40) })
        }

        // ---------- ED5 읽기 전용 파일 ----------
        // 이 리포를 쓰는 환경에서 가장 흔한 읽기 전용 = **P4 미체크아웃 파일**이다.
        // 판정 수치 — (1) 열자마자 안내줄에 `읽기 전용` (2) 첫 저장은 막히고 파일이 그대로
        // (3) 두 번째 누름에서만 속성을 풀고 저장한다 (말없이 풀지 않는다)
        {
            const f = fx('readonly.md', '# 원본\n')
            fs.chmodSync(f, 0o444)
            await openAndWait(f, '.ad-view-md')
            let writable = true
            try { fs.accessSync(f, fs.constants.W_OK) } catch (e) { writable = false }
            if (writable) {
                // 관리자 권한 등으로 읽기 전용이 무시되는 환경 — 실패가 아니라 판정 불가다
                add('ED5', null, '이 환경에서는 읽기 전용 속성이 걸리지 않는다', { writable })
            } else {
                q('.ad-view-editbtn').click()
                await sleep(350)
                const ta = q('textarea.ad-view-edit')
                const noteOnOpen = (q('.ad-view-edit-note') || {}).textContent || ''
                const toldOnOpen = noteOnOpen.indexOf('읽기 전용') >= 0
                if (ta) {
                    ta.value = '# 고쳤다\n'
                    ta.dispatchEvent(new Event('input', { bubbles: true }))
                }
                await sleep(200)
                q('.ad-view-edit-save').click()
                await sleep(500)
                const warned = ((q('.ad-view-edit-note') || {}).textContent || '').indexOf('다시 누르면') >= 0
                const notYet = fs.readFileSync(f, 'utf8') === '# 원본\n'
                q('.ad-view-edit-save').click()
                await sleep(600)
                const saved = fs.readFileSync(f, 'utf8') === '# 고쳤다\n'
                const closed = !q('textarea.ad-view-edit')
                add('ED5', toldOnOpen && warned && notYet && saved && closed,
                    '읽기 전용을 열자마자 알리고, 첫 저장은 막고, 두 번째에만 속성을 풀고 저장한다',
                    { noteOnOpen: noteOnOpen.slice(0, 50), warned, notYet, saved, closed })
            }
            try { fs.chmodSync(f, 0o666) } catch (e) { /* ignore */ }
        }

        // ---------- FN1 본문 찾기 ----------
        {
            const f = fx('find.log', 'alpha\nbeta\nalpha again\ngamma\nALPHA upper\n')
            await openAndWait(f, '.ad-view-code')
            q('.ad-view-findbtn').click()
            await sleep(200)
            const rowShown = q('.ad-view-find').style.display === 'flex'
            const input = q('.ad-view-find-input')
            input.value = 'alpha'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await sleep(300)
            const hits = el().querySelectorAll('mark.ad-find-hit').length
            const count1 = (q('.ad-view-find-count') || {}).textContent || ''
            const cur1 = (el().querySelector('mark.ad-find-cur') || {}).textContent || ''
            q('.ad-view-find-next').click()
            await sleep(200)
            const count2 = (q('.ad-view-find-count') || {}).textContent || ''
            // 닫으면 표시가 사라지고 본문 글자는 그대로다
            q('.ad-view-find-close').click()
            await sleep(200)
            const cleared = el().querySelectorAll('mark.ad-find-hit').length === 0
            const textIntact = (q('.ad-view-body').innerText || '').indexOf('alpha again') >= 0
            add('FN1', rowShown && hits === 3 && count1 === '1/3' && count2 === '2/3' && cleared && textIntact,
                '대소문자 무시로 3건을 찾고, 다음으로 이동하며, 닫으면 본문이 원래대로다',
                { rowShown, hits, count1, count2, cur1, cleared, textIntact })
        }

        // ---------- FN2 편집 중 찾기는 textarea 안에서 ----------
        {
            const f = fx('findedit.md', 'one\ntwo\nthree two\n')
            await openAndWait(f, '.ad-view-md')
            q('.ad-view-editbtn').click()
            await sleep(300)
            q('.ad-view-findbtn').click()
            await sleep(200)
            const input = q('.ad-view-find-input')
            input.value = 'two'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await sleep(300)
            const ta = q('textarea.ad-view-edit')
            const sel1 = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ''
            const count1 = (q('.ad-view-find-count') || {}).textContent || ''
            const at1 = ta ? ta.selectionStart : -1
            q('.ad-view-find-next').click()
            await sleep(250)
            const at2 = ta ? ta.selectionStart : -1
            const noMarks = el().querySelectorAll('mark.ad-find-hit').length === 0
            q('.ad-view-find-close').click()
            q('.ad-view-edit-cancel').click()
            await sleep(300)
            add('FN2', sel1 === 'two' && count1 === '1/2' && at2 > at1 && noMarks,
                '편집 중에는 textarea 안에서 찾아 선택하고, 본문 DOM 은 건드리지 않는다',
                { sel1, count1, at1, at2, noMarks })
        }

        // 탭 두 개를 확보한다
        while (panes().length < 2) {
            const btn = Array.from(document.querySelectorAll('button'))
                .find(b => (b.textContent || '').trim() === '+ 새 탭')
            if (!btn) { break }
            btn.click()
            for (let i = 0; i < 60; i++) {
                await sleep(200)
                if (panes().length >= 2) { break }
            }
        }
        const ps = panes()
        if (ps.length < 2) {
            add('TB1', null, '탭을 2개 만들지 못했다', { panes: ps.length })
        } else {
            const A = rootOf(ps[0])
            const B = rootOf(ps[1])
            const fileA = fx('tab-a.md', '# A\n')
            const fileB = fx('tab-b.md', '# B\n')

            // 탭 A 에서 A 파일을 본다
            ad.app.selectTab(A)
            await sleep(500)
            ad.openFile(fileA)
            await sleep(500)
            const titleA1 = titleOf()

            // 탭 B 로 옮기면 — A 의 문서가 남아 있으면 안 된다 (B 는 아직 아무것도 안 봤다)
            ad.app.selectTab(B)
            await sleep(700)
            const titleB0 = titleOf()
            const emptyOnB = !!q('.ad-view-empty')

            // B 에서 B 파일을 본다
            ad.openFile(fileB)
            await sleep(500)
            const titleB1 = titleOf()

            // 다시 A 로 → A 가 보던 파일로 돌아와야 한다
            ad.app.selectTab(A)
            await sleep(700)
            const titleA2 = titleOf()

            // 다시 B 로 → B 가 보던 파일
            ad.app.selectTab(B)
            await sleep(700)
            const titleB2 = titleOf()

            const wantA = path.basename(fileA)
            const wantB = path.basename(fileB)
            add('TB1', titleA1 === wantA && emptyOnB && titleB1 === wantB
                && titleA2 === wantA && titleB2 === wantB,
                '탭을 옮기면 본문도 그 탭이 보던 파일로 바뀐다',
                { titleA1, titleB0, emptyOnB, titleB1, titleA2, titleB2, wantA, wantB })
        }

        // ---------- CR1 없는 경로 → 2단 확인 후 생성 ----------
        {
            const target = path.join(dir, stamp + '-새폴더', '새메모.md')
            made.push(target)
            q('.ad-view-pathbtn').click()
            await sleep(250)
            const input = q('.ad-view-path input')
            input.value = target
            const press = () => input.dispatchEvent(new KeyboardEvent('keydown',
                { key: 'Enter', bubbles: true, cancelable: true }))
            press()
            await sleep(400)
            const note1 = (q('.ad-view-path-note') || {}).textContent || ''
            const notYet = !fs.existsSync(target)
            press()
            await sleep(800)
            const created = fs.existsSync(target)
            const inEditor = !!q('textarea.ad-view-edit')
            const title = titleOf()

            // 만든 파일에 바로 쳐서 저장까지 되는지
            let savedOk = false
            const ta = q('textarea.ad-view-edit')
            if (ta) {
                ta.value = '# 새 메모\n'
                ta.dispatchEvent(new Event('input', { bubbles: true }))
                await sleep(200)
                q('.ad-view-edit-save').click()
                await sleep(600)
                savedOk = fs.readFileSync(target, 'utf8') === '# 새 메모\n'
            }
            add('CR1', note1.indexOf('한 번 더') >= 0 && notYet && created && inEditor
                && title === '새메모.md' && savedOk,
                '없는 경로는 두 번째 Enter 에서 만들고 곧바로 편집으로 들어간다',
                { note1: note1.slice(0, 40), notYet, created, inEditor, title, savedOk })
            try { fs.rmSync(path.dirname(target), { recursive: true, force: true }) } catch (e) { /* ignore */ }
        }

        // ---------- CR2 폴더 경로는 거부 ----------
        {
            q('.ad-view-pathbtn').click()
            await sleep(200)
            const input = q('.ad-view-path input')
            input.value = dir
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
            await sleep(400)
            const note = (q('.ad-view-path-note') || {}).textContent || ''
            add('CR2', note.indexOf('폴더') >= 0, '폴더 경로는 파일로 만들지 않는다', { note: note.slice(0, 40) })
            q('.ad-view-pathbtn').click()
            await sleep(150)
        }

        for (const f of made) { try { fs.unlinkSync(f) } catch (e) { /* ignore */ } }
        const summary = {
            total: results.length,
            pass: results.filter(r => r.pass === true).length,
            fail: results.filter(r => r.pass === false).length,
            skipped: results.filter(r => r.pass === null).length,
        }
        return JSON.stringify({ summary, results }, null, 1)
    } catch (e) {
        return JSON.stringify({ results, error: String((e && e.stack) || e) })
    }
})()
