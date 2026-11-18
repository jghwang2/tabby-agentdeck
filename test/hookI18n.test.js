const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)

const { hookText } = require('../src/hookI18n.ts')

// English translations
assert.equal(hookText('view', 'en'), 'View hooks')
assert.equal(hookText('apply', 'en'), 'Install / Reinstall')
assert.equal(hookText('remove', 'en'), 'Remove hooks')
assert.equal(hookText('remove.managed', 'en'), 'Remove installed hooks only')
assert.equal(hookText('confirm.apply', 'en'), 'Apply')
assert.equal(hookText('confirm.cancel', 'en'), 'Cancel')
assert.equal(hookText('applied', 'en', { count: 2 }), 'Applied. 2 backup(s) saved. Reload hooks in your CLI or start a new session.')
assert.equal(hookText('readerror', 'en', { error: 'file missing' }), 'Could not read configuration: file missing')

// Korean translations
assert.equal(hookText('view', 'ko'), '훅 보기')
assert.equal(hookText('apply', 'ko'), '설치 / 다시 설치')
assert.equal(hookText('remove', 'ko'), '훅 제거')
assert.equal(hookText('remove.managed', 'ko'), '설치한 항목만 제거')
assert.equal(hookText('confirm.apply', 'ko'), '적용')
assert.equal(hookText('confirm.cancel', 'ko'), '취소')
assert.equal(hookText('applied', 'ko', { count: 3 }), '적용했습니다. 백업 3개. CLI에서 훅을 다시 불러오거나 새 세션을 시작하세요.')
assert.equal(hookText('readerror', 'ko', { error: '파일 없음' }), '설정을 읽지 못했습니다: 파일 없음')

// Fallback to English for other locales
assert.equal(hookText('view', 'de'), 'View hooks')
assert.equal(hookText('remove', 'ja'), 'Remove hooks')

// Unknown key returns key itself
assert.equal(hookText('unknown.key', 'en'), 'unknown.key')

console.log('PASS hookI18n: en/ko translations, parameter substitution, fallback')
