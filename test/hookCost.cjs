const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('module'),cp=require('node:child_process')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true,esModuleInterop:true}}).outputText,f)
const load=Module._load
Module._load=function(id,...args){if(id.startsWith('@angular/')||id.startsWith('tabby-'))return new Proxy({},{get:(_,k)=>k==='__esModule'?false:['Injectable','Component','NgModule','Inject','Optional'].includes(k)?()=>t=>t:class{}});return load.call(this,id,...args)}
// Fail structurally as well as by time: a fast development PC must not conceal
// an interpreter/process probe reintroduced in the hook authorization path.
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])cp[name]=()=>{throw Error('Hook authorization must not start a process: '+name)}
const {WorkNotifyService}=require('../src/notify.service.ts')
const {AgentDeckService}=require('../src/deck.service.ts')
const {mergeHooks}=require('../src/claudeHooks.ts'),{mergeCodexHooks}=require('../src/codexHooks.ts')
const lengths={}
for(const [agent,merge,count] of [['claude',mergeHooks,9],['codex',mergeCodexHooks,7]]){
 const settings=merge({},'C:/fixture/hooks/agentdeck-notify.mjs'),commands=Object.values(settings.hooks).flatMap(g=>g.flatMap(x=>x.hooks.map(h=>h.command)))
 assert.equal(commands.length,count,agent+' hook count budget')
 lengths[agent]=commands.map(c=>Buffer.byteLength(c))
 assert.ok(lengths[agent].every(n=>n<=(agent==='claude'?60:44)),agent+' normalized hook command grew beyond baseline')
}
;(async()=>{
 const times=[]
 for(const agent of ['claude','codex']){
  const tab={},service=Object.assign(Object.create(WorkNotifyService.prototype),{parentOwners:new WeakMap(),tabIds:new Map([[tab,['fixture']]]),tabSession:new Map(),hookAgent:new WeakMap(),rejectedMetaSession:new WeakMap(),metaBySession:new Map()})
  const event=(sid,a=agent,child)=>({env:{AGENTDECK_TAB:'fixture'},options:{Agent:a},hook:{session_id:sid,...(child?{agent_id:child}:{})}})
  for(let i=0;i<100;i++){
   service.setParentAgent(tab,null)
   const start=performance.now()
   assert.equal(await service.authorizeHook(event('parent')),true)
   times.push(performance.now()-start)
   assert.equal(await service.authorizeHook(event('parent',agent,'native-child')),true)
   assert.equal(await service.authorizeHook(event('nested',agent)),false)
   assert.equal(await service.authorizeHook(event('nested',agent==='claude'?'codex':'claude')),false)
   assert.equal(service.parentAgentOf(tab),agent)
  }
  service.setParentAgent(tab,{agent:agent==='claude'?'codex':'claude'})
  assert.equal(await service.authorizeHook(event('old')),false)
  assert.equal(await service.authorizeHook(event('next',agent==='claude'?'codex':'claude')),true)
  const pane={session:{}},host={app:{getParentTab:()=>tab},notify:service,paneAgents:new WeakMap(),tabAgents:new WeakMap(),profileMemo:new WeakMap(),agentProbedAt:new WeakMap()}
  AgentDeckService.prototype.observePaneAgent.call(host,pane,'\x1b]0;cmd.exe - '+agent+'\x07')
  assert.equal(service.parentAgentOf(tab),agent==='claude'?'codex':'claude','child title does not replace registered owner')
  AgentDeckService.prototype.observePaneAgent.call(host,pane,'\x1b]0;Windows PowerShell\x07\r\nPS C:\\fixture>')
  // The actual title emitted by the shell is its executable name.
  AgentDeckService.prototype.observePaneAgent.call(host,pane,'\x1b]0;powershell.exe\x07\r\nPS C:\\fixture>')
  assert.equal(service.parentAgentOf(tab),null,'shell return releases old owner')
  assert.equal(await service.authorizeHook(event('after-shell')),true)
  pane.session={}
  AgentDeckService.prototype.observePaneAgent.call(host,pane,'fresh PTY')
  assert.equal(service.parentAgentOf(tab),null,'replacement PTY releases old owner')
 }
 const sorted=times.sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)]
 assert.ok(p95<10,`Uncached authorization p95 ${p95}ms exceeds 10ms`)
 assert.ok(sorted.at(-1)<100,`Authorization max ${sorted.at(-1)}ms exceeds 100ms`)
 console.log(JSON.stringify({hookCommandBytes:lengths,uncachedAuthorization:{samples:times.length,p95Ms:p95,maxMs:sorted.at(-1)},processStarts:0}))
 console.log('PASS hook cost: counts, command bytes, cold authorization latency, no process creation, parent/native child/nested CLI, restart')
})().catch(e=>{console.error(e);process.exitCode=1})
