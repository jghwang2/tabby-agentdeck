(async () => {
    const a = window.__agentdeck
    const http = require('http')
    const cfg = a.config.store.agentDeck
    const saved = { registry: cfg.updateRegistry, enabled: cfg.autoUpdate, last: cfg.lastUpdateCheck }
    let hits = 0, version = '99.0.1', broken = false
    const server = http.createServer((req, res) => {
        hits++
        setTimeout(() => { res.writeHead(broken ? 503 : 200); res.end(JSON.stringify({ version })) }, 120)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const results = []
    const check = (name, ok) => { results.push({ name, ok }); if (!ok) { throw Error(name) } }
    try {
        cfg.autoUpdate = true
        cfg.updateRegistry = `http://127.0.0.1:${server.address().port}`
        cfg.lastUpdateCheck = Date.now()
        check('isolated development installation', !a.update.canSelfUpdate())
        const before = hits
        const r = await Promise.all([a.update.run(false), a.update.run(false)])
        check('recent check does not block and concurrent requests merge', hits === before + 1 && r.every(x => x === 'dev-install'))
        check('same version notification suppressed', await a.update.run(false) === 'skipped')
        version = '99.0.2'
        check('new version notification allowed', await a.update.run(false) === 'dev-install')
        broken = true
        const last = cfg.lastUpdateCheck
        check('failed query does not record success', await a.update.run(false) === 'unknown' && cfg.lastUpdateCheck === last)
        broken = false; version = a.update.version()
        check('immediate retry succeeds', await a.update.run(false) === 'up-to-date')
        const focusHits = hits
        window.dispatchEvent(new Event('focus'))
        await new Promise(resolve => setTimeout(resolve, 400))
        check('window activation does not check again', hits === focusHits)
        check('UI remains present', !!document.querySelector('.ad-head-version'))
        return { results, hits }
    } finally {
        cfg.updateRegistry = saved.registry; cfg.autoUpdate = saved.enabled; cfg.lastUpdateCheck = saved.last
        a.config.save()
        server.close()
    }
})()
