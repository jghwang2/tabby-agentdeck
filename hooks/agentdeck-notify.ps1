# Forward the event; the AgentDeck receiver owns interpretation and storage.
param(
    [string]$Agent = 'claude', [string]$Status, [string]$Label,
    [string]$Subagent, [string]$SessionId, [switch]$PromptAsLabel,
    [int]$MaxLabel = 40, [string]$HookJson
)
try {
    $env:AGENTDECK_ORIGIN_PID = [string]$PID
    $env:AGENTDECK_HOOK_OPTIONS = @{ Agent=$Agent; Status=$Status; Label=$Label; Subagent=$Subagent; SessionId=$SessionId; MaxLabel=$MaxLabel } | ConvertTo-Json -Compress
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = 'node'
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'agentdeck-relay.mjs') + '" --notify'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $child = [Diagnostics.Process]::Start($start)
    if (-not $HookJson) {
        $reader = New-Object IO.StreamReader([Console]::OpenStandardInput(), (New-Object Text.UTF8Encoding($false)))
        $HookJson = $reader.ReadToEnd()
    }
    if (-not $HookJson) { $HookJson = '{}' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($HookJson)
    $child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $child.StandardInput.Close()
    $child.StandardOutput.BaseStream.CopyTo([Console]::OpenStandardOutput())
    $child.WaitForExit()
} catch { }
