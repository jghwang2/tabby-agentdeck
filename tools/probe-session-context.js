// Run with tools/cdp.js against the isolated Tabby instance only.
(async () => {
    const ad = window.__agentdeck
    const fs = require('fs'), path = require('path'), cp = require('child_process'), net = require('net'), os = require('os')
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) throw new Error('Isolated Tabby required')
    const root = path.join(process.env.TABBY_CONFIG_DIRECTORY, 'agentdeck-mailbox')
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-context-'))
    const plugin = fs.realpathSync(path.join(path.dirname(process.env.TABBY_CONFIG_DIRECTORY), 'ud/plugins/node_modules/tabby-agentdeck'))
    const created = []
    const checks = []
    const check = (name, value) => { if (!value) throw new Error(name); checks.push(name) }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const paneOf = tab => typeof tab.getAllTabs === 'function' ? tab.getAllTabs()[0] : tab
    const exec = (exe, args, env, stdin = '') => new Promise((resolve, reject) => {
        const child = cp.spawn(exe, args, {env, windowsHide:true})
        let out = '', err = ''
        child.stdout.on('data', b => {out += b.toString('utf8')})
        child.stderr.on('data', b => {err += b.toString('utf8')})
        child.on('error', reject)
        const timeout = setTimeout(() => {child.kill(); reject(new Error('Child timeout'))}, 15000)
        child.on('close', code => {clearTimeout(timeout); resolve({code, out, err})})
        child.stdin.end(stdin)
    })
    const snapshot = () => new Promise((resolve, reject) => {
        const socket = net.createConnection({host:'127.0.0.1',port:Number(fs.readFileSync(path.join(root,'port'),'utf8'))})
        let data = ''; socket.setEncoding('utf8'); socket.setTimeout(3000, () => socket.destroy(new Error('Snapshot timeout')))
        socket.on('error',reject)
        socket.on('connect',()=>socket.write(JSON.stringify({channel:'agentdeck-navigation'})+'\n'))
        socket.on('data', chunk=>{data+=chunk;if(data.includes('\n')){socket.end();resolve(JSON.parse(data.split('\n')[0]).result)}})
    })
    async function open (name) {
        const before = new Set(ad.app.tabs)
        document.querySelector('.ad-new').click()
        for(let i=0;i<100;i++) {
            const tab = ad.app.tabs.find(t=>!before.has(t))
            if(tab && paneOf(tab)?.profile?.options?.env?.AGENTDECK_TAB && paneOf(tab)?.session) {
                tab.customTitle=name; created.push(tab);ad.render();return tab
            }
            await sleep(100)
        }
        throw new Error('New tab did not start')
    }
    const envFor = tab => ({...process.env, LOCALAPPDATA:scratch, AGENTDECK_MAILBOX_ROOT:root,
        AGENTDECK_TAB:paneOf(tab).profile.options.env.AGENTDECK_TAB, FORCE_COLOR:'0'})
    async function hook (tab,sid,event,agent) {
        const result=await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(plugin,'hooks/agentdeck-notify.ps1'),'-Agent',agent,'-Status','running'],envFor(tab),JSON.stringify({session_id:sid,hook_event_name:event,cwd:scratch}))
        check('hook exit '+sid+' '+event,result.code===0)
        return result.out ? JSON.parse(result.out).hookSpecificOutput.additionalContext : ''
    }
    async function cli (tab,sid,method,args) {
        const file=path.join(scratch,'args.json'); if(args)fs.writeFileSync(file,JSON.stringify(args))
        const result=await exec('node',[path.join(plugin,'hooks/agentdeck-mailbox.mjs'),'--cli',sid,method,...(args?[file]:[])],envFor(tab))
        return JSON.parse(result.out)
    }
    try {
        const a=await open('Context test A'), b=await open('Context test B')
        let snap=await snapshot()
        check('unregistered open tabs visible',snap.context.includes('Context test A')&&snap.context.includes('tab open; session not registered'))
        check('snapshot agrees with DOM row count',snap.context.split('\n').length===document.querySelectorAll('.ad-tab').length)
        const sidA='context-a-'+Date.now(),sidB='context-b-'+Date.now()
        const ca=await hook(a,sidA,'UserPromptSubmit','codex')
        check('Codex prompt gets live snapshot without MCP',ca.includes('AgentDeck live UI snapshot (')&&ca.includes(sidA)&&ca.includes('Context test B'))
        const cb=await hook(b,sidB,'UserPromptSubmit','claude')
        check('Claude prompt gets live snapshot without MCP',cb.includes('AgentDeck live UI snapshot (')&&cb.includes(sidB))
        check('MCP absence distinguished from registration',cb.includes('MCP=not connected')&&cb.includes('Mailbox registered'))
        const sent=await cli(a,sidA,'send',{toSessionId:sidB,body:'context transport test',requestKey:sidA})
        check('send succeeds',!!sent.result?.id)
        const pending=await hook(b,sidB,'PostToolUse','claude')
        check('pending notification without MCP',pending.includes('1 pending messages'))
        const received=await cli(b,sidB,'receive')
        check('recipient receives exact sender and message',received.result.some(m=>m.id===sent.result.id&&m.fromSessionId===sidA))
        await cli(b,sidB,'acknowledge',{messageId:sent.result.id,completed:true})
        const reply=await cli(b,sidB,'send',{toSessionId:sidA,body:'received',requestKey:sidB,replyTo:sent.result.id})
        check('reply reaches original sender',(await cli(a,sidA,'receive')).result.some(m=>m.id===reply.result.id&&m.replyTo===sent.result.id))
        check('cannot impersonate other session',!!(await cli(a,sidB,'receive')).error)
        const oldSlot=document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(b)}"]`).dataset.adSlot
        await ad.app.closeTab(b,false);await sleep(500)
        check('closed recipient rejected',!!(await cli(a,sidA,'send',{toSessionId:sidB,body:'closed',requestKey:sidA+'-closed'})).error)
        snap=await snapshot()
        check('closed tab gone from current snapshot',!snap.context.includes(sidB))
        const c=await open('Context test C'),sidC='context-c-'+Date.now()
        await hook(c,sidC,'UserPromptSubmit','claude')
        check('replacement reuses free human slot',document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(c)}"]`).dataset.adSlot===oldSlot)
        check('old recipient not redirected to reused slot',!!(await cli(a,sidA,'send',{toSessionId:sidB,body:'old target',requestKey:sidA+'-reused'})).error)
        check('replacement mailbox remains empty',(await cli(c,sidC,'receive')).result.length===0)
        return {pass:true,checks}
    } finally {
        for(const tab of created.reverse())if(ad.app.tabs.includes(tab))await ad.app.closeTab(tab,false)
        fs.rmSync(scratch,{recursive:true,force:true})
    }
})()
