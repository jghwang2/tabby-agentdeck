// Isolated app: verify persisted failure cutoff in the real account picker.
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('no-codex-poll-ui')) throw new Error('Isolated instance required')
    const fs=require('fs'),path=require('path'),ad=window.__agentdeck
    const id='background-probe@example.test',key=require('crypto').createHash('sha256').update('codex:'+id).digest('hex').slice(0,24)
    const home=path.join(path.dirname(process.env.AGENTDECK_ACCOUNTS_FILE),'accounts',key)
    fs.writeFileSync(path.join(home,'agentdeck-refresh-state.json'),JSON.stringify({generation:'isolated-probe',firstFailureAt:Date.now()-300001}))
    const sid='adprobe-account-blocked',dirs=ad.runtimePaths(),tabId=ad.tabIds()[0].ids[0]
    const status=path.join(dirs.status,sid+'.json'),meta=path.join(dirs.meta,sid+'.json')
    fs.mkdirSync(dirs.status,{recursive:true});fs.mkdirSync(dirs.meta,{recursive:true})
    fs.writeFileSync(status,JSON.stringify({sessionId:sid,status:'running',ts:Date.now(),tabId,agent:'codex'}))
    fs.writeFileSync(meta,JSON.stringify({sessionId:sid,ts:Date.now(),agent:'codex',model:'Codex',account:id,configDir:home}))
    await new Promise(r=>setTimeout(r,1800))
    document.querySelector('.ad-now-account').click()
    await new Promise(r=>setTimeout(r,500))
    const text=document.querySelector('.ad-account-option .ad-now-gauges')?.textContent
    const blocked=JSON.parse(fs.readFileSync(path.join(home,'agentdeck-refresh-state.json'),'utf8')).blocked
    const pass=blocked===true && /자동 점검 중단|automatic checks stopped/.test(text||'')
    document.querySelector('.ad-account-close')?.click()
    fs.unlinkSync(status);fs.unlinkSync(meta)
    return JSON.stringify({pass,blocked,text})
})()
