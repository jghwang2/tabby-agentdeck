# 계정 전환

사이드바 아래 계정명을 누르면 현재 탭과 같은 서비스의 계정만 표시됩니다.
각 계정에는 기존 하단 화면과 같은 5h·7d·모델별 사용률 막대와 리셋 시간이 표시됩니다.
`ctx`만 제외하고 같은 색상·퍼센트 기준으로 작게 표시합니다. 5시간 한도가 제공되지 않으면 생략합니다.
Astra는 서버에서 퍼센트 없이 사용 가능 여부만 제공하면 그 상태를 표시합니다.
조회 실패는 0%로 표시하지 않습니다. 계정 목록을 다시 열면 사용량을 다시 조회합니다.

계정 목록은 Windows 사용자의 `%USERPROFILE%\.agentdeck\accounts.json`에서 읽습니다.
`claude`와 `codex` 배열에 `name`(표시명), `id`(로그인 이메일)를 입력합니다.
빈 항목은 숨깁니다. 기존 `password` 항목은 로그인에 사용하지 않습니다.

최초 로그인 또는 인증 만료 시 기본 브라우저가 열립니다. 선택한 계정으로 로그인하고
추가 인증과 CLI 연결 승인을 완료하면 인증정보를 자동 저장합니다.
실제 로그인 계정이 선택한 이메일과 다르면 전환하지 않습니다.

인증정보는 각 항목의 `auth`에 Windows DPAPI로 암호화해 저장합니다.
암호화한 인증정보는 같은 Windows 사용자 계정에서 복원할 수 있습니다.
CLI가 직접 쓰는 인증 파일은 `.agentdeck\accounts\<계정 키>`에 계정별로 분리합니다.
사용 중인 CLI가 갱신한 인증정보를 예전 저장본으로 덮어쓰지 않습니다.
`auth` 항목은 직접 편집하지 않습니다. 다른 PC에서는 다시 로그인합니다.

계정을 선택하면 현재 대화를 선택한 계정의 새 탭으로 이어갑니다.
원래 탭은 유지하며, 작업이 진행 중이어도 계정을 선택할 수 있습니다.
설정은 계정 폴더로 복사하고 대화 기록과 스킬 디렉터리는 공유합니다.

## 검증

- `npm test`: 계정 파일 파싱·비밀번호 비노출·잔량 계산·로그인 주소 검증·암호화 저장/복원 포함.
- `tools/test-instance.ps1 -PluginRoot <별도 빌드 폴더> -Port 9238`: 실사용 빌드를 바꾸지 않는 격리 기동.
- `node tools/cdp.js 9238 tools/probe-accounts.js`: 서비스별 계정 필터·클릭 버튼·비밀번호 비노출·Esc 닫기.
- `tools/probe-account-login.js`: 격리 인스턴스에서 직접 로그인하는 수동 통합 검사.
  먼저 `window.__accountLoginProvider`와 `window.__accountLoginIndex`를 지정해야 합니다.
  결과는 `window.__accountLoginProbe`에 성공 여부만 남깁니다.

테스트 전용 계정 파일은 `AGENTDECK_ACCOUNTS_FILE`로 지정할 수 있습니다.
실제 비밀번호·인증 토큰은 테스트 출력이나 저장소에 넣지 않습니다.

## 커밋 규칙

실제 `account.json` / `accounts.json`은 git에서 제외합니다. 커밋할 템플릿은
`examples/accounts.example.json`처럼 모든 값을 비워 둡니다. 암호화된 인증정보도 커밋하지 않습니다.
`node tools/check-account-secrets.js`는 스테이징된 계정 파일을 검사하며 값이 있으면 실패합니다.
이 작업 저장소의 `.git/hooks/pre-commit`에도 연결되어 있습니다.
