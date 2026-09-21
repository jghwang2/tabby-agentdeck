import { Lang } from './i18n'
import { SIDEBAR_LOCALES } from './sidebarLocales'

// UI copy only: never pass session titles, prompts, paths or account names here.
const EN: Record<string, string> = {
    "계정 추가": "Add account",
    "계정 (이메일)": "Account (email)",
    "비밀번호": "Password",
    "계정과 비밀번호가 이 PC에 평문으로 저장됩니다.": "Your account and password are stored in plain text on this PC.",
    "저장": "Save",
    "취소": "Cancel",
    "계정과 비밀번호를 입력하세요.": "Enter an account and password.",
    "이미 등록된 계정입니다.": "This account is already saved.",
    "계정을 저장하지 못했습니다. 다시 시도하세요.": "Could not save the account. Try again.",
    "계정 파일을 읽지 못했습니다. JSON 형식을 확인하세요.": "Could not read the account file. Check its JSON format.",
    "+ 버튼으로 계정을 추가하세요.": "Use the + button to add an account.",
    '현재 탭에서 선택한 계정으로 전환합니다.': 'Switch to the selected account in this tab.',
    '세션 검색 (제목 · 작업이름 · 폴더)': 'Search sessions (title · task · folder)',
    '검색·필터 지우기 (Esc)': 'Clear search and filters (Esc)',
    '계정 선택': 'Select account', '새 탭': 'New tab', '+ 새 탭': '+ New tab', '설정': 'Settings',
    '화면 복구 (모든 탭 다시 그리기)': 'Repair display (redraw all tabs)',
    '미리보기 패널 (md · 이미지 · 표)': 'Preview panel (Markdown · images · tables)',
    '진행중': 'Working', '승인대기': 'Awaiting approval', '한도 도달': 'Usage limit reached',
    '완료': 'Done', '오류': 'Error', '대기': 'Idle', '기타': 'Other',
    '지난 세션': 'Past sessions', '어제': 'Yesterday', '● 열림': '● Open',
    '탭 닫기': 'Close tab', '(제목 없음)': '(Untitled)', '작업 이름': 'Task name',
    '닫기': 'Close', '모름': 'Unknown',
    '닫힌 Claude Code · Codex 세션 — 누르면 그 대화를 이어받는다': 'Closed Claude Code · Codex sessions — click to resume',
    '검색어와 맞는 지난 세션이 없다': 'No past sessions match your search',
    'Esc 또는 ✕ 로 전체 목록으로 돌아간다': 'Press Esc or ✕ to show all sessions',
    '상태순 정렬이 켜져 있어 순서를 바꿀 수 없다 — 설정에서 끄면 끌어서 옮길 수 있다': 'Turn off status sorting in Settings to reorder tabs',
    '이 탭으로 이동': 'Go to tab', '새 탭에서 이어받기': 'Resume in new tab',
    '분기해서 이어받기': 'Fork conversation', '세션 ID 복사': 'Copy session ID', '목록에서 숨기기': 'Hide from list',
    '↺ 자동 감지로': '↺ Detect automatically', '↻ 화면 복구': '↻ Repair display',
    '패널에 띄우기': 'Open in panel', '경로 붙여넣기': 'Paste path',
    '아무것도 하지 않는다': 'Cancel', '다시 묻지 않기': 'Do not ask again',
    '{name} 을 어떻게 할까요?': 'What would you like to do with {name}?',
    '{provider} 계정 선택': 'Select {provider} account', '{provider} 계정': '{provider} accounts',
    '선택한 계정으로 이 대화를 새 탭에서 이어갑니다.': 'Continue this conversation in a new tab with the selected account.',
    '선택한 계정으로 새 대화를 엽니다.': 'Start a new conversation with the selected account.',
    '등록된 계정이 없습니다. accounts.json을 채워주세요.': 'No saved accounts. Add accounts to accounts.json.',
    ' · 현재 계정': ' · Current account', '잔량 조회 중…': 'Loading usage…',
    '계정 저장 폴더를 준비하지 못했습니다.': 'Could not prepare the account folder.',
    '사용량 정보 없음': 'Usage unavailable',
    '원래 탭이 닫혔습니다. 계정 목록을 다시 여세요.': 'The original tab was closed. Reopen the account list.',
    '{name} 인증 확인 중…': 'Checking authentication for {name}…',
    '{name}: 열린 브라우저에서 로그인하세요. 인증정보는 자동 저장됩니다.': '{name}: Sign in using the browser. Authentication will be saved automatically.',
    '인증을 저장했습니다. 원래 탭이 닫혀 새 대화에서 계정을 선택해야 합니다.': 'Authentication saved. The original tab was closed; select the account in a new conversation.',
    '계정 전환에 실패했습니다. 다시 선택하세요.': 'Could not switch accounts. Please try again.',
    '새 계정 탭을 열지 못했습니다.': 'Could not open the account tab.',
    '세션 {id}': 'Session {id}',
    '이미 열려 있다 — 누르면 그 탭으로 이동': 'Already open — click to go to the tab',
    '누르면 새 탭에서 이어받는다 ({id})': 'Click to resume in a new tab ({id})',
    '작업 폴더: {cwd}': 'Working folder: {cwd}',
    '※ 대화만 돌아온다 — 그때 띄워 둔 서버·백그라운드 프로세스는 되살아나지 않는다': 'Only the conversation resumes; servers and background processes are not restarted.',
    '{filter}에 걸리는 세션이 없다 (전체 {total}개)': 'No sessions match {filter} ({total} total)',
    ' · 검색에 걸린 세션이 있어 임시로 펴 둠 (검색을 지우면 다시 접힌다)': ' · Expanded for search results (clear search to collapse)',
    '{folder} (탭 {count}개) — 클릭하면 접기/펴기': '{folder} ({count} tabs) — click to collapse/expand',
    '작업 폴더를 아직 모르는 탭 {count}개 — 클릭하면 접기/펴기': '{count} tabs without a known working folder — click to collapse/expand',
    '탭 {count}개': '{count} tabs',
    '{status} {count} — 클릭하면 필터 해제': '{status} {count} — click to clear filter',
    '{status} {count} — 클릭하면 이 상태만': '{status} {count} — click to filter',
    '{n}초': '{n}s', '{n}분': '{n}m', '{h}시간 {m}분': '{h}h {m}m',
    '계정: {value}': 'Account: {value}', '버전: {value}': 'Version: {value}', '폴더: {value}': 'Folder: {value}',
    '{tool} 권한': '{tool} permission', '입력 대기': 'Waiting for input', '플랜 승인': 'Plan approval',
    '질문 응답': 'Answer a question', '{time} 리셋': 'Reset: {time}',
}

