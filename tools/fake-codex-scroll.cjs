// Deterministic PTY pager for wheel UI regression; no model requests or account access.
const mouse = process.argv.includes('--mouse')
let pager = mouse, position = 250, pending = ''
const render = () => {
    const rows = process.stdout.rows || 24
    const lines = pager
        ? ['/ T R A N S C R I P T / /', ...Array.from({ length: rows - 3 }, (_, i) => `history row ${position + i}`), '', ' q close   esc to edit prev']
        : ['OpenAI Codex', ...Array(rows - 3).fill(''), '› wheel draft stays intact', 'gpt-6-astra · Ready · Context 71% left']
    process.stdout.write('\x1b[?25l\x1b[2J\x1b[H' + lines.map((line, i) => `\x1b[${i + 1};1H${line}`).join(''))
}
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', data => {
    pending += data.toString()
    while (pending) {
        if (pending === '\x1b' || pending === '\x1b[' || /^\x1b\[<[\d;]*$/.test(pending)) break
        const report = pending.match(/^\x1b\[<(64|65);\d+;\d+M/)
        if (report) {
            position += report[1] === '64' ? -1 : 1
            pending = pending.slice(report[0].length)
            continue
        }
        if (pending.startsWith('\x1b[A') || pending.startsWith('\x1b[B')) {
            if (pager) position += pending[2] === 'A' ? -1 : 1
            pending = pending.slice(3)
        } else {
            const char = pending[0]
            pending = pending.slice(1)
            if (char === '\x03') {
                if (mouse) process.stdout.write('\x1b[?1003l\x1b[?1006l\x1b[?1049l')
                process.exit(0)
            }
            if (char === '\x14') pager = true
            if (char === 'q') pager = false
        }
    }
    render()
})
process.stdout.on('resize', render)
if (mouse) process.stdout.write('\x1b[?1049h\x1b[?1003h\x1b[?1006h')
render()
