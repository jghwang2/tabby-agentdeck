# Codex lifecycle -> existing AgentDeck file/TCP transport. Never emit model context.
$ErrorActionPreference = 'Stop'
try {
    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
    $raw = $reader.ReadToEnd()
    $reader.Dispose()
    $hook = $raw | ConvertFrom-Json
    if (-not $hook.session_id) { exit 0 }
    $statusByEvent = @{
        UserPromptSubmit = 'running'; PreToolUse = 'running'
        PermissionRequest = 'waiting'; PostToolUse = 'running'
        Stop = 'done'; Interrupt = 'idle'; SessionEnd = 'idle'
    }
    $status = $statusByEvent[[string]$hook.hook_event_name]
    if (-not $status) { exit 0 }
    # The shared transport's Notification filter is Claude-specific. An explicit
    # Codex PermissionRequest must be accepted even after the previous turn ended.
    if ($status -eq 'waiting') {
        $hook | Add-Member -NotePropertyName message -NotePropertyValue ('Approval: ' + [string]$hook.tool_name) -Force
    }
    # JSON is passed as -HookJson, not piped: a script that accepts pipeline input makes the host pre-read
    # stdin in the console codepage (CP949), which corrupts non-ASCII text for external callers.
    $json = $hook | ConvertTo-Json -Depth 30 -Compress
    & (Join-Path $PSScriptRoot 'agentdeck-notify.ps1') -Status $status -Agent codex -HookJson $json
} catch {
    # Status reporting must not block the agent if Tabby is unavailable.
    exit 0
}
