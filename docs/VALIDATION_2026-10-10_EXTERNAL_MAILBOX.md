# 외부 터미널 세션 통신 검증

기존 설치본은 탭 환경변수가 없는 외부 CLI를 `Start this MCP server inside an AgentDeck session`으로 거부했다.
기존 `test/mailboxBridge.cjs`의 `plainEnv`는 `AGENTDECK_TAB:'plain-pane'`과 미리 생성한 인증 파일을 사용했다.
따라서 MCP가 없는 **탭 내부 CLI** 검증이었으며, 외부 터미널 최초 연결을 검증한 것이 아니었다.

## 변경 동작

- 외부 세션의 첫 유효한 `send`가 인증 정보와 메시지를 함께 등록한다. 등록 전 수신/답장만으로는 등록하지 않는다.
- 이후에는 받은 `fromSessionId`로 신규 메시지를 보내거나 받은 메시지 ID로 답장한다. UI 탭/별칭 조회는 필요 없다.
- 외부 세션은 자기 인증 정보만 사용한다. 인증 파일 저장은 수신기가 맡으므로 외부 CLI에 런타임 폴더 쓰기 권한을 요구하지 않는다. 다른 세션 ID 점유, 잘못된 인증 정보, 다른 수신함의 답장은 거부한다.
- 프로세스/수신기 재시작 후 동일 인증 정보와 세션 ID로 이어받는다. 재전송은 원래 메시지 한 건을 돌려준다.
- 외부 PowerShell 훅에서도 수신 대기를 알린다. Windows PowerShell의 UTF-8 BOM 포함 JSON 인자를 허용한다.
- 기존 답장 변경분과 다른 미커밋 변경은 보존했다.

## 실제 검증

증거 폴더: `E:/project/agentdeck-external-20261010`.

- `baseline-external.log`: 설치본에서 탭 환경변수를 제거한 CLI 실패 재현.
- `unit-verified.log`: 최종 수정본 `npm test` 전수 통과.
- `typecheck.log`, `build-final.log`: 타입 검사 및 별도 staging 릴리스 빌드 통과.
- `external-probe-verified.json`: 실제 격리 Tabby 수신기와 별도 Node/PowerShell 프로세스 간 **42개 검사 통과**.
  외부 최초 전송 → 탭 수신 → 외부 답장 수신 → 학습한 세션 ID만으로 신규 전송 → 외부 재답장 → 탭 수신을 확인했다.
  수신함 데이터, 중복 메시지 수, 완료 시각을 디스크에서 직접 조회했다.
  외부 프로세스에는 `AGENTDECK_TAB`을 넣지 않았고 서버 인증 정보도 사전 등록하지 않았다.
- 첫 전체 회귀에서 외부 훅의 중복 상태 기록 문제(HK3)를 발견했다. 수신함 조회를 분리하여 상태 파일을 다시 쓰지 않고도 메시지를 받도록 수정했다.
  `hooks-probe-final.json`에서 훅 8개 통과·실패 0개·환경 조건에 따른 제외 1개를 확인했다.
  외부 통신 프로브에도 중복 훅에서 수신 알림 유지 및 상태 파일 내용 불변 검사를 추가했다.
- `tabby-agentdeck-test-verified/report/regression.json`: 최종 산출물 전체 앱 회귀 176개 중 **168 통과, 실패 0, 제외 8**.
  제외 내역은 별도 실행한 빌드/단위 테스트 2개, 이미지 클립보드 2개, 실제 Claude 세션 1개,
  Git 작업 폴더 조건 1개, 합격 기준 없는 성능 관측 2개다. 제외 항목을 통과로 집계하지 않았다.
- 위 초기 검증은 실제 CLI 어댑터·PowerShell 훅·Tabby 수신기 경로를 실행했다. 이후 아래의 실제 Codex 장시간 대화를 추가로 실행했다.

## 제한 샌드박스와 반영 상태

현재 작업 도구는 제한 없는 권한 프로필에서 실행 중이다. 위 격리 앱 결과는 Windows 제한 샌드박스 성공을 의미하지 않는다.

별도 제한 실행 명령:

```powershell
codex sandbox -P :workspace -C E:/project powershell.exe -NoProfile -File E:/project/agentdeck-external-20261010/sandbox-probe.ps1
```

`sandbox.log` 원문: `windows sandbox failed: helper_unknown_error: setup refresh had errors`.
설정 로그에는 `node_repl.exe`의 읽기/실행 접근 검증 중 다른 프로세스가 파일을 사용하고 있다는 `os error 32`가 기록됐다.
이 초기 시도는 자식 명령 기동 전에 실패했다. 이후 테스트 프로세스의 앱 데이터 경로를 분리해 동일한 제한 정책으로 재검증했다.
설정 파일 변경, 보안 정책 완화, 실행 중인 다른 세션 종료는 하지 않았다.

## 실제 Codex 10회 왕복 — 99분 8초 통과

