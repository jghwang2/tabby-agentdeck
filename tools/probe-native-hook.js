(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('native-hook-ui')) throw Error('Isolated app required')
    const fs=require('fs'),path=require('path'),cp=require('child_process'),ad=window.__agentdeck
    const base=path.dirname(process.env.TABBY_CONFIG_DIRECTORY),wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[]
    const check=(name,pass)=>{results.push({name,pass:!!pass});fs.writeFileSync(path.join(base,'native-results.json'),JSON.stringify(results,null,2));if(!pass)throw Error(name)}
    const params=Reflect.getMetadata('design:paramtypes',require('tabby-agentdeck').default),deck=ad.app.tabsService.injector.get(params[0])
    const platform=ad.app.tabsService.injector.get(require('tabby-core').PlatformService),original=platform.showMessageBox
    const homes=[process.env.CLAUDE_CONFIG_DIR,process.env.CODEX_HOME],files=homes.map((h,i)=>path.join(h,i?'hooks.json':'settings.json'))
    for(let i=0;i<2;i++){
        fs.writeFileSync(files[i],JSON.stringify({hooks:{PostToolUse:[{matcher:'*',hooks:[
            {type:'command',command:'echo preserve-user',timeout:17},
            {type:'command',command:`powershell -File "C:/old/tabby-agentdeck/hooks/agentdeck-${i?'codex-':''}notify.ps1"${i?'':' -Status running'}`,timeout:i?3:5},
        ]}]}}))
        const ledger=path.join(homes[i],'.agentdeck-hook-registry.json')
        if(fs.existsSync(ledger))fs.unlinkSync(ledger)
    }
    const before=files.map(f=>fs.readFileSync(f,'utf8'))
    let response=1,dialogs=[]
    platform.showMessageBox=async options=>{dialogs.push(options);return {response}}
    try {
        await deck.notify.promptHookUpgrade()
        check('decline preserves both CLI homes',files.every((f,i)=>fs.readFileSync(f,'utf8')===before[i]))
        check('dialog explains local history cleanup then install',dialogs[0].detail.includes('이력')&&dialogs[0].detail.includes('정리한 뒤 새 훅'))
        response=0;await deck.notify.promptHookUpgrade()
        for(let i=0;i<2;i++){
            const s=JSON.parse(fs.readFileSync(files[i])),hooks=s.hooks.PostToolUse.flatMap(g=>g.hooks)
            check((i?'codex':'claude')+' history removed before native installation',hooks.length===2&&hooks[0].command==='echo preserve-user'&&/^".*\.exe"/.test(hooks[1].command))
            check((i?'codex':'claude')+' backup created',fs.readdirSync(homes[i]).some(n=>n.startsWith(path.basename(files[i])+'.agentdeck-backup-')))
        }
        const count=dialogs.length;await deck.notify.promptHookUpgrade()
        check('same revision does not prompt again',dialogs.length===count)
        // Source revision-only change is represented by the prior installed revision in the registry.
        const ledger=path.join(homes[1],'.agentdeck-hook-registry.json'),record=JSON.parse(fs.readFileSync(ledger))
        record.revision='previous-revision';fs.writeFileSync(ledger,JSON.stringify(record))
        await deck.notify.promptHookUpgrade();check('changed revision prompts once',dialogs.length===count+1)
        await deck.notify.promptHookUpgrade();check('accepted changed revision remains quiet',dialogs.length===count+1)
        if(!ad.app.tabs.some(t=>(t.getAllTabs?.()||[t]).some(p=>p.session)))document.querySelector('.ad-new').click()
        await wait(800)
        const tab=ad.app.tabs.find(t=>(t.getAllTabs?.()||[t]).some(p=>p.session)),pane=(tab.getAllTabs?.()||[tab]).find(p=>p.session)
        const tabId=pane.profile.options.env.AGENTDECK_TAB,sid='agentdeck-probe-native-session'
        const command=JSON.parse(fs.readFileSync(files[1])).hooks.Stop[0].hooks[0].command,exe=/^"([^"]+)"$/.exec(command)[1]
        await new Promise((resolve,reject)=>{
            const child=cp.spawn(exe,[],{windowsHide:true,env:{...process.env,AGENTDECK_RUNTIME_ROOT:deck.notify.hookDispatcher.root,AGENTDECK_TAB:tabId},stdio:['pipe','pipe','pipe']})
            child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',code=>code?reject(Error('native exit '+code)):resolve())
            child.stdin.end(JSON.stringify({session_id:sid,hook_event_name:'Stop',cwd:pane.profile.options.cwd}))
        })
        await deck.notify.hookDispatcher.tail;await wait(700);ad.render()
        check('installed executable delivered to real isolated receiver',JSON.parse(fs.readFileSync(path.join(deck.notify.hookDispatcher.root,'status',sid+'.json'))).status==='done')
        check('receiver bound actual terminal session',deck.notify.sessionIdsOf(tab).includes(sid))
        // Leave the actual native consent dialog for the Windows button driver.
        record.revision='previous-revision';fs.writeFileSync(ledger,JSON.stringify(record))
        platform.showMessageBox=original
        window.__nativeUpgradePending=deck.notify.promptHookUpgrade().then(()=>{
            const final=JSON.parse(fs.readFileSync(ledger));check('native Yes button completed cleanup and install',final.revision!=='previous-revision')
        })
        return {pass:true,results,pendingNativeConfirmation:true}
    } finally {platform.showMessageBox=original}
})()
