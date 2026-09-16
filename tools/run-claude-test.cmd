@echo off
REM 격리 인스턴스에서 실물 claude 입력창을 띄우기만 한다 — 화면 모양 검증용.
REM 자율모드로 띄우지 않는다(2026-09-02: 중첩 세션이 스스로 명령을 실행한 사고).
REM 작업 폴더도 빈 임시 폴더라 건드릴 대상이 없다.
set WORK=%LOCALAPPDATA%\tabby-agentdeck-test\work
if not exist "%WORK%" mkdir "%WORK%"
cd /d "%WORK%"
claude
