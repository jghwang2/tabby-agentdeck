# tabby-agentdeck

[![npm](https://img.shields.io/npm/v/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![downloads](https://img.shields.io/npm/dm/tabby-agentdeck)](https://www.npmjs.com/package/tabby-agentdeck)
[![CI](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/jghwang2/tabby-agentdeck/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/tabby-agentdeck)](LICENSE)

**[웹사이트](https://jghwang2.github.io/tabby-agentdeck/ko.html) · [사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html) · [전체 레퍼런스](docs/REFERENCE.ko.md) · [English](README.md)**

**Claude Code · Codex · Gemini CLI 를 탭 여러 개에 띄워 두고 쓰는 사람**을 위한 [Tabby](https://tabby.sh) 플러그인.
4:3 터미널, 상태가 실시간으로 보이는 세션 목록, 에이전트 결과물 미리보기 패널.

![tabby-agentdeck — 터미널, 미리보기 패널, 세션 목록](docs/guide/img/00-full.png)

## 단축키

| 키 | 동작 |
|---|---|
| `Ctrl+T` (⌘+T) | 작업 루트에 새 탭 |
| `Ctrl+1` … `Ctrl+9` | 고정 세션 번호 1~9로 이동 (필터·다른 세션 종료에도 번호 유지) |
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

## 지난 대화 검색

**지난 세션**을 펼치고 전용 검색창에 함수명·오류코드·파일명·세션 ID를 입력한다. 저장된 Claude·Codex 대화의 질문과 답변에서 대소문자 구분 없이 입력한 문자열 그대로 찾는다. 결과를 누르면 일치한 대화가 미리 열리고, **이어서 대화**를 눌러 재개한다. 현재 탭 검색과는 별도다.

검색은 로컬 Node.js 백그라운드 프로세스로 실행하고, 기록이 바뀌면 디스크 캐시를 갱신한다. PATH에서 Node.js를 실행할 수 있어야 한다. MCP 연결이나 AI 요청은 필요 없다. 도구 출력과 시스템 안내는 제외한다. 범위와 저장 위치는 [검색 안내](docs/HISTORY-SEARCH.md)를 참고한다.

## 설치

Tabby 안에서: 설정 → 플러그인 → `agentdeck` 검색 → 설치 → Tabby 재시작.
세션은 1~9 고정 번호를 사용하며 빈 번호를 재사용합니다. 자동 정렬과 드래그 순서 이동은 사용하지 않습니다.
선택적으로 연결하는 [세션 통신 MCP](docs/SESSION-COMMUNICATION.md)는 실제 세션 ID로만 송수신합니다. 사람용 번호는 MCP 주소가 아닙니다.

그 외 — 상태·미리보기 패널·diff 와 커밋·지난 세션 이어받기·설정 — 은
[사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html)와 [전체 레퍼런스](docs/REFERENCE.ko.md)에 있다.

Windows 에서 만들고 검증했다. MIT.
