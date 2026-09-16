const assert = require('node:assert/strict')
const ts = require('typescript'), fs = require('fs')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)
const { installCodexWheel } = require('../src/codexWheel.ts')
const composer = ['history', '› draft', '', 'gpt-6-astra · Ready · Context 71% left']
const pager = ['/ T R A N S C R I P T / /', 'old output', '↑/↓ to scroll', ' q close   esc to edit prev']
let screen = composer, callback, enabled = true
const sent = []
const buffer = { baseY: 0, type: 'normal', getLine: i => ({ translateToString: () => screen[i] }) }
const frontend = { xterm: { rows: 4, buffer: { active: buffer }, element: {
    addEventListener: (type, handler, options) => { assert.equal(type, 'wheel'); assert.equal(options.passive, false); callback = handler },
} } }
const timers = [], originalTimer = global.setTimeout
global.setTimeout = fn => timers.push(fn)
const wheel = (deltaY, extra = {}) => {
    let prevented = false
    callback({ deltaY, deltaX: 0, deltaMode: 0, preventDefault: () => { prevented = true }, stopImmediatePropagation: () => {}, ...extra })
    return prevented
}
try {
    installCodexWheel(frontend, () => enabled, data => sent.push(data))
    assert.equal(wheel(-120, { ctrlKey: true }), false, 'zoom modifiers pass through')
    buffer.baseY = 100
    assert.equal(wheel(-120), false, 'native terminal scrollback stays native')
    buffer.baseY = 0
    enabled = false
    assert.equal(wheel(-120), false, 'CMD and Claude are unaffected')
    enabled = true
    screen = ['Approve?', '', '', 'Context is mentioned in prose']
    assert.equal(wheel(-120), false, 'approval screen does not receive keys')
    screen = composer
    assert.equal(wheel(120), false)
    assert.equal(wheel(-120), true)
    assert.deepEqual(sent, ['\x14'], 'open transcript without altering the draft')
    timers.shift()()
    assert.deepEqual(sent, ['\x14'], 'no arrow keys before pager confirmation')
    screen = pager
    timers.shift()()
    assert.deepEqual(sent, ['\x14', '\x1b[A'.repeat(3)])
    assert.equal(wheel(120), true)
    assert.equal(sent.at(-1), '\x1b[B'.repeat(3))
    screen = composer
    wheel(-120)
    enabled = false
    const count = sent.length
    while (timers.length) timers.shift()()
    assert.equal(sent.length, count, 'pending navigation is cancelled when Codex exits')
    enabled = true
    screen = [...composer, '', '', '', '', '', '']
    frontend.xterm.rows = screen.length
    assert.equal(wheel(-120), true, 'a short Codex conversation has blank rows below its composer')
    assert.equal(sent.at(-1), '\x14')
    enabled = false
    while (timers.length) timers.shift()()
} finally { global.setTimeout = originalTimer }
console.log('PASS: Codex wheel pager, draft guard, native scrollback and lifecycle')
