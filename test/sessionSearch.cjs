const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SessionSearch } = require('../.tmp/sessionSearch')
const ts = require('typescript')
const Module = require('module')
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true},
}).outputText,file)
const originalLoad = Module._load
Module._load = function(id,...args) {
    if(id==='@angular/core')return {Injectable:()=>target=>target}
    if(id==='tabby-core')return {}
    return originalLoad.call(this,id,...args)
}
const { SessionLedgerService } = require('../src/sessionLedger.service.ts')
Module._load = originalLoad

async function main () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-history-'))
    const engine = new SessionSearch(path.join(root, 'cache'))
    const claude = { file: path.join(root,'claude.jsonl'), sessionId:'11111111-1111-4111-8111-111111111111', agent:'claude' }
    const codex = { file: path.join(root,'codex.jsonl'), sessionId:'22222222-2222-4222-8222-222222222222', agent:'codex' }
    const c = (role,text,extra={}) => ({type:role,message:{role,content:[{type:'text',text}]},...extra})
    const x = (role,text) => ({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}})
    const write = (source,rows) => fs.writeFileSync(source.file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n')
    try {
        write(claude,[c('user','Find the bug',{cwd:'D:/Project/Alpha'}),
            ...Array.from({length:500},(_,i)=>c('assistant','context '+i)),
            c('assistant','CheckDetectAbusing rCode=-10001 a.b[0] 한국식별자 <img src=x onerror=alert(1)>',{uuid:'unique'}),
            c('assistant','CheckDetectAbusing duplicate',{uuid:'unique'}),
            c('user','<system-reminder>excluded_system</system-reminder>'),
            c('user','excluded_meta',{isMeta:true}),
            {type:'user',message:{role:'user',content:[{type:'tool_result',content:'excluded_tool'}]}},
            c('assistant','after match')])
        write(codex,[{type:'session_meta',payload:{cwd:'D:/Project/Beta'}},x('user','Investigate parser'),
            {type:'event_msg',payload:{type:'user_message',message:'event_duplicate'}},
            x('assistant','CheckDetectAbusing fixed'), x('developer','excluded_developer')])
        const sources=[claude,codex]
        let result=await engine.search(sources,'checkdetectabusing')
        assert.equal(result.hits.length,2); assert.equal(result.hits.find(h=>h.source.agent==='claude').count,1)
        assert.equal(result.checked,2); assert.equal(result.unreadable,0)
        const hit=result.hits.find(h=>h.source.agent==='claude')
        assert.ok(hit.line>500); assert.ok(hit.snippet.includes('CheckDetectAbusing'))
        for(const q of ['rCode=-10001','a.b[0]','한국식별자']) assert.equal((await engine.search(sources,q)).hits.length,1,q)
        for(const q of ['aXb0','excluded_tool','excluded_system','excluded_meta','excluded_developer','event_duplicate']) assert.equal((await engine.search(sources,q)).hits.length,0,q)
        assert.equal((await engine.search(sources,claude.sessionId)).hits.length,1)
        assert.equal((await engine.search(sources,'D:/Project/Beta')).hits.length,1)
        const preview=await engine.preview(claude,hit.line)
        assert.ok(preview.messages.some(m=>m.text.includes('rCode=-10001')))
        assert.ok(preview.previous!==null); assert.ok(preview.messages.length<=6)
        assert.ok(fs.readdirSync(path.join(root,'cache')).some(n=>n.endsWith('.json.gz')))
        fs.appendFileSync(claude.file,JSON.stringify(c('assistant','APPENDED_IDENTIFIER'))+'\n{partial')
        result=await engine.search(sources,'APPENDED_IDENTIFIER')
        assert.equal(result.hits.length,1);assert.equal(result.malformed,1)
        write(codex,[x('user','Replacement_identifier')])
        assert.equal((await engine.search([codex],'Replacement_identifier')).hits.length,1)
        assert.equal((await engine.search([codex],'CheckDetectAbusing')).hits.length,0)
        result=await engine.search([{...codex,file:path.join(root,'missing')}],'anything')
        assert.equal(result.unreadable,1)
        const pending=engine.search(sources,'context').then(()=>false,e=>e.message==='Search cancelled')
        engine.cancel();assert.equal(await pending,true)
        assert.equal((await engine.search(sources,'   ')).checked,0)
        const subprocess = new SessionSearch(path.join(root,'cache'),true)
        try { assert.equal((await subprocess.search([claude],'a.b[0]')).hits.length,1) }
        finally {subprocess.cancel()}
        const oldHome=process.env.CODEX_HOME
        const oldClaudeHome=process.env.CLAUDE_CONFIG_DIR
        const projects=path.join(root,'projects'), project=path.join(projects,'example')
        fs.mkdirSync(project,{recursive:true})
        for(let i=0;i<205;i++){
            const file=path.join(project,`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111.jsonl`)
            fs.writeFileSync(file,JSON.stringify(c('user',i===0?'VERY_OLD_IDENTIFIER':'recent question'))+'\n')
            if(i===0){const old=new Date(Date.now()-90*86400000);fs.utimesSync(file,old,old)}
        }
        process.env.CODEX_HOME=path.join(root,'empty-codex')
        process.env.CLAUDE_CONFIG_DIR=root
        try {
            const ledger=new SessionLedgerService({store:{agentDeck:{resumeListDays:7}}})
            ledger.root=root;ledger.file=path.join(root,'ledger.json')
            await ledger.refresh(true)
            assert.equal(ledger.records().length,200)
            const all=await ledger.historySources()
            assert.equal(all.length,205)
            assert.equal((await engine.search(all,'VERY_OLD_IDENTIFIER')).hits.length,1)
        } finally {
            if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome
            if(oldClaudeHome===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=oldClaudeHome
        }
        console.log('PASS history: full transcript, both providers, literal identifiers, excluded noise, preview, cache refresh, partial records, missing files, cancellation')
    } finally {engine.cancel();fs.rmSync(root,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1})
