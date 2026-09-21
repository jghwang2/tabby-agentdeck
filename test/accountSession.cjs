const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path')
const { EventEmitter } = require('events'), https = require('https'), ts = require('typescript')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-auth-session-'))
process.env.AGENTDECK_ACCOUNTS_FILE = path.join(dir, 'accounts.json')
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText, file)
fs.writeFileSync(process.env.AGENTDECK_ACCOUNTS_FILE, JSON.stringify({claude:[{id:'session-fixture@example.test',name:'fixture'}]}))
const accounts = require('../src/accounts.ts'), session = require('../src/accountSession.ts')
const account = accounts.readAccounts()[0], dest = accounts.accountHome(account), source = path.join(dir,'live')
const write = (p,v) => {fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v))}
const read = p => JSON.parse(fs.readFileSync(p,'utf8'))
const cred = (token,expiresAt) => ({claudeAiOauth:{accessToken:token,refreshToken:token+'-refresh',expiresAt}})
const profile = {oauthAccount:{emailAddress:account.id}}
write(path.join(dest,'.claude.json'),profile);write(path.join(source,'.claude.json'),profile)
write(path.join(dest,'.credentials.json'),cred('old',Date.now()-60000))
write(path.join(source,'.credentials.json'),cred('live',Date.now()+3600000))
session.registerAccountSource(account,source)
let mode = 'ok', refreshes=0, gets=0
const original = {request:https.request,get:https.get}
https.request = (url,options,callback) => {
    assert.equal(url,'https://platform.claude.com/v1/oauth/token')
    const request = new EventEmitter(); request.destroy=()=>request.emit('error',new Error('test'))
    request.end = body => {
        const input = JSON.parse(body);assert.equal(input.grant_type,'refresh_token');assert.ok(input.refresh_token)
        refreshes++
        process.nextTick(()=>{
            const response = new EventEmitter();response.statusCode=mode==='invalid'?400:mode==='network'?503:200
            response.headers={};callback(response)
            response.emit('data',JSON.stringify(mode==='invalid'?{error:'invalid_grant'}:mode==='network'?{error:'unavailable'}:
                {access_token:'rotated-'+refreshes,refresh_token:'rotated-refresh-'+refreshes,expires_in:28800,account:{email_address:account.id}}))
            response.emit('end');request.emit('close')
        })
    };return request
}
https.get = (url,options,callback) => {
    gets++;const request = new EventEmitter();request.destroy=()=>request.emit('error',new Error('test'))
    process.nextTick(()=>{const response=new EventEmitter();response.statusCode=429;response.headers={'retry-after':'3600'};callback(response);response.emit('data','{}');response.emit('end');request.emit('close')})
    return request
}
;(async()=>{
    await session.ensureAccountSession(account)
    assert.equal(read(path.join(dest,'.credentials.json')).claudeAiOauth.accessToken,'live')
    assert.equal(refreshes,0,'unexpired live credentials do not trigger OAuth')
    write(path.join(source,'.claude.json'),{...profile,hasCompletedOnboarding:true,theme:'dark'})
    accounts.prepareAccount(account,source)
    assert.equal(read(path.join(dest,'.claude.json')).hasCompletedOnboarding,true,'auth restoration preserves completed CLI setup')
    assert.equal(accounts.accountEmail('claude',dest),account.id)
    const snapshot = await accounts.protectAccountAuth(read(process.env.AGENTDECK_ACCOUNTS_FILE).claude[0].auth.data,true)
    assert.equal(JSON.parse(snapshot).credentials.claudeAiOauth.accessToken,'live','latest live token persisted encrypted')
    await Promise.all([session.ensureAccountSession(account,true),session.ensureAccountSession(account,true)])
    assert.equal(refreshes,1,'concurrent refresh is single-flight')
    assert.equal(read(path.join(source,'.credentials.json')).claudeAiOauth.accessToken,'rotated-1','canonical live source updated')
    assert.equal(read(path.join(dest,'.credentials.json')).claudeAiOauth.refreshToken,'rotated-refresh-1','private copy updated')
    const second=await accounts.protectAccountAuth(read(process.env.AGENTDECK_ACCOUNTS_FILE).claude[0].auth.data,true)
    assert.equal(JSON.parse(second).credentials.claudeAiOauth.accessToken,'rotated-1','rotated token persisted encrypted')
    // Usage throttle is not an authentication failure and does not refresh or discard credentials.
    const before=refreshes
    await assert.rejects(session.getAccountQuotas(account),e=>e.kind==='temporary'&&e.status===429&&e.retryAfterMs===3600000)
    await session.ensureAccountSession(account)
    assert.equal(refreshes,before)
    await assert.rejects(session.getAccountQuotas(account),e=>e.kind==='temporary')
    assert.equal(gets,1,'Retry-After prevents repeated requests')
    const now=Date.now()
    session.recordAccountUsage(account,{agent:'claude',account:account.id,ts:now,limits:{fiveHourPct:25,sevenDayPct:61,scopedName:'Fable',scopedPct:38}})
    const live=await session.getAccountQuotas(account)
    assert.deepEqual(live.values.map(x=>x.remaining),[75,39,62]);assert.equal(live.stale,false);assert.equal(gets,1)
    session.recordAccountUsage(account,{agent:'claude',account:'wrong@example.test',ts:now+1,limits:{fiveHourPct:99}})
    assert.equal(session.cachedAccountQuotas(account).values[0].remaining,75,'wrong account metadata ignored')
    const cache=read(path.join(dest,'usage.json'));cache.ts=Date.now()-300000;write(path.join(dest,'usage.json'),cache)
    assert.equal((await session.getAccountQuotas(account)).stale,true,'old cache is explicitly marked stale')
    mode='network';await assert.rejects(session.ensureAccountSession(account,true),e=>e.kind==='temporary')
    mode='invalid';await assert.rejects(session.ensureAccountSession(account,true),e=>e.kind==='auth')
    assert.equal(read(path.join(dest,'.credentials.json')).claudeAiOauth.accessToken,'rotated-1','failed refresh retains token')
    // A different account in the live source can never replace this account's snapshot.
    write(path.join(source,'.claude.json'),{oauthAccount:{emailAddress:'wrong@example.test'}})
    write(path.join(source,'.credentials.json'),cred('wrong-user',Date.now()+86400000))
    session.synchronizeClaudeAuth(account)
    assert.equal(read(path.join(dest,'.credentials.json')).claudeAiOauth.accessToken,'rotated-1')
    console.log('PASS: live-token synchronization, background refresh/rotation, encrypted persistence, concurrency, 429 backoff, live/stale quotas, identity isolation, auth vs transient failures')
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{
    https.request=original.request;https.get=original.get;fs.rmSync(dir,{recursive:true,force:true})
})
