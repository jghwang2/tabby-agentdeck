const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const originalPath = process.env.PATH, originalExec = childProcess.execFileSync
if (process.platform !== 'win32') {
    console.log('SKIP: Windows stale-PATH regression')
} else {
    let queries = 0
    try {
        process.env.PATH = 'C:\\old-tabby-path'
        childProcess.execFileSync = (file, args, options) => {
            queries++
            assert.ok(file.endsWith('powershell.exe'))
            assert.ok(args.includes('-NoProfile'))
            assert.equal(options.windowsHide, true)
            assert.equal(options.timeout, 5000)
            return 'C:\\new-cli-install;C:\\old-tabby-path;C:\\registered-tools\r\n'
        }
        const { accountCliRoots } = require('../.tmp/accounts')
        assert.deepEqual(accountCliRoots(), ['C:\\old-tabby-path', 'C:\\new-cli-install', 'C:\\registered-tools'])
        accountCliRoots()
        assert.equal(queries, 1, 'Repeated quota queries must not repeatedly launch PowerShell')
        process.env.PATH = 'C:\\changed-process-path'
        assert.ok(accountCliRoots().includes('C:\\changed-process-path'))
        console.log('PASS: stale Tabby PATH includes registered CLI locations; registry lookup is cached')
    } finally {
        childProcess.execFileSync = originalExec
        if (originalPath === undefined) delete process.env.PATH
        else process.env.PATH = originalPath
    }
}
