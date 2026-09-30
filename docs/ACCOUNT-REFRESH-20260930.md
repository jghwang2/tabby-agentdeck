# 계정 자동 갱신 정책 (2026-09-30)

- Codex·Claude 모두 평소에는 로컬 인증정보를 확인하고 만료 5분 전부터 갱신한다.
- Codex는 JWT access token의 만료 시각을 사용한다. 불투명 토큰은 `last_refresh + 8일`을 기준으로 한다. 실제 갱신 시에만 공식 app-server의 `account/read {refreshToken:true}`를 사용한다.
- 첫 실패부터 1분 간격으로 최대 5분 동안 재시도한다. 이후 인증·사용량 자동 점검을 중단한다.
- 중단 상태는 계정별 파일에 보존한다. 재시작이나 강제 조회로 해제되지 않으며, AgentDeck에서 동일 계정의 새 로그인이 성공해야 해제된다.
- 계정 선택 화면에 `재로그인 필요 · 자동 점검 중단`을 표시한다. 현재 계정도 이 상태에서는 클릭하여 다시 로그인할 수 있다.

공식 참고: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [managed authentication](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

## 검증

- `npm test`, `npm run typecheck`: 통과.
- 정책 테스트: 두 제공자에 대해 5분 경계, 재시작 후 중단 유지, 정상 재시도 성공, 새 로그인 초기화, 이전 요청의 뒤늦은 실패 무시.
- 모의 Codex 프로토콜 테스트: 평상시 프로세스 실행 없음, 실제 갱신 요청의 `refreshToken:true`, 프로세스 종료, 잘못된 계정 로그인은 중단 해제 불가. 실제 OAuth 서비스 갱신을 검증한 것은 아니다.
- 최종 staging 빌드의 격리 앱: 87,361ms 관찰, Codex 실행 0회, 인증정보 암호화 저장 성공.
- 격리 앱 계정 선택 DOM: 5분 경과 상태가 디스크에 중단으로 기록되고 `재로그인 필요 · 자동 점검 중단` 표시 확인.
- 산출물: `.tmp/account-refresh-stage/dist/index.js`, SHA256 `D998AE34FAB2F0D6E8F2D9C26C0163DD5EF2E3170250F2C758CB3D3576DC620D`.
- 재현 도구: `tools/probe-account-background.js`, `tools/probe-account-blocked.js` (격리 앱 전용).
- 전체 격리 회귀: 176항목 중 PASS 160 / FAIL 0 / SKIP 16. SKIP에는 별도 수행한 빌드·단위검사, 이미지 클립보드·실제 Claude 세션·격리 훅 설정이 필요한 항목이 포함된다. 상세 결과는 `.tmp/account-refresh-regression/report/regression.json`.
- 동일 SHA256 산출물을 실사용 `dist/index.js`에 반영하고 핫리로드 완료. `C:/Users/junggon/.agentdeck-diag.log`: `2026-09-30T06:24:28.554Z reload restored tabs=3 dead=0 ms=2641`.
