# 알림 훅 단계별 진단

`agentdeck-codex-notify.ps1`과 공용 `agentdeck-notify.ps1`은 같은 프로세스의 실행을 하나의 JSONL 파일에 기록한다. helper는 `hooks/agentdeck-hook-trace.ps1`이다.

작업 중 다른 작업자가 추가한 일별 `runtime/hook-diag/hook-YYYYMMDD.log` 진단도 보존했다. 그 로그는 기존 형식으로 계속 기록하며, 실행별 JSONL은 단계의 시작·끝과 강제 종료 흔적을 보강한다. 양쪽 기록의 PID로 대조할 수 있다. 일별 로그의 예외 메시지는 입력 내용 유출을 막기 위해 예외 타입으로 기록하도록 조정했다.

## 경로와 읽는 법

상태 파일과 동일한 runtime 아래에 `hook-timing/<UTC 날짜>/<UTC 시각>-<PID>-<임의 ID>.jsonl`이 생긴다. `AGENTDECK_RUNTIME_ROOT`가 없으면 기존 알림 훅과 동일하게 계정 저장 위치와 Tabby 프로필로 경로를 계산한다. stdout/stderr에는 진단을 출력하지 않는다.

각 줄에는 UTC 시각, PID, 단계, 시작 이후 밀리초, 알려진 이벤트 이름, UUID 형태의 세션 식별자가 들어간다. 프롬프트, 도구 입력, 메시지 본문, 토큰, 원문 예외 메시지는 기록하지 않는다. 오류는 예외 타입, HRESULT, 오류 분류, 스크립트 줄 번호로 남긴다.

주요 단계:

- `wrapper_enter`, `stdin_begin/end`, `parse_begin/end`: Codex 래퍼 시작과 입력 수신·해석.
- `transport_begin/end`, `notify_enter/end`: 공용 알림 호출 전후.
- `status_dir_begin/end`, `ancestry_begin/end`: 상태 폴더 준비와 프로세스 계보 확인.
- `state_write_begin/end/error`: 상태 파일 저장.
- `tcp_begin/sent/timeout/error/end`: 즉시 알림 전송.
- `mailbox_begin/end`: mailbox 자식 실행. `exit_code`로 자식 종료 상태를 확인한다.
- `skip`: 이벤트 미지원, 세션 누락, 이미 실행 중, 유휴 알림 등 기존 조기 종료 사유.
- `wrapper_error`, `wrapper_end`: 래퍼 오류와 종료. 오류 후에도 기존처럼 정상 종료 코드를 유지하므로 오류 단계도 함께 확인한다.

마지막 줄이 `*_begin`이고 대응하는 종료 줄이 없으면 해당 단계 도중 중단된 후보이다. 그것만으로 시간 초과라고 확정하지 않는다. 호스트 강제 종료, 수동 중단, 진단 저장 실패도 가능하다. PowerShell 프로세스가 시작되기 전 실패나 스크립트 구문 오류는 이 로그가 관측하지 못할 수 있다. runtime 폴더 자체에 접근할 수 없으면 진단 기록을 포기하고 원래 훅 동작을 계속한다.

Codex의 기존 3초 훅 제한은 변경하지 않는다. 파일은 실행마다 독립적이므로 동시 호출이 섞이지 않으며, 매 단계 쓰기를 닫아 강제 종료 이전 기록을 보존한다. 자동 삭제는 하지 않으므로 장기 운영 시 이 진단 폴더도 로그 보관 정책에 포함한다.

## 검증

`node test/hookTrace.cjs`는 독립 runtime에서 7개 정상 이벤트의 상태 파일과 단계 기록, 잘못된 JSON, 세션 누락, 진단 저장 불가, 상태 저장 실패, TCP 오류, mailbox 자식 실패, stdin 수신 중 강제 종료를 확인한다. 오류 입력에 넣은 민감 정보 표식이 로그에 없는지도 검사한다.

