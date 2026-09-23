import { execFile } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { StoragePaths } from './storagePaths'

const names = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'] as const
type Values = Record<string, string | null>

// JSON travels through a child-only environment variable, never through shell interpolation.
const script = `
$ErrorActionPreference = 'Stop'
$values = ConvertFrom-Json $env:AGENTDECK_STORAGE_ENV_PAYLOAD
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$old = @{}
foreach ($name in @('CLAUDE_CONFIG_DIR','CODEX_HOME')) { $old[$name] = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
try {
  foreach ($name in @('CLAUDE_CONFIG_DIR','CODEX_HOME')) {
    $value = $values.$name
    if ($null -eq $value) { $key.DeleteValue($name, $false) }
    else { $key.SetValue($name, [string]$value, [Microsoft.Win32.RegistryValueKind]::String) }
  }
} catch {
  foreach ($name in $old.Keys) {
    if ($null -eq $old[$name]) { $key.DeleteValue($name, $false) }
    else { $key.SetValue($name, [string]$old[$name]) }
  }
  throw
} finally { $key.Dispose() }
$old | ConvertTo-Json -Compress
try {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class AgentDeckEnvironmentNotify { [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result); }'
  $result = [UIntPtr]::Zero
  [void][AgentDeckEnvironmentNotify]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
} catch { }
`

export function writeUserStorageEnvironment (values: Values): Promise<Values> {
    return new Promise((resolve, reject) => {
        execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
            { windowsHide: true, timeout: 15000, env: { ...process.env, AGENTDECK_STORAGE_ENV_PAYLOAD: JSON.stringify(values) } },
            (error, stdout) => {
                if (error) { reject(new Error('storage.environment')); return }
                try { resolve(JSON.parse(stdout.trim())) } catch { reject(new Error('storage.environment')) }
            })
    })
}

/** Persist user defaults; return a compensating action if the settings file cannot be saved. */
export async function syncStorageEnvironment (paths: StoragePaths): Promise<() => Promise<void>> {
    if (process.platform !== 'win32') { return async () => {} }
    const values: Values = { CLAUDE_CONFIG_DIR: paths.claudeStorageDir || null, CODEX_HOME: paths.codexStorageDir || null }
    const previous = await writeUserStorageEnvironment(values)
    const processPrevious = Object.fromEntries(names.map(n => [n, process.env[n]]))
    for (const name of names) {
        // Give new child processes an explicit default even if their parent has stale variables.
        process.env[name] = values[name] || path.join(os.homedir(), name === 'CODEX_HOME' ? '.codex' : '.claude')
    }
    return async () => {
        await writeUserStorageEnvironment(previous)
        for (const name of names) {
            if (processPrevious[name] === undefined) { delete process.env[name] }
            else { process.env[name] = processPrevious[name] }
        }
    }
}
