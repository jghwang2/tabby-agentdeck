const fs = require('node:fs'), path = require('node:path'), net = require('node:net')
const {runtimeRoot} = require('../hooks/agentdeck-runtime.cjs')
const root = runtimeRoot()
const mailbox = path.join(root, 'mailbox')
const file = p => {try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}
const ledger = file(path.join(root,'sessions.json'))
const store = file(path.join(mailbox,'mailbox.json'))
const port = Number(fs.readFileSync(path.join(mailbox,'port'),'utf8'))
const socket = net.connect({host:'127.0.0.1',port})
let buffer=''
socket.setTimeout(30000,()=>socket.destroy(new Error('Timeout')))
socket.on('connect',()=>socket.write(JSON.stringify({channel:'agentdeck-navigation'})+'\n'))
socket.on('data',chunk=>{
 buffer+=chunk
 if(!buffer.includes('\n'))return
 socket.end()
 const response=JSON.parse(buffer.split('\n')[0])
 const report={root,mailbox,port,navigationAvailable:!!response.result?.capturedAt,
  ledgerRows:ledger?.records?.length,mailboxSessions:store?.sessions?.length,
  activeMailboxSessions:store?.sessions?.filter(s=>s.active).length,
  ownSessionInLedger:ledger?.records?.some(s=>s.sessionId===process.env.CODEX_SESSION_ID),
  legacyImport:fs.existsSync(path.join(root,'.legacy-imported')),
  files:fs.readdirSync(root),checkedAt:new Date().toISOString()}
 fs.writeFileSync(path.resolve(__dirname,'../.tmp/runtime-live-verification.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report))
 if(!report.navigationAvailable || !report.legacyImport)process.exitCode=1
})
socket.on('error',e=>{console.error(e.message);process.exitCode=1})
