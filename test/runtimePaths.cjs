const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const cp = require('node:child_process')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-runtime-test-'))
process.env.AGENTDECK_ACCOUNTS_FILE = path.join(root, 'accounts', 'accounts.json')
process.env.TABBY_CONFIG_DIRECTORY = path.join(root, 'profile')
delete process.env.AGENTDECK_RUNTIME_ROOT
const paths = require('../.tmp/storagePaths')
const hook = require('../hooks/agentdeck-runtime.cjs')
const migration = require('../.tmp/runtimeMigration')
assert.equal(paths.runtimeRoot(), hook.runtimeRoot())
const first = paths.runtimeRoot()
process.env.TABBY_CONFIG_DIRECTORY = path.join(root, 'profile2')
assert.notEqual(first, paths.runtimeRoot(), 'Profiles must have separate writers')
assert.equal(paths.runtimeRoot(), hook.runtimeRoot())
paths.configureStoragePaths({ accountStorageDir: path.join(root, 'chosen') })
const env = { ...process.env, ...paths.runtimeEnvironment() }
const json = { session_id: 'runtime-fixture', hook_event_name: 'UserPromptSubmit', cwd: root }
const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../hooks/agentdeck-notify.ps1'), '-HookJson', JSON.stringify(json)], { env, encoding: 'utf8', timeout: 15000, windowsHide: true })
assert.equal(result.status, 0, result.stderr)
assert.equal(JSON.parse(fs.readFileSync(path.join(paths.runtimeRoot(), 'status/runtime-fixture.json'))).sessionId, json.session_id)
// Existing shells without the new variable derive exactly the same profile root.
paths.configureStoragePaths({})
const oldEnv = { ...process.env }; delete oldEnv.AGENTDECK_RUNTIME_ROOT
const old = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../hooks/agentdeck-notify.ps1'), '-HookJson', JSON.stringify(json)], { env: oldEnv, encoding: 'utf8', timeout: 15000, windowsHide: true })
assert.equal(old.status, 0, old.stderr)
assert.ok(fs.existsSync(path.join(paths.runtimeRoot(), 'status/runtime-fixture.json')))
// Windows CI uses 8.3 aliases in TEMP. .NET GetFullPath expands those aliases,
// whereas Node path.resolve preserves them: both hook writers must use Node's key.
const short = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:AD_TEST_ROOT).ShortPath'], {
    env: { ...process.env, AD_TEST_ROOT: root }, encoding: 'utf8', timeout: 15000, windowsHide: true,
})
assert.equal(short.status, 0, short.stderr)
assert.ok(short.stdout.trim(), 'Windows fixture must have a path')
for (const profile of [path.join(short.stdout.trim(), 'short-profile'), path.join(root, 'parent', '..', 'normalized-profile') + path.sep]) {
    process.env.TABBY_CONFIG_DIRECTORY = profile
    const fallbackEnv = { ...process.env }; delete fallbackEnv.AGENTDECK_RUNTIME_ROOT
    const fallback = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../hooks/agentdeck-notify.ps1'), '-HookJson', JSON.stringify(json)], {
        env: fallbackEnv, encoding: 'utf8', timeout: 15000, windowsHide: true,
    })
    assert.equal(fallback.status, 0, fallback.stderr)
    assert.equal(paths.runtimeRoot(), hook.runtimeRoot())
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths.runtimeRoot(), 'status/runtime-fixture.json'))).sessionId, json.session_id)
    const timing = path.join(paths.runtimeRoot(), 'hook-timing')
    assert.ok(fs.readdirSync(timing).some(day => fs.readdirSync(path.join(timing, day)).some(file => file.endsWith('.jsonl'))), 'Trace writer must share the Node runtime root')
}
const source = path.join(root, 'source'), target = path.join(root, 'target')
fs.mkdirSync(source); fs.mkdirSync(target)
fs.writeFileSync(path.join(source, 'sessions.json'), 'old')
fs.writeFileSync(path.join(target, 'sessions.json'), 'new')
fs.writeFileSync(path.join(source, 'statusline-inner.json'), 'preserved')
migration.copyRuntimeData(source, target); migration.copyRuntimeData(source, target)
assert.equal(fs.readFileSync(path.join(target, 'sessions.json'), 'utf8'), 'new')
assert.equal(fs.readFileSync(path.join(target, 'statusline-inner.json'), 'utf8'), 'preserved')
assert.ok(fs.existsSync(path.join(source, 'sessions.json')))
process.env.APPDATA = path.join(root, 'roaming')
process.env.LOCALAPPDATA = path.join(root, 'local')
process.env.TABBY_CONFIG_DIRECTORY = path.join(process.env.APPDATA, 'tabby')
const legacy = path.join(process.env.LOCALAPPDATA, 'tabby-agentdeck')
const legacyMailbox = path.join(process.env.TABBY_CONFIG_DIRECTORY, 'agentdeck-mailbox')
fs.mkdirSync(legacy, {recursive:true}); fs.mkdirSync(legacyMailbox, {recursive:true})
fs.writeFileSync(path.join(legacy, 'sessions.json'), 'retained-session')
fs.writeFileSync(path.join(legacyMailbox, 'mailbox.json'), 'retained-mailbox')
migration.migrateRuntimeData()
assert.equal(fs.readFileSync(path.join(paths.runtimeRoot(), 'sessions.json'),'utf8'), 'retained-session')
assert.equal(fs.readFileSync(path.join(paths.runtimeRoot(), 'mailbox/mailbox.json'),'utf8'), 'retained-mailbox')
assert.ok(fs.existsSync(path.join(paths.runtimeRoot(), '.legacy-imported')))
fs.writeFileSync(path.join(paths.runtimeRoot(), 'sessions.json'), 'new-session')
migration.migrateRuntimeData()
assert.equal(fs.readFileSync(path.join(paths.runtimeRoot(), 'sessions.json'),'utf8'), 'new-session')
process.env.TABBY_CONFIG_DIRECTORY = path.join(root, 'other-profile')
migration.migrateRuntimeData()
assert.ok(!fs.existsSync(path.join(paths.runtimeRoot(), 'sessions.json')), 'Other profiles never import live sessions')
console.log('PASS runtime: chosen folder, profile isolation, live PowerShell hook, old-shell fallback, non-destructive idempotent migration')
