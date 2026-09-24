# 새로고침·리로드 성능 수정 및 적용 검증

2026-09-23. 사용자 요청에 따라 격리 성능 시험 후 동일 빌드를 실사용 Tabby에 반영했다. 커밋/푸시는 하지 않았다.

## 수정 범위

- `src/agents.ts`: 승인 선택지의 중첩 공백 탐색을 제거하고 공백을 줄 내부로 제한했다. 공백 재그리기에서 발생하던 수십 초 역추적을 해소했다.
- `src/viewer.ts`: 경로 후보를 토큰 단위로 한 번만 검사하고, 점 없는 토큰은 즉시 제외한다. 같은 긴 문자열의 모든 접미사를 반복 검사하지 않는다.
- `src/performance.ts`, `src/deck.service.ts`, `src/reload.service.ts`: 단계별 시간과 타이머 지연을 기록한다. 터미널 내용·복구 토큰은 새 성능 로그에 기록하지 않는다.
- `test/performance.cjs`, `package.json`: 큰 공백 프레임/경로 비매치와 정상 승인·파일 경로를 검증하는 회귀를 추가했다.
- `tools/probe-resume.js`: 같은 제목의 다른 세션 때문에 숨기기 테스트가 거짓 실패하던 판정을 고쳤다. 세션 ID로 숨김을 확인하고 남은 전체 DOM 목록을 대조한다.

## 성능 실측

| 항목 | 결과 |
|---|---|
| 경로 아닌 16KB 문자열, 순수 함수 | 변경 전 964.12ms → 변경 후 0.12ms |
| 격리 Tabby: 5탭, 각 약 1만 줄 기록, 공백 280×78 프레임과 Ctrl+R 5회 | 출력 전달 7.4~10.8ms, 최대 UI 타이머 지연 28.9ms |
| 격리 Tabby: 실제 Ctrl+R 키 입력 | 5개 탭의 PTY 크기 복원까지 최대 93.8ms, 복원 타이머 추가 지연 0.8~1.8ms |
| 격리 Tabby: 리로드 3회 | 요청부터 완료까지 3,493 / 3,373 / 3,298ms |
| 격리 리로드 후 상태 | 5개 PTY ID 유지, 모두 open, 5개 셸에서 확인용 명령 출력 수신 |
| 실사용 Tabby: 적용 및 추가 리로드 3회 | 요청 시각 또는 구버전 stash 시각부터 완료까지 4,775 / 4,488 / 4,559ms |
| 실사용 복구 루프 자체 | 2,958 / 2,919 / 2,963ms |
| 실사용 보존 | 매회 tabs=4, dead=0. 적용 전 확인한 Claude/Codex 프로세스 8개 모두 생존 |

변경 전 실사용 로그에는 `2026-09-23T07:56:07.969Z reload restored tabs=5 dead=0 ms=69760`이 있었다. 당시와 현재의 탭 수/출력 부하는 다르므로 통제된 속도 향상 배수로 해석하지 않는다. 이전 승인 정규식의 통제된 재현은 `CTRL_R_PERFORMANCE_2026-09-23.md`에 기록돼 있다.

실사용 첫 적용은 구버전에서 복구 정보를 저장했으므로 첫 수치의 기준은 구버전 stash의 `at`이다. 후속 2회는 새 `requestedAt`을 사용한다.

## 검증 결과

- `npm run typecheck`: 통과.
- 기존 `npm test`: 종료 코드 0. 기존 전체 단위/프로세스 테스트 통과.
- 신규 `npm run test:performance`: 통과. 기본 npm test에도 편입.
- 실제 격리 승인 표시 프로브: 10/10 통과.
- 전체 UI 회귀 원본 결과: 166개 결과 행, PASS 144 / FAIL 1 / SKIP 21. 유일한 실패 RS9는 같은 제목을 가진 다른 세션을 구분하지 못한 검사 오류였다.
- RS9 판정 수정 후 해당 프로브 재실행: PASS 9 / FAIL 0 / SKIP 1. 원본 전체 결과의 RS9를 재검사 결과로 대체하면 PASS 145 / FAIL 0 / SKIP 21이다. 원본 실패 결과를 지우지 않았다.
- SKIP에는 별도로 이미 수행한 빌드/단위 검사, 후속 단계에서 별도 통과한 중복 자리표시자, 이미지 클립보드, 라이브 세션/서브에이전트 훅 매칭, 다중 그룹 키보드 항목 등이 포함된다. 모든 환경 조건을 전수 통과했다고 보고하지 않는다.

