<#
.SYNOPSIS
  전수 회귀 — `docs/REGRESSION.md` R1~R37 을 **한 명령으로** 돌린다.

.DESCRIPTION
  `tools/probe-all.js` 는 렌더러 안에서 도는 것만 잴 수 있다. 창 밖의 일(유닛 테스트,
  OS 창 리사이즈, 재기동 후 복원, 훅 실발화)은 여기서 하고 결과를 한 리포트로 합친다.

  왜 러너가 필요한가 — 프로브만 돌리면 그 넷이 늘 `판정 불가` 로 남는다. 실제로 그 상태로
  세 라운드를 보냈고, 매번 "밖에서 해야 한다" 는 문장만 반복됐다 (2026-09-08).

  단계:
    0) npm run build                   → B0 (낡은 dist 로 재는 사고 방지)
    1) npm test                        → R13 (+ R33·R35·R36 은 여기 포함된 케이스가 판정)
    2) 격리 인스턴스 기동 + 창 크기 고정  → 프로브 1차 (R1~R37 중 렌더러 항목)
    3) 창 크기 변경 후 프로브 재실행       → R11
    4) 사이드바 폭 바꿔 재기동 후 확인      → R10
    5) 훅 스크립트 실발화 (격리 LOCALAPPDATA) → R21
    6) 합친 리포트를 파일과 화면에 출력

  결과 표기: PASS / FAIL / SKIP(판정 불가 — 환경이 조건을 못 만듦, 실패와 구분).

  **실패는 종류를 갈라 적는다** (`Get-FailureKind`). 옛 러너는 프로브 결과가 없으면 전부
  `프로브 실행 실패 (출력 파싱 불가)` 로 적었고, 그 문구가 **앱이 죽은 것처럼 읽혀서**
  2026-09-09 에 크래시 추적으로 몇 시간을 버렸다(실제로는 플러그인이 아직 안 떠 있었다).
  지금은 미로드(앱 생존) / 소실(프로세스 없음) / 진짜 파싱실패를 각각 다른 문구로 적고,
  소실이면 그 자리에서 증거(진단로그 꼬리·Crashpad 개수·프로세스 유무)를 리포트 폴더에 복사한다.

.PARAMETER KeepAlive
  끝나고 격리 인스턴스를 남긴다 (수동으로 더 볼 때).

.PARAMETER ContinueAfterAppGone
  앱이 사라진 뒤에도 남은 단계를 계속 돌린다. 기본은 **멈춘다** — 앱이 없는데 계속 돌리면
  프로브마다 실패가 쌓여 원인 지점이 묻히고, 다음 단계의 `.performance-gate-instance.ps1` 이 `ud` 를
  지워 Crashpad 리포트까지 사라진다.

.PARAMETER SkipUnit
  1) 단계를 건너뛴다 (이미 돌렸을 때).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/run-all.ps1
#>
param(
    [switch]$KeepAlive,
    [switch]$SkipUnit,
    [switch]$SkipBuild,
    [string]$PluginRoot = '',
    [switch]$ContinueAfterAppGone,
    [int]$Port = 9222,
    [int]$Width = 1700,
    [int]$Height = 1050
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# **부모의 플러그인 경로를 씻는다 — 이 줄 하나가 이 프로세스의 모든 기동에 걸린다.**
# 러너는 보통 Tabby 안의 셸에서 돌고, 그 셸은 `NODE_PATH` 에 실사용 플러그인 폴더
# (`%APPDATA%\tabby\plugins\node_modules`)를 물고 있다. Tabby 는 자기 경로를 그 **뒤**에
# 붙이므로 `--user-data-dir` 을 줘도 node 는 실사용 쪽을 먼저 찾는다 (2026-09-14 실측).
# 아래에서 러너가 직접 재기동하는 자리(4·4b)도 같은 프로세스라 이 값이 그대로 상속된다.
$env:NODE_PATH = ''
$env:TABBY_PLUGINS = ''

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $env:TEMP 'agentdeck-perf-regression'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$report = @()

# ---------------------------------------------------------------- 실패 종류 (사고 ①·②)
#
# **왜 이 상태들이 있나** — 사고 ① 은 살아 있는 앱을 죽은 것처럼 적은 것이고(프로브가
# `{"error":"__agentdeck …"}` 를 돌려준 판을 `출력 파싱 불가` 로 기록), 사고 ② 는 정말
# 프로세스가 사라졌는데 증거가 남지 않아 원인이 **미확정으로 끝난 것**이다. 두 사고의 공통
# 원인은 러너가 실패의 **종류**를 모른 채 한 문구로 뭉갠 것이다.
$script:GONE_PATTERN = 'ECONNRESET|ECONNREFUSED|socket hang up|EPIPE|ETIMEDOUT'
# 마지막 cdp 호출의 원문/저장 파일 — 종류 판정과 증거 요약이 이걸 읽는다
$script:probeRaw = ''
$script:probeFile = ''
# 앱이 사라졌나 / 어느 단계에서 / 증거를 어디에 뒀나
$script:appGone = $false
$script:goneStage = ''
$script:evidenceDir = ''
# 종류별 개수 — 요약에서 "FAIL 5" 중 몇 개가 파생인지 말하기 위한 것.
# **파이프라인 `.Count` 를 쓰지 않는다** (이 파일 6) 단계 주석의 그 사고: 명시 증가로만 센다)
$script:nGone = 0
$script:nNoPlugin = 0
$script:nParse = 0
$script:nDerived = 0

# 격리 폴더는 `.performance-gate-instance.ps1` 이 정한다 — 아래는 그것이 말해주기 전까지의 **폴백**이고,
# `Start-TestInstance` 가 그 스크립트의 출력(`started cfg=… ud=…`)을 파싱해 덮는다.
# 증거 수집이 엉뚱한 폴더를 보면 그대로 거짓 판단이 되므로, 러너가 경로를 스스로 만드는 것은
# 여기까지로 제한한다 (`tools/README.md` "로그 경로를 프로브가 만들지 말 것")
$script:cfgDir = Join-Path $env:LOCALAPPDATA 'tabby-agentdeck-test-perf-gate\cfg'
$script:udDir = Join-Path $env:LOCALAPPDATA 'tabby-agentdeck-test-perf-gate\ud'

function Note([string]$id, [string]$name, $pass, [string]$detail) {
    $script:report += [ordered]@{ id = $id; name = $name; pass = $pass; detail = $detail }
    $mark = if ($pass -eq $true) { 'PASS' } elseif ($pass -eq $false) { 'FAIL' } else { 'SKIP' }
    Write-Output ("{0,-5} {1} {2}" -f $id, $mark, $detail)
}

<#
.SYNOPSIS
  격리 인스턴스를 띄우고(또는 내리고), **그 스크립트가 말한 폴더 경로를 받아 둔다**.

.DESCRIPTION
  경로를 러너가 만들지 않는 이유 — `.performance-gate-instance.ps1` 이 폴더를 옮기면 증거를 엉뚱한 데서
  찾게 된다. 그 스크립트는 마지막에 `started cfg=<..> ud=<..> port=<..>` 를 찍으므로 그것을 읽는다.
  (앱이 사라진 뒤에는 `__agentdeck.diagPaths()` 로 제품에게 물을 수 없다 — 그래서 env/출력이다)
#>
function Start-TestInstance([switch]$Kill) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot '.performance-gate-instance.ps1'))
    if ($PluginRoot) { $psArgs += @('-PluginRoot', $PluginRoot) }
    $psArgs += @('-Port', $Port)
    if ($Kill) { $psArgs += '-Kill' }
    $out = & powershell @psArgs 2>&1 | Out-String
    if ("$out" -match 'cfg=(.+?) ud=(.+?) port=') {
        $script:cfgDir = $Matches[1].Trim()
        $script:udDir = $Matches[2].Trim()
    }
    return $out
}

<#
.SYNOPSIS
  Tabby 프로세스 개수 — 격리분과 전체를 따로 센다.

