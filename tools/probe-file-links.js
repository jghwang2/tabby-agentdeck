(async () => {
    const fs = require('fs'), path = require('path'), {pathToFileURL} = require('url'), ad = window.__agentdeck
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('file-links-ui')) throw Error('Isolated file-link test required')
    const pane = ad.app.tabs.flatMap(t => t.getAllTabs?.() || [t]).find(p => p.frontend?.xterm)
    const owner = ad.app.tabs.find(t => t === pane || t.getAllTabs?.().includes(pane))
    ad.app.selectTab(owner)
    const x = pane.frontend.xterm, view = ad.view(), sleep = ms => new Promise(r => setTimeout(r, ms))
    const dir = path.join(process.env.TABBY_CONFIG_DIRECTORY, '..', 'work')
    fs.mkdirSync(dir, {recursive: true})
    let shellReady = false
    for (let i = 0; i < 100; i++) {
        shellReady = Array.from({length:x.rows}, (_, row) => x.buffer.active.getLine(x.buffer.active.baseY + row)?.translateToString(true) || '')
            .some(line => /^PS .*?>\s*$/.test(line))
        if (shellReady) break
        await sleep(200)
    }
    if (!shellReady) throw Error('PowerShell prompt readiness timeout')
    pane.sendInput("Set-Location -LiteralPath '" + dir.replace(/'/g, "''") + "'\r")
    let cwd
    for (let i = 0; i < 12; i++) {
        await sleep(1000)
        cwd = pane.frontend.__adFileLinkCwd?.()
        if (cwd && path.resolve(cwd).toLowerCase() === path.resolve(dir).toLowerCase()) break
        pane.sendInput('Get-Location\r')
    }
    if (!cwd || path.resolve(cwd).toLowerCase() !== path.resolve(dir).toLowerCase()) throw Error('CWD not observed: '+cwd)
    let lastOutput = Date.now()
    const outputSubscription = pane.session.output$.subscribe(() => { lastOutput = Date.now() })
    try {
        for (let i=0;i<100 && Date.now()-lastOutput<1200;i++) await sleep(200)
        if (Date.now()-lastOutput<1200) throw Error('Shell output did not settle')
    } finally { outputSubscription.unsubscribe() }
    const file = path.join(dir, '문서 test.txt'), relative = path.join(dir, 'relative.md')
    fs.writeFileSync(file, 'FILE_LINK_TEXT_OK'); fs.writeFileSync(relative, '# FILE_LINK_MARKDOWN_OK')
    const results = [], external = []
    const check = (name, pass) => { results.push({name, pass}); if (!pass) throw Error(JSON.stringify({name,cwd,external,cols:x.cols,lines:Array.from({length:3},(_,i)=>x.buffer.active.getLine(i)?.translateToString(true)),link:x._core.linkifier._currentLink?.link?.text})) }
    const platform = ad.app.tabsService.injector.get(require('tabby-core').PlatformService), originalOpen = platform.openPath
    let launch = false
    platform.openPath = function (file) { external.push(pathToFileURL(file).href); if (launch) return originalOpen.call(this,file) }
    const write = text => new Promise(r => { x.reset(); x.write(text, r) })
    const click = async (ctrlKey = false) => {
        const screen = x.element.querySelector('.xterm-screen'), rect = screen.getBoundingClientRect()
        const cell = x._core._renderService.dimensions.css.cell
        const options = {bubbles:true,clientX:rect.left+cell.width*4.5,clientY:rect.top+cell.height*.5,button:0,ctrlKey}
        screen.dispatchEvent(new MouseEvent('mousemove',{...options,clientY:rect.top+cell.height*2.5})); await sleep(100)
        screen.dispatchEvent(new MouseEvent('mousemove',options)); await sleep(350)
        screen.dispatchEvent(new MouseEvent('mousedown',{...options,buttons:1}))
        screen.dispatchEvent(new MouseEvent('mouseup',options)); await sleep(350)
    }
    const saved = ad.config.store.clickableLinks.modifier
    const blockMouse = event => { if (event.isTrusted) event.stopImmediatePropagation() }
    const mouseEvents = ['mousemove','mousedown','mouseup','mouseleave','mouseout']
    mouseEvents.forEach(type=>window.addEventListener(type,blockMouse,true))
    try {
        ad.openFile(relative); await sleep(300)
        check('existing preview remains usable', document.querySelector('.ad-view-body')?.textContent.includes('FILE_LINK_MARKDOWN_OK'))
        view.setOpen(false); await sleep(800)
        ad.config.store.clickableLinks.modifier = 'ctrlKey'
        await write('"'+file+'"'); await click(false)
        check('Ctrl requirement is respected', external.length===0)
        await click(true)
        check('Ctrl click sends existing Korean file to default app', external.at(-1)===pathToFileURL(file).href)
        check('terminal file click does not open or change preview', !ad.config.store.agentDeck.viewerOpen && view.current===relative)
        ad.config.store.clickableLinks.modifier = null
        await write('relative.md:12'); await click()
        check('relative path resolves against terminal cwd', external.at(-1)===pathToFileURL(relative).href)
        let count = external.length
        for (const [name,text] of [
            ['missing file','missing-file.txt'],
            ['remote command',"'cd /home/sololv_admin/guide_rag && sh deploy/GuideRag_Stop.sh'"],
            ['remote directory','/home/sololv_admin/guide_rag'],
            ['missing OSC URI','\x1b]8;;file:///D:/absent-file-link-test.txt\x07missing link\x1b]8;;\x07'],
        ]) {
            await write(text); await click()
            check(name+' has no underline or open action', !x._core.linkifier._currentLink && external.length===count)
        }
        await write('\x1b]8;;'+pathToFileURL(file).href+'\x07document link\x1b]8;;\x07'); await click()
        check('existing OSC URI opens default app', external.length===++count && external.at(-1)===pathToFileURL(file).href)
        const cols = x.cols; x.resize(25,x.rows); await sleep(1000)
        await write('"'+file+'"'); await click()
        check('wrapped path opens default app', external.length===++count)
        x.resize(cols,x.rows); await sleep(1000)
        fs.unlinkSync(file); await sleep(1600)
        await write('"'+file+'"'); await click()
        check('deleted file loses underline', !x._core.linkifier._currentLink && external.length===count)
        fs.writeFileSync(file,'FILE_LINK_TEXT_OK'); await sleep(1600)
        await write('"'+file+'"'); await click()
        check('recreated file becomes clickable', !!x._core.linkifier._currentLink && external.length===++count)
        const start=performance.now(); await pane.frontend.__adFileLinkLookup.resolve(file,null,true)
        const coldMs=performance.now()-start,warmStart=performance.now()
        await Promise.all(Array.from({length:100},()=>pane.frontend.__adFileLinkLookup.resolve(file,null)))
        const warm100Ms=performance.now()-warmStart
        const externalFile=path.join(dir,'AgentDeck-file-link-system-test.txt')
        fs.writeFileSync(externalFile,'AGENTDECK_DEFAULT_APP_OK')
        launch=true; await write('"'+externalFile+'"'); await click()
        check('real platform default-app call is dispatched', external.at(-1)===pathToFileURL(externalFile).href)
        return {results,coldMs,warm100Ms,externalFile,external}
    } finally {
        platform.openPath=originalOpen
        ad.config.store.clickableLinks.modifier=saved
        mouseEvents.forEach(type=>window.removeEventListener(type,blockMouse,true))
    }
})()
