(async () => {
    const fs=require('fs'),path=require('path'),crypto=require('crypto')
    if(!process.env.TABBY_CONFIG_DIRECTORY?.includes('hook-management-ui'))throw Error('Dedicated isolated app required')
    const base=path.dirname(process.env.TABBY_CONFIG_DIRECTORY),ad=window.__agentdeck,wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[]
    const check=(name,pass)=>{results.push({name,pass:!!pass});fs.writeFileSync(path.join(base,'management-results.json'),JSON.stringify(results,null,2));if(!pass)throw Error(name)}
    const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v))},read=f=>JSON.parse(fs.readFileSync(f,'utf8'))
    const platform=ad.app.tabsService.injector.get(require('tabby-core').PlatformService),original=platform.showMessageBox
    if(!document.querySelector('agentdeck-settings-tab')){
        document.querySelector('button[title="설정"]').click();await wait(500)
        ;[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim()==='AgentDeck').click();await wait(500)
    }
    const inspect=()=>document.querySelector('.ad-hook-preview'),text=()=>inspect()?.textContent||''
    const click=async(provider,action)=>{document.querySelector(`[data-hook-provider="${provider}"] [data-hook-action="${action}"]`).click();await wait(150)}
    const apply=async()=>{
        document.querySelector('[data-hook-apply]').click()
        for(let i=0;i<100&&!inspect()?.querySelector('[role="status"]')?.textContent.trim();i++)await wait(50)
        await wait(100)
    }
    const settingsFile=(home,provider)=>path.join(home,provider==='claude'?'settings.json':'hooks.json')
    const foreign={type:'command',command:'echo USER-HOOK',timeout:11}
    const fixture=provider=>({model:'keep',hooks:{Stop:[{matcher:'*',hooks:[foreign]}]},...(provider==='claude'?{statusLine:{type:'command',command:'echo USER-STATUS'}}:{})})
    const homes={claude:path.join(base,'claude-home'),codex:path.join(base,'codex-home')}
    const acc={claude:'fixture-claude@example.test',codex:'fixture-codex@example.test'}
    const accountsRoot=path.join(base,'accounts')
    write(path.join(accountsRoot,'accounts.json'),{claude:[{id:acc.claude}],codex:[{id:acc.codex}]})
    const saved=provider=>path.join(accountsRoot,'accounts',crypto.createHash('sha256').update(provider+':'+acc[provider]).digest('hex').slice(0,24))
    for(const provider of ['claude','codex'])for(const home of [homes[provider],saved(provider)])write(settingsFile(home,provider),fixture(provider))
    let response=1,dialogs=0
    platform.showMessageBox=async()=>{dialogs++;return {response}}
    try{
        for(const provider of ['claude','codex']){
            const file=settingsFile(homes[provider],provider),before=fs.readFileSync(file,'utf8')
            check(provider+' five distinct buttons',document.querySelectorAll(`[data-hook-provider="${provider}"] button`).length===5)
            await click(provider,'view');check(provider+' full text and no writes',text().includes('USER-HOOK')&&fs.readFileSync(file,'utf8')===before&&document.querySelector('[data-hook-apply]').disabled)
            await click(provider,'apply');check(provider+' preview before write',text().includes('추가')&&fs.readFileSync(file,'utf8')===before)
            response=1;await apply();check(provider+' cancel preserves settings',fs.readFileSync(file,'utf8')===before&&text().includes('취소'))
            response=0;await apply()
            for(const home of [homes[provider],saved(provider)]){
                const current=read(settingsFile(home,provider)),registry=read(path.join(home,'.agentdeck-hook-registry.json'))
                check(provider+' register and keep foreign '+path.basename(home),registry.groups.length===(provider==='claude'?9:7)&&current.hooks.Stop[0].hooks[0].command==='echo USER-HOOK'&&current.model==='keep')
            }
            await click(provider,'apply');check(provider+' repeat is no-op',document.querySelector('[data-hook-apply]').disabled)
            await click(provider,'managed');await apply()
            check(provider+' managed removal keeps foreign',read(file).hooks.Stop.length===1&&read(file).hooks.Stop[0].hooks[0].command==='echo USER-HOOK')
            if(provider==='claude')check('original status line restored',read(file).statusLine.command==='echo USER-STATUS')
            // Historical launcher mixed into the user's group, including the old installer flag.
            const old=fixture(provider),event=provider==='claude'?'UserPromptSubmit':'Stop'
            old.hooks[event]=[{matcher:'*',hooks:[foreign,{type:'command',timeout:provider==='claude'?5:3,
                command:`powershell -NoProfile -ExecutionPolicy Bypass -File "C:/old/tabby-agentdeck/hooks/agentdeck-${provider==='codex'?'codex-':''}notify.ps1"${provider==='claude'?' -Status running -PromptAsLabel':''}`}]}]
            write(file,old);await click(provider,'history');check(provider+' history evidence visible',text().includes('a05e77f'));await apply()
            check(provider+' historical removal is item-only',read(file).hooks[event][0].hooks.length===1&&read(file).hooks[event][0].hooks[0].command==='echo USER-HOOK')
            await click(provider,'apply');fs.appendFileSync(file,' ');await apply();check(provider+' stale preview rejected',text().includes('설정이 변경'))
            await click(provider,'apply');await apply();await click(provider,'reset');await apply()
            check(provider+' reset never clears user hook',Object.values(read(file).hooks).flatMap(gs=>gs.flatMap(g=>g.hooks)).every(h=>h.command==='echo USER-HOOK'))
        }
        check('confirmation used for every mutation',dialogs>=10)
        // Leave a real native confirmation ready for the scoped Windows dialog driver.
        platform.showMessageBox=original
        await click('claude','apply');document.querySelector('[data-hook-apply]').click()
        return {pass:true,results,pendingNativeConfirmation:true}
    }finally{platform.showMessageBox=original}
})()
