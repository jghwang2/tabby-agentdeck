#!/usr/bin/env node
// Inspect the staged content, not the working file. Never include rejected values in output.
const { execFileSync } = require('child_process')
function isEmptyAccountConfig (value) {
    if (value === null || value === '') return true
    if (Array.isArray(value)) return value.every(isEmptyAccountConfig)
    if (value && typeof value === 'object') return Object.values(value).every(isEmptyAccountConfig)
    return false
}
module.exports = { isEmptyAccountConfig }
if (require.main === module) {
    try {
        const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
        let rejected = false
        for (const file of files.filter(f => /(^|\/)accounts?(?:[.-](?:example|sample|template))?\.json$/i.test(f))) {
            let empty = false
            try { empty = isEmptyAccountConfig(JSON.parse(execFileSync('git', ['show', ':' + file], { encoding: 'utf8' }))) } catch {}
            if (!empty) { console.error('Commit blocked: account configuration must contain only empty fields: ' + file); rejected = true }
        }
        if (rejected) process.exitCode = 1
    } catch { console.error('Commit blocked: unable to verify staged account configuration.'); process.exitCode = 1 }
}
