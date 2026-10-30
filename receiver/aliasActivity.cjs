const fs = require('node:fs'), path = require('node:path')
const ALIAS_TTL_MS = 24 * 60 * 60 * 1000
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id)

// Hook timestamps are separate from shared UI settings. Rendering never renews a lease.
class AliasActivity {
    constructor(root) { this.dir=path.join(root,'alias-activity'); this.pending=new Map(); this.latest=new Map() }
    touch(tabId, ts) {
        if(!validId(tabId)||!Number.isFinite(ts)||ts>Date.now()+60000)return Promise.resolve()
        this.latest.set(tabId,Math.max(ts,this.latest.get(tabId)||0))
        const prior=this.pending.get(tabId)||Promise.resolve()
        const task=prior.catch(()=>{}).then(async()=>{
            await fs.promises.mkdir(this.dir,{recursive:true})
            // Separate writers cannot overwrite another receiver's newer timestamp.
            const file=path.join(this.dir,tabId+'.'+process.pid+'.json')
            let previous=0
            try { previous=JSON.parse(await fs.promises.readFile(file,'utf8')).ts||0 } catch(e) { if(e.code!=='ENOENT')throw e }
            if(previous>=ts)return
            const temp=file+'.'+process.pid+'.tmp'
            await fs.promises.writeFile(temp,JSON.stringify({ts}))
            await fs.promises.rename(temp,file)
        })
        this.pending.set(tabId,task)
        task.finally(()=>{if(this.pending.get(tabId)===task)this.pending.delete(tabId)}).catch(()=>{})
        return task
    }
    async expired(records,now=Date.now()) {
        const expired=[]
        let names=[]
        try {names=await fs.promises.readdir(this.dir)}catch(e){if(e.code!=='ENOENT')throw e}
        for(const record of records) {
            let latest=record.createdAt
            if(!Number.isFinite(latest))continue
            for(const tabId of record.tabIds||[]) {
                if(!validId(tabId))continue
                if(this.pending.has(tabId))await this.pending.get(tabId)
                for(const name of names.filter(n=>n.startsWith(tabId+'.')&&n.endsWith('.json')))try {
                    const value=JSON.parse(await fs.promises.readFile(path.join(this.dir,name),'utf8'))
                    if(!Number.isFinite(value.ts))throw Error('Invalid alias activity')
                    latest=Math.max(latest,value.ts)
                } catch(e) { if(e.code!=='ENOENT')throw e }
            }
            for(const tabId of record.tabIds||[])latest=Math.max(latest,this.latest.get(tabId)||0)
            if(latest<=now-ALIAS_TTL_MS)expired.push(record.id)
        }
        return expired
    }
    async prune(now=Date.now()) {
        let names
        try {names=await fs.promises.readdir(this.dir)}catch(e){if(e.code==='ENOENT')return;throw e}
        for(const name of names.filter(n=>n.endsWith('.json'))) {
            const id=name.split('.')[0],file=path.join(this.dir,name)
            if(this.pending.has(id))continue
            try {
                const value=JSON.parse(await fs.promises.readFile(file,'utf8'))
                if(Math.max(value.ts,this.latest.get(id)||0)<=now-ALIAS_TTL_MS&&!this.pending.has(id)) {
                    await fs.promises.unlink(file);this.latest.delete(id)
                }
            }catch(e){if(e.code!=='ENOENT')throw e}
        }
    }
}
module.exports={AliasActivity,ALIAS_TTL_MS}
