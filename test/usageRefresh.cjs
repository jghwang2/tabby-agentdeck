const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), ts = require('typescript')
const https = require('https'), { EventEmitter } = require('events')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-usage-refresh-'))
process.env.AGENTDECK_ACCOUNTS_FILE = path.join(root, 'accounts.json')
fs.writeFileSync(process.env.AGENTDECK_ACCOUNTS_FILE, '{}')
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, file)
const { UsageRefresh } = require('../src/usageRefresh.ts')
const accounts = require('../src/accounts.ts'), session = require('../src/accountSession.ts')
const write = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(data)) }
const meta = agent => ({ agent, account: agent+'@example.test', configDir: path.join(root, agent), ts: 1, model: 'fixture', contextPct: 42, limits: {fiveHourPct: 1} })
const claude = meta('claude'), codex = meta('codex')
write(path.join(claude.configDir,'.claude.json'),{oauthAccount:{emailAddress:claude.account}})
write(path.join(claude.configDir,'.credentials.json'),{claudeAiOauth:{accessToken:'fixture'}})
write(path.join(codex.configDir,'auth.json'),{tokens:{id_token:'fixture.'+Buffer.from(JSON.stringify({email:codex.account})).toString('base64url')+'.fixture',access_token:'fixture',account_id:'fixture'}})
let count=0, status=200
const original=https.get
https.get=(url,options,callback)=>{
    count++; const req=new EventEmitter(); req.destroy=()=>req.emit('error',new Error('fixture'))
    process.nextTick(()=>{
        const res=new EventEmitter();res.statusCode=status;res.headers={'retry-after':'120'};callback(res)
        const body=String(url).includes('anthropic')?{five_hour:{utilization:28},seven_day:{utilization:68},limits:[{kind:'weekly_scoped',percent:100,scope:{model:{display_name:'Fable'}}}]}:
            {account_id:'fixture',rate_limit:{primary_window:{used_percent:32,limit_window_seconds:18000},secondary_window:{used_percent:48,limit_window_seconds:604800}}}
        res.emit('data',JSON.stringify(body));res.emit('end');req.emit('close')
    });return req
}
;(async()=>{
    const refresh=new UsageRefresh()
    const first=refresh.refresh(claude)
    assert.equal(refresh.refresh(claude),first,'concurrent clicks join one request')
    assert.equal(refresh.state(claude).busy,true)
    await first
    assert.equal(count,1);assert.equal(refresh.merge(claude).limits.scopedPct,100)
    assert.equal(refresh.merge(claude).contextPct,42)
    await refresh.refresh(codex)
    assert.equal(refresh.merge(codex).limits.fiveHourPct,32)
    assert.equal(refresh.merge(claude).limits.fiveHourPct,28)
    assert.equal(refresh.merge({...claude,account:'other@example.test'}).limits.fiveHourPct,1,'account identity isolation')
    const later=refresh.merge({...claude,ts:Date.now()+100,limits:{fiveHourPct:40,scopedName:'',scopedPct:null}})
    assert.equal(later.limits.fiveHourPct,40);assert.equal(later.limits.scopedPct,100,'passive metadata keeps scoped API values')
    const saved={provider:'claude',id:claude.account,key:'saved-fixture',name:'fixture'}
    session.cacheQuotas(saved,[{label:'5시간',remaining:72},{label:'Fable',remaining:0}],Date.now()-1000)
    session.recordAccountUsage(saved,{...claude,ts:Date.now(),limits:{fiveHourPct:40}})
    assert.equal(session.cachedAccountQuotas(saved).values.find(x=>x.label==='Fable').remaining,0,'picker retains API-only limits after passive updates')
    refresh.state(codex).retryAt=0;status=429
    await refresh.refresh(codex)
    const before=count;await refresh.refresh(codex)
    assert.equal(count,before,'Retry-After blocks manual retry');assert.equal(refresh.merge(codex).limits.fiveHourPct,32)
    refresh.state(claude).retryAt=0;status=401
    await refresh.refresh(claude)
    assert.match(refresh.state(claude).message,/로그인/)
    await assert.rejects(accounts.fetchAccountQuotas({provider:'claude',id:'wrong@example.test',key:'x',name:'x'},claude.configDir),e=>e.kind==='auth')
    // Parsing a status line must not read OAuth credentials or issue a usage request.
    const {createMetaProcessor}=require('../receiver/meta.cjs')
    const request=https.request;https.request=()=>{throw Error('network request from hook')}
    createMetaProcessor(path.join(root,'runtime'),{CLAUDE_CONFIG_DIR:claude.configDir}).writeSnapshot(Buffer.from(JSON.stringify({session_id:'fixture',context_window:{used_percentage:42}})),Date.now())
    https.request=request
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'runtime/meta/fixture.json'))).contextPct,42)
    console.log('usageRefresh: native Claude/Codex, identity, concurrent clicks, passive metadata, 401/429, and network-free hook PASS')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{https.get=original;fs.rmSync(root,{recursive:true,force:true})})
