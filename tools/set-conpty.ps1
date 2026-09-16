# Tabby 의 useConPTY 설정을 바꾼다.
#
#   powershell -ExecutionPolicy Bypass -File tools\set-conpty.ps1              # 지금 값 보기
#   powershell -ExecutionPolicy Bypass -File tools\set-conpty.ps1 on           # ConPTY 켜기
#   powershell -ExecutionPolicy Bypass -File tools\set-conpty.ps1 off          # winpty 로 되돌리기
#   powershell -ExecutionPolicy Bypass -File tools\set-conpty.ps1 on -Kill     # Tabby 강제종료 후 켜기
#
# Tabby 가 켜져 있는 동안 고치면 종료할 때 메모리 값으로 덮어쓰므로,
# 살아 있으면 거부한다. -Kill 을 주면 먼저 강제 종료한다.
param(
    [Parameter(Position = 0)]
    [ValidateSet('on', 'off', 'status')]
    [string]$Mode = 'status',
    [switch]$Kill
)

$ErrorActionPreference = 'Stop'
$cfg = Join-Path $env:APPDATA 'tabby\config.yaml'

function Show-Current {
    $hit = Select-String -Path $cfg -Pattern '^\s*useConPTY:\s*(\S+)\s*$'
    if (-not $hit) { Write-Host "useConPTY 줄이 없다 (Tabby 기본값 사용 중)" -ForegroundColor Yellow; return $null }
    foreach ($h in $hit) { Write-Host ("현재  {0}:{1}" -f $cfg, $h.LineNumber) -ForegroundColor Cyan; Write-Host ("      " + $h.Line.Trim()) }
    return $hit
}

if ($Mode -eq 'status') {
    Show-Current | Out-Null
    $n = @(Get-Process Tabby -ErrorAction SilentlyContinue).Count
    Write-Host "Tabby 프로세스: $n 개"
    exit 0
}

$alive = @(Get-Process Tabby -ErrorAction SilentlyContinue)
if ($alive.Count -gt 0) {
    if (-not $Kill) {
        Write-Host "중단: Tabby 가 $($alive.Count) 개 돌고 있다." -ForegroundColor Red
        Write-Host "      완전히 끄고 다시 실행하거나, -Kill 을 붙여 강제 종료할 것." -ForegroundColor Red
        exit 2
    }
    Write-Host "Tabby $($alive.Count) 개 강제 종료..." -ForegroundColor Yellow
    taskkill /F /IM Tabby.exe 2>&1 | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        if (@(Get-Process Tabby -ErrorAction SilentlyContinue).Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }
    $left = @(Get-Process Tabby -ErrorAction SilentlyContinue).Count
    if ($left -gt 0) { Write-Host "중단: $left 개가 안 죽었다." -ForegroundColor Red; exit 4 }
    Write-Host "OK  전부 종료됨" -ForegroundColor Green
}

$want = if ($Mode -eq 'on') { 'true' } else { 'false' }
$from = if ($Mode -eq 'on') { 'false' } else { 'true' }

$lines = Get-Content $cfg
$hit = 0
$out = $lines | ForEach-Object {
    if ($_ -match '^(\s*)useConPTY:\s*' + $from + '\s*$') { $hit++; "$($Matches[1])useConPTY: $want" } else { $_ }
}

if ($hit -eq 0) {
    Write-Host "바꿀 것이 없다 — 이미 useConPTY: $want 이거나 줄이 없다." -ForegroundColor Yellow
    Show-Current | Out-Null
    exit 0
}
if ($hit -gt 1) {
    Write-Host "중단: useConPTY: $from 줄이 $hit 개다 (1개여야 한다). 손대지 않았다." -ForegroundColor Red
    exit 3
}

$backup = "$cfg.before-conpty-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $cfg $backup -Force
Set-Content -Path $cfg -Value $out -Encoding UTF8

Write-Host "OK  useConPTY: $from -> $want" -ForegroundColor Green
Write-Host "    백업: $backup"
Write-Host "    이제 Tabby 를 켜면 된다."
