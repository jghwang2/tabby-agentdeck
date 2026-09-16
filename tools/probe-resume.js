/**
 * 지난 세션 이어받기(`⟲ 지난 세션`) 회귀 프로브 — `tools/cdp.js <port> tools/probe-resume.js` 로 돈다.
 *
 * id 는 `RS1`~`RS10`.
 *
 *  - `RS1`~`RS3`: 원장이 대화기록을 실제로 읽어냈나 (스캔·cwd·라벨)
 *  - `RS4`~`RS7`: 바닥 서랍의 줄과 화면(DOM)이 일치하나 (접힘 기본값·펴기·개수 칩·줄 수)
 *  - `RS8`~`RS10`: 살아 있는 세션 표시 · 숨기기 · 이어받기 명령
 *
 * ## 규칙을 다시 적지 않는다
 *
 * "어느 세션이 목록에 드나"·"몇 줄까지"·"며칠치" 는 **제품 규칙**이다(`sessionLedger.ts`
 * `resumeRowsFor`). 프로브가 사본을 들면 그 사본이 낡는다 — `probe-group.js` 가 같은 이유로
 * `__agentdeck.groups()` 를 쓴다. 그래서 기대값은 `__agentdeck.sessions()` 에서 받고,
 * 이 프로브의 값어치는 **그것이 화면에 그대로 그려졌나** 를 대조하는 데 있다.
 *
 * `pass:null` = 판정 불가(환경이 조건을 못 만듦)이고 실패와 섞어 세지 않는다 —
 * 이 PC 에 Claude Code 대화기록이 없으면 RS1 부터 전부 판정 불가로 떨어진다.
 *
 * 실제 이어받기(탭을 열고 `claude --resume` 을 쏘는 것)는 여기서 하지 않는다. 새 셸이
 * 뜨고 claude 가 붙기까지 수 초가 걸리고 결과가 로그인 상태·네트워크에 기대므로 회귀로는
 * 불안정하다. 대신 **명령 문자열**(RS10)까지를 고정하고, 실제 기동은 사람이 한 번 본다.
 */
