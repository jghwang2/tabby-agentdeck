import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { agentHome, runtimeRoot } from './storagePaths'
import { accountHome, readAccounts } from './accounts'
import { HookProvider, HOOK_CATALOG_VERSION, historicalHook, ownedStatusLine, currentHookGroups, hookCommand, hookRevision } from './hookCatalog'

export type HookAction = 'view' | 'managed' | 'history' | 'reset' | 'apply'
export interface HookChange { file: string, event: string, decision: string, reason: string, content: any }
interface Snapshot { file: string, text: string | null }
interface Write { file: string, text: string }
export interface HookManagementPlan {
    provider: HookProvider, action: HookAction, changes: HookChange[], snapshots: Snapshot[], writes: Write[],
    preview: string, canApply: boolean, blockers: string[],
    sources?: {file: string, text: string}[],
}
const equal = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b)
const encode = (value: any): string => JSON.stringify(value, null, 2) + '\n'
const copy = (value: any): any => JSON.parse(JSON.stringify(value))
const ledgerPath = (home: string): string => path.join(home, '.agentdeck-hook-registry.json')

export function managedHookHomes (provider: HookProvider): string[] {
    const homes = [agentHome(provider), ...readAccounts().filter(a => a.provider === provider).map(accountHome).filter(h => fs.existsSync(h))]
    return [...new Map(homes.map(h => [path.resolve(h).toLowerCase(), h])).values()]
}

