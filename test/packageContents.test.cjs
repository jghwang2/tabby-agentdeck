const assert = require('node:assert/strict'), { spawnSync } = require('node:child_process')
const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
})
assert.equal(result.status, 0, result.stderr)
const report = JSON.parse(result.stdout)
const manifest = Array.isArray(report) ? report[0] : Object.values(report)[0]
const files = new Set(manifest.files.map(file => file.path))
for (const required of ['hooks/agentdeck-agy-notify.py', 'scripts/agentdeck-agy-setup.py', 'docs/AGY.md']) {
    assert.ok(files.has(required), required + ' must be available to installed users')
}
console.log('PASS package contains AGY adapter, installer and setup documentation')
