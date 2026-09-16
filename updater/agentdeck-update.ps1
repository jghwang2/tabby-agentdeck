# AgentDeck 자동 업데이트 — 플러그인 폴더에 새 버전을 깐다.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File agentdeck-update.ps1 `
#       -Version 1.1.1 -PluginsDir "<APPDATA>\tabby\plugins" -TabbyExe "<...>\Tabby.exe" -InPlace
#
# 모드가 둘이다.
#
#  **-InPlace (지금 쓰는 길)** — Tabby 가 **떠 있는 채로** 깐다. 기다리지도, 다시 띄우지도 않는다.
#    적용은 플러그인이 창(renderer)만 리로드해서 한다(`src/reload.service.ts`) — 탭과 세션이 산다.
#    로드된 `.js` 는 Windows 가 잡고 있지 않으므로(require 는 읽고 바로 닫는다) 폴더를 갈아끼워도 된다.
#    이 모드에서는 부른 쪽이 **종료 코드를 기다린다** — 끝나야 리로드할 수 있기 때문이다.
#
#  **기본(옛 길)** — Tabby 종료를 기다린다 → 설치한다 → 다시 띄운다. 옛 버전이 띄운 스크립트나
#    손으로 돌릴 때를 위해 남겨 둔다.
#
# 어느 쪽이든 이 스크립트는 **패키지 밖(임시 폴더)에서** 실행돼야 한다. 자기가 사는 폴더를
# npm 이 통째로 갈아엎기 때문이다 (`update.service.ts` 가 임시 폴더로 복사해 띄운다).
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$PluginsDir,
    [Parameter(Mandatory = $true)][string]$TabbyExe,
    # 우리를 띄운 그 Tabby 의 **메인 프로세스 PID**. 이것만 기다린다.
    # 0 이면 옛 방식(이름으로 전부)으로 물러난다 — 옛 버전이 이 인자를 안 보낸다.
    [int]$TabbyPid = 0,
    [string]$LogFile = '',
    # Tabby 가 꺼지기를 기다리는 최대 시간(초). 넘으면 설치하지 않고 그냥 끝낸다 —
    # 떠 있는 상태로 설치하면 반쯤 지워진 플러그인이 남는다
    [int]$WaitSeconds = 60,
    # Tabby 를 껐다 켜지 않는다 — 기다리지도 않고 다시 띄우지도 않는다
    [switch]$InPlace,
    # npm 에 건넬 대상. 기본은 `tabby-agentdeck@<Version>`(레지스트리)이고,
    # **회귀는 지금 소스로 만든 tgz 경로를 준다** — 이미 배포된 버전에는 검증할 코드가 없다
    [string]$Spec = ''
)

$ErrorActionPreference = 'Stop'
$pkg = 'tabby-agentdeck'

if (-not $LogFile) {
    $LogFile = Join-Path $env:LOCALAPPDATA 'tabby-agentdeck\update.log'
}
$logDir = Split-Path -Parent $LogFile
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

function Write-Log ([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $msg
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# 로그는 지난 실행을 덮지 않고 쌓되, 커지면 한 번 잘라낸다 (실패를 나중에 읽을 수 있어야 한다)
try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 512KB)) {
        Move-Item -Force $LogFile "$LogFile.1"
    }
} catch { }

Write-Log "=== update 시작 version=$Version pluginsDir=$PluginsDir"

# ── 1) Tabby 가 꺼지기를 기다린다 ────────────────────────────────────────────
#
# **우리를 띄운 그 인스턴스만 기다린다** (`-TabbyPid` = Electron 메인 프로세스).
# 이름(`Tabby.exe`)으로 전부 세면 **다른 Tabby 창 하나 때문에 업데이트가 영영 안 된다** —
# 그쪽은 다른 user-data-dir 을 쓰는 별개 인스턴스라 우리 플러그인 파일과 아무 상관이 없다
# (2026-09-11: 격리 인스턴스로 검증하려 했더니 실사용 Tabby 가 떠 있어 60초 타임아웃).
#
# 파일 잠금을 쥔 것은 플러그인을 require 한 **렌더러**지만, 메인이 죽으면 자식(renderer·gpu)도
# 함께 내려간다. 그래서 메인 PID 가 사라지고 그 자식들이 정리될 때까지를 한 조건으로 본다.
function Test-TabbyAlive ([int]$mainPid) {
    if ($mainPid -le 0) {
        # 옛 방식 — 이름으로 전부
        return @(Get-Process -Name 'Tabby' -ErrorAction SilentlyContinue).Count
    }
    $n = 0
    if (Get-Process -Id $mainPid -ErrorAction SilentlyContinue) { $n++ }
    # 메인이 사라져도 자식이 잠깐 남을 수 있다 — 그 자식들까지 없어져야 잠금이 풀린다
    $n += @(Get-CimInstance Win32_Process -Filter "Name='Tabby.exe' AND ParentProcessId=$mainPid" -ErrorAction SilentlyContinue).Count
    return $n
}

