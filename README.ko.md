# tabby-agentdeck

[![npm](https://img.shields.io/npm/v/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![downloads](https://img.shields.io/npm/dm/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![CI](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/tabby-agentdeck)](LICENSE)

**[웹사이트](https://jghwang2.github.io/tabby-agentdeck/ko.html) · [사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html) · [전체 레퍼런스](docs/REFERENCE.ko.md) · [English](README.md)**

**Claude Code · Codex · Gemini CLI 를 탭 여러 개에 띄워 두고 쓰는 사람**을 위한 [Tabby](https://tabby.sh) 플러그인.
4:3 터미널, 상태가 실시간으로 보이는 세션 목록, 에이전트 결과물 미리보기 패널.
작업에 맞춰 자동으로 붙인 고정 별명으로 에이전트를 구분하고, 서로 다른 탭의 에이전트에게 작업과 결과를 주고받도록 요청할 수 있다.

![tabby-agentdeck — 터미널, 미리보기 패널, 세션 목록](docs/guide/img/00-full.png)

## 자동 작업 별명과 탭 간 에이전트 통신

한 탭에서는 구현하고, 다른 탭에서는 리뷰하거나 버그를 조사한다. 에이전트에게 **“화면에 표시된 별명의 탭에 조사 결과 전달해”**라고 요청할 수 있다. 에이전트는 최신 탭 목록에서 별명에 대응하는 실제 세션 ID를 조회해 전송한다. 별명은 사용자 환경마다 다르며, 문서의 예시를 실제 주소로 사용하지 않는다. 답장이나 수신 확인으로 전달 결과를 확인한다.

- **기존 제목은 첫 줄에, 별명은 아래 상태 앞에 표시한다.** 작업 제목과 프로젝트 경로를 기준으로 자동 배정한다. 처음 보는 프로젝트도 폴더명으로 구분한다. 제목에 명확한 프로젝트명이 나타나면 경로별로 로컬 설정에 저장해 이후 탭에 사용한다. 열린 탭의 별명은 유지하며, 새 탭은 사용하지 않는 가장 작은 번호를 재사용한다. 닫힌 탭의 번호가 재사용됐다면 그 탭을 복원할 때 빈 번호를 새로 배정한다. 프로젝트명과 경로를 소스 코드에 추가하지 않는다.
- **ABCD와 이동 번호는 표시하지 않는다.** `Ctrl+1` … `Ctrl+9`는 현재 보이는 위에서부터 해당 번째 탭으로 이동한다. 드래그로 순서를 바꿔도 별명과 통신 대상은 유지된다. 메시지는 확인한 정확한 세션 ID로 전송한다.
- **전송과 수신 확인은 구분한다.** 메시지를 보냈다는 것은 대기함에 넣었다는 뜻이며, 상대의 수신 확인이나 답장으로 읽었는지 확인한다. 메시지 알림이 켜져 있으면 입력 가능한 대기·완료 상태의 탭에 수신 안내를 자동 입력한다. 작업 중이거나 타이핑·한글 조합 중이면 기다린다. 안내 입력 성공도 수신 확정은 아니다. [알림 동작과 설정](docs/MAILBOX_WAKE.md)을 참고한다.

통신은 로컬 메시지함을 사용하며, 선택적으로 연결하는 MCP 또는 인증된 CLI 경로로 이용한다. 참여 세션에 지원되는 상태 훅과 등록이 필요하므로, 탭이 보인다고 바로 통신 가능한 것은 아니다. [연결 방법과 지원 동작](https://github.com/jghwang2/tabby-agentdeck/blob/main/docs/SESSION-COMMUNICATION.md)을 참고한다.

## 단축키

| 키 | 동작 |
|---|---|
| `Ctrl+T` (⌘+T) | 작업 루트에 새 탭 열기 (프로필이 여러 개면 선택) |
| `Ctrl+1` … `Ctrl+9` | 현재 화면 위에서부터 1~9번째 탭으로 이동 |
| `Ctrl+L` | 세션 목록에 포커스 / 같은 키로 터미널 복귀. 이어서 `↑↓` 이동, `Enter` 선택, `Esc` 나가기 |
| `Ctrl+W` | 지금 탭 닫기 (목록이 키보드를 가졌으면 포커스 줄) |
| `Ctrl+O` | 미리보기 패널 여닫기 |
| `Ctrl+R` | 화면 복구 (`↻` 와 같다). 탭 이름은 줄 더블클릭으로 변경 |
| `Ctrl+S` | 좌우로 분할 (Tabby 순정) |
| `Ctrl+D` | 위아래로 분할 (Tabby 순정) |
| `Ctrl+Q` | 포커스된 분할 패널 닫기 |
| `Ctrl+Enter` / `Shift+Enter` | 전송하지 않고 줄바꿈 |
| `Ctrl+V` | 붙여넣기. 클립보드에 이미지만 있으면 이미지로 에이전트에 넘긴다 |
| 우클릭 | 선택이 있으면 복사, 없으면 붙여넣기. 길게 누르면 컨텍스트 메뉴 |
| `Ctrl+F` / `Ctrl+S` | 미리보기 패널 안에서 찾기 / 저장 |

배정되지 않은 것은 둘: `agentdeck-toggle`(사이드바 / 4:3 즉시 on-off), `agentdeck-view-mode`(파일 ↔ 변경).
**설정 → AgentDeck → 단축키** 에서 바꾼다 — Tabby 순정이나 AgentDeck 이 이미 쓰는 키면 적용 전에 무엇과 겹치는지 알려 준다. Tabby 설정 → 단축키 → `agentdeck-*` 로도 된다.
위 표는 새 설치의 기본값이다. 기존 AgentDeck 단축키는 저장된 값을 유지하며, 각 항목의 **기본값** 버튼으로 새 키를 적용한다. 순정 분할 키 `Ctrl+Shift+S` / `Ctrl+Shift+D`는 `Ctrl+S` / `Ctrl+D`로 바꾸고, 직접 지정한 분할 키는 유지한다.

## 창 이동과 작업 루트

Windows의 얇은 창 테두리에서는 상단 제목 표시줄 전체를 드래그하여 창을 옮긴다. 더블 클릭하면 최대화하거나 복원하며, 일반 권한에서도 동작한다. 사이드바의 `AGENT DECK` 헤더는 사이드바 도킹 위치를 옮길 때 사용한다.

**설정 → AgentDeck → 추가 작업 루트 프로필 → 프로필 추가**에서 이름과 작업 폴더를 저장한다. 기존 작업 루트도 그대로 사용할 수 있다. **+ 새 탭** 또는 **Ctrl+T**를 누르면 프로필이 하나일 때는 그 폴더에서 바로 열린다. 두 개 이상이면 이름과 경로를 보고 선택하며, `Esc`로 취소한다. 프로필을 삭제해도 이미 열려 있는 탭은 유지된다.

## 지난 대화 검색

**지난 세션**을 펼치고 전용 검색창에 함수명·오류코드·파일명·세션 ID를 입력한다. 저장된 Claude·Codex 대화의 질문과 답변에서 대소문자 구분 없이 입력한 문자열 그대로 찾는다. 결과를 누르면 일치한 대화가 미리 열리고, **이어서 대화**를 눌러 재개한다. 현재 탭 검색과는 별도다.

검색은 로컬 Node.js 백그라운드 프로세스로 실행하고, 기록이 바뀌면 디스크 캐시를 갱신한다. PATH에서 Node.js를 실행할 수 있어야 한다. MCP 연결이나 AI 요청은 필요 없다. 도구 출력과 시스템 안내는 제외한다. 범위와 저장 위치는 [검색 안내](docs/HISTORY-SEARCH.md)를 참고한다.

## 설치

Tabby 안에서: 설정 → 플러그인 → `agentdeck` 검색 → 설치 → Tabby 재시작.
탭은 작업에 따른 고정 별명을 사용하며 드래그로 순서를 바꿀 수 있습니다. 숫자 이동키는 현재 화면 순서를 따릅니다.
선택적으로 연결하는 [세션 통신 MCP](docs/SESSION-COMMUNICATION.md)는 실제 세션 ID로만 송수신합니다. 사람용 번호는 MCP 주소가 아닙니다.

그 외 — 상태·미리보기 패널·diff 와 커밋·지난 세션 이어받기·설정 — 은
[사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html)와 [전체 레퍼런스](docs/REFERENCE.ko.md)에 있다.

Windows 에서 만들고 검증했다. MIT.
