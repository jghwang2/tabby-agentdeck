const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)

const { ViewPanel } = require('../src/viewPanel.ts')
const { hookText } = require('../src/hookI18n.ts')

// 1. Verify hookText localization
assert.equal(hookText('view', 'en'), 'View hooks')
assert.equal(hookText('apply', 'en'), 'Install / Reinstall')
assert.equal(hookText('remove', 'en'), 'Remove hooks')
assert.equal(hookText('remove.managed', 'en'), 'Remove installed hooks only')
assert.equal(hookText('view', 'ko'), '훅 보기')
assert.equal(hookText('apply', 'ko'), '설치 / 다시 설치')
assert.equal(hookText('remove', 'ko'), '훅 제거')
assert.equal(hookText('remove.managed', 'ko'), '설치한 항목만 제거')

// 2. Verify ViewPanel discovery with screenTextFor and noteFile
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-discovery-'))
try {
    const tab = {}
    const sampleFile = path.join(root, 'generated-artifact.md')
    fs.writeFileSync(sampleFile, '# Generated Artifact\nContent here.')

    const screenSample = path.join(root, 'screen-detected.ts')
    fs.writeFileSync(screenSample, 'export const answer = 42\n')

    let touched = []
    let screenText = `Some agent output mentioning ${screenSample} and running tests.`

    const panel = new ViewPanel({
        cwdFor: () => root,
        getRecentMax: () => 10,
        getFollowMode: () => 'show',
        touchedFor: () => touched,
        screenTextFor: () => screenText,
        setOpen: () => {},
        commit: () => {},
        relayout: () => {},
        openExternal: () => {},
    })

    // Simulated noteFile from onFileHook
    panel.noteFile(tab, sampleFile)
    assert.deepEqual(panel.recent.get(tab), [sampleFile])

    // Screen text discovery on fresh tab
    const freshTab = {}
    panel.setActiveTab(freshTab)
    assert.deepEqual(panel.recent.get(freshTab), [screenSample])

    console.log('PASS view panel discovery: hook-reported files, screen-scraped files, i18n')
} finally {
    fs.rmSync(root, { recursive: true, force: true })
}
