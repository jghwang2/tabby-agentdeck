# 창을 그대로 PNG 로 찍는다 — CDP 가 없는 실사용 Tabby 도 볼 수 있다.
#
#   powershell -ExecutionPolicy Bypass -File tools/shot.ps1 -Out shot.png
#   powershell -ExecutionPolicy Bypass -File tools/shot.ps1 -Test -Out t.png   # 격리 인스턴스
#
# `PrintWindow(flag 2 = PW_RENDERFULLCONTENT)` 를 쓴다. `CopyFromScreen` 은 가려진 창 대신
# **앞 창을 찍어** 엉뚱한 화면이 나온다(2026-09-02 실측: 테스트 대신 실사용 Tabby 가 찍혔다).
param([string]$Out = "shot.png", [switch]$Test, [string]$Title = "")

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Shot {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

# 테스트 인스턴스는 커맨드라인에 ud 경로가 박혀 있어 실사용과 확실히 갈린다
$procs = Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'"
$want = $procs | Where-Object {
    if ($Test) { $_.CommandLine -like "*tabby-agentdeck-test*" }
    else { $_.CommandLine -notlike "*tabby-agentdeck-test*" }
}
$hwnd = [IntPtr]::Zero
foreach ($p in $want) {
    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        if ($Title -and $proc.MainWindowTitle -notlike "*$Title*") { continue }
        $hwnd = $proc.MainWindowHandle
        $found = $proc
        break
    }
}
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "no window"; exit 1 }

$r = New-Object Win32Shot+RECT
[void][Win32Shot]::GetWindowRect($hwnd, [ref]$r)
$w = $r.R - $r.L; $h = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][Win32Shot]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved=" + $Out + " size=" + $w + "x" + $h + " title=" + $found.MainWindowTitle)
