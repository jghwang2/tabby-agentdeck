(async () => {
    const fs = require('fs'), path = require('path'), crypto = require('crypto')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('account-fix-ui')) throw Error('Dedicated isolated app required')
    const base = path.dirname(process.env.TABBY_CONFIG_DIRECTORY), ad = window.__agentdeck
    const params = Reflect.getMetadata('design:paramtypes', require('tabby-agentdeck').default)
    const deck = ad.app.tabsService.injector.get(params[6]).deck
    const wait = ms => new Promise(r => setTimeout(r, ms)), results = []
    const check = (name, pass, evidence) => { results.push({name,pass:!!pass,evidence}); fs.writeFileSync(path.join(base,'results.json'),JSON.stringify(results,null,2)); if(!pass)throw Error(name) }
    const until = async fn => { for(let i=0;i<250;i++){if(fn())return;await wait(100)}throw Error('Timed out: '+fn.toString()) }
    const sid = '11111111-1111-4111-8111-111111111111', project = 'D--account-fixture'
    const account = id => ({provider:'claude',id,key:crypto.createHash('sha256').update('claude:'+id).digest('hex').slice(0,24),name:id})
    const a=account('a@example.test'),b=account('b@example.test')
    const home = a => path.join(base,'accounts','accounts',a.key)
    const transcript = a => path.join(home(a),'projects',project,sid+'.jsonl')
    const settings = a => JSON.parse(fs.readFileSync(path.join(home(a),'settings.json'),'utf8'))
    fs.writeFileSync(path.join(base,'accounts','accounts.json'),JSON.stringify({claude:[{id:a.id},{id:b.id}]}))
    for(const acc of [a,b]) {
        fs.mkdirSync(path.dirname(transcript(acc)),{recursive:true})
        fs.writeFileSync(path.join(home(acc),'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:acc.id}}))
        fs.writeFileSync(path.join(home(acc),'settings.json'),JSON.stringify({model:'keep-model',statusLine:{type:'command',command:'echo USER-'+acc.id},hooks:{Stop:[{hooks:[{type:'command',command:'echo keep-user-hook'}]}]}}))
    }
    if(!document.querySelector('agentdeck-settings-tab')) {
        document.querySelector('button[title="설정"]').click();await wait(500)
        ;[...document.querySelectorAll('a,button')].find(x=>x.textContent.trim()==='AgentDeck').click();await wait(500)
    }
    const row = () => [...document.querySelectorAll('agentdeck-settings-tab .form-line')].find(x=>/Claude 연동|Claude integration/.test(x.innerText))
    check('Claude settings row visible',!!row())
    const button = () => row().querySelector('button')
    button().click();await wait(500)
    for(const acc of [a,b]) {
        check('toggle installs account '+acc.id,settings(acc).statusLine.command.includes('--inner')&&settings(acc).hooks.UserPromptSubmit.length>0)
        check('preserve user fields '+acc.id,settings(acc).model==='keep-model'&&settings(acc).hooks.Stop.some(e=>e.hooks.some(h=>h.command==='echo keep-user-hook')))
    }
    button().click();await wait(500)
    for(const acc of [a,b])check('toggle restores account '+acc.id,settings(acc).statusLine.command==='echo USER-'+acc.id)
    button().click();await wait(500)
    const driver=path.join(base,'driver.cjs')
    fs.writeFileSync(driver,`const fs=require('fs'),path=require('path'),cp=require('child_process');
const home=process.env.CLAUDE_CONFIG_DIR, sid=${JSON.stringify(sid)},file=path.join(home,'projects',${JSON.stringify(project)},sid+'.jsonl');
const loaded=fs.readFileSync(file,'utf8');fs.writeFileSync(path.join(home,'loaded.json'),JSON.stringify({loaded,pid:process.pid}));
const settings=JSON.parse(fs.readFileSync(path.join(home,'settings.json'),'utf8'));
const start=cp.spawn(settings.hooks.UserPromptSubmit[0].hooks[0].command,{shell:true,env:process.env,stdio:['pipe','ignore','ignore']});
start.stdin.end(JSON.stringify({session_id:sid,cwd:${JSON.stringify(base)},hook_event_name:'UserPromptSubmit'}));
start.on('close',()=>{const child=cp.spawn(settings.statusLine.command,{shell:true,env:process.env,stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',x=>out+=x);child.on('close',()=>fs.writeFileSync(path.join(home,'status-output.txt'),out));
child.stdin.end(JSON.stringify({session_id:sid,cwd:${JSON.stringify(base)},model:{id:'fixture',display_name:'fixture'},context_window:{used_percentage:42},rate_limits:{seven_day:{used_percentage:17}}}));});
let n=0;setInterval(()=>fs.appendFileSync(file,JSON.stringify({home,turn:++n})+'\\n'),100);
console.log('ACCOUNT-FIX-FIXTURE-READY');`)
    fs.writeFileSync(transcript(a),'{}\n')
    const previousTabs=new Set(ad.app.tabs);document.querySelector('.ad-new').click()
    await until(()=>ad.app.tabs.some(t=>!previousTabs.has(t)&&(t.getAllTabs?.()[0]||t).session?.open))
    const tab=ad.app.tabs.find(t=>!previousTabs.has(t));ad.app.selectTab(tab)
    const command='node "'+driver+'"'
    await deck.switchAccountInTab(tab,a,command,base)
    await until(()=>fs.existsSync(path.join(home(a),'loaded.json'))&&fs.existsSync(path.join(home(a),'status-output.txt')))
    await wait(400)
    const oldPid=JSON.parse(fs.readFileSync(path.join(home(a),'loaded.json'),'utf8')).pid
    await deck.switchAccountInTab(tab,b,command,base,{sessionId:sid,configDir:home(a)})
    await until(()=>fs.existsSync(path.join(home(b),'loaded.json'))&&fs.existsSync(path.join(home(b),'status-output.txt')))
    const first=fs.readFileSync(transcript(a),'utf8')
    check('copy includes all old-process writes',JSON.parse(fs.readFileSync(path.join(home(b),'loaded.json'),'utf8')).loaded===first)
    await wait(250);check('old transcript stopped growing',fs.readFileSync(transcript(a),'utf8')===first)
    let oldAlive=false;try{process.kill(oldPid,0);oldAlive=true}catch{}
    check('old CLI process exited',!oldAlive)
    fs.unlinkSync(path.join(home(a),'loaded.json'))
    await deck.switchAccountInTab(tab,a,command,base,{sessionId:sid,configDir:home(b)})
    await until(()=>fs.existsSync(path.join(home(a),'loaded.json')))
    check('A to B to A resumes latest history',JSON.parse(fs.readFileSync(path.join(home(a),'loaded.json'),'utf8')).loaded===fs.readFileSync(transcript(b),'utf8'))
    check('same tab preserved',ad.app.tabs.includes(tab)&&ad.app.activeTab===tab)
    for(const acc of [a,b])check('actual wrapper preserves account command '+acc.id,fs.readFileSync(path.join(home(acc),'status-output.txt'),'utf8').trim()==='USER-'+acc.id)
    await until(()=>deck.notify.metaOf(tab)?.contextPct===42&&deck.notify.metaOf(tab)?.account===a.id&&deck.notify.accountSwitchState(tab)?.state==='confirmed')
    ad.render()
    check('sidebar context from actual relay',deck.notify.metaOf(tab).contextPct===42&&deck.notify.metaOf(tab).limits.sevenDayPct===17,document.querySelector('.ad-now')?.textContent)
    const pane=tab.getAllTabs?.()[0]||tab, sameSession=pane.session
    fs.writeFileSync(transcript(b),'{"conflict":true}\n')
    let blocked=false;try{await deck.switchAccountInTab(tab,b,command,base,{sessionId:sid,configDir:home(a)})}catch(e){blocked=/다르게/.test(e.message)}
    check('conflict leaves current terminal running',blocked&&pane.session===sameSession&&pane.session.open)
    await pane.session.destroy()
    return results
})()