.DESCRIPTION
  격리분만 골라야 실사용 Tabby 를 "앱이 살아 있다" 로 오독하지 않는다. 커맨드라인으로 가른다
  (`.performance-gate-instance.ps1` 과 같은 기준). 실측 2026-09-09: `Win32_Process` 는 `Tabby.exe`,
  `Get-Process` 는 확장자 없는 `Tabby` 다 — 이름을 헷갈리면 늘 0개로 보인다.
#>
function Get-TabbyCounts {
    $test = 0
    foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*tabby-agentdeck-test-perf-gate*' })) {
        if ($p) { $test++ }
    }
    $any = 0
    foreach ($p in (Get-Process -Name 'Tabby' -ErrorAction SilentlyContinue)) { if ($p) { $any++ } }
    return @{ testProcs = $test; anyProcs = $any }
}

<#
.SYNOPSIS
  cdp/프로브 출력이 왜 쓸 수 없는지 판정한다.

.DESCRIPTION
  종류:
    ok         — `results` 가 있다 (정상)
    noplugin   — 프로브가 `{"error":"__agentdeck …"}` 를 돌려줬거나 표현식이 undefined 로 터졌다.
                 **앱은 살아 있다.** 이것을 앱 크래시로 읽은 것이 사고 ① 이다
    gone       — 연결이 끊겼다/거부됐다 (ECONNRESET·ECONNREFUSED) = 앱이 사라졌다
    nowindow   — CDP 는 붙는데 page 타깃이 없다 = 창이 닫혔다
    exception  — 표현식이 예외를 던졌다 (프로브/제품 결함)
    probeerror — 프로브가 스스로 error 를 돌려줬다 (미로드 외의 사유)
    parse      — 정말 JSON 이 아니다

  `results` 를 먼저 보는 이유 — 성공한 `probe-all.js` 출력에도 evidence 안에 `error` 키가
  있다(`probe-all.js:473`). 원문 정규식만으로 판정하면 통과한 판을 실패로 적는다.
#>
function Get-FailureKind([string]$raw, $obj) {
    if ($obj -and $obj.results) { return 'ok' }
    $text = "$raw"
    if ($text -match $script:GONE_PATTERN) { return 'gone' }
    if ($text -match 'page 타깃이 없다') { return 'nowindow' }
    if ($text -match 'EXCEPTION') {
        # `__agentdeck` 이 undefined 인 예외는 **미로드**다. R10·PR1 처럼 러너가 직접 쓰는
        # 표현식은 미로드 시 `{error}` 가 아니라 TypeError 로 터지므로 여기서 갈라야 한다
        if ($text -match '__agentdeck|of undefined|of null') { return 'noplugin' }
        return 'exception'
    }
    if ($obj -and $obj.error) {
        if ("$($obj.error)" -match '__agentdeck') { return 'noplugin' }
        return 'probeerror'
    }
    return 'parse'
}

<#
.SYNOPSIS
  격리 인스턴스의 진단 로그 폴더 — **만들지 않고 묻는다**.

.DESCRIPTION
  1순위 `AGENTDECK_DIAG_DIR`(= `.performance-gate-instance.ps1` 이 심는 격리 cfg 폴더, `src/diag.ts` 의 `logDir`),
  2순위 그 스크립트가 출력한 cfg 폴더. **홈으로 폴백하지 않는다** — 홈은 실사용 Tabby 의 파일이라
  읽어도 남의 줄이고, 그렇게 읽은 판이 실제로 IN9·PR4·PR5 를 뒤집었다(`tools/README.md`).
  앱이 살아 있으면 `__agentdeck.diagPaths()` 로 제품에게 물을 수 있지만, 소실 판에서는 못 쓴다.
#>
function Get-DiagDir {
    if ($env:AGENTDECK_DIAG_DIR -and (Test-Path $env:AGENTDECK_DIAG_DIR)) {
        return $env:AGENTDECK_DIAG_DIR
    }
    if ($script:cfgDir -and (Test-Path $script:cfgDir)) {
        return $script:cfgDir
    }
    return ''
}

<#
.SYNOPSIS
  앱이 사라진 판의 증거를 **그 자리에서** 리포트 폴더로 복사한다.

.DESCRIPTION
  왜 그 자리인가 — `.performance-gate-instance.ps1` 은 기동할 때 `ud` 를 지운다. 다음 단계로 넘어가
  인스턴스를 다시 띄우면 Crashpad 리포트와 Tabby 자기 로그가 함께 사라진다. 2026-09-09 에
  프로세스가 사라진 판의 원인을 끝내 못 짚은 이유가 ① 로그 파일을 실사용 Tabby 와 공유해
  마지막 줄이 밀려난 것, ② 그 판의 증거를 아무도 복사해두지 않은 것 두 가지였다.
  ①은 `AGENTDECK_DIAG_DIR` 로 갈랐고, ②가 이 함수다.

  `-KeepAlive` 와 무관하게 남는다 — 정리보다 증거가 먼저다. 복사본은 `$outDir` 아래에 있고
  러너의 정리 단계는 인스턴스만 내린다.
#>
function Save-VanishEvidence([string]$stage, [int]$TailLines = 200) {
    $dir = Join-Path $outDir (Join-Path 'evidence' $stage)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    $diagDir = Get-DiagDir

    # 진단 로그는 두 세대다 (`.log` / `.log.1` — `src/diag.ts` 의 rotate). 마지막 줄이 회전
    # 직후라 `.1` 에 있는 판이 실제로 있었으므로 둘 다 가져온다. `main-process-errors.log` 와
    # `ud/log.txt` 는 Tabby 자기 로그로, "정상 종료 경로였나" 의 반대 증거가 여기 남는다
    $copied = @()
    $wanted = @()
    if ($diagDir) {
        $wanted += (Join-Path $diagDir '.agentdeck-diag.log')
        $wanted += (Join-Path $diagDir '.agentdeck-diag.log.1')
        $wanted += (Join-Path $diagDir 'main-process-errors.log')
    }
    if ($script:udDir) { $wanted += (Join-Path $script:udDir 'log.txt') }
    foreach ($src in $wanted) {
        if (-not (Test-Path $src)) { continue }
        $leaf = (Split-Path -Leaf $src).TrimStart('.')
        try {
            Get-Content -Path $src -Tail $TailLines -Encoding UTF8 -ErrorAction Stop |
                Out-File -FilePath (Join-Path $dir "tail-$leaf.txt") -Encoding utf8
            $copied += $leaf
        } catch {
            # 한 파일을 못 읽어도 나머지는 담는다 — 증거는 있는 만큼 남기는 것이 낫다
        }
    }

    # Crashpad 가 비어 있으면 "크래시가 아니라 정상 종료 경로" 라는 판단 근거가 된다
    # (2026-09-09 실측이 그랬다). 있으면 그것부터 봐야 하므로 개수만 남긴다 — .dmp 는 크다
    $reportsDir = ''
    if ($script:udDir) { $reportsDir = Join-Path $script:udDir 'Crashpad\reports' }
    $nReports = 0
    if ($reportsDir -and (Test-Path $reportsDir)) {
        foreach ($f in (Get-ChildItem -Path $reportsDir -File -ErrorAction SilentlyContinue)) {
            if ($f) { $nReports++ }
        }
    }

    $counts = Get-TabbyCounts
    @(
        "stage=$stage at=$((Get-Date).ToString('s'))",
        "diagDir=$diagDir",
        "udDir=$($script:udDir)",
        "crashpadReports=$nReports ($reportsDir)",
        "tabbyProcs: 격리=$($counts.testProcs) 전체=$($counts.anyProcs)",
        "copied=$($copied -join ', ')",
        '',
        '--- 마지막 cdp/프로브 원문 ---',
        $script:probeRaw
    ) | Out-File -FilePath (Join-Path $dir 'summary.txt') -Encoding utf8

    $script:evidenceDir = $dir
    return @{
        dir = $dir; reports = $nReports; diagDir = $diagDir
        testProcs = $counts.testProcs; anyProcs = $counts.anyProcs; copied = $copied
    }
}

