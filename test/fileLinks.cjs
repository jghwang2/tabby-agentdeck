const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript')
const Module = require('node:module'), path = require('node:path')
const filename = path.resolve(__dirname, '../src/fileLinks.ts'), mod = new Module(filename, module)
mod.filename = filename; mod.paths = module.paths
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019},
}).outputText, filename)
const {fileLinkMatches, localLinkPath, installFileLinks, FileLinkLookup} = mod.exports
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
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'file-link-test-'))
    const actual = path.join(dir, 'real.txt')
    fs.writeFileSync(actual, 'exists')
    let calls = 0
    const lookup = new FileLinkLookup(async file => { calls++; return fs.promises.stat(file) })
    assert.equal(await lookup.resolve('real.txt', dir), actual)
    assert.equal(await lookup.resolve('absent.txt', dir), null)
    assert.equal(await lookup.resolve(dir, null), null)
    await Promise.all(Array.from({length:100}, () => lookup.resolve('real.txt', dir)))
    assert.equal(calls, 3, 'repeated hovers share cached filesystem results')
    fs.unlinkSync(actual)
    assert.equal(await lookup.resolve(actual, null, true), null, 'click rechecks removed files')
    fs.writeFileSync(actual, 'created again')
    await new Promise(resolve => setTimeout(resolve, 1550))
    assert.equal(await lookup.resolve(actual, null), actual, 'negative cache expires')
    assert.equal(await lookup.resolve('real.txt', null), null, 'unknown cwd never uses the app cwd')
    let finishSlow
    const slow = new FileLinkLookup(() => new Promise(resolve => { finishSlow = resolve }))
    assert.equal(await slow.resolve(actual, null), null, 'slow check returns without blocking other links')
    finishSlow({isFile: () => true})
    assert.equal(await slow.resolve(actual, null), actual)
    fs.rmSync(dir, {recursive:true})
    const terminal = new Terminal({cols: 22, rows: 5, allowProposedApi: true})
    await new Promise(resolve => terminal.write('한글 "D:/문서 test/wrapped-file.txt"', resolve))
    let provider, registrations = 0, enabled = true, modifier = 'ctrlKey', external = 0
    const opened = []
    let nativeFile = 'file:///D:/exists.txt'
    const nativeProvider = {provideLinks: (_, done) => done([
        {text:nativeFile, range:{start:{x:1,y:1},end:{x:5,y:1}}},
        {text:'file:///D:/absent.txt', range:{start:{x:6,y:1},end:{x:9,y:1}}},
        {text:'https://example.com', activate() { external++ }},
    ])}
    const frontend = {__adFileLinkLookup: new FileLinkLookup(async file => ({isFile:()=>!file.includes('absent')})),
        xterm: {cols: terminal.cols, buffer: terminal.buffer,
        _core:{_linkProviderService:{linkProviders:[nativeProvider]}},
        options: {linkHandler: {activate() { external++ }}},
        registerLinkProvider(value) { provider = value; registrations++ },
    }}
    const install = () => installFileLinks(frontend, () => ({enabled, modifier}), file => opened.push(file))
    install(); install(); assert.equal(registrations, 1)
    let links = await new Promise(resolve => provider.provideLinks(2, resolve))
    assert.equal(links.length, 1)
    assert.deepEqual(links[0].range.start, {x:7, y:1})
    assert.equal(links[0].range.end.y, 2)
    links[0].activate({button:0}); assert.equal(opened.length, 0)
    links[0].activate({button:0, ctrlKey:true}); await new Promise(setImmediate)
    assert.equal(opened[0], path.resolve('D:/문서 test/wrapped-file.txt'))
    modifier = null; links[0].activate({button:0}); await new Promise(setImmediate); assert.equal(opened.length, 2)
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
    const nativeLinks = await new Promise(resolve => nativeProvider.provideLinks(1, resolve))
    assert.deepEqual(nativeLinks.map(link=>link.text), ['file:///D:/exists.txt','https://example.com'])
    nativeLinks[1].activate({button:0}); assert.equal(external,3)
    let delayed
    frontend.__adFileLinkLookup.stat = () => new Promise(resolve => { delayed=resolve })
    nativeFile = 'file:///D:/new.txt'
    const pending = new Promise(resolve => nativeProvider.provideLinks(1, resolve))
    await new Promise(resolve => terminal.write('\x1b[Hchanged', resolve))
    delayed({isFile:()=>true})
    const stale = await pending
    assert.deepEqual(stale, [], 'changed terminal rows discard stale asynchronous answers')
    terminal.dispose()
    console.log('PASS file links: async file checks, missing/directories, cache, deletion, expiry, slow checks, stale rows, native fallback, coordinates, wrapping, URI, modifiers, web delegation and reattach')
})().catch(error => { console.error(error); process.exitCode = 1 })
