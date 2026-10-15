// Run with tools/cdp.js against an isolated instance only.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) throw Error('Isolated instance required')
    const ad = window.__agentdeck, created = [], checks = []
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (name, value) => { checks.push({ name, pass: !!value }); if (!value) throw Error(name) }
    const wait = async fn => {
        for (let i = 0; i < 150; i++) { const value = fn(); if (value) return value; await sleep(100) }
        throw Error('Timed out: ' + fn.toString())
    }
    const paneOf = tab => (tab.getAllTabs?.() || [tab])[0]
    const rowOf = tab => document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(tab)}"]`)
    const open = async () => {
        const before = new Set(ad.app.tabs)
        const button = document.querySelector('.ad-new')
        if (button.disabled) throw Error('New tab disabled at ' + before.size)
        button.click()
        const tab = await wait(() => ad.app.tabs.find(t => !before.has(t)))
        created.push(tab)
        await wait(() => paneOf(tab)?.session?.open && rowOf(tab))
        return tab
    }
    try {
        await open()
        for (const tab of [...ad.app.tabs]) if (!paneOf(tab)?.session) await ad.app.closeTab(tab, true)
        while (ad.app.tabs.length < 12) await open()
        ad.render()
        check('12 terminal tabs can coexist', ad.app.tabs.length === 12 && ad.app.tabs.every(t => paneOf(t)?.session?.open))
        check('new tab button remains enabled after nine', !document.querySelector('.ad-new').disabled)
        const aliases = [...document.querySelectorAll('.ad-tab .ad-identity')].map(el => el.textContent)
        const ids = ad.app.tabs.map(t => paneOf(t).profile.options.env.AGENTDECK_IDENTITY)
        check('all 12 tabs have distinct aliases and identities', aliases.length === 12 && aliases.every(Boolean)
            && new Set(aliases).size === 12 && ids.every(Boolean) && new Set(ids).size === 12)
        const list = document.querySelector('.ad-list')
        check('overflow uses scrollable list', list.scrollHeight > list.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(list).overflowY))
        const last = ad.app.tabs[11]
        rowOf(last).scrollIntoView({ block: 'nearest' })
        await sleep(200)
        const visible = rowOf(last).getBoundingClientRect(), viewport = list.getBoundingClientRect()
        check('12th tab reachable by scrolling', list.scrollTop > 0 && visible.top >= viewport.top - 1 && visible.bottom <= viewport.bottom + 1)
        rowOf(last).click()
        check('12th tab selectable', ad.app.activeTab === last)
        ad.jump(1)
        check('Ctrl+1 navigation still selects first tab', ad.app.activeTab === ad.app.tabs[0])
        ad.jump(9)
        check('Ctrl+9 navigation still selects ninth tab', ad.app.activeTab === ad.app.tabs[8])
        let deck
        const queue = [paneOf(last).injector], seen = new Set()
        while (queue.length && seen.size < 100) {
            const i = queue.shift(); if (!i || seen.has(i)) continue; seen.add(i)
            if (i.records) for (const r of i.records.values()) if (r?.value?.resumeStarting instanceof Map) deck = r.value
            queue.push(i.parent, i.parentInjector, i.injector, i._lView?.[9])
        }
        if (!deck) throw Error('Deck unavailable')
        // Exercise the real resume-tab creation/PTY command path without starting an AI session.
        const marker = 'AGENTDECK_CAPACITY_RESUME_OK'
        const resumed = await deck.openResumeTab({ sessionId: 'capacity-probe', cwd: paneOf(last).profile.options.cwd,
            label: 'Capacity resume fixture' }, "Write-Output '" + marker + "'")
        const resumedRoot = ad.app.tabs.find(t => t === resumed || t.getAllTabs?.().includes(resumed))
        if (resumedRoot) created.push(resumedRoot)
        check('resume path creates 13th tab', !!resumedRoot && ad.app.tabs.length === 13)
        await wait(() => {
            const buffer = paneOf(resumed)?.frontend?.xterm?.buffer?.active
            if (!buffer) return false
            for (let i = 0; i < buffer.length; i++) if (buffer.getLine(i)?.translateToString(true).trim() === marker) return true
            return false
        })
        check('13th resumed tab runs command in real PTY', true)
        ad.render()
        const resumedRow = await wait(() => rowOf(resumedRoot))
        resumedRow.querySelector('.ad-close').click()
        await wait(() => !ad.app.tabs.includes(resumedRoot))
        check('closing 13th tab preserves other 12', ad.app.tabs.length === 12 && paneOf(last).session.open)
        await open()
        check('new tab remains available after close above nine', ad.app.tabs.length === 13)
        return { pass: true, checks }
    } catch (error) { return { pass: false, checks, error: String(error), stack: error.stack } }
    finally { for (const tab of created.reverse()) if (ad.app.tabs.includes(tab)) await ad.app.closeTab(tab, true) }
})()
