const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path')
const {AliasActivity,ALIAS_TTL_MS}=require('../receiver/aliasActivity.cjs')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alias-activity-')),now=Date.now(),a=new AliasActivity(root)
 try {
  const records=[{id:'a',tabIds:['tab-a'],createdAt:now-ALIAS_TTL_MS},{id:'b',tabIds:['tab-b'],createdAt:now-ALIAS_TTL_MS+1},{id:'legacy'}]
  assert.deepEqual(await a.expired(records,now),['a'])
  await a.touch('tab-a',now-1000)
  assert.deepEqual(await a.expired(records,now),[])
  await a.touch('tab-a',now-2000)
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir,'tab-a.'+process.pid+'.json'))).ts,now-1000)
  assert.deepEqual(await new AliasActivity(root).expired(records,now),[])
  assert.deepEqual(await a.expired(records,now+ALIAS_TTL_MS),['a','b'])
  await a.prune(now+ALIAS_TTL_MS);assert.equal(fs.readdirSync(a.dir).length,0)
  await a.touch('tab-a',now)
  assert.deepEqual(await a.expired(records,now),[])
  await a.touch('../invalid',now);assert.equal(fs.readdirSync(a.dir).length,1)
  console.log('PASS alias activity: exact 24h boundary, real hook renewal, restart, stale replay, expiry and late return')
 } finally {fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
