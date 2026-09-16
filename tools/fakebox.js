#!/usr/bin/env node
/**
 * Claude Code 입력창과 같은 모양만 그리는 최소 TUI — 깨짐 감지/복구 회귀용.
 *
 * 실물 claude 로 검증하면 (a) 토큰이 들고 (b) 자율모드 에이전트가 테스트 인스턴스 안에서
 * 제멋대로 움직인다(2026-09-02 실측: 중첩 세션이 스스로 명령을 실행했다). 그래서
 * **모양만 같은 가짜**를 쓴다. 판정 규칙이 보는 것은 화면의 모양뿐이라 이걸로 충분하다.
 *
 *   ────────────  ← cols 를 꽉 채운다 (그래서 다음 줄이 wrapped 가 된다)
 *   ❯
 *   ────────────
 *     ⏵⏵ auto mode on (shift+tab to cycle)
 *
 * SIGWINCH(크기 변경)와 Ctrl+L(0x0C) 에 전체 다시 그리기로 반응한다 — 복구가 앱까지
 * 도달했는지를 이 두 경로로 잰다.
 *
 *   node tools/fakebox.js
 */
const out = process.stdout

function draw () {
    const cols = out.columns || 80
    const rows = out.rows || 24
    const rule = '─'.repeat(cols)
    const hint = '  ⏵⏵ auto mode on (shift+tab to cycle)'
    const status = ' '.repeat(Math.max(0, cols - 16)) + '● high · /effort'
    // 화면을 비우고 맨 아래에 입력창을 붙인다
    let s = '[2J[H'
    s += '[' + Math.max(1, rows - 4) + ';1H' + status
    s += '[' + Math.max(1, rows - 3) + ';1H' + rule
    // 테두리가 cols 를 꽉 채웠으므로 여기서 autowrap 이 걸려 다음 행으로 넘어간다
    s += '❯ '
    s += '[' + Math.max(1, rows - 1) + ';1H' + rule
    s += '[' + rows + ';1H' + hint
    s += '[' + Math.max(1, rows - 2) + ';3H'
    out.write(s)
}

out.on('resize', draw)
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
}
process.stdin.on('data', b => {
    for (const c of b) {
        if (c === 0x0c) { draw() }          // Ctrl+L = 전부 다시 그려라
        if (c === 0x03) { out.write('[2J[H'); process.exit(0) }
    }
})
draw()
setInterval(() => {}, 1 << 30)
