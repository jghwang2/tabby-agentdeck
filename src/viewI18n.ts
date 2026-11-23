import { Lang } from './i18n'

// UI copy only: never pass file contents, paths, git hashes or user input here.
const EN: Record<string, string> = {
    // Toolbar & Navigation
    '미리보기': 'Preview',
    '찾기 (Ctrl+F)': 'Find (Ctrl+F)',
    '편집 (저장 Ctrl+S)': 'Edit (Save Ctrl+S)',
    '경로로 열기': 'Open path',
    '다시 읽기': 'Reload',
    '패널 닫기': 'Close panel',
    'D:/Project/... 또는 상대경로': 'D:/Project/... or relative path',
    '파일': 'File',
    '변경': 'Changes',
    '세션': 'Session',
    '전체': 'All',
    '변경 목록의 범위': 'Changes scope',
    '이 세션이 만진 파일만 보고 있다 — 누르면 저장소 전체': 'Showing files modified in this session — click to view entire repository',
    '저장소의 커밋 안 된 변경 전부를 보고 있다 — 누르면 이 세션이 만진 것만': 'Showing all uncommitted changes — click to show this session only',
    '찾기': 'Find',
    '이전 (Shift+Enter)': 'Previous (Shift+Enter)',
    '다음 (Enter)': 'Next (Enter)',
    '닫기 (Esc)': 'Close (Esc)',
    '저장': 'Save',
    '취소': 'Cancel',
    '커밋 메시지': 'Commit message',
    '커밋': 'Commit',
    '커밋 확인': 'Confirm commit',
    '한 번 더 누르면 실제로 커밋한다 (Esc 취소)': 'Press again to commit (Esc to cancel)',
    '메시지를 넣고 두 번 눌러야 커밋된다 — git commit -m': 'Enter a message and press again to commit — git commit -m',

    // Empty / Guide
    '에이전트가 만진 파일이 여기 쌓인다.': 'Files modified by agents will appear here.',
    '화면에 찍힌 경로를 자동으로 줍는다 (md · 이미지 · 표 · 코드)': 'Automatically detects file paths printed in the terminal (Markdown · images · tables · code)',
    '파일을 이 자리에 끌어다 놓아도 된다': 'You can also drag and drop files here',
    '<b>＋</b> 를 눌러 경로를 직접 넣을 수 있다': 'Click <b>＋</b> to open a path directly',

    // Path Input Notes
    '상대경로를 풀 작업 폴더를 모른다 — 절대경로로 넣는다': 'Cannot resolve relative path without working directory — enter an absolute path',
    '폴더 경로다 — 파일 이름까지 넣는다': 'Path is a directory — specify a file name',
    '폴더다 — 파일 이름까지 넣는다': 'Path is a directory — specify a file name',
    '없는 파일이다 — Enter 를 한 번 더 치면 새로 만든다': 'File does not exist — press Enter again to create it',
    '만들지 못했다: {error}': 'Could not create file: {error}',
    '만들었다 · {path}': 'Created · {path}',
    '열지 못했다 · {error}': 'Could not open: {error}',
    '폴더': 'Folder',
    '지금은 없다': 'No longer exists',

    // Edit Mode Notes & Status
    '저장하지 않은 편집이 있다 — 저장하거나 취소한 뒤에 모드를 옮긴다': 'You have unsaved changes — save or cancel before switching modes',
    '저장하지 않은 편집이 있다 — 저장하거나 취소한 뒤에 다른 파일을 연다': 'You have unsaved changes — save or cancel before opening another file',
    '다른 탭으로 옮겼다 — 저장하거나 취소하면 그 탭 파일로 넘어간다': 'Switched to another tab — save or cancel to view that tab’s file',
    '보기로 (Esc)': 'View mode (Esc)',
    '편집할 수 없는 형식이다': 'This file format cannot be edited',
    '이 형식은 편집할 수 없다': 'Cannot edit this file format',
    '읽지 못했다: {error}': 'Could not read: {error}',
    '너무 커서 편집할 수 없다 ({size} 넘음) — 보기 전용': 'File too large to edit (exceeds {size}) — view only',
    '바뀐 것이 없다': 'No changes to save',
    '밖에서 바뀐 파일이다 — 다시 누르면 덮어쓴다': 'File was modified externally — press again to overwrite',
    '저장하지 못했다: {error}': 'Could not save: {error}',
    '읽기 전용이다 (P4 면 p4 edit 먼저) — 다시 누르면 속성을 풀고 저장한다': 'File is read-only (run p4 edit first for P4) — press again to force save',
    '저장했다': 'Saved',
    '읽기 전용': 'Read-only',
    '고침': 'Modified',
    '그대로': 'Unchanged',
    '밖에서 바뀜': 'Modified externally',
    '파일이 사라졌다': 'File no longer exists',
    '읽지 못했다': 'Could not read file',
    '파일을 찾지 못했다': 'File not found',
    '이미지가 너무 크다': 'Image is too large',
    '빈 파일': 'Empty file',
    '없음': 'None',
    '… 앞부분만 보여준다 ({size})': '… showing first {size} only',
    '{n}행까지만 보여준다 (전체 {total}행)': 'Showing first {n} rows of {total}',
    '{n}줄까지만 보여준다 (전체 {total}줄)': 'Showing first {n} lines of {total}',
    '미리보기를 지원하지 않는 형식 · {size}': 'Preview not supported for this file type · {size}',

    // Git Diff & Repository
    '작업 폴더를 모른다': 'Working directory not detected',
    '이 탭의 cwd 를 아직 잡지 못했다 — 터미널에서 명령을 한 번 실행하면 잡힌다': 'Working directory not detected yet — run a command in the terminal to update it',
    '작업 폴더가 폴더가 아니다': 'Working directory is not a valid folder',
    '변경을 읽고 있다': 'Loading changes…',
    'git 저장소가 아니다': 'Not a git repository',
    '이 폴더는 git 으로 관리되지 않는다 — 무엇이 바뀌었는지(diff)는 비교할 기준이 없다': 'This folder is not a git repository — there is no baseline to compare changes',
    'git 을 찾지 못했다': 'git not found',
    'PATH 에 git 이 있어야 변경 내용을 비교할 수 있다': 'git must be in PATH to view changes',
    'git 이 없어 diff 는 만들 수 없다': 'Cannot create diff without git',
    '변경을 읽지 못했다': 'Could not read changes',
    '이 세션이 만진 파일 {count}개': '{count} files modified in this session',
    '… 이후 생략': '… remaining omitted',
    '… 이후 생략 (전체 {count}개 파일)': '… remaining omitted ({count} files total)',
    '… 이후 생략 (전체 {count}줄)': '… remaining omitted ({count} lines total)',
    '추적 안 됨 · {count}개': 'Untracked · {count}',
    '이 세션이 만진 파일은 아직 없다': 'No files modified in this session yet',
    '변경 없음': 'No changes',
    '{count}개 파일 · +{added} -{removed}': '{count} files · +{added} -{removed}',
    '1개 파일 · +{added} -{removed}': '1 file · +{added} -{removed}',
    '저장소에는 {count}개의 변경이 있다 — `전체` 로 보면 나온다': '{count} changes in repository — switch to All to view',
    '바이너리 · 내용 비교 없음': 'Binary file · no diff available',
    '내용 변경 없음': 'No content changes',
    '신규': 'New',
    '삭제': 'Deleted',
    '이름변경': 'Renamed',
    '수정': 'Modified',
    ' · 이 세션이 만진 것만 ({count}개 숨김)': ' · this session only ({count} hidden)',

    // Staging & Badges
    '올림': 'Staged',
    '일부': 'Partial',
    '새파일': 'Untracked',
    '충돌': 'Conflict',
    '안올림': 'Unstaged',
    '누르면 스테이지에서 내린다 — git reset -q -- {path}': 'Click to unstage — git reset -q -- {path}',
    '누르면 충돌 해결로 표시한다 — git add -- {path}': 'Click to mark resolved — git add -- {path}',
    '누르면 스테이지에 올린다 — git add -- {path}': 'Click to stage — git add -- {path}',
    '작업 폴더를 몰라 스테이지를 바꾸지 못한다': 'Working directory not detected — cannot stage files',
    '스테이지에 올렸다 · {path}': 'Staged · {path}',
    '스테이지에서 내렸다 · {path}': 'Unstaged · {path}',
    '스테이지를 바꾸지 못했다 · {error}': 'Failed to change stage · {error}',
    '커밋 메시지를 확인해야 한다': 'Commit message required',
    '스테이지에 올린 것이 없다 — 파일 목록의 딱지를 눌러 올려라': 'Nothing staged — click badges in the changes list to stage',
    '다시 누르면 커밋한다 (Esc 취소) · {summary}': 'Press again to commit (Esc to cancel) · {summary}',
    '작업 폴더를 몰라 커밋하지 못한다': 'Working directory not detected — cannot commit',
    '커밋했다 · {detail}': 'Committed · {detail}',
    '커밋하지 못했다 · {detail}': 'Commit failed · {detail}',

    // Commit Message Validation
    '커밋 메시지가 비어 있다 — 무엇을 바꿨는지 한 줄 적어야 커밋한다': 'Commit message is empty — enter a summary of changes to commit',
    '커밋 메시지에 NUL 문자가 들어 있다 — 그대로 넘기면 git 실행 자체가 실패한다': 'Commit message contains NUL character — git execution will fail',
    '공백·줄바꿈만 있다 — git 도 빈 메시지로 보고 커밋을 거절한다': 'Message contains only whitespace — git will reject as empty message',
    '메시지가 너무 길다 ({len}자 / 최대 {max}자)': 'Message is too long ({len} chars / max {max} chars)',

    // Terminal Line References
    '헝크 머리줄은 내용이 아니다 — 아래 줄을 고르면 그 자리를 가리킨다': 'Hunk header cannot be referenced — select a line below',
    '삭제된 줄은 지금 파일에 없다 — 옆 문맥줄을 고르면 그 자리를 가리킨다': 'Deleted lines are not in the current file — select an adjacent context line',
    '어느 파일의 줄인지 몰라 참조를 만들지 못했다': 'Could not create line reference — file unknown',
    '참조를 만들지 못했다 — 경로가 비어 있다': 'Could not create reference — path is empty',
    '터미널에 넣지 못했다 — 넣을 자리가 배선되지 않았다 · {text}': 'Could not insert into terminal — input handler not connected · {text}',
    '터미널에 넣지 못했다 — 넣을 터미널이 없다 · {text}': 'Could not insert into terminal — no active terminal · {text}',
    '터미널에 넣지 못했다 · {error}': 'Could not insert into terminal · {error}',
    '넣었다 · {text}': 'Inserted · {text}',
    ' (꼬리만)': ' (tail only)',
}

