const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const scope = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/imeCommit.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, { exports: scope.exports })
const { installImeCommitGuard } = scope.exports

// Exercise the installed terminal's real CompositionHelper, including its timers.
const bundle = fs.readFileSync('node_modules/tabby-terminal/dist/index.js', 'utf8')
const anchor = bundle.indexOf('  compositionstart() {')
assert.ok(anchor > 0, 'installed xterm composition implementation must be found')
const start = bundle.lastIndexOf('var ', anchor), end = bundle.indexOf('\n};', anchor) + 3
const code = bundle.slice(start, end), name = code.match(/^var (\S+) = class/)[1]
function fixture (fixed = true) {
    const timers = [], sent = [], ta = { value: '' }
    const Helper = vm.runInNewContext(code + '\n' + name, { setTimeout: f => timers.push(f), b: { DEL: '\x7f' } })
    const helper = new Helper(ta, { classList: { add () {}, remove () {} } },
        { buffer: { isCursorInViewport: false } }, {}, { triggerDataEvent: s => sent.push(s) }, {})
    const frontend = { xterm: { textarea: ta, _core: { _compositionHelper: helper } } }
    if (fixed) installImeCommitGuard(frontend, () => true)
    const drain = () => { while (timers.length) timers.shift()() }
    const compose = (text, settleUpdate = false) => {
        helper.compositionstart()
        helper.compositionupdate({ data: text })
        ta.value += text
        if (settleUpdate) drain()
        helper.compositionend()
    }
    return { helper, ta, sent, frontend, drain, compose }
}
const broken = fixture(false)
broken.compose('한'); broken.helper.keydown({ keyCode: 13 }); broken.ta.value = ''; broken.drain()
assert.equal(broken.sent.join(''), '', 'unmodified xterm loses the fast committed syllable')
for (const keyCode of [13, 32, 37, 36, 35, 8, 65]) {
    const f = fixture()
    f.compose('한'); f.helper.keydown({ keyCode }); f.drain()
    assert.deepEqual(f.sent, ['한'], 'fast key preserves exactly one commit: ' + keyCode)
}
const partial = fixture()
partial.helper.compositionstart()
partial.helper.compositionupdate({ data: 'ㅎ' }); partial.ta.value = 'ㅎ'; partial.drain()
partial.helper.compositionupdate({ data: '한글' }); partial.ta.value = '한글'
partial.helper.compositionend(); partial.helper.keydown({ keyCode: 13 }); partial.drain()
assert.deepEqual(partial.sent, ['한글'], 'nonempty but outdated end must not truncate the commit')
for (const keyCode of [20, 229, 16, 17, 18]) {
    const f = fixture()
    f.compose('글'); f.helper.keydown({ keyCode })
    assert.deepEqual(f.sent, [], 'IME/modifier keys do not force a commit')
    f.drain(); assert.deepEqual(f.sent, ['글'])
}
const active = fixture()
active.helper.compositionstart(); active.helper.compositionupdate({ data: 'ㅎ' }); active.ta.value = 'ㅎ'
active.helper.keydown({ keyCode: 229 })
assert.deepEqual(active.sent, [], 'active composition is not committed early')
active.helper.compositionend(); active.drain(); assert.deepEqual(active.sent, ['ㅎ'])
const next = fixture()
next.compose('한'); next.compose('글'); next.drain()
assert.equal(next.sent.join(''), '한글', 'consecutive compositions keep the native ordering')
const nextKey = fixture()
nextKey.compose('한'); nextKey.compose('글'); nextKey.helper.keydown({ keyCode: 13 }); nextKey.drain()
assert.equal(nextKey.sent.join(''), '한글', 'a fast key after consecutive commits must preserve both syllables')
const interleaved = fixture()
interleaved.compose('한')
interleaved.helper.compositionstart(); interleaved.helper.compositionupdate({data:'글'}); interleaved.ta.value = '한글'
interleaved.drain()
assert.deepEqual(interleaved.sent, ['한'], 'previous timer can send while the next syllable is composing')
interleaved.helper.compositionend(); interleaved.helper.keydown({keyCode:13}); interleaved.drain()
assert.deepEqual(interleaved.sent, ['한','글'], 'already-sent prefix must not be sent twice')
const normal = fixture()
normal.compose('문', true); normal.drain(); normal.helper.keydown({ keyCode: 13 }); normal.drain()
assert.deepEqual(normal.sent, ['문'], 'settled input is not duplicated')
const off = fixture(false)
installImeCommitGuard(off.frontend, () => false)
off.compose('한'); off.helper.keydown({ keyCode: 13 }); off.drain()
assert.equal(off.sent.join(''), '', 'disabled guard retains original behavior')
const once = fixture()
const wrapped = once.helper.keydown
installImeCommitGuard(once.frontend, () => true)
assert.equal(once.helper.keydown, wrapped, 'frontend reattachment must not double wrap')
installImeCommitGuard({}, () => true)
console.log('PASS real xterm fast IME: reproduced loss, fast keys, partial range, IME/modifiers, active and consecutive composition, settled input, disabled guard and idempotence')
