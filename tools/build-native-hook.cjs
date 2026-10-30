const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
function buildNativeHook (outDir = path.resolve(__dirname, '../hooks')) {
    if (process.platform !== 'win32') return
    const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    fs.mkdirSync(outDir, { recursive: true })
    const exe = path.join(outDir, 'agentdeck-notify.exe')
    execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/reference:System.Web.Extensions.dll', '/out:' + exe,
        path.resolve(__dirname, 'native/HookRelay.cs')], { windowsHide: true, stdio: 'pipe' })
    fs.copyFileSync(exe, path.join(outDir, 'agentdeck-codex-notify.exe'))
    fs.copyFileSync(path.resolve(__dirname, 'native/HookRelay.cs'), path.join(outDir, 'agentdeck-notify.cs'))
}
module.exports = { buildNativeHook }
if (require.main === module) buildNativeHook(process.argv[2] && path.resolve(process.argv[2]))