if ($InPlace) {
    Write-Log 'InPlace — Tabby 종료를 기다리지 않는다 (적용은 플러그인이 창 리로드로 한다)'
} else {
    Write-Log "대기 대상: $(if ($TabbyPid -gt 0) { "pid=$TabbyPid (+자식)" } else { '이름으로 전부 (옛 방식)' })"
    $waited = 0
    while ($true) {
        $alive = Test-TabbyAlive $TabbyPid
        if ($alive -eq 0) { break }
        if ($waited -ge $WaitSeconds) {
            Write-Log "FAIL Tabby 가 ${WaitSeconds}초 안에 꺼지지 않았다 (남은 프로세스 ${alive}개) — 설치하지 않는다"
            exit 2
        }
        Start-Sleep -Milliseconds 500
        $waited += 0.5
    }
    Write-Log "Tabby 종료 확인 (${waited}초 대기)"
    # 핸들이 완전히 풀릴 여유를 조금 더 준다
    Start-Sleep -Milliseconds 800
}

# ── 2) 설치 ─────────────────────────────────────────────────────────────────
# Tabby 의 플러그인 설치와 같은 방식이다 — `plugins/package.json` 에 의존성으로 적히고
# `plugins/node_modules` 아래로 풀린다. `--prefix` 로 그 폴더를 가리킨다.
$installed = $false
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue) }
if (-not $npm) {
    Write-Log 'FAIL npm 을 찾지 못했다 (PATH 에 node/npm 이 없다)'
    # npm 이 없어도 Tabby 는 다시 띄워 준다 — 사람의 창을 빼앗은 채 끝내면 안 된다
    Write-Log '설치를 건너뛴다'
} else {
    Write-Log "npm=$($npm.Source)"
    # `$args` 는 PowerShell 자동 변수다 — 이름을 겹치면 조용히 이상하게 돈다
    $target = if ($Spec) { $Spec } else { "$pkg@$Version" }
    Write-Log "설치 대상: $target"
    $npmArgs = @('install', '--prefix', $PluginsDir, '--no-audit', '--no-fund', $target)
    try {
        $out = & $npm.Source @npmArgs 2>&1
        $code = $LASTEXITCODE
        foreach ($line in $out) { Write-Log "npm| $line" }
        if ($code -eq 0) {
            Write-Log "OK 설치 완료 $pkg@$Version"
            $installed = $true
        } else {
            Write-Log "FAIL npm exit=$code — 옛 버전이 그대로 남아 있을 수 있다"
        }
    } catch {
        Write-Log "FAIL npm 실행 예외: $($_.Exception.Message)"
    }
}

# ── 3) 다시 띄운다 ──────────────────────────────────────────────────────────
# InPlace 면 애초에 닫지 않았으므로 띄울 것이 없다 — 부른 쪽이 창만 새로 고친다.
# 옛 길에서는 **설치가 실패했어도 반드시 띄운다**. 업데이트를 고르느라 터미널을 잃는 일은 없어야 한다.
if ($InPlace) {
    Write-Log '=== update 끝 (InPlace — 적용은 플러그인이 창 리로드로 한다)'
    # 부른 쪽이 이 코드를 본다. 다만 최종 판정은 디스크의 버전이다 (`installedVersion`)
    exit $(if ($installed) { 0 } else { 1 })
}

try {
    if (Test-Path $TabbyExe) {
        Start-Process -FilePath $TabbyExe
        Write-Log "Tabby 재시작: $TabbyExe"
    } else {
        Write-Log "FAIL Tabby 실행파일을 찾지 못했다: $TabbyExe"
    }
} catch {
    Write-Log "FAIL Tabby 재시작 예외: $($_.Exception.Message)"
}

Write-Log '=== update 끝'
