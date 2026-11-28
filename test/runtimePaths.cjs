const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const cp = require('node:child_process')
const { HookDispatcher } = require('../receiver/dispatcher.cjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-runtime-test-'))
const windows = process.platform === 'win32'
const python = process.env.AGENTDECK_PYTHON || (windows ? 'python' : 'python3')
process.env.AGENTDECK_ACCOUNTS_FILE = path.join(root, 'accounts', 'accounts.json')
process.env.TABBY_CONFIG_DIRECTORY = path.join(root, 'profile')
delete process.env.AGENTDECK_RUNTIME_ROOT
const paths = require('../.tmp/storagePaths')
const hook = require('../hooks/agentdeck-runtime.cjs')
const migration = require('../.tmp/runtimeMigration')
const json = { session_id: 'runtime-fixture', hook_event_name: 'UserPromptSubmit', cwd: root }

async function runHook (env) {
    const args = windows
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../receiver/agentdeck-notify.ps1'), '-HookJson', JSON.stringify(json)]
        : [path.resolve(__dirname, '../hooks/agentdeck-notify.py'), '-Status', 'running']
    const result = cp.spawnSync(windows ? 'powershell.exe' : python, args, {
        env: windows ? env : { ...env, AGENTDECK_TAB: 'runtime-test-tab' },
        input: windows ? undefined : JSON.stringify(json), encoding: 'utf8', timeout: 15000, windowsHide: true,
    })
    assert.equal(result.status, 0, result.error?.message || result.stderr)
    if (!windows) {
        // Without a listener the real Python relay retains its event. Reuse the
        // receiver's durable dispatcher to exercise the same runtime-root handoff.
        const dispatcher = new HookDispatcher(paths.runtimeRoot(), path.resolve(__dirname, '../receiver'), {
            report: () => {}, request: async () => ({ error: 'disabled', code: 'COMMUNICATION_DISABLED' }),
        })
        dispatcher.poll()
        await dispatcher.tail
    }
}

;(async () => {
    assert.equal(paths.runtimeRoot(), hook.runtimeRoot())
    const first = paths.runtimeRoot()
    process.env.TABBY_CONFIG_DIRECTORY = path.join(root, 'profile2')
    assert.notEqual(first, paths.runtimeRoot(), 'Profiles must have separate writers')
    assert.equal(paths.runtimeRoot(), hook.runtimeRoot())
    paths.configureStoragePaths({ accountStorageDir: path.join(root, 'chosen') })
    await runHook({ ...process.env, ...paths.runtimeEnvironment() })
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths.runtimeRoot(), 'status/runtime-fixture.json'))).sessionId, json.session_id)
    // Existing shells without the new variable derive exactly the same profile root.
    paths.configureStoragePaths({})
    const oldEnv = { ...process.env }; delete oldEnv.AGENTDECK_RUNTIME_ROOT
    await runHook(oldEnv)
    assert.ok(fs.existsSync(path.join(paths.runtimeRoot(), 'status/runtime-fixture.json')))
    // Windows CI uses 8.3 aliases in TEMP. .NET GetFullPath expands those aliases,
    // whereas Node path.resolve preserves them: both hook writers must use Node's key.
    const profiles = [path.join(root, 'parent', '..', 'normalized-profile') + path.sep]
    if (windows) {
        const short = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:AD_TEST_ROOT).ShortPath'], {
            env: { ...process.env, AD_TEST_ROOT: root }, encoding: 'utf8', timeout: 15000, windowsHide: true,
        })
        assert.equal(short.status, 0, short.stderr)
        assert.ok(short.stdout.trim(), 'Windows fixture must have a path')
        profiles.unshift(path.join(short.stdout.trim(), 'short-profile'))
    } else {
        console.log('SKIP Windows 8.3 profile alias and PowerShell trace coverage')
    }
    for (const profile of profiles) {
        process.env.TABBY_CONFIG_DIRECTORY = profile
        const fallbackEnv = { ...process.env }; delete fallbackEnv.AGENTDECK_RUNTIME_ROOT
        await runHook(fallbackEnv)
        assert.equal(paths.runtimeRoot(), hook.runtimeRoot())
        assert.equal(JSON.parse(fs.readFileSync(path.join(paths.runtimeRoot(), 'status/runtime-fixture.json'))).sessionId, json.session_id)
        if (windows) {
            const timing = path.join(paths.runtimeRoot(), 'hook-timing')
            assert.ok(fs.readdirSync(timing).some(day => fs.readdirSync(path.join(timing, day)).some(file => file.endsWith('.jsonl'))), 'Trace writer must share the Node runtime root')
        }
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
    console.log(`PASS runtime: chosen folder, profile isolation, live ${windows ? 'PowerShell' : 'Python'} hook, old-shell fallback, non-destructive idempotent migration`)
})().catch(error => { console.error(error); process.exitCode = 1 })
