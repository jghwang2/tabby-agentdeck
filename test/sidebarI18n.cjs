const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)
const { LANGUAGES, pickLang } = require('../src/i18n.ts')
const { SIDEBAR_LOCALES } = require('../src/sidebarLocales.ts')
const { SIDEBAR_KEYS, sidebarText, sidebarMarkup, sidebarReset, sidebarReason, RESET_COPY } = require('../src/sidebarI18n.ts')
const params = value => (value.match(/\{\w+\}/g) || []).sort()
assert.deepEqual(Object.keys(SIDEBAR_LOCALES).sort(), Object.keys(LANGUAGES).filter(x => !['en', 'ko'].includes(x)).sort())
for (const [lang, table] of Object.entries(SIDEBAR_LOCALES)) {
    assert.deepEqual(Object.keys(table).sort(), [...SIDEBAR_KEYS].sort(), lang + ' keys')
    for (const key of SIDEBAR_KEYS) {
        assert.ok(table[key]?.trim(), lang + ': ' + key)
        assert.deepEqual(params(table[key]), params(key), lang + ': ' + key)
        assert.ok(!/[가-힣]/.test(table[key]), lang + ': untranslated ' + key)
    }
}
for (const lang of Object.keys(LANGUAGES)) {
    assert.equal(RESET_COPY[lang].length, 5, lang + ' reset/availability')
    const value = sidebarText('세션 {id}', lang, { id: '한국어 제목 <tag> {name}' })
    assert.ok(value.includes('한국어 제목 <tag> {name}'), lang + ' user content is unchanged')
    assert.ok(!sidebarReset('1일 3시간 뒤 리셋', lang).includes('{time}'))
    if (lang !== 'ko') assert.ok(!/[가-힣]/.test(sidebarReset('1일 3시간 뒤 리셋', lang)))
    assert.ok(sidebarMarkup('<button title="새 탭">+ 새 탭</button>', lang).includes(sidebarText('+ 새 탭', lang)))
    assert.equal(sidebarReset('', lang), '')
    assert.equal(sidebarReason('사용자가 직접 쓴 문장', lang), '사용자가 직접 쓴 문장')
    assert.equal(sidebarReason('설정', lang), '설정')
    if (lang !== 'ko') assert.ok(!/[가-힣]/.test(sidebarReason('Bash 권한', lang)))
}
assert.equal(sidebarText('설정', pickLang('en-GB')), 'Settings')
assert.equal(sidebarText('설정', pickLang('en-US')), 'Settings')
assert.equal(sidebarText('설정', pickLang('ja-JP')), '設定')
assert.equal(sidebarText('설정', pickLang('zh-TW')), '設定')
assert.equal(sidebarText('설정', pickLang('ko-KR')), '설정')
console.log('PASS: 22 sidebar languages, complete keys/placeholders, reset labels, user-content preservation')
