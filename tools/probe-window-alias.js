(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('window-alias')) throw Error('Isolated app required')
    const fs = require('fs'), path = require('path'), remote = require('@electron/remote')
    const ad = window.__agentdeck, wait = ms => new Promise(r => setTimeout(r, ms)), results = []
    const base = path.dirname(process.env.TABBY_CONFIG_DIRECTORY)
    const check = (name, pass, detail) => {
        results.push({name, pass: !!pass, detail})
        fs.writeFileSync(path.join(base, 'window-results.json'), JSON.stringify(results, null, 2))
        if (!pass) throw Error(name)
    }
    const first = remote.getCurrentWindow(), before = new Set(remote.BrowserWindow.getAllWindows().map(w => w.id))
    ad.app.tabsService.injector.get(require('tabby-core').HostAppService).newWindow()
    let second
    for (let i=0;i<100;i++) {
        second = remote.BrowserWindow.getAllWindows().find(w => !before.has(w.id))
        if (second && await second.webContents.executeJavaScript('!!window.__agentdeck?.app?.tabs?.length').catch(()=>false)) break
        await wait(100)
    }
    check('second real window with same configuration', !!second)
    const evaluate = (win, fn) => win.webContents.executeJavaScript('(' + fn.toString() + ')()')
    const snapshot = () => {
        const ad=window.__agentdeck
        ad.render()
        return {names:[...document.querySelectorAll('.ad-identity')].map(e=>e.textContent),
            ids: ad.app.tabs.flatMap(t=>(t.getAllTabs?.()||[t]).map(p=>p.profile?.options?.env?.AGENTDECK_IDENTITY)).filter(Boolean),
            records:JSON.parse(JSON.stringify(ad.config.store.agentDeck.sessionIdentities||[]))}
    }
    for (const win of [first,second]) await evaluate(win, async()=>{
        const ad=window.__agentdeck, wait=ms=>new Promise(r=>setTimeout(r,ms))
        if(!ad.app.tabs.some(t=>(t.getAllTabs?.()||[t]).some(p=>p.session)))document.querySelector('.ad-new').click()
        for(let i=0;i<100;i++){
            if(ad.app.tabs.some(t=>(t.getAllTabs?.()||[t]).some(p=>p.session?.getID?.())))break
            await wait(100)
        }
        for(const t of ad.app.tabs)if((t.getAllTabs?.()||[t]).some(p=>p.session))t.customTitle='AgentDeck window test'
        ad.render()
    })
    await wait(1500)
    const a=await evaluate(first,snapshot), b=await evaluate(second,snapshot)
    check('windows have distinct live identities', a.ids.length&&b.ids.length&&!a.ids.some(id=>b.ids.includes(id)), {a,b})
    await wait(1000)
    for (const win of [first,second]) await evaluate(win,()=>{
        const ad=window.__agentdeck
        window.__aliasSaves=0; window.__aliasOriginalSave=ad.config.save
        ad.config.save=function(...args){window.__aliasSaves++;return window.__aliasOriginalSave.apply(this,args)}
    })
    for(let i=0;i<16;i++) {await evaluate(first,snapshot);await evaluate(second,snapshot);await wait(100)}
    const stableA=await evaluate(first,snapshot),stableB=await evaluate(second,snapshot)
    for(const [name,s] of [['first',stableA],['second',stableB]]) {
        check(name+' retains both windows', [...a.ids,...b.ids].every(id=>s.records.some(r=>r.id===id)),s)
    }
    const saves = await Promise.all([first,second].map(w=>evaluate(w,()=>window.__aliasSaves)))
    check('rendering does not rewrite shared settings', saves.every(n=>n===0), saves)
    await evaluate(second,async()=>{
        const ad=window.__agentdeck
        for(const t of [...ad.app.tabs])await ad.app.closeTab(t,true)
        document.querySelector('.ad-new').click()
    })
    await wait(1500)
    const afterA=await evaluate(first,snapshot),afterB=await evaluate(second,snapshot)
    check('closing second window tab preserves first identities',a.ids.every(id=>afterA.records.some(r=>r.id===id)),afterA)
    check('closed local identities retained until hook TTL expires',b.ids.every(id=>afterB.records.some(r=>r.id===id)),afterB)
    check('first window aliases unchanged',JSON.stringify(a.names)===JSON.stringify(afterA.names),afterA.names)
    for(const win of [first,second])await evaluate(win,()=>{window.__agentdeck.config.save=window.__aliasOriginalSave})
    second.close()
    await wait(500)
    const params=Reflect.getMetadata('design:paramtypes',require('tabby-agentdeck').default)
    const deck=ad.app.tabsService.injector.get(params[0])
    const ttl=24*60*60*1000,now=Date.now()
    ad.config.store.agentDeck.sessionIdentities.push({id:'orphan-fixture',letter:'',alias:'Orphan1',createdAt:now-ttl-1000})
    ad.config.store.agentDeck.sessionIdentities.push({id:'recent-fixture',letter:'',alias:'Recent1',createdAt:now-ttl+60000})
    await ad.config.save()
    deck.notify.nextAliasExpiry=0;await deck.notify.expireAliases()
    check('server removes records after 24h without hooks',!ad.config.store.agentDeck.sessionIdentities.some(r=>r.id==='orphan-fixture'))
    check('server retains records younger than 24h',ad.config.store.agentDeck.sessionIdentities.some(r=>r.id==='recent-fixture'))
    const tab=ad.app.tabs.find(t=>(t.getAllTabs?.()||[t]).some(p=>p.session)),pane=(tab.getAllTabs?.()||[tab]).find(p=>p.session)
    const identity=deck.identityOf(tab),originalAlias=identity.alias,tabId=pane.profile.options.env.AGENTDECK_TAB
    const expire=async()=>{
        const record=ad.config.store.agentDeck.sessionIdentities.find(r=>r.id===identity.id)
        record.createdAt=Date.now()-ttl-1000
        const activity=deck.notify.hookDispatcher.aliasActivity
        activity.latest.clear()
        fs.mkdirSync(activity.dir,{recursive:true})
        for(const name of fs.readdirSync(activity.dir).filter(n=>n.startsWith(tabId+'.')))fs.writeFileSync(path.join(activity.dir,name),JSON.stringify({ts:Date.now()-ttl-1000}))
        deck.notify.nextAliasExpiry=0;await deck.notify.expireAliases()
    }
    const hook=async()=>{
        await deck.notify.hookDispatcher.submit({channel:'agentdeck-hook',id:'alias-'+Date.now(),kind:'notify',ts:Date.now(),
            hook:{session_id:'alias-fixture-session',hook_event_name:'Stop',cwd:pane.profile.options.cwd},
            options:{Agent:'codex'},env:{AGENTDECK_TAB:tabId}})
        await deck.notify.hookDispatcher.tail;ad.render()
    }
    await expire();ad.render()
    check('idle render does not recreate expired record',!ad.config.store.agentDeck.sessionIdentities.some(r=>r.id===identity.id))
    await hook()
    check('new hook restores available prior alias',deck.identityOf(tab).alias===originalAlias&&ad.config.store.agentDeck.sessionIdentities.some(r=>r.id===identity.id))
    await expire()
    ad.config.store.agentDeck.sessionIdentities.push({id:'alias-conflict-fixture',letter:'',alias:originalAlias,createdAt:Date.now()})
    await ad.config.save();await hook()
    check('new hook allocates another alias when old name is occupied',deck.identityOf(tab).alias!==originalAlias)
    return {pass:true,results}
})()
