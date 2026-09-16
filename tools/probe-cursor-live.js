/**
 * 커서 깜빡임 실측 프로브 — `tools/cdp.js <port> tools/probe-cursor-live.js`.
 *
 * **사람에게 GIF 를 찍게 하지 않기 위한 것이다.** 격리 인스턴스에서 실제로 `codex` 를 띄우고,
 * xterm 이 들고 있는 값을 직접 읽어 깜빡임을 센다 —
 *   `options.cursorBlink`            : DECSCUSR 가 시킨 "깜빡여라" (2026-09-15 원인)
 *   `coreService.isCursorHidden`     : 표시/숨김 토글
 * 100ms 마다 표본을 떠서 **바뀐 횟수**를 돌려준다. 0 이면 안 깜빡인 것이다.
 */
(async () => {
    const ad = window.__agentdeck
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    if (!ad) { return { error: '__agentdeck 없음 (플러그인 미로드)' } }

    const panesOf = () => {
        const list = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { list.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return list.filter(p => p.frontend && p.frontend.xterm)
    }

    // ── 1) 터미널 탭을 하나 연다 (사이드바의 제품 경로를 그대로 쓴다) ──
    const before = panesOf().length
    const btn = document.querySelector('#agentdeck-sidebar .ad-new')
    if (!btn) { return { error: '새 탭 버튼이 없다' } }
    btn.click()
    let waited = 0
    while (waited < 10000 && panesOf().length <= before) { await sleep(250); waited += 250 }
    await sleep(1500)
    const pane = panesOf()[panesOf().length - 1]
    if (!pane) { return { error: '탭을 못 열었다' } }
    const owner = ad.app.tabs.find(t => t === pane
        || (typeof t.getAllTabs === 'function' && t.getAllTabs().indexOf(pane) >= 0))
    if (owner) { ad.app.selectTab(owner) }
    await sleep(500)

    const x = pane.frontend.xterm
    const core = x._core && x._core.coreService
    // **보이는 깜빡임의 후보를 다 잰다.** 옵션과 표시/숨김만 재면 셋 중 하나만 보는 것이고,
    // 그 둘이 0 이어도 사람 눈에는 깜빡일 수 있다 (2026-09-15: 실제로 그랬다).
    //  - blink/hidden : 터미널이 커서를 깜빡이라고 들었나 / 숨겼나
    //  - cx,cy        : 커서가 매 프레임 딴 데로 갔다 오나 (그러면 깜빡임으로 보인다)
    //  - ch,inv,sgr   : 커서가 앉은 칸의 글자·반전·SGR 깜빡임 속성이 바뀌나
    const read = () => {
        const b = x.buffer.active
        const line = b.getLine(b.baseY + b.cursorY)
        const cell = line ? line.getCell(b.cursorX) : null
        return {
            blink: !!x.options.cursorBlink,
            hidden: !!(core && core.isCursorHidden),
            cx: b.cursorX,
            cy: b.cursorY,
            ch: cell ? cell.getChars() : '',
            inv: !!(cell && cell.isInverse()),
            sgr: !!(cell && cell.isBlink()),
        }
    }

    const out = { 셸: read() }

    // **놓치던 경우를 일부러 만든다** — 우리가 붙기 전에 깜빡임이 이미 켜져 있던 상태.
    // 스트림만 고치는 구현은 이 경우 고쳐 쓸 시퀀스가 다시 오지 않아 영영 깜빡인다.
    x.options.cursorBlink = true
    out.미리켜둠 = read()

    // ── 2) codex 를 띄운다 ──
    pane.sendInput('codex\r')
    // 배너가 뜰 때까지 기다린다 — 화면에서 직접 확인한다
    const screen = () => {
        const b = x.buffer.active
        const rows = []
        for (let i = 0; i < x.rows; i++) {
            rows.push((b.getLine(b.baseY + i) || { translateToString: () => '' }).translateToString(true))
        }
        return rows.join('\n')
    }
    waited = 0
    while (waited < 40000 && !/OpenAI Codex|Ask Codex/.test(screen())) { await sleep(500); waited += 500 }
    out.codex기동ms = /OpenAI Codex|Ask Codex/.test(screen()) ? waited : -1
    if (out.codex기동ms < 0) {
        out.화면꼬리 = screen().split('\n').slice(-6).join(' | ').slice(0, 300)
        return out
    }
    out.정체 = ad.agentOf(owner || pane).effectiveId

    // ── 3) 6초 동안 33ms 마다 표본 ──
    //
    // **100ms 간격은 쓰면 안 된다.** 눈에 보이는 깜빡임이 대략 5~10Hz(주기 100~200ms)라서
    // 같은 100ms 로 뜨면 위상이 맞아떨어져 늘 같은 값만 잡힌다(에일리어싱). 33ms 로 촘촘히 뜬다.
    // xterm 이 **실제로 받는** write 를 같이 기록한다 — 커서가 튀는 이유가 "한 프레임 안" 인지
    // "write 가 둘로 갈려서" 인지는 이걸 봐야 갈린다. 동기화 표식(2026)도 함께 센다.
    const writes = []
    const t0 = Date.now()
    const realWrite = x.write.bind(x)
    x.write = (d, cb) => {
        const s = typeof d === 'string' ? d : String(d)
        writes.push({
            t: Date.now() - t0,
            len: s.length,
            cup: (s.match(/\x1b\[[0-9]*;?[0-9]*H/g) || []).slice(-3),
            sync: (s.match(/\x1b\[\?2026[hl]/g) || []).join(''),
            tail: JSON.stringify(s.slice(-24)),
            // 우리 필터가 걸렸으면 이 셋은 xterm 까지 오면 안 된다
            q0: /\x1b\[[01]? ?q/.test(s) && /\x1b\[[01] q/.test(s),
            q2: /\x1b\[2 q/.test(s),
            dec: (s.match(/\x1b\[\?25[lh]/g) || []).length,
        })
        return realWrite(d, cb)
    }
    const samples = []
    for (let i = 0; i < 360; i++) {
        samples.push({ ...read(), t: Date.now() - t0 })
        await sleep(33)
    }
    x.write = realWrite
    out.write수 = writes.length
    out.동기화표식쓴write = writes.filter(w => w.sync).length
    // **필터가 언제부터 걸렸나** — 걸렸다면 xterm 까지 `0 q` 도 `?25l/h` 도 오면 안 된다
    const win = (from, to) => {
        const w = writes.filter(s => s.t >= from && s.t < to)
        return `write ${w.length} / 깜빡이는스타일 ${w.filter(s => s.q0).length}` +
            ` / 고정스타일 ${w.filter(s => s.q2).length} / 표시숨김 ${w.reduce((n, s) => n + s.dec, 0)}`
    }
    out["구간 0-1초"] = win(0, 1000)
    out["구간 1-3초"] = win(1000, 3000)
    out["구간 3-6초"] = win(3000, 99999)
    // 커서가 튄 순간(첫 번째) 앞뒤의 write 를 그대로 보여 준다 — 원인은 여기서 갈린다
    // 기동 직후의 자리잡기 말고, **입력줄을 떠났다가 곧 돌아온** 순간을 고른다 — 그게 깜빡임이다
    const jump = samples.find((s, i) => i > 0 && i + 1 < samples.length
        && (s.cx !== samples[i - 1].cx || s.cy !== samples[i - 1].cy)
        && samples[i + 1].cx === samples[i - 1].cx && samples[i + 1].cy === samples[i - 1].cy)
    out.튄시각ms = jump ? jump.t : -1
    out.튄순간write = jump
        ? writes.filter(w => Math.abs(w.t - jump.t) < 120).map(w => `${w.t}ms len=${w.len} sync=${w.sync || '-'} cup=${w.cup.join('')} tail=${w.tail}`)
        : []
    const flips = (key) => samples.reduce((n, s, i) => n + (i && s[key] !== samples[i - 1][key] ? 1 : 0), 0)
    // 앞쪽 표본에는 **내가 일부러 켜 둔 값**이 남아 있을 수 있다 — 그건 깜빡임이 아니라 시작 조건이다.
    // 그래서 "언제 꺼졌나"를 따로 재고, 판정은 꺼진 뒤 구간으로 한다. 끝내 안 꺼지면 -1 = 실패.
    const firstOff = samples.findIndex(s => !s.blink)
    const settled = firstOff < 0 ? [] : samples.slice(firstOff)
    out.표본 = samples.length
    out.깜빡임꺼지기까지ms = firstOff < 0 ? -1 : firstOff * 33
    out.꺼진뒤표본 = settled.length
    out.꺼진뒤blink켜진표본 = settled.filter(s => s.blink).length
    out.blink뒤집힘 = flips('blink')
    out.hidden표본 = samples.filter(s => s.hidden).length
    out.hidden뒤집힘 = flips('hidden')
    // 커서가 앉은 자리와 그 칸이 바뀌는 횟수 — 이것도 눈에는 깜빡임이다
    out.위치바뀜 = samples.reduce((n, s, i) => n + (i && (s.cx !== samples[i - 1].cx
        || s.cy !== samples[i - 1].cy) ? 1 : 0), 0)
    out.커서칸글자바뀜 = flips('ch')
    out.커서칸반전바뀜 = flips('inv')
    out.SGR깜빡임표본 = samples.filter(s => s.sgr).length
    out.커서자리들 = [...new Set(samples.map(s => s.cy + ',' + s.cx))].slice(0, 12)
    // 자리가 바뀐 순간만 뽑는다 — "얼마나 빨리, 어디서 어디로" 가 보여야 원인을 짚는다
    out.자리이동 = samples.filter((s, i) => i && (s.cx !== samples[i - 1].cx || s.cy !== samples[i - 1].cy))
        .map((s, i, arr) => `${s.t}ms ${s.cy}:${s.cx}` + (i ? ` (+${s.t - arr[i - 1].t})` : ''))
    // **깜빡임 = 떠났다가 돌아오는 것.** 한 번 옮겨가서 눌러앉는 것(배너 → 입력창 안착)은
    // 깜빡임이 아니므로 세지 않는다. 판정은 이 '왕복' 횟수로 한다.
    out.떠났다돌아옴 = samples.filter((s, i) => i > 0 && i + 1 < samples.length
        && (s.cx !== samples[i - 1].cx || s.cy !== samples[i - 1].cy)
        && samples[i + 1].cx === samples[i - 1].cx && samples[i + 1].cy === samples[i - 1].cy).length
    out.판정 = (settled.length > 0 && out.꺼진뒤blink켜진표본 === 0 && out.hidden뒤집힘 === 0
        && out.떠났다돌아옴 === 0 && out.커서칸반전바뀜 === 0 && out.SGR깜빡임표본 === 0)
        ? '안 깜빡인다' : '아직 깜빡인다'
    out.정체끝 = ad.agentOf(owner || pane).effectiveId
    // 눈에 보이는 깜빡임은 blink 옵션이거나 표시/숨김 토글 둘 중 하나다 — 둘 다 0 이어야 한다
    out.첫20표본 = samples.slice(0, 20)
        .map(s => (s.blink ? 'B' : '-') + (s.hidden ? 'H' : '-') + s.cy + ':' + s.cx).join(' ')
    // **정말로 Codex 가 떠 있었나** — 숫자만 보면 앱이 죽은 판도 0 으로 나온다
    out.화면 = screen().split('\n').map(r => r.trim()).filter(Boolean).slice(-6)

    // ── 4) 정리: codex 를 닫고 탭도 닫는다 ──
    pane.sendInput('\x03')
    await sleep(300)
    pane.sendInput('\x04')
    await sleep(500)
    try { await ad.app.closeTab(owner || pane, false) } catch { /* 이미 닫혔다 */ }
    return out
})()