<#
.SYNOPSIS
  앱 소실을 기록한다 — 해당 항목은 판정 불가(null), 소실 자체는 FAIL 한 줄.

.DESCRIPTION
  왜 항목을 FAIL 로 적지 않나 — 프로브가 돌지 못했으므로 그 회귀 항목은 PASS/FAIL 을 말할
  수 없다(3값 규약의 `null`). 그렇다고 조용히 SKIP 만 남기면 판이 초록으로 끝나 사고 ② 가
  또 묻힌다. 그래서 **`APP` 라는 별도 FAIL 한 줄**을 세운다 — 판정 불가를 실패로 바꾸지
  않으면서 종료코드 1 과 원인 지점을 동시에 남기는 유일한 방법이다.
#>
function Add-AppGoneNote([string]$id, [string]$name, [string]$stage, [string]$why) {
    $ev = Save-VanishEvidence $stage
    $first = -not $script:appGone
    $script:appGone = $true
    if (-not $script:goneStage) { $script:goneStage = $stage }
    Note $id $name $null ("$why — 앱이 사라져 판정 불가. 증거: $($ev.dir)")
    if (-not $first) { return }
    $script:nGone++
    $crash = if ($ev.reports -gt 0) {
        "Crashpad 리포트 $($ev.reports)건 → 그것부터 볼 것"
    } else {
        'Crashpad 리포트 0건 → 크래시가 아니라 정상 종료 경로'
    }
    Note 'APP' '앱 프로세스 소실' $false (
        "$stage 에서 CDP 연결이 끊겼다 / 격리 Tabby $($ev.testProcs)개(실사용 포함 전체 $($ev.anyProcs)개)" +
        " / $crash / 진단로그 꼬리·요약: $($ev.dir) (로그 폴더 $($ev.diagDir))")
}

<# 앱이 없어서 못 돌린 단계 — 실패가 아니라 파생이다. 개수를 따로 세어 요약에 적는다 #>
function Add-DerivedSkipNote([string]$id, [string]$name) {
    $script:nDerived++
    Note $id $name $null ("앞 단계($($script:goneStage))에서 앱이 사라져 못 돌렸다" +
        " (파생 — APP 항목 참조 / 그래도 돌리려면 -ContinueAfterAppGone)")
}

<#
.SYNOPSIS
  프로브/cdp 실패를 **종류별 문구**로 적는다. `detail` 은 다음에 무엇을 볼지 말해야 한다.

.PARAMETER what
  못 잰 것이 무엇인지 (문구 앞에 붙는다)
.PARAMETER raw
  cdp 출력 원문
.PARAMETER rawFile
  원문이 이미 파일로 남아 있으면 그 경로. 없으면 여기서 남긴다 — 문구가 가리킬 곳이 있어야 한다
#>
function Add-ProbeFailureNote([string]$id, [string]$name, [string]$stage, [string]$what,
    [string]$raw, [string]$rawFile = '') {
    $script:probeRaw = "$raw"
    if (-not $rawFile) {
        $rawFile = Join-Path $outDir "cdp-$stage.txt"
        try { "$raw" | Out-File -FilePath $rawFile -Encoding utf8 } catch { $rawFile = '(원문 저장 실패)' }
    }
    $obj = $null
    try { $obj = ("$raw" | ConvertFrom-Json) } catch { $obj = $null }
    $kind = Get-FailureKind $raw $obj
    $head = ''
    foreach ($line in ("$raw" -split '\r?\n')) {
        if (-not $head -and $line.Trim()) { $head = $line.Trim() }
    }
    if ($head.Length -gt 160) { $head = $head.Substring(0, 160) + '…' }

    if ($kind -eq 'gone') {
        Add-AppGoneNote $id $name $stage ("$what 를 못 쟀다 (CDP 연결 끊김: $head)")
        return
    }
    if ($kind -eq 'nowindow') {
        Add-AppGoneNote $id $name $stage ("$what 를 못 쟀다 (CDP 는 붙었지만 page 타깃이 없다 — 창이 닫혔다)")
        return
    }
    if ($kind -eq 'noplugin') {
        # 사고 ① 의 그 자리다. **앱 크래시가 아니라고 문구가 먼저 말해야** 한다
        $c = Get-TabbyCounts
        $script:nNoPlugin++
        Note $id $name $null ("플러그인 미로드 — 앱은 살아 있다(격리 Tabby $($c.testProcs)개)." +
            " 크래시 추적 금지. 볼 곳: $(Get-DiagDir) 의 .agentdeck-diag.log," +
            " 그리고 dist 빌드/plugins junction. 재시도: npm run build 후 .performance-gate-instance.ps1 재기동" +
            " (러너는 Wait-ForPlugin 으로 40초까지 기다린다). 원문 $rawFile")
        return
    }
    $script:nParse++
    if ($kind -eq 'exception') {
        Note $id $name $false ("$what 중 표현식이 예외를 던졌다 — $head / 원문 $rawFile" +
            ' (앱 소실·미로드는 아니다: 연결은 살아 있고 __agentdeck 도 있다)')
        return
    }
    if ($kind -eq 'probeerror') {
        Note $id $name $false ("프로브가 오류를 돌려줬다: $($obj.error) / 원문 $rawFile" +
            ' (앱·플러그인은 살아 있다 — 프로브 쪽을 볼 것)')
        return
    }
    if ($obj) {
        # JSON 은 맞는데 기대한 필드가 없다 — 프로브 반환 모양이 바뀐 쪽을 본다
        Note $id $name $false ("$what 출력이 예상 밖 형태다 (JSON 은 맞지만 results/기대 필드가 없다)" +
            " — 첫 줄: $head / 원문 $rawFile. 앱·플러그인은 살아 있다 — 프로브의 반환 모양" +
            '({summary, results}) 을 볼 것')
        return
    }
    Note $id $name $false ("$what 출력이 JSON 이 아니다 (진짜 파싱 실패) — 첫 줄: $head" +
        " / 원문 $rawFile. 연결 오류도 __agentdeck 표시도 없으니 앱 소실·미로드가 아니다 —" +
        ' 프로브가 뭔가를 먼저 찍었는지(console.log) 볼 것')
}

<# 앱이 사라진 뒤에 남은 단계를 멈출지 — 기본은 멈춘다 (`-ContinueAfterAppGone` 로 해제) #>
function Test-AppStop {
    return ($script:appGone -and -not $ContinueAfterAppGone)
}

# 창 크기를 OS 레벨에서 바꾼다 — 렌더러가 못 하는 일이라 R11 이 여기 있다
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AdWin {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int cx, int cy, bool repaint);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
function Set-TestWindow([int]$w, [int]$h) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" |
        Where-Object { $_.CommandLine -like '*tabby-agentdeck-test-perf-gate*' }
    $n = 0
    foreach ($p in $procs) {
        $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
            [void][AdWin]::MoveWindow($proc.MainWindowHandle, 60, 60, $w, $h, $true)
            [void][AdWin]::SetForegroundWindow($proc.MainWindowHandle)
            $n++
        }
    }
    return $n
}

<#
.SYNOPSIS
  플러그인이 실제로 떴는지 확인될 때까지 기다린다.

.DESCRIPTION
  **이것이 없으면 프로브가 `{"error":"__agentdeck 이 없다 — 플러그인이 안 떴다"}` 를 돌려주고,
  러너는 `results` 가 없다는 이유로 `출력 파싱 불가` 로 기록한다.** 그 문구는 앱이 죽은 것처럼
  읽혀서, 2026-09-09 에 크래시 추적으로 오래 헤맸다 — 앱은 살아 있었고 창만 아직 준비 중이었다.

  고정 `Start-Sleep` 로는 못 맞춘다: 재기동 직후에는 옛 프로세스 종료와 겹쳐 로드가 늦고,
  플러그인 수가 늘면 더 늦어진다. 그래서 **상태를 폴링**한다.

  돌려주는 값: `ready` / `noplugin`(앱은 있는데 안 떴다) / `gone`(프로세스가 없다).
  **기동 직후의 ECONNREFUSED 는 정상이다** — 디버그 포트가 아직 안 열린 것뿐이라, 연결 오류만으로
  소실이라 적으면 사고 ① 의 반대 오판이 된다. 그래서 격리 Tabby 프로세스가 실제로 0개인 상태가
  세 번(약 2초) 이어질 때만 `gone` 이라고 말한다.
