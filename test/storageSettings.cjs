const assert = require('node:assert/strict')
const os = require('node:os'), path = require('node:path')
const environment = require('../.tmp/storageEnvironment')
let userEnvironment = {}, rejectEnvironment = false
environment.syncStorageEnvironment = async values => {
    if (rejectEnvironment) throw new Error('storage.environment')
    const previous = userEnvironment
    userEnvironment = { ...values }
    return async () => { userEnvironment = previous }
}
const { storageSettingsFor, StorageSettings } = require('../.tmp/storageSettings')
const root = path.join(os.tmpdir(), 'agentdeck-storage-settings-fixture')
const values = { accountStorageDir: path.join(root, 'accounts'), claudeStorageDir: path.join(root, 'claude'), codexStorageDir: path.join(root, 'codex') }
const fake = () => ({ store: { agentDeck: { accountStorageDir: '', claudeStorageDir: '', codexStorageDir: '' } }, save: async () => {} })
;(async () => {
    const config = fake(), model = storageSettingsFor(config)
    for (const [k, v] of Object.entries(values)) model.change(k, v)
    model.flush()
    await model.save()
    assert.deepEqual(config.store.agentDeck, values, 'Leaving settings saves the edited paths')
    assert.equal(storageSettingsFor(config), model, 'Navigation reuses the pending/error state')
    assert.deepEqual(new StorageSettings(config).draft, values, 'Reopening after restart loads saved paths')

    config.save = async () => { throw new Error('ENOSPC') }
    const next = path.join(root, 'next')
    model.change('codexStorageDir', next)
    await model.save()
    assert.equal(config.store.agentDeck.codexStorageDir, values.codexStorageDir)
    assert.equal(storageSettingsFor(config).draft.codexStorageDir, next, 'Failed write keeps the user input across navigation')
    assert.equal(model.message, 'failed')
    assert.equal(model.error, true)
    assert.equal(userEnvironment.codexStorageDir, values.codexStorageDir, 'Config failure restores the environment')
    config.save = async () => {}
    await model.save()
    assert.equal(config.store.agentDeck.codexStorageDir, next, 'Retry persists the retained draft')

    model.change('codexStorageDir', 'relative')
    await model.save()
    assert.equal(model.message, 'storage.absolute')
    assert.equal(model.draft.codexStorageDir, 'relative')
    assert.equal(config.store.agentDeck.codexStorageDir, next)

    let release, entered
    const started = new Promise(r => { entered = r })
    const writes = []
    let first = true
    config.save = async () => {
        writes.push(config.store.agentDeck.codexStorageDir)
        if (first) { first = false; entered(); await new Promise(r => { release = r }) }
    }
    model.change('codexStorageDir', path.join(root, 'first'))
    const save1 = model.save()
    await started
    model.change('codexStorageDir', path.join(root, 'second'))
    const save2 = model.save()
    release()
    await Promise.all([save1, save2])
    assert.deepEqual(writes, [path.join(root, 'first'), path.join(root, 'second')])
    assert.equal(model.draft.codexStorageDir, path.join(root, 'second'), 'Earlier save cannot erase a newer edit')
    assert.equal(model.busy, false)
    rejectEnvironment = true
    model.change('codexStorageDir', path.join(root, 'denied'))
    await model.save()
    assert.equal(model.message, 'storage.environment')
    assert.equal(config.store.agentDeck.codexStorageDir, path.join(root, 'second'), 'Registry failure does not persist config')
    console.log('PASS: navigation flush, restart persistence, failed-write retention/retry, validation retention, serialized saves preserve newer edits')
})().catch(error => { console.error(error); process.exitCode = 1 })
