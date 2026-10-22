# One durable record per parent/agent. Ordinary child tool hooks also restore resumed agents.
function Write-AgentDeckAgentEvent {
    param($Hook, [string]$RuntimeRoot, [string]$ParentSession, [string]$TabId)
    $agentId = [string]$Hook.agent_id
    if ($agentId -notmatch '^[A-Za-z0-9_-]{1,200}$' -or $ParentSession -notmatch '^[A-Za-z0-9_-]{1,200}$') { return }
    $at = [DateTimeOffset]([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime())
    $event = [ordered]@{ id = $agentId; type = [string]$Hook.agent_type
        action = $(if (@('SubagentStop', 'Stop', 'SessionEnd') -contains [string]$Hook.hook_event_name) { 'stop' } else { 'active' })
        ts = $(if ($env:AGENTDECK_EVENT_TS) { [int64]$env:AGENTDECK_EVENT_TS } else { $at.ToUnixTimeMilliseconds() }) }
    $payload = [ordered]@{ sessionId = $ParentSession; ts = $event.ts; agentActivity = $event }
    if ($TabId) { $payload.tabId = $TabId }
    if ($Hook.tool_input.file_path) { $payload.file = [string]$Hook.tool_input.file_path }
    $dir = Join-Path (Join-Path $RuntimeRoot 'agents') $ParentSession
    $file = Join-Path $dir ($agentId + '.json')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $key = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($file.ToLowerInvariant())))).Replace('-', '') }
    finally { $sha.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\AgentDeckAgent-' + $key))
    $locked = $false
    $tmp = $file + '.' + $PID + '.tmp'
    try {
        try { $locked = $mutex.WaitOne(1000) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Agent record lock timeout' }
        [void][IO.Directory]::CreateDirectory($dir)
        if ([IO.File]::Exists($file)) {
            $prior = $null
            try { $prior = [IO.File]::ReadAllText($file) | ConvertFrom-Json -ErrorAction Stop } catch { }
            if ($prior.agentActivity.ts -gt $event.ts -or ($prior.agentActivity.ts -eq $event.ts -and $prior.agentActivity.action -eq 'stop')) { return }
        }
        $json = $payload | ConvertTo-Json -Compress -Depth 4
        [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
        if ([IO.File]::Exists($file)) { [IO.File]::Replace($tmp, $file, [System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($tmp, $file) }
    } finally {
        if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
    Write-AgentDeckHookTrace 'agent_event_written' @{ agent_id = $agentId; action = $event.action }
    # Disk is the recovery path; TCP gives immediate UI updates without a fast directory scan.
    $portFile = Join-Path $RuntimeRoot 'port'
    if ([IO.File]::Exists($portFile)) {
        $client = New-Object Net.Sockets.TcpClient
        try {
            $port = [int]([IO.File]::ReadAllText($portFile).Trim())
            if ($client.ConnectAsync('127.0.0.1', $port).Wait(200)) {
                $bytes = [Text.Encoding]::UTF8.GetBytes($json + "`n")
                $client.GetStream().Write($bytes, 0, $bytes.Length)
            }
        } catch { Write-AgentDeckHookTrace 'agent_tcp_error' @{} $_ }
        finally { $client.Dispose() }
    }
}
