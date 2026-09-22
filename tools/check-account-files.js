#!/usr/bin/env node
// Check index blobs, even when git add -f overrides .gitignore. Print no values.
const { execFileSync } = require('node:child_process')
const { isEmptyAccountConfig } = require('./check-account-secrets')
function check () {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    for (const file of files) {
        if (/(^|\/)(?:accounts?|auth|\.credentials)\.json(?:\..*)?$/i.test(file) ||
            /(^|\/)(?:\.agentdeck|accounts)\//i.test(file)) {
            throw new Error('Private account files cannot be committed; use the empty example.')
        }
        if (/(^|\/)accounts?\.(?:example|sample|template)\.json$/i.test(file)) {
            const value = JSON.parse(execFileSync('git', ['show', ':' + file], { encoding: 'utf8' }))
            if (!isEmptyAccountConfig(value)) throw new Error('Account examples must contain only empty fields.')
        }
    }
    console.log('PASS: private account files excluded and account examples empty.')
}
try { check() } catch { console.error('Commit blocked: private account file or non-empty account example in the index.'); process.exitCode = 1 }
