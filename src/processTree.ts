import { execFile } from 'node:child_process'
import { AgentId, identifyAgent } from './agents'

export interface ProcessRecord {
    pid: number
    ppid: number
    command: string
}

/** POSIX ps output: PID PPID COMMAND (command may contain spaces). */
export function parsePosixProcessTable (text: string): ProcessRecord[] {
    const records: ProcessRecord[] = []
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line)
        if (match) records.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] })
    }
    return records
}

/** Windows Get-CimInstance | ConvertTo-Json output. */
export function parseWindowsProcessTable (text: string): ProcessRecord[] {
    const parsed = JSON.parse(text)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.filter(row => row && Number.isInteger(Number(row.ProcessId)) && typeof row.CommandLine === 'string')
        .map(row => ({ pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId) || 0, command: row.CommandLine }))
}

/**
 * Find the nearest agent below a PTY, not merely a process named anywhere in
 * the system. Nested delegates do not replace their outer agent. If two
 * different agents are equally close, the answer is deliberately unknown.
 */
export function agentFromProcessTable (records: ProcessRecord[], rootPid: number): AgentId {
    const children = new Map<number, ProcessRecord[]>()
    for (const record of records) {
        const list = children.get(record.ppid) ?? []
        list.push(record)
        children.set(record.ppid, list)
    }
    const root = records.find(record => record.pid === rootPid)
    if (root) {
        const id = identifyAgent(root.command, '')
        if (id !== 'unknown') return id
    }

    const seen = new Set<number>([rootPid])
    let frontier = [rootPid]
    while (frontier.length) {
        const next: number[] = []
        const found = new Set<AgentId>()
        for (const parent of frontier) {
            for (const child of children.get(parent) ?? []) {
                if (seen.has(child.pid)) continue
                seen.add(child.pid)
                next.push(child.pid)
                const id = identifyAgent(child.command, '')
                if (id !== 'unknown') found.add(id)
            }
        }
        if (found.size === 1) return [...found][0]
        if (found.size > 1) return 'unknown'
        frontier = next
    }
    return 'unknown'
}

function processTable (file: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
            if (error) reject(error)
            else resolve(String(stdout ?? ''))
        })
    })
}

/** Query the OS directly; Tabby's getChildProcesses() is only a fast path. */
export async function findAgentInProcessTree (rootPid: number): Promise<AgentId> {
    if (!Number.isInteger(rootPid) || rootPid <= 0) return 'unknown'
    try {
        const windows = process.platform === 'win32'
        const text = await (windows
            ? processTable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'])
            : processTable('ps', ['-axo', 'pid=,ppid=,args=']))
        const records = windows ? parseWindowsProcessTable(text) : parsePosixProcessTable(text)
        return agentFromProcessTable(records, rootPid)
    } catch {
        return 'unknown'
    }
}
