const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdeck-python-upgrade-')),bin=path.join(root,'tabby-agentdeck','hooks')
fs.mkdirSync(bin,{recursive:true})
try {
    // Registration, history cleanup and source-only updates use the same offline package.
    const ts = require('typescript')
    require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f)
    for (const name of fs.readdirSync(path.resolve(__dirname, '../hooks')).filter(n => /\.(mjs|cjs|json|py)$/.test(n)))
        fs.copyFileSync(path.resolve(__dirname, '../hooks', name), path.join(bin, name))
    const {findHookUpgrades,applyHookUpgrades} = require('../src/hookUpgrade.ts')
    const {planHookManagement} = require('../src/hookManagement.ts')
    const homes = ['claude','codex'].map(p => path.join(root, p))
    const files = homes.map((home,i) => { fs.mkdirSync(home); return path.join(home,i ? 'hooks.json' : 'settings.json') })
    for (let i=0;i<files.length;i++) fs.writeFileSync(files[i], JSON.stringify({hooks:{PostToolUse:[{matcher:'*',hooks:[
        {type:'command',command:'echo keep-user-hook',timeout:17},
        {type:'command',command:`node "${bin.replace(/\\/g,'/')}/agentdeck-${i?'codex-':''}notify.mjs"${i?'':' -Status running'}`,timeout:i?3:5},
        {type:'command',command:`powershell -File "C:/old/tabby-agentdeck/hooks/agentdeck-${i?'codex-':''}notify.ps1"${i?'':' -Status running'}`,timeout:i?3:5},
    ]}]}}))
    // Include the previously released executable registration without building it.
    for (let i=0;i<files.length;i++) {
        const state=JSON.parse(fs.readFileSync(files[i]));
        state.hooks.PostToolUse[0].hooks.push({type:'command',command:`"C:/old/tabby-agentdeck/hooks/agentdeck-${i?'codex-':''}notify.exe"${i?'':' -Status running'}`,timeout:i?3:5});
        fs.writeFileSync(files[i],JSON.stringify(state));
    }
    const plans = findHookUpgrades(bin, files); assert.equal(plans.length,2)
    assert.ok(plans.every(p => p.management.changes.filter(c=>c.decision==='제거').length===3))
    const cp = require('node:child_process'), originalExec = cp.execFileSync
    const originalFiles = files.map(f => fs.readFileSync(f,'utf8'))
    for (const unavailable of [() => {throw Error('missing')}, () => '']) {
        cp.execFileSync = unavailable
        try { assert.throws(() => applyHookUpgrades(plans,bin), /Python 3.8/) }
        finally { cp.execFileSync = originalExec }
        assert.deepEqual(files.map(f => fs.readFileSync(f,'utf8')), originalFiles)
        assert.ok(homes.every(h => !fs.existsSync(path.join(h,'.agentdeck-hook-registry.json'))))
    }
    applyHookUpgrades(plans,bin)
    for (let i=0;i<files.length;i++) {
        const s = JSON.parse(fs.readFileSync(files[i])), handlers = s.hooks.PostToolUse.flatMap(g=>g.hooks)
        assert.equal(handlers.length,2); assert.equal(handlers[0].command,'echo keep-user-hook')
        assert.match(handlers[1].command,/^python3? ".*\.py"/)
        const view = planHookManagement(i?'codex':'claude','view',[homes[i]],bin)
        assert.ok(view.sources.some(s=>s.file.endsWith('agentdeck_relay.py') && s.text.includes('def main(')))
        assert.ok(!view.preview.includes('keep-user-hook'))
    }
    assert.equal(findHookUpgrades(bin,files).length,0,'accepted revision never prompts again')
    fs.appendFileSync(path.join(bin,'agentdeck_relay.py'),'\n# new source revision\n')
    assert.equal(findHookUpgrades(bin,files).length,2,'source update detected without command path/version change')
    applyHookUpgrades(findHookUpgrades(bin,files),bin)
    assert.equal(findHookUpgrades(bin,files).length,0)
    fs.appendFileSync(path.join(bin,'agentdeck_relay.py'),'# next revision\n')
    const ledgers=homes.map(h=>path.join(h,'.agentdeck-hook-registry.json')),saved=ledgers.map(f=>fs.readFileSync(f,'utf8'))
    const failedPlans=findHookUpgrades(bin,files),rename=fs.renameSync
    let failed=false
    fs.renameSync=function(from,to){
        if(!failed&&to===ledgers[1]){failed=true;throw Error('injected write failure')}
        return rename.call(fs,from,to)
    }
    try{assert.throws(()=>applyHookUpgrades(failedPlans,bin),/기존 설정을 유지/)}finally{fs.renameSync=rename}
    assert.ok(failed)
    assert.deepEqual(ledgers.map(f=>fs.readFileSync(f,'utf8')),saved,'later-home failure rolls back earlier home')
    applyHookUpgrades(findHookUpgrades(bin,files),bin)
    assert.equal(findHookUpgrades(bin,files).length,0,'retry succeeds after rollback')
    console.log('PASS Python installation: executable/Node/PowerShell migration, source view, revisions, idempotence and transaction rollback')
} finally {
    fs.rmSync(root,{recursive:true,force:true})
}