#>
function Wait-ForPlugin([int]$TimeoutSec = 40) {
    $probe = Join-Path $outDir 'wait-plugin.js'
    @'
(() => JSON.stringify({ ready: !!(window.__agentdeck && window.__agentdeck.app) }))()
'@ | Out-File -FilePath $probe -Encoding utf8
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $raw = ''
    $goneStreak = 0
    while ((Get-Date) -lt $deadline) {
        Push-Location $root
        $raw = & node tools/cdp.js $Port $probe 2>&1 | Out-String
        Pop-Location
        $script:probeRaw = "$raw"
        if ($raw -match '"ready":\s*true') {
            return 'ready'
        }
        if ($raw -match $script:GONE_PATTERN) {
            $c = Get-TabbyCounts
            if ($c.testProcs -eq 0) { $goneStreak++ } else { $goneStreak = 0 }
            if ($goneStreak -ge 3) {
                Write-Output '  (격리 Tabby 프로세스가 없다 — 앱이 사라졌다. 증거를 모은다)'
                return 'gone'
            }
        } else {
            $goneStreak = 0
        }
        Start-Sleep -Milliseconds 700
    }
    Write-Output ("  (경고: {0}초 안에 플러그인이 뜨지 않았다 — 이후 프로브는 신뢰할 수 없다)" -f $TimeoutSec)
    if ($raw -match $script:GONE_PATTERN) {
        $c = Get-TabbyCounts
        if ($c.testProcs -eq 0) { return 'gone' }
    }
    return 'noplugin'
}

<#
.SYNOPSIS
  프로브를 돌린다. 쓸 수 있는 결과일 때만 객체를 주고, 아니면 `$null` + 원문을 남긴다.

.DESCRIPTION
  **`{"error":…}` 도 JSON 으로는 파싱된다** — 옛 구현은 그것을 성공으로 보고 돌려줬고,
  호출부의 `foreach ($p1.results)` 가 **한 줄도 안 돌아** 조용히 넘어갔다(2) 단계에서는
  아무 항목도 안 적히고, 3) 단계에서는 R11 이 거짓 FAIL 이 됐다). 그래서 `results` 가 없으면
  실패로 돌려 호출부가 `Add-ProbeFailureNote` 로 **종류를 가려 적게** 한다.

  원문은 파일에 그대로 두고(`probe-<tag>.json`) 그 경로를 문구가 가리킨다. 원문 문자열을
  파이프로 들고 다니지 않는 이유 — `Out-String` 이 줄을 접으면 긴 evidence 줄이 깨진다.
#>
function Invoke-Probe([string]$tag, [string]$probeScript = 'tools/probe-all.js') {
    $file = Join-Path $outDir "probe-$tag.json"
    Push-Location $root
    & node tools/cdp.js $Port $probeScript 2>&1 | Out-File -FilePath $file -Encoding utf8
    Pop-Location
    $raw = ''
    try { $raw = (Get-Content -Raw -Encoding UTF8 $file) } catch { $raw = '' }
    $script:probeRaw = "$raw"
    $script:probeFile = $file
    $obj = $null
    try { $obj = ("$raw" | ConvertFrom-Json) } catch { $obj = $null }
    if ($obj -and $obj.results) { return $obj }
    return $null
}

Write-Output "=== 전수 회귀 (tabby-agentdeck) ==="
Write-Output ""

# ---------------------------------------------------------------- 0) 빌드
# **여기서 빌드하지 않으면 회귀는 낡은 `dist/` 를 잰다.**
# 2026-09-08 실측: 소스를 고치고 러너만 돌려서 "고쳤는데 그대로 FAIL" 을 두 번 봤다.
# 프로브는 실행 중인 번들을 보므로, 소스 수정이 화면에 닿았는지는 빌드가 유일한 보증이다.
if ($SkipBuild) {
    Note 'B0' '번들 빌드' $null '건너뜀 (-SkipBuild)'
} else {
    Write-Output '--- 0) 빌드 (dist/) ---'
    Push-Location $root
    $bl = & npm run build 2>&1
    $bcode = $LASTEXITCODE
    Pop-Location
    $bl | Out-File -FilePath (Join-Path $outDir 'build.txt') -Encoding utf8
    $berr = @()
    foreach ($l in $bl) { if ("$l" -match 'ERROR in |error TS') { $berr += "$l" } }
    Note 'B0' '번들 빌드' ($bcode -eq 0 -and $berr.Count -eq 0) $(if ($bcode -eq 0 -and $berr.Count -eq 0) { 'webpack 0 에러' } else { "빌드 실패 — $($berr | Select-Object -First 1) (build.txt)" })
    if ($bcode -ne 0 -or $berr.Count -gt 0) {
        Write-Output ''
        Write-Output '빌드가 실패했다 — 낡은 dist 로 재는 것은 의미가 없으니 여기서 멈춘다.'
        Write-Output "  로그: $(Join-Path $outDir 'build.txt')"
        exit 1
    }
}

# ---------------------------------------------------------------- 1) 유닛 테스트
if ($SkipUnit) {
    Note 'R13' '유닛 테스트' $null '건너뜀 (-SkipUnit)'
} else {
    Write-Output '--- 1) npm test ---'
    Push-Location $root
    $unit = & npm test 2>&1
    Pop-Location
    $lines = $unit | Select-String -Pattern 'passed, (\d+) failed'
    $pass = 0
    $fail = 0
    foreach ($l in $lines) {
        if ($l -match '(\d+) passed, (\d+) failed') {
            $pass += [int]$Matches[1]
            $fail += [int]$Matches[2]
        }
    }
    $unit | Out-File -FilePath (Join-Path $outDir 'unit.txt') -Encoding utf8
    if ($lines.Count -eq 0) {
        Note 'R13' '유닛 테스트' $false '테스트 출력을 읽지 못했다 (unit.txt 확인)'
    } else {
        Note 'R13' '유닛 테스트' ($fail -eq 0) "$pass passed / $fail failed ($($lines.Count) 파일)"
        # 순수 로직 항목은 이 안의 케이스가 판정한다
        Note 'R33' '판정 폴백' ($fail -eq 0) 'agents 케이스 포함 (npm test)'
        Note 'R35' '입력창 모양 주입' ($fail -eq 0) 'prompt/screen 케이스 포함 (npm test)'
        Note 'R36' '프로필 shape 배선' ($fail -eq 0) 'agents 케이스 포함 (npm test)'
    }
}

# ---------------------------------------------------------------- 2) 인스턴스 + 프로브 1차
Write-Output ''
Write-Output '--- 2) 격리 인스턴스 + 프로브 ---'
[void](Start-TestInstance)
$plug = Wait-ForPlugin

# 터미널 탭이 하나는 있어야 대부분의 항목이 판정된다 — 사이드바 `+ 새 탭` 을 눌러 만든다.
# 파일을 쓰는 것은 앱과 무관하므로 소실 판정과 별개로 미리 만든다 (2-d 도 이 파일을 쓴다)
$openTab = Join-Path $outDir 'open-tab.js'
@'
(() => {
    document.querySelector('#agentdeck-sidebar .ad-new').click()
    return JSON.stringify({ tabs: window.__agentdeck.app.tabs.length })
})()
'@ | Out-File -FilePath $openTab -Encoding utf8