/** Planning is read-only. No CLI custom JSON fields: ownership lives in a separate registry. */
export function planHookManagement (provider: HookProvider, action: HookAction,
    homes = managedHookHomes(provider), hooksDir = path.resolve(__dirname, '../hooks')): HookManagementPlan {
    const plan: HookManagementPlan = {provider, action, changes: [], snapshots: [], writes: [], preview: '', canApply: false, blockers: []}
    const read = (file: string): any => {
        let snapshot = plan.snapshots.find(s => s.file === file)
        if (!snapshot) {
            let text: string | null = null
            try { text = fs.readFileSync(file, 'utf8') } catch (e: any) { if (e.code !== 'ENOENT') throw e }
            snapshot = {file, text}; plan.snapshots.push(snapshot)
        }
        return snapshot.text === null ? undefined : JSON.parse(snapshot.text.replace(/^\uFEFF/, ''))
    }
    const write = (file: string, value: any): void => {
        const text = encode(value)
        if (plan.snapshots.find(s => s.file === file)?.text !== text) plan.writes.push({file, text})
    }
    const full: any[] = []
    for (const home of homes) {
        const file = path.join(home, provider === 'claude' ? 'settings.json' : 'hooks.json')
        try {
            const settings = read(file) ?? {}
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)
                || (settings.hooks !== undefined && (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)))) throw Error('설정 형식 오류')
            const registryFile = ledgerPath(home), registry = read(registryFile)
            if (registry && (registry.version !== HOOK_CATALOG_VERSION || registry.provider !== provider || !Array.isArray(registry.groups)
                || registry.groups.some((r: any) => {
                    const h = r?.group?.hooks
                    const parsed = Array.isArray(h) && h.length === 1 && h[0]?.type === 'command' ? hookCommand(h[0].command) : null
                    return typeof r?.event !== 'string' || r.id !== provider + ':' + r.event || !parsed
                        || path.basename(parsed.script).split('.')[0] !== (provider === 'claude' ? 'agentdeck-notify' : 'agentdeck-codex-notify')
                }) || (registry.statusLine && (!ownedStatusLine(registry.statusLine.value)
                    || (registry.statusLine.original !== null && (typeof registry.statusLine.original !== 'object' || Array.isArray(registry.statusLine.original))))))) {
                throw Error('관리 기록 형식/버전 오류')
            }
            const next = copy(settings), keptRecords: any[] = []
            const recordChange = (event: string, decision: string, reason: string, content: any): void => {
                plan.changes.push({file, event, decision, reason, content})
            }
            const visibleHooks = Object.fromEntries(Object.entries(settings.hooks || {}).map(([event, groups]) => [event,
                Array.isArray(groups) ? groups.map((group: any) => ({...group, hooks: (group.hooks || []).filter((hook: any) =>
                    !!hookCommand(hook.command) || !!historicalHook(provider, event, group, hook))})).filter((group: any) => group.hooks.length) : [],
            ]).filter(([, groups]) => (groups as any[]).length))
            full.push({file, hooks: visibleHooks, ...(provider === 'claude' && ownedStatusLine(settings.statusLine) ? {statusLine: settings.statusLine} : {})})
            for (const [event, groups] of Object.entries(settings.hooks || {})) {
                if (!Array.isArray(groups)) throw Error('훅 이벤트 형식 오류: ' + event)
                const kept: any[] = []
                for (const group of groups) {
                    if (!group || !Array.isArray(group.hooks)) throw Error('훅 그룹 형식 오류: ' + event)
                    const recorded = registry?.groups.some((r: any) => r.event === event && equal(r.group, group))
                    const removeRecord = recorded && ['managed', 'reset', 'apply'].includes(action)
                    if (recorded && !removeRecord) keptRecords.push({id: provider + ':' + event, event, group})
                    const hooks = group.hooks.filter((hook: any) => {
                        const history = historicalHook(provider, event, group, hook)
                        const removeHistory = !!history && ['history', 'reset', 'apply'].includes(action)
                        const remove = removeRecord || removeHistory
                        recordChange(event, remove ? '제거' : '보존', recorded ? '관리 기록과 단락 전체 일치'
                            : history ? '배포 이력 ' + history : '사용자 항목 / 수정됨 / 출처 미확인', hook)
                        return !remove
                    })
                    if (hooks.length || !group.hooks.length) kept.push({...group, hooks})
                }
                if (kept.length) next.hooks[event] = kept
                else delete next.hooks[event]
            }
            // Keep records for user-modified groups, so a later restoration can still be recognized.
            for (const r of registry?.groups || []) {
                const present = settings.hooks?.[r.event]?.some((g: any) => equal(g, r.group))
                if (!present) keptRecords.push(r)
            }
            let original: any = settings.statusLine ?? null
            let managedStatus: any = registry?.statusLine
            if (provider === 'claude' && settings.statusLine) {
                const recorded = managedStatus && equal(managedStatus.value, settings.statusLine)
                const history = ownedStatusLine(settings.statusLine)
                if (action === 'apply' && !recorded && !history && /agentdeck-statusline/.test(String(settings.statusLine.command || ''))) {
                    plan.blockers.push(file + ': 수정된 AgentDeck 상태줄을 먼저 확인하세요.')
                }
                const shouldRemove = (recorded && ['managed', 'reset', 'apply'].includes(action))
                    || (history && ['history', 'reset', 'apply'].includes(action))
                if (shouldRemove) {
                    let found = !!recorded
                    if (recorded) original = managedStatus.original
                    else {
                        // Only documented backup locations; never follow an arbitrary --inner path.
                        const innerArg = hookCommand(settings.statusLine.command)?.args.match(/^--inner "([^"]+)"$/)?.[1]
                        for (const candidate of [path.join(home, '.agentdeck-statusline-inner.json'), path.join(runtimeRoot(), 'statusline-inner.json')]) {
                            if (innerArg && path.resolve(innerArg).toLowerCase() !== path.resolve(candidate).toLowerCase()) continue
                            const inner = read(candidate)
                            if (inner !== undefined) { original = inner; found = true; break }
                        }
                    }
                    if (found) {
                        if (original === null) delete next.statusLine
                        else next.statusLine = original
                        managedStatus = undefined
                        recordChange('statusLine', '복원', '보관한 사용자 상태줄 복원', settings.statusLine)
                    } else {
                        recordChange('statusLine', '보존', '복원할 원본 기록 없음', settings.statusLine)
                        if (action === 'apply') plan.blockers.push(file + ': 상태줄 원본 기록이 없어 재적용할 수 없습니다.')
                    }
                } else recordChange('statusLine', '보존', recorded ? '관리 기록 일치' : history ? '배포 이력 일치' : '사용자 상태줄', settings.statusLine)
            }
            let groups = keptRecords.filter(r => !settings.hooks?.[r.event]?.some((g: any) => equal(g, r.group))
                || next.hooks?.[r.event]?.some((g: any) => equal(g, r.group)))
            if (action === 'apply') {
                // Don't duplicate ambiguous AgentDeck-looking custom commands. Show them for review.
                const uncertain = plan.changes.filter(c => c.file === file && c.event !== 'statusLine' && c.decision === '보존'
                    && /agentdeck-(?:codex-)?notify/.test(String(c.content?.command || ''))
                    && (/tabby-agentdeck[\\/]hooks[\\/]/i.test(String(c.content.command)) || !!hookCommand(c.content.command)))
                if (uncertain.length) plan.blockers.push(file + ': 수정되었거나 출처가 불명확한 AgentDeck 명령을 먼저 확인하세요.')
                const installed = currentHookGroups(provider, hooksDir)
                for (const name of [provider === 'claude' ? 'agentdeck-notify.mjs' : 'agentdeck-codex-notify.mjs', ...(provider === 'claude' ? ['agentdeck-statusline.mjs'] : [])]) {
                    if (!fs.existsSync(path.join(hooksDir, name))) throw Error('전달기 파일 없음: ' + name)
                }
                next.hooks = next.hooks || {}
                groups = []
                for (const [event, added] of Object.entries(installed)) {
                    next.hooks[event] = [...(next.hooks[event] || []), ...added]
                    for (const group of added) { groups.push({id: provider + ':' + event, event, group}); recordChange(event, '추가', '현재 AgentDeck 관리 단락', group) }
                }
                if (provider === 'claude') {
                    const innerFile = path.join(home, '.agentdeck-statusline-inner.json')
                    read(innerFile)
                    original = next.statusLine ?? null
                    write(innerFile, original)
                    next.statusLine = {type: 'command', command: `node "${path.join(hooksDir, 'agentdeck-statusline.mjs').replace(/\\/g, '/')}" --inner "${innerFile.replace(/\\/g, '/')}"`}
                    managedStatus = {value: next.statusLine, original}
                    recordChange('statusLine', '추가', '사용자 상태줄을 보관하고 연결', next.statusLine)
                }
            }
            if (action !== 'view') {
                if (!equal(settings, next)) write(file, next)
                const nextRegistry = {version: HOOK_CATALOG_VERSION, provider, groups,
                    ...(action === 'apply' ? {revision: hookRevision(provider, hooksDir)} : registry?.revision ? {revision: registry.revision} : {}),
                    ...(managedStatus ? {statusLine: managedStatus} : {})}
                if (action === 'apply' || (registry && !equal(registry, nextRegistry))) write(registryFile, nextRegistry)
            }
        } catch (e: any) { plan.blockers.push(file + ': ' + e.message) }
    }
    plan.canApply = action !== 'view' && !!plan.writes.length && !plan.blockers.length
    const visibleChanges = plan.changes.filter(c => c.decision !== '보존' || !!hookCommand(c.content?.command))
    plan.preview = [
        ...plan.blockers.map(b => '중단: ' + b),
        ...(action === 'view' ? [] : ['변경 예정 항목\n' + JSON.stringify(visibleChanges, null, 2)]),
        '등록된 AgentDeck 훅\n' + JSON.stringify(full, null, 2),
    ].join('\n')
    if (action === 'view') {
        const name = provider === 'claude' ? 'agentdeck-notify' : 'agentdeck-codex-notify'
        plan.sources = [...(fs.existsSync(path.join(hooksDir, name + '.exe')) ? ['agentdeck-notify.cs'] : [name + '.mjs', name + '.ps1', 'agentdeck-relay.mjs']), ...(provider === 'claude' ? ['agentdeck-statusline.mjs'] : [])].map(name => {
            const file = path.join(hooksDir, name)
            try { return {file, text: fs.readFileSync(file, 'utf8')} }
            catch { return {file, text: '이 설치에서 파일을 읽을 수 없습니다.'} }
        })
    }
    return plan
}

