/** Start an isolated, real login. Poll __accountLoginProbe; never return a secret or OAuth URL. */
(() => {
    const root = require('path').join(process.env.AGENTDECK_SOURCE_ROOT || 'D:/Project/tabby-agentdeck', '.tmp')
    const { readAccounts, prepareAccount, loginAccount, fetchAccountQuotas } = require(root + '/accounts.js')
    const { openAccountBrowser } = require(root + '/accountBrowser.js')
    const provider = window.__accountLoginProvider
    const index = window.__accountLoginIndex
    if (!['claude', 'codex'].includes(provider) || !Number.isInteger(index) || index < 0) {
        return { started: false, reason: 'Select provider and account index explicitly first' }
    }
    const account = readAccounts().filter(a => a.provider === provider)[index]
    if (!account) { return { started: false } }
    prepareAccount(account)
    window.__accountLoginProbe = { status: 'logging-in' }
    loginAccount(account, openAccountBrowser).then(async () => {
        const quotas = await fetchAccountQuotas(account)
        window.__accountLoginProbe = { status: 'passed', quotaLabels: quotas.map(q => q.label) }
    }).catch(() => { window.__accountLoginProbe = { status: 'login-not-completed' } })
    return { started: true }
})()
