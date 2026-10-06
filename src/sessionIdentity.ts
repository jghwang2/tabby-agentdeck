export interface SessionIdentity { id: string; letter: string; alias: string }
export interface AliasProject { key: string; name: string; evidence: string }

const genericDirectory = /^(?:[a-z]:|root|dev|qa|live|src|source|work|users|project|projects|server|client|bin)$/i
const regionName = (text: string): string => {
    const china = /(?:^|[\s/\\_.-])(?:cn|china|중국)(?=$|[\s/\\_.-])/i.test(text)
    const global = /(?:^|[\s/\\_.-])(?:global|글로벌)(?=$|[\s/\\_.-])/i.test(text)
    return china === global ? '' : china ? '중국' : '글로벌'
}

/** Learn explicit project labels by project path, never by the current tab slot.
 * Observations affect future identities only; conflicting labels are not guessed.
 */
export function adaptiveAliasBase (title: string, cwd: string, projects: AliasProject[], root = ''): string {
    const shellOnly = !title.trim() || /^(?:[\s\W]*)(?:powershell|cmd|bash|zsh|claude code|codex|terminal)(?:\.exe)?\s*$/i.test(title)
    const systemFolder = /(?:^|[/\\])(?:windows|system32|users|appdata)(?:[/\\]|$)/i.test(cwd)
    if ((!cwd || systemFolder) && !root && shellOnly) { return '' }
    const parts = (root || cwd).replace(/\\/g, '/').split('/').filter(Boolean)
    const boundary = parts.findIndex(part => /^projects?$/i.test(part))
    const candidates = parts.map((name, index) => ({ name, index }))
        .filter(p => !genericDirectory.test(p.name) && !regionName(p.name))
    const project = boundary >= 0 ? candidates.find(p => p.index > boundary) : candidates[candidates.length - 1]
    if (!project) { return jobAliasBase(title, cwd) }
    const key = parts.slice(0, project.index + 1).join('/').normalize('NFKC').toLowerCase()
    let entry = projects.find(p => p.key === key)
    const explicit = title.match(/(?:프로젝트|project)\s*[:=]\s*([\p{L}\p{N}_-]{2,24})/iu)
        || title.match(/([\p{L}\p{N}_-]{2,24})\s+(?:프로젝트|project)(?:\s|$)/iu)
    const label = explicit?.[1]
    const validLabel = label && !/^(?:현재|신규|새로운|다른|해당|이전|기존|new|current)$/i.test(label)
    if (!entry) {
        entry = { key, name: validLabel ? label : project.name, evidence: validLabel ? 'title' : 'path' }
        projects.push(entry)
    } else if (validLabel && entry.evidence === 'path') {
        entry.name = label
        entry.evidence = 'title'
    }
    // Specific cross-project tooling jobs still take precedence over the workspace.
    const task = jobAliasBase(title, '')
    if (['에이전트덱', '허브', '인프라', '도구'].includes(task)) { return task }
    const projectKind = jobAliasBase('', entry.name)
    const name = ['에이전트덱', '허브', '인프라', '도구'].includes(projectKind) ? projectKind : entry.name
    const clean = name.replace(/[^\p{L}\p{N}_-]/gu, '') || '작업'
    const region = regionName(cwd) || regionName(title)
    return clean + (region && !clean.includes(region) ? region : '')
}

/** The initial job selects the name; later title changes never rename it. */
export function jobAliasBase (title: string, cwd: string): string {
    const classify = (text: string): string => {
        if (/agent.?deck|tabby|에이전트덱|탭\s*(통신|이동|번호|제목)|리로드/i.test(text)) { return '에이전트덱' }
        if (/허브|업무일지|일일보고/i.test(text)) { return '허브' }
        if (/infra|인프라/i.test(text)) { return '인프라' }
        if (/토큰|모델|스킬|플러그인|codex|claude|클로드|코덱스/i.test(text)) { return '도구' }
        if (/게임|어뷰징|길드|전투|던전/i.test(text)) { return '게임' }
        return ''
    }
    const usefulTitle = /^(?:[\s\W]*)(?:powershell|cmd|bash|zsh|claude code|codex|terminal)(?:\.exe)?\s*$/i.test(title)
        ? '' : title
    const known = classify(usefulTitle) || classify(cwd)
    if (known) { return known }
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
    const project = parts.reverse().find(part => !/^(root|dev|qa|live|src|work|users|project|projects)$/i.test(part))
    const word = (project || usefulTitle.split(/\s+/)[0] || '작업').replace(/[^\p{L}\p{N}_-]/gu, '')
    return Array.from(word || '작업').slice(0, 12).join('')
}

/** Keep names stable while open; closed tabs do not reserve numbers. */
export class SessionIdentities {
    constructor (readonly records: SessionIdentity[], private readonly openIds?: ReadonlySet<string>) {}

    ensure (id: string, base = '작업'): SessionIdentity {
        const existing = this.records.find(record => record.id === id)
        if (existing) {
            if (!existing.alias || this.reserved(id).has(this.key(existing.alias))) {
                existing.alias = this.nextAlias(base, id)
            }
            return existing
        }
        const record = { id, letter: '', alias: this.nextAlias(base) }
        this.records.push(record)
        return record
    }

    private key (value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase() }

    private reserved (exceptId?: string): Set<string> {
        return new Set(this.records
            .filter(record => record.id !== exceptId && (!this.openIds || this.openIds.has(record.id)))
            .flatMap(record => [this.key(record.letter), this.key(record.alias)]))
    }

    private nextAlias (base: string, exceptId?: string): string {
        const reserved = this.reserved(exceptId)
        for (let number = 1; number <= Number.MAX_SAFE_INTEGER; number++) {
            const alias = `${base}${number}`
            if (!reserved.has(this.key(alias))) {
                // Once reused, a historical tab must allocate again on restore.
                for (const record of this.records) {
                    if (!this.openIds || this.openIds.has(record.id)) { continue }
                    if (this.key(record.alias) === this.key(alias)) { record.alias = '' }
                    if (this.key(record.letter) === this.key(alias)) { record.letter = '' }
                }
                return alias
            }
        }
        throw new Error('사용 가능한 별명이 없습니다.')
    }
}
