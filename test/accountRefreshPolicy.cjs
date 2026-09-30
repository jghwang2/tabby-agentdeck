const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript')
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,file)
const policy=require('../src/accountRefreshPolicy.ts')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdeck-refresh-policy-'))
try {
    for(const provider of ['claude','codex']) {
        const home=path.join(root,provider),now=Date.now()
        assert.equal(policy.accountRefreshState(home,now).blocked,undefined)
        policy.recordRefreshFailure(home,'',now)
        assert.equal(policy.accountRefreshState(home,now+299999).blocked,false)
        assert.equal(policy.accountRefreshState(home,now+300000).blocked,true)
        delete require.cache[require.resolve('../src/accountRefreshPolicy.ts')]
        assert.equal(require('../src/accountRefreshPolicy.ts').accountRefreshState(home,now+86400000).blocked,true,'restart keeps the block')
        policy.recordRefreshSuccess(home,'')
        assert.equal(policy.accountRefreshState(home).blocked,true,'ordinary success cannot silently unblock')
        policy.resetAccountRefreshAfterLogin(home)
        const generation=policy.accountRefreshState(home).generation
        assert.ok(generation)
        policy.recordRefreshFailure(home,'',now+300000)
        assert.equal(policy.accountRefreshState(home).firstFailureAt,undefined,'old request cannot disable a new login')
        policy.recordRefreshFailure(home,generation,now)
        policy.recordRefreshSuccess(home,generation)
        assert.equal(policy.accountRefreshState(home).firstFailureAt,undefined,'a successful retry clears the failure window')
    }
    console.log('PASS: five-minute boundary, both providers, restart persistence, login-only reset, stale-request protection, successful retry')
} finally {fs.rmSync(root,{recursive:true,force:true})}
