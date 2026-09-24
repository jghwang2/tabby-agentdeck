# Codex Hook failed 분석 — 2026-09-23

## 판정

이번 실패의 원인은 현재 수집된 로그만으로 확정할 수 없다. 추가된 진단은 Python 호환 훅에만 적용되어 있으며, 별도로 실행되는 AgentDeck PowerShell 알림 훅은 기록 범위 밖이다. 알림 훅의 3초 제한은 조사 후보이지 확인된 원인이 아니다.

## 확인한 근거

- `E:/AIData/Codex/claude-compat/hook-timing/`의 실행별 기록 1,344개를 읽은 시점의 집계: stdin_begin/ stdin_end/ done 각각 1,344회, child_begin/child_end/child_finally 각각 946회. 기록된 자식 종료 코드의 비정상 값은 0건이었다. 조사 중에도 새 파일이 계속 생성되므로 집계는 고정 시점 값이다.
- 같은 시점의 최장 기록은 `1790147846434384600-34120.jsonl`: neo-mem Stop 훅 11,914ms, child_end returncode=0, done 기록. 내부 제한 20초, 등록 제한 30초 안에 종료했다. 다른 세션들의 기록은 현재 UI 탭 번호를 추정하는 데 사용하지 않았다.
- `E:/AIData/Codex/claude-compat/bridge.py:6`은 실행별 진단 파일 경로를 정한다. 이 진단은 해당 Python 프로그램 내부 실행만 관측한다. 프로세스 시작 전 실패와 호스트의 최종 성공 판정은 보장하지 않는다.
- `E:/AIData/Codex/hooks.json`에서 AgentDeck의 UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/Stop/Interrupt/SessionEnd는 `agentdeck-codex-notify.ps1`을 직접 실행하며 timeout=3으로 등록되어 있다.
- `D:/Project/tabby-agentdeck/hooks/agentdeck-codex-notify.ps1:25`의 catch는 오류를 기록하지 않고 exit 0으로 끝난다. 외부 시간 제한으로 프로세스가 종료되면 이 catch도 근거를 남기지 못한다.
- `D:/Project/tabby-agentdeck/hooks/agentdeck-notify.ps1:221`은 조건부 프로세스 계보 조회를, 392행은 조건부 Node mailbox 호출을 수행한다. mailbox 소켓 제한은 `hooks/agentdeck-mailbox.mjs:44`의 1초다. 실제 실패 당시 어느 단계에서 지연됐는지는 기록이 없다.
- `C:/Users/junggon/.agentdeck-screen.log:17807`에는 `• Hook failed`가 있다. 이 파일의 최종 수정 시각은 16:00:47이므로 사용자 제보의 최신 발생과 동일 사건이라고 단정할 수 없다.
- Codex SQLite 로그의 hook/started, hook/completed 알림은 확인되지만 해당 메시지는 실행 결과나 실패 이유를 포함하지 않았다. 과거 화면 기록만으로 현재 실패 탭을 특정하지 않았다.

## 격리 실행 검증

실사용 세션과 분리된 임시 runtime/mailbox 및 `diagnostic-isolated` 식별자로 같은 알림 훅을 실행했다. 실사용 탭에 메시지를 보내지 않았다.

| 이벤트 | 소요 시간 | 종료 코드 | stderr | 상태 파일 |
| --- | ---: | ---: | ---: | --- |
| UserPromptSubmit | 957ms | 0 | 0 bytes | running |
| PreToolUse | 922ms | 0 | 0 bytes | running |
| PostToolUse | 1178ms | 0 | 0 bytes | running |
| Stop | 1093ms | 0 | 0 bytes | done |

상태 파일 위치: `C:/Users/junggon/AppData/Local/Temp/agentdeck-hook-analysis-r1u5cy95/status/diagnostic-isolated.json`.

이번 격리 환경에서는 3초 제한 초과가 재현되지 않았다. 실사용 mailbox 통신 및 실제 동시 실행 부하까지 검증한 결과는 아니다. 최초 측정에서는 분석용 Python 출력 디코더가 CP949 예외를 내어, 위 표는 바이트 캡처로 재검증한 결과만 사용했다.

## 수정 또는 추가 관측 위치

확정되지 않은 원인을 전제로 timeout을 변경하지 않았다. 다음 관측 보강 지점은 `agentdeck-codex-notify.ps1`의 진입/stdin 수신/공유 알림 호출 전후/catch, 그리고 `agentdeck-notify.ps1`의 프로세스 조회 및 mailbox 호출 전후다. 실행별 파일에 시각, 이벤트, 세션, 단계, 소요 시간, 오류만 기록하면 Python 진단과 대조할 수 있다. 프롬프트와 도구 본문, 인증 정보는 기록하지 않아야 한다.

이번 작업은 분석과 격리 실행이며 제품 코드·설정 변경, 빌드, 배포, 핫리로드를 수행하지 않았다.
