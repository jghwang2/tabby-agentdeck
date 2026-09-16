const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { Terminal } = require('@xterm/headless')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)
const { CursorVisibilityStream, StableCursorStream, SteadyCursorStyleStream, installCursorVisibilityFix } = require('../src/cursorVisibility.ts')
const { SynchronizedOutputStream } = require('../src/synchronizedOutput.ts')
const { identifyScreenAgent } = require('../src/screenAgent.ts')
const write = (term, data) => new Promise(resolve => term.write(data, resolve))
;(async () => {
    // Measured from Codex 0.154.0's output via Tabby's own node-pty/ConPTY.
    const midFrame = '\x1b[?25h\x1b[25l\x1b[9;1H'
    const firstPacket = '\x1b[?25l\x1b[?2026h\x1b[9;1H\x1b[?25h'
    const lastPacket = '\x1b[?25l\x1b[0 q\x1b[?2026l \x1b[11;3H\x1b[?25h'
    const framed = new SynchronizedOutputStream()
    assert.equal(framed.write(firstPacket, true), '')
    assert.equal(framed.write(lastPacket, true), firstPacket + lastPacket)
    for (let split=1;split<8;split++) {
        const f = new SynchronizedOutputStream()
        assert.equal(f.write(firstPacket.slice(0,7+split),true), '')
        assert.equal(f.write(firstPacket.slice(7+split),true), '')
        assert.equal(f.write(lastPacket,true),firstPacket+lastPacket)
    }
    const claude = new SynchronizedOutputStream()
    assert.equal(claude.write(firstPacket,false),firstPacket)
    assert.equal(claude.write(lastPacket,false),lastPacket)
    const banner = '│ >_ OpenAI Codex (v0.154.0) │'
    assert.equal(identifyScreenAgent([banner]), 'codex')
    assert.equal(identifyScreenAgent([banner,'E:\\project>claude','╭─── Claude Code v2.1.263 ───╮']), 'claude')
    assert.equal(identifyScreenAgent([banner,' ▐▛███▛█   Claude Code v2.1.268']), 'claude')
    assert.equal(identifyScreenAgent([banner,'E:\\project>']), 'unknown')
    assert.equal(identifyScreenAgent(['Please explain OpenAI Codex']), 'unknown')
    const finishFrame = '\x1b[11;3H\x1b[?25h'
    const raw = new Terminal({ cols: 100, rows: 25, allowProposedApi: true })
    const fixed = new Terminal({ cols: 100, rows: 25, allowProposedApi: true })
    await write(raw, midFrame)
    assert.equal(raw._core.coreService.isCursorHidden, false, 'reproduce visible cursor on the wrong row')
    for (let split = 0; split <= midFrame.length; split++) {
        const filter = new CursorVisibilityStream()
        const actual = filter.write(midFrame.slice(0, split), true) + filter.write(midFrame.slice(split), true)
        assert.equal(actual, midFrame.replace('[25l', '[?25l'))
    }
    let corrections = 0
    const frontend = { write: data => write(fixed, data) }
    let enabled = true
    installCursorVisibilityFix(frontend, () => enabled, () => { corrections++ })
    installCursorVisibilityFix(frontend, () => enabled, () => { throw Error('double wrapping') })
    // **그리는 동안 커서를 건드리지 않는다.** 예전에는 버스트마다 숨겼다가 50ms 뒤에 켰는데,
    // Codex 의 시작 애니메이션이 100~200ms 간격으로 계속 그리는 바람에 그 규칙이 그대로
    // 깜빡임이 됐다 (2026-09-15 GIF 실측: 커서칸 밝기가 프레임마다 뒤집혔다, 5~10Hz).
    // 지금은 오가는 hide/show 를 걷어내고 **의도가 정말 바뀔 때만** 한 번 반영한다.
    for (const char of midFrame) await frontend.write(char)
    assert.equal(fixed._core.coreService.isCursorHidden, false, 'no flicker while Codex repaints')
    await frontend.write(finishFrame)
    assert.equal(fixed._core.coreService.isCursorHidden, false, 'a steady cursor stays steady')
    await new Promise(resolve => setTimeout(resolve, 75))
    assert.equal(fixed._core.coreService.isCursorHidden, false, 'and it is still steady after settling')
    assert.equal(fixed.buffer.active.cursorY, 10)
    assert.equal(fixed.buffer.active.cursorX, 2)
    assert.equal(corrections, 1)
    enabled = false
    await frontend.write(midFrame)
    assert.equal(fixed._core.coreService.isCursorHidden, false, 'other agents retain original semantics')
    const pass = new CursorVisibilityStream()
    assert.equal(pass.write('\x1b[?25l\x1b[?25h\x1b[250l', true), '\x1b[?25l\x1b[?25h\x1b[250l')
    const pending = new CursorVisibilityStream()
    assert.equal(pending.write('\x1b[25', true), '')
    assert.equal(pending.write('l', false), '\x1b[25l')
    // Real ConPTY control sequence: show on the transcript row, then move to composer.
    const transcript = '\x1b[?25l\x1b[78;1H\x1b[71;1H\x1b[?25h'
    const composer = '\x1b[?25l\x1b[73;3H\x1b[?25h'
    enabled = true
    // 실제 ConPTY 시퀀스 — 두 덩이 모두 `?25l … ?25h` 로 감싸여 온다. 앱의 의도는 처음부터
    // 끝까지 '보임' 이므로 화면도 내내 보인 채여야 한다 (그 사이 위치만 옮겨 간다)
    await frontend.write(transcript)
    assert.equal(fixed._core.coreService.isCursorHidden, false)
    await frontend.write(composer)
    assert.equal(fixed._core.coreService.isCursorHidden, false)
    await new Promise(resolve => setTimeout(resolve, 75))
    assert.equal(fixed._core.coreService.isCursorHidden, false)
    // Parser tests preserve partial CSI and an explicitly hidden final cursor.
    // 어느 자리에서 쪼개 들어와도 표시 명령은 전부 걷히고 위치 명령만 남는다.
    // 남는 것은 `visible`(앱의 의도)뿐이고, 그걸 화면에 언제 반영할지는 설치부가 정한다.
    const stripped = transcript.replace(/\x1b\[\?25[lh]/g, '')
    for (let split = 0; split <= transcript.length; split++) {
        const c = new StableCursorStream()
        assert.equal(c.write(transcript.slice(0, split), true) + c.write(transcript.slice(split), true),
            stripped)
        assert.equal(c.visible, true)
        c.write('\x1b[?25l', true)
        assert.equal(c.visible, false)
    }
    // 앱이 **정말로** 숨기면(뒤따르는 show 없이) 그 의도는 화면에 반영된다
    await frontend.write('\x1b[?25l')
    await new Promise(resolve => setTimeout(resolve, 75))
    assert.equal(fixed._core.coreService.isCursorHidden, true, 'an application-hidden cursor stays hidden')
    enabled = false
    await frontend.write('\x1b[?25h')
    assert.equal(fixed._core.coreService.isCursorHidden, false, 'other agents remain immediate')
    // ── DECSCUSR: 깜빡이는 커서 '스타일' 을 고정으로 ──
    //
    // Codex 0.154.0 은 프레임마다 `ESC [ 0 q`(= 깜빡이는 블록)를 보낸다 — 위 `lastPacket` 실측에
    // 그대로 들어 있다. 이건 표시/숨김이 아니라 **스타일**이라 가시성 필터로는 못 막고,
    // 순정 Tabby 에서도 똑같이 깜빡인다(2026-09-15 유저 확인). 모양은 두고 깜빡임만 끈다.
    const styleStream = new SteadyCursorStyleStream()
    assert.equal(styleStream.write('\x1b[0 q', true), '\x1b[2 q', 'blinking block becomes steady block')
    assert.equal(styleStream.write('\x1b[1 q', true), '\x1b[2 q')
    assert.equal(styleStream.write('\x1b[3 q', true), '\x1b[4 q', 'blinking underline becomes steady')
    assert.equal(styleStream.write('\x1b[5 q', true), '\x1b[6 q', 'blinking bar becomes steady')
    assert.equal(styleStream.write('\x1b[ q', true), '\x1b[2 q', 'omitted parameter means 0')
    assert.equal(styleStream.write('\x1b[2 q', true), '\x1b[2 q', 'already steady is left alone')
    assert.equal(styleStream.write('\x1b[4 q', true), '\x1b[4 q')
    assert.equal(styleStream.write('\x1b[0 q', false), '\x1b[0 q', 'other agents keep their own style')
    assert.equal(styleStream.write('\x1b[9 q', true), '\x1b[9 q', 'not a DECSCUSR value — untouched')
    // 어느 자리에서 쪼개 들어와도 같은 결과여야 한다 (ConPTY 는 경계를 마음대로 자른다)
    const whole = '\x1b[11;3H\x1b[0 q!'
    for (let split = 0; split <= whole.length; split++) {
        const sp = new SteadyCursorStyleStream()
        assert.equal(sp.write(whole.slice(0, split), true) + sp.write(whole.slice(split), true),
            '\x1b[11;3H\x1b[2 q!', `split at ${split}`)
    }
    // 실제 xterm 이 깜빡임을 끄는지 — 스타일 명령이 그대로 통과하면 이 값이 true 로 남는다
    const styled = new Terminal({ cols: 100, rows: 25, allowProposedApi: true })
    await write(styled, '\x1b[0 q')
    assert.equal(styled.options.cursorBlink, true, 'reproduce: Codex asks the terminal to blink')
    const steady = new Terminal({ cols: 100, rows: 25, allowProposedApi: true })
    let styleEnabled = true
    const styledFrontend = { write: data => write(steady, data) }
    installCursorVisibilityFix(styledFrontend, () => styleEnabled, () => {})
    await styledFrontend.write('\x1b[0 q')
    assert.equal(steady.options.cursorBlink, false, 'and the fix keeps it steady')
    styled.dispose(); steady.dispose()

    // ── 프레임이 커서를 딴 자리에 둔 채 끝나는 경우 ──
    //
    // Codex 는 프레임을 입력줄이 아닌 자리에서 끝내고 9ms 뒤 별도 write 로 되돌린다
    // (2026-09-15 실측). 그 사이에 xterm 이 그리면 커서가 튀어 보인다 — 270ms 마다 반복이라
    // 사람 눈에는 깜빡임이고, 깜빡임 옵션도 표시/숨김도 아니라서 위의 두 필터로는 안 잡힌다.
    const parked = new Terminal({ cols: 100, rows: 25, allowProposedApi: true })
    let parkEnabled = true
    const parkFrontend = { write: data => write(parked, data) }
    installCursorVisibilityFix(parkFrontend, () => parkEnabled, () => {})
    await parkFrontend.write('\x1b[?2026h frame \x1b[10;1H\x1b[2 q\x1b[?2026l')
    assert.equal(parked.buffer.active.cursorY, 0, 'the parked position does not reach the screen by itself')
    await new Promise(resolve => setTimeout(resolve, 9))
    await parkFrontend.write('\x1b[m \x1b[12;3H')
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(parked.buffer.active.cursorY, 11, 'both writes land together, at the restored position')
    assert.equal(parked.buffer.active.cursorX, 2)
    // 뒤가 안 오면 들고 있던 것을 그대로 내보낸다 — 커서가 엉뚱한 자리에 영영 남으면 안 된다
    await parkFrontend.write('\x1b[5;7H')
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(parked.buffer.active.cursorY, 4, 'a held frame is flushed even when nothing follows')
    assert.equal(parked.buffer.active.cursorX, 6)
    // 다른 에이전트의 탭은 붙잡지 않는다 — 그대로 곧장 흘러야 한다
    parkEnabled = false
    await parkFrontend.write('\x1b[2;2H')
    assert.equal(parked.buffer.active.cursorY, 1, 'other agents are not delayed')
    parked.dispose()

    raw.dispose(); fixed.dispose()
    console.log('PASS: real xterm reproduces cursor bug, corrected visibility/position, every chunk split, agent isolation, no double wrapping')
})().catch(error => { console.error(error); process.exitCode = 1 })
