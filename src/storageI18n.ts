const en = {
    head: 'Storage locations',
    intro: 'Folder selections and completed edits are saved automatically. Applies after restarting Tabby. Empty fields use the defaults shown below. Existing files are not moved. To keep your accounts and history, close all agent sessions and copy the old folders to the new locations before restarting.',
    default: 'Default', pending: 'Unsaved changes — saves when you finish editing or leave this page.',
    accountStorageDir: 'Account data folder',
    claudeStorageDir: 'Claude data folder',
    codexStorageDir: 'Codex data folder',
    accounts: 'Contains the account list and each account’s private sign-in data.',
    agents: 'Contains shared conversations, settings and skills. Generated code and documents stay in the working folder below. Explicit terminal-profile paths take precedence.',
    save: 'Save paths', reset: 'Use defaults',
    saved: 'Paths and Windows user environment variables saved. Fully restart Tabby and your agents to apply. Running sessions keep their current folders.',
    environment: 'Could not update the Windows user environment variables. Your input has been kept; retry saving.',
    environmentRollback: 'Saving failed and the environment variables could not be restored. Retry saving before restarting.',
    absolute: 'Enter an absolute folder path.', directory: 'The selected path is a file. Choose a folder.',
    separate: 'Use separate, non-nested folders for account, Claude and Codex data.',
    failed: 'Could not save the paths. Your input has been kept. Check disk space and folder access, then retry Save paths.',
    working: 'Changes apply to new tabs. Existing working files are not moved.',
}
const ko: typeof en = {
    head: '저장 경로',
    intro: '폴더를 선택하거나 입력을 마치면 자동 저장됩니다. Tabby를 다시 시작하면 적용됩니다. 빈칸은 표시된 기본 경로를 사용합니다. 기존 파일은 자동 이동하지 않습니다. 계정과 기록을 유지하려면 모든 에이전트 세션을 종료하고 기존 폴더를 새 위치에 복사한 뒤 다시 시작하세요.',
    default: '기본값', pending: '저장 전 변경사항이 있습니다. 입력을 마치거나 이 화면을 나가면 자동 저장합니다.',
    accountStorageDir: '계정 데이터 폴더', claudeStorageDir: 'Claude 데이터 폴더', codexStorageDir: 'Codex 데이터 폴더',
    accounts: '등록 계정 목록과 계정별 로그인 정보를 저장합니다.',
    agents: '공유 대화 기록·설정·스킬을 저장합니다. 작성한 코드와 문서는 아래 작업 폴더에 저장됩니다. 터미널 프로필에 직접 지정한 경로가 있으면 그 값을 우선합니다.',
    save: '경로 저장', reset: '기본값 사용',
    saved: '경로와 Windows 사용자 환경변수를 저장했습니다. Tabby와 에이전트를 완전히 종료한 뒤 다시 실행하세요. 실행 중인 세션은 현재 폴더를 계속 사용합니다.',
    environment: 'Windows 사용자 환경변수를 저장하지 못했습니다. 입력값은 유지됩니다. 다시 저장하세요.',
    environmentRollback: '저장 실패 후 환경변수를 복원하지 못했습니다. 다시 시작하기 전에 경로 저장을 재시도하세요.',
    absolute: '폴더의 절대 경로를 입력하세요.', directory: '파일 경로입니다. 폴더를 선택하세요.',
    separate: '계정·Claude·Codex 폴더는 서로 겹치거나 포함되지 않는 별도 경로로 지정하세요.',
    failed: '저장하지 못했습니다. 입력한 경로는 유지했습니다. 디스크 여유 공간과 폴더 권한을 확인한 뒤 경로 저장을 다시 누르세요.',
    working: '새 탭부터 적용됩니다. 기존 작업 파일은 이동하지 않습니다.',
}
export function storageText (key: string, lang: string): string {
    return (lang === 'ko' ? ko : en)[key.replace(/^storage\./, '')] || key
}
