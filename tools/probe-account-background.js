// Run with cdp.js on an isolated no-codex-poll-ui instance, then again after 65s.
(() => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('no-codex-poll-ui')) throw new Error('Isolated instance required')
    const fs = require('fs'), path = require('path'), cp = require('child_process')
    const file = process.env.AGENTDECK_ACCOUNTS_FILE
    if (!window.__accountBackgroundProbe) {
        const id = 'background-probe@example.test'
        const key = require('crypto').createHash('sha256').update('codex:' + id).digest('hex').slice(0,24)
        const home = path.join(path.dirname(file),'accounts',key)
        fs.mkdirSync(home,{recursive:true})
        fs.writeFileSync(path.join(home,'agentdeck-refresh-state.json'),JSON.stringify({generation:'isolated-probe'}))
        fs.writeFileSync(file,JSON.stringify({codex:[{id,name:'Background probe'}]}))
        const jwt = payload => 'fixture.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.fixture'
        fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({tokens:{id_token:jwt({email:id}),access_token:jwt({exp:Math.floor(Date.now()/1000)+3600}),refresh_token:'fixture'}}))
        const state = {started:Date.now(),codexStarts:0,spawn:cp.spawn}
        cp.spawn = function (command,args,...rest) {
            if ((args || []).includes('app-server')) { state.codexStarts++ }
            return state.spawn.call(this,command,args,...rest)
        }
        window.__accountBackgroundProbe=state
        return JSON.stringify({armed:true,observeAfterMs:65000})
    }
    const state=window.__accountBackgroundProbe
    const saved=Boolean(JSON.parse(fs.readFileSync(file,'utf8')).codex[0].auth?.data)
    const elapsed=Date.now()-state.started
    const result={elapsedMs:elapsed,codexStarts:state.codexStarts,credentialsSaved:saved,
        pass:elapsed>=65000 && state.codexStarts===0 && saved}
    if(elapsed>=65000) { cp.spawn=state.spawn; delete window.__accountBackgroundProbe }
    return JSON.stringify(result)
})()
