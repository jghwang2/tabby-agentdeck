param([int]$TargetProcessId = 16368, [int]$Repeat = 3)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AgentDeckPerfWindow {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
}
'@
$target = Get-Process -Id $TargetProcessId
if ($target.ProcessName -ne 'Tabby' -or $target.MainWindowHandle -eq 0) { throw 'Target is not a Tabby window' }
$original = [AgentDeckPerfWindow]::GetForegroundWindow()
$keys = New-Object -ComObject WScript.Shell
try {
    [void][AgentDeckPerfWindow]::ShowWindowAsync($target.MainWindowHandle, 9)
    [void]$keys.AppActivate($TargetProcessId)
    [void][AgentDeckPerfWindow]::SetForegroundWindow($target.MainWindowHandle)
    Start-Sleep -Milliseconds 300
    if ([AgentDeckPerfWindow]::GetForegroundWindow() -ne $target.MainWindowHandle) { throw 'Tabby did not receive focus; no key sent' }
    for ($i = 0; $i -lt $Repeat; $i++) {
        if ([AgentDeckPerfWindow]::GetForegroundWindow() -ne $target.MainWindowHandle) { throw 'Focus changed; stopped sending keys' }
        $keys.SendKeys('^r')
        Start-Sleep -Milliseconds 1500
    }
    Write-Output "Ctrl+R sent $Repeat times to Tabby PID $TargetProcessId"
} finally {
    [void][AgentDeckPerfWindow]::SetForegroundWindow($original)
}