(async () => {
    const out = []
    const add = (id, name, pass, detail) => out.push({ id, name, pass, detail })
    const sb = () => document.querySelector('#agentdeck-sidebar')
    const ad = window.__agentdeck

    const waitFor = async (fn, ms, step) => {
        const t0 = Date.now()
        for (;;) {
            let hit = false
            try { hit = !!fn() } catch { hit = false }
            if (hit) { return Date.now() - t0 }
            if (Date.now() - t0 > ms) { return -1 }
            await new Promise(r => setTimeout(r, step || 150))
        }
    }

    if (!ad || !ad.sessions) {
        add('RS0', '진단구', null, '낡은 dist — __agentdeck.sessions() 가 없다')
        return { probe: 'resume', cases: out }
    }

    // 설정을 못박는다 — 사람이 만져 둔 값에 따라 줄 수가 달라지면 판정이 환경에 기댄다
    const cfg = ad.config.store.agentDeck
    const saved = {
        resumeList: cfg.resumeList,
        resumeListLimit: cfg.resumeListLimit,
        resumeListDays: cfg.resumeListDays,
        resumeExpanded: (cfg.resumeExpanded || []).slice(),
        resumeHidden: (cfg.resumeHidden || []).slice(),
        sortByStatus: cfg.sortByStatus,
    }

    try {
        cfg.resumeList = true
        cfg.resumeListLimit = 5
        cfg.resumeListDays = 0        // 기간 제한 없음 — 기록이 오래된 PC 에서도 줄이 선다
        cfg.resumeExpanded = []
        cfg.resumeHidden = []
        cfg.sortByStatus = false
        await ad.config.save()

        // ---------- RS1~RS3: 원장이 기록을 읽었나 ----------
        await ad.rescanSessions()
        ad.render()
        const s1 = ad.sessions()
        add('RS1', '대화기록을 스캔했다', s1.records.length > 0,
            { scanned: s1.ledger.scanned, records: s1.records.length, file: s1.ledger.file })

        if (!s1.records.length) {
            add('RS2', 'cwd 를 읽는다', null, '기록이 0개 — 이 PC 에 Claude Code 대화기록이 없다')
            add('RS3', '라벨을 읽는다', null, '기록이 0개')
        } else {
            const withCwd = s1.records.filter(r => !!r.cwd).length
            // 폴더 이름 규칙을 흉내내지 않고 기록 안의 `cwd` 를 읽는다(sessionLedger.readHead)
            add('RS2', 'cwd 를 읽는다', withCwd > 0,
                { withCwd, total: s1.records.length, sample: s1.records.find(r => r.cwd)?.cwd || null })
            const withLabel = s1.records.filter(r => !!r.label).length
            // 라벨이 하나도 없으면 목록이 UUID 뿐이라 기능 자체가 무의미하다
            add('RS3', '라벨을 읽는다', withLabel > 0,
                { withLabel, total: s1.records.length, sample: s1.records.find(r => r.label)?.label || null })
        }

        // ---------- RS4~RS7: 화면 ----------
        //
        // 서랍은 그룹마다 하나씩 목록 안에 있던 것을 **사이드바 바닥 하나**로 합쳤다 (2026-09-14).
        // 그래서 기대값도 그룹 순회가 아니라 평면 한 벌(`sessions().rows`)이다.
        const target = ad.sessions()
        if (!target.rows.length) {
            const why = '지난 세션 기록이 하나도 없다 — Claude Code·Codex 를 한 번은 돌린 PC 여야 한다'
            for (const id of ['RS4', 'RS5', 'RS6', 'RS7', 'RS8', 'RS9']) {
                add(id, '화면 대조', null, why)
            }
        } else {
            // 서랍은 목록(`.ad-list`) 밖이다 — 머리줄도 줄도 서랍 안에서만 찾는다
            const drawer = () => sb().querySelector('.ad-resume-drawer')
            const heads = () => [...sb().querySelectorAll('.ad-resume-head')]
            const rows = () => [...sb().querySelectorAll('.ad-resume-rows .ad-resume')]

            // 기본은 접힘 — 사이드바의 주인공은 살아 있는 탭이다
            add('RS4', '바닥 서랍 1개 · 기본은 접힘 (머리 1줄, 목록 0줄)',
                !!drawer() && !drawer().hidden && heads().length === 1 && rows().length === 0,
                { drawer: !!drawer(), heads: heads().length, rows: rows().length })

            // 개수 칩이 제품 계산과 같은가 (검색이 안 걸린 화면이라 `보이는수/전체` 가 아니다)
            const chip = heads()[0] ? heads()[0].querySelector('.ad-group-count') : null
            const chipN = chip ? Number(chip.textContent.trim()) : -1
            add('RS5', '개수 칩 = 제품이 센 줄 수', chipN === target.rows.length,
                { chip: chipN, expected: target.rows.length })

            // 눌러서 편다
            heads()[0].click()
            const waited = await waitFor(() => rows().length > 0, 3000, 100)
            // **잘라내지 않는다** — 기록이 몇 개든 전부 들어가고 화면은 스크롤로 감당한다
            add('RS6', '누르면 펴지고 기록을 전부 건다', rows().length === target.rows.length,
                { rows: rows().length, expected: target.rows.length, waitedMs: waited })

            // 화면의 줄 순서·글자가 제품 계산과 같은가 (라벨이 빈 세션은 `세션 xxxxxxxx` 로 그린다)
            const domTitles = rows().map(r => (r.querySelector('.ad-title') || {}).textContent || '')
            const wantTitles = target.rows.map(r => r.label || `세션 ${r.sessionId.slice(0, 8)}`)
            add('RS7', '줄 내용·순서가 제품 계산과 같다',
                JSON.stringify(domTitles) === JSON.stringify(wantTitles),
                { dom: domTitles.slice(0, 3), want: wantTitles.slice(0, 3) })

            // ---------- RS8: 살아 있는 세션 ----------
            // 같은 세션을 두 탭에서 이어받으면 두 프로세스가 한 기록에 덧쓴다 — 그래서 열린 것은
            // 이어받기가 아니라 이동이고, 화면에서도 `.open` 으로 갈린다
            const liveRow = target.rows.find(r => r.openTabId)
            if (!liveRow) {
                add('RS8', '열린 세션은 `.open` 으로 구분', null,
                    '지금 열린 Claude 세션이 없다 (훅이 안 걸렸거나 claude 가 안 돌고 있다)')
            } else {
                const i = target.rows.indexOf(liveRow)
                add('RS8', '열린 세션은 `.open` 으로 구분',
                    rows()[i] && rows()[i].classList.contains('open'),
                    { index: i, sid: liveRow.sessionId.slice(0, 8) })
            }

            // ---------- RS9: 숨기기 ----------
            //
            // **줄 수로 판정하지 않는다.** 줄 수는 `resumeListLimit` 이 걸려 있던 시절에도
            // 거짓 실패를 냈고(하나를 숨기면 다음 세션이 올라와 수가 그대로였다, 2026-09-11 실측),
            // 제한이 사라진 지금도 같은 세션이 사라졌는지가 유일한 질문이다.
            const victim = target.rows[0].sessionId
            const victimTitle = target.rows[0].label || `세션 ${victim.slice(0, 8)}`
            cfg.resumeHidden = [victim]
            await ad.config.save()
            ad.render()
            const after = ad.sessions()
            const domGone = !rows().some(r => ((r.querySelector('.ad-title') || {}).textContent || '') === victimTitle)
            add('RS9', '숨긴 세션은 목록에서 빠진다',
                !after.rows.some(r => r.sessionId === victim) && domGone,
                { hid: victim.slice(0, 8), title: victimTitle.slice(0, 30), domGone, rows: rows().length })
            cfg.resumeHidden = []
            await ad.config.save()
            ad.render()
        }

        // ---------- RS10: 이어받기 명령 ----------
        // 명령을 만드는 자리라 세션 id 모양을 한 번 더 막는다(sessionLedger.resumeCommand).
        // 여기서는 제품이 실제로 그 규칙을 들고 있는지만 본다 — 문자열 규칙 자체는 단위 테스트가 고정한다
        const sid = (ad.sessions().records[0] || {}).sessionId || ''
        add('RS10', '세션 id 가 UUID 모양이다 (명령에 그대로 들어간다)',
            !sid || /^[0-9a-fA-F-]{8,64}$/.test(sid), { sid })
    } catch (e) {
        add('RSX', '프로브 예외', false, String((e && e.stack) || e))
    } finally {
        // 만진 설정은 되돌린다 — 회귀가 사람의 설정을 바꿔 놓으면 안 된다
        Object.assign(cfg, saved)
        try { await ad.config.save() } catch { /* 저장 실패는 여기서 할 수 있는 게 없다 */ }
        try { ad.render() } catch { /* 화면은 다음 tick 이 그린다 */ }
    }

    const pass = out.filter(c => c.pass === true).length
    const fail = out.filter(c => c.pass === false).length
    const skip = out.filter(c => c.pass === null).length
    // 키 이름은 **`results` 여야 한다** — 러너(run-all.ps1:154)가 그 키로 프로브 출력을 알아본다.
    // v1.1.0 부터 `cases` 로 적혀 있어서 이 프로브는 통과하고도 러너에서 `EX-resume`
    // (출력 파싱 실패)로만 잡혔다 — RS1~RS10 이 한 번도 집계된 적이 없었다 (2026-09-14 발견).
    return { probe: 'resume', summary: { pass, fail, skip }, results: out }
})()
