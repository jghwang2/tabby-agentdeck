# Process-local diagnostics. Never serialize hook input, exception messages or credentials.
$global:AgentDeckHookTrace = $null
try {
    $traceRoot = $env:AGENTDECK_RUNTIME_ROOT
    if (-not $traceRoot) {
        $accountRoot = if ($env:AGENTDECK_ACCOUNTS_FILE) { Split-Path -Parent $env:AGENTDECK_ACCOUNTS_FILE } else { Join-Path $env:USERPROFILE '.agentdeck' }
        $traceRoot = Join-Path $accountRoot 'runtime'
        if ($env:TABBY_CONFIG_DIRECTORY) {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($env:TABBY_CONFIG_DIRECTORY).TrimEnd('\').ToLowerInvariant())) }
            finally { $sha.Dispose() }
            $traceRoot = Join-Path $traceRoot (([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant().Substring(0,16))
        }
    }
    $traceDir = Join-Path (Join-Path $traceRoot 'hook-timing') ([DateTime]::UtcNow.ToString('yyyy-MM-dd'))
    [void][IO.Directory]::CreateDirectory($traceDir)
    $global:AgentDeckHookTrace = @{
        path = Join-Path $traceDir (('{0}-{1}-{2}.jsonl' -f [DateTime]::UtcNow.ToString('HHmmssfff'), $PID, [Guid]::NewGuid().ToString('N')))
        clock = [Diagnostics.Stopwatch]::StartNew()
        event = ''; session = ''
    }
} catch { }

function global:Set-AgentDeckHookTraceIdentity($Hook) {
    if (-not $global:AgentDeckHookTrace) { return }
    $knownEvents = @('UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'Interrupt', 'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop')
    if ($Hook -and $knownEvents -contains [string]$Hook.hook_event_name) {
        $global:AgentDeckHookTrace.event = [string]$Hook.hook_event_name
    }
    if ($Hook -and [string]$Hook.session_id -match '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$') {
        $global:AgentDeckHookTrace.session = [string]$Hook.session_id
    }
}

function global:Write-AgentDeckHookTrace([string]$Stage, [hashtable]$Fields = @{}, $Failure = $null) {
    if (-not $global:AgentDeckHookTrace) { return }
    try {
        $row = [ordered]@{
            at = [DateTime]::UtcNow.ToString('o'); pid = $PID
            stage = $Stage; elapsed_ms = $global:AgentDeckHookTrace.clock.ElapsedMilliseconds
            event = $global:AgentDeckHookTrace.event; session = $global:AgentDeckHookTrace.session
        }
        # Callers pass only fixed status strings, numbers and booleans.
        foreach ($key in $Fields.Keys) { $row[$key] = $Fields[$key] }
        if ($Failure) {
            $row.error_type = $Failure.Exception.GetType().FullName
            $row.hresult = $Failure.Exception.HResult
            $row.category = [string]$Failure.CategoryInfo.Category
            $row.line = $Failure.InvocationInfo.ScriptLineNumber
        }
        $line = ($row | ConvertTo-Json -Compress -Depth 3) + "`n"
        [IO.File]::AppendAllText($global:AgentDeckHookTrace.path, $line, (New-Object Text.UTF8Encoding($false)))
    } catch {
        # A diagnostic write must never change hook output or the exit status.
    }
}
