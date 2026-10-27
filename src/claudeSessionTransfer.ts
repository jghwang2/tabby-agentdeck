import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'

export function claudeConfigHome (home: string): string {
    return path.resolve(home) === path.resolve(os.homedir()) ? path.join(os.homedir(), '.claude') : home
}

interface Copy { source: string, target: string, data: Buffer, before: Buffer | null }
async function contents (file: string): Promise<Buffer | null> {
    try {
        if (!(await fs.promises.lstat(file)).isFile()) { throw new Error('대화 기록에 일반 파일이 아닌 항목이 있습니다.') }
        return await fs.promises.readFile(file)
    } catch (e: any) { if (e.code === 'ENOENT') { return null } throw e }
}
async function plan (sessionId: string, sourceHome: string, destHome: string): Promise<Copy[]> {
    if (!/^[0-9a-fA-F-]{8,64}$/.test(sessionId)) { throw new Error('대화 ID를 확인할 수 없습니다.') }
    const from = path.join(claudeConfigHome(sourceHome), 'projects'), to = path.join(destHome, 'projects')
    const fromReal = await fs.promises.realpath(from)
    let toReal: string | undefined
    try { toReal = await fs.promises.realpath(to) } catch (e: any) { if (e.code !== 'ENOENT') { throw e } }
    const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
    if (toReal && same(fromReal, toReal)) { return [] }
    const projects = await fs.promises.readdir(from, { withFileTypes: true })
    const matches: string[] = []
    for (const project of projects.filter(p => p.isDirectory())) {
        if (await contents(path.join(from, project.name, sessionId + '.jsonl'))) { matches.push(project.name) }
    }
    if (matches.length !== 1) { throw new Error('원본 대화 기록을 하나로 확인할 수 없어 계정 전환을 중단했습니다.') }
    const project = matches[0], result: Copy[] = []
    const add = async (relative: string) => {
        const source = path.join(from, project, relative), target = path.join(to, project, relative)
        const data = await contents(source)
        if (!data) { throw new Error('원본 대화 기록이 사라졌습니다.') }
        const before = await contents(target)
        if (before?.equals(data)) { return }
        if (before && (before.length > data.length || !data.subarray(0, before.length).equals(before))) {
            throw new Error('대상 계정에 서로 다르게 진행된 대화 기록이 있습니다. 기록을 보존하기 위해 전환을 중단했습니다.')
        }
        result.push({ source, target, data, before })
    }
    await add(sessionId + '.jsonl')
    const walk = async (relative: string): Promise<void> => {
        const dir = path.join(from, project, relative)
        let entries: fs.Dirent[]
        try {
            if (!(await fs.promises.lstat(dir)).isDirectory()) { throw new Error('하위 대화 기록이 일반 폴더가 아닙니다.') }
            entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch (e: any) { if (e.code === 'ENOENT') { return } throw e }
        for (const entry of entries) {
            if (entry.isDirectory()) { await walk(path.join(relative, entry.name)) }
            else { await add(path.join(relative, entry.name)) }
        }
    }
    await walk(sessionId)
    // Refuse redirected destination subdirectories; the projects root itself may be a junction.
    for (const copy of result) {
        let dir = path.dirname(copy.target)
        while (dir !== to) {
            try { if (!(await fs.promises.lstat(dir)).isDirectory()) { throw new Error('대상 대화 폴더가 일반 폴더가 아닙니다.') } }
            catch (e: any) { if (e.code !== 'ENOENT') { throw e } }
            dir = path.dirname(dir)
        }
    }
    return result
}

/** Preflight while the old terminal is alive; re-read only after it has stopped writing. */
export async function prepareClaudeSessionTransfer (sessionId: string, sourceHome: string, destHome: string): Promise<() => Promise<void>> {
    await plan(sessionId, sourceHome, destHome)
    return async () => {
        const copies = await plan(sessionId, sourceHome, destHome)
        for (const copy of copies) {
            const now = await contents(copy.target)
            if (copy.before ? !now?.equals(copy.before) : now !== null) { throw new Error('대상 대화가 변경되어 전환을 중단했습니다.') }
            if (!(await contents(copy.source))?.equals(copy.data)) { throw new Error('원본 대화가 아직 기록 중입니다. 다시 전환하세요.') }
            await fs.promises.mkdir(path.dirname(copy.target), { recursive: true })
            const temporary = copy.target + '.agentdeck-' + randomBytes(8).toString('hex') + '.tmp'
            try {
                await fs.promises.writeFile(temporary, copy.data, { flag: 'wx' })
                const latest = await contents(copy.target)
                if (copy.before ? !latest?.equals(copy.before) : latest !== null) {
                    throw new Error('대상 대화가 변경되어 전환을 중단했습니다.')
                }
                await fs.promises.rename(temporary, copy.target)
            } finally {
                try { await fs.promises.unlink(temporary) } catch (e: any) { if (e.code !== 'ENOENT') { throw e } }
            }
        }
    }
}

export async function waitForClaudeExit (pids: number[]): Promise<void> {
    const alive = (pid: number) => {
        try { process.kill(pid, 0); return true } catch (e: any) { if (e.code === 'ESRCH') { return false } throw e }
    }
    const deadline = Date.now() + 10000
    while (pids.some(alive)) {
        if (Date.now() >= deadline) { throw new Error('이전 대화 프로세스가 아직 종료 중이라 기록을 복사하지 않았습니다.') }
        await new Promise(resolve => setTimeout(resolve, 50))
    }
}
