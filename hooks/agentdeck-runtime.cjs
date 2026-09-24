const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')

function runtimeRoot () {
    if (process.env.AGENTDECK_RUNTIME_ROOT) return process.env.AGENTDECK_RUNTIME_ROOT
    const file = process.env.AGENTDECK_ACCOUNTS_FILE || path.join(os.homedir(), '.agentdeck', 'accounts.json')
    const base = path.join(path.dirname(file), 'runtime')
    const profile = process.env.TABBY_CONFIG_DIRECTORY
    return profile ? path.join(base, createHash('sha256').update(path.resolve(profile).toLowerCase()).digest('hex').slice(0, 16)) : base
}
// Old live shells retain the former C-drive mailbox variable until restarted.
function mailboxRoot () {
    const explicit = process.env.AGENTDECK_MAILBOX_ROOT
    const legacy = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'tabby-agentdeck')
    const legacyProfile = process.env.TABBY_CONFIG_DIRECTORY && path.join(process.env.TABBY_CONFIG_DIRECTORY, 'agentdeck-mailbox')
    if (explicit && ![legacy, legacyProfile].filter(Boolean).some(p => path.resolve(p).toLowerCase() === path.resolve(explicit).toLowerCase())) return explicit
    return path.join(runtimeRoot(), 'mailbox')
}
module.exports = { runtimeRoot, mailboxRoot }
