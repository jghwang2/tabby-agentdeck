const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path')
const { createHash } = require('crypto'), { execFileSync, spawnSync } = require('child_process')
const checker = path.resolve(__dirname, '../tools/check-account-secrets.js')
const { collectLocalAccountSecrets, containsAccountSecret } = require(checker)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-secret-scan-'))
const file = path.join(root, 'private', 'accounts.json'), repo = path.join(root, 'repo')
fs.mkdirSync(path.dirname(file), { recursive: true }); fs.mkdirSync(repo)
const fixture = { claude: [], codex: [] }
for (const [n, provider] of ['claude', 'claude', 'codex', 'codex'].entries()) {
    const id = `fixture-${n}@example.test`, password = `fixture-password-${n}-"\\!`, data = `fixture-encrypted-${n}`
    fixture[provider].push({ id, password, auth: { data } })
    const key = createHash('sha256').update(provider + ':' + id).digest('hex').slice(0, 24)
    const home = path.join(path.dirname(file), 'accounts', key)
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(path.join(home, provider === 'claude' ? '.credentials.json' : 'auth.json'), JSON.stringify({ tokens: {
        access_token: `fixture-access-${n}`, refresh_token: `fixture-refresh-${n}`, id_token: `fixture-token-${n}`,
    } }))
}
fs.writeFileSync(file, JSON.stringify(fixture))
const { secrets, accountCount } = collectLocalAccountSecrets([file, file])
assert.equal(accountCount, 4)
for (const row of [...fixture.claude, ...fixture.codex]) {
    for (const value of [row.id, row.password, row.auth.data]) {
        assert.ok(containsAccountSecret('document: ' + value, secrets))
        assert.ok(containsAccountSecret(JSON.stringify({ field: value }), secrets))
        assert.ok(containsAccountSecret(Buffer.from(value, 'utf16le'), secrets))
        assert.ok(containsAccountSecret(Buffer.from(value).toString('base64'), secrets))
        assert.ok(containsAccountSecret(encodeURIComponent(value), secrets))
    }
}
assert.ok(containsAccountSecret('fixture-access-3', secrets))
assert.ok(containsAccountSecret('fixture-refresh-2', secrets))
assert.ok(!containsAccountSecret('Only generic account UI text.', secrets))
execFileSync('git', ['init', '-q'], { cwd: repo })
const staged = path.join(repo, 'notes.md')
const scan = () => spawnSync(process.execPath, [checker], { cwd: repo, env: { ...process.env, AGENTDECK_ACCOUNTS_FILE: file }, encoding: 'utf8' })
for (const value of secrets) {
    fs.writeFileSync(staged, 'A copied credential: ' + value)
    execFileSync('git', ['add', 'notes.md'], { cwd: repo })
    fs.writeFileSync(staged, 'Working file cleaned, but staged secret remains')
    const result = scan()
    assert.equal(result.status, 1, 'staged secret must block commit even when working file was cleaned')
    assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value), 'checker never prints a matched value')
}
fs.writeFileSync(staged, 'Only generic account UI text.')
execFileSync('git', ['add', 'notes.md'], { cwd: repo })
assert.equal(scan().status, 0)
fs.writeFileSync(file, '{broken')
const unreadable = scan()
assert.equal(unreadable.status, 1, 'unreadable local account source fails closed')
assert.ok(!unreadable.stderr.includes('{broken'))
console.log('PASS: all four account fixtures, passwords, encrypted auth, native tokens, escaped/encoded values, staged-only scans and safe output')
