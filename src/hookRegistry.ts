import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { HookProvider, HOOK_CATALOG_VERSION } from './hookCatalog'

/** Record only groups this installation generated, never neighboring user groups. */
export function prepareHookRegistry (home: string, provider: HookProvider, groups?: Record<string, any[]>, statusLine?: any): () => void {
    const file = path.join(home, '.agentdeck-hook-registry.json')
    let before: string | null = null
    try { before = fs.readFileSync(file, 'utf8') } catch (e: any) { if (e.code !== 'ENOENT') throw e }
    const record = before === null ? {version: HOOK_CATALOG_VERSION, provider, groups: []} : JSON.parse(before.replace(/^\uFEFF/, ''))
    if (record.version !== HOOK_CATALOG_VERSION || record.provider !== provider || !Array.isArray(record.groups)) throw Error('Invalid AgentDeck hook registry')
    if (groups) record.groups = Object.entries(groups).flatMap(([event, items]) => items.map(group => ({id: provider + ':' + event, event, group})))
    if (statusLine !== undefined) {
        if (statusLine === null) delete record.statusLine
        else record.statusLine = statusLine
    }
    const text = JSON.stringify(record, null, 2) + '\n'
    return () => {
        if (text === before) return
        let now: string | null = null
        try { now = fs.readFileSync(file, 'utf8') } catch (e: any) { if (e.code !== 'ENOENT') throw e }
        if (now !== before) throw Error('AgentDeck 관리 기록이 변경되었습니다: ' + file)
        fs.mkdirSync(home, {recursive: true})
        const stamp = Date.now() + '-' + randomBytes(4).toString('hex')
        if (before !== null) fs.writeFileSync(file + '.agentdeck-backup-' + stamp, before, {flag: 'wx'})
        const temp = file + '.' + stamp + '.tmp'
        try { fs.writeFileSync(temp, text, 'utf8'); fs.renameSync(temp, file) }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
    }
}
