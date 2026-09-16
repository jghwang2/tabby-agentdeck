<#
.SYNOPSIS
  Claude Code 훅에서 AgentDeck 사이드바에 작업 상태를 통보한다.

.DESCRIPTION
  콘솔 제목을 `[AD:<status>] <라벨>` 형태로 바꾸면 AgentDeck 플러그인이 그것을 읽어
  사이드바 배지/라벨에 반영한다.

  왜 제목인가 — Windows 의 ConPTY 는 자기가 모르는 OSC 이스케이프를 삼켜서
  커스텀 시퀀스가 터미널까지 오지 못한다(2026-08-28 실측). 반면 콘솔 제목은
  ConPTY 가 API 로 변환해 전달하므로 확실히 통과한다.

.PARAMETER Status
  running(진행중) / waiting(승인대기) / limited(한도 도달) / done(완료) / error(오류) / idle(대기)

.PARAMETER Label
  사이드바에 함께 보일 작업 이름.

.EXAMPLE
  powershell -NoProfile -File agentdeck-status.ps1 -Status running -Label "결제 버그 수정"
  powershell -NoProfile -File agentdeck-status.ps1 -Status waiting -Label "배포 승인"
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('running', 'waiting', 'limited', 'done', 'error', 'idle')]
    [string]$Status,

    [string]$Label = ''
)

$title = if ($Label) { "[AD:$Status] $Label" } else { "[AD:$Status]" }
$host.UI.RawUI.WindowTitle = $title
Write-Output $title
