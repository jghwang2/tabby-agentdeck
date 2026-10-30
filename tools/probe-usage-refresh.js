(async () => {
    const fs=require('fs'),path=require('path'),https=require('https'),{EventEmitter}=require('events')
    if(!process.env.TABBY_CONFIG_DIRECTORY?.includes('usage-refresh-ui'))throw Error('Dedicated isolated app required')
    const base=path.dirname(process.env.TABBY_CONFIG_DIRECTORY),ad=window.__agentdeck
    const params=Reflect.getMetadata('design:paramtypes',require('tabby-agentdeck').default)
    const deck=ad.app.tabsService.injector.get(params[6]).deck
    const sleep=ms=>new Promise(r=>setTimeout(r,ms)),results=[]
    const check=(name,pass)=>{results.push({name,pass:!!pass});fs.writeFileSync(path.join(base,'results.json'),JSON.stringify(results,null,2));if(!pass)throw Error(name)}
    const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data))}
    const fixture=agent=>({agent,account:agent+'@example.test',configDir:path.join(base,agent+'-fixture'),ts:1,model:agent+' fixture',contextPct:42,limits:{fiveHourPct:1,sevenDayPct:2}})
    const claude=fixture('claude'),codex=fixture('codex')
    write(path.join(claude.configDir,'.claude.json'),{oauthAccount:{emailAddress:claude.account}})
    write(path.join(claude.configDir,'.credentials.json'),{claudeAiOauth:{accessToken:'fixture'}})
    write(path.join(codex.configDir,'auth.json'),{tokens:{id_token:'fixture.'+Buffer.from(JSON.stringify({email:codex.account})).toString('base64url')+'.fixture',access_token:'fixture',account_id:'fixture'}})
    const originalGet=https.get,originalMeta=deck.notify.metaOf
    let active=claude,requests=0,status=200
    const tab=ad.app.activeTab,pane=tab.getAllTabs?.()[0]||tab,pty=pane.session
    deck.notify.metaOf=()=>active
    https.get=(url,options,callback)=>{
        if(!/anthropic.com\/api\/oauth\/usage|chatgpt.com\/backend-api\/wham\/usage/.test(String(url)))return originalGet(url,options,callback)
        requests++;const req=new EventEmitter();req.destroy=()=>req.emit('error',new Error('fixture'))
        setTimeout(()=>{const res=new EventEmitter();res.statusCode=status;res.headers={'retry-after':'120'};callback(res)
            const body=String(url).includes('anthropic')?{five_hour:{utilization:28},seven_day:{utilization:68},limits:[{kind:'weekly_scoped',percent:100,scope:{model:{display_name:'Fable'}}}]}:
            {account_id:'fixture',model_usage:{astra:{available:true}},rate_limit:{primary_window:{used_percent:32,limit_window_seconds:18000},secondary_window:{used_percent:48,limit_window_seconds:604800}}}
            res.emit('data',JSON.stringify(body));res.emit('end');req.emit('close')
        },150);return req
    }
    const button=()=>document.querySelector('.ad-now-refresh'),text=()=>document.querySelector('.ad-now').textContent
    try {
        deck.renderNow();check('refresh accessible',button().getAttribute('aria-label').includes('새로고침'))
        button().click();check('busy disabled',button().disabled);button().click()
        await sleep(250);deck.renderNow();check('one request for repeated click',requests===1)
        check('Claude usage and Fable rendered',text().includes('28%')&&text().includes('68%')&&text().includes('100%'))
        check('context remains 42',text().includes('42%'))
        active=codex;deck.renderNow();button().click()
        active=claude;deck.renderNow();await sleep(250);deck.renderNow()
        check('late Codex response does not replace Claude',text().includes('28%')&&!text().includes('32%'))
        active=codex;deck.renderNow();check('Codex usage rendered',text().includes('32%')&&text().includes('48%'))
        check('model availability and refresh success hidden',!text().includes('사용 가능')&&!text().includes('사용량을 갱신했습니다'))
        deck.usageRefresh.state(codex).retryAt=0;status=429;deck.renderNow();button().click();await sleep(250);deck.renderNow()
        check('failure preserves values and reports failure',text().includes('32%')&&text().includes('갱신하지 못'))
        const count=requests;button().click();await sleep(50);check('rate limit blocks clicks',requests===count&&button().disabled)
        active={...claude,account:'unrelated@example.test'};deck.renderNow()
        check('other account never shows previous usage',!text().includes('28%')&&!text().includes('100%'))
        check('tab and PTY preserved',ad.app.activeTab===tab&&pane.session===pty)
        return {pass:true,results}
    } finally {https.get=originalGet;deck.notify.metaOf=originalMeta;deck.renderNow()}
})()
