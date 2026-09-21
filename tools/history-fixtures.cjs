// Synthetic transcripts for tools/probe-history.js. Never creates a real AI session.
const fs = require('node:fs')
const path = require('node:path')
if (!process.argv[2]) throw new Error('Usage: node tools/history-fixtures.cjs <isolated-fixture-directory>')
const root = path.resolve(process.argv[2])
const claude = path.join(root,'claude','projects','example')
const codex = path.join(root,'codex','sessions','2026','09','21')
fs.mkdirSync(claude,{recursive:true}); fs.mkdirSync(codex,{recursive:true})
const message = (role,content) => ({type:role,message:{role,content}})
const claudeRows = [
    {...message('user','Investigate battle validation'),cwd:'D:/Project/HistoryExample'},
    ...Array.from({length:410},(_,i)=>message('assistant','Earlier context '+i)),
    message('assistant','CheckDetectAbusing rCode=-10001 a.b[0] 한국식별자 <img src=x onerror=alert(1)>'),
    message('user','Follow up'),
]
const codexRows = [
    {type:'session_meta',payload:{cwd:'D:/Project/CodexExample'}},
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Review parser'}]}},
    {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'CheckDetectAbusing fixed in Codex'}]}},
]
fs.writeFileSync(path.join(claude,'11111111-1111-4111-8111-111111111111.jsonl'),claudeRows.map(JSON.stringify).join('\n')+'\n')
fs.writeFileSync(path.join(codex,'rollout-2026-09-21-22222222-2222-4222-8222-222222222222.jsonl'),codexRows.map(JSON.stringify).join('\n')+'\n')
console.log(JSON.stringify({CLAUDE_CONFIG_DIR:path.join(root,'claude'),CODEX_HOME:path.join(root,'codex')}))
