const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true, esModuleInterop: true },
}).outputText, file)
const { identifyAgent, profileFor, detectProfileFor } = require('../src/agents.ts')
const { identifyScreenAgent } = require('../src/screenAgent.ts')
const { applyOutput } = require('../src/detect.ts')
const { WorkStatusService } = require('../src/status.service.ts')
const { stateEvent } = require('../receiver/state.cjs')

// Missing AGY identity must fail rather than borrowing Gemini/Claude behavior.
assert.equal(identifyAgent('/Users/test/.local/bin/agy --sandbox', ''), 'agy')
assert.equal(identifyAgent('', 'Antigravity CLI'), 'agy')
assert.equal(identifyAgent('/Users/test/.local/bin/agy --settings ~/.gemini/antigravity-cli', ''), 'agy')
assert.equal(identifyAgent('C:\\Users\\test\\agy.exe', ''), 'agy')
assert.equal(identifyAgent('"C:\\Users\\test\\agy.exe" --sandbox', ''), 'agy')
assert.equal(identifyAgent('stagy', ''), 'unknown', 'similar process names are not AGY')
assert.equal(identifyScreenAgent([' Welcome to the Antigravity CLI. You are currently not signed in.']), 'agy')
assert.equal(profileFor('agy').label, 'Antigravity')
const profile = detectProfileFor('agy')
assert.equal(profile.id, 'agy')
assert.ok(profile.busyPatterns.some(re => re.test('Press esc to interrupt generation.')))
assert.ok(profile.waitingPatterns.some(re => re.test('Do you trust the contents of this project?')))
assert.ok(profile.waitingPatterns.some(re => re.test('Run this command?')))
assert.equal(profile.waitingPatterns.some(re => re.test('Do you want to proceed?')), false,
    'AGY must not inherit Claude approval prompts')

// A native AGY approval must be able to interrupt a hook-pinned running state,
// then resume when the generation indicator returns.
const status = new WorkStatusService(), tab = {}, owner = {}
status.setManual(tab, 'running')
applyOutput(status, tab, owner, 'Do you trust the contents of this project?', true, profile)
assert.equal(status.get(tab).status, 'waiting')
applyOutput(status, tab, owner, 'Press esc to interrupt generation.', true, profile)
assert.equal(status.get(tab).status, 'running')
// Returning to AGY's input footer must clear a dismissed approval, and the
// decorator's second union-profile pass must not immediately mark it running.
applyOutput(status, tab, owner, 'Do you trust the contents of this project?', true, profile)
assert.equal(status.get(tab).status, 'waiting')
applyOutput(status, tab, owner, '? for shortcuts', true, profile)
assert.equal(status.get(tab).status, 'idle')
assert.equal(status.get(tab).pinned, false)
applyOutput(status, tab, {}, '? for shortcuts', true)
assert.equal(status.get(tab).status, 'idle')
const quoted = new WorkStatusService()
applyOutput(quoted, tab, {}, 'Assistant: Run this command?', true, profile)
assert.equal(quoted.get(tab).status, 'running', 'generic output fallback is not an approval card')
assert.notEqual(quoted.get(tab).status, 'waiting', 'quoted discussion is not an approval card')

// A real Codex approval also records its source; AGY's footer must not clear it.
{
    const codex = new WorkStatusService(), codexTab = {}
    codex.setManual(codexTab, 'running')
    applyOutput(codex, codexTab, {}, 'Allow the docs MCP server to run tool search?\n› 1. Always allow Run the tool', true, detectProfileFor('codex'))
    assert.equal(codex.get(codexTab).status, 'waiting')
    applyOutput(codex, codexTab, {}, '? for shortcuts', true)
    assert.equal(codex.get(codexTab).status, 'waiting', 'Codex native approval remains pinned in union pass')
    assert.equal(codex.get(codexTab).pinned, true)
}

// The union/decorator pass must never clear another agent's approval merely
// because a similar footer appears on screen.
for (const other of ['claude', 'codex']) {
    const guarded = new WorkStatusService(), guardedTab = {}
    guarded.setManual(guardedTab, 'waiting')
    applyOutput(guarded, guardedTab, {}, '? for shortcuts', true)
    assert.equal(guarded.get(guardedTab).status, 'waiting', other + ' approval remains pinned')
    assert.equal(guarded.get(guardedTab).pinned, true)
}

// Official AGY lifecycle events must produce durable AgentDeck state.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-agy-state-'))
let clock = Date.now()
const event = (name, value) => ({ id: name + '-' + value, ts: ++clock, env: { AGENTDECK_TAB: 'tab-1' },
    options: { Agent: 'agy', Status: value }, hook: { session_id: 'agy-session', hook_event_name: name, cwd: '/tmp/project' } })
let result = stateEvent(root, event('PreInvocation', 'running'))
assert.equal(result.handled, true)
assert.equal(result.payload.agent, 'agy')
assert.equal(result.payload.status, 'running')
result = stateEvent(root, event('Stop', 'done'))
assert.equal(result.payload.status, 'done')
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'status', 'agy-session.json'))).status, 'done')
console.log('PASS AGY identity, screen states, approval transitions, native reducer')