if ($plug -eq 'gone') {
    # 기동 직후에 프로세스가 없다 = 뒤의 어떤 프로브도 못 돈다. 증거를 챙기고 파생 처리로 넘긴다
    Add-AppGoneNote 'PROBE' '프로브 1차' '2-boot' '격리 인스턴스가 기동 직후 사라졌다'
} else {
    [void](Set-TestWindow $Width $Height)
    Start-Sleep -Seconds 1
    Push-Location $root
    & node tools/cdp.js $Port $openTab | Out-Null
    Pop-Location
    Start-Sleep -Seconds 5

    $p1 = Invoke-Probe 'main'
    if ($p1) {
        # 러너가 판정하는 항목은 프로브의 SKIP 을 리포트에 넣지 않는다 — 넣으면 같은 항목이
        # SKIP 과 PASS 로 **두 번** 집계돼 요약이 거짓이 된다 (첫 실행에서 total 이 40 으로 부풀었다)
        $runnerOwned = @('R10', 'R11', 'R13', 'R21', 'R33', 'R35', 'R36', 'PR1')
        foreach ($r in $p1.results) {
            if ($report.id -contains $r.id) { continue }
            if ($runnerOwned -contains $r.id) { continue }
            Note $r.id $r.name $r.pass $r.detail
        }
    } else {
        Add-ProbeFailureNote 'PROBE' '프로브 1차' '2-main' '프로브 1차(R1~R37)' $script:probeRaw $script:probeFile
    }
}

# ------------------------------------------------- 2-b) 확장 프로브 (회귀 공백 메우기)
#
# `probe-all.js` 가 R1~R37 을 보고, 아래 확장 프로브들은 **회귀 항목이 없던 영역**을 본다
# (입력 경로 · 레이아웃/외형 · 프로필/복구 · 미리보기 심화 · 세션 그룹 · 성능). 파일이 없으면 조용히 건너뛴다 —
# 유닛이 아직 만들지 않았을 수 있고, 러너가 그 이유로 실패하면 안 된다.
Write-Output ''
Write-Output '--- 2-b) 확장 프로브 ---'
$extra = @(
    # 상태 배지(ST*)를 맨 앞에 둔다 — 사이드바가 말하는 값이 전부 여기서 나오고, 이것이 틀린 판에서
    # 다른 프로브를 재면 원인을 가를 수 없다. `staleAfterMs` 를 2초로 줄여 실제 `tick()` 이
    # 판정하게 두고(시계를 조작하지 않는다) finally 에서 되돌린다. 탭을 최대 3개까지 열었다 닫는다
    @{ tag = 'status';  script = 'tools/probe-status.js';  label = '상태 배지' },
    @{ tag = 'input';   script = 'tools/probe-input.js';   label = '입력 경로' },
    @{ tag = 'layout';  script = 'tools/probe-layout.js';  label = '레이아웃·외형' },
    @{ tag = 'profile'; script = 'tools/probe-profile.js'; label = '프로필·복구' },
    @{ tag = 'viewer';  script = 'tools/probe-viewer.js';  label = '미리보기 심화' },
    # 탭 작업 폴더(CW*)는 미리보기 바로 뒤다 — `변경` 탭·상대경로 풀기·사이드바 그룹이 전부
    # 이 값을 원천으로 쓰므로, cwd 가 틀린 판에서 그것들을 재면 원인을 가를 수 없다.
    # 상태 파일을 실사용과 **같은 폴더**에 쓰지만 격리 인스턴스의 tabId 를 실어 보내므로
    # 실사용 쪽에서는 `tabid-miss` 로 버려진다(남의 사이드바를 안 건드린다).
    @{ tag = 'cwd';     script = 'tools/probe-cwd.js';     label = '탭 작업 폴더' },
    @{ tag = 'group';   script = 'tools/probe-group.js';   label = '세션 그룹' },
    # 지난 세션 이어받기(RS*)는 그룹 바로 뒤다 — 그 줄들이 **그룹 안에** 붙으므로 그룹 판정이
    # 먼저 서야 원인을 가를 수 있다. 화면을 흔들지 않는다: 설정(`resumeExpanded`/`resumeHidden`)만
    # 잠깐 바꾸고 finally 에서 되돌리며, 탭을 만들지도 지우지도 않는다(실제 이어받기는 사람이 한 번 본다).
    # 이 PC 에 Claude Code 대화기록이 없으면 전 케이스가 `판정 불가` 로 떨어진다.
    @{ tag = 'resume';  script = 'tools/probe-resume.js';  label = '지난 세션 이어받기' },
    # 서브에이전트 개수(SA*)는 **2초 스캔 주기를 기다려야 해서 느리다**(실측 22초) —
    # 값싼 프로브들 뒤에 두어 빠른 실패를 먼저 보게 한다. 순서 드래그(reorder)보다 **앞**에
    # 두는 이유는 그쪽이 `app.tabs` 를 흔들기 때문이다: 흔든 뒤에 돌면 내가 잡은 줄이 다른
    # 순서의 화면 위에 있게 되고, 그쪽 finally 가 CDP 단절로 못 돌면 내 판정까지 흔들린다.
    # 이 프로브는 **사용자의 실제 대화기록 폴더**(`~/.claude/projects`)와 공유 상태 폴더에
    # 파일을 만든다 — 세션 id 에 `agentdeck-probe-sa-` 접두를 박고 SA9 가 잔여 0 을 판정한다.
    # 훅(HK*)은 **`hooks/*.ps1` 을 실제로 실행한다** — 그전까지 회귀는 훅이 설치됐는지만 보고
    # 한 번도 돌려보지 않았다. 그래서 훅이 깨져도(인코딩·경로·JSON 파싱) 초록으로 남았다.
    # `subagent` 앞에 둔 이유: 둘이 **같은 채널**(상태 파일 + 세션↔탭 묶기)을 건드리므로,
    # 훅이 심은 가짜 세션이 남은 채로 개수 프로브가 돌면 그것을 자기 픽스처로 착각한다.
    # 훅은 격리 `LOCALAPPDATA`(`<TEMP>/ad-hk-*`)로 실행하고 접두 `agentdeck-probe-hk-` 로만 지운다.
    @{ tag = 'hooks';   script = 'tools/probe-hooks.js';   label = '훅 실제 실행' },
    @{ tag = 'subagent'; script = 'tools/probe-subagent.js'; label = '서브에이전트 개수' },
    # 키보드 내비게이션(NV*)은 **포커스를 옮긴다** — 목록에 포커스를 남기면 그 뒤의 모든 키가
    # 사이드바로 가서 라벨·IME·붙여넣기 검증이 어긋난다. 프로브가 finally 에서
    # `focusNav('off')` 로 돌려주지만(`cleanup.focusReleased`), CDP 가 중간에 끊기면 finally 가
    # 아예 안 돈다 — 그래서 키 경로를 재는 프로브(input)보다 **뒤**에 둔다. 순서 드래그(reorder)
    # 앞인 이유는 그쪽이 `app.tabs` 를 흔들어 화면 순서를 바꾸기 때문이다: 그 뒤에서 재면
    # 포커스 이동이 "그때의 순서" 에 얹혀 근거가 흔들린다. 임시 프로필·폴더 이름은
    # probe-group.js 와 같은 접두(`agentdeck-probe-grp` / `ad-grp-`)라 잔여는 GR15 가 잡는다.
    @{ tag = 'nav';     script = 'tools/probe-nav.js';     label = '키보드 내비게이션' },
    # 순서 드래그(RO*)는 **`app.tabs` 를 실제로 흔든다** — 목록 맨 뒤에 둔 이유다.
    # 프로브가 finally 에서 원래 순서로 되돌리지만(`cleanup.orderRestored`), CDP 가 중간에
    # 끊기면 finally 가 아예 안 돈다 — 그럴 때 뒤 단계(R10·PR1)가 다른 순서의 화면을 재지
    # 않게 이것을 2-c) 직전에 둔다. 임시 프로필·폴더 이름을 probe-group.js 와 같은 접두
    # (`agentdeck-probe-grp` / `ad-grp-`)로 쓰므로 잔여는 GR15 가 같은 그물로 잡는다.
    @{ tag = 'reorder'; script = 'tools/probe-reorder.js'; label = '순서 드래그' }
    # 성능(perf)은 여기 넣지 않는다 — 아래 2-d) 에서 **인스턴스를 새로 띄운 뒤** 돌린다.
)
foreach ($e in $extra) {
    $path = Join-Path $root $e.script
    if (-not (Test-Path $path)) {
        Write-Output ("  (건너뜀: {0} 없음)" -f $e.script)
        continue
    }
    if (Test-AppStop) {
        Add-DerivedSkipNote ('EX-' + $e.tag) $e.label
        continue
    }
    Write-Output ("  [{0}] {1}" -f $e.tag, $e.label)
    $pe = Invoke-Probe $e.tag $e.script
    if ($pe -and $pe.results) {
        foreach ($r in $pe.results) {
            if ($report.id -contains $r.id) { continue }
            # PR1 은 재기동이 필요해 러너(4-b)가 판정한다 — 프로브의 SKIP 을 넣으면 이중 집계다
            if ($r.id -eq 'PR1') { continue }
            Note $r.id $r.name $r.pass $r.detail
        }
    } else {
        # 옛 문구는 종류를 가리지 않은 `프로브 실행 실패 (출력 파싱 불가)` 하나였다 —
        # 미로드·소실·진짜 파싱실패가 한 문구로 뭉쳐서 사고 ① 이 났다
        Add-ProbeFailureNote ('EX-' + $e.tag) $e.label ('2b-' + $e.tag) $e.label `
            $script:probeRaw $script:probeFile
    }
}

# ------------------------------------------------- 2-c) 다중 그룹 프로브 정리 확인 (GR15)
#
# `probe-group.js` 의 GR6~GR14 는 다중 그룹 화면을 만들려고 **임시 프로필 두 개를 config 에
# 심고 그 cwd 로 탭을 띄운다** (cwd 는 `cwdCache` 에서 오고 그 캐시는 탭 출력으로만 채워지므로
# 프로브가 심을 수 없다). 그 프로필이 남으면 그 뒤의 `+ 새 탭` 이 임시 폴더에서 열려
# 4)·4-b) 의 재기동 판정(R10·PR1)이 다른 화면을 재게 된다. 프로브 finally 가 치우기는 하지만,
# CDP 가 중간에 끊기면 finally 가 아예 안 돈다 — 그래서 러너가 한 번 확인한다.
# 디스크 쪽 잔여는 **GR15 가 보지 않는다** — 그쪽은 화면(그룹 헤더·접힘 목록)만 본다.
# 각 프로브가 자기 것만 `cleanup` 에 적으므로, CDP 가 끊겨 finally 가 안 돌면 조용히 남는다
# (2026-09-09 실측: 빈 잔재 2개가 며칠 남아 있었다). 그래서 러너가 `%TEMP%` 를 한 번 훑는다.
# **지우지는 않는다** — `%TEMP%` 는 사용자 것이고, 무엇이 흘렸는지 사람이 보고 판단해야 한다.
# 접두는 **`ad-*` 하나로** 잡는다. 처음에는 아는 이름 셋(`ad-grp*`·`ad-hk*`·`ad-doc*`)만 셌는데,
# 그 목록이 곧바로 낡았다 — 실측(2026-09-10) `%TEMP%` 에 `ad-drop-`(probe-viewer 가 지금도
# 만든다) 1개와 옛 프로브가 남긴 `ad-sim-` 23개·`ad-refd-` 1개가 있었는데 **한 개도 안 걸렸다.**
# 이 저장소의 프로브는 전부 `ad-` 로 시작하는 mkdtemp 를 쓰므로, 이름을 열거하는 대신
# 접두 하나만 본다(열거하면 프로브가 늘 때마다 이 검사가 조용히 눈을 감는다).
Write-Output ''
Write-Output '--- 2-c-0) 임시 폴더 잔여 (프로브가 흘린 것) ---'
$leftDirs = @(Get-ChildItem -Path $env:TEMP -Directory -Filter 'ad-*' -ErrorAction SilentlyContinue)
if ($leftDirs.Count -eq 0) {
    Write-Output 'TMP   PASS 프로브가 흘린 임시 폴더 잔여 0개 (ad-*)'
} else {
    $names = ($leftDirs | ForEach-Object { $_.Name }) -join ', '
    # 실패로 세지 않는다 — 이 판이 흘린 것인지 옛 판의 잔재인지 러너는 모른다.
    # 다만 **눈에 보이게** 적어 두어야 다음 사람이 지울지 판단할 수 있다.
    Write-Output ("TMP   NOTE 임시 폴더 잔여 {0}개: {1} (이 판이 흘렸는지 옛 잔재인지는 mtime 으로 판단)" -f $leftDirs.Count, $names)
}

Write-Output ''
Write-Output '--- 2-c) 다중 그룹 프로브 정리 확인 (GR15) ---'
if (Test-AppStop) {
    Add-DerivedSkipNote 'GR15' '다중 그룹 프로브 정리'
} else {
# 아래 블록은 일부러 들여쓰지 않았다 — 여기문서(@'…'@) 종결자는 **1열**에 있어야 하므로
# 본문만 들여쓰면 오히려 어긋나 보인다. 블록 끝의 `}` 두 개가 이 else 를 닫는다
Push-Location $root
$leftoverJs = Join-Path $outDir 'group-leftover.js'
@'
(() => {
    const ad = window.__agentdeck
    const ids = (ad.config.store.profiles || []).map(p => (p ? p.id : null)).filter(Boolean)
    const sb = document.getElementById('agentdeck-sidebar')
    const heads = sb ? Array.from(sb.querySelectorAll('.ad-group-head')).map(h => h.title) : []
    return JSON.stringify({
        leftoverProfiles: ids.filter(id => String(id).indexOf('agentdeck-probe-grp') >= 0),
        terminalProfile: ad.config.store.terminal ? ad.config.store.terminal.profile : null,
        collapsed: (ad.config.store.agentDeck.collapsedGroups || []).slice(),
        tempHeads: heads.filter(t => String(t).indexOf('ad-grp-') >= 0),
        tabs: ad.app.tabs.length,
    })
})()
'@ | Out-File -FilePath $leftoverJs -Encoding utf8
$leftOut = & node tools/cdp.js $Port $leftoverJs 2>&1 | Out-String
Pop-Location
try {
    $lv = ($leftOut | ConvertFrom-Json)
    $nProf = @($lv.leftoverProfiles).Count
    $nHead = @($lv.tempHeads).Count
    $nCollapsed = @($lv.collapsed | Where-Object { "$_" -like '*ad-grp-*' }).Count
    $badDefault = ("$($lv.terminalProfile)" -like '*agentdeck-probe-grp*')
    $ok = ($nProf -eq 0) -and ($nHead -eq 0) -and ($nCollapsed -eq 0) -and (-not $badDefault)
    Note 'GR15' '다중 그룹 프로브 정리' $ok `
        ("임시프로필 $nProf 개 / 기본프로필=$($lv.terminalProfile) / 임시그룹헤더 $nHead 개 / 접힘잔여 $nCollapsed 개 / 탭 $($lv.tabs)개")
} catch {
    Add-ProbeFailureNote 'GR15' '다중 그룹 프로브 정리' '2c-leftover' '프로브 정리 상태 조회' $leftOut
}
}