공용 테스트 설정이 다른 진단 작업과 겹친 최초 실행은 중단했다. 최종 전체 UI 회귀는 `tabby-agentdeck-test-perf-gate`, CDP 9249를 사용했고, 성능 반복 시험은 `tabby-agentdeck-repairperf`, CDP 9247을 사용했다. 시험용 앱은 종료했다.

## 실제 적용 확인

검증한 `.tmp/performance-stage/dist/index.js`를 재빌드 없이 `dist/index.js`로 복사했다. 소스맵도 동일 산출물을 복사했다. 다른 작업에서 수정 중인 훅 파일은 이 적용으로 덮어쓰지 않았다.

SHA-256: `7FA9A4B0F43445F716BFAE5DE8E92E7B208FF2F84B5C9390D3F991B055B31E9A`

이전 번들: `.tmp/performance-before/dist/index.js` (SHA-256 `A7BA04C0C76E6AA27F24F13126684E3774058C9CB6F182162D679C38797D16DD`).

실사용 로그 근거:

- `2026-09-23T08:20:58.224Z ... stage=complete ... tabs=4 dead=0 sinceRequestMs=4775`
- `2026-09-23T08:23:42.502Z ... stage=complete ... tabs=4 dead=0 sinceRequestMs=4488`
- `2026-09-23T08:24:09.106Z ... stage=complete ... tabs=4 dead=0 sinceRequestMs=4559`

## 새 진단 읽는 법

실사용 로그는 `C:/Users/junggon/.agentdeck-diag.log`다. 동일 `id`로 한 작업을 묶는다.

- `perf op=reload-save`: token → encode → storage → scheduled.
- `perf op=reload-restore`: decode → renderer-ready → pty-check → recover-token → open-tab → attached → settled → repair-requested → complete.
- `perf op=repair`: layout → frames-ready → screen-read → fit-and-sync → clear-and-refresh → pty-restored → after-snapshot.
- `stepMs`: 직전 기록 뒤 경과. `totalMs`: 해당 작업 시작 뒤 경과. `workMs`: 감싼 동기 작업 시간.
- `timerLagMs`: 원래 60ms 뒤 돌아와야 하는 PTY 크기 복원의 추가 지연.
- `perf op=event-loop lagMs=...`: UI 타이머가 250ms 이상 늦은 경우. 최대 5초에 한 줄이며 창 가시성도 기록한다. 원인 함수 자체를 특정하는 CPU 프로파일은 아니다.

## 한계와 남은 항목

실사용 창에 자동 Ctrl+R을 보내는 시도는 Windows 포커스 획득 실패로 키를 보내기 전에 중단했다. 실제 키 입력은 격리 앱에서 검증했고, 실사용에서는 리로드가 호출하는 동일 repair 경로와 복원 시간을 측정했다.

실사용 진단에는 간헐적인 276~452ms 이벤트 루프 지연도 남아 있다. 모든 비효율이 제거된 것은 아니다. 기록 동기 읽기, 중복 출력 구독, 백그라운드 스캔/폴링 등 `PERFORMANCE_REVIEW_2026-09-23.md`의 나머지 후보는 이번 수정에 포함하지 않았다.

## 재현 결과 파일

- `.tmp/performance-refresh.json`: 5회 출력/새로고침과 단계 로그.
- `.tmp/performance-reload-{1,2,3}.json`, `.tmp/performance-alive.json`: 리로드 및 실제 셸 응답.
- `.tmp/performance-approval.json`: 승인 UI 결과.
- `.tmp/performance-gate.log`, `.tmp/performance-gate-reconciled.json`, `.tmp/performance-resume-recheck.json`: 전체 회귀와 판정 수정 후 재검사.
- `.tmp/performance-unit.log`, `.tmp/performance-build.log`, `.tmp/performance-typecheck.log`: 빌드 및 정적/단위 검증.
