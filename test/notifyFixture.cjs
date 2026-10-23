const fs=require('node:fs'),ts=require('typescript'),Module=require('module')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019,experimentalDecorators:true,esModuleInterop:true}}).outputText,f)
const load=Module._load
Module._load=function(id,...args){if(id.startsWith('@angular/')||id.startsWith('tabby-'))return new Proxy({},{get:(_,k)=>k==='__esModule'?false:['Injectable','Component','NgModule','Inject','Optional'].includes(k)?()=>t=>t:class{}});return load.call(this,id,...args)}
const {WorkNotifyService}=require('../src/notify.service.ts')
module.exports=function(tabId='test-tab'){
 const tab={}
 const service=Object.assign(Object.create(WorkNotifyService.prototype),{parentOwners:new WeakMap(),tabIds:new Map([[tab,[tabId]]]),tabSession:new Map(),hookAgent:new WeakMap(),rejectedMetaSession:new WeakMap(),metaBySession:new Map()})
 return {tab,service}
}
