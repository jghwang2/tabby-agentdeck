// Run against an isolated instance with tools/cdp.js.
(async () => {
    const ad = window.__agentdeck, fs = require('fs'), path = require('path')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) throw Error('Isolated instance required')
    const checks = [], sleep = ms => new Promise(r => setTimeout(r, ms))
    const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); if (!pass) throw Error(name) }
    const wait = async fn => {
        for (let i = 0; i < 160; i++) { const value = fn(); if (value) return value; await sleep(100) }
        throw Error('Timed out: ' + fn.toString())
    }
    const open = async () => {
        const old = new Set(ad.app.tabs)
        document.querySelector('.ad-new').click()
        return wait(() => ad.app.tabs.find(t => !old.has(t) && (t.getAllTabs?.() || [t]).some(p => p.session?.open)))
    }
    const first = await open(), other = await open()
    const pane = (first.getAllTabs?.() || [first])[0]
    let deck
    const queue = [pane.injector], seen = new Set()
    while (queue.length && seen.size < 100) {
        const i = queue.shift(); if (!i || seen.has(i)) continue; seen.add(i)
        if (i.records) for (const r of i.records.values()) if (r?.value?.resumeStarting instanceof Map) deck = r.value
        queue.push(i.parent, i.parentInjector, i.injector, i._lView?.[9])
    }
    if (!deck) throw Error('Deck unavailable')
    const row = tab => document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(tab)}"]`)
    let menuRect
    const menu = tab => {
        row(tab).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 20, clientY: 100 }))
        menuRect = document.querySelector('.ad-menu').getBoundingClientRect()
        document.querySelector('.ad-edit-menu').click()
        return document.querySelector('.ad-tab-edit')
    }
    const edit = (tab, text) => {
        const dialog = menu(tab)
        const name = { '탭 제목 바꾸기': 'title', '별명 바꾸기': 'alias', '예약 건수 바꾸기': 'scheduled' }[text]
        if (name === 'scheduled') {
            const automatic = dialog.querySelector('.ad-edit-automatic')
            automatic.checked = false; automatic.dispatchEvent(new Event('change'))
        }
        return dialog.querySelector('.ad-edit-' + name)
    }
    const save = async dialog => {
        dialog.querySelector('.ad-edit-save').click()
        await wait(() => !dialog.isConnected || !dialog.querySelector('form').checkValidity() || !dialog.querySelector('.ad-edit-error').hidden)
    }
    const enter = async (input, value) => {
        input.value = value; input.dispatchEvent(new Event('input'))
        await save(input.closest('dialog'))
    }
    const sid = 'agentdeck-probe-timer-' + Date.now()
    const transcriptDir = path.join(ad.subagents().projectsDir, sid)
    const transcript = path.join(transcriptDir, sid + '.jsonl')
    const statusFile = path.join(ad.runtimePaths().status, sid + '.json')
    const otherSid = sid + '-other'
    const otherTranscript = path.join(transcriptDir, otherSid + '.jsonl')
    const otherStatusFile = path.join(ad.runtimePaths().status, otherSid + '.json')
    const otherPane = (other.getAllTabs?.() || [other])[0]
    const line = r => JSON.stringify(r) + '\n'
    const create = (id, recurring) => line({ type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'call-' + id, name: 'CronCreate', input: { prompt: '검증 예약 ' + id, recurring } },
    ] } }) + line({ type: 'user', toolUseResult: { id, recurring, durable: false }, message: { content: [
        { type: 'tool_result', tool_use_id: 'call-' + id, content: 'Scheduled task' },
    ] } })
    try {
        ad.app.selectTab(first); ad.render()
        row(first).querySelector('.ad-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        await enter(document.querySelector('.ad-edit-title'), '수동 제목 <검증>')
        first.setTitle('에이전트 자동 제목 변경')
        ad.render()
        check('manual title survives agent title updates as plain text', row(first).querySelector('.ad-title').textContent.includes('수동 제목 <검증>'))
        menu(first)
        const popup = document.querySelector('.ad-tab-edit')
        check('Edit opens one modal with all fields and Save/Cancel', popup.open && popup.querySelectorAll('.ad-edit-field').length === 5
            && popup.querySelectorAll('select option').length === 7 && popup.querySelector('.ad-edit-save') && popup.querySelector('.ad-edit-cancel')
            && !document.querySelector('.ad-edit-submenu'))
        check('main menu fits viewport at right edge', menuRect.left >= 0 && menuRect.right <= innerWidth)
        const rect = popup.getBoundingClientRect()
        check('edit modal fits viewport', rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight)
        popup.querySelector('.ad-edit-cancel').click()
        await wait(() => !popup.isConnected)
        const beforeAlias = row(first).querySelector('.ad-identity').textContent
        const duplicate = row(other).querySelector('.ad-identity').textContent
        const invalid = edit(first, '별명 바꾸기'); await enter(invalid, duplicate)
        check('duplicate alias rejected', !invalid.checkValidity() && deck.identityOf(first).alias === beforeAlias)
        invalid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await wait(() => !document.querySelector('.ad-tab-edit'))
        await enter(edit(first, '별명 바꾸기'), '내 테스트 별명')
        check('manual alias visible', row(first).querySelector('.ad-identity').textContent === '내 테스트 별명')
        const statusDialog = menu(first)
        statusDialog.querySelector('.ad-edit-status').value = 'done'
        await save(statusDialog)
        check('status edits still work', ad.status.get(first).status === 'done')
        fs.mkdirSync(transcriptDir, { recursive: true })
        fs.writeFileSync(transcript, create('once', false) + create('repeat', true))
        fs.mkdirSync(path.dirname(statusFile), { recursive: true })
        fs.writeFileSync(statusFile, JSON.stringify({ sessionId: sid, tabId: pane.profile.options.env.AGENTDECK_TAB,
            agent: 'claude', status: 'done', ts: Date.now() }))
        await wait(() => row(first)?.querySelector('.ad-scheduled')?.textContent === '예약된 작업 2건')
        check('confirmed timers shown next to Done', row(first).querySelector('.ad-badge').textContent.includes('완료'))
        check('timers do not appear on an unrelated tab', !row(other).querySelector('.ad-scheduled'))
        // Reuse task and tool-call IDs across sessions: neither is globally unique.
        fs.writeFileSync(otherTranscript, create('once', false) + create('repeat', true) + create('other-only', false))
        fs.writeFileSync(otherStatusFile, JSON.stringify({ sessionId: otherSid, tabId: otherPane.profile.options.env.AGENTDECK_TAB,
            agent: 'claude', status: 'done', ts: Date.now() }))
        await wait(() => row(other)?.querySelector('.ad-scheduled')?.textContent === '예약된 작업 3건')
        check('same task IDs are counted independently per tab', row(first).querySelector('.ad-scheduled').textContent === '예약된 작업 2건')
        fs.appendFileSync(transcript, line({ type: 'system', subtype: 'scheduled_task_fire', taskId: 'repeat' })
            + line({ type: 'system', subtype: 'scheduled_task_fire', taskId: 'once' }))
        await wait(() => row(first)?.querySelector('.ad-scheduled')?.textContent === '예약된 작업 1건')
        check('one-shot disappears, recurring remains', true)
        check('firing in first tab preserves other tab timers', row(other).querySelector('.ad-scheduled').textContent === '예약된 작업 3건')
        // A manual zero must not disable protection of a real pending timer.
        await enter(edit(first, '예약 건수 바꾸기'), '0')
        row(first).querySelector('.ad-close').click()
        const dialog = await wait(() => document.querySelector('.ad-close-confirm'))
        check('close warns even if real count is manually hidden', dialog.textContent.includes('1건'))
        document.querySelector('.ad-close-cancel').click()
        await sleep(100)
        check('cancel leaves tab and PTY alive', ad.app.tabs.includes(first) && pane.session.open)
        fs.appendFileSync(transcript, line({ type: 'assistant', message: { content: [
            { type: 'tool_use', id: 'delete-repeat', name: 'CronDelete', input: { id: 'repeat' } },
        ] } }) + line({ type: 'user', toolUseResult: { id: 'repeat' }, message: { content: [
            { type: 'tool_result', tool_use_id: 'delete-repeat', content: 'Cancelled job repeat.' },
        ] } }))
        await wait(() => !row(first)?.querySelector('.ad-scheduled') && !deck.scheduledOf(first).manual)
        check('cancelled timers removed and manual override returns to auto', true)
        check('cancellation in first tab preserves other tab timers', row(other).querySelector('.ad-scheduled').textContent === '예약된 작업 3건')
        const emptyList = line({ type: 'assistant', message: { content: [
            { type: 'tool_use', id: 'list-empty', name: 'CronList', input: {} },
        ] } }) + line({ type: 'user', toolUseResult: [], message: { content: [
            { type: 'tool_result', tool_use_id: 'list-empty', content: 'No scheduled jobs' },
        ] } })
        fs.appendFileSync(transcript, emptyList)
        await deck.notify.refreshScheduledTasks(first)
        ad.render()
        check('empty list only clears its own session', !row(first).querySelector('.ad-scheduled')
            && row(other).querySelector('.ad-scheduled').textContent === '예약된 작업 3건')
        fs.appendFileSync(otherTranscript, line({ type: 'system', subtype: 'scheduled_task_fire', taskId: 'once' }))
        await wait(() => row(other)?.querySelector('.ad-scheduled')?.textContent === '예약된 작업 2건')
        check('other tab independently removes its fired one-shot', !row(first).querySelector('.ad-scheduled'))
        fs.appendFileSync(otherTranscript, emptyList)
        await wait(() => !row(other)?.querySelector('.ad-scheduled'))
        await enter(edit(first, '예약 건수 바꾸기'), '3')
        check('manual count displayed', row(first).querySelector('.ad-scheduled').textContent === '예약된 작업 3건')
        check('manual count stays on edited tab', !row(other).querySelector('.ad-scheduled'))
        const badCount = edit(first, '예약 건수 바꾸기'); await enter(badCount, '-1')
        check('negative count rejected', !badCount.checkValidity())
        badCount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await wait(() => !document.querySelector('.ad-tab-edit'))
        await ad.config.save()
        const saved = fs.readFileSync(path.join(process.env.TABBY_CONFIG_DIRECTORY, 'config.yaml'), 'utf8')
        check('title and alias persisted to disk', saved.includes('수동 제목 <검증>') && saved.includes('내 테스트 별명'))
        ad.app.selectTab(first); pane.frontend.focus()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true, cancelable: true }))
        await wait(() => document.querySelector('.ad-close-confirm'))
        check('Ctrl+W uses same scheduled confirmation', document.querySelector('.ad-close-confirm').textContent.includes('3건'))
        document.querySelector('.ad-close-accept').click()
        await wait(() => !ad.app.tabs.includes(first))
        check('accept closes only intended tab', ad.app.tabs.includes(other))
        check('test auto-updater disabled and installer packaged', ad.config.store.agentDeck.autoUpdate === false
            && fs.existsSync(path.join(fs.realpathSync(path.join(path.dirname(process.env.TABBY_CONFIG_DIRECTORY), 'ud/plugins/node_modules/tabby-agentdeck')), 'updater/agentdeck-update.ps1')))
        return { checks, pass: checks.every(c => c.pass) }
    } catch (e) { return { checks, pass: false, error: String(e), stack: e.stack } }
    finally {
        document.querySelector('.ad-menu')?.remove()
        document.querySelector('.ad-tab-edit')?.close('cancel')
        document.querySelector('.ad-close-confirm')?.close('cancel')
        deck.scheduledOverrides.delete(first)
        fs.rmSync(statusFile, { force: true })
        fs.rmSync(otherStatusFile, { force: true })
        if (path.basename(transcriptDir) === sid && sid.startsWith('agentdeck-probe-timer-')) fs.rmSync(transcriptDir, { recursive: true, force: true })
        if (ad.app.tabs.includes(first)) await ad.app.closeTab(first, false)
        if (ad.app.tabs.includes(other)) await ad.app.closeTab(other, false)
    }
})()
