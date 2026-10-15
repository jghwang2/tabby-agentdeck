// Run with tools/cdp.js against an isolated Tabby only.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) throw Error('Isolated instance required')
    const ad = window.__agentdeck, checks = [], made = [], sleep = ms => new Promise(r => setTimeout(r, ms))
    const check = (name, pass) => { checks.push({ name, pass: !!pass }); if (!pass) throw Error(name) }
    const wait = async fn => { for (let i = 0; i < 120; i++) { if (fn()) return; await sleep(100) } throw Error('Timeout: ' + fn) }
    const paneOf = tab => (tab.getAllTabs?.() || [tab])[0]
    const row = tab => document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(tab)}"]`)
    const open = async () => {
        const before = new Set(ad.app.tabs); document.querySelector('.ad-new').click()
        await wait(() => ad.app.tabs.some(t => !before.has(t) && paneOf(t)?.session?.open))
        const tab = ad.app.tabs.find(t => !before.has(t)); made.push(tab); return tab
    }
    let deck, originalSave
    try {
        const first = await open(), other = await open()
        const queue = [paneOf(first).injector], seen = new Set()
        while (queue.length && seen.size < 100) {
            const i = queue.shift(); if (!i || seen.has(i)) continue; seen.add(i)
            if (i.records) for (const r of i.records.values()) if (r?.value?.resumeStarting instanceof Map) deck = r.value
            queue.push(i.parent, i.parentInjector, i.injector, i._lView?.[9])
        }
        if (!deck) throw Error('Deck unavailable')
        originalSave = ad.config.save
        const dialog = () => {
            row(first).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 10, clientY: innerHeight - 10 }))
            document.querySelector('.ad-edit-menu').click()
            return document.querySelector('.ad-tab-edit')
        }
        const fill = (popup, name, value) => {
            const input = popup.querySelector('.ad-edit-' + name)
            if (input.type === 'checkbox') input.checked = value
            else input.value = value
            input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'))
            return input
        }
        const save = async popup => { popup.querySelector('.ad-edit-save').click(); await wait(() => !popup.isConnected) }
        const cancel = async popup => { popup.querySelector('.ad-edit-cancel').click(); await wait(() => !popup.isConnected) }
        ad.status.setManual(first, 'done', '기존 작업')
        ad.render()
        const before = JSON.stringify(deck.identityOf(first)), beforeTitle = first.customTitle
        let popup = dialog()
        fill(popup, 'title', '취소할 제목'); fill(popup, 'alias', '취소할 별명')
        fill(popup, 'label', '취소할 작업'); fill(popup, 'status', 'error')
        fill(popup, 'automatic', false); fill(popup, 'scheduled', '5')
        popup.querySelector('.ad-edit-cancel').focus()
        await sleep(100)
        check('typing and blur do not apply a draft', JSON.stringify(deck.identityOf(first)) === before
            && first.customTitle === beforeTitle && ad.status.get(first).status === 'done' && ad.status.get(first).label === '기존 작업')
        await cancel(popup)
        check('Cancel discards every edited field', JSON.stringify(deck.identityOf(first)) === before && first.customTitle === beforeTitle)
        popup = dialog(); fill(popup, 'title', 'Escape 취소')
        popup.querySelector('.ad-edit-title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await wait(() => !popup.isConnected)
        check('Escape cancels without changes', first.customTitle === beforeTitle)
        popup = dialog()
        fill(popup, 'title', '부분 저장 금지')
        fill(popup, 'alias', deck.identityOf(other).alias)
        fill(popup, 'status', 'error')
        popup.querySelector('.ad-edit-save').click()
        check('invalid alias prevents all changes', popup.open && !popup.querySelector('.ad-edit-alias').checkValidity()
            && first.customTitle === beforeTitle && ad.status.get(first).status === 'done')
        fill(popup, 'alias', '팝업 검증 별명'); fill(popup, 'label', '저장한 작업')
        fill(popup, 'automatic', false); fill(popup, 'scheduled', '2')
        await save(popup)
        check('Save applies all five fields together', first.customTitle === '부분 저장 금지' && deck.identityOf(first).alias === '팝업 검증 별명'
            && ad.status.get(first).status === 'error' && ad.status.get(first).label === '저장한 작업' && deck.scheduledOf(first).count === 2)
        check('other tab is unchanged', !deck.scheduledOf(other).manual && deck.identityOf(other).alias !== '팝업 검증 별명')
        popup = dialog()
        check('reopening shows saved values', popup.querySelector('.ad-edit-title').value === first.customTitle
            && popup.querySelector('.ad-edit-scheduled').value === '2' && !popup.querySelector('.ad-edit-automatic').checked)
        fill(popup, 'title', '동시 업데이트 보존')
        ad.status.setManual(first, 'waiting', '실시간 작업 이름')
        deck.resetScheduledCount(first); ad.render()
        await save(popup)
        check('Save preserves untouched live status, task name and count', first.customTitle === '동시 업데이트 보존'
            && ad.status.get(first).status === 'waiting' && ad.status.get(first).label === '실시간 작업 이름' && !deck.scheduledOf(first).manual)
        popup = dialog(); fill(popup, 'title', '저장 실패 제목'); fill(popup, 'alias', '저장 실패 별명')
        fill(popup, 'status', 'done'); fill(popup, 'automatic', false); fill(popup, 'scheduled', '7')
        ad.config.save = async () => { throw Error('Injected save failure') }
        popup.querySelector('.ad-edit-save').click()
        await wait(() => !popup.querySelector('.ad-edit-error').hidden)
        check('failed save stays open and rolls back changes', popup.open && first.customTitle === '동시 업데이트 보존'
            && deck.identityOf(first).alias === '팝업 검증 별명' && !deck.scheduledOf(first).manual && ad.status.get(first).status === 'waiting')
        ad.config.save = originalSave
        await save(popup)
        check('failed save can be retried', first.customTitle === '저장 실패 제목' && deck.scheduledOf(first).count === 7)
        popup = dialog()
        const title = fill(popup, 'title', '조합 중')
        title.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
        popup.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        check('IME Enter does not save', popup.open && first.customTitle === '저장 실패 제목')
        title.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        const button = popup.querySelector('.ad-edit-save'); button.focus()
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true, cancelable: true }))
        await sleep(100)
        check('Ctrl+W inside editor cannot close the underlying tab', ad.app.tabs.includes(first) && popup.open && !document.querySelector('.ad-close-confirm'))
        await cancel(popup)
        popup = dialog(); fill(popup, 'automatic', true); await save(popup)
        check('automatic count reset requires Save', !deck.scheduledOf(first).manual)
        popup = dialog(); fill(popup, 'title', '닫힌 탭 변경 금지')
        await ad.app.closeTab(first, false)
        await wait(() => !popup.isConnected)
        check('closing target removes its editor', !ad.app.tabs.includes(first) && ad.app.tabs.includes(other))
        return { pass: true, checks }
    } catch (error) { return { pass: false, checks, error: String(error), stack: error.stack } }
    finally {
        if (originalSave) ad.config.save = originalSave
        document.querySelector('.ad-tab-edit')?.close('cancel')
        for (const tab of made.reverse()) if (ad.app.tabs.includes(tab)) {
            deck?.resetScheduledCount(tab)
            await ad.app.closeTab(tab, false)
        }
    }
})()
