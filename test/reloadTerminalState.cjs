const assert = require('assert/strict')
const fs = require('fs'), vm = require('vm'), ts = require('typescript')
const moduleScope = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/reloadTerminalState.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, { module: moduleScope, exports: moduleScope.exports })
const preserve = moduleScope.exports.preserveReloadTerminalState
const token = id => ({ profile: { options: { restoreFromPTYID: id } }, savedState: 'old' })
const pane = (id, encoding, open = true) => ({ session: { open, getID: () => id }, frontend: {
    serializeAddon: { serialize (options) {
        assert.equal(options.excludeAltBuffer, false)
        assert.equal(options.excludeModes, false)
        return id + '-snapshot'
    } }, xterm: { _core: { coreMouseService: { activeEncoding: encoding } } },
} })
const root = { children: [token('a'), { children: [token('b'), token('stale')] }, token('closed')] }
preserve(root, [pane('b', 'SGR_PIXELS'), pane('closed', 'SGR', false), pane('a', 'SGR')])
assert.equal(root.children[0].savedState, 'a-snapshot\x1b[?1006h')
assert.equal(root.children[1].children[0].savedState, 'b-snapshot\x1b[?1016h')
assert.equal(root.children[1].children[1].savedState, 'old')
assert.equal(root.children[2].savedState, 'old')
preserve(root, [])
assert.equal(root.children[0].savedState, 'a-snapshot\x1b[?1006h')
const plain = token('plain')
preserve(plain, [pane('plain', 'DEFAULT')])
assert.equal(plain.savedState, 'plain-snapshot')
console.log('PASS reload snapshots: nested splits, exact PTY, closed/missing PTY, SGR and pixel encoding')
