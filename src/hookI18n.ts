/**
 * AgentDeck hook management strings (English / Korean with English fallback).
 */

const en: Record<string, string> = {
    view: 'View hooks',
    'view.desc': 'Review AgentDeck registrations and dispatcher scripts across defaults and saved accounts.',
    apply: 'Install / Reinstall',
    'apply.desc': 'Install AgentDeck hooks with the latest configuration. Cleans up previously verified entries and re-registers.',
    remove: 'Remove hooks',
    'remove.managed': 'Remove installed hooks only',
    'remove.managed.desc': 'Removes only items matching install records. Earlier untracked hooks remain.',
    'remove.history': 'Find and remove using package history',
    'remove.history.desc': 'Finds and removes hooks matching past or present package formats. Custom-edited hooks remain.',
    'remove.reset': 'Remove all AgentDeck hooks',
    'remove.reset.desc': 'Removes all hooks verified by install records and release history. Unrecognized items remain.',
    'preview.aria': 'Hook full text and preview of changes',
    'preview.scope': 'Shows AgentDeck hooks only. Preserves hooks from other tools and Codex trust settings when removing.',
    'preview.source': 'Installed AgentDeck dispatcher code — {file}',
    'preview.apply': 'Apply changes',
    'preview.reload': 'Reload',
    'preview.close': 'Close',
    nochanges: 'No changes to apply. Review the current registration text and retention reasons below.',
    readerror: 'Could not read configuration: {error}',
    'confirm.title': 'AgentDeck — {action}',
    'confirm.detail': 'Removed {removed} · Added {added}\nOnly AgentDeck items shown in the preview will be modified, and backups will be saved.\nHooks from other tools are kept. Running CLIs may need to reload hooks or restart.\n\n',
    'confirm.apply': 'Apply',
    'confirm.cancel': 'Cancel',
    cancelled: 'Cancelled. Configuration was not changed.',
    applied: 'Applied. {count} backup(s) saved. Reload hooks in your CLI or start a new session.',
}

const ko: typeof en = {
    view: '훅 보기',
    'view.desc': '기본 설정과 저장된 계정의 AgentDeck 등록 내용 및 실행 코드를 확인합니다.',
    apply: '설치 / 다시 설치',
    'apply.desc': 'AgentDeck 훅을 최신 구성으로 설치합니다. 이미 설치했다면 확인된 기존 항목을 정리하고 다시 등록합니다.',
    remove: '훅 제거',
    'remove.managed': '설치한 항목만 제거',
    'remove.managed.desc': '설치 기록과 일치하는 항목만 제거합니다. 기록이 없는 예전 훅은 남습니다.',
    'remove.history': '배포 이력으로 찾아 제거',
    'remove.history.desc': '과거·현재 배포 형태와 일치하는 훅을 찾아 제거합니다. 직접 수정한 항목은 남습니다.',
    'remove.reset': 'AgentDeck 훅 모두 제거',
    'remove.reset.desc': '설치 기록과 배포 이력으로 확인된 훅을 모두 제거합니다. 출처를 확인할 수 없는 항목은 남습니다.',
    'preview.aria': '훅 전문과 변경 미리보기',
    'preview.scope': 'AgentDeck 훅만 표시합니다. 제거할 때도 다른 도구의 훅과 Codex 신뢰 설정은 유지합니다.',
    'preview.source': '현재 설치된 AgentDeck 전달기 코드 — {file}',
    'preview.apply': '변경 적용',
    'preview.reload': '다시 불러오기',
    'preview.close': '닫기',
    nochanges: '변경할 항목이 없습니다. 현재 등록 전문과 보존 사유를 확인하세요.',
    readerror: '설정을 읽지 못했습니다: {error}',
    'confirm.title': 'AgentDeck — {action}',
    'confirm.detail': '제거 {removed}개 · 추가 {added}개\n미리보기에 표시된 AgentDeck 항목만 변경하고 원본을 백업합니다.\n다른 도구의 훅은 유지합니다. 실행 중인 CLI는 훅 재로드 또는 재시작이 필요할 수 있습니다.\n\n',
    'confirm.apply': '적용',
    'confirm.cancel': '취소',
    cancelled: '취소했습니다. 설정을 변경하지 않았습니다.',
    applied: '적용했습니다. 백업 {count}개. CLI에서 훅을 다시 불러오거나 새 세션을 시작하세요.',
}

export function hookText (key: string, lang: string, params?: Record<string, string | number>): string {
    const table = lang === 'ko' ? ko : en
    const text = table[key] ?? en[key] ?? key
    if (!params) {
        return text
    }
    return text.replace(/\{(\w+)\}/g, (whole, name) => {
        const v = params[name]
        return v === undefined || v === null ? whole : String(v)
    })
}
