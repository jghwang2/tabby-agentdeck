import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import runtime from './agentdeck-runtime.cjs'
import { relay } from './agentdeck-relay.mjs'
const INNER_FILE = path.join(runtime.runtimeRoot(), 'statusline-inner.json')
// Preserve the user's statusline locally; the receiver processes metrics.
function runInner (raw) {
    let inner = null
    try {
        inner = JSON.parse(fs.readFileSync(INNER_FILE, 'utf8'))
    } catch {}
    const command = inner && inner.type === 'command' ? String(inner.command ?? '') : ''
    const depth = Number(process.env.AGENTDECK_SL_DEPTH || 0) + 1
    if (!command || command.includes('agentdeck-statusline') || depth > 2) return
    const child = spawn(command, {
        shell: true,
        stdio: ['pipe', 'inherit', 'inherit'],
        env: { ...process.env, AGENTDECK_SL_DEPTH: String(depth) },
    })
    child.on('error', () => process.exit(0))
    child.on('close', code => process.exit(code ?? 0))
    child.stdin.on('error', () => { /* 안쪽이 stdin 을 안 읽고 끝냈다 — 정상 */ })
    child.stdin.end(raw)
}

const raw = fs.readFileSync(0)
try { await relay('statusline', raw) } catch {}
runInner(raw)
