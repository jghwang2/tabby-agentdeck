import fs from 'node:fs'
import { relay } from './agentdeck-relay.mjs'
try { process.stdout.write(await relay('notify', fs.readFileSync(0, 'utf8'), { Agent: 'codex' })) } catch {}
