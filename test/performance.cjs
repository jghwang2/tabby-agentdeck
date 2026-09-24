const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const { CODEX_APPROVAL_PATTERNS } = require('../src/agents.ts')
const { extractPaths } = require('../src/viewer.ts')
const { performance } = require('node:perf_hooks')
const started = performance.now()
for (const input of [' '.repeat(65536), (' '.repeat(280) + '\r\n').repeat(78)]) {
    assert.equal(CODEX_APPROVAL_PATTERNS.some(pattern => pattern.test(input)), false)
}
assert.deepEqual(extractPaths('a'.repeat(65536)), [])
assert.deepEqual(extractPaths(('segment/').repeat(8192)), [])
assert.ok(performance.now() - started < 1000, 'bounded terminal output must not stall the UI')
for (const text of ['  › 1. Allow Run the tool', '\t2. Always allow\tRun the tool', '> 3. Allow for this session Run the tool']) {
    assert.equal(CODEX_APPROVAL_PATTERNS.some(pattern => pattern.test(text)), true)
}
assert.deepEqual(extractPaths('Edited src/a.ts and D:\\work\\소개.md'), ['src/a.ts', 'D:\\work\\소개.md'])
assert.deepEqual(extractPaths('https://example.com/a.png'), [])
assert.equal(CODEX_APPROVAL_PATTERNS.some(pattern => pattern.test('Explain: Allow the server MCP server to run tool x?')), false)
console.log('performance: bounded nonmatches, paths and approval choices passed')