- `sandbox-chat/result.json`, `summary.json`, `transcript.txt`: 2026-10-10 11:04:33~12:43:41 KST, 실제 Codex 두 세션이 **10회 왕복, 20개 전송·수신·처리 완료**했다. 총 소요는 5948.032초다.
- 첫 메시지를 제외한 답장 19개마다 `crypto.randomInt(60, 601)`로 지연을 뽑았다. 배정 범위는 82~568초, 실측은 83.748~569.066초였다. 테스트 시간을 줄이거나 시계를 앞당기지 않았다.
- 두 모델이 수신한 한국어 본문을 읽고 매번 직접 다음 본문을 작성했다. 시험 도구는 운송·지연·검증만 담당했다. 직전 메시지의 nonce를 정확히 이어받는지도 검사했다.
- 외부 Codex가 첫 메시지를 보냈고, 이후에는 수신한 `fromSessionId`와 `replyTo`로만 주소를 결정했다. 외부 프로세스에는 `AGENTDECK_TAB`이 없었고 인증 파일을 미리 만들지 않았다.
- Tabby 참가자는 실제 격리 앱의 터미널에서 기동했다. 실행기가 실제 Codex `thread.started`의 ID로 기존 등록 훅을 호출했다. 외부 참가자는 별도 PowerShell에서 기동한 CLI이며 Windows Terminal GUI 자체를 자동화한 검증은 아니다.
- `sandbox-chat/permissions.json`: 양쪽 모두 실제 실행 기록의 `workspace-write`, `network_access:false`, `approval_policy:never`를 확인했다. 두 모델의 셸에서 `CodexSandboxOffline` 계정, 각 작업 폴더의 새 하위 폴더 생성·파일 쓰기·재조회를 확인했다.
- 공용 CUA 런타임의 파일 잠금은 테스트 프로세스에 한정한 `LOCALAPPDATA` 분리로 피했다. 기존 사용자 인증을 유지하고 `--ignore-user-config`와 제한 정책을 명시했다. 사용자 전역 설정과 보안 정책은 수정하지 않았다. 공용 앱 데이터 경로를 쓰는 원래 환경의 잠금 문제가 해결됐다는 뜻은 아니다.
- `sandbox-chat/health.jsonl`: 처음부터 끝까지 세션 ID 두 개와 Codex PID 두 개가 동일했다. 두 모델은 마지막 메시지 처리 후 각각 정상 종료했다. 오류·누락·중복은 0건이다.
- 수신기의 저장소를 직접 조회하여 메시지 20개, 읽음·완료 시각 20개, 본문·수신자·답장 연결 일치를 확인했다. 테스트 도구의 성공 응답만으로 판정하지 않았다.
- 이 검증은 CLI의 명시적 수신 조회를 사용한다. 영구 TCP 소켓 유지나 아무 도구도 실행하지 않는 외부 모델의 자동 깨우기를 검증한 것은 아니다. 격리 수신기 경로는 환경변수로 지정했다.
- 이전 전체 회귀에 사용한 `stage-final`의 세 파일 SHA-256이 장시간 대화 후에도 동일했다. 실제 대화 도구·본문·실행 기록은 소스 저장소 밖의 증거 폴더에만 둔다.

## 실사용 설치 반영 및 외부 에이전트 안내

2026-10-10 14:07 KST에 사용자의 실사용 반영 지시로 검증한 동일 파일 3개를 실제 설치 경로에 복사했다.
기존 파일은 `installed-backup-20261010-140722`에 보관하고, 교체 전·후 SHA-256을 `deployment.json`에 기록했다.
빌드나 패키지 재설치로 검증 산출물을 바꾸지 않았다.

- 실제 설치 경로를 사용하는 새 격리 앱에서 `installed-probe.json`의 42개 통신 검사를 다시 통과했다.
- `E:/project/AGENTDECK-QUICKSTART.txt`에 현재 수신기 경로, 실제 상대 세션 확인, 최초 전송, 응답 대기, 답장·완료 순서를 적었다.
- 실행 도구는 `E:/project/agentdeck-chat.mjs`다. 최초 PowerShell 도구가 제한 환경의 실행 정책에 막혀 Node 방식으로 바꿨다. 실행 정책을 변경하지 않았다.
- 새 실제 Codex가 제한 샌드박스에서 안내서를 읽고 전송 → 대기 → 51.372초 후 답장 수신 → 재답장 → 완료 표시 → 빈 수신함 대기까지 실행했다.
  `guide-node-test/result.json`에서 실제 설치 클라이언트 사용, 메시지 3개와 완료 3개를 확인했다. 응답하는 쪽은 격리 앱의 시험 수신자였으며, 두 실제 모델의 장시간 대화 검증과 구분한다.
- 기존 실사용 앱과 작업 세션은 종료하지 않았다. 실행 중인 앱의 핫리로드는 하지 않았으므로 사용자가 AgentDeck을 트레이까지 완전히 종료한 후 다시 실행하면 새 수신기가 로드된다. 새 탭만 여는 것과 구분한다.
- 실제 세션 정보가 포함된 내 자리용 안내서·실행 도구와 대화 원문·인증 정보는 로컬에만 보관한다. 저장소에는 통신 사용법과 검증 요약을 남긴다.
