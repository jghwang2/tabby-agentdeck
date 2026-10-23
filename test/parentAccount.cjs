const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript'), Module = require('module')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-parent-account-'))
process.env.AGENTDECK_ACCOUNTS_FILE = path.join(root, 'accounts.json')
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true,esModuleInterop:true}}).outputText,f)
const load = Module._load
Module._load = function(id,...args) {
    if (id.startsWith('@angular/') || id.startsWith('tabby-')) return new Proxy({}, {get:(_,k)=>k==='__esModule'?false:['Injectable','Component','NgModule','Inject','Optional'].includes(k)?()=>t=>t:class{}})
    return load.call(this,id,...args)
}
const {WorkNotifyService} = require('../src/notify.service.ts')
const {AgentDeckService} = require('../src/deck.service.ts')
const {recordAccountUsage,cachedAccountQuotas} = require('../src/accountSession.ts')
const {accountHome} = require('../src/accounts.ts')
try {
    const tab={}, actual={sessionId:'parent',agent:'claude',account:'ai2@example.test',configDir:path.join(root,'ai2'),ts:Date.now(),limits:{sevenDayPct:82}}
    const selected={provider:'claude',key:'yunsu',id:'yunsu@example.test',name:'yunsu'}
    const service=Object.assign(Object.create(WorkNotifyService.prototype),{tabSession:new Map([[tab,'parent']]),metaBySession:new Map([['parent',actual]]),accountHomes:new WeakMap([[tab,{provider:'claude',home:accountHome(selected),email:selected.id,since:actual.ts-1}]])})
    assert.equal(service.metaOf(tab),actual,'reported identity and limits remain one unmodified snapshot')
    assert.equal(service.accountSwitchState(tab).state,'mismatch')
    recordAccountUsage(selected,service.metaOf(tab))
    assert.equal(cachedAccountQuotas(selected),null,'wrong-account usage is never cached')
    fs.mkdirSync(accountHome(selected),{recursive:true})
    fs.writeFileSync(path.join(accountHome(selected),'usage.json'),JSON.stringify({provider:'claude',id:selected.id,ts:Date.now(),values:[{label:'weekly',remaining:18}]}))
    assert.equal(cachedAccountQuotas(selected),null,'old potentially contaminated caches are ignored')
    actual.account=selected.id;actual.configDir=accountHome(selected);actual.limits.sevenDayPct=78
    assert.equal(service.accountSwitchState(tab).state,'confirmed')
    recordAccountUsage(selected,actual)
    assert.equal(cachedAccountQuotas(selected).values[0].remaining,22)
    const pane={session:{}}, tracker={id:'codex'}
    const host={firstPane:()=>pane,paneAgents:new WeakMap([[pane,{session:pane.session,tracker}]]),notify:{parentAgentOf:()=> 'claude'}}
    assert.equal(AgentDeckService.prototype.profileForTab.call(host,tab).id,'claude','parent wins over child banner')
    console.log('PASS parent account: actual identity, mismatch/confirmation, wrong-account cache isolation and old-cache rejection')
} finally { fs.rmSync(root,{recursive:true,force:true}) }
