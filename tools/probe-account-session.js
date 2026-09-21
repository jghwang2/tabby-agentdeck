/** Isolated Tabby + isolated AGENTDECK_ACCOUNTS_FILE only. No prompts or browser login. */
(async()=>{
    const fs=require('fs'),os=require('os'),path=require('path'),https=require('https'),cp=require('child_process')
    const {EventEmitter}=require('events'),ad=window.__agentdeck,sleep=ms=>new Promise(r=>setTimeout(r,ms))
    if(!process.env.AGENTDECK_ACCOUNTS_FILE?.includes('agentdeck-auth-probe-'))return {pass:false,error:'isolated account file required'}
    require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false)
    const data=JSON.parse(fs.readFileSync(process.env.AGENTDECK_ACCOUNTS_FILE,'utf8')),accounts=data.claude
    const root=path.join(process.env.LOCALAPPDATA,'tabby-agentdeck'),created=[],results=[]
    const add=(name,pass)=>results.push({name,pass:!!pass})
    const originalGet=https.get,originalSpawn=cp.spawn
    let requests=0,logins=0
    https.get=(url,options,callback)=>{
        if(String(url)!=='https://api.anthropic.com/api/oauth/usage')return originalGet(url,options,callback)
        requests++;const req=new EventEmitter();req.destroy=()=>req.emit('error',new Error('probe'))
        setTimeout(()=>{const res=new EventEmitter();res.statusCode=429;res.headers={'retry-after':'3600'};callback(res);res.emit('data','{}');res.emit('end');req.emit('close')},0)
        return req
    }
    cp.spawn=(command,args,...rest)=>{
        if(args?.[0]==='auth'&&args?.[1]==='login'){logins++;throw new Error('Unexpected interactive login in probe')}
        return originalSpawn(command,args,...rest)
    }
    const originalTabs=new Set(ad.app.tabs)
    // A previous run's persisted retry deadline must not suppress this run's deliberate 429 response.
    const accountDir=path.join(path.dirname(process.env.AGENTDECK_ACCOUNTS_FILE),'accounts')
    if(fs.existsSync(accountDir))for(const dir of fs.readdirSync(accountDir)){
        for(const name of ['usage.json','usage-retry.json']){try{fs.unlinkSync(path.join(accountDir,dir,name))}catch{}}
    }
    try{
        document.querySelector('.ad-new').click();await sleep(2000)
        const panes=ad.app.tabs.flatMap(t=>t.getAllTabs?t.getAllTabs():[t]).filter(t=>t.frontend?.xterm)
        const pane=panes.at(-1),owner=ad.app.tabs.find(t=>t===pane||t.getAllTabs?.().includes(pane))
        ad.app.selectTab(owner)
        const sid='adprobe-auth-session-'+Date.now()
        for(const [folder,value]of [
            ['status',{sessionId:sid,tabId:pane.id,agent:'claude',status:'running',ts:Date.now()}],
            ['meta',{sessionId:sid,agent:'claude',ts:Date.now(),model:'Opus',account:accounts[1].id,configDir:'',cwd:os.tmpdir(),limits:{fiveHourPct:25,sevenDayPct:61,scopedName:'Fable',scopedPct:38}}],
        ]){fs.mkdirSync(path.join(root,folder),{recursive:true});const file=path.join(root,folder,sid+'.json');fs.writeFileSync(file,JSON.stringify(value));created.push(file)}
        await sleep(1500);ad.render();document.querySelector('.ad-now-account').click()
        await sleep(3500)
        let popup=document.querySelector('.ad-account-picker'),options=[...popup.querySelectorAll('.ad-account-option')]
        add('provider accounts displayed',options.length===2)
        add('current account keeps all three usage bars',options[1].querySelectorAll('.ad-now-gauge').length===3)
        add('live usage matches sidebar source', [...options[1].querySelectorAll('.ad-now-gauge-pct')].map(x=>x.textContent).join(',')==='25%,61%,38%')
        add('429 does not request login',!/[다시재] ?로그인|log.?in/i.test(options[0].textContent))
        add('inactive account usage was throttled',requests===1)
        popup.querySelector('.ad-account-close').click();document.querySelector('.ad-now-account').click();await sleep(1500)
        add('reopening respects Retry-After',requests===1)
        popup=document.querySelector('.ad-account-picker');options=[...popup.querySelectorAll('.ad-account-option')]
        ad.status.setManual(owner,'running')
        const before=new Set(ad.app.tabs);options[0].click()
        for(let i=0;i<30&&!ad.app.tabs.some(t=>!before.has(t));i++)await sleep(500)
        const opened=ad.app.tabs.find(t=>!before.has(t))
        add('switch while working succeeds despite usage 429',!!opened)
        add('no interactive login launched',logins===0)
        if(opened){
            const leaf=opened.getAllTabs?opened.getAllTabs()[0]:opened
            let found=false
            for(let i=0;i<20&&!found;i++){
                const children=await Promise.race([leaf.session?.getChildProcesses?.()||[],sleep(1000).then(()=>[])])
                found=children.some(p=>/claude/i.test(p.command||p.name||''))||ad.agentOf(opened)?.effectiveId==='claude'
                const buf=leaf.frontend?.xterm?.buffer?.active
                const lines=[];if(buf)for(let j=0;j<buf.length;j++)lines.push(buf.getLine(j)?.translateToString(true)||'')
                const screen=lines.join('\n')
                found=found||/Claude Code v\d|Welcome (?:back|to Claude Code)/i.test(screen)
                if(!found)await sleep(500)
            }
            add('real Claude process launched with saved authentication',found)
            if(!found){
                const buf=leaf.frontend?.xterm?.buffer?.active
                const lines=[];if(buf)for(let i=Math.max(0,buf.length-35);i<buf.length;i++)lines.push(buf.getLine(i)?.translateToString(true)||'')
                let text=lines.join('\n');for(const a of accounts)text=text.split(a.id).join('[account]')
                window.__accountSessionFailure=text
                results.push({name:'terminal diagnostic',pass:false,detail:text.slice(-2000)})
            }
        }
    }finally{
        https.get=originalGet;cp.spawn=originalSpawn
        document.querySelector('.ad-account-close')?.click()
        for(const file of created){try{fs.unlinkSync(file)}catch{}}
        for(const tab of [...ad.app.tabs])if(!originalTabs.has(tab))await Promise.race([ad.app.closeTab(tab,true),sleep(1500)])
    }
    return {pass:results.every(x=>x.pass),results}
})()