export const VIEW_KEYS = Object.keys(EN)

export function viewText (key: string, lang: Lang, params?: Record<string, string | number>): string {
    if (lang !== 'ko' && key === '이 세션이 만진 파일 {count}개' && Number(params?.count) === 1) {
        return '1 file modified in this session'
    }
    const text = lang === 'ko' ? key : (EN[key] ?? key)
    return text.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))
}

export function viewMarkup (html: string, lang: Lang): string {
    if (lang === 'ko') { return html }
    for (const key of Object.keys(EN).sort((a, b) => b.length - a.length)) {
        if (!key.includes('{')) { html = html.split(key).join(viewText(key, lang)) }
    }
    return html
}

export function localizeDiffStat (raw: string, lang: Lang): string {
    if (lang === 'ko' || !raw) { return raw }
    if (raw === '변경 없음') { return viewText('변경 없음', lang) }
    const m = /^(\d+)개 파일 · \+(\d+) -(\d+)$/.exec(raw)
    if (m) {
        const count = Number(m[1])
        const key = count === 1 ? '1개 파일 · +{added} -{removed}' : '{count}개 파일 · +{added} -{removed}'
        return viewText(key, lang, { count, added: m[2], removed: m[3] })
    }
    return raw
}

export function localizeStageSummary (raw: string, lang: Lang): string {
    if (lang === 'ko' || !raw) { return raw }
    if (raw === '변경 없음') { return viewText('변경 없음', lang) }
    return raw.replace(/(\d+)개 스테이지/g, '$1 staged')
        .replace(/(\d+)개 미스테이지/g, '$1 unstaged')
        .replace(/(\d+)개 추적안됨/g, '$1 untracked')
        .replace(/(\d+)개 충돌/g, (_, n) => n === '1' ? '1 conflict' : `${n} conflicts`)
}

export function localizeCommitReason (reason: string | undefined, lang: Lang): string {
    if (!reason || lang === 'ko') { return reason ?? '' }
    if (reason.includes('비어 있다')) {
        return viewText('커밋 메시지가 비어 있다 — 무엇을 바꿨는지 한 줄 적어야 커밋한다', lang)
    }
    if (reason.includes('NUL')) {
        return viewText('커밋 메시지에 NUL 문자가 들어 있다 — 그대로 넘기면 git 실행 자체가 실패한다', lang)
    }
    if (reason.includes('공백·줄바꿈만')) {
        return viewText('공백·줄바꿈만 있다 — git 도 빈 메시지로 보고 커밋을 거절한다', lang)
    }
    const m = /^메시지가 너무 길다 \((\d+)자 \/ 최대 (\d+)자\)$/.exec(reason)
    if (m) {
        return viewText('메시지가 너무 길다 ({len}자 / 최대 {max}자)', lang, { len: m[1], max: m[2] })
    }
    return viewText(reason, lang)
}
