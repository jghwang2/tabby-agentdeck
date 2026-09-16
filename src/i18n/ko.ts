/** 한국어 */
export default {
    'layout.title': '레이아웃 사용',
    'layout.desc': '끄면 사이드바와 고정폭 레이아웃이 사라지고 Tabby 순정 화면으로 돌아간다.',

    'reset.title': 'UI 배치 초기화',
    'reset.desc': '마우스로 바꾼 사이드바 위치와 크기를 처음 상태로 되돌린다 — 오른쪽 도킹 + 화면비로 자동 계산한 폭.',
    'reset.now': '지금: {dock} 도킹, {size}.',
    'reset.default': '지금은 기본 상태다.',
    'reset.btn': '초기화',

    'dock.left': '왼쪽',
    'dock.right': '오른쪽',
    'dock.top': '위쪽',
    'dock.bottom': '아래쪽',
    'size.width': '폭 {px}px',
    'size.height': '높이 {px}px',
    'size.auto': '폭 자동',

    'norecover.title': '기동 시 탭 복원 끄기',
    'norecover.desc': '켜면 Tabby 를 다시 열 때 지난 탭을 되살리지 않고 빈 상태로 시작한다 — '
        + '복원되는 건 셸뿐이고 그 안의 Claude 세션은 이미 끝나 있어 의미가 없다. '
        + '끄면 Tabby 순정 동작(<code>recoverTabs</code>)으로 돌아간다. 다음 기동부터 적용.',

    'resume.title': '지난 세션 이어받기',
    'resume.desc': '그룹 끝에 <code>⟲ 지난 세션</code> 서랍을 둔다 (기본 접힘). 펴면 <b>닫힌 Claude Code·Codex 세션</b>이 '
        + '그때 친 프롬프트로 보이고, 누르면 그 세션의 작업 폴더에서 <code>claude --resume</code> 또는 '
        + '<code>codex resume</code> 으로 대화가 되살아난다. 위의 <b>탭 복원 끄기</b> 와 한 쌍이다 — '
        + '순정 복원은 셸만 되살리지만 이건 대화를 되살린다. '
        + '<b>다만 그때 띄워 둔 서버·백그라운드 프로세스는 돌아오지 않는다.</b>',

    'agents.head': '에이전트 연동',
    'agents.intro': '에이전트가 자기 상태와 지금 쓰는 모델·한도를 <b>직접 알려주게</b> 한다. '
        + '이게 사이드바의 가장 정확한 원천이다 — 걸지 않으면 화면에 그려진 글자를 보고 '
        + '추측하는 방식으로 동작하고, 그만큼 판정이 흔들린다.',
    'agents.unsupported.title': '이 환경에서는 걸 수 없다',
    'agents.unsupported.desc': '통보 스크립트가 PowerShell 이라 Windows 에서만 동작한다. '
        + '상태는 출력 패턴으로 추측한다.',

    'state.on': '연동됨',
    'state.off': '연동 안 됨',
    'state.half': '반쪽 연동',
    'btn.install': '설치',
    'btn.remove': '제거',

    'claude.title': 'Claude 연동',
    'claude.desc': 'Claude Code 세션이 사이드바에서 <b>상태</b>(지시 받음 · 승인 대기 · 완료)와 '
        + '<b>모델 · 계정 · 한도 막대</b>로 보인다. <code>~/.claude/settings.json</code> 의 훅과 '
        + '<code>statusLine</code> 을 함께 걸고, 제거도 함께 한다. 다른 훅은 건드리지 않고, '
        + '이미 쓰던 <code>statusLine</code> 은 <b>그대로 실행해</b> 화면이 바뀌지 않는다. '
        + '쓰기 전에 같은 폴더에 백업을 남긴다.',

    'codex.title': 'Codex 연동',
    'codex.desc': 'Codex 세션이 사이드바에서 <b>상태</b>(진행 중 · 승인 대기 · 완료 · 중단)와 '
        + '<b>모델 · 계정 · 한도 막대</b>로 보인다. 설치 후 Codex 를 다시 열고 <code>/hooks</code> 에서 '
        + 'AgentDeck 훅을 검토·신뢰해야 동작한다.',

    'codex.disabled': 'Codex 가 이 훅들을 꺼 뒀다 — 켜기 전에는 아무것도 오지 않는다: {events}. Codex 에서 <code>/hooks</code> 로 들어가 신뢰할 것.',

    'root.head': '작업 루트 프로필',
    'root.intro': '새 탭이 항상 같은 작업 폴더에서 뜨도록 전용 프로필을 만든다. '
        + '변경은 Tabby 재시작 후 적용된다.',
    'root.use.title': '루트 프로필 사용',
    'root.use.desc': '켜고 작업 폴더를 채우면 해당 프로필을 만들어 기본 프로필로 삼는다.',
    'root.name.title': '프로필 이름',
    'root.cwd.title': '작업 폴더',
    'root.cwd.desc': '비우면 프로필을 만들지 않는다. 직접 적을 때는 백슬래시 이스케이프 함정을 피하려고 '
        + '슬래시로 적는다 (예: D:/Project).',
    'root.browse': '찾아보기',
    'root.command.title': '실행 명령',

    'diag.head': '문제 신고',
    'diag.intro': '버그를 만났을 때 <b>진단 로그를 모아 zip 하나로 만든다</b> — 만든 뒤 그 파일이 있는 폴더가 열린다. '
        + '담기는 것: 플러그인/Tabby 버전·OS, 위에 있는 설정 값, 그리고 <code>{path}</code> 의 최근 두 세대. '
        + '로그에는 <b>탭 제목과 열어 본 파일 경로</b>가 들어간다 — 보내기 전에 열어 확인해도 된다.',
    'diag.screen.title': '화면 원문까지 넣기',
    'diag.screen.desc': '화면이 깨지는 문제라면 켠다. 깨진 순간의 터미널 화면이 글자 그대로 들어가므로 '
        + '(작업 내용·코드가 보인다) 기본은 꺼져 있다.',
    'diag.collect.title': '진단 로그 모으기',
    'diag.collect.desc': '플러그인 v{version}.',
    'diag.made': '만들었다: ',
    'diag.btn': '모으기',

    'dev.head': '개발자 옵션',
    'dev.use.title': '개발자 옵션 사용',
    'dev.use.desc': '켜면 <b>라이브 리로드</b>가 돈다 — <code>npm run build</code> 로 '
        + '<code>dist/index.js</code> 가 바뀌면 <b>세션을 살린 채</b> 창을 리로드해 새 플러그인으로 갈아탄다 '
        + '(탭은 같은 pty 에 다시 붙는다). 단축키 탭의 <b>[개발] 플러그인 리로드</b> 도 이 스위치를 따라간다. '
        + '끄면 dist 가 바뀌어도 아무 일도 일어나지 않는다. '
        + '소스 트리 설치에서만 보이고 npm 배포본에는 이 기능이 없다.',
    'dev.now.title': '지금 리로드',
    'dev.now.desc': '빌드 없이 현재 dist 로 다시 띄운다.',
    'dev.btn': '리로드',

    'footer': '화면비·사이드바 폭·투명도·상태 감지·입력 처리 등 나머지 값은 기본값으로 고정돼 있다. '
        + '바꿔야 한다면 설정 파일의 <code>agentDeck.*</code> 를 직접 고친다. '
        + '단축키는 <b>단축키</b> 탭의 <code>agentdeck-*</code> 항목에서 바꾼다.',
}
