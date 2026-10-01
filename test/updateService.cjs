const assert = require('assert/strict')
const fs = require('fs')
const vm = require('vm')
const ts = require('typescript')
function compile (file, mocks = {}) {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
    }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] ?? require(name),
        __dirname: __dirname, process, setTimeout, clearTimeout, window: { addEventListener () {} } })
    return module.exports
}
const policy = compile('src/update.ts')
const { AgentDeckUpdateService } = compile('src/update.service.ts', {
    '@angular/core': { Injectable: () => x => x }, 'tabby-core': {}, './reload.service': {},
    './diag': { diag () {}, diagCatch () {}, pluginVersion: () => '1.2.5' }, './update': policy,
})
async function main () {
    let ready, checks = 0
    const startup = new AgentDeckUpdateService({ ready$: { subscribe (cb) { ready = cb } } }, {}, {}, {}, {})
    startup.run = () => { checks++; return Promise.resolve('up-to-date') }
    startup.init()
    assert.equal(checks, 0)
    ready()
    assert.equal(checks, 1)
    ready()
    assert.equal(checks, 1)
    const cfg = { store: { agentDeck: { lastUpdateCheck: Date.now(), updateCheckIntervalHours: 6 } }, save () {} }
    let requests = 0, prompts = 0, latest = '1.2.6', fail = false
    const svc = new AgentDeckUpdateService({}, cfg, { showMessageBox: async () => { prompts++; return { response: 1 } } }, {}, {})
    svc.installMarks = () => ({ hasSrc: false, hasGit: false, hasWebpackConfig: false, isLink: false })
    svc.fetch = async () => { requests++; if (fail) { throw Error('offline') }; return JSON.stringify({ version: latest }) }
    const a = svc.run('startup'), b = svc.run('focus')
    assert.equal(a, b)
    assert.equal(await a, 'postponed')
    assert.equal(requests, 1); assert.equal(prompts, 1)
    assert.equal(await svc.run('focus'), 'skipped')
    assert.equal(requests, 2); assert.equal(prompts, 1)
    latest = '1.2.7'
    assert.equal(await svc.run('focus'), 'postponed'); assert.equal(prompts, 2)
    await svc.run('manual', true); assert.equal(prompts, 3)
    fail = true
    const last = cfg.store.agentDeck.lastUpdateCheck
    assert.equal(await svc.run('focus'), 'unknown'); assert.equal(cfg.store.agentDeck.lastUpdateCheck, last)
    fail = false; latest = '1.2.5'
    assert.equal(await svc.run('focus'), 'up-to-date')
    cfg.store.agentDeck.autoUpdate = false
    const before = requests
    assert.equal(await svc.run('focus'), 'disabled'); assert.equal(requests, before)
    console.log('update service: immediate check, concurrent requests, repeated/new version, manual check, offline retry, disabled PASS')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
