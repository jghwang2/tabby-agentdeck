<#
.SYNOPSIS
  Claude Code 훅 -> AgentDeck 사이드바 상태/작업이름 통보.

.DESCRIPTION
  `%LOCALAPPDATA%\tabby-agentdeck\status\<session_id>.json` 에 상태를 쓴다.
  Tabby 쪽 WorkNotifyService 가 이 폴더를 400ms 마다 읽어 사이드바에 반영한다.

  왜 파일인가 — 콘솔 제목 방식(agentdeck-status.ps1)은 훅에서는 통하지 않는다.
  Claude Code 가 훅을 파이프 stdio 로 띄우므로 그 프로세스는 터미널 콘솔에 붙어
  있지 않고, 제목을 바꿔도 pty 까지 전달되지 않는다 (2026-08-28 실측).

  이 훅이 보내는 것은 **상태뿐이다.** 작업 이름(라벨)은 플러그인이 Enter 시점에
  입력창을 직접 읽어 무조건 갱신하므로(enterAsLabel) 여기서 건드리면 되돌리기만 한다.
  예외는 사람이 셸에서 `-Label` 로 직접 지정할 때뿐.

  UserPromptSubmit에서는 현재 탭 목록을 구조화된 additionalContext로 반환한다.
  PostToolUse에서는 대기 메시지가 있을 때만 같은 방식으로 알린다.

.PARAMETER Status
  running(진행중) / waiting(승인대기) / limited(한도 도달) / done(완료) / error(오류) / idle(대기)

  StopFailure 훅에서는 -Status 를 그대로 쓰지 않는다 — 훅 JSON 의 `error` 가 rate_limit(사용량 한도)이면
  limited 로, 그 밖이면 error 로 보낸다. 이벤트 하나에 matcher 두 개를 거는 대신 여기서 가른다.

.EXAMPLE
  # settings.json (src/claudeHooks.ts PLAN 이 원본)
  # "UserPromptSubmit":    -Status running   지시를 받았다
  # "Notification":        -Status waiting   승인을 기다린다 (유휴 알림은 걸러낸다)
  # "PostToolUse":         -Status running   승인 뒤 도구가 돌았다
  # "PostToolUseFailure":  -Status running   도구가 실패했다 — 에이전트는 계속 일한다
  # "PermissionDenied":    -Status running   사람이 거부했다 — 에이전트는 계속 일한다
  # "Stop":                -Status done      답이 끝났다
  # "StopFailure":         -Status error     턴이 실패로 끝났다 (rate_limit 이면 limited)
#>
param(
    # 어느 CLI 가 보냈나. **이 값이 에이전트 판정의 1순위 근거다** — 플러그인이 프로세스 이름·
    # 명령줄·탭 제목·화면 문구로 추측하던 것(deck.service `detectAgentApp`)을 이 한 줄이 대신한다.
    # 자기가 누구인지는 훅을 부르는 쪽이 아는 사실이지 추측할 일이 아니다 (cwd·tabId 와 같은 이치).
    [ValidateSet('claude', 'codex', 'gemini')]
    [string]$Agent = 'claude',

    [ValidateSet('running', 'waiting', 'limited', 'done', 'error', 'idle')]
    [string]$Status,

    # 사람이 셸에서 직접 붙이는 작업 이름. 이때만 라벨을 보낸다
    [string]$Label,

    # 서브에이전트 생명주기. SubagentStart -> start / SubagentStop -> stop.
    # `-Agent` 는 이미 어느 CLI 가 보냈나(claude/codex)에 쓰이므로 이름을 따로 둔다.
    # **상태(-Status)와 섞지 않는다** — 이 이벤트는 세션 상태를 바꾸지 않고 개수만 움직인다.
    # 훅 JSON 의 `agent_id` 가 함께 오므로 플러그인이 id 로 정확히 켜고 끈다(실측 payload:
    # SubagentStart = agent_id·agent_type·session_id, SubagentStop = 같은 agent_id).
    [ValidateSet('start', 'stop')]
    [string]$Subagent,

    # stdin 훅 JSON 없이 부를 때 대상 세션 (없으면 가장 최근에 갱신된 세션)
    [string]$SessionId,

    # [폐기] 프롬프트를 라벨로 쓰던 스위치. 지금은 무시한다 — 라벨은 플러그인 전담.
    # 파라미터 자체는 남겨 둔다: 이미 설치된 settings.json 이 이 인자를 들고 있으면
    # 없앤 순간 "알 수 없는 인자" 로 훅이 통째로 실패한다
    [switch]$PromptAsLabel,

    [int]$MaxLabel = 40,

    # 같은 PowerShell 안에서 부르는 래퍼(agentdeck-codex-notify.ps1)가 훅 JSON 을 넘기는 자리.
    # 파이프(`$json | & notify.ps1`)로 넘기지 않는 이유는 아래 stdin 주석 — 스크립트가 파이프 입력을
    # 받는 순간 외부 호출(Claude Code)의 stdin 이 CP949 로 깨진다
    [string]$HookJson
)

