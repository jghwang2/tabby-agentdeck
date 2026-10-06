(async () => {
    const g = window.__agentdeck
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const checks = []
    const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)) }
    const rows = () => [...document.querySelectorAll('.ad-tab')]
    const names = () => rows().map(row => row.querySelector('.ad-identity').textContent)
    try {
        for (const tab of [...g.app.tabs]) {
            if (!(tab.getAllTabs?.() || [tab]).some(pane => pane.session?.getID?.())) {
                await g.app.closeTab(tab, true)
            }
        }
        while (g.app.tabs.length < 3) {
            document.querySelector('.ad-new').click()
            await wait(600)
        }
        g.render()
        await wait(200)
        const initial = names()
        check('unique automatic aliases, no number badges', new Set(initial).size === initial.length && initial.every(Boolean) && rows().every(row => !row.hasAttribute('data-ad-slot')), initial)
        const first = g.app.tabs[0]
        const last = g.app.tabs[2]
        first.customTitle = '기존 작업 제목 유지 검증'
        g.render()
        check('original title displayed separately', rows()[0].querySelector('.ad-title').textContent.includes(first.customTitle))
        check('title change does not rename alias', names()[0] === initial[0])
        rows()[0].querySelector('.ad-identity').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        check('alias cannot be edited', !document.querySelector('.ad-label-input'))
        const reordered = g.reorder(2, 0, 'before')
        await wait(150)
        check('reorder works', g.app.tabs[0] === last, reordered)
        check('identity follows tab', names()[0] === initial[2] && names()[1] === initial[0], names())
        g.jump(1)
        check('hotkey selects current first', g.app.activeTab === last)
        g.jump(2)
        check('hotkey selects current second', g.app.activeTab === first)
        const persisted = g.config.store.agentDeck.sessionIdentities.map(x => ({ ...x }))
        await g.app.closeTab(last, true)
        await wait(200)
        document.querySelector('.ad-new').click()
        await wait(600)
        check('closed alias reused', names().includes(initial[2]), names())
        check('old identity history retained', g.config.store.agentDeck.sessionIdentities.some(x => x.id === persisted[2].id))
        window.localStorage.setItem('identity-probe-before', JSON.stringify({ names: names(), ptys: g.app.tabs.map(t => (t.getAllTabs?.() || [t]).map(p => p.session?.pty?.id || p.session?.ptyID || p.session?.id)), records: g.config.store.agentDeck.sessionIdentities }))
        return { checks, names: names(), reloadAvailable: !!g.devReload }
    } catch (error) { return { checks, error: String(error) } }
})()
