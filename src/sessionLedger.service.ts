import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { agentHome } from './storagePaths'

import { diagCatch } from './diag'
import { HistorySource } from './sessionSearch'
import {
    HEAD_BYTE_LIMIT,
    HEAD_LINE_LIMIT,
    HeadInfo,
    SessionRecord,
    clampLabel,
    mergeSessions,
    pruneLedger,
    readHead,
    sessionIdFromFile,
} from './sessionLedger'

/**
 * 지난 세션 원장의 **파일 담당** — 읽고, 쓰고, 기록 폴더를 훑는다.
 * 무엇을 보여줄지 정하는 규칙은 전부 `sessionLedger.ts` 에 있다(fs 없이 테스트되는 쪽).
 *
 * 저장 위치는 `%LOCALAPPDATA%\tabby-agentdeck\sessions.json` — 훅 상태 파일 폴더 옆이다.
 * **Tabby 설정(`config.yaml`)에 넣지 않는다.** 세션은 계속 쌓이는데 거기 넣으면 남의 설정 파일이
 * 수백 줄 불어나고, 라벨이 바뀔 때마다 `config.save()` 가 돌아 관계없는 설정까지 다시 쓴다.
 */
@Injectable({ providedIn: 'root' })
export class SessionLedgerService {
    private root = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'tabby-agentdeck',
    )
    private file = path.join(this.root, 'sessions.json')
    /** Claude Code 대화기록이 사는 곳 (`notify.service` 와 같은 자리) */
    private get projectsDir (): string { return path.join(agentHome('claude'), 'projects') }

    /** 세션 id -> 원장 한 줄. 사람이 친 라벨이 여기 남는다 */
    private ledger = new Map<string, SessionRecord>()
    /** 디스크 스캔 결과 (기록 파일에서 읽은 것) */
    private scanned: SessionRecord[] = []
    /**
     * 기록 앞부분 파싱 캐시 — `세션id:mtime` 키. 파일이 자라도 **앞부분은 안 바뀐다**.
     * 그래도 mtime 을 키에 넣는 이유는 세션이 이어받기로 되살아나 새 줄이 앞에 붙는 경우가
     * 아니라, 파일이 통째로 갈렸을 때(삭제 후 재생성) 옛 값을 물고 있지 않기 위해서다.
     */
    private headCache = new Map<string, HeadInfo>()

    private loaded = false
    private saveTimer: any = null
    private scanning: Promise<void> | null = null
    private lastScan = 0
    private historyFiles: HistorySource[] = []

    /** 목록이 바뀌었을 때 호출부(사이드바)가 다시 그리도록 */
    onChange: (() => void) | null = null

    constructor (private config: ConfigService) { }

    // ── 원장 ────────────────────────────────────────────────────────────────

    private load (): void {
        if (this.loaded) {
            return
        }
        this.loaded = true
        try {
            const raw = fs.readFileSync(this.file, 'utf8')
            const parsed = JSON.parse(raw)
            const rows: any[] = Array.isArray(parsed?.records) ? parsed.records : []
            for (const r of rows) {
                if (r && typeof r.sessionId === 'string' && r.sessionId) {
                    this.ledger.set(r.sessionId, {
                        sessionId: r.sessionId,
                        cwd: typeof r.cwd === 'string' ? r.cwd : null,
                        label: clampLabel(r.label),
                        lastStatus: typeof r.lastStatus === 'string' ? r.lastStatus : null,
                        lastSeen: Number(r.lastSeen) || 0,
                        from: r.from === 'head' ? 'head' : 'live',
                    })
                }
            }
        } catch {
            // 아직 없다 / 깨졌다 — 빈 원장으로 시작한다. 디스크 스캔만으로도 목록은 선다
        }
    }

    /**
     * 저장을 한 번으로 모은다. 라벨은 사람이 Enter 를 칠 때마다 갱신되므로
     * 그때마다 파일을 쓰면 타자 속도로 디스크를 때린다.
     */
    private scheduleSave (): void {
        if (this.saveTimer) {
            return
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            this.save()
        }, 2000)
    }

    private save (): void {
        try {
            fs.mkdirSync(this.root, { recursive: true })
            const records = [...this.ledger.values()]
            fs.writeFileSync(this.file, JSON.stringify({ version: 1, records }, null, 1) + '\n', 'utf8')
        } catch (e: any) {
            diagCatch('세션 원장 저장', e)
        }
    }

    /**
     * 세션 하나의 지금을 원장에 적는다.
     *
     * 라벨은 **비어 있지 않을 때만** 덮는다 — 탭이 막 열려 아직 프롬프트가 없을 때 빈 문자열로
     * 덮으면 지난 실행에서 적어 둔 좋은 라벨을 지우게 된다.
     */
    note (sessionId: string, patch: { cwd?: string | null, label?: string | null, status?: string | null }): void {
        if (!sessionId) {
            return
        }
        this.load()
        const prev = this.ledger.get(sessionId)
        const label = clampLabel(patch.label)
        const next: SessionRecord = {
            sessionId,
            cwd: patch.cwd || prev?.cwd || null,
            label: label || prev?.label || '',
            lastStatus: patch.status ?? prev?.lastStatus ?? null,
            lastSeen: Date.now(),
            from: label ? 'live' : (prev?.from ?? 'live'),
        }
        const same = prev
            && prev.cwd === next.cwd
            && prev.label === next.label
            && prev.lastStatus === next.lastStatus
        this.ledger.set(sessionId, next)
        // 값이 그대로면 저장만 미룬다 — `lastSeen` 하나 때문에 2초마다 쓰지 않게
        if (!same) {
            this.scheduleSave()
        }
    }

    // ── 디스크 스캔 ─────────────────────────────────────────────────────────

    /**
     * 기록 폴더를 훑어 세션 목록을 다시 만든다.
     *
     * **폴링하지 않는다.** `notify.service.ts:64` 가 적어 둔 대로 `~/.claude/projects` 전체를
     * 2초마다 readdir 하면 안 된다. 목록을 펼칠 때와 탭이 닫힐 때만 부른다.
     */
    async refresh (force = false): Promise<void> {
        const now = Date.now()
        if (!force && now - this.lastScan < 15000) {
            return
        }
        if (this.scanning) {
            return this.scanning
        }
        this.scanning = this.scan().finally(() => {
            this.scanning = null
            this.lastScan = Date.now()
        })
        return this.scanning
    }

    private async scan (): Promise<void> {
        this.load()
        const cfg = this.config.store.agentDeck
        const days = Number(cfg.resumeListDays) || 0
        const cutoff = days > 0 ? Date.now() - days * 86400000 : 0

        interface Found { sessionId: string, file: string, mtime: number, agent?: 'claude' | 'codex' }
        const found: Found[] = []
        /**
         * 기간과 **무관하게** 디스크에 파일이 있는 세션 전부. 원장 청소는 이걸로 판정한다 —
         * `found` 는 기간 필터를 통과한 것만이라 그걸로 지우면 오래된(그러나 멀쩡한) 기록의
         * 라벨이 통째로 날아간다. 기간은 "화면에 안 보인다" 이지 "없다" 가 아니다.
         */
        const onDisk = new Set<string>()
        try {
            const dirs = await fs.promises.readdir(this.projectsDir, { withFileTypes: true })
            for (const entry of dirs) {
                if (!entry.isDirectory()) {
                    continue
                }
                const dir = path.join(this.projectsDir, entry.name)
                let names: string[]
                try {
                    names = await fs.promises.readdir(dir)
                } catch {
                    // 권한·경합으로 못 읽는 폴더 하나 때문에 나머지를 포기하지 않는다
                    continue
                }
                for (const name of names) {
                    const sid = sessionIdFromFile(name)
                    if (!sid) {
                        continue
                    }
                    const full = path.join(dir, name)
                    onDisk.add(sid)
                    try {
                        const st = await fs.promises.stat(full)
                        // 기간 밖은 **앞부분을 읽기 전에** 버린다 — 파싱이 아니라 stat 이 필터다
                        found.push({ sessionId: sid, file: full, mtime: st.mtimeMs })
                    } catch {
                        // 방금 지워졌다 — 다음 스캔에서 사라진다
                    }
                }
            }
        } catch {
            // `~/.claude/projects` 자체가 없다 — Claude Code 를 안 쓰는 환경. 목록은 비고 화면엔 아무것도 안 그려진다
            // Codex history is independent of the Claude installation.
        }

        const scanCodex = async (dir: string, depth: number): Promise<void> => {
            let entries: fs.Dirent[]
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory() && depth < 3) {
                    await scanCodex(full, depth + 1)
                    continue
                }
                const match = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(entry.name)
                if (!entry.isFile() || !match) {
                    continue
                }
                onDisk.add(match[1])
                try {
                    const st = await fs.promises.stat(full)
                    found.push({ sessionId: match[1], file: full, mtime: st.mtimeMs, agent: 'codex' })
                } catch { /* File removed during scan. */ }
            }
        }
        await scanCodex(path.join(agentHome('codex'), 'sessions'), 0)

        found.sort((a, b) => b.mtime - a.mtime)
        this.historyFiles = found.map(f => ({file: f.file, sessionId: f.sessionId, agent: f.agent || 'claude'}))
        // 앞부분 읽기에 상한을 둔다 — 기록이 수백 개인 사람에게도 펼치는 순간이 멈추지 않게.
        // 그룹당 몇 줄만 그리므로 최신 200개면 화면에 닿는 것은 다 들어온다
        const HEAD_SCAN_MAX = 200
        const slice = found.filter(f => !cutoff || f.mtime >= cutoff).slice(0, HEAD_SCAN_MAX)

        const out: SessionRecord[] = []
        for (const f of slice) {
            const key = `${f.sessionId}:${Math.round(f.mtime)}`
            let head = this.headCache.get(key)
            if (!head) {
                head = await this.readHeadOf(f.file)
                this.headCache.set(key, head)
            }
            if (head.isSubagent) {
                continue
            }
            out.push({
                agent: f.agent || 'claude',
                sessionId: f.sessionId,
                cwd: head.cwd,
                label: head.label,
                lastStatus: null,
                lastSeen: f.mtime,
                from: 'head',
            })
        }
        this.scanned = out

        // 기록이 사라진 세션은 원장에서 지운다 — 이어받아도 복원할 것이 없다
        const before = this.ledger.size
        const kept = pruneLedger([...this.ledger.values()], onDisk)
        if (kept.length !== before) {
            this.ledger = new Map(kept.map(r => [r.sessionId, r]))
            this.scheduleSave()
        }

        this.onChange?.()
    }

    /**
     * 기록 파일 앞부분만 읽는다 — 전체를 읽지 않는 이유는 `HEAD_LINE_LIMIT` 주석에 있다.
     * 마지막 조각은 줄이 잘려 있을 수 있으니 버린다(파싱 실패로 조용히 넘어가긴 하지만,
     * 버리는 편이 "왜 라벨이 가끔 이상한가" 를 애초에 만들지 않는다).
     */
    private async readHeadOf (file: string): Promise<HeadInfo> {
        let fh: fs.promises.FileHandle | null = null
        try {
            fh = await fs.promises.open(file, 'r')
            const buf = Buffer.alloc(HEAD_BYTE_LIMIT)
            const { bytesRead } = await fh.read(buf, 0, HEAD_BYTE_LIMIT, 0)
            const text = buf.slice(0, bytesRead).toString('utf8')
            const lines = text.split('\n')
            if (bytesRead === HEAD_BYTE_LIMIT) {
                lines.pop()
            }
            return readHead(lines.slice(0, HEAD_LINE_LIMIT))
        } catch (e: any) {
            diagCatch(`세션 기록 앞부분 읽기 ${path.basename(file)}`, e)
            return { cwd: null, label: '', startedAt: null }
        } finally {
            await fh?.close().catch(() => { /* 이미 닫혔다 */ })
        }
    }

    // ── 조회 ────────────────────────────────────────────────────────────────

    /** 원장 + 디스크를 합친 전체 목록. 렌더 중에 불러도 막히지 않는다(캐시만 본다) */
    records (): SessionRecord[] {
        this.load()
        return mergeSessions([...this.ledger.values()], this.scanned)
    }

    async historySources (): Promise<HistorySource[]> {
        await this.refresh()
        return [...this.historyFiles]
    }

    /** 진단용 — `__agentdeck.sessions()` 가 보여준다 */
    snapshot (): { ledger: number, scanned: number, file: string, lastScan: number } {
        return {
            ledger: this.ledger.size,
            scanned: this.scanned.length,
            file: this.file,
            lastScan: this.lastScan,
        }
    }
}
