const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f)
const {planHookManagement:plan,applyHookManagement:apply}=require('../src/hookManagement.ts')
const {currentHookGroups}=require('../src/hookCatalog.ts')
const {stripHooks}=require('../src/claudeHooks.ts'),{stripCodexHooks}=require('../src/codexHooks.ts')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdeck-management-')),hooks=path.resolve(__dirname,'../hooks')
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v))}
const foreign={type:'command',command:'echo keep-user-hook',timeout:17}
const compat={type:'command',command:'powershell -File "C:/claude-compat/agentdeck-notify.ps1" -Status done',timeout:5}
const legacy={type:'command',command:'powershell -NoProfile -ExecutionPolicy Bypass -File "C:/old/tabby-agentdeck/hooks/agentdeck-notify.ps1" -Status running -PromptAsLabel',timeout:5}
try{
 const emptyForeign={hooks:{Stop:[{matcher:'custom',hooks:[]}]}}
 assert.deepEqual(stripHooks(emptyForeign),emptyForeign);assert.deepEqual(stripCodexHooks(emptyForeign),emptyForeign)
 for(const provider of ['claude','codex']){
  const home=path.join(root,provider),file=path.join(home,provider==='claude'?'settings.json':'hooks.json'),ledger=path.join(home,'.agentdeck-hook-registry.json')
  const initial={model:'keep',permissions:{allow:['user']},hooks:{Stop:[{matcher:'*',hooks:[foreign,compat]}]},statusLine:{type:'command',command:'echo USER-STATUS'}}
  write(file,initial)
  const inspect=plan(provider,'view',[home],hooks);assert.equal(inspect.writes.length,0);assert.ok(!inspect.preview.includes('echo keep-user-hook'));assert.ok(!inspect.preview.includes('claude-compat'));assert.ok(!inspect.preview.includes('USER-STATUS'));assert.ok(!fs.existsSync(ledger))
  const install=plan(provider,'apply',[home],hooks);assert.equal(install.canApply,true,install.preview)
  assert.ok(apply(install).length);assert.equal(read(file).model,'keep');assert.deepEqual(read(file).hooks.Stop[0].hooks,[foreign,compat])
  assert.equal(read(ledger).groups.length,provider==='claude'?9:7)
  const visible=plan(provider,'view',[home],hooks).preview
  assert.ok(visible.includes(provider==='claude'?'agentdeck-notify.mjs':'agentdeck-codex-notify.mjs'))
  assert.ok(!visible.includes('keep-user-hook'));assert.ok(!visible.includes('claude-compat'));assert.ok(!visible.includes('USER-STATUS'))
  assert.equal(plan(provider,'apply',[home],hooks).writes.length,0,'reapply idempotent')
  if(provider==='claude')assert.equal(read(path.join(home,'.agentdeck-statusline-inner.json')).command,'echo USER-STATUS')
  // A user changes a recorded group: managed-only removal must preserve the entire changed group.
  const edited=read(file);edited.hooks.Stop[1].hooks.push({type:'command',command:'echo added-user-hook'});write(file,edited)
  apply(plan(provider,'managed',[home],hooks))
  assert.equal(read(file).hooks.Stop.length,2);assert.equal(read(file).hooks.Stop[1].hooks[1].command,'echo added-user-hook')
  apply(plan(provider,'reset',[home],hooks))
  assert.deepEqual(read(file).hooks.Stop.flatMap(g=>g.hooks),[foreign,compat,{type:'command',command:'echo added-user-hook'}])
  if(provider==='claude')assert.equal(read(file).statusLine.command,'echo USER-STATUS')
  // Recorded retired events are removable even after their event leaves the current catalog.
  apply(plan(provider,'apply',[home],hooks));const s=read(file),r=read(ledger),group=currentHookGroups(provider,hooks).Stop[0]
  s.hooks.RetiredAgentDeckEvent=[group];r.groups.push({id:provider+':RetiredAgentDeckEvent',event:'RetiredAgentDeckEvent',group});write(file,s);write(ledger,r)
  apply(plan(provider,'managed',[home],hooks));assert.ok(!read(file).hooks.RetiredAgentDeckEvent)
  const before=fs.readFileSync(file,'utf8'),stale=plan(provider,'apply',[home],hooks);fs.appendFileSync(file,' ')
  assert.throws(()=>apply(stale),/변경/);assert.equal(fs.readFileSync(file,'utf8'),before+' ')
  write(file,{hooks:{UserPromptSubmit:[{matcher:'*',hooks:[legacy,foreign]}]}})
  if(provider==='claude'){
   const old=plan(provider,'history',[home],hooks);assert.ok(old.changes.some(c=>c.reason.includes('install.ps1')));apply(old)
   assert.deepEqual(read(file).hooks.UserPromptSubmit[0].hooks,[foreign])
  }
  // Modified arguments, foreign paths, and shell chains are preserved, not guessed.
  write(file,{hooks:{Stop:[{hooks:[{...foreign,command:'echo agentdeck-notify'},compat,{...legacy,command:legacy.command+'; echo user'}]}]}})
  assert.equal(plan(provider,'reset',[home],hooks).changes.filter(c=>c.decision==='제거').length,0)
  fs.writeFileSync(file,'{broken');assert.equal(plan(provider,'reset',[home],hooks).canApply,false)
 }
 // All files are validated before mutation; a stale ledger blocks other file writes too.
 const home=path.join(root,'atomic'),file=path.join(home,'settings.json');write(file,{hooks:{}})
 const p=plan('claude','apply',[home],hooks);write(path.join(home,'.agentdeck-hook-registry.json'),{})
 assert.throws(()=>apply(p),/변경/);assert.deepEqual(read(file),{hooks:{}})
 const rollbackHome=path.join(root,'rollback'),rollbackFile=path.join(rollbackHome,'settings.json')
 write(rollbackFile,{theme:'original',hooks:{}})
 const rollbackPlan=plan('claude','apply',[rollbackHome],hooks),rename=fs.renameSync
 let renames=0
 fs.renameSync=function(...args){if(++renames===3)throw Error('Injected write failure');return rename.apply(this,args)}
 try{assert.throws(()=>apply(rollbackPlan),/Injected write failure/)}finally{fs.renameSync=rename}
 assert.deepEqual(read(rollbackFile),{theme:'original',hooks:{}})
 assert.ok(!fs.existsSync(path.join(rollbackHome,'.agentdeck-statusline-inner.json')))
 assert.ok(!fs.existsSync(path.join(rollbackHome,'.agentdeck-hook-registry.json')))
 write(path.join(rollbackHome,'.agentdeck-hook-registry.json'),{version:1,provider:'claude',groups:[{id:'claude:Stop',event:'Stop',group:{hooks:[foreign]}}]})
 assert.equal(plan('claude','reset',[rollbackHome],hooks).canApply,false,'a foreign command in a corrupt registry cannot be deleted')
 console.log('PASS hook management: view, install, backup, idempotence, mixed groups, custom hooks, legacy installer, retired records, restore, stale plans, malformed input')
}finally{fs.rmSync(root,{recursive:true,force:true})}
