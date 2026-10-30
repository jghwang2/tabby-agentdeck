// Execute the currently registered PostToolUse commands against an isolated ACK server.
// This proves the installed process chain, not production receiver latency.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict')
const {spawn}=require('node:child_process')
const now=()=>Number(process.hrtime.bigint())/1e6
const base=path.resolve(__dirname,'../.tmp/registered-hook-'+Date.now())
fs.mkdirSync(base,{recursive:true})
const preload=path.join(base,'trace.cjs')
fs.writeFileSync(preload,`const now=()=>Number(process.hrtime.bigint())/1e6;
const t={boot:now(),pid:process.pid,ppid:process.ppid,execPath:process.execPath,argv:process.argv};
const fs=require('node:fs'),net=require('node:net'),read=fs.readFileSync,connect=net.createConnection;
fs.readFileSync=function(file,...args){if(file===0)t.stdinStart=now();const v=read.call(this,file,...args);if(file===0)t.stdinEnd=now();return v};
net.createConnection=function(...args){t.connectStart=now();const s=connect.apply(this,args);s.prependListener('data',()=>{t.response??=now()});return s};
process.on('exit',()=>{t.exit=now();fs.writeFileSync(process.env.AGENTDECK_TRACE_FILE,JSON.stringify(t))});`)
const events=[]
const server=net.createServer(socket=>{let text='';socket.on('data',data=>{
 text+=data;if(!text.includes('\n'))return
 const e=JSON.parse(text.split('\n')[0]);text=''
 events.push({received:now(),id:e.id,sessionId:e.hook.session_id,originPid:e.pid,agent:e.options.Agent,kind:e.kind,event:e.hook.hook_event_name})
 socket.end(JSON.stringify({id:e.id,accepted:true,output:''})+'\n')
})})
const sources={
 claude:path.join(os.homedir(),'.claude/settings.json'),
 codex:path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'hooks.json'),
}
const results=[]
async function invoke(provider,index,direct=false){
 const config=JSON.parse(fs.readFileSync(sources[provider],'utf8').replace(/^\uFEFF/,''))
 const handlers=(config.hooks?.PostToolUse||[]).flatMap(g=>g.hooks||[]).filter(h=>/tabby-agentdeck[\\/]+hooks[\\/]+agentdeck-(?:codex-)?notify\.(?:ps1|mjs)/i.test(h.command||''))
 assert.equal(handlers.length,1,'Exactly one registered AgentDeck PostToolUse handler required')
 const command=handlers[0].command
 let tokens=command.match(/"[^"]*"|[^\s]+/g).map(s=>s.replace(/^"|"$/g,''))
 if(direct && !/^node(?:\.exe)?$/i.test(tokens[0])){const file=tokens[tokens.indexOf('-File')+1];tokens=['node',file.replace(/\.ps1$/,'.mjs'),...(provider==='claude'?['-Status','running']:[])]}
 const launchesNode=/^node(?:\.exe)?$/i.test(tokens[0])
 const sid='registered-'+provider+'-'+index+(direct?'-direct':'')
 const started=now()
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(tokens[0],tokens.slice(1),{windowsHide:true,env:{...process.env,
   NODE_OPTIONS:((process.env.NODE_OPTIONS||'')+' --require "'+preload.replace(/\\/g,'/')+'"').trim(),
   AGENTDECK_TRACE_FILE:path.join(base,sid+'.trace.json'),
   AGENTDECK_ORIGIN_PID:'',
   AGENTDECK_RUNTIME_ROOT:base,AGENTDECK_MAILBOX_ROOT:path.join(base,'mailbox'),AGENTDECK_TAB:'isolated-registered-hook',
  },stdio:['pipe','pipe','pipe']})
  let stdout='',stderr=''
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
  child.on('error',reject)
  const timer=setTimeout(()=>{child.kill();reject(Error('Diagnostic timeout'))},15000)
  child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr,launcherPid:child.pid,closed:now()})})
  child.stdin.end(JSON.stringify({session_id:sid,hook_event_name:'PostToolUse',cwd:base}))
 })
 assert.equal(output.code,0);assert.equal(output.stdout,'')
 const traceFile=path.join(base,sid+'.trace.json')
 const nodes=fs.existsSync(traceFile)?[JSON.parse(fs.readFileSync(traceFile,'utf8'))]:[]
 fs.writeFileSync(path.join(base,sid+'.launcher.json'),JSON.stringify(output,null,2))
 assert.equal(nodes.length,1,'Exactly one actual Node child observed')
 const event=events.find(e=>e.sessionId===sid)
 assert.ok(event,'Registered command delivered its event to isolated receiver')
 if(!launchesNode){assert.equal(nodes[0].ppid,output.launcherPid,'Node was directly started by registered PowerShell process');assert.equal(event.originPid,output.launcherPid)}
 else assert.equal(nodes[0].pid,output.launcherPid)
 const t=nodes[0]
 results.push({provider,direct,config:sources[provider],command:direct?tokens.join(' '):command,timeoutSeconds:handlers[0].timeout,totalMs:output.closed-started,
  stages:{beforeNode: t.boot-started,codeAndInput:t.connectStart-t.boot,roundTrip:t.response-t.connectStart,jsFinish:t.exit-t.response,afterJsExit:output.closed-t.exit},
  launcherPid:output.launcherPid,nodes,event})
}
;(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(base,'port'),String(server.address().port))
 for(let i=0;i<5;i++)for(const provider of ['claude','codex']){await invoke(provider,i);await invoke(provider,i,true)}
 const report={scope:'Exact installed PostToolUse commands; isolated immediate-ACK server; no production state changed',results}
 fs.writeFileSync(path.join(base,'report.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify({report:path.join(base,'report.json'),results},null,2))
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close())
