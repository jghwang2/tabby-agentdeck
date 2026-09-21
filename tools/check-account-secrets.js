#!/usr/bin/env node
// Inspect the staged content, not the working file. Never include rejected values in output.
const { execFileSync } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path'), { createHash } = require('crypto')
function isEmptyAccountConfig (value) {
    if (value === null || value === '') return true
    if (Array.isArray(value)) return value.every(isEmptyAccountConfig)
    if (value && typeof value === 'object') return Object.values(value).every(isEmptyAccountConfig)
    return false
}
function collectLocalAccountSecrets (files, nativeFiles = []) {
    const secrets = new Set(), accounts = new Set()
    const add = value => { if (typeof value === 'string' && value.length) secrets.add(value) }
    const read = file => {
        try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }
        catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Unable to read local account data safely') }
    }
    const tokens = value => {
        if (!value || typeof value !== 'object') return
        for (const [key, item] of Object.entries(value)) {
            if (/^(access_?token|refresh_?token|id_?token|api_?key|OPENAI_API_KEY|ANTHROPIC_API_KEY)$/i.test(key)) add(item)
            else if (item && typeof item === 'object') tokens(item)
        }
    }
    for (const file of new Set(files.filter(Boolean).map(f => path.resolve(f)))) {
        const data = read(file)
        if (!data) continue
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid local account data')
        for (const provider of ['claude', 'codex']) {
            if (data[provider] !== undefined && !Array.isArray(data[provider])) throw new Error('Invalid local account list')
            for (const row of data[provider] || []) {
                if (typeof row?.id !== 'string' || !row.id.trim()) continue
                const identity = provider + ':' + row.id.trim().toLowerCase()
                accounts.add(identity)
                add(row.id.trim()); add(row.id.trim().toLowerCase()); add(row.password); add(row.auth?.data)
                const key = createHash('sha256').update(identity).digest('hex').slice(0, 24)
                const home = path.join(path.dirname(file), 'accounts', key)
                tokens(read(path.join(home, provider === 'claude' ? '.credentials.json' : 'auth.json')))
            }
        }
    }
    for (const file of new Set(nativeFiles.filter(Boolean))) tokens(read(file))
    return { secrets: [...secrets], accountCount: accounts.size }
}
function containsAccountSecret (content, secrets) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
    return secrets.some(secret => {
        const variants = new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), Buffer.from(secret).toString('base64')])
        return [...variants].some(value => buffer.includes(Buffer.from(value)) || buffer.includes(Buffer.from(value, 'utf16le')))
    })
}
module.exports = { isEmptyAccountConfig, collectLocalAccountSecrets, containsAccountSecret }
if (require.main === module) {
    try {
        const args = process.argv.includes('--all') ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
        const files = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean)
        const { secrets, accountCount } = collectLocalAccountSecrets([
            path.join(os.homedir(), '.agentdeck', 'accounts.json'), process.env.AGENTDECK_ACCOUNTS_FILE,
        ], [
            path.join(os.homedir(), '.claude', '.credentials.json'), path.join(os.homedir(), '.codex', 'auth.json'),
            process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
            process.env.CODEX_HOME && path.join(process.env.CODEX_HOME, 'auth.json'),
        ])
        let rejected = false
        for (const file of files) {
            const content = execFileSync('git', ['show', ':' + file], { maxBuffer: 64 * 1024 * 1024 })
            // Inspect every staged blob and filename, including documents, logs and generated output.
            if (containsAccountSecret(content, secrets) || containsAccountSecret(file, secrets)) {
                console.error('Commit blocked: registered account data found in file #' + (files.indexOf(file) + 1) + ' (values hidden).')
                rejected = true
            }
            if (/(^|\/)accounts?(?:[.-](?:example|sample|template))?\.json$/i.test(file)) {
                let empty = false
                try { empty = isEmptyAccountConfig(JSON.parse(content.toString('utf8'))) } catch {}
                if (!empty) { console.error('Commit blocked: account configuration must contain only empty fields.'); rejected = true }
            }
        }
        if (rejected) process.exitCode = 1
        else console.log(`PASS: ${files.length} indexed files checked against all ${accountCount} locally registered accounts; no account values printed.`)
    } catch { console.error('Commit blocked: unable to verify staged account configuration.'); process.exitCode = 1 }
}
