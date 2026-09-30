const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
if (process.platform !== 'win32') {
    console.log('SKIP Windows PowerShell updater')
    process.exit(0)
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-updater-test-'))
try {
    for (const code of [0, 42]) {
        // A native warning on stderr must not mask the native exit status.
        fs.writeFileSync(path.join(root, 'npm.cmd'), `@echo off\r\necho native warning 1>&2\r\necho fixture install result\r\nexit /b ${code}\r\n`)
        const log = path.join(root, `exit-${code}.log`)
        const env = { ...process.env }
        const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
        env[pathKey] = root + path.delimiter + (env[pathKey] || '')
        const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            path.resolve(__dirname, '../updater/agentdeck-update.ps1'), '-Version', '1.2.4',
            '-PluginsDir', path.join(root, 'plugins'), '-TabbyExe', path.join(root, 'unused.exe'),
            '-InPlace', '-Spec', 'fixture-only', '-LogFile', log], { env, windowsHide: true, encoding: 'utf8' })
        assert.ifError(result.error)
        assert.equal(result.status, code === 0 ? 0 : 1, result.stderr)
        const text = fs.readFileSync(log, 'utf8')
        assert.match(text, /native warning/)
        assert.match(text, /fixture install result/)
        assert.ok(!text.includes('npm 실행 예외'))
        if (code === 0) {
            assert.match(text, /OK 설치 완료/)
            assert.ok(!text.includes('FAIL'))
        } else { assert.match(text, /FAIL npm exit=42/) }
    }
    console.log('PASS updater: native stderr warning succeeds on exit 0; exit 42 remains a failure')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