export const SIDEBAR_KEYS = Object.keys(EN)
const TABLES: Record<string, Record<string, string>> = { en: EN, ...SIDEBAR_LOCALES }

export function sidebarText (key: string, lang: Lang, params?: Record<string, string | number>): string {
    const text = lang === 'ko' ? key : (TABLES[lang]?.[key] ?? EN[key] ?? key)
    return text.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))
}

/** Only fixed markup authored by this plugin; user content is inserted separately via textContent. */
export function sidebarMarkup (html: string, lang: Lang): string {
    if (lang === 'ko') { return html }
    for (const key of Object.keys(EN).sort((a, b) => b.length - a.length)) {
        if (!key.includes('{')) { html = html.split(key).join(sidebarText(key, lang)) }
    }
    return html
}

/** Translate only the known forms emitted by reason.ts; preserve unrecognized hook content. */
export function sidebarReason (reason: string, lang: Lang): string {
    const tool = /^(\w+) 권한$/.exec(reason)
    if (tool) { return sidebarText('{tool} 권한', lang, { tool: tool[1] }) }
    const reset = /^(.*) 리셋$/.exec(reason)
    if (reset) { return sidebarText('{time} 리셋', lang, { time: reset[1] }) }
    return ['입력 대기', '플랜 승인', '질문 응답'].includes(reason) ? sidebarText(reason, lang) : reason
}

