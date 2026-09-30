const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript')
const cp=require('child_process'),{EventEmitter}=require('events'),{PassThrough}=require('stream')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdeck-refresh-client-'))
process.env.AGENTDECK_ACCOUNTS_FILE=path.join(root,'accounts.json')
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,file)
const accounts=require('../src/accounts.ts'),policy=require('../src/accountRefreshPolicy.ts')
fs.writeFileSync(process.env.AGENTDECK_ACCOUNTS_FILE,JSON.stringify({codex:[{id:'refresh-client@example.test'}]}))
const account=accounts.readAccounts()[0],home=accounts.accountHome(account)
fs.mkdirSync(home,{recursive:true})
const jwt=p=>'fixture.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.fixture'
fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({tokens:{id_token:jwt({email:account.id}),access_token:jwt({exp:Math.floor(Date.now()/1000)+3600}),refresh_token:'fixture'}}))
const originalSpawn=cp.spawn,requests=[]
let starts=0,closed=0,wrongIdentity=false
cp.spawn=function(command,args,...rest){
    if(!args.includes('app-server')) return originalSpawn.call(this,command,args,...rest)
    starts++
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new EventEmitter()
    child.stdin.write=(line,callback)=>{
        const request=JSON.parse(line);requests.push(request)
        process.nextTick(()=>{
            if(request.id===undefined)return
            let result={}
            if(request.method==='account/read')result={account:{email:wrongIdentity?'other@example.test':account.id}}
            if(request.method==='account/login/start')result={authUrl:'https://auth.openai.com/fixture'}
            child.stdout.write(JSON.stringify({id:request.id,result})+'\n')
            if(request.method==='account/login/start')child.stdout.write(JSON.stringify({method:'account/login/completed',params:{success:true}})+'\n')
            callback?.()
        });return true
    }
    child.stdin.destroy=()=>{}
    child.kill=()=>{closed++;child.killed=true}
    return child
}
;(async()=>{
    await accounts.authenticateAccount(account)
    assert.equal(starts,0,'local identity check never starts Codex')
    await accounts.authenticateAccount(account,true)
    assert.equal(starts,1);assert.equal(closed,1)
    assert.equal(requests.find(r=>r.method==='account/read').params.refreshToken,true)
    policy.recordRefreshFailure(home,'',Date.now()-300001)
    assert.equal(policy.accountRefreshState(home).blocked,true)
    wrongIdentity=true
    await assert.rejects(accounts.loginAccount(account,async()=>()=>{}))
    assert.equal(policy.accountRefreshState(home).blocked,true,'wrong-account login never unblocks')
    wrongIdentity=false
    await accounts.loginAccount(account,async()=>()=>{})
    assert.equal(policy.accountRefreshState(home).blocked,undefined,'successful identity-verified login unblocks')
    assert.equal(closed,starts,'all temporary clients are closed')
    console.log('PASS: local check without CLI, forced-refresh RPC, cleanup, failed login stays blocked, successful login resets')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{cp.spawn=originalSpawn;fs.rmSync(root,{recursive:true,force:true})})