PowerShell 훅은 매 호출마다 디스크에서 읽으므로 파일 반영 후 다음 호출부터 적용된다. 앱 번들 재빌드나 실사용 앱 재시작은 필요하지 않다.

## 2026-09-23 검증 기록

- `npm run test:hook-trace`: 14개 통과. 최종 실행의 최대 측정 시간은 1,019ms. 로그 저장 불가에서도 정상 상태 파일이 생성됐고, stdin 수신 중 강제 종료에서는 `stdin_begin`이 마지막 기록으로 남았다.
- 기존 단위 검사의 러너 집계: 1,712 passed / 0 failed.
- 최초 전체 격리 회귀: 166개 중 139 통과, 8 실패, 19 제외. 화면 레이아웃·프로필 복구에서 실패가 나와 이전 훅과 비교하고 해당 항목을 재검증했다. 최초 전체 실행을 전부 통과했다고 해석하지 않는다.
- 이전 훅 비교 실행: 63개 중 53 통과, 0 실패, 10 제외.
- 수정된 훅을 동일 번들과 사용한 관련 항목 재검증: 72개 중 61 통과, 1 실패, 10 제외. 최초 실패했던 화면·복구 8개는 모두 통과했다. 남은 1개는 앞선 중단 검사에서 남긴 빈 `ad-hk-*` 임시 폴더를 감지한 정리 검사였다. 해당 폴더는 삭제하지 않고 staging 증거 폴더로 옮겼다.
- 최종 실제 훅 프로브 재실행: HK1~HK9 모두 통과(9/9, 제외 0). 상태 반영·인코딩·예외 입력·정리까지 확인했다.
- 중간 재검증에서 격리 앱 연결이 끊긴 결과는 통과 근거로 사용하지 않았다. 마지막 탭을 닫아도 창을 유지하는 설정은 격리 검증 앱에만 적용했다.

증거:

- `D:/Project/ad-hook-diagnostics-stage-20260923/.tmp/hookdiag-focused.log`
- `C:/Users/junggon/AppData/Local/Temp/agentdeck-hookdiag-regression/regression.json`
- `C:/Users/junggon/AppData/Local/Temp/agentdeck-hookdiag-final-regression/regression.json`
- `D:/Project/ad-hook-diagnostics-baseline-20260923/hook-probe-final.json`

동시 변경을 병합한 최종 파일도 재검증했다: 진단 14/14 통과(최대 1,341ms), 실제 앱 훅 HK1~HK9 9/9 통과. 기존 일별 로그와 실행별 로그를 함께 검사해 민감 정보 표식이 없는 것을 확인했다. 최종 근거는 `.tmp/hookdiag-merged.log`와 `D:/Project/ad-hook-diagnostics-baseline-20260923/hook-probe-merged.json`이다.

제품 변경은 훅 3개, 진단 테스트, 테스트 명령 등록, 이 문서에 한정한다. 실사용 앱 번들과 설정은 변경하지 않는다.

## 실사용 반영 확인

2026-09-23 17:16 KST, 현재 세션 `01a0cd14-88f8-7dc0-be29-d9ec455e6a28`의 실제 PreToolUse/ PostToolUse 실행이 `wrapper_end`까지 기록되는 것을 확인했다. PostToolUse는 상태 저장·TCP·mailbox 종료까지 기록됐으며 356ms였다. 설치 훅 파일은 줄바꿈까지 격리 검증본과 동일하게 반영했다.

실제 로그 폴더: `E:/AIData/AgentDeck/.agentdeck/runtime/8c3537740c9563cc/hook-timing/2026-09-23/`.

`081532929-35580-deabb73fedc644c1953a49efb137300b.jsonl`에서는 마지막 단계가 `mailbox_begin`(277ms)이며 대응 종료 기록이 없었다. 이후 해당 PID가 없는 것도 확인했다. 다른 PostToolUse 실행들은 정상 종료했다. 중단 위치를 좁히는 근거이며, 이 기록만으로 호스트 시간 초과나 원래 제보와 동일 사건이라고 확정하지 않는다.
