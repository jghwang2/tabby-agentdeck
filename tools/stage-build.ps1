param([string]$Destination = '', [switch]$Release)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $repo '.tmp/staged-plugin' }
$stage = [IO.Path]::GetFullPath($Destination)
$scratch = [IO.Path]::GetFullPath((Join-Path $repo '.tmp')) + [IO.Path]::DirectorySeparatorChar
if (-not $stage.StartsWith($scratch, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Staging output must be inside this repository .tmp directory.'
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
foreach ($entry in @('package.json') + @($package.files | Where-Object { $_ -ne 'dist' })) {
    Copy-Item -LiteralPath (Join-Path $repo $entry) -Destination $stage -Recurse -Force
}
Push-Location $repo
try {
    if ($Release) {
        & npx.cmd webpack --mode production --env release --output-path (Join-Path $stage 'dist')
    } else {
        & npx.cmd webpack --mode production --output-path (Join-Path $stage 'dist')
    }
    if ($LASTEXITCODE -ne 0) { throw 'Staging build failed.' }
} finally { Pop-Location }
Write-Output "Staged package: $stage"
