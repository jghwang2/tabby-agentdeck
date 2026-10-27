const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),ts=require('typescript'),Module=require('module'),cp=require('child_process')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdeck-switch-transfer-'))
process.env.AGENTDECK_ACCOUNTS_FILE=path.join(root,'accounts.json')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true}}).outputText,file)
const load=Module._load
Module._load=function(id,...args){if(id.startsWith('@angular/')||id.startsWith('tabby-'))return new Proxy({},{get:(_,key)=>key==='__esModule'?false:['Injectable','Component','NgModule','Inject','Optional'].includes(key)?()=>target=>target:class{}});return load.call(this,id,...args)}
const {AgentDeckService}=require('../src/deck.service.ts'),{accountHome}=require('../src/accounts.ts')
const sid='11111111-1111-4111-8111-111111111111',account={provider:'claude',key:'fixture',id:'fixture@example.test'}
const source=path.join(root,'source'),dest=accountHome(account)
const file=home=>path.join(home,'projects','D--fixture',sid+'.jsonl')
fs.mkdirSync(path.dirname(file(source)),{recursive:true});fs.writeFileSync(file(source),'1\n')
const tab={},events=[],base={id:'shell',type:'local',options:{env:{}}}
let previous={destroy:async()=>{events.push('destroy');fs.appendFileSync(file(source),'2\n')}}
const replacement={releaseInitialDataBuffer:()=>events.push('release')}
const pane={profile:base,session:previous,size:{columns:120,rows:40},setSession:s=>pane.session=s,
  initializeSession:()=>{pane.session=replacement;events.push('start')},frontend:{xterm:{reset:()=>{}}}}
const context={firstPane:()=>pane,app:{tabs:[tab]},profiles:{getProfiles:async()=>[base]},config:{store:{terminal:{profile:'shell'}}},
  notify:{setAccountHome:()=>events.push('selected')},sendResumeCommand:()=>events.push('resume'),diag:()=>{},ui:s=>s}
const run=()=>AgentDeckService.prototype.switchAccountInTab.call(context,tab,account,'claude --resume '+sid,root,{sessionId:sid,configDir:source})
;(async()=>{
  await run();assert.equal(fs.readFileSync(file(dest),'utf8'),'1\n2\n')
  assert.deepEqual(events,['destroy','start','selected','resume','release'])
  events.length=0;pane.session=previous
  fs.writeFileSync(file(dest),'diverged\n')
  await assert.rejects(run(),/다르게/);assert.equal(pane.session,previous);assert.equal(events.length,0)
  fs.writeFileSync(file(dest),'1\n2\n')
  previous={destroy:async()=>{events.push('destroy');fs.writeFileSync(file(dest),'changed-during-stop\n')}}
  pane.session=previous
  await assert.rejects(run(),/다르게/)
  assert.deepEqual(events,['destroy','start','resume','release'],'failure restores original terminal without selecting target')
  assert.equal(pane.profile.options.env.CLAUDE_CONFIG_DIR,source)
  assert.equal(fs.readFileSync(file(source),'utf8'),'1\n2\n')
  fs.writeFileSync(file(dest),'1\n2\n');events.length=0
  const child=cp.spawn(process.execPath,['-e',`const fs=require('fs');process.stdin.once('data',()=>setTimeout(()=>{fs.appendFileSync(${JSON.stringify(file(source))},'3\\n');process.exit(0)},200));console.log('ready')`],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject)})
  previous={pty:{getPID:async()=>child.pid},getChildProcesses:async()=>[],destroy:async()=>{events.push('destroy');child.stdin.write('stop')}}
  pane.session=previous
  await run()
  assert.equal(fs.readFileSync(file(dest),'utf8'),'1\n2\n3\n','wait for actual process exit after destroy returned')
  console.log('PASS: final write, preflight preserves session, post-stop failure restores source, actual asynchronous writer exit')
})().catch(e=>{console.error(e);process.exitCode=1})
