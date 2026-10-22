// Transport only: send an event, or retain it until the receiver returns.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import runtime from './agentdeck-runtime.cjs'

export async function relay (kind, raw, options = {}) {
    let data
    try { data = JSON.parse(raw) } catch {
        if (!options.SessionId) return ''
        data = {}
    }
    // Never retain prompts, tool arguments/results, transcripts or credentials.
    const fields = kind === 'statusline'
        ? ['session_id', 'model', 'context_window', 'rate_limits', 'effort', 'version', 'fast_mode', 'cwd', 'workspace']
        : ['session_id', 'hook_event_name', 'agent_id', 'agent_type', 'cwd', 'tool_name', 'message', 'error', 'last_assistant_message']
    const hook = Object.fromEntries(fields.filter(k => data[k] !== undefined).map(k => [k, data[k]]))
    if (data.tool_input?.file_path) hook.tool_input = { file_path: data.tool_input.file_path }
    const env = Object.fromEntries(['AGENTDECK_TAB', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'AGENTDECK_CONTEXT']
        .map(k => [k, process.env[k] || '']))
    const event = { channel: 'agentdeck-hook', id: randomUUID(), ts: Date.now(), kind,
        pid: Number(process.env.AGENTDECK_ORIGIN_PID) || process.ppid, env, options, hook }
    const root = runtime.runtimeRoot(), line = JSON.stringify(event)
    if (Buffer.byteLength(line) > 240000) return ''
    let delivered = false
    const output = await new Promise(resolve => {
        let socket, text = '', done = false
        const finish = value => { if (done) return; done = true; clearTimeout(timer); socket?.destroy(); resolve(value) }
        const timer = setTimeout(() => finish(''), kind === 'statusline' ? 200 : 2200)
        try {
            const port = Number(fs.readFileSync(path.join(root, 'port'), 'utf8'))
            socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.write(line + '\n'))
            socket.setEncoding('utf8')
            socket.on('error', () => finish(''))
            socket.on('close', () => finish(''))
            socket.on('data', chunk => {
                text += chunk
                if (text.length > 262144) return finish('')
                if (!text.includes('\n')) return
                try {
                    const reply = JSON.parse(text.split('\n')[0])
                    if (reply.id === event.id && reply.accepted === true) {
                        delivered = true
                        finish(typeof reply.output === 'string' ? reply.output : '')
                    } else finish('')
                } catch { finish('') }
            })
        } catch { finish('') }
    })
    if (!delivered) {
        try {
            const dir = path.join(root, 'hook-inbox')
            fs.mkdirSync(dir, { recursive: true })
            const file = path.join(dir, event.id + '.json'), tmp = file + '.tmp'
            fs.writeFileSync(tmp, line, 'utf8'); fs.renameSync(tmp, file)
        } catch { /* Reporting must never block the agent. */ }
    }
    return output
}

if (process.argv[2] === '--notify') {
    try {
        const options = JSON.parse(process.env.AGENTDECK_HOOK_OPTIONS || '{}')
        process.stdout.write(await relay('notify', fs.readFileSync(0, 'utf8'), options))
    } catch { /* Invalid input is silent. */ }
}
