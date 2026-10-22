// One short-lived transport process; all interpretation lives in the receiver.
import fs from 'node:fs'
import { relay } from './agentdeck-relay.mjs'
const options = { Agent: 'claude', MaxLabel: 40 }
const keys = { '-Agent': 'Agent', '-Status': 'Status', '-Label': 'Label', '-Subagent': 'Subagent', '-SessionId': 'SessionId', '-MaxLabel': 'MaxLabel' }
for (let i = 2; i < process.argv.length; i++) {
    const key = keys[process.argv[i]]
    if (key) options[key] = process.argv[++i]
}
try { process.stdout.write(await relay('notify', fs.readFileSync(0, 'utf8'), options)) } catch {}
