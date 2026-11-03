const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript')
const Module = require('node:module'), path = require('node:path')
const filename = path.resolve(__dirname, '../src/fileLinks.ts'), mod = new Module(filename, module)
mod.filename = filename; mod.paths = module.paths
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019},
}).outputText, filename)
const {fileLinkMatches, localLinkPath, installFileLinks} = mod.exports
for (const raw of ['D:\\docs\\notes.txt:10:3', './docs/a.md#L12C3', 'src/code.ts', '../data.csv']) {
    const [match] = fileLinkMatches(raw)
    assert(match, raw); assert.equal(raw.slice(match.start, match.end), raw)
    assert(!/[:#]\d/.test(match.path))
}
assert.equal(fileLinkMatches('"D:/한글 문서/a.txt"')[0].path, 'D:/한글 문서/a.txt')
assert.equal(fileLinkMatches('[문서](D:/docs/a.txt:12)')[0].path, 'D:/docs/a.txt')
assert.equal(fileLinkMatches('[문서](<D:/한글 문서/a.txt>)')[0].path, 'D:/한글 문서/a.txt')
assert.deepEqual(fileLinkMatches('[웹](https://example.com/a.txt)'), [])
assert.deepEqual(fileLinkMatches('www.example.com/docs/a.txt person@example.com'), [])
assert.deepEqual(fileLinkMatches('https://example.com/a.txt ssh://host/a.md 1.2.3'), [])
assert.equal(localLinkPath('javascript:alert(1)'), null)
assert.equal(localLinkPath('file:///D:/docs/a%20b.txt'), process.platform === 'win32' ? 'D:\\docs\\a b.txt' : '/D:/docs/a b.txt')
const {Terminal} = require('@xterm/headless')
;(async () => {
    const terminal = new Terminal({cols: 22, rows: 5, allowProposedApi: true})
    await new Promise(resolve => terminal.write('한글 "D:/문서 test/wrapped-file.txt"', resolve))
    let provider, registrations = 0, enabled = true, modifier = 'ctrlKey', external = 0
    const opened = []
    const frontend = {xterm: {cols: terminal.cols, buffer: terminal.buffer,
        options: {linkHandler: {activate() { external++ }}},
        registerLinkProvider(value) { provider = value; registrations++ },
    }}
    const install = () => installFileLinks(frontend, () => ({enabled, modifier}), file => opened.push(file))
    install(); install(); assert.equal(registrations, 1)
    let links
    provider.provideLinks(2, value => { links = value })
    assert.equal(links.length, 1)
    assert.deepEqual(links[0].range.start, {x:7, y:1})
    assert.equal(links[0].range.end.y, 2)
    links[0].activate({button:0}); assert.equal(opened.length, 0)
    links[0].activate({button:0, ctrlKey:true}); assert.equal(opened[0], 'D:/문서 test/wrapped-file.txt')
    modifier = null; links[0].activate({button:0}); assert.equal(opened.length, 2)
    links[0].activate({button:1}); assert.equal(opened.length, 2)
    enabled = false; links[0].activate({button:0}); assert.equal(opened.length, 2)
    enabled = true
    frontend.xterm.options.linkHandler.activate({button:0}, 'https://example.com', {})
    assert.equal(external, 1)
    frontend.xterm.options.linkHandler.activate({button:0}, 'file:///D:/docs/a.txt', {})
    assert.equal(opened.length, 3)
    frontend.xterm.options.linkHandler.activate({button:0}, 'javascript:alert(1)', {})
    assert.equal(external, 1)
    // A later Tabby decorator can replace the OSC handler; the next attach repairs it once.
    frontend.xterm.options.linkHandler = {activate() { external++ }}
    install(); install(); assert.equal(registrations, 1)
    frontend.xterm.options.linkHandler.activate({button:0}, 'https://example.com', {})
    assert.equal(external, 2)
    terminal.dispose()
    console.log('PASS file links: coordinates, wide cells, wrapping, quotes, suffixes, URI, modifiers, disabled, web delegation and reattach')
})().catch(error => { console.error(error); process.exitCode = 1 })