# ------------------------------------------------- 2-d) 성능 (PF) — **새 인스턴스에서만**
#
# perf 프로브는 탭을 최대 10개까지 열고(PF8) 전용 임시 탭에 출력 조각을 쏟는다(PF3~PF7).
# 앞 프로브들이 이미 만들어 둔 탭·화면 위에 그걸 얹으면 **Electron 이 조용히 종료된다**
# (크래시 리포트도 남지 않는다). 2026-09-09 실측: 러너 한 판에서 그렇게 죽어 뒤 프로브가
# 전부 `출력 파싱 불가` 로 무너졌고, 원인이 앱 크래시처럼 보여 추적에 오래 걸렸다.
#
# 재기동은 부작용이 아니라 **측정 품질**이기도 하다 — 앞 프로브가 남긴 상태(도킹·투명도·
# 열린 패널·만든 탭)가 없는 화면에서 재야 숫자를 비교할 수 있다.
Write-Output ''
Write-Output '--- 2-d) 성능 (PF) — 새 인스턴스 ---'
$perfPath = Join-Path $root 'tools/probe-perf.js'
if (Test-AppStop) {
    Add-DerivedSkipNote 'PERF' '성능(PF)'
} elseif (-not (Test-Path $perfPath)) {
    Write-Output '  (건너뜀: tools/probe-perf.js 없음)'
} else {
    [void](Start-TestInstance -Kill)
    [void](Start-TestInstance)
    $plug = Wait-ForPlugin
    if ($plug -eq 'gone') {
        # 사고 ② 가 실제로 난 자리다 — 여기서 프로세스가 사라지면 그 판의 증거가 전부다.
        # 다음 단계로 넘어가 인스턴스를 다시 띄우면 `ud` 가 지워져 Crashpad 도 함께 사라진다
        Add-AppGoneNote 'PERF' '성능(PF)' '2d-perf-boot' '성능 측정용 재기동 직후 앱이 사라졌다'
    } else {
        [void](Set-TestWindow $Width $Height)
        Push-Location $root
        & node tools/cdp.js $Port $openTab | Out-Null
        Pop-Location
        # 세션이 붙고 첫 프롬프트가 나올 시간 — 이게 짧으면 PF3~PF7 이 "출력 채널이 없다" 로 빠진다
        Start-Sleep -Seconds 9

        $pf = Invoke-Probe 'perf'
        if ($pf -and $pf.results) {
            foreach ($r in $pf.results) {
                if ($report.id -contains $r.id) { continue }
                Note $r.id $r.name $r.pass $r.detail
            }
        } else {
            Add-ProbeFailureNote 'PERF' '성능(PF)' '2d-perf' '성능 프로브(PF)' $script:probeRaw $script:probeFile
        }
    }
}

