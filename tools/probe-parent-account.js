(async () => {
    const fs=require('fs'),path=require('path'),cp=require('child_process')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('parent-account-ui')) throw Error('Isolated instance required')
    const ad=window.__agentdeck,base=path.dirname(process.env.TABBY_CONFIG_DIRECTORY),bin=path.join(base,'fixture-bin')
    const params=Reflect.getMetadata('design:paramtypes',require('tabby-agentdeck').default)
    const deck=ad.app.tabsService.injector.get(params[6]).deck, notify=deck.notify
    const wait=ms=>new Promise(r=>setTimeout(r,ms)), results=[]
    const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await wait(100)}throw Error('Timed out')}
    const check=(name,pass,evidence)=>{results.push({name,pass:!!pass,evidence});if(!pass)throw Error(name)}
    fs.mkdirSync(bin,{recursive:true})
    for (const agent of ['claude','codex']) for (const suffix of ['-parent.json','-child.json','-child-done']) {
        const receipt=path.join(base,agent+suffix)
        if(fs.existsSync(receipt))fs.unlinkSync(receipt)
    }
    const driver=path.join(bin,'driver.cjs')
    const relay=fs.realpathSync(path.join(base,'ud/plugins/node_modules/tabby-agentdeck/hooks/agentdeck-relay.mjs'))
    fs.writeFileSync(driver,`
const fs=require('fs'),path=require('path'),cp=require('child_process');
const agent=process.argv[2],nested=process.argv.includes('--nested');
const sid=(nested?'bbbbbbbb':'aaaaaaaa')+'-1111-1111-1111-'+(agent==='claude'?'111111111111':'222222222222');
delete process.env.AGENTDECK_ORIGIN_PID;
(async()=>{const {relay}=await import(require('url').pathToFileURL(${JSON.stringify(relay)}));
fs.writeFileSync(path.join(${JSON.stringify(base)},agent+(nested?'-child':'-parent')+'.json'),JSON.stringify({pid:process.ppid,sid,home:process.env[agent==='claude'?'CLAUDE_CONFIG_DIR':'CODEX_HOME']||'',tab:process.env.AGENTDECK_TAB}));
process.stdout.write('\\x1b]0;cmd.exe - '+agent+'\\x07');
await relay('notify',JSON.stringify({session_id:sid,hook_event_name:'UserPromptSubmit',cwd:${JSON.stringify(base)}}),{Agent:agent,Status:'running'});
if(agent==='claude')await relay('statusline',JSON.stringify({session_id:sid,model:{display_name:'Claude fixture'},rate_limits:{seven_day:{used_percentage:78}},cwd:${JSON.stringify(base)}}));
if(!nested){const other=agent==='claude'?'codex':'claude';const child=cp.spawn(path.join(${JSON.stringify(bin)},other+'.exe'),['--nested'],{stdio:'inherit'});await new Promise(r=>child.on('exit',r));fs.writeFileSync(path.join(${JSON.stringify(base)},agent+'-child-done'),'done');await new Promise(r=>setTimeout(r,120000));}
})().catch(e=>{console.error(e);process.exitCode=1});
`)
    const source=`using System; using System.Diagnostics; using System.IO;
class Entry { static void Main(string[] args) { var agent=Path.GetFileNameWithoutExtension(Process.GetCurrentProcess().MainModule.FileName); var p=new ProcessStartInfo("node", "\\\"${driver.replace(/\\/g,'\\\\')}\\\" "+agent+" "+String.Join(" ",args)); p.UseShellExecute=false; var c=Process.Start(p); c.WaitForExit(); } }`
    const compile=path.join(bin,'compile.ps1')
    fs.writeFileSync(compile,"Add-Type -TypeDefinition @'\n"+source+"\n'@ -OutputAssembly '"+path.join(bin,'claude.exe').replace(/'/g,"''")+"' -OutputType ConsoleApplication\n")
    if(!fs.existsSync(path.join(bin,'claude.exe')))cp.execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',compile],{windowsHide:true})
    fs.copyFileSync(path.join(bin,'claude.exe'),path.join(bin,'codex.exe'))
    const profile=ad.config.store.profiles.find(p=>p.id==='local:test-ps')
    profile.options.env={...profile.options.env,PATH:bin+';'+process.env.PATH}
    ad.config.store.terminal.environment={CLAUDE_CONFIG_DIR:'',CODEX_HOME:''}
    await ad.config.save()
    for(const agent of ['claude','codex']) {
        const account={provider:agent,key:'fixture-'+agent,id:'yunsu@example.test',name:'fixture'}
        const home=path.join(base,'accounts','accounts',account.key)
        fs.mkdirSync(home,{recursive:true})
        if(agent==='claude')fs.writeFileSync(path.join(home,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:account.id}}))
        else fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({tokens:{id_token:'x.'+Buffer.from(JSON.stringify({email:account.id})).toString('base64')+'.y'}}))
        const previous=new Set(ad.app.tabs);document.querySelector('.ad-new').click()
        await until(()=>ad.app.tabs.some(t=>!previous.has(t)&&(t.getAllTabs?.()[0]||t).session?.open))
        const tab=ad.app.tabs.find(t=>!previous.has(t));ad.app.selectTab(tab)
        await deck.switchAccountInTab(tab,account,agent+' --resume fixture',base)
        await until(()=>fs.existsSync(path.join(base,agent+'-child-done')))
        const receipt=JSON.parse(fs.readFileSync(path.join(base,agent+'-parent.json'),'utf8'))
        check(agent+' selected home reaches actual child process despite empty global override',receipt.home===home,receipt.home)
        check(agent+' child inherited same tab ID',JSON.parse(fs.readFileSync(path.join(base,(agent==='claude'?'codex':'claude')+'-child.json'),'utf8')).tab===receipt.tab)
        await until(()=>notify.tabSession.get(tab)===receipt.sid)
        check(agent+' parent retains session after nested CLI hooks',notify.tabSession.get(tab)===receipt.sid)
        await ad.probeAgent(tab);await wait(1300);ad.render()
        const icon=()=>document.querySelector('.ad-tab[data-ad-index="'+ad.app.tabs.indexOf(tab)+'"] .ad-agent')?.title
        check(agent+' icon follows parent after child banner and hooks',icon()?.toLowerCase().includes(agent),icon())
        if(agent==='claude'){
            await until(()=>notify.metaOf(tab)?.account===account.id)
            check('actual account confirms switch',notify.accountSwitchState(tab).state==='confirmed')
            const actual=notify.metaOf(tab)
            notify.metaBySession.set(receipt.sid,{...actual,ts:Date.now()+1,account:'ai2@example.test',configDir:path.join(base,'wrong'),limits:{sevenDayPct:82}})
            ad.render()
            check('mismatch displays actual account and warning',document.querySelector('.ad-now-account')?.textContent.includes('ai2@example.test')&&document.querySelector('.ad-now-account')?.textContent.includes('확인 실패'))
            check('mismatch keeps actual usage',notify.metaOf(tab).limits.sevenDayPct===82)
            notify.metaBySession.set(receipt.sid,actual)
        } else {
            const sessions=path.join(home,'sessions')
            fs.mkdirSync(sessions,{recursive:true})
            fs.writeFileSync(path.join(sessions,'rollout-2026-10-23-'+receipt.sid+'.jsonl'),[
                {type:'session_meta',payload:{session_id:receipt.sid,cwd:base,cli_version:'fixture'}},
                {type:'turn_context',payload:{model:'gpt-6-astra',cwd:base}},
                {type:'event_msg',payload:{type:'token_count',rate_limits:{limit_id:'codex',secondary:{used_percent:78,window_minutes:10080,resets_at:Math.floor(Date.now()/1000)+3600}}}},
            ].map(v=>JSON.stringify(v)).join('\n')+'\n')
            await until(()=>notify.metaOf(tab)?.account===account.id)
            check('codex actual reported home confirms account switch',notify.accountSwitchState(tab).state==='confirmed',notify.metaOf(tab).configDir)
            check('codex usage comes from reported home after child CLI',notify.metaOf(tab).limits.sevenDayPct===78)
        }
    }
    fs.writeFileSync(path.join(base,'results.json'),JSON.stringify(results,null,2))
    return results
})()
