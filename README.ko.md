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
| `Ctrl+1` … `Ctrl+9` | 사이드바 순서로 N 번째 세션으로 바로 이동 |
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

## 설치

Tabby 안에서: 설정 → 플러그인 → `agentdeck` 검색 → 설치 → Tabby 재시작.
그 외 — 상태·그룹·미리보기 패널·diff 와 커밋·지난 세션 이어받기·설정 — 은
[사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html)와 [전체 레퍼런스](docs/REFERENCE.ko.md)에 있다.

Windows 에서 만들고 검증했다. MIT.
