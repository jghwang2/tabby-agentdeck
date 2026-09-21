import { ConfigProvider } from 'tabby-core'

/**
 * 마우스로 만진 배치만 따로 모아 둔다 — 설정 탭의 "배치 초기화" 가 이 값으로 되돌린다.
 * 기본값 정의와 초기화 대상이 어긋나지 않도록 아래 defaults 도 이걸 펼쳐 쓴다.
 */
export const LAYOUT_DEFAULTS = {
    /**
     * 사이드바가 붙는 방향. 헤더를 잡고 창 가장자리로 끌어다 놓으면 바뀐다.
     * 'left' | 'right' | 'top' | 'bottom'
     */
    sidebarDock: 'right',
    /**
     * 좌/우 도킹일 때의 사이드바 폭 (px). 0 이면 자동 —
     * 화면비(aspectW:aspectH)로 터미널 폭을 역산하고 남는 만큼을 사이드바가 갖는다.
     * 경계선을 드래그하는 순간 그 폭이 여기 박히고, 그 뒤로는 자동 계산을 쓰지 않는다.
     */
    sidebarWidth: 0,
    /** 상/하 도킹일 때의 사이드바 높이 (px). 경계선 드래그로 바뀐다 */
    sidebarHeight: 200,
    /**
     * 미리보기 패널이 붙는 방향 — 'right' | 'left'.
     * 사이드바와 같은 쪽이면 사이드바가 창 가장자리(바깥), 패널이 터미널 쪽(안)에 앉는다.
     */
    viewerDock: 'right',
    /** 미리보기 패널 폭 (px). 경계선 드래그로 바뀐다 */
    viewerWidth: 420,
}

