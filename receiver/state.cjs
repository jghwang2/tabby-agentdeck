// Single-owner state reducer. The dispatcher serializes events per output file.
const fs = require('node:fs'), path = require('node:path')
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function write (file, value, id) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.' + id + '.tmp'
    try { fs.writeFileSync(tmp, JSON.stringify(value), 'utf8'); fs.renameSync(tmp, file) }
    finally { try { fs.unlinkSync(tmp) } catch {} }
}
function stateEvent (root, e) {
    const h = e.hook, o = e.options || {}, agent = o.Agent || 'claude'
    const sid = h.session_id || o.SessionId, tab = (e.env?.AGENTDECK_TAB || '').trim()
    if (!sid || !['claude', 'codex'].includes(agent)) return { handled: false }
    // Claude children have their own record; they must never rewrite a parent.
    if (agent === 'claude' && h.agent_id) {
        const action = ['SubagentStop', 'Stop', 'SessionEnd'].includes(h.hook_event_name) ? 'stop' : 'active'
        const file = path.join(root, 'agents', sid, h.agent_id + '.json'), prev = read(file)
        if (prev?.agentActivity?.ts > e.ts || (prev?.agentActivity?.ts === e.ts && prev.agentActivity.action === 'stop')) return { handled: true }
        const payload = { sessionId: sid, ts: e.ts, agentActivity: { id: h.agent_id, type: h.agent_type || '', action, ts: e.ts } }
        if (tab) payload.tabId = tab
        if (h.tool_input?.file_path) payload.file = String(h.tool_input.file_path)
        write(file, payload, e.id)
        return { handled: true, payload }
    }
    // First contact from an external CLI still needs OS ancestry discovery.
    // Existing tab-bound sessions never need an interpreter or worker process.
    if (!tab) return { handled: false }
    let status = o.Status || '', reason = '', message = h.message || ''
    if (agent === 'codex' && !o.Status && !o.Subagent) {
        status = { UserPromptSubmit: 'running', PreToolUse: 'running', PermissionRequest: 'waiting',
            PostToolUse: 'running', Stop: 'done', Interrupt: 'idle', SessionEnd: 'idle' }[h.hook_event_name]
        if (!status) return { handled: true }
        if (status === 'waiting') message = 'Approval: ' + (h.tool_name || '')
    }
    const file = path.join(root, 'status', sid + '.json'), prev = read(file)
    if (h.hook_event_name === 'StopFailure') {
        status = h.error === 'rate_limit' ? 'limited' : 'error'
        reason = status === 'limited' && h.last_assistant_message ? h.last_assistant_message : (h.error || '')
    }
    const mailContext = ['UserPromptSubmit', 'PostToolUse'].includes(h.hook_event_name)
    if (status === 'running' && prev?.status === 'running' && !o.Label
        && !h.tool_input?.file_path && !o.Subagent && !mailContext) return { handled: true }
    if (status === 'waiting' && agent === 'claude'
        && (/waiting for your input|idle/i.test(message) || ['done', 'idle', 'limited'].includes(prev?.status))) return { handled: true }
    if (status === 'waiting' && message) reason = message
    reason = String(reason).replace(/\s+/g, ' ').trim().slice(0, 120).trimEnd()
    let label = String(o.Label || '').replace(/\s+/g, ' ').trim()
    const max = Number.isFinite(Number(o.MaxLabel)) && o.MaxLabel !== '' ? Math.max(0, Number(o.MaxLabel)) : 40
    if (label.length > max) label = label.slice(0, max).trimEnd() + '...'
    if (prev?.ts >= e.ts) return { handled: true }
    const payload = { sessionId: sid, ts: e.ts, agent }
    if (h.hook_event_name) payload.identityRequired = true
    if (!o.Subagent) payload.status = status || prev?.status || 'running'
    if (label) payload.label = label
    if (reason) payload.reason = reason
    payload.tabId = tab
    if (h.cwd) payload.cwd = String(h.cwd)
    if (h.tool_input?.file_path) payload.file = String(h.tool_input.file_path)
    let agents = (Array.isArray(prev?.agents) ? prev.agents : prev?.agents ? [prev.agents] : [])
        .filter(a => a?.id).map(a => ({ id: String(a.id), type: String(a.type || ''), at: Number(a.at) || 0 }))
    if (o.Subagent && h.agent_id) {
        agents = agents.filter(a => a.id !== h.agent_id)
        if (o.Subagent === 'start') agents.push({ id: h.agent_id, type: h.agent_type || '', at: Date.now() })
    }
    if (o.Subagent || agents.length) payload.agents = agents
    write(file, payload, e.id)
    return { handled: true, payload }
}
module.exports = { stateEvent, write, read }
