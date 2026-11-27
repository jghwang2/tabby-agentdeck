(async () => {
    if (!/\.tmp|tabby-agentdeck-test/.test(process.env.TABBY_CONFIG_DIRECTORY || '')) { throw Error('Isolated instance required') }
    const ad = window.__agentdeck
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const deck = ad.app.tabsService.injector.get(params[0]), cfg = ad.config.store.agentDeck
    const records = deck.ledger.records, refresh = deck.ledger.refresh
    const saved = { resumeList: cfg.resumeList, resumeExpanded: cfg.resumeExpanded, resumeHidden: cfg.resumeHidden }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const cases = [], check = (name, pass, evidence) => cases.push({ id: `RV${cases.length + 1}`, name, pass, evidence })
    let fixture = Array.from({ length: 1840 }, (_, i) => ({ sessionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        label: `History ${i}`, cwd: 'D:/isolated', lastSeen: Date.now() - i * 60000, lastStatus: 'idle', from: 'head', agent: 'claude' }))
    let reads = 0
    try {
        deck.ledger.records = () => { reads++; return fixture }
        deck.ledger.refresh = async () => {}
        cfg.resumeList = true; cfg.resumeHidden = []; cfg.resumeExpanded = []
        deck.renderResumeDrawer(true)
        document.querySelector('.ad-resume-head').click()
        const box = document.querySelector('.ad-resume-rows')
        const rows = () => [...box.querySelectorAll('.ad-resume')]
        const scroll = y => { box.scrollTop = y; box.dispatchEvent(new Event('scroll')) }
        check('full count with bounded DOM', rows().length <= 12 && rows().length > 0 && document.querySelector('.ad-resume-head .ad-group-count').textContent === '1840', { mounted: rows().length })
        check('row stride is exactly 44 CSS pixels', rows()[1].getBoundingClientRect().top - rows()[0].getBoundingClientRect().top === 44)
        scroll(44000)
        check('middle scroll reaches expected sessions', rows().some(row => row.dataset.sessionId === fixture[1000].sessionId) && rows().length <= 12)
        scroll(box.scrollHeight)
        check('last session is reachable without blank tail', rows().at(-1).dataset.sessionId === fixture.at(-1).sessionId
            && rows().at(-1).getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1)
        scroll(0)
        deck.renderResumeDrawer(true)
        const first = rows()[0], startReads = reads
        fixture[0] = { ...fixture[0], label: 'Delayed update', lastSeen: Date.now() }
        for (let i = 0; i < 100; i++) { deck.renderResumeDrawer() }
        check('100 periodic requests skip history calculation', reads === startReads && rows()[0] === first, { reads: reads - startReads })
        await sleep(11200)
        check('real timer refreshes after ten seconds', reads === startReads + 1 && rows()[0].textContent.includes('Delayed update'), { reads: reads - startReads })
        cfg.resumeHidden = [fixture[0].sessionId]; ad.render()
        check('hide is immediate', !rows().some(row => row.dataset.sessionId === fixture[0].sessionId))
        cfg.resumeHidden = []; ad.render()
        const input = document.querySelector('.ad-history-query')
        input.value = 'test'; input.dispatchEvent(new Event('input'))
        check('search immediately hides recent rows', box.hidden)
        input.value = ''; input.dispatchEvent(new Event('input'))
        check('clearing search immediately restores rows', !box.hidden && rows()[0].textContent.includes('Delayed update'))
        document.querySelector('.ad-resume-head').click()
        check('collapse is immediate', box.hidden)
        document.querySelector('.ad-resume-head').click()
        check('expand is immediate', !box.hidden && rows().length <= 12)
        const originalActivate = deck.activateResume
        let clicked
        deck.activateResume = row => { clicked = row }
        try { rows()[0].click(); check('click receives current record', clicked?.label === 'Delayed update') }
        finally { deck.activateResume = originalActivate }
        scroll(box.scrollHeight)
        fixture = fixture.slice(0, 2); deck.renderResumeDrawer(true)
        check('shrinking history clamps scroll', box.scrollTop === 0 && rows().length === 2)
        fixture = []; deck.renderResumeDrawer(true)
        check('empty history has no stale rows', rows().length === 0 && !!box.querySelector('.ad-resume-empty'))
        return { results: cases, summary: { pass: cases.filter(x => x.pass).length, fail: cases.filter(x => !x.pass).length } }
    } finally {
        deck.ledger.records = records; deck.ledger.refresh = refresh
        Object.assign(cfg, saved); deck.renderResumeDrawer(true)
    }
})()
