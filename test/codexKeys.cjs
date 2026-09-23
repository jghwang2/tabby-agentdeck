const assert = require('node:assert/strict')
const ts = require('typescript'), fs = require('fs')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)
const { installCodexKeys } = require('../src/codexKeys.ts')
let handler, enabled = true, installed = 0
const sent = []
const frontend = { xterm: { element: { addEventListener(type, fn, options) {
    assert.equal(type, 'keydown'); assert.equal(options.capture, true); handler = fn; installed++
} } } }
const install = () => installCodexKeys(frontend, () => enabled, data => sent.push(data))
install(); install(); assert.equal(installed, 1)
function press(extra = {}) {
    let prevented = false
    handler({ key: 'ArrowUp', altKey: true, preventDefault() { prevented = true }, stopImmediatePropagation() {}, ...extra })
    return prevented
}
assert.equal(press(), true); assert.deepEqual(sent, ['\x1b[1;3A'])
for (const extra of [{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }, { isComposing: true }, { altKey: false }, { key: 'ArrowDown' }]) {
    assert.equal(press(extra), false)
}
enabled = false; assert.equal(press(), false); assert.equal(sent.length, 1)
console.log('Codex question key: modifier preservation, scope, composition and duplicate install passed')
