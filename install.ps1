<#
.SYNOPSIS
  AgentDeck 플러그인을 Tabby 에 연결한다.

.DESCRIPTION
  Tabby 는 사용자 플러그인 디렉토리(userData/plugins/node_modules)를 스캔하므로
  이 스크립트는 그곳에 프로젝트 폴더를 가리키는 junction 을 만든다.
  소스를 고치고 `npm run build` 만 하면 Tabby 재시작으로 바로 반영된다.

.PARAMETER Hooks
  Claude Code 설정(~/.claude/settings.json)에 상태 통보 훅을 등록한다.

  이게 사이드바 상태의 가장 정확한 원천이다 — 에이전트가 "지금 시작했다 / 승인을 기다린다 /
  끝났다" 를 직접 알려주므로, 화면에 그려진 글자를 보고 추측할 필요가 없다.
  등록하지 않아도 동작은 하지만(출력 패턴 폴백) 판정이 그만큼 흔들린다.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Hooks
#>
param(
    [switch]$Hooks
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$pluginRoot = Join-Path $env:APPDATA 'tabby\plugins\node_modules'
$link = Join-Path $pluginRoot 'tabby-agentdeck'

# 1) 빌드 산출물 확인
if (-not (Test-Path (Join-Path $source 'dist\index.js'))) {
    Write-Warning "dist\index.js 가 없다. 먼저 'npm install' 후 'npm run build' 를 실행할 것."
}

# 2) 플러그인 디렉토리에 junction 연결
New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null
if (Test-Path $link) {
    Remove-Item $link -Force -Recurse
}
New-Item -ItemType Junction -Path $link -Target $source | Out-Null
Write-Host "연결됨: $link -> $source"

# 2-1) plugins\package.json 에 file: 의존성으로 등록
#     Tabby 플러그인 매니저가 다른 플러그인을 설치하면 npm install 이 돌면서
#     package.json 에 없는 node_modules 항목을 extraneous 로 보고 지운다.
#     여기 등록해두면 junction 이 정식 의존성이 되어 살아남는다.
$pkgPath = Join-Path (Split-Path $pluginRoot) 'package.json'
if (Test-Path $pkgPath) {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
} else {
    $pkg = [pscustomobject]@{ dependencies = [pscustomobject]@{} }
}
if (-not $pkg.dependencies) {
    $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$spec = 'file:' + ($source -replace '\\', '/')
$pkg.dependencies | Add-Member -NotePropertyName 'tabby-agentdeck' -NotePropertyValue $spec -Force
$pkg | ConvertTo-Json -Depth 10 | Out-File $pkgPath -Encoding utf8
Write-Host "의존성 등록: $pkgPath (tabby-agentdeck = $spec)"

# 2-2) Claude Code 상태 통보 훅 등록
if ($Hooks) {
    $settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
    $notify = Join-Path $source 'hooks\agentdeck-notify.ps1'
    if (-not (Test-Path $notify)) {
        throw "훅 스크립트를 찾지 못했다: $notify"
    }

    if (Test-Path $settingsPath) {
        # 남의 설정을 건드리는 일이라 되돌릴 수 있게 한 벌 남긴다
        Copy-Item $settingsPath "$settingsPath.agentdeck-backup" -Force
        $settings = Get-Content $settingsPath -Raw -Encoding utf8 | ConvertFrom-Json
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath) | Out-Null
        $settings = [pscustomobject]@{}
    }
    if (-not $settings.hooks) {
        $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
    }

    # 어떤 순간에 무엇을 보고할지.
    #   UserPromptSubmit — 지시를 받았다 (프롬프트 원문을 작업 이름으로 삼는다)
    #   Notification     — 승인을 기다린다
    #   Stop             — 답이 끝났다
    $plan = @(
        @{ Event = 'UserPromptSubmit'; Args = '-Status running -PromptAsLabel' },
        @{ Event = 'Notification';     Args = '-Status waiting' },
        @{ Event = 'Stop';             Args = '-Status done' }
    )

    foreach ($p in $plan) {
        $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$notify`" $($p.Args)"
        $entry = [pscustomobject]@{
            matcher = '*'
            hooks   = @([pscustomobject]@{ type = 'command'; command = $cmd; timeout = 5 })
        }

        $existing = @($settings.hooks.$($p.Event))
        # 이미 우리 훅이 있으면 새 경로/인자로 갈아끼운다 (중복 등록 방지)
        $kept = @($existing | Where-Object {
            $_ -and -not ($_ | ConvertTo-Json -Depth 10 -Compress).Contains('agentdeck-notify')
        })
        $settings.hooks | Add-Member -NotePropertyName $p.Event -NotePropertyValue ($kept + $entry) -Force
        Write-Host "훅 등록: $($p.Event) -> $($p.Args)"
    }

    $settings | ConvertTo-Json -Depth 20 | Out-File $settingsPath -Encoding utf8
    Write-Host "저장: $settingsPath (백업: $settingsPath.agentdeck-backup)"
}

Write-Host ""
Write-Host "Tabby 를 재시작하면 적용된다."
