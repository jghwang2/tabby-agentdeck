# Codex lifecycle -> existing AgentDeck file/TCP transport. Never emit model context.
$ErrorActionPreference = 'Stop'
# Step timing diagnostics. Codex kills a hook at its timeout (3s) and only prints "hook timed out",
# so every step appends a line immediately: the last line of a run shows where it was killed.
# Log: <accountRoot>\runtime\hook-diag\hook-YYYYMMDD.log  (+ms = since powershell.exe process start)
$env:AGENTDECK_HOOK_RUN = "$PID-" + [DateTime]::Now.ToString('HHmmssfff')
function Write-HookDiag ([string]$Step) {
    try {
        if (-not $script:hookDiagFile) {
            $acct = if ($env:AGENTDECK_ACCOUNTS_FILE) { Split-Path -Parent $env:AGENTDECK_ACCOUNTS_FILE } else { Join-Path $env:USERPROFILE '.agentdeck' }
            $diagDir = Join-Path $acct 'runtime\hook-diag'
            if (-not (Test-Path $diagDir)) { New-Item -ItemType Directory -Force -Path $diagDir | Out-Null }
            $script:hookDiagFile = Join-Path $diagDir ('hook-' + [DateTime]::Now.ToString('yyyyMMdd') + '.log')
            $script:hookDiagStart = [System.Diagnostics.Process]::GetCurrentProcess().StartTime
        }
        $ms = [int]([DateTime]::Now - $script:hookDiagStart).TotalMilliseconds
        $line = '{0} run={1} codex-wrap +{2}ms {3}' -f [DateTime]::Now.ToString('HH:mm:ss.fff'), $env:AGENTDECK_HOOK_RUN, $ms, $Step
        [System.IO.File]::AppendAllText($script:hookDiagFile, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}
Write-HookDiag 'start'
try { . (Join-Path $PSScriptRoot 'agentdeck-hook-trace.ps1') } catch { }
# Keep status reporting operational even if the optional diagnostic helper cannot load.
if (-not (Get-Command Write-AgentDeckHookTrace -ErrorAction SilentlyContinue)) {
    function Write-AgentDeckHookTrace { param($Stage, $Fields, $Failure) }
    function Set-AgentDeckHookTraceIdentity { param($Hook) }
}
Write-AgentDeckHookTrace 'wrapper_enter'
try {
    Write-AgentDeckHookTrace 'stdin_begin'
    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
    $raw = $reader.ReadToEnd()
    $reader.Dispose()
    Write-HookDiag "stdin-read bytes=$($raw.Length)"
    Write-AgentDeckHookTrace 'stdin_end'
    Write-AgentDeckHookTrace 'parse_begin'
    $hook = $raw | ConvertFrom-Json
    Set-AgentDeckHookTraceIdentity $hook
    Write-AgentDeckHookTrace 'parse_end'
    Write-HookDiag "json-parsed event=$($hook.hook_event_name) tool=$($hook.tool_name) session=$($hook.session_id)"
    if (-not $hook.session_id) { Write-HookDiag 'exit no-session'; Write-AgentDeckHookTrace 'skip' @{ reason = 'missing_session' }; exit 0 }
    $statusByEvent = @{
        UserPromptSubmit = 'running'; PreToolUse = 'running'
        PermissionRequest = 'waiting'; PostToolUse = 'running'
        Stop = 'done'; Interrupt = 'idle'; SessionEnd = 'idle'
    }
    $status = $statusByEvent[[string]$hook.hook_event_name]
    if (-not $status) { Write-HookDiag 'exit unknown-event'; Write-AgentDeckHookTrace 'skip' @{ reason = 'unsupported_event' }; exit 0 }
    # The shared transport's Notification filter is Claude-specific. An explicit
    # Codex PermissionRequest must be accepted even after the previous turn ended.
    if ($status -eq 'waiting') {
        $hook | Add-Member -NotePropertyName message -NotePropertyValue ('Approval: ' + [string]$hook.tool_name) -Force
    }
    # JSON is passed as -HookJson, not piped: a script that accepts pipeline input makes the host pre-read
    # stdin in the console codepage (CP949), which corrupts non-ASCII text for external callers.
    $json = $hook | ConvertTo-Json -Depth 30 -Compress
    Write-HookDiag "json-reserialized bytes=$($json.Length)"
    Write-AgentDeckHookTrace 'transport_begin'
    & (Join-Path $PSScriptRoot 'agentdeck-notify.ps1') -Status $status -Agent codex -HookJson $json
    Write-AgentDeckHookTrace 'transport_end' @{ exit_code = $LASTEXITCODE }
    Write-HookDiag 'end'
} catch {
    Write-HookDiag "exit error_type=$($_.Exception.GetType().FullName)"
    Write-AgentDeckHookTrace 'wrapper_error' @{} $_
    # Status reporting must not block the agent if Tabby is unavailable.
    exit 0
} finally {
    Write-AgentDeckHookTrace 'wrapper_end'
}
