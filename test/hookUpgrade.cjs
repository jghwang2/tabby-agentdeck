const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,f)
const {findHookUpgrades,applyHookUpgrades,upgradedHookSettings}=require('../src/hookUpgrade.ts')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdeck-hook-upgrade-')),dir=path.resolve(__dirname,'../hooks')
const legacy=name=>`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\old\\tabby-agentdeck\\hooks\\${name}.ps1"`
const files=['claude','codex'].map(x=>path.join(root,x+'.json'))
const originals=files.map((file,i)=>({model:'keep',statusLine:{command:'user-status'},hooks:{PostToolUse:[{matcher:'*',hooks:[
 {type:'command',command:'echo user-hook',timeout:7},
 {type:'command',command:legacy(i?'agentdeck-codex-notify':'agentdeck-notify')+(i?'':' -Status running'),timeout:i?3:5},
 {type:'command',command:'powershell -File "C:\\other\\custom.ps1"',timeout:9},
]}]}}))
try{
 originals.forEach((s,i)=>fs.writeFileSync(files[i],JSON.stringify(s)))
 const plan=findHookUpgrades(dir,files);assert.equal(plan.length,2);assert.ok(plan.every(p=>p.count===1))
 const before=files.map(f=>fs.readFileSync(f,'utf8'))
 assert.deepEqual(files.map(f=>fs.readFileSync(f,'utf8')),before,'detection does not write')
 applyHookUpgrades(plan,dir)
 for(let i=0;i<files.length;i++){
  const next=JSON.parse(fs.readFileSync(files[i]));const handlers=next.hooks.PostToolUse[0].hooks
  assert.match(handlers[1].command,/^node ".*\.mjs"/);assert.ok(!handlers[1].command.includes('powershell'))
  assert.equal(handlers[1].timeout,i?3:5)
  assert.deepEqual(handlers[0],originals[i].hooks.PostToolUse[0].hooks[0]);assert.deepEqual(handlers[2],originals[i].hooks.PostToolUse[0].hooks[2])
  assert.deepEqual(next.statusLine,originals[i].statusLine);assert.equal(next.model,'keep')
  assert.equal(fs.readFileSync(files[i]+'.agentdeck-hook-upgrade-backup','utf8'),before[i])
 }
 assert.deepEqual(findHookUpgrades(dir,files),[],'latest settings never prompt again')
 assert.equal(upgradedHookSettings({hooks:{}},dir).count,0,'no automatic enrollment')
 assert.equal(upgradedHookSettings({hooks:{Stop:[{hooks:[{command:legacy('agentdeck-notify').replace('tabby-agentdeck\\hooks','claude-compat')}]}]}},dir).count,0,'same-name custom integration unchanged')
 assert.equal(upgradedHookSettings({hooks:{Stop:[{hooks:[{command:legacy('agentdeck-notify')+'; echo custom'}]}]}},dir).count,0,'custom command chains unchanged')
 fs.writeFileSync(files[0],before[0]);fs.writeFileSync(files[1],before[1])
 const stale=findHookUpgrades(dir,files);fs.appendFileSync(files[1],' ')
 assert.throws(()=>applyHookUpgrades(stale,dir),/변경/);assert.equal(fs.readFileSync(files[0],'utf8'),before[0],'preflight before any write')
 fs.writeFileSync(files[0],'{broken');assert.throws(()=>findHookUpgrades(dir,files));assert.equal(fs.readFileSync(files[0],'utf8'),'{broken')
 console.log('PASS hook upgrade: legacy detection, no enrollment, preserve other hooks/options/statusline, backup, idempotence, stale approval and malformed JSON')
}finally{fs.rmSync(root,{recursive:true,force:true})}
