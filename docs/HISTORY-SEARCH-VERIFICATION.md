# 지난 대화 검색 검증 — 2026-09-21

## 후속 UI 단순화

후속 요청으로 지난 세션 검색창도 현재 세션 검색창과 같은 `세션 검색 (제목 · 작업이름 · 폴더)` 문구 및 번역을 공유하도록 변경했다. 입력창만 남긴 구성은 유지하며 언어 변경 시 두 검색창의 문구가 함께 갱신된다. 타입 검사·staging 빌드·격리 UI 14개 검증 결과: `.tmp/history-label-ui.json`.

사용자 요청으로 입력창을 `식별자 검색`으로 짧게 표시하고 AI·기간·프로젝트 경로 필터를 모두 제거했다. 전체 출처/기간을 검색한다. 타입 검사와 별도 staging 빌드 후 격리 Tabby에서 입력창 단독 구성·검색·미리보기 등 변경된 UI 회귀 14/14를 확인하고 동일 번들을 실사용에 반영했다. 결과: `.tmp/history-trim-ui.json`. 아래 초기 구현 검증의 필터 관련 항목은 제거 전 기록이다.

## 범위

최근 탭 검색과 별도로 지난 세션 서랍에서 로컬 식별자를 검색한다. 대화 전체의 질문/답변 검색, 출처/프로젝트/기간 필터, 읽기 전용 대화 미리보기, 기존 세션 이어받기에 연결했다. 고정 슬롯과 세션 통신 변경이 같은 번들에 포함되므로 함께 검증한다.

## 자동 검사

- `npm test`: 기존 검사와 새 검색·통신·MCP 브리지 검사 통과.
- `npm run typecheck`: 통과.
- `test/sessionSearch.cjs`: 500줄 뒤 일치, Claude/Codex, 리터럴 특수문자·한글, 도구/시스템 텍스트 제외, 미리보기 문맥, 캐시 재사용/변경, 불완전 JSONL·삭제 파일·취소·서브프로세스 실행 확인. 최근 목록 200개 제한과 7일 제한을 적용한 상태에서도 90일 전 기록을 포함한 205개 모두 검색 가능.

## 격리 UI 재현

1. 별도 staging 경로로 webpack 빌드하고 package.json·hooks를 복사한다. 실사용 dist에 먼저 빌드하지 않는다.
2. `node tools/history-fixtures.cjs .tmp/history-fixtures`로 인조 기록을 만든다.
3. 그 출력의 `CLAUDE_CONFIG_DIR`, `CODEX_HOME`을 테스트 프로세스 환경으로 설정하고 `tools/test-instance.ps1 -PluginRoot <staging> -Port 9222`를 실행한다.
4. `node tools/cdp.js 9222 tools/probe-history.js` 실행: 검색 노출, 두 출처/뒤쪽 본문, 결과 중 최근 목록 숨김, 일치 문맥, HTML 무해 렌더링, 강조, 미리보기의 세션 비실행, 닫기 포커스, 출처/프로젝트 필터, 특수문자/한글, 빈 결과, 최신 질의 우선, 검색 해제 복원 등 15개 검사.
5. 검색창에 포커스를 둔 뒤 CDP `--keys "text:CheckDetectAbusing"`로 실제 키 입력도 확인한다.

최초 실제 UI 검사에서 Electron 렌더러의 Node Worker 미지원이 발견됐다. 별도 Node 프로세스 방식으로 수정한 뒤 UI 15/15 통과, 실제 키 입력 결과 2개를 확인했다. PATH에 Node.js가 필요하며 Tabby 실행 파일을 Node처럼 재실행하는 방식은 사용하지 않는다.

## 통합 회귀 및 반영

- 최종 staging 번들 전체 회귀: 166항목 중 최초 137 PASS / 5 FAIL / 24 SKIP. 한국어 문구를 기대하는 기존 검사 5개(ST1, R7, R16, R19, R51)를 실제 설정 UI에서 ko-KR로 바꾼 뒤 같은 번들로 재측정해 모두 PASS. 합산 최종 **142 PASS / 0 FAIL / 24 SKIP**. SKIP에는 별도 실행한 빌드/단위 검사, 실제 AI 세션·클립보드 등 격리 환경 조건이 없는 항목이 포함된다. SKIP을 통과로 계산하지 않았다.
- 최종 번들 검색 UI **15/15**, 실제 키 입력으로 `CheckDetectAbusing` 검색 결과 2개 확인. 실제 Tabby TCP 수신기·MCP 두 프로세스·PowerShell 훅 **12/12** 재통과. 고정 슬롯 UI는 별도 16개 검사 통과.
- 원본 회귀 결과: `.tmp/history-regression-raw.json`. 언어 재검사: `.tmp/history-status-ko.json`, `.tmp/history-core-ko.json`. 합산 근거: `.tmp/history-verification.json`. 검색/통신 최종 결과: `.tmp/history-ui-final.json`, `.tmp/mailbox-live-final.json`. 화면: `.tmp/history-search-final.png`.
- 검증 산출물을 재빌드 없이 실사용 `dist/index.js`에 복사했다. staging/실사용 SHA-256 모두 `391ac799dff36ed35ef3772ce1659ece999d4d777a9047a8d1990435affbb357`.
- 실사용 진단 로그: 2026-09-21 11:01:28 KST `reload go ... tabs=3`, 11:01:32 KST `reload restored tabs=3 dead=0`. 열린 세션 3개가 모두 복원됐다. 기존 번들은 `.tmp/history-live-before`에 보관했다.
- npm 배포·Git 커밋/푸시는 수행하지 않았다. 세션 통신용 MCP의 CLI 등록도 전역 설정을 변경하지 않았으며 [통신 안내](SESSION-COMMUNICATION.md)에 설정 방법을 기록했다.
