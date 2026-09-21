const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)
const { ViewPanel } = require('../src/viewPanel.ts')
const { isInstructionFile } = require('../src/viewer.ts')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-instructions-'))
try {
    const tab = {}
    let touched = []
    const panel = new ViewPanel({ cwdFor: () => root, getRecentMax: () => 20,
        getFollowMode: () => 'manual', touchedFor: () => touched })
    const names = ['CLAUDE.md', 'SKILL.md', 'AGENTS.md', 'CLAUDE.local.md', 'AGENTS.override.md', 'report.md']
    for (const name of names) fs.writeFileSync(path.join(root, name), '# ' + name)
    const scrape = text => { panel.buffers.set(tab, text + '\n'); panel.scrape(tab) }
    scrape(names.join('\n'))
    assert.deepEqual(panel.recent.get(tab), [path.join(root, 'report.md')])
    assert.equal(isInstructionFile('C:\\Users\\me\\skills\\skill.MD'), true)
    assert.equal(isInstructionFile('/work/my-skill.md'), false)
    touched = [path.join(root, 'SKILL.md')]
    scrape('SKILL.md')
    assert.equal(panel.recent.get(tab)[0], touched[0])
    panel.noteFile(tab, 'CLAUDE.md')
    scrape('CLAUDE.md')
    assert.equal(panel.recent.get(tab)[0], path.join(root, 'CLAUDE.md'))
    scrape('AGENTS.md\nreport.md')
    assert.equal(panel.recent.get(tab).includes(path.join(root, 'AGENTS.md')), false)
    assert.equal(panel.recent.get(tab)[0], path.join(root, 'report.md'))
    console.log('PASS: passive instruction reads excluded; artifacts, edits and explicit selection retained')
} finally {
    fs.rmSync(root, { recursive: true, force: true })
}