$ErrorActionPreference = 'SilentlyContinue'

# Step timing diagnostics — see agentdeck-codex-notify.ps1. When called from that wrapper the same
# process/run id is reused; when called directly (Claude hooks) this starts a new run.
if (-not $env:AGENTDECK_HOOK_RUN) { $env:AGENTDECK_HOOK_RUN = "$PID-" + [DateTime]::Now.ToString('HHmmssfff') }
function Write-HookDiag ([string]$Step) {
    try {
        if (-not $script:hookDiagFile) {
            $acct = if ($env:AGENTDECK_ACCOUNTS_FILE) { Split-Path -Parent $env:AGENTDECK_ACCOUNTS_FILE } else { Join-Path $env:USERPROFILE '.agentdeck' }
            $diagDir = Join-Path $acct 'runtime\hook-diag'
            if (-not (Test-Path $diagDir)) { New-Item -ItemType Directory -Force -Path $diagDir | Out-Null }
            $script:hookDiagFile = Join-Path $diagDir ('hook-' + [DateTime]::Now.ToString('yyyyMMdd') + '.log')
            $script:hookDiagStart = [System.Diagnostics.Process]::GetCurrentProcess().StartTime
            if (-not (Test-Path $script:hookDiagFile)) {
                Get-ChildItem $diagDir -Filter 'hook-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
            }
        }
        $ms = [int]([DateTime]::Now - $script:hookDiagStart).TotalMilliseconds
        $line = '{0} run={1} notify-{2} +{3}ms {4}' -f [DateTime]::Now.ToString('HH:mm:ss.fff'), $env:AGENTDECK_HOOK_RUN, $Agent, $ms, $Step
        [System.IO.File]::AppendAllText($script:hookDiagFile, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}
Write-HookDiag "start status=$Status subagent=$Subagent"

if (-not (Get-Command Write-AgentDeckHookTrace -ErrorAction SilentlyContinue)) {
    try { . (Join-Path $PSScriptRoot 'agentdeck-hook-trace.ps1') } catch { }
}
if (-not (Get-Command Write-AgentDeckHookTrace -ErrorAction SilentlyContinue)) {
    function Write-AgentDeckHookTrace { param($Stage, $Fields, $Failure) }
    function Set-AgentDeckHookTraceIdentity { param($Hook) }
}
Write-AgentDeckHookTrace 'notify_enter'
try {

try {
    Write-AgentDeckHookTrace 'notify_input_begin'
    # PS 5.1 은 stdin 을 시스템 ANSI(CP949) 로 읽어 UTF-8 JSON 의 한글을 깨뜨린다.
    # 표준입력 스트림을 UTF-8 로 직접 열어서 읽는다.
    #
    # **이 파일 어디에도 파이프 입력 자동변수를 쓰지 말 것.** 스크립트가 그걸 참조하기만 해도
    # PowerShell 호스트가 실행 전에 stdin 을 콘솔 인코딩(CP949)으로 먼저 다 읽어 가서, 아래 원본 스트림은
    # 비고 파이프 입력 쪽은 이미 깨져 있다. 실측(2026-09-14): 참조하는 스크립트는 15/15 원본 스트림 0자,
    # 참조하지 않는 스크립트는 15/15 2606자 온전 — 한도 문구의 `·` 가 `쨌` 로 깨지던 HK2·HK6 의 원인이었다
    $raw = $HookJson
    if (-not $raw) {
        $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
        $raw = $reader.ReadToEnd()
        $reader.Close()
    }
    $hook = if ($raw) { $raw | ConvertFrom-Json } else { $null }
    Set-AgentDeckHookTraceIdentity $hook
    Write-AgentDeckHookTrace 'notify_input_end'
} catch {
    Write-AgentDeckHookTrace 'notify_input_error' @{} $_
    $hook = $null
}
Write-HookDiag "hook-parsed bytes=$($raw.Length) event=$(if ($hook) { $hook.hook_event_name })"

$runtimeRoot = $env:AGENTDECK_RUNTIME_ROOT
if (-not $runtimeRoot) {
    $accountRoot = if ($env:AGENTDECK_ACCOUNTS_FILE) { Split-Path -Parent $env:AGENTDECK_ACCOUNTS_FILE } else { Join-Path $env:USERPROFILE '.agentdeck' }
    $runtimeRoot = Join-Path $accountRoot 'runtime'
    if ($env:TABBY_CONFIG_DIRECTORY) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($env:TABBY_CONFIG_DIRECTORY).TrimEnd('\').ToLowerInvariant())) }
        finally { $sha.Dispose() }
        $profileKey = ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant().Substring(0,16)
        $runtimeRoot = Join-Path $runtimeRoot $profileKey
    }
}
$dir = Join-Path $runtimeRoot 'status'
Write-AgentDeckHookTrace 'status_dir_begin'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
Write-AgentDeckHookTrace 'status_dir_end' @{ exists = [IO.Directory]::Exists($dir) }

# 세션 결정 — 훅 JSON > -SessionId > 가장 최근에 갱신된 파일
$targetId = ''
if ($hook -and $hook.session_id) {
    $targetId = [string]$hook.session_id
} elseif ($SessionId) {
    $targetId = $SessionId
} else {
    $recent = Get-ChildItem -Path $dir -Filter '*.json' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($recent) { $targetId = [System.IO.Path]::GetFileNameWithoutExtension($recent.Name) }
}
if (-not $targetId) { $targetId = 'default' }
# Register this prompt/tool boundary before asking for its live navigation context.
$mailContext = $hook -and $env:AGENTDECK_TAB -and @('UserPromptSubmit', 'PostToolUse') -contains [string]$hook.hook_event_name
# 파일명에 못 쓰는 문자 제거
$safeId = ($targetId -replace '[^A-Za-z0-9._-]', '_')
$file = Join-Path $dir "$safeId.json"

# 직전 상태를 읽어 둔다 — 승인대기 오탐 방지에 쓴다
$prev = $null
$prevStatus = ''
if (Test-Path $file) {
    try {
        $prev = Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json
        $prevStatus = [string]$prev.status
    } catch { }
}
Write-HookDiag "prev-read prev=$prevStatus tab=$($env:AGENTDECK_TAB) mail=$mailContext"

# --- StopFailure: 한도 도달인가 그냥 오류인가 ---
# 턴이 실패로 끝나면 Claude Code 는 Stop 대신 StopFailure 를 쏘고 `error` 에 원인 코드를 싣는다
# (rate_limit / overloaded / server_error / authentication_failed / max_output_tokens …, 2.1.263 실측).
# 사용량 한도(429 "You've hit your session limit · resets 12pm")는 error=rate_limit 이다 — 사람이 승인할 것이
# 없고 리셋까지 기다려야 하는 상태라 승인대기·오류와 구분해 limited 로 보낸다. 나머지는 error.
# 부연(reason)에는 limited 면 화면에 찍힌 마지막 문장(last_assistant_message: 리셋 시각이 들어 있다)을,
# 그 밖의 오류면 error 코드를 싣는다. 줄이는 일은 플러그인(src/reason.ts)이 한다.
$failReason = ''
if ($hook -and [string]$hook.hook_event_name -eq 'StopFailure') {
    $code = [string]$hook.error
    $Status = if ($code -eq 'rate_limit') { 'limited' } else { 'error' }
    # limited 는 화면 문구(리셋 시각이 들어 있다), 그 밖은 error 코드만 — 상세(error_details)는 배지 한 줄에 안 들어간다
    $failReason = if ($Status -eq 'limited' -and $hook.last_assistant_message) { [string]$hook.last_assistant_message } else { $code }
}

# --- 이번 도구가 고친 파일 ---
# `변경` 탭이 "이 세션이 만진 것만" 을 그리는 근거다. 저장소 전체 diff 는 P4 워크스페이스 위에
# git 을 얹은 곳에서 수백 개씩 나와 쓸모가 없다.
# Edit/Write/NotebookEdit 은 전부 `tool_input.file_path` 를 쓴다. 다른 도구에는 없으므로 그냥 비고,
# 훅이 아예 없는 에이전트는 이 키가 영영 안 와서 플러그인이 전체 목록으로 떨어진다(그게 폴백이다).
$touchedFile = ''
if ($hook -and $hook.tool_input -and $hook.tool_input.file_path) {
    $touchedFile = [string]$hook.tool_input.file_path
}

# --- 진행중 중복 보고 생략 ---
# PostToolUse 는 도구가 돌 때마다 발화한다. 이미 running 인데 running 을 또 쓰면 파일·TCP 만 흔들고
# 사이드바는 변하지 않는다(경과시간이 매 도구마다 0 으로 되돌아가기까지 한다). 라벨 지정도 없으면 여기서 끝낸다 —
# 아래 계보 조회(~450ms)까지 건너뛰므로 도구마다 붙는 비용이 사실상 없다.
# **고친 파일이 있으면 건너뛰지 않는다** — 그 보고가 곧 `변경` 탭의 목록이라 하나라도 빠지면
# 그 파일이 화면에서 사라진다. 대신 그 경우에도 계보 조회는 하지 않는다(아래 tabId 분기):
# 세션은 이미 탭에 묶여 있어 sessionId 만으로 찾아간다(notify.service `resolveTab` 의 `alive`).
# **서브에이전트 이벤트도 건너뛰지 않는다** — 하나 빠지면 개수가 영구히 어긋난다(start 를 놓치면
# 적게, stop 을 놓치면 많게 굳는다). 이쪽도 계보 조회는 하지 않는다(아래 tabId 분기).
if ($Status -eq 'running' -and $prevStatus -eq 'running' -and -not $Label -and -not $touchedFile -and -not $Subagent -and -not $mailContext) { Write-HookDiag 'exit running-dup'; Write-AgentDeckHookTrace 'skip' @{ reason = 'already_running' }; exit 0 }

# --- 어느 탭인가: tabId (1순위) / 프로세스 계보 pids (폴백) ---
# 사이드바가 이 보고를 어느 탭에 붙일지 정하는 근거. 예전 규칙 "처음 보고할 때의 활성 탭" 은
# 끝난 세션의 done 이 새 탭에 박히는 사고를 냈다 (2026-09-02 실측). 지금은 두 단계다.
#
# 1) tabId — 플러그인이 탭을 열 때 그 셸의 환경에 AGENTDECK_TAB=<id> 를 심는다 (src/tabenv.ts,
#    notify.service.ts stampRoot). 그 셸에서 뜬 claude 와 이 훅은 환경을 그대로 물려받으므로
#    $env:AGENTDECK_TAB 을 읽어 보내면 플러그인이 표에서 바로 찾는다. 이게 있으면 아래 계보 조회를
#    통째로 건너뛴다 — Win32_Process 전체 조회(~450ms)가 빠져 훅이 수십 ms 안에 끝난다.
#    $prev 에 남은 pids 캐시는 읽지도 않는다 — payload 에 pids 를 넣지 않으니 무해하다.
#
# 2) pids — 환경변수가 없는 셸: 이 버전 이전에 열린 탭, 재시작으로 복원된 탭(셸이 이미 떠 있어 새 값을
#    못 심는다), Tabby 밖에서 뜬 claude. 훅 프로세스의 조상을 위로 따라가면
#    (훅 pwsh) <- bash <- claude.exe <- 탭 셸(powershell/pwsh) <- Tabby.exe 가 나오고,
#    플러그인은 탭별 셸 PID 와 맞춰 어느 탭인지 확정한다 (src/bind.ts).
#
#    훅 JSON 이 있을 때만 계산한다 — 셸에서 사람이 -SessionId 로 직접 부르면 조상이 탭 셸 자체라
#    걸러지고 Tabby.exe 만 남아 어느 탭에도 안 맞는다. 그 경로는 예전 활성 탭 규칙에 맡긴다.
#
#    비용 — Win32_Process 전체 조회가 ~450ms 라 세션당 한 번만 하고 status 파일에 캐시한다
#    (홉마다 필터 조회하면 ~2초로 더 느리다). 캐시는 claude 프로세스(claudePid)가 살아 있고
#    이름이 같을 때만 재사용한다 — `claude --resume` 을 다른 탭에서 띄우면 PID 가 바뀌어 다시 계산된다.
$tabId = ([string]$env:AGENTDECK_TAB).Trim()
$pids = @()
$claudePid = 0
$claudeName = ''
Write-AgentDeckHookTrace 'ancestry_begin' @{ has_tab = [bool]$tabId }
# 이미 running 인 세션의 "파일만 알리는" 보고와 서브에이전트 이벤트에서는 계보를 재지 않는다 —
# 450ms 짜리 Win32_Process 전체 조회를 Edit·에이전트마다 낼 수는 없다. 그 세션은 앞선 보고로
# 이미 탭에 묶여 있어 sessionId 만으로 찾아간다 (notify.service `resolveTab` 의 `alive` 경로).
if ($tabId) {
    # 탭이 확정됐다 — 계보는 계산하지 않는다
} elseif ($hook -and -not $Subagent -and -not ($Status -eq 'running' -and $prevStatus -eq 'running')) {
    $reuse = $false
    if ($prev -and $prev.pids -and $prev.claudePid) {
        $aliveProc = Get-Process -Id ([int]$prev.claudePid) -ErrorAction SilentlyContinue
        if ($aliveProc -and (("$($aliveProc.ProcessName).exe") -ieq [string]$prev.claudeName)) {
            $pids = @($prev.pids | ForEach-Object { [int]$_ })
            $claudePid = [int]$prev.claudePid
            $claudeName = [string]$prev.claudeName
            $reuse = $true
        }
    }
    if (-not $reuse) {
        # 훅 자신과 그것을 띄운 셸 껍데기 — 매번 바뀌는 일회성 프로세스라 맞춰 볼 대상이 아니다.
        # 앞에서부터 이 이름들을 건너뛰고 처음 만나는 것이 에이전트 프로세스(claude.exe / node.exe)다.
        # 그 뒤의 탭 셸(powershell.exe)은 접두만 건너뛰므로 남는다
        $transient = @('powershell.exe', 'pwsh.exe', 'bash.exe', 'sh.exe', 'cmd.exe', 'conhost.exe')
        try {
            $all = @{}
            Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name -ErrorAction Stop |
                ForEach-Object { $all[[int]$_.ProcessId] = $_ }
            $chain = @()
            $cur = [int]$PID
            for ($i = 0; $i -lt 16 -and $cur -gt 0 -and $all.ContainsKey($cur); $i++) {
                $row = $all[$cur]
                $chain += $row
                $next = [int]$row.ParentProcessId
                if ($next -eq $cur) { break }
                $cur = $next
            }
            $start = 0
            while ($start -lt $chain.Count -and ($transient -contains ([string]$chain[$start].Name).ToLower())) { $start++ }
            if ($start -lt $chain.Count) {
                $claudePid = [int]$chain[$start].ProcessId
                $claudeName = [string]$chain[$start].Name
                $pids = @($chain[$start..($chain.Count - 1)] | ForEach-Object { [int]$_.ProcessId })
            }
        } catch { Write-AgentDeckHookTrace 'ancestry_error' @{} $_ }
    }
    Write-HookDiag "lineage reuse=$reuse pids=$($pids.Count)"
}
Write-AgentDeckHookTrace 'ancestry_end' @{ pid_count = $pids.Count }

# --- 승인대기 오탐 차단 ---
# Notification 훅은 "도구 승인 요청" 말고 "입력이 없다"는 유휴 알림에도 발화한다.
# 그래서 Stop(done) 뒤에 유휴 알림이 오면 완료된 탭이 '승인대기' 로 뒤집힌다 (2026-08-28 실측:
# status 폴더의 두 세션이 작업을 끝냈는데도 waiting 으로 박혀 있었다).
# 승인 요청이 아닌 알림이면 상태를 건드리지 않는다.
if ($Status -eq 'waiting' -and $Agent -eq 'claude') {
    $msg = if ($hook -and $hook.message) { [string]$hook.message } else { '' }
    $idleNotice = $msg -match '(?i)waiting for your input|idle'
    $alreadyFinished = $prevStatus -eq 'done' -or $prevStatus -eq 'idle' -or $prevStatus -eq 'limited'
    if ($idleNotice -or $alreadyFinished) { Write-HookDiag 'exit waiting-filtered'; Write-AgentDeckHookTrace 'skip' @{ reason = 'idle_notification' }; exit 0 }
}

# --- 부연(reason) ---
# waiting: Notification 의 message 원문("Claude needs your permission to use Bash" 등).
# limited/error: 위 StopFailure 블록이 고른 문장.
# 짧게 줄이는 일(-> "Bash 권한", "12pm 리셋")은 플러그인(src/reason.ts)이 한다 — 문구 규칙이 바뀌면 한 곳만 고치면 된다.
# 해당 상태일 때만 넣고 다른 상태에서는 키 자체를 빼서, 플러그인이 상태가 바뀌면 이유를 비우게 한다.
$reason = ''
if ($Status -eq 'waiting' -and $hook -and $hook.message) {
    $reason = [string]$hook.message
} elseif ($failReason) {
    $reason = $failReason
}
if ($reason) {
    $reason = ($reason -replace '\s+', ' ').Trim()
    if ($reason.Length -gt 120) { $reason = $reason.Substring(0, 120).TrimEnd() }
}

# --- 라벨 결정 ---
# **이 훅은 라벨을 만들지 않는다.** 작업 이름은 플러그인이 Enter 시점에 입력창을 읽어
# 무조건 갱신하는 경로(claimEnterLabel / enterAsLabel)가 전담한다. 훅이 낼 수 있는 건
# 어차피 프롬프트 원문뿐인데, 그건 플러그인이 화면에서 더 정확하게 이미 읽고 있다.
#
# 훅이 라벨에 손대면 오히려 되돌린다 — 훅은 자기 상태 파일에서 직전 라벨을 읽어 다시 쓰므로,
# 플러그인이 방금 넣은 최신 프롬프트가 옛 값으로 덮인다
# (2026-09-01 실측: diag 에 07:42 프롬프트가 찍혔는데 status\c73e151f….json 은 16:44 에
#  07:11 의 첫 프롬프트로 재기록돼 사이드바가 세션 첫 문장에 박혀 있었다).
#
# 그래서 payload 에 label 을 넣는 경우는 하나뿐이다 — 셸에서 사람이 `-Label` 로 직접 지정할 때.
# 그 외에는 키 자체를 빼서 플러그인이 "라벨은 건드리지 말라" 로 읽게 한다
# (notify.service 는 label 이 없거나 비면 지금 값을 유지한다).
$newLabel = ($Label -replace '\s+', ' ').Trim()
if ($newLabel.Length -gt $MaxLabel) { $newLabel = $newLabel.Substring(0, $MaxLabel).TrimEnd() + '...' }

# -Status 없이 -Label 만 주면 상태는 그대로 두고 이름만 바꾼다
$effectiveStatus = if ($Status) { $Status } elseif ($prevStatus) { $prevStatus } else { 'running' }

$payload = [ordered]@{
    sessionId = $targetId
    ts        = [int64](([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds)
    # 누가 보냈나. 상태·서브에이전트와 달리 **매번 같은 값**이지만 그래도 매번 싣는다 —
    # 빼먹은 보고가 하나라도 있으면 플러그인이 그 탭을 다시 추측 경로로 떨어뜨린다.
    # (서브에이전트 이벤트처럼 status 를 안 싣는 보고에도 들어가야 하므로 아래 분기 밖에 둔다)
    agent     = $Agent
}
# **서브에이전트 이벤트는 상태를 싣지 않는다.** 이 훅에는 `-Status` 가 없어서 직전 상태를
# 되쓰게 되는데, 그러면 이미 `done` 인 세션에 백그라운드 에이전트의 stop 이 도착할 때
# 세션이 `running` 으로 되살아난다 (백그라운드 에이전트는 턴이 끝난 뒤에도 돈다).
if (-not $Subagent) { $payload['status'] = $effectiveStatus }
if ($newLabel) { $payload['label'] = $newLabel }
if ($reason) { $payload['reason'] = $reason }
if ($tabId) { $payload['tabId'] = $tabId }
# --- 작업 폴더 ---
# 훅 JSON 의 `cwd` 는 에이전트가 실제로 돌고 있는 폴더다. 이걸 보내는 이유는 Tabby 순정의 cwd 추정이
# 윈도우에서 못 믿을 값을 내기 때문이다 — `guessWindowsCWD` 가 PTY 출력에서 `X:\...` 처럼 보이는
# 첫 토큰을 그대로 cwd 로 삼는다(tabby-local/dist/index.js:1316, 정규식 /([a-zA-Z]:[^\:\[\]\?\"\<\>\|]+)/mi).
# 에이전트가 화면에 찍은 **파일 경로**도 걸려서, 미리보기 `변경` 탭이 `git -C <파일.py>` 를 돌리고
# `fatal: cannot change to ...: Invalid argument` 로 끝났다 (2026-09-11 실측).
if ($hook -and $hook.cwd) { $payload['cwd'] = [string]$hook.cwd }
# 이번 도구가 고친 파일 — 플러그인이 탭별로 모아 `변경` 탭의 '세션' 목록을 만든다
if ($touchedFile) { $payload['file'] = $touchedFile }

# --- 지금 도는 서브에이전트 (스냅샷) ---
# **증분(이번에 하나 떴다/졌다)이 아니라 목록 전체를 보낸다.** 이유는 상태 파일이 "마지막 보고
# 한 건" 만 담기 때문이다 — TCP 가 막혀 폴링(400ms)으로만 전달되는 환경에서 start 와 stop 이
# 한 주기 안에 겹치면 앞의 것이 덮여 **영영 유실**되고, 누적으로 세는 개수는 그대로 어긋난다
# (상태값은 최신 하나만 의미가 있어서 이 구조로 충분했지만, 개수는 아니다).
# 목록을 통째로 실으면 덮여도 마지막 파일이 곧 정답이라 유실이 개수를 틀리게 만들지 못한다.
#
# 직전 목록은 이 파일에서 읽는다(= 훅 호출 사이의 저장소). 그래서 상태 보고(running/done)에서도
# 그대로 다시 실어 줘야 한다 — 안 실으면 다음 에이전트 이벤트가 빈 목록에서 시작한다.
$agents = @()
if ($prev -and $prev.agents) {
    foreach ($a in @($prev.agents)) {
        if ($a -and $a.id) {
            $agents += , ([ordered]@{ id = [string]$a.id; type = [string]$a.type; at = [int64]$a.at })
        }
    }
}
if ($Subagent -and $hook -and $hook.agent_id) {
    $aid = [string]$hook.agent_id
    # 같은 id 는 먼저 빼고 — start 가 두 번 와도 하나, stop 은 빼기만 하면 된다
    $agents = @($agents | Where-Object { $_.id -ne $aid })
    if ($Subagent -eq 'start') {
        $agents += , ([ordered]@{
            id = $aid
            type = [string]$hook.agent_type
            at = [int64](([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds)
        })
    }
}
# 빈 목록도 보낸다 — "마지막 하나가 끝났다" 를 말할 방법이 이것뿐이다.
# 단 에이전트를 한 번도 본 적 없는 세션에서는 키 자체를 빼서, 훅이 개수를 안다고 주장하지 않는다
# (플러그인은 이 키를 본 탭에서만 대화기록 폴백을 끈다)
if ($Subagent -or $agents.Count -gt 0) {
    $payload['agents'] = @($agents)
}
if ($pids.Count -gt 0) {
    $payload['pids'] = [int[]]$pids
    $payload['claudePid'] = $claudePid
    $payload['claudeName'] = $claudeName
}

# BOM 없는 UTF-8 로 원자적 쓰기 — Node 의 JSON.parse 는 BOM 을 못 먹는다
#
# TCP 로 밀어 넣더라도 이 파일 쓰기는 건너뛰지 않는다 — 파일이 곧 상태 저장소라서
# 다음 훅 호출이 여기서 직전 상태를 읽는다(위 $prevStatus). 그게 '승인대기 오탐 차단' 의 근거다.
# `-Depth` 를 명시한다 — 기본 2 는 `agents` 안의 객체를 `System.Collections.Specialized...` 문자열로
# 뭉개 버린다(중첩 한 겹이 더 생겼다). 원소가 하나일 때 배열이 스칼라로 접히는 문제는 받는 쪽에서
# 배열/단일을 모두 받아 푼다 — PowerShell 의 JSON 변환은 그 접힘을 끌 수 없다
$json = $payload | ConvertTo-Json -Compress -Depth 5
$tmp = "$file.$PID.tmp"
$enc = New-Object System.Text.UTF8Encoding($false)
Write-AgentDeckHookTrace 'state_write_begin'
try {
[System.IO.File]::WriteAllText($tmp, $json, $enc)
[System.IO.File]::Copy($tmp, $file, $true)
Remove-Item $tmp -Force
Write-HookDiag 'status-file-written'
Write-AgentDeckHookTrace 'state_write_end'
} catch { Write-AgentDeckHookTrace 'state_write_error' @{} $_ }

# --- TCP 즉시 통보 ---
# Tabby 의 WorkNotifyService 가 127.0.0.1 임의 포트로 듣고 그 번호를 port 파일에 적어 둔다.
# 여기로 JSON 한 줄을 보내면 폴링을 기다리지 않고 사이드바가 바로 바뀐다.
# 실패는 전부 무시한다 — Tabby 가 안 떠 있거나 포트가 바뀐 것뿐이고, 위에 쓴 파일을 폴링이 주워 간다.
$portFile = Join-Path $runtimeRoot 'port'
Write-AgentDeckHookTrace 'tcp_begin' @{ port_file = [IO.File]::Exists($portFile) }
if (Test-Path $portFile) {
    try {
        $port = [int]((Get-Content -Raw $portFile).Trim())
        if ($port -gt 0) {
            $client = New-Object System.Net.Sockets.TcpClient
            # 훅은 매 이벤트마다 도는 경로다 — Tabby 가 없을 때 여기서 붙잡히면 안 된다
            if ($client.ConnectAsync('127.0.0.1', $port).Wait(200)) {
                $bytes = $enc.GetBytes($json + "`n")
                $stream = $client.GetStream()
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush()
                $stream.Close()
                Write-AgentDeckHookTrace 'tcp_sent'
            } else {
                Write-AgentDeckHookTrace 'tcp_timeout'
            }
            $client.Close()
        }
    } catch { Write-AgentDeckHookTrace 'tcp_error' @{} $_ }
}
Write-HookDiag 'tcp-sent'
Write-AgentDeckHookTrace 'tcp_end'
if ($mailContext) {
    Write-AgentDeckHookTrace 'mailbox_begin'
    & node (Join-Path $PSScriptRoot 'agentdeck-mailbox.mjs') --hook $targetId ([string]$hook.hook_event_name) 2>$null
    Write-HookDiag "mailbox-done exit=$LASTEXITCODE"
    Write-AgentDeckHookTrace 'mailbox_end' @{ exit_code = $LASTEXITCODE }
}
Write-HookDiag 'end'
exit 0
} finally {
    Write-AgentDeckHookTrace 'notify_end'
}
