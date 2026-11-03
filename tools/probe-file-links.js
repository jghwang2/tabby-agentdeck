(async () => {
    const fs = require('fs'), path = require('path'), ad = window.__agentdeck
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('file-links-ui')) throw Error('Isolated file-link test required')
    const pane = ad.app.tabs.flatMap(t => t.getAllTabs?.() || [t]).find(p => p.frontend?.xterm)
    const x = pane.frontend.xterm, view = ad.view(), sleep = ms => new Promise(r => setTimeout(r, ms))
    // Wait for the real shell's startup output before replacing the test screen.
    let shellReady = false
    for (let i = 0; i < 100; i++) {
        shellReady = Array.from({length:x.rows}, (_, row) => x.buffer.active.getLine(x.buffer.active.baseY + row)?.translateToString(true) || '')
            .some(line => /^PS .*?>\s*$/.test(line))
        if (shellReady) break
        await sleep(200)
    }
    if (!shellReady) throw Error('PowerShell prompt readiness timeout')
    await sleep(300)
    const dir = path.join(process.env.TABBY_CONFIG_DIRECTORY, '..', 'work')
    fs.mkdirSync(dir, {recursive: true})
    const file = path.join(dir, '문서 test.txt'), relative = path.join(dir, 'relative.md')
    fs.writeFileSync(file, 'FILE_LINK_TEXT_OK'); fs.writeFileSync(relative, '# FILE_LINK_MARKDOWN_OK')
    const results = []
    const check = (name, pass) => { results.push({name, pass}); if (!pass) throw Error(JSON.stringify({name,body:body(),cols:x.cols,lines:Array.from({length:4},(_,i)=>({text:x.buffer.active.getLine(i)?.translateToString(true),wrapped:x.buffer.active.getLine(i)?.isWrapped})),link:x._core.linkifier._currentLink?.link?.text,cell:x._core.linkifier._lastBufferCell,mouseOut:x._core.linkifier._isMouseOut,activeLine:x._core.linkifier._activeLine,replies:[...x._core.linkifier._activeProviderReplies||[]].map(([k,v])=>[k,v?.map(l=>l.link?.text)]),viewport:x.buffer.active.viewportY})) }
    const body = () => document.querySelector('.ad-view-body')?.textContent || ''
    const write = text => new Promise(r => { x.reset(); x.write(text, r) })
    const click = async (ctrlKey = false) => {
        x.element.querySelector('.xterm-screen').dispatchEvent(new MouseEvent('mouseleave', {bubbles:true}))
        await sleep(100)
        const screen = x.element.querySelector('.xterm-screen'), rect = screen.getBoundingClientRect()
        const cell = x._core._renderService.dimensions.css.cell
        const options = {bubbles: true, clientX: rect.left + cell.width * 4.5, clientY: rect.top + cell.height * .5, button: 0, ctrlKey}
        screen.dispatchEvent(new MouseEvent('mousemove', {...options, clientY:rect.top + cell.height * 2.5})); await sleep(100)
        screen.dispatchEvent(new MouseEvent('mousemove', options)); await sleep(300)
        screen.dispatchEvent(new MouseEvent('mousedown', {...options, buttons: 1}))
        screen.dispatchEvent(new MouseEvent('mouseup', options)); await sleep(350)
    }
    const saved = ad.config.store.clickableLinks.modifier
    const blockExternalMouse = event => { if (event.isTrusted) event.stopImmediatePropagation() }
    const mouseEvents = ['mousemove', 'mousedown', 'mouseup', 'mouseleave', 'mouseout']
    mouseEvents.forEach(type => window.addEventListener(type, blockExternalMouse, true))
    try {
        ad.config.store.clickableLinks.modifier = 'ctrlKey'
        view.setOpen(false)
        await sleep(800)
        await write('"' + file + '"'); await click(false)
        check('plain click is ignored when Ctrl is required', !ad.config.store.agentDeck.viewerOpen)
        await click(true)
        check('Ctrl click opens quoted Korean text path in preview', body().includes('FILE_LINK_TEXT_OK'))
        ad.config.store.clickableLinks.modifier = null
        await write('relative.md:12'); await click(false)
        check('relative Markdown path and line suffix open on ordinary click', body().includes('FILE_LINK_MARKDOWN_OK'))
        await write('missing-file.txt'); await click(false)
        check('missing document displays preview error', body().includes('파일을 찾지 못했다'))
        await write('\x1b]8;;' + require('url').pathToFileURL(file).href + '\x07document link\x1b]8;;\x07'); await click(false)
        check('OSC 8 file URI opens preview', body().includes('FILE_LINK_TEXT_OK'))
        const cols = x.cols
        x.resize(25, x.rows)
        await write('"' + file + '"'); await click(false)
        check('wrapped quoted path opens preview', body().includes('FILE_LINK_TEXT_OK'))
        x.resize(cols, x.rows)
        return {results, handler: String(x.options.linkHandler.activate), body: body()}
    } finally {
        ad.config.store.clickableLinks.modifier = saved
        mouseEvents.forEach(type => window.removeEventListener(type, blockExternalMouse, true))
    }
})()