/** Preflight every input, back up every original, and roll back prior writes on failure. */
export function applyHookManagement (plan: HookManagementPlan): string[] {
    if (!plan.canApply) throw Error('적용할 수 없는 계획입니다. 미리보기를 다시 확인하세요.')
    const readText = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8') } catch (e: any) { if (e.code === 'ENOENT') return null; throw e } }
    for (const s of plan.snapshots) if (readText(s.file) !== s.text) throw Error('설정이 변경되었습니다. 전문을 다시 불러오세요: ' + s.file)
    const suffix = '.agentdeck-backup-' + Date.now() + '-' + randomBytes(4).toString('hex')
    const backups: string[] = [], applied: Write[] = []
    const atomic = (file: string, text: string): void => {
        const tmp = file + '.agentdeck-' + randomBytes(4).toString('hex') + '.tmp'
        try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file) }
        finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
    }
    try {
        for (const w of plan.writes) {
            fs.mkdirSync(path.dirname(w.file), {recursive: true})
            const before = plan.snapshots.find(s => s.file === w.file)
            if (!before) throw Error('백업 대상 누락')
            if (before.text !== null) { fs.writeFileSync(w.file + suffix, before.text, {encoding: 'utf8', flag: 'wx'}); backups.push(w.file + suffix) }
        }
        for (const w of plan.writes) {
            const before = plan.snapshots.find(s => s.file === w.file)!
            if (readText(w.file) !== before.text) throw Error('저장 직전 설정 변경: ' + w.file)
            atomic(w.file, w.text); applied.push(w)
        }
    } catch (error: any) {
        const failures: string[] = []
        for (const w of applied.reverse()) {
            try {
                if (readText(w.file) !== w.text) throw Error('외부 변경으로 자동 복구 중단')
                const before = plan.snapshots.find(s => s.file === w.file)!
                if (before.text === null) fs.unlinkSync(w.file)
                else atomic(w.file, before.text)
            } catch { failures.push(w.file) }
        }
        throw Error(String(error.message) + (failures.length ? '\n백업에서 복구 필요: ' + failures.join(', ') : '\n기존 설정을 유지했습니다.'))
    }
    return backups
}
