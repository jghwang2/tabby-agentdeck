const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)

const { LANGUAGES, pickLang } = require('../src/i18n.ts')
const { VIEW_KEYS, viewText, viewMarkup, localizeDiffStat, localizeStageSummary, localizeCommitReason } = require('../src/viewI18n.ts')
const { fileNote } = require('../src/viewPanel.ts')

const params = value => (value.match(/\{\w+\}/g) || []).sort()

for (const key of VIEW_KEYS) {
    const en = viewText(key, 'en')
    assert.ok(en?.trim(), 'en: ' + key)
    assert.deepEqual(params(en), params(key), 'placeholders: ' + key)
    assert.ok(!/[가-힣]/.test(en), 'untranslated en: ' + key)
}

// User content and placeholder replacement
assert.equal(viewText('만들었다 · {path}', 'en', { path: 'src/main.ts' }), 'Created · src/main.ts')
assert.equal(viewText('만들었다 · {path}', 'ko', { path: 'src/main.ts' }), '만들었다 · src/main.ts')
assert.equal(viewText('이 세션이 만진 파일 {count}개', 'en', { count: 3 }), '3 files modified in this session')
assert.equal(viewText('이 세션이 만진 파일 {count}개', 'en', { count: 1 }), '1 file modified in this session')
assert.equal(viewText('이 세션이 만진 파일 {count}개', 'ko', { count: 3 }), '이 세션이 만진 파일 3개')
assert.equal(viewText('이 세션이 만진 파일 {count}개', 'ko', { count: 1 }), '이 세션이 만진 파일 1개')

// Preservation of user content in Korean
const userText = viewText('만들었다 · {path}', 'en', { path: '한글/경로/파일.txt' })
assert.ok(userText.includes('한글/경로/파일.txt'), 'user content in path is preserved')

// Markup replacement
const html = '<button title="찾기 (Ctrl+F)">🔍</button><span class="ad-view-title">미리보기</span>'
assert.equal(viewMarkup(html, 'ko'), html)
assert.equal(viewMarkup(html, 'en'), '<button title="Find (Ctrl+F)">🔍</button><span class="ad-view-title">Preview</span>')

// Fallback for unknown keys
assert.equal(viewText('알 수 없는 문장', 'en'), '알 수 없는 문장')
assert.equal(viewText('알 수 없는 문장', 'ko'), '알 수 없는 문장')

// fileNote localization
assert.equal(fileNote(__dirname, 'en'), 'Folder')
assert.equal(fileNote(__dirname, 'ko'), '폴더')
assert.equal(fileNote('nonexistent_path_xyz', 'en'), 'No longer exists')
assert.equal(fileNote('nonexistent_path_xyz', 'ko'), '지금은 없다')

// formatDiffStat localization
assert.equal(localizeDiffStat('변경 없음', 'en'), 'No changes')
assert.equal(localizeDiffStat('변경 없음', 'ko'), '변경 없음')
assert.equal(localizeDiffStat('1개 파일 · +10 -2', 'en'), '1 file · +10 -2')
assert.equal(localizeDiffStat('3개 파일 · +10 -2', 'en'), '3 files · +10 -2')
assert.equal(localizeDiffStat('3개 파일 · +10 -2', 'ko'), '3개 파일 · +10 -2')

// formatStageSummary localization (including plurals)
assert.equal(localizeStageSummary('변경 없음', 'en'), 'No changes')
assert.equal(localizeStageSummary('1개 스테이지', 'en'), '1 staged')
assert.equal(localizeStageSummary('2개 미스테이지 · 1개 충돌', 'en'), '2 unstaged · 1 conflict')
assert.equal(localizeStageSummary('2개 충돌', 'en'), '2 conflicts')
assert.equal(localizeStageSummary('3개 추적안됨', 'en'), '3 untracked')
assert.equal(localizeStageSummary('2개 충돌', 'ko'), '2개 충돌')

// localizeCommitReason localization
assert.equal(localizeCommitReason('커밋 메시지가 비어 있다', 'en'), 'Commit message is empty — enter a summary of changes to commit')
assert.equal(localizeCommitReason('커밋 메시지에 NUL 문자가 들어 있다', 'en'), 'Commit message contains NUL character — git execution will fail')
assert.equal(localizeCommitReason('공백·줄바꿈만 있다', 'en'), 'Message contains only whitespace — git will reject as empty message')
assert.equal(localizeCommitReason('메시지가 너무 길다 (120자 / 최대 100자)', 'en'), 'Message is too long (120 chars / max 100 chars)')
assert.equal(localizeCommitReason('공백·줄바꿈만 있다', 'ko'), '공백·줄바꿈만 있다')

console.log('PASS: view panel i18n, placeholder parity, user-content preservation')