# ---------------------------------------------------------------- 3) R11 창 리사이즈
Write-Output ''
Write-Output '--- 3) 창 리사이즈 후 재측정 (R11) ---'
if (Test-AppStop) {
    Add-DerivedSkipNote 'R11' '창 리사이즈'
} else {
    [void](Set-TestWindow 1200 800)
    Start-Sleep -Seconds 3
    $p2 = Invoke-Probe 'resized'
    if ($p2) {
        $r1 = $p2.results | Where-Object { $_.id -eq 'R1' }
        $r3 = $p2.results | Where-Object { $_.id -eq 'R3' }
        $ok = ($r1.pass -eq $true) -and ($r3.pass -eq $true)
        Note 'R11' '창 리사이즈' $ok "1200x800 에서 R1=$($r1.pass) R3=$($r3.pass) — $($r3.detail)"
    } else {
        Add-ProbeFailureNote 'R11' '창 리사이즈' '3-resized' '1200x800 재측정' $script:probeRaw $script:probeFile
    }
    [void](Set-TestWindow $Width $Height)
    Start-Sleep -Seconds 2
}

# ---------------------------------------------------------------- 4) R10 재기동 후 복원
Write-Output ''
Write-Output '--- 4) 사이드바 폭 바꿔 재기동 (R10) ---'
# 격리 폴더는 `.performance-gate-instance.ps1` 이 말한 값을 쓴다 (`Start-TestInstance` 가 받아 뒀다)
$isoCfg = $script:cfgDir
$ud = $script:udDir
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Tabby\Tabby.exe'
$wantWidth = 333
if (Test-AppStop) {
    Add-DerivedSkipNote 'R10' '크기조절 후 재기동'
} else {
# 들여쓰지 않은 이유는 2-c) 와 같다 (여기문서 종결자가 1열)
Push-Location $root
$setWidth = Join-Path $outDir 'set-width.js'
@"
(() => {
    const ad = window.__agentdeck
    ad.config.store.agentDeck.sidebarWidth = $wantWidth
    ad.config.save()
    ad.relayout()
    return JSON.stringify({ sidebarWidth: ad.config.store.agentDeck.sidebarWidth })
})()
"@ | Out-File -FilePath $setWidth -Encoding utf8
& node tools/cdp.js $Port $setWidth | Out-Null
Pop-Location
Start-Sleep -Seconds 2

# config 를 보존한 채 재기동한다 — `.performance-gate-instance.ps1` 은 config 를 새로 쓰므로 쓸 수 없다
Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" |
    Where-Object { $_.CommandLine -like '*tabby-agentdeck-test-perf-gate*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$env:TABBY_CONFIG_DIRECTORY = $isoCfg
# 진단 로그도 격리 폴더로 유지한다 — `.performance-gate-instance.ps1` 은 이 값을 심는데 러너가 직접
# 재기동하는 이 자리에서 빼먹으면 이 인스턴스의 로그가 홈(실사용 Tabby 와 **같은 파일**)으로
# 돌아가고, 종료 원인 줄이 남의 줄에 밀려난다 (사고 ② 가 그래서 미확정으로 끝났다)
$env:AGENTDECK_DIAG_DIR = $isoCfg
Start-Process -FilePath $exe -ArgumentList @("--user-data-dir=$ud", "--remote-debugging-port=$Port")
Start-Sleep -Seconds 9
$plug = Wait-ForPlugin 15
if ($plug -eq 'gone') {
    Add-AppGoneNote 'R10' '크기조절 후 재기동' '4-restart' '사이드바 폭을 바꿔 재기동한 뒤 앱이 사라졌다'
} else {
[void](Set-TestWindow $Width $Height)
Start-Sleep -Seconds 1

Push-Location $root
$readWidth = Join-Path $outDir 'read-width.js'
@'
(() => {
    const ad = window.__agentdeck
    const sb = document.getElementById('agentdeck-sidebar')
    return JSON.stringify({
        cfg: ad.config.store.agentDeck.sidebarWidth,
        drawn: sb ? sb.clientWidth : null,
    })
})()
'@ | Out-File -FilePath $readWidth -Encoding utf8
$widthOut = & node tools/cdp.js $Port $readWidth 2>&1 | Out-String
Pop-Location
try {
    $w = ($widthOut | ConvertFrom-Json)
    $ok = ($w.cfg -eq $wantWidth) -and ([math]::Abs($w.drawn - $wantWidth) -le 2)
    Note 'R10' '크기조절 후 재기동' $ok "저장 $wantWidth → 복원 cfg=$($w.cfg) 그려진폭=$($w.drawn)"
} catch {
    Add-ProbeFailureNote 'R10' '크기조절 후 재기동' '4-readwidth' '재기동 후 사이드바 폭' $widthOut
}
}
}

# ------------------------------------------------- 4-b) 작업 루트 프로필 (재기동 필요)
#
# `rootProfile` 은 **기동 시점**에 켜져 있어야 프로필이 만들어진다(`profile.service.ts` 의
# `ensureProfile` 이 `ready$` 에서 한 번만 돈다). 프로브가 런타임에 켜도 소용없어 PR1 이
# 영구 SKIP 이었다 — 그래서 config 에 심고 한 번 더 재기동해 판정한다.
Write-Output ''
Write-Output '--- 4-b) 작업 루트 프로필 (PR1) ---'
$wantCwd = $root -replace '\\', '/'
if (Test-AppStop) {
    Add-DerivedSkipNote 'PR1' '작업 루트 프로필 (재기동 후)'
} else {
# 들여쓰지 않은 이유는 2-c) 와 같다 (여기문서 종결자가 1열)
Push-Location $root
$setRoot = Join-Path $outDir 'set-rootprofile.js'
@"
(() => {
    const ad = window.__agentdeck
    const c = ad.config.store.agentDeck
    c.rootProfile = true
    c.rootProfileCwd = '$wantCwd'
    ad.config.save()
    return JSON.stringify({ rootProfile: c.rootProfile, cwd: c.rootProfileCwd })
})()
"@ | Out-File -FilePath $setRoot -Encoding utf8
& node tools/cdp.js $Port $setRoot | Out-Null
Pop-Location
Start-Sleep -Seconds 2

Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" |
    Where-Object { $_.CommandLine -like '*tabby-agentdeck-test-perf-gate*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$env:TABBY_CONFIG_DIRECTORY = $isoCfg
$env:AGENTDECK_DIAG_DIR = $isoCfg
Start-Process -FilePath $exe -ArgumentList @("--user-data-dir=$ud", "--remote-debugging-port=$Port")
Start-Sleep -Seconds 9
$plug = Wait-ForPlugin 15
if ($plug -eq 'gone') {
    Add-AppGoneNote 'PR1' '작업 루트 프로필 (재기동 후)' '4b-restart' 'rootProfile 을 심고 재기동한 뒤 앱이 사라졌다'
} else {
[void](Set-TestWindow $Width $Height)
Start-Sleep -Seconds 1

Push-Location $root
$readRoot = Join-Path $outDir 'read-rootprofile.js'
@'
(() => {
    const ad = window.__agentdeck
    const list = ad.config.store.profiles || []
    const mine = list.find(p => p.id === 'agentdeck:root') || null
    return JSON.stringify({
        found: !!mine,
        id: mine ? mine.id : null,
        name: mine ? mine.name : null,
        cwd: mine && mine.options ? mine.options.cwd : null,
        command: mine && mine.options ? mine.options.command : null,
        defaultProfile: ad.config.store.terminal.profile,
    })
})()
'@ | Out-File -FilePath $readRoot -Encoding utf8
$rootOut = & node tools/cdp.js $Port $readRoot 2>&1 | Out-String
Pop-Location
try {
    $rp = ($rootOut | ConvertFrom-Json)
    $ok = $rp.found -and $rp.cwd -and ($rp.defaultProfile -eq 'agentdeck:root')
    Note 'PR1' '작업 루트 프로필 (재기동 후)' $ok `
        ("found=$($rp.found) name=$($rp.name) cwd=$($rp.cwd) default=$($rp.defaultProfile)")
} catch {
    Add-ProbeFailureNote 'PR1' '작업 루트 프로필 (재기동 후)' '4b-readroot' '재기동 후 rootProfile' $rootOut
}
}
}

# ---------------------------------------------------------------- 5) R21 훅 실발화
Write-Output ''
Write-Output '--- 5) 훅 실발화 (R21) ---'
# **여기는 앱 소실과 무관하게 항상 돌린다** — 훅은 별개 PowerShell 프로세스라 Tabby 가 없어도
# 판정된다. 앱이 사라졌다고 밖에서 되는 검증까지 버리면 한 판에서 얻는 정보가 줄어든다
$hook = Join-Path $root 'hooks\agentdeck-notify.ps1'
if (-not (Test-Path $hook)) {
    Note 'R21' 'StopFailure 훅 실발화' $null '훅 스크립트가 없다'
} else {
    # 실사용 상태 폴더를 오염시키지 않도록 LOCALAPPDATA 를 격리한다
    $iso = Join-Path $outDir 'localappdata'
    New-Item -ItemType Directory -Force -Path $iso | Out-Null
    $statusDir = Join-Path $iso 'tabby-agentdeck\status'
    if (Test-Path $statusDir) { Remove-Item -Recurse -Force $statusDir -ErrorAction SilentlyContinue }
    $sid = 'regression-probe'
    $json = '{"session_id":"' + $sid + '","hook_event_name":"StopFailure","error":"rate_limit",' +
        '"last_assistant_message":"You''ve hit your session limit · resets 12pm (Asia/Seoul)"}'
    $prevLocal = $env:LOCALAPPDATA
    $prevRuntime = $env:AGENTDECK_RUNTIME_ROOT
    $env:AGENTDECK_RUNTIME_ROOT = Join-Path $iso 'tabby-agentdeck'
    $env:LOCALAPPDATA = $iso
    $json | & powershell -NoProfile -ExecutionPolicy Bypass -File $hook -Status error | Out-Null
    $env:LOCALAPPDATA = $prevLocal
    $env:AGENTDECK_RUNTIME_ROOT = $prevRuntime
    $file = Join-Path $statusDir "$sid.json"
    if (Test-Path $file) {
        try {
            $wrote = Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json
            $ok = ($wrote.status -eq 'limited') -and ($wrote.reason -like '*session limit*')
            Note 'R21' 'StopFailure 훅 실발화' $ok "status=$($wrote.status) reason=$($wrote.reason)"
        } catch {
            Note 'R21' 'StopFailure 훅 실발화' $false '상태 파일을 파싱하지 못했다'
        }
    } else {
        Note 'R21' 'StopFailure 훅 실발화' $false '상태 파일이 만들어지지 않았다'
    }
}

# ---------------------------------------------------------------- 6) 정리 + 리포트
# 증거는 이미 `$outDir\evidence\<단계>` 로 **복사**돼 있다 — 그래서 `-KeepAlive` 가 아니어도
# 앱이 사라진 판의 로그 꼬리·Crashpad 개수·프로세스 유무가 남는다 (정리보다 증거가 먼저다).
# 인스턴스를 남겨야 볼 수 있는 것은 화면뿐이고, 파일 증거는 여기 정리와 무관하다
if (-not $KeepAlive) {
    Write-Output ''
    [void](Start-TestInstance -Kill)
}

$sorted = $report | Sort-Object { [int](($_.id -replace '[^0-9]', '') + '0') }
# 명시 루프로 센다 — `Where-Object {...}).Count` 조합이 실제로 어긋난 값을 냈다
# (2026-09-08: total 37 인데 PASS 36 + SKIP 4 = 40 으로 보고됐다). 요약이 틀리면 리포트 전체를
# 믿을 수 없으므로, 세는 방법을 파이프라인에 맡기지 않는다.
$nPass = 0
$nFail = 0
$nSkip = 0
foreach ($r in $sorted) {
    if ($r.pass -is [bool] -and $r.pass) { $nPass++ }
    elseif ($r.pass -is [bool]) { $nFail++ }
    else { $nSkip++ }
}
$sum = [ordered]@{ total = $sorted.Count; pass = $nPass; fail = $nFail; skipped = $nSkip }
$final = [ordered]@{ ranAt = (Get-Date).ToString('s'); summary = $sum; results = $sorted }
$reportFile = Join-Path $outDir 'regression.json'
$final | ConvertTo-Json -Depth 6 | Out-File -FilePath $reportFile -Encoding utf8

Write-Output ''
Write-Output "=== 요약: total $($sum.total) / PASS $($sum.pass) / FAIL $($sum.fail) / SKIP $($sum.skipped) ==="
Write-Output "리포트: $reportFile"
# 실패 종류별 개수 — `FAIL 5` 만 보면 그중 몇 개가 파생인지 알 수 없다. 정상 판에서는 전부 0이라
# 한 줄도 찍지 않는다 (통과하던 판의 요약 모양을 바꾸지 않는다)
if ($script:nGone -gt 0 -or $script:nNoPlugin -gt 0 -or $script:nParse -gt 0 -or $script:nDerived -gt 0) {
    Write-Output ("실패 종류: 앱소실 {0} / 플러그인미로드 {1} / 파싱·프로브오류 {2}" -f `
        $script:nGone, $script:nNoPlugin, $script:nParse)
    if ($script:nDerived -gt 0) {
        Write-Output ("  앱이 {0} 에서 사라져 뒤 단계 {1}개가 못 돌았다 — 파생이므로 FAIL 로 세지 않는다" -f `
            $script:goneStage, $script:nDerived)
    }
    if ($script:nNoPlugin -gt 0) {
        Write-Output '  플러그인미로드는 앱 크래시가 아니다 — 크래시 추적 말고 dist 빌드/plugins junction 을 볼 것'
    }
    if ($script:evidenceDir) {
        Write-Output ("  증거: {0} (진단로그 꼬리 · Crashpad 개수 · 프로세스 유무 · cdp 원문)" -f $script:evidenceDir)
    }
}
if ($sum.fail -gt 0) {
    Write-Output ''
    Write-Output '실패 항목:'
    $sorted | Where-Object { $_.pass -eq $false } | ForEach-Object {
        Write-Output ("  {0} {1} — {2}" -f $_.id, $_.name, $_.detail)
    }
    exit 1
}
exit 0
