# 격리 테스트 인스턴스를 띄운다 — 실사용 Tabby 를 죽이지 않는다.
#
# `--user-data-dir` 이 Electron 싱글인스턴스 락을 갈라 주므로 별개 프로세스로 뜨고,
# `TABBY_CONFIG_DIRECTORY` 로 config 를 분리한다. 플러그인은 %APPDATA% 의 junction 을
# 그대로 쓰므로 **작업 중인 소스**가 그대로 뜬다 (npm run build 후 재기동이면 반영).
#
#   powershell -ExecutionPolicy Bypass -File tools/test-instance.ps1          # 띄우기
#   powershell -ExecutionPolicy Bypass -File tools/test-instance.ps1 -Kill    # 내리기
#   -ConPTY : terminal.useConPTY 를 켠 채로 띄운다 (기본 off)
#   -Cwd    : 기본 프로필의 작업 폴더 (기본값은 격리 work 폴더)
#             지난 세션 목록처럼 **실제 폴더의 상태**를 봐야 하는 검증에 쓴다 —
#             그 기능들은 탭의 cwd 로 그룹을 가르므로 격리 폴더에서는 아무것도 안 걸린다.
#
# ud 폴더는 매번 새로 만든다 — 남아 있으면 recoverTabs 가 지난 실행의 탭을 되살려
# 매번 다른 초기 상태로 뜬다 (docs/REGRESSION.md 실측).
param([switch]$Kill, [int]$Port = 9222, [switch]$ConPTY, [string]$Cwd = '', [string]$PluginRoot = '', [string]$Language = 'ko-KR')

$root = Split-Path -Parent $PSScriptRoot
if ($PluginRoot) { $root = (Resolve-Path -LiteralPath $PluginRoot -ErrorAction Stop).Path }
$base = Join-Path $env:LOCALAPPDATA 'tabby-agentdeck-repairperf'
$cfg  = Join-Path $base 'cfg'
$ud   = Join-Path $base 'ud'

# 테스트 인스턴스만 골라 내린다 — 실사용 Tabby 는 건드리면 안 되므로
# 커맨드라인에 우리 ud 경로가 들어간 프로세스만 죽인다.
$victims = Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" |
    Where-Object { $_.CommandLine -like "*tabby-agentdeck-repairperf*" }
foreach ($p in $victims) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($Kill) { Write-Output "killed=$($victims.Count)"; exit 0 }

Start-Sleep -Milliseconds 400
if ([IO.Path]::GetFullPath($ud) -ne [IO.Path]::GetFullPath((Join-Path $base 'ud'))) { throw 'Unexpected test directory' }
if (Test-Path $ud) { Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $cfg, $ud | Out-Null

# 기본 프로필의 작업 폴더. `-Cwd` 를 주면 그 폴더에서 탭이 태어난다 —
# 지난 세션 목록처럼 **실제 폴더의 상태**를 보는 기능은 격리 폴더에서는 아무것도 안 걸린다.
$workCwd = if ($Cwd) { $Cwd } else { Join-Path $base 'work' }

# config 는 매번 새로 쓴다 — 사용자 config 의 프로필·설정이 딸려오지 않도록 복사하지 않는다.
# 보간형 here-string(`@"`)이다 — 안에 `$workCwd` 를 넣으므로. 리터럴 `$` 를 쓸 일이 생기면
# 백틱으로 이스케이프할 것.
$conf = @"
version: 4
profiles:
  - type: local
    id: local:test-ps
    name: TestPS
    options:
      command: powershell.exe
      args: ['-NoLogo', '-ExecutionPolicy', 'Bypass']
      cwd: $workCwd
    icon: fas fa-terminal
  - type: local
    id: local:test-claude
    name: TestClaude
    options:
      command: cmd.exe
      args: ['/c', 'D:\Project\tabby-agentdeck\tools\run-claude-test.cmd']
    icon: fas fa-robot
terminal:
  profile: __PROFILE__
  useConPTY: __CONPTY__
  rightClick: 'off'
  font: Consolas
  fontSize: 14
recoverTabs: false
language: $Language
enablePlugins: true
agentDeck:
  enabled: true
  accountStorageDir: $base\accounts
"@
$conf = $conf.Replace('__CONPTY__', $(if ($ConPTY) { 'true' } else { 'false' }))
$conf = $conf.Replace('__PROFILE__', 'local:test-ps')
Set-Content -Path (Join-Path $cfg 'config.yaml') -Value $conf -Encoding UTF8

# 플러그인은 userData(=--user-data-dir) 아래에서 스캔된다. ud 를 매번 새로 만드므로
# 여기서도 작업 중인 소스로 junction 을 다시 건다 — 그래야 방금 빌드한 dist 가 뜬다.
$pluginDir  = Join-Path $ud 'plugins'
$pluginRoot = Join-Path $pluginDir 'node_modules'
New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null
New-Item -ItemType Junction -Path (Join-Path $pluginRoot 'tabby-agentdeck') -Target $root | Out-Null
$spec = 'file:' + $root.Replace([char]92, '/')
'{ "dependencies": { "tabby-agentdeck": "' + $spec + '" } }' |
    Set-Content -Path (Join-Path $pluginDir 'package.json') -Encoding UTF8

$env:TABBY_CONFIG_DIRECTORY = $cfg
$env:AGENTDECK_ACCOUNTS_FILE = Join-Path $base 'accounts\accounts.json'
$env:AGENTDECK_RUNTIME_ROOT = ''
$env:AGENTDECK_MAILBOX_ROOT = ''
# 진단 로그도 갈라 둔다 — 실사용 Tabby 와 같은 파일을 쓰면 이 인스턴스의 마지막 줄이 남의
# 줄에 묻혀 종료 원인을 볼 수 없다 (2026-09-09 실측. `src/diag.ts` 의 `logDir` 주석)
$env:AGENTDECK_DIAG_DIR = $cfg
# **부모의 플러그인 경로를 씻는다.** 이 스크립트는 보통 Tabby 안의 셸에서 도는데, 그 셸은
# `NODE_PATH` 에 실사용 플러그인 폴더(`%APPDATA%\tabby\plugins\node_modules`)를 물고 있다.
# Tabby 는 자기 경로를 그 **뒤**에 붙이므로, node 가 `tabby-agentdeck` 을 찾을 때 실사용 쪽이
# 먼저 걸린다 — `--user-data-dir` 을 줘도 격리가 안 된다(2026-09-14 실측).
# 지금은 둘 다 같은 소스 트리를 가리켜 증상이 안 보이지만, npm 설치본을 깔아 보는 순간 갈린다.
$env:NODE_PATH = ''
$env:TABBY_PLUGINS = ''
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Tabby\Tabby.exe'
Start-Process -FilePath $exe -ArgumentList @("--user-data-dir=$ud", "--remote-debugging-port=$Port") -WindowStyle Hidden
Write-Output "started cfg=$cfg ud=$ud port=$Port"