/** @hidden */
export class AgentDeckConfigProvider extends ConfigProvider {
    defaults = {
        agentDeck: {
            /** 레이아웃/사이드바 전체 on-off */
            enabled: true,
            /** 터미널 뷰포트 가로:세로 비율 */
            aspectW: 4,
            aspectH: 3,
            /**
             * 사이드바 폭 제한 (px).
             * sidebarMax 를 키우면 사이드바가 그만큼 넓어지고, 그래도 남는 폭은 터미널이 흡수한다
             * (4:3 보다 "창을 꽉 채운다" 가 우선). config.yaml 의 agentDeck 아래에서 조절한다.
             */
            sidebarMin: 200,
            sidebarMax: 560,
            // 마우스로 만지는 배치 (도킹 방향 / 폭 / 높이) — 정의는 LAYOUT_DEFAULTS 에 있다
            ...LAYOUT_DEFAULTS,
            /**
             * 결과물 미리보기 패널(viewPanel.ts)이 지금 열려 있나.
             *
             * 사이드바 `▤` 버튼이나 `agentdeck-view` 핫키로 토글하면 이 값이 바뀌고,
             * 다음 기동 때 그대로 복원한다 — 문서를 띄워 놓고 쓰는 사람에게는 그게 기본 화면이다.
             */
            viewerOpen: false,
            /**
             * 화면에 찍힌 파일 경로를 주워 최근 목록에 쌓는다.
             *
             * 에이전트를 가리지 않는 유일한 경로다 — Claude Code 처럼 훅이 있는 CLI 만 되는 게
             * 아니라 Codex·Gemini 도 만진 파일을 화면에 찍기 때문이다(viewer.ts 주석).
             * 비용은 탭당 400ms 마다 정규식 한 번이고, 끄면 수동으로 열 때만 쓰게 된다.
             */
            viewerScrape: true,
            /**
             * 에이전트가 만진 파일을 **패널에 미리 얹어 둔다** (닫혀 있어도).
             *
             * 기본 켬. 패널이 닫혀 있는 동안에도 최근 목록과 "다음에 열면 보여줄 파일" 을
             * 계속 갈아 두므로, 작업이 한창일 때 `▤` 를 누르면 **그때까지 만진 파일들이
             * 칩으로 쌓여 있고 본문은 가장 최근 파일**이다 (`변경` 모드였으면 그 자리에서
             * diff 를 다시 읽는다). 끄면 아무것도 자동으로 하지 않는다 — 경로 수집만 남고
             * 무엇을 볼지는 사람이 칩·`＋`·드롭으로 고른다.
             *
             * 이 값이 `false` 면 `viewerAutoOpen` 은 의미가 없다 (읽어두지 않으니 열 것도 없다).
             */
            viewerPreload: true,
            /**
             * 새 파일을 주우면 **닫힌 패널을 스스로 연다.**
             *
             * **기본 끔** (2026-09-10 유저 결정). 여닫기는 사람 몫이라는 뜻이다 — 작업 중에
             * 패널이 저절로 열리면 터미널이 좁아지고 읽던 화면이 밀린다. 대신 위 `viewerPreload`
             * 가 내용을 계속 채워 두므로, 열고 싶을 때 열면 이미 최신이다.
             * 켜면 결과물이 나오는 순간 패널이 열리면서 그 파일을 띄운다.
             */
            viewerAutoOpen: false,
            /**
             * @deprecated 0.18.0 부터 `viewerPreload` + `viewerAutoOpen` 두 토글로 갈랐다.
             *
             * 목록(`open`/`show`/`manual`) 하나로는 "읽어두기" 와 "자동으로 열기" 가 한 축에
             * 얹혀 있어서, 사람이 고를 때 두 결정을 한꺼번에 해야 했다. 남겨 두는 이유는
             * 이미 값을 적어 둔 설정 파일 때문이고, 기동 때 한 번 두 토글로 옮긴 뒤 비운다
             * (`migrateFollow`, deck.service 의 `migrateFollowConfig`).
             */
            viewerFollowMode: '' as '' | 'open' | 'show' | 'manual',
            /**
             * @deprecated 0.17.0 부터 `viewerFollowMode` 로, 0.18.0 부터 위 두 토글로 옮겼다.
             *
             * boolean 하나가 "자동으로 열기" 와 "새 파일로 바꾸기" 를 같이 쥐고 있어서,
             * **"패널은 내가 열고 닫되 열어 둔 동안에는 따라와라"** 를 표현할 수 없었다.
             * 마이그레이션이 `false` 를 읽고 나면 기본값(`true`)으로 되돌려 다시 읽지 않는다.
             */
            viewerFollow: true,
            /**
             * 패널 **밖**(터미널 위)에 파일을 끌어다 놓았을 때 무엇을 할지.
             *
             * 순정 Tabby 는 그 경로를 터미널에 붙여넣는다(그래서 `cat <경로>` 가 쉽다). 그 동작은
             * 그대로 두고, **미리보기로 열지를 물어본다** — 자동으로 화면을 바꾸면 붙여넣기만
             * 원했던 사람의 화면을 빼앗는다 (2026-09-09 유저: "한번 물어보긴 해야 할 듯").
             *
             *  - `ask`    : 확인 배너를 띄워 `패널에 띄우기` / `경로 붙여넣기` 를 고르게 한다 (기본)
             *  - `always` : 묻지 않고 패널에 띄운다
             *  - `paste`  : 묻지 않고 경로만 터미널에 붙여넣는다
             *  - `never`  : 우리가 개입하지 않는다 — 순정 Tabby 동작 그대로
             *
             * 배너의 `다시 묻지 않기` 를 체크하고 버튼을 누르면 그 선택이 `always`/`paste` 로
             * 저장된다. 되돌리려면 설정 창에서 `물어본다` 로 바꾼다.
             */
            viewerDropOpen: 'ask' as 'ask' | 'always' | 'paste' | 'never',
            /** 최근 목록(패널 위쪽 칩)에 남겨 두는 파일 수 */
            viewerRecentMax: 12,
            /**
             * 훅이 상태를 밀어 넣는 TCP 채널의 포트 (127.0.0.1 전용).
             *
             * Windows 임시 포트 범위(49152~65535) 아래로 잡는다 — 그 위 번호는 OS 가
             * 다른 프로세스에 먼저 내줄 수 있어 기동 순서에 따라 충돌한다.
             * 이 번호가 물려 있으면 0(임의 포트)으로 물러나고, 실제 번호는 어느 쪽이든
             * `%LOCALAPPDATA%\tabby-agentdeck\port` 에 적히므로 훅은 그 파일만 보면 된다.
             */
            notifyPort: 47500,
            /**
             * 외부 통보 채널(TCP + 상태 파일 폴링)을 열지.
             *
             * 기본으로 켠다. 에이전트 훅이 보내 주는 상태가 가장 정확한 원천이기 때문이다 —
             * 출력 패턴으로 추측하는 경로(detect.ts)는 훅이 없는 환경을 위한 폴백일 뿐이고,
             * TUI 가 화면을 어떻게 그리는지에 기대는 만큼 판정이 흔들린다
             * (2026-09-01: Claude Code 가 놀 때도 상태줄을 매초 갱신해 진행중이 안 풀렸다).
             * 훅을 안 쓰더라도 비용은 유휴 포트 하나와 400ms 폴링뿐이다.
             */
            notifyChannel: true,
            /**
             * 훅 설치 안내를 다시 띄우지 않는다.
             *
             * 기동할 때 훅이 안 걸려 있으면 한 번 물어보는데, "다시 묻지 않기" 를 고르면 켜진다.
             * 설정 창의 설치 버튼은 이 값과 무관하게 언제든 쓸 수 있다.
             */
            hookPromptDismissed: false,
            /**
             * 기동 시 지난 탭을 복원하지 않는다 (Tabby `recoverTabs` 를 false 로 강제).
             *
             * 복원되는 건 셸뿐이고 그 안의 Claude Code 세션은 이미 죽어 있어 의미가 없다.
             * 켜면 항상 빈 상태(기본 프로필 새 탭)로 시작하고, 끄면 Tabby 순정 동작으로 돌아간다.
             * 설정 창에서 토글한다 (recovery.service.ts).
             */
            noTabRecovery: false,
            /**
             * 개발자 옵션 — `dist/index.js` 가 바뀌면 세션을 살린 채 창을 리로드한다(devReload.service.ts).
             *
             * **개발 빌드 + 개발 설치(소스 트리)에서만 의미가 있다.** npm 배포 빌드(`npm pack` →
             * `build:release`)는 기능 코드를 스텁으로 바꿔 끼우므로 이 값이 참이어도 아무것도 안 하고
             * 설정 화면에도 안 보인다.
             */
            devMode: true,
            /**
             * 기동할 때 npm 레지스트리를 보고 **새 버전을 받아 둔다** (적용은 다음 기동).
             *
             * Tabby 는 플러그인을 기동할 때 한 번 읽으므로 돌고 있는 것을 갈아끼울 수 없다 —
             * 그래서 받아만 두고 한 번 알린다. 기동 20초 뒤에 한 번, 그 뒤로는 아래 간격마다.
             *
             * **개발 설치(소스 트리 junction)에는 설치하지 않는다.** 거기에 `npm install` 이 돌면
             * 작업 중인 소스를 덮어쓴다 — 새 버전이 있다는 것만 알리고 손대지 않는다
             * (판정은 `update.ts` 의 `canSelfUpdate`).
             */
            autoUpdate: true,
            /** 확인 간격 (시간). 기동마다 묻지 않는다 */
            updateCheckIntervalHours: 6,
            /** 마지막으로 레지스트리에 물어본 시각 (epoch ms) — 설정이 아니라 상태다 */
            lastUpdateCheck: 0,
            /** 레지스트리 주소. 사내 미러를 쓰면 여기를 바꾼다 */
            updateRegistry: 'https://registry.npmjs.org',
            /** PTY 출력이 이 시간(ms) 이상 없으면 running -> idle */
            idleAfterMs: 2500,
            /**
             * **훅이 고정한 `진행중` 탭**이 이 시간(ms) 동안 아무 기척도 없으면 고정을 풀고 idle 로
             * 내린다. 0 이면 끈다 (0.17.0 이전 동작 — 영영 안 내려온다).
             *
             * 왜 따로 두나 — 위 `idleAfterMs`(2.5초)는 **자동 감지** 탭의 값이라 고정된 탭에 쓸 수
             * 없다. 훅은 도구 하나가 끝날 때(`PostToolUse`)에야 말하므로 2분짜리 빌드 중에는 몇 분씩
             * 조용하고, 그 값을 그대로 적용하면 일하는 탭이 매번 idle 로 깜빡인다.
             *
             * 왜 필요한가 — 훅에 "세션이 끝났다" 이벤트가 없다(`claudeHooks.ts` PLAN). Ctrl+C 로 끊거나
             * 창을 닫거나 CLI 가 죽으면 마지막 `running` 이 그대로 남고, 고정된 탭에는 배지가 내려올
             * 길이 하나도 없었다 (`status.service.ts tickIdle` 주석). 사이드바가 "작업중" 이라고
             * 말하는데 실은 아무것도 안 하고 있는 탭이 그것이다.
             *
             * 5분인 이유 — 기척으로 **훅 보고·PTY 출력·작업중 신호 셋 다** 인정하므로(셋 중 최신에서
             * 잰다) 살아 있는 세션은 이 값에 걸릴 일이 없다. 사람이 "어? 안 바뀌네" 하고 알아채는
             * 시간보다는 짧아야 해서 시간 단위로 두지 않았다.
             *
             * `승인대기`·`한도`는 이 시계를 타지 않는다 — 조용한 것이 정상인 상태다
             */
            staleAfterMs: 300000,
            /** 출력 패턴으로 상태를 자동 추론할지 */
            autoDetect: true,
            /** 사이드바에 경과 시간 표시 */
            showElapsed: true,
            /**
             * 세션이 지금 돌리고 있는 **백그라운드 서브에이전트 개수**를 줄에 보인다
             * (`❖ 3`, 툴팁에 무엇을 시켜 놨는지 + 가장 오래된 것의 경과 시간).
             *
             * 기본으로 켠다 — 얻는 것이 "저 탭이 사람 없이도 일이 도는 중인지" 이고 그것을 볼
             * 다른 수단이 없다(훅은 세션 **하나**의 상태만 알려 준다, `subagents.ts` 주석).
             * 0 개면 아무것도 그리지 않으므로(deck.service `renderTab`) 서브에이전트를 안 쓰는
             * 사람의 화면은 0.12.0 까지와 똑같다 — 켜 둬서 잃는 것이 없다.
             *
             * 비용은 세션당 **2초에 `stat` 한 번**이고, 파일이 자란 만큼만 비동기로 읽는다
             * (실측 대화기록 13MB — 동기로 읽으면 UI 가 멈춘다).
             * 끄면 읽기도 표시도 멈춘다: 끈 기능이 대화기록 파일을 계속 여는 일은 없다
             * (`notify.service` `scanSubagents`).
             */
            subagentCount: true,
            /**
             * 사이드바 하단에 **지금 이 탭** 줄을 고정한다 — 도는 모델·effort·계정·컨텍스트%·
             * 5h/7d 한도%. 탭을 바꾸면 그 탭 값으로 다시 그린다.
             *
             * 켜 두는 것만으로는 아무 일도 일어나지 않는다 — 이 값들은 **statusLine stdin 에만**
             * 내려오므로 설정 창에서 `statusLine 연결` 을 설치해야 보고가 온다(statusLine.ts).
             * 설치 전에는 줄이 통째로 접혀 있어 화면이 지금과 같다.
             */
            metaLine: true,
            /**
             * 사이드바 탭을 상태 우선순위(waiting → error → running → done → idle)로 정렬한다.
             * 같은 상태끼리는 탭 순서를 지킨다. 기본은 끔 — 순정 탭바와 같은 탭 순서로 보인다.
             * 헤더의 상태별 집계는 이 값과 무관하게 항상 보인다.
             */
            sortByStatus: false,
            /**
             * 사이드바 헤더 아래에 **세션 검색 줄**을 둔다 (제목 · 작업이름 · 작업 폴더로 좁히기,
             * 헤더의 상태 칩을 눌러 그 상태만 보기).
             *
             * 기본으로 켠다 — 탭이 몇 개뿐일 때도 잃는 것은 26px 한 줄이고, 탭이 많아지는 순간
             * 목록을 눈으로 훑는 비용이 그보다 훨씬 크다. 세로가 짧은 상/하 도킹에서 그 한 줄이
             * 아까운 사람만 끄면 된다.
             *
             * **여기 저장하는 것은 기능 on/off 뿐이다.** 검색어와 상태 필터는 설정에 남기지 않는다
             * (deck.service `searchQuery` 주석) — 다음 기동에 필터가 살아 있으면 목록이 좁혀진
             * 채로 떠서 "탭이 사라졌다" 로 읽힌다. 그 오해는 이 기능이 주는 이득보다 비싸고,
             * 되살릴 값어치도 없다(검색은 "지금 이것을 찾는다" 는 한순간의 행위다).
             * 이 값을 끄면 걸려 있던 필터도 같이 지운다 — 감춰진 필터가 남는 것이 가장 위험하다.
             */
            searchBox: true,
            /**
             * 사이드바를 **키보드로** 다룬다 — 핫키(`agentdeck-focus-list`, 기본 `Ctrl-L`)로
             * 목록에 들어가 ↑↓ 로 훑고, Enter 로 그 탭으로 전환, Esc 로 터미널에 돌아온다.
             * 검색창에서 ↓ 를 누르면 결과 목록으로 내려가고, 첫 줄에서 ↑ 면 검색창으로 돌아온다.
             * 그룹 헤더도 지나가며 Enter 로 접었다 펼 수 있다.
             *
             * **이동만으로는 탭이 바뀌지 않는다** (포커스 ≠ 선택). 여섯 개쯤 띄워 두고 훑을 때
             * 줄마다 활성 탭이 바뀌면 터미널 화면이 계속 튀어 훑기 자체가 불가능하다
             * (`deck.service.ts` `navFocus` 주석).
             *
             * 기본으로 켠다 — **포커스가 사이드바에 없는 동안은 키를 한 개도 가로채지 않는다.**
             * 리스너가 document 가 아니라 목록 엘리먼트(`.ad-list`)에 걸려 있어서, 핫키를 누르거나
             * 검색창에 들어가지 않으면 이벤트가 아예 오지 않는다(`wireListKeys` 주석).
             * 끄면 핫키·검색창 ↓ 가 모두 no-op 이 되고 링도 그리지 않는다.
             */
            keyboardNav: true,
            /**
             * 목록 끝에서 ↑↓ 를 한 번 더 누르면 반대쪽 끝으로 감싼다.
             *
             * 기본은 끔 — 감싸면 "맨 아래에 왔다" 는 신호가 사라지고, 목록이 한 번에 위로 튀어
             * 화면이 다시 그려진 것처럼 보인다. 끝에서 끝으로 갈 일은 Home/End 가 받는다.
             *
             * 켜도 **맨 위의 ↑ 는 검색창으로 나간다**(검색 줄이 보일 때). 그 경계를 감싸기에
             * 내주면 목록에서 검색창으로 돌아갈 키가 없어진다 — 검색↔목록 왕복이 이 기능의
             * 요구사항이라 감싸기보다 앞에 둔다 (`deck.service.ts` `moveNav`).
             */
            keyboardNavWrap: false,
            /**
             * `Ctrl+W` 로 지금 탭을 닫는다 (터미널에서 누르면 활성 탭, 목록이 키보드를 갖고
             * 있으면 포커스 줄의 탭 — `nav.ts` `pickCloseTarget`).
             *
             * **`keyboardNav` 에 매달아 둔다** — 키보드로 목록을 훑다가 버릴 탭을 만나는 것이
             * 이 키의 쓰임새이고, 키보드 조작을 끈 사람에게 터미널 키를 빼앗을 이유가 없다.
             * 그래서 `keyboardNav` 가 꺼져 있으면 이 값이 `true` 여도 아무 일도 하지 않는다
             * (설정 창에서도 줄이 사라진다 — `keyboardNavWrap` 과 같은 방식).
             *
             * 끄고 싶을 만한 이유가 분명히 있다: 셸·에이전트 CLI 에서 `Ctrl+W` 는 **앞 단어
             * 지우기**(0x17)다. 그걸 그대로 쓰려면 이 값만 끄면 되고, 목록 키보드 조작은 남는다.
             * 켠 상태에서도 우리가 키를 먹는 것은 **닫을 탭이 실제로 정해졌을 때뿐**이다 —
             * 그룹 헤더에 포커스가 있거나 설정 화면 입력창이면 키를 그대로 흘린다.
             * 닫기는 사이드바 `✕` 와 같은 경로라(`closeTab(tab, true)`) 돌아가는 프로세스가
             * 있으면 Tabby 가 평소처럼 한 번 물어본다.
             */
            keyboardCloseTab: true,
            /**
             * 줄을 끌어 순서를 바꾸는 동안 커서를 **목록 끝에 대면 목록이 따라 스크롤된다.**
             *
             * 기본으로 켠다 — 없으면 탭이 많아 목록이 넘치는 순간 "화면 밖으로 옮기기" 가
             * 아예 불가능해진다(손을 떼고 스크롤한 뒤 다시 끄는 왕복이 필요하다). 그게
             * 0.12.0 의 드래그 재정렬에 남아 있던 구멍이다.
             *
             * 끄면 0.12.0 과 똑같이 동작한다 — 목록은 가만히 있고, 보이는 줄 사이에서만
             * 옮긴다. 자동 스크롤을 꺼서 얻는 것이 있다: 가장자리 띠 안에서 화면이 흐르지
             * 않으므로 **맨 끝 줄의 뒤에 놓는** 조작이 절대 미끄러지지 않는다. 띠를 줄 하나
             * 두께로 좁혀 두긴 했지만(deck.service `DRAG_SCROLL_BAND_PX`) 그 조작을 자주
             * 하는 사람에게는 이 스위치가 답이다.
             *
             * 속도·띠 두께는 설정으로 내지 않았다 — px/s 는 사람이 판단할 수 있는 숫자가
             * 아니고, 띠 두께는 줄 높이에서 나온 값인데 줄 높이가 설정이 아니다.
             * 이 값은 **드래그 중에만** 읽는다: 끌지 않을 때는 커서가 목록 끝에 얹혀 있어도
             * 아무 일도 일어나지 않는다(hover 리스너를 두지 않았다).
             */
            dragAutoScroll: true,
            // 세션 그룹에는 설정이 없다 — **항상 켜져 있고 경계도 자동으로 잡는다.**
            //
            // 스위치(`groupByProject`)를 없앤 근거: 그룹이 하나뿐이면 헤더를 아예 그리지 않고
            // 순서도 건드리지 않으므로(deck.service `renderPlan`), 한 프로젝트만 쓰는 사람에게는
            // 켜 둔 화면과 끈 화면이 **같다.** 끌 이유가 없는 스위치는 설정 창에서 고를 것만 늘린다.
            // 경계를 적는 값(`groupRoot`)도 없앴다 — `project-root.ts` 가 저장소 루트(`.git` 등)를
            // 직접 찾는다. 사람이 상위 폴더를 적는 방식은 프로젝트들이 한 폴더에 나란히 있을 때만
            // 맞고, 깊이가 다르면 어떤 값을 적어도 한쪽이 틀렸다.
            // 묶는 기준은 **탭이 태어난 cwd** 다 — 셸에서 `cd` 를 해도 따라오지 않으므로
            // (docs/DEVELOPMENT.md 0.5.0 실측) 세션이 사는 동안 그룹이 흔들리지 않는다.
            /**
             * 접어 둔 그룹 키 목록. 그룹 헤더를 클릭할 때마다 갱신되고 다음 기동에 복원된다.
             *
             * 키는 `group.ts` 가 정규화한 경로를 **소문자로 접은** 값이다(`foldGroupKey`) —
             * 셸이 알려주는 경로의 대소문자·구분자가 기동마다 달라도 접힘이 유지돼야 하기 때문이다.
             */
            collapsedGroups: [],
            /**
             * 그룹 안에 **지난 세션**(죽은 Claude Code 세션) 줄을 그린다.
             *
             * 이 기능이 있는 이유는 `recovery.service.ts` 주석에 있다 — agentdeck 은 Tabby 의 순정
             * 탭 복원을 껐다(셸만 살아나고 세션은 죽어 있어 "주인 없는 탭" 이 남는다).
             * `claude --resume` 이 그 자리에 들어갈 진짜 복원이고, 사람이 막히는 곳은 명령이 아니라
             * UUID 목록에서 자기 작업을 찾는 것이라 **라벨을 붙여 보여주는 것** 이 이 기능의 전부다.
             */
            resumeList: true,
            /**
             * 몇 줄까지 보여줄지. **0 = 제한 없음이고 그게 기본이다.**
             *
             * 예전에는 5 였다 — 서랍이 그룹마다 목록 **안**에 있어서, 길어지면 살아 있는 탭이
             * 아래로 밀려났기 때문이다. 지금 서랍은 사이드바 바닥에 붙은 **스크롤 상자**라
             * 몇 줄이 들어 있든 살아 있는 탭을 밀지 않는다. 잘라 둘 이유가 사라졌고,
             * 잘려 나간 세션은 사람이 찾을 방법이 아예 없었다
             * (2026-09-14 유저: "기껏 저장한걸 굳이 안쓸 이유는 없을 듯").
             */
            resumeListLimit: 0,
            /**
             * 며칠치까지. 기간 밖 세션은 **화면에서만** 빠지고 원장·기록은 그대로다.
             * 위와 같은 이유로 0(제한 없음)이 기본이다 — 한 달 전 작업을 이어받는 일이
             * 드물긴 해도, 드물다는 것이 "못 찾게 한다" 의 근거는 아니다.
             */
            resumeListDays: 0,
            /** 지난 세션 줄을 펼쳐 둔 그룹 키 (`collapsedGroups` 와 반대로 **펼침**을 적는다 — 기본이 접힘이라서) */
            resumeExpanded: [],
            /** 사람이 목록에서 숨긴 세션 id */
            resumeHidden: [],
            /**
             * 창이 가려져 있어도 사이드바를 계속 갱신한다 (Electron backgroundThrottling 해제).
             *
             * 끄면 Chromium 기본 동작으로 돌아간다 — 창이 hidden 이면 rAF 가 멈추고 타이머가
             * 1초, 5분 이상 가려지면 분당 1회까지 느려져서 훅이 보낸 done 이 화면에 늦게 뜬다.
             * 켜 두면 훅 보고가 바로 보이는 대신 가려진 동안에도 렌더 비용이 조금 든다
             * (사이드바 DOM 갱신뿐이라 미미하다).
             */
            keepRenderingWhenHidden: true,
            // labelAsTitle 은 없앴다 — 사이드바가 제목/프롬프트/상태를 각자 줄에 보여주게 되면서
            // (deck.service renderTab) 둘 중 하나를 고를 이유가 사라졌다.
            /**
             * Enter 로 프롬프트를 보낼 때 그 원문을 작업 라벨로 삼는다 (claimEnterLabel 주석 참고).
             * 훅도 콘솔 제목도 못 믿는 배포 환경에서 라벨을 최신으로 유지하는 유일한 경로다.
             * Shift+Enter / Ctrl+Enter(줄바꿈)는 잡지 않는다.
             */
            enterAsLabel: true,
            /**
             * Ctrl+V 를 agentdeck 이 직접 받는다 (document 캡처 단계에서 한 번만).
             *
             * 핫키(`agentdeck-paste`)로 받던 시절에는 Tabby 가 같은 keydown 을 두 경로로
             * HotkeysService 에 밀어 넣어 한 번 눌러 두 번 붙는 일이 남아 있었다
             * (deck.service.ts `ensurePasteHotkey` 주석에 원인). 캡처로 옮기고 전파를 끊으면서
             * 경로가 하나로 정리됐다.
             *
             * false 로 두면 터미널 앱에 리터럴 Ctrl+V(0x16, quoted-insert)를 보낼 수 있다
             */
            claimCtrlV: true,
            /**
             * `Ctrl+T`(⌘+T) 를 새 탭이 받는다. 순정 `new-tab`에 겹치는 키만 뗀다.
             * false 면 떼지 않고 우리 핫키도 무시한다(순정 그대로). 순정 새 탭은 기본 프로필로 열어
             * 훅이 탭을 못 찾으므로, 이 플러그인을 쓰는 동안은 켜 두는 것이 맞다
             */
            claimNewTabKey: true,
            /**
             * `Ctrl+R`을 화면 복구가 받는다. 순정 `rename-tab`에 겹치는 키만 뗀다.
             * false 면 떼지 않고 우리 핫키도 무시한다(순정 그대로). 탭 이름은 사이드바 더블클릭으로 바꾼다
             */
            claimRepairKey: true,
            /**
             * 순정 `close-pane`(포커스된 분할 패널 닫기)이 **비어 있으면** 이 키를 채운다.
             * Tabby 기본표는 이 항목이 빈 채로 오고, agentdeck 은 짧은 우클릭을 복사/붙여넣기로
             * 쓰기 때문에 컨텍스트 메뉴로 패널을 닫기가 번거롭다. `Ctrl-Q` 는 순정 네 패키지
             * 기본표·agentdeck 어디에도 없는 키(2026-09-16 grep 0건).
             * 이미 사람이 채워 둔 표는 건드리지 않는다. 빈 문자열이면 아무것도 하지 않는다.
             */
            closePaneKey: 'Ctrl-Q',
            /**
             * Shift+Enter / Ctrl+Enter 를 캡처 단계에서 직접 줄바꿈으로 처리한다.
             *
             * 핫키(agentdeck-newline)에만 맡기면 한글 조합 중에 눌렀을 때 Shift 가 실리지
             * 않은 Enter 로 도착해 전송돼 버린다 (deck.service.ts `claimShiftEnterKey` 주석).
             * false 로 두면 예전처럼 핫키 경로만 쓴다.
             */
            claimShiftEnter: true,
            /**
             * Home / End 를 Tabby 핫키에서 걷어내 xterm 순정 경로로 돌려준다.
             *
             * 핫키로 두면 한글 조합 중에 눌렀을 때 조합 음절이 커서를 따라간다
             * (deck.service.ts `releaseHomeEndHotkey` 주석에 원인). 방향키가 멀쩡한 이유도 같다 —
             * 방향키는 핫키가 아니라서 xterm 이 조합을 먼저 확정하고 키를 보낸다.
             */
            releaseHomeEnd: true,
            /**
             * pty 에 바이트를 쓰기 전에 조합 중인 한글 음절을 먼저 확정시킨다.
             *
             * 핫키를 놓아주는 것(`releaseHomeEnd`)만으로는 부족했다 — 실사용 config.yaml 이
             * 이미 `home: []` / `end: []` 인데도 조합 중 음절이 커서를 따라가는 증상이 재발했다
             * (2026-09-08 사용자 재보고). 원인은 핫키가 아니라 **xterm 을 거치지 않는 pty 직접
             * 쓰기**여서, 이 옵션은 그 쓰기 지점 전부를 한 진입점으로 모아 순서를 맞춘다
             * (deck.service.ts `sendToPane` / `guardHomeEndComposition`, 기전은 `ime.ts`).
             *
             * false 로 두면 0.4.0 까지의 동작 그대로 — 조합 상태를 보지 않고 바로 쓴다.
             */
            imeOrderGuard: true,
            /**
             * 클립보드에 이미지만 있으면 Ctrl+V 로도 이미지가 들어가게 한다.
             *
             * 터미널 붙여넣기는 "클립보드 텍스트를 PTY 에 써넣는" 동작이라 이미지는 지나갈 수가 없다.
             * 대신 에이전트 CLI 는 자기가 OS 클립보드를 직접 읽는 키를 따로 두므로,
             * 이미지일 때만 그 키를 흘려보낸다 (어떤 키인지는 `imagePasteKey`).
             */
            pasteImageWithCtrlV: true,
            /**
             * 이미지 전용 클립보드일 때 흘려보낼 키의 **기본값**. `'alt-v'`(ESC v) | `'ctrl-v'`(0x16).
             *
             * 평소에는 이 값이 쓰이지 않는다 — 탭에서 도는 앱을 보고 자동으로 갈라 보내기 때문이다
             * (Claude Code = ESC v / Codex = 0x16, `deck.service.ts` `sendImagePasteKey` 주석에 실측).
             * 앱을 못 알아낼 때(SSH 세션 등)의 폴백으로만 쓴다.
             *
             * Claude Code 는 PTY 로 들어온 0x16 에 반응하지 않는 것이 실측됐으므로
             * (`.agentdeck-diag.log` 2026-08-28T09:33:47~48 에 `paste image (ctrl-v)` 5줄, 이미지 미삽입)
             * 폴백은 더 널리 먹히는 ESC v 로 둔다.
             */
            imagePasteKey: 'alt-v',
            /**
             * 우클릭(붙여넣기 / 선택 시 복사)을 agentdeck 이 직접 처리한다.
             * Tabby 자체 처리를 끄고(terminal.rightClick = 'off') 캡처 단계에서 한 번만
             * 처리하므로, 핸들러가 두 번 걸려 붙여넣기가 2중으로 들어가던 문제가 사라진다.
             * false 로 두면 Tabby 순정 동작으로 되돌아간다
             */
            claimRightClick: true,
            /** 우클릭을 이 시간(ms) 이상 누르고 있으면 붙여넣기 대신 컨텍스트 메뉴 */
            rightClickMenuMs: 250,

            /**
             * 터미널 배경 불투명도 (%). 100 이면 순정(완전 불투명).
             *
             * tabby-background 플러그인은 배경 이미지를 `.content-tab-active::before`
             * (position:fixed, z-index:-1) 로 **모든 내용 뒤에** 깐다. 그런데 xterm 은
             * 컬러스킴의 `background` 색으로 셀을 직접 칠하므로, 그 색에 알파가 없으면
             * 이미지는 터미널 영역에서 100% 가려진다 — "배경 이미지를 넣었는데 아무 데도 안 보인다"
             * 의 정체가 이것이다(2026-08-28 실측: colorScheme.background = '#171717' 불투명).
             * Tabby 는 xterm 을 `allowTransparency: true` 로 만들기 때문에 알파만 넣어주면 비친다.
             *
             * 그래서 agentdeck 이 기동 시 `terminal.colorScheme.background` 를 8자리 hex 로 바꿔준다.
             * 100 으로 되돌리면 알파를 떼어 원래 색으로 복구한다 (되돌리기 가능).
             */
            terminalOpacity: 75,
            /** 사이드바 배경 불투명도 (%). 터미널과 같은 이유로 배경 이미지가 비치게 한다 */
            sidebarOpacity: 75,
            /**
             * tabby-background 의 배경 이미지를 **터미널 영역(`.content.main`) 안에만** 그린다.
             *
             * 그 플러그인은 이미지를 `.content-tab-active::before` 에 `position:fixed; 100%x100%`
             * 로 깔아 창 전체를 덮으므로, 사이드바가 반투명이면 이미지가 사이드바 밑까지 비친다
             * (2026-09-02 유저 지적: "배경이 agentdeck 사이드바를 침범한다").
             * true 면 relayout 때마다 터미널 영역 좌표를 CSS 변수(`--ad-bg-*`)로 내려
             * 그 레이어의 위치·크기를 터미널 영역으로 잘라 붙인다. false 면 순정(창 전체).
             */
            clipBackgroundToTerminal: true,
            // 크기 보정 설정(`sizeWatchMs` / `sizeWatchIntervalMs` / `redrawKickMs` /
            // `startupWindowKickMs`)은 그 장치들과 함께 폐지했다 (2026-09-02).
            // 줄맞춤은 Tabby 순정이 한다 — xterm `ResizeObserver` → `fitAddon.fit()` →
            // `session.resize()`. agentdeck 은 폭만 정해 `.content.main` 에 적는다.
            // 자세한 경위는 `deck.service.ts` 의 relayout 주석 참고.

            /**
             * 화면 복구(사이드바 `↻` / `agentdeck-repair` 핫키)가 **스크롤백까지 지우고**
             * 터미널 상태를 초기화한다(`xterm.reset()`).
             *
             * true 인 이유: 깨진 화면에는 옛 폭으로 그려진 잔상이 셀에 남아 있는데, 앱이 다시
             * 그려도 자기가 쓰는 자리만 덮으므로 그 바깥은 지워지지 않는다. 지난 대화를 남기고
             * 싶으면 false — 그때는 크기 정합 + 흔들기까지만 한다(그것만으로는 안 고쳐지는
             * 경우가 있다, 2026-09-01 확인).
             */
            /**
             * 화면이 깨졌는지 **주기적으로 직접 보고**, 깨졌으면 조용히 복구한다.
             *
             * 이게 필요한 이유 — 크기 감시(`sizeWatchMs`)는 "우리가 pty 에 보낸 값" 과
             * "xterm 이 가진 값" 을 비교한다. 그런데 세션이 막 열린 직후의 `session.resize()` 는
             * **pty 에 도달하지 못하고 유실된다**(2026-09-01 실측: 진단 로그에
             * `pty resize 254x78 -> 280x78` 을 찍고 `pane.size` 도 280 으로 남겼는데,
             * 같은 탭에서 셸에 물어보니 `PTYW=254 xtermCols=280`). 보낸 값을 낙관적으로
             * 기록하기 때문에 감시는 "이제 맞다" 고 보고 손을 뗀다. 그 뒤에 뜨는 TUI 는
             * 254 폭으로 그리고, 오른쪽 26칸에는 옛 프레임(`Try "how do I …"` 힌트)이 남는다.
             *
             * 그래서 판정 기준을 **화면 자체**로 바꾼다. 입력창 테두리 길이가 화면 폭과 다르거나,
             * 가로선과 입력 텍스트가 한 줄에 섞였거나, 입력창 머리가 둘 보이면 깨진 것이다
             * (`screen.ts` 의 `judgeScreen` — 정상/깨짐 실측 케이스로 유닛 테스트가 걸려 있다).
             * 원인이 무엇이든 결과를 보고 고치므로, 원인 하나를 쫓다 다른 것이 깨지는 일이 없다.
             */
            /**
             * **다시 켬 (2026-09-02).** 껐던 근거가 오진이었다.
             *
             * 껐을 때의 이유는 "Claude Code 는 테두리를 `cols - 1` 로 그리는데 판정이
             * `== cols` 를 정상으로 봐서 멀쩡한 화면을 깨짐으로 친다" 였다. **그 전제가 틀렸다.**
             * 격리 인스턴스에서 실물 claude 를 띄워 xterm 버퍼를 직접 덤프해 보니
             * (2026-09-02, cols=271):
             *
             *   71 len=271 wrap=0 "────…"   ← 테두리는 cols 를 꽉 채운다
             *   72 len=2   wrap=1 "❯ "      ← 꽉 찼기 때문에 autowrap 으로 넘어온 행이다
             *   73 len=271 wrap=0 "────…"
             *
             * 즉 `len == cols` 가 정상이고, `len == cols - 1` 은 **앱이 폭을 1 작게 알고 있는**
             * 진짜 깨짐이다. 그때는 테두리가 폭을 못 채워 autowrap 이 안 걸리므로 `❯` 가
             * 윗줄에 붙어버리고 **입력행이 통째로 사라진다**(항목 25 의 ④ 증상이 이것이다).
             * 껐던 탓에 실사용에서 깨져도 아무도 고치지 않고 방치됐다.
             *
             * 예전 자동복구가 화면을 흔들어 놓은 진짜 이유는 판정이 아니라 **조건이 없어서**였다.
             * 프레임을 그리는 도중을 한 번 잡아도 바로 복구를 때렸다. 그래서 이번에는
             * `autoRepairMinStreak` 로 "몇 초 넘게 깨진 채로 있을 때만" 손대게 한다.
             */
            /**
             * **다시 끔 (2026-09-02, 실사용 실측 4/4 실패).** 위 판정 근거는 여전히 맞지만
             * **복구 수단이 이 유형에 안 듣는다.** 실사용 로그 06:02:27~06:03:12 —
             * `redraw nudge 277x78` → `pty resize 276x78 -> 277x78` → `Ctrl+L` 을 다 보내고도
             * 네 번 모두 `auto-after 아직 깨짐 rule@73 len=276 != cols=277`.
             * 그동안 10초마다 화면이 흔들려 유저 체감만 나빠졌다("최대화됐다 다시 깨지네").
             *
             * 격리에서 한 번에 복구됐던 건 `session.resize(cols-1)` 로 **pty 를 직접 좁혀** 만든
             * 표본이라, 흔들기가 되돌릴 대상이 실제로 있었다. 실사용은 pty 가 이미 277 로 맞고
             * **앱만 276** 이라 되돌릴 것이 없다 — 항목 27 이 이 유형을 정확히 짚었던 것이고,
             * 항목 28 의 반전은 그 표본에는 해당하지 않았다.
             * 되살리려면 "앱이 pty 폭을 다시 읽게 만드는" 수단부터 찾을 것. 감지·채증(`screenWatch`)은 계속 돈다.
             */
            /**
             * **다시 켬 (2026-09-09).** 위 두 주석의 판단 근거가 오늘 채증으로 갈렸다.
             *
             * 껐던 이유는 "복구 수단이 이 유형에 안 듣는다" 였는데, 그 유형이 무엇이었는지가
             * 오늘 실사용 8건으로 확정됐다 — **`xterm.cols != pty` 인 리사이즈 중간 프레임**이다
             * (4건 전부, 0~3초 만에 스스로 복구, 화면 덤프는 앱 기준 정상). 거기에 `fit`+`nudge`
             * 를 때렸으니 고쳐질 리가 없고 화면만 흔들렸다.
             *
             * 크기가 맞는데 깨진 나머지 4건(02:07:45~02:08:01, 자식 프로세스 stdout 이 TUI 를
             * 덮어씀)은 26초를 버텼고, 이 유형은 `clearInputArea` + `Ctrl+L` 로 실제로 고쳐진다
             * (회귀 PR8·PR9 가 격리 인스턴스에서 100~160ms 해소를 잰다).
             *
             * 그래서 **손댈 유형만 손대도록** `checkScreen` 에 크기 가드를 넣고 기본값을 켠다.
             * 자동 경로가 하는 일은 사이드바 `↻` 한 번과 같다(잔상 지우기 + Ctrl+L, **흔들기 없음**).
             *
             * 켜기 직전에 "켜면 격리 인스턴스가 죽는다" 로 한 번 막혔는데, **그 죽음은 우리 코드가
             * 아니었다** (2026-09-09 확정). `tools/test-instance.ps1 -Kill` 이 커맨드라인에
             * `tabby-agentdeck-test` 가 든 Tabby 를 **전부** 죽이고 기동은 그 `ud` 폴더를 지운다 —
             * 같은 저장소에서 두 세션이 동시에 회귀를 돌리면 서로의 인스턴스를 죽인다. 그때 CDP 는
             * ECONNRESET 으로 끊기고 진단로그에 상대의 `setup start tabs=0` 이 이어 붙어 크래시처럼
             * 보인다. 판별법 — **Crashpad 리포트가 비어 있으면 크래시가 아니라 누가 죽인 것이다**
             * (`<ud>\Crashpad\reports`). 이름이 겹치지 않는 전용 인스턴스에서 다시 재니
             * 기본 `true` 로 `probe-profile` 3회 연속 8 PASS / 0 FAIL 이었다.
             *
             * 끄고 싶으면 `%APPDATA%\tabby\config.yaml` 의 `agentDeck.autoRepairScreen: false`
             * 한 줄이면 되고, 감지·채증(`screenWatch`)은 어느 쪽이든 돈다.
             */
            autoRepairScreen: true,
            /**
             * 화면을 **보고 기록만** 한다 (복구는 하지 않는다).
             *
             * `autoRepairScreen` 을 끄면서 감지·채증까지 같이 꺼진 게 문제였다 —
             * 실사용에서 깨져도 `~/.agentdeck-screen.log` 에 한 줄도 안 남아,
             * "고쳤다고 했는데 또 깨진다" 를 확인할 증거가 없었다
             * (2026-09-02 실측: Tabby 재시작 11:21 이후 기록 0줄, 그 사이 화면은 깨져 있었다).
             * 그래서 **관측과 조치를 분리한다.** 이 값이 켜져 있으면 깨짐을 판정해
             * 화면 원문을 남기기만 하고 키는 쏘지 않는다 — 부작용이 없으니 기본으로 켠다.
             */
            screenWatch: true,
            /** 자동 복구를 한 번 한 뒤 이만큼은 다시 하지 않는다 (ms) */
            autoRepairCooldownMs: 10000,
            /**
             * 깨짐이 이만큼 **연속으로** 보여야 복구한다 (화면 검사는 2초 그물이므로 2 면 2초 이상).
             * TUI 는 한 프레임을 여러 번의 write 로 그리므로 그 도중을 읽으면 멀쩡한 화면도
             * 한 번은 깨져 보인다 — 그 중간 프레임에 키를 쏘지 않기 위한 조건이다.
             */
            autoRepairMinStreak: 2,
            /**
             * 한 탭에서 자동 복구를 최대 몇 번까지 할지. 판정이 오탐이거나 앱이 정말
             * 그렇게 그리는 경우에 무한히 흔드는 것을 막는 안전장치다. 0 이면 무제한.
             */
            autoRepairMaxPerTab: 3,
            /**
             * 복구 때 `xterm.reset()` 까지 한다 — **스크롤백(지난 대화)이 날아간다.**
             * 기본은 끔. 잔상은 `clearInputArea`(화면만 비우고 스크롤백은 보존)로 지우므로
             * 여기까지 갈 일이 거의 없다. 그걸로도 안 풀리는 화면을 만나면 그때 켠다.
             */
            repairHard: false,
            /**
             * 복구 마지막에 `Ctrl+L`(0x0C)을 보낸다.
             *
             * **기본 끔 (2026-09-11 전환).** 0x0C 를 "전부 다시 그려라" 로 받는 앱을 전제했는데,
             * **Claude Code 는 "화면을 지워라" 로 받는다** — 채증으로 확정했다.
             * `↻` 를 누른 뒤 스냅샷(`.agentdeck-screen.log` 06:04:52→54)에서 78행 중 **0~72행이
             * 통째로 비고** 입력창(73~77행)만 남았고, 진단 로그의 순서가 원인을 못 박는다:
             * `clear input area row=73/78`(73~77행만 지움) → `repair redraw-key ctrl-l` → 화면 전멸.
             * 사용자에게는 "새로고침하면 출력이 한참 위로 올라가 버린다" 로 보인다(유저 지적).
             *
             * 끄고도 복구는 된다 — 실제로 고치는 것은 잔상 지우기(`clearInputArea`)와
             * 크기 정합·흔들기(SIGWINCH)이고, 0x0C 는 그 위에 얹은 "확실히 해두기" 였다.
             * 지운 자리의 입력창은 앱이 자기 렌더 주기에 다시 그린다(Claude Code 는 상태줄을
             * 매초 갱신하므로 즉시 돌아온다). 수동 복구는 흔들기까지 하므로 그 자리에서 돌아온다.
             *
             * 켜는 경우 — Ctrl+L 이 실제로 재렌더인 앱만 쓰거나, 셸에서 화면이 지워져도
             * 상관없을 때. 켜면 자동복구에도 적용되므로 오탐 한 번에 보고 있던 화면이 밀린다.
             */
            repairSendRedrawKey: false,

            /**
             * 작업 루트 전용 프로필을 만들고 기본 프로필로 삼는다.
             *
             * 에이전트 CLI 는 "어느 폴더에서 떴는가" 가 곧 작업 대상이라 새 탭마다 cd 하게 되는데,
             * 그걸 없애려는 기능이다. 기본은 꺼져 있다 — 남의 PC 에 설치되자마자 프로필을 만들고
             * 기본값을 가로채면 곤란하므로, 쓰려는 사람이 `rootProfileCwd` 를 채우고 켜야 한다.
             */
            rootProfile: false,
            rootProfileName: 'Agent Root',
            // 백슬래시 이스케이프 함정을 피하려고 슬래시로 적는다 (Windows 도 그대로 받는다)
            // 빈 값이면 프로필을 만들지 않는다
            rootProfileCwd: '',
            rootProfileCommand: 'powershell.exe',
            /**
             * -ExecutionPolicy Bypass 가 필요한 이유: npm 전역 명령(claude 등)은 .ps1 래퍼인데
             * 기본 실행 정책(Restricted)에서는 로드가 막힌다. 이 인자는 해당 세션에만 적용되고
             * 시스템/사용자 정책은 건드리지 않는다.
             */
            rootProfileArgs: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
            /**
             * 탭에 주입할 환경변수. Claude Code 등 TUI 는 이 값들이 없으면 색 지원을 낮게 잡아
             * 흑백에 가깝게 렌더된다 (Windows 는 TERM 이 기본으로 비어 있다).
             */
            rootProfileEnv: {
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                FORCE_COLOR: '3',
            },
            /** 기본 프로필 지정을 이미 했는지 — 사용자 선택을 매번 덮어쓰지 않기 위한 플래그 */
            rootProfileClaimed: false,

            /**
             * 창이 뒤에 있을 때(포커스 없음) 탭이 `승인대기`/`오류` 로 넘어가면 OS 쪽에 알린다.
             * 창이 앞에 있으면 세 항목 모두 아무 일도 하지 않는다 — 사이드바가 이미 보이고 있다.
             * 작업표시줄 아이콘을 깜빡인다(`flashFrame`). 창이 포커스를 받으면 멈춘다
             */
            alertFlash: true,
            /**
             * 작업표시줄 아이콘 위에 `승인대기`+`오류` 탭 개수를 뱃지로 얹는다.
             * Windows 는 `setBadgeCount` 가 없어 오버레이 아이콘(원+숫자)으로 그린다.
             * 이 값은 전이 순간이 아니라 상태가 바뀔 때마다 실제 개수로 갱신되고, 0 이면 지운다
             */
            alertBadge: true,
            /**
             * OS 토스트(`Notification`)까지 띄운다. 기본은 끔 — 탭이 여럿이면 시끄럽다.
             * 토스트를 누르면 창을 앞으로 가져오고 그 탭을 고른다
             */
            alertToast: false,
        },
        hotkeys: {
            'agentdeck-toggle': [],
            /**
             * Claude Code 는 0x0A(Ctrl+J)를 줄바꿈으로 받는다. Tabby 로 옮겨 왔으니
             * Ctrl+Enter / Shift+Enter 로도 같은 바이트를 보낸다
             */
            'agentdeck-newline': ['Ctrl-Enter', 'Shift-Enter'],
            /**
             * Tabby 순정 `paste` 대신 이걸 쓴다 — 클립보드가 이미지인지 텍스트인지 보고
             * 갈라야 하는데 순정 paste 는 텍스트만 알기 때문
             */
            'agentdeck-paste': ['Ctrl-V'],
            /**
             * 사이드바 목록에 키보드 포커스 (다시 누르면 터미널로 복귀).
             *
             * 기본값을 비워 두지 않은 이유 — 이것이 사이드바를 마우스 없이 만지는 **유일한
             * 진입점**이라(목록은 tabindex=-1, `wireListKeys`) 안 묶여 있으면 기능이 없는 것과
             * 같다. `Ctrl-L` 은 Tabby 순정 기본 핫키와 겹치지 않는다 — core·terminal·
             * local·settings 네 패키지의 기본 조합을 훑어 확인했다(2026-09-09):
             * 그쪽이 쓰는 것은 `Ctrl-Shift-{A,C,D,E,F,I,P,R,S,T,V,W,Z}`·방향키·Tab·PageUp/Down·
             * Backspace·`-` 이다. 다른 플러그인과 부딪히면 설정 창에서 바꾼다.
             */
            'agentdeck-focus-list': ['Ctrl-L'],
            /**
             * **사이드바에 보이는 순서로** N 번째 세션으로 건너뛴다 (`Ctrl-1` … `Ctrl-9`).
             *
             * Tabby 순정 `tab-1…tab-10` 과 다른 기능이다 — 그쪽은 `app.tabs`(탭 바의 순서)를 세고
             * 이쪽은 **사이드바 화면에 보이는 줄**을 센다. 정렬(`sortByStatus`)·그룹·검색·상태 필터가
             * 걸리면 둘은 어긋나고, 사람이 보고 있는 것은 사이드바다.
             *
             * 기본값이 `Ctrl-N` 인 근거 — Tabby 의 Windows/Linux 기본은 `tab-N` = `Alt-N` 이라
             * 겹치지 않는다(`tabby-core` 의 windows/linux 기본 핫키표). macOS 기본은 `⌘-N` 이라
             * 역시 겹치지 않는다. 터미널 쪽도 `Ctrl+숫자`는 제어문자를 내지 않으므로 뺏어도 잃는 키가
             * 없다.
             *
             * 9 까지만 두는 이유 — 열 번째부터는 눈으로 세는 것이 키를 누르는 것보다 느리다.
             * 그 위는 `Ctrl-L` 로 목록에 들어가 ↑↓ 로 간다
             */
            'agentdeck-jump-1': ['Ctrl-1'],
            'agentdeck-jump-2': ['Ctrl-2'],
            'agentdeck-jump-3': ['Ctrl-3'],
            'agentdeck-jump-4': ['Ctrl-4'],
            'agentdeck-jump-5': ['Ctrl-5'],
            'agentdeck-jump-6': ['Ctrl-6'],
            'agentdeck-jump-7': ['Ctrl-7'],
            'agentdeck-jump-8': ['Ctrl-8'],
            'agentdeck-jump-9': ['Ctrl-9'],
            /**
             * Common actions use Ctrl without Shift. Existing custom shortcuts remain saved.
             * Stock new-tab/rename-tab bindings are removed only when they overlap ours.
             */
            'agentdeck-new-tab': ['Ctrl-T', '⌘-T'],
            'agentdeck-view': ['Ctrl-O'],
            /** 패널의 파일 ↔ 변경 전환 — 기본은 미배정 (설정 창 단축키 절에서 매긴다) */
            'agentdeck-view-mode': [],
            'agentdeck-repair': ['Ctrl-R'],
        },
    }
}

/**
 * 우리 기본 핫키 표 — 설정 창 **단축키** 절의 `기본값` 버튼이 쓴다.
 *
 * `defaults` 는 인스턴스 필드라 클래스에서 바로 못 읽는다. ConfigProvider 는 생성자 의존이
 * 없으므로 하나 만들어 꺼내는 것이 가장 싸다. 순정 `close-pane` 은 우리 표에 없고
 * `agentDeck.closePaneKey` 가 원천이라 여기서 함께 얹는다(`ensureClosePaneHotkey` 와 같은 값).
 */
export function defaultHotkeys (): Record<string, string[]> {
    const p = new AgentDeckConfigProvider()
    const table = { ...(p.defaults.hotkeys as Record<string, string[]>) }
    table['split-right'] = ['Ctrl-S']
    table['split-bottom'] = ['Ctrl-D']
    const closePane = String(p.defaults.agentDeck.closePaneKey ?? '').trim()
    table['close-pane'] = closePane ? [closePane] : []
    return table
}
