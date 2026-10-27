import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { accountsFile, agentHome } from './storagePaths'

export function readClaudeSettings (home: string): any {
    let raw: string
    try { raw = fs.readFileSync(path.join(home, 'settings.json'), 'utf8') } catch (e: any) {
        if (e.code === 'ENOENT') { return {} }
        throw e
    }
    const settings = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { throw new Error('Claude settings.json 형식을 확인하세요.') }
    return settings
}

export function writeClaudeSettings (home: string, settings: any): void {
    const file = path.join(home, 'settings.json')
    if (JSON.stringify(readClaudeSettings(home)) === JSON.stringify(settings)) { return }
    fs.mkdirSync(home, { recursive: true })
    if (fs.existsSync(file)) { fs.copyFileSync(file, file + '.agentdeck-backup') }
    const temporary = file + '.agentdeck-' + process.pid + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    fs.renameSync(temporary, file)
}

/** Only saved Claude accounts, never Codex homes or arbitrary directories. */
export function claudeSettingsHomes (): string[] {
    const homes = [agentHome('claude')]
    let data: any
    try { data = JSON.parse(fs.readFileSync(accountsFile(), 'utf8')) } catch (e: any) {
        if (e.code === 'ENOENT') { return homes }
        throw new Error('계정 파일을 읽지 못했습니다. JSON 형식을 확인하세요.')
    }
    for (const row of Array.isArray(data?.claude) ? data.claude : []) {
        if (typeof row?.id !== 'string' || !row.id.trim()) { continue }
        const key = createHash('sha256').update('claude:' + row.id.trim().toLowerCase()).digest('hex').slice(0, 24)
        const home = path.join(path.dirname(accountsFile()), 'accounts', key)
        if (fs.existsSync(home) && !homes.includes(home)) { homes.push(home) }
    }
    return homes
}