export function sidebarReset (text: string, lang: Lang): string {
    if (!text || lang === 'ko') { return text }
    const copy = RESET_COPY[lang] ?? RESET_COPY.en
    if (text === '곧 리셋') { return copy[0] }
    const duration = text.replace(/(\d+)(일|시간|분)/g, (_, n, unit) => new Intl.NumberFormat(lang, {
        style: 'unit', unit: ({ 일: 'day', 시간: 'hour', 분: 'minute' } as Record<string, string>)[unit], unitDisplay: 'narrow',
    }).format(Number(n))).replace(/ 뒤(?: 리셋)?$/, '')
    return (text.endsWith('리셋') ? copy[1] : copy[2]).replace('{time}', duration)
}

// Reset labels and availability status share the same locale as the surrounding gauges.
export const RESET_COPY: Record<string, string[]> = {
    en: ['Resets soon', 'Resets in {time}', '{time} remaining', 'Available', 'Currently unavailable'],
    ko: ['곧 리셋', '{time} 뒤 리셋', '{time} 뒤', '사용 가능', '현재 사용 불가'],
    af: ['Herstel binnekort', 'Herstel oor {time}', '{time} oor', 'Beskikbaar', 'Tans nie beskikbaar nie'],
    bg: ['Скоро се нулира', 'Нулиране след {time}', 'Остават {time}', 'Налично', 'В момента недостъпно'],
    cs: ['Brzy se obnoví', 'Obnovení za {time}', 'Zbývá {time}', 'Dostupné', 'Momentálně nedostupné'],
    da: ['Nulstilles snart', 'Nulstilles om {time}', '{time} tilbage', 'Tilgængelig', 'Ikke tilgængelig nu'],
    de: ['Wird bald zurückgesetzt', 'Zurücksetzung in {time}', 'Noch {time}', 'Verfügbar', 'Derzeit nicht verfügbar'],
    es: ['Se restablece pronto', 'Se restablece en {time}', 'Quedan {time}', 'Disponible', 'No disponible actualmente'],
    fr: ['Réinitialisation imminente', 'Réinitialisation dans {time}', 'Encore {time}', 'Disponible', 'Actuellement indisponible'],
    hr: ['Uskoro se poništava', 'Poništavanje za {time}', 'Preostaje {time}', 'Dostupno', 'Trenutno nedostupno'],
    id: ['Segera direset', 'Direset dalam {time}', 'Tersisa {time}', 'Tersedia', 'Saat ini tidak tersedia'],
    it: ['Ripristino imminente', 'Ripristino tra {time}', 'Mancano {time}', 'Disponibile', 'Attualmente non disponibile'],
    ja: ['まもなくリセット', '{time}後にリセット', 'あと{time}', '利用可能', '現在利用不可'],
    pl: ['Wkrótce odnowienie', 'Odnowienie za {time}', 'Pozostało {time}', 'Dostępne', 'Obecnie niedostępne'],
    pt: ['Reinicia em breve', 'Reinicia em {time}', 'Restam {time}', 'Disponível', 'Indisponível no momento'],
    ru: ['Скоро сброс', 'Сброс через {time}', 'Осталось {time}', 'Доступно', 'Сейчас недоступно'],
    sr: ['Ускоро се поништава', 'Поништавање за {time}', 'Преостало {time}', 'Доступно', 'Тренутно недоступно'],
    sv: ['Återställs snart', 'Återställs om {time}', '{time} kvar', 'Tillgänglig', 'Inte tillgänglig just nu'],
    tr: ['Yakında sıfırlanacak', '{time} sonra sıfırlanacak', '{time} kaldı', 'Kullanılabilir', 'Şu anda kullanılamıyor'],
    uk: ['Незабаром скидання', 'Скидання через {time}', 'Залишилося {time}', 'Доступно', 'Зараз недоступно'],
    'zh-CN': ['即将重置', '{time}后重置', '剩余{time}', '可用', '当前不可用'],
    'zh-TW': ['即將重設', '{time}後重設', '剩餘{time}', '可用', '目前無法使用'],
}
