// Deterministic isolated recipient. No model, API request or polling process.
const fs = require('fs')
const { execFileSync } = require('child_process')
const path = require('path')
const [sessionId, root, output] = process.argv.slice(2)
const bridge = path.resolve(__dirname, '../hooks/agentdeck-mailbox.mjs')
const env = { ...process.env, AGENTDECK_MAILBOX_ROOT: root }
let line = ''
const append = event => fs.appendFileSync(output, JSON.stringify(event) + '\n')
const cli = (method, args) => {
    const file = output + '.args.json'
    if (args) fs.writeFileSync(file, JSON.stringify(args))
    return JSON.parse(execFileSync(process.execPath, [bridge, '--cli', sessionId, method, ...(args ? [file] : [])],
        { env, encoding: 'utf8', windowsHide: true })).result
}
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', data => {
    for (const c of data) {
        if (c === '\x03') process.exit(0)
        if (c === '\r') {
            append({ event: 'prompt', text: line })
            if (line.startsWith('[agentdeck]')) {
                const hook = JSON.parse(execFileSync(process.execPath, [bridge, '--hook', sessionId, 'UserPromptSubmit'],
                    { env, encoding: 'utf8', windowsHide: true }))
                append({ event: 'hook', context: hook.hookSpecificOutput?.additionalContext })
                for (const message of cli('receive')) {
                    const ack = cli('acknowledge', { messageId: message.id, completed: true })
                    append({ event: 'ack', id: ack.id, completed: !!ack.completedAt })
                }
            }
            line = ''
            process.stdout.write('\r\n❯ ')
        } else if (c >= ' ') { line += c }
    }
})
append({ event: 'ready' })
process.stdout.write('Mailbox wake synthetic recipient ready\r\n❯ ')
