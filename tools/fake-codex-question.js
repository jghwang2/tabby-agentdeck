// Offline fixture for the observed Codex question shortcut. No model requests.
process.stdin.setRawMode(true)
process.stdin.resume()
let open = false
const paint = text => process.stdout.write('\x1b[2J\x1b[H' + text)
paint('Working (esc to interrupt)\r\nQueued follow-up inputs\r\n? 1 question\r\nalt+↑ to answer\r\n')
process.stdin.on('data', data => {
    const key = data.toString()
    if (key === '\x03') process.exit(0)
    if (key === '\x1b[1;3A') {
        open = true
        paint('QUESTION OPEN: Choose a test answer\r\n1. Test answer\r\nEnter to submit\r\n')
    } else if (open && /[\r\n]/.test(key)) {
        paint('ANSWER RECORDED\r\nWorking (esc to interrupt)\r\n')
    }
})
