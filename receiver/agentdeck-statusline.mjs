/**
 * Claude Code statusLine 을 한 겹 감싸서, 그 stdin JSON 을 AgentDeck 사이드바로 넘긴다.
 *
 * 왜 감싸나 — 모델·effort·컨텍스트%·5h/7d 한도% 는 **statusLine stdin 에만** 내려온다.
 * 훅(JSON)에는 없고 대화기록(jsonl)에는 모델까지만 있다. 사이드바 하단의 "지금 이 탭" 줄이
 * 원하는 값이 전부 여기 있으므로, 이미 걸려 있는 statusLine 명령 앞에 이 스크립트를 끼워
 * 같은 stdin 을 그대로 흘려보내면서 한 벌 베껴 둔다.
 *
 * **이 스크립트의 첫 번째 계약은 "원래 statusLine 을 절대 죽이지 않는다" 이다.**
 * statusLine 은 사용자가 매 렌더마다 보는 것이라, 우리가 실패해도 안쪽 명령의 출력은
 * 그대로 나가야 한다. 그래서 베껴 쓰는 일은 전부 try/catch 로 감싸고, 종료코드도
 * 안쪽 명령의 것을 그대로 쓴다. 안쪽이 없거나 못 띄우면 조용히 아무것도 출력하지 않는다
 * (여기서 에러 문구를 뱉으면 그게 사용자의 statusLine 자리에 박힌다).
 *
 * 안쪽 명령은 설치할 때 `statusline-inner.json` 으로 옮겨 둔 **원래 설정 그대로**다
 * (src/statusLine.ts). 체인 순서는 상관없다 — 이 스크립트는 stdin 을 바꾸지 않고
 * stdout 을 건드리지 않으므로, 누가 우리를 또 감싸도 각 겹이 같은 JSON 을 본다.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import runtimePaths from './agentdeck-runtime.cjs'

const ROOT = runtimePaths.runtimeRoot()
/** 사이드바가 읽는 곳. 상태 보고(`status/`)와 폴더를 나눈다 — 그쪽 폴링은 자기 형식만 알아본다 */
const META_DIR = path.join(ROOT, 'meta')
const INNER_FILE = path.join(ROOT, 'statusline-inner.json')
function readStdin () {
    try {
        // fd 0 을 통째로 읽는다. Claude Code 는 JSON 한 덩이를 주고 stdin 을 닫는다
        return fs.readFileSync(0)
    } catch {
        return Buffer.alloc(0)
    }
}

/**
 * 계정 — statusLine stdin 에는 없다. 설정 파일에서 읽는다.
 *
 * `CLAUDE_CONFIG_DIR` 이 걸려 있으면 그 아래를 먼저 본다. 그 환경변수는 이 프로세스가
 * claude 에서 그대로 물려받은 것이라, **탭마다 계정을 갈라 쓰는 경우에도 이 값이 맞다.**
 * (`$CLAUDE_CONFIG_DIR/.claude.json` 위치는 근거 미확인이라 홈 폴더로 폴백한다.)
 */
function readAccount () {
    const dirs = []
    if (process.env.CLAUDE_CONFIG_DIR) {
        dirs.push(process.env.CLAUDE_CONFIG_DIR)
    }
    dirs.push(os.homedir())
    for (const dir of dirs) {
        try {
            const file = path.join(dir, '.claude.json')
            const acc = JSON.parse(fs.readFileSync(file, 'utf8'))?.oauthAccount
            if (acc?.emailAddress) {
                return {
                    account: String(acc.emailAddress),
                    org: acc.organizationName ? String(acc.organizationName) : '',
                    configDir: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
                }
            }
        } catch {
            // 없거나 아직 못 읽는다 — 다음 후보로
        }
    }
    return { account: '', org: '', configDir: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') }
}

function pct (v) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
}

// Usage API requests belong to the app refresh button, never to statusLine execution.
function snapshot (data) {
    const model = data.model ?? {}
    const ctx = data.context_window ?? {}
    const lim = data.rate_limits ?? {}
    const { account, org, configDir } = readAccount()
    return {
        sessionId: String(data.session_id ?? ''),
        ts: Number(process.env.AGENTDECK_EVENT_TS) || Date.now(),
        agent: 'claude',
        model: String(model.display_name ?? model.id ?? ''),
        modelId: String(model.id ?? ''),
        effort: String(data.effort?.level ?? ''),
        version: String(data.version ?? ''),
        fastMode: !!data.fast_mode,
        account,
        org,
        configDir,
        cwd: String(data.cwd ?? data.workspace?.current_dir ?? ''),
        contextPct: pct(ctx.used_percentage),
        limits: {
            fiveHourPct: pct(lim.five_hour?.used_percentage),
            fiveHourResetsAt: Number(lim.five_hour?.resets_at) || 0,
            sevenDayPct: pct(lim.seven_day?.used_percentage),
            sevenDayResetsAt: Number(lim.seven_day?.resets_at) || 0,
        },
    }
}

function writeSnapshot (raw) {
    const data = JSON.parse(raw.toString('utf8'))
    const snap = snapshot(data)
    if (!snap.sessionId) {
        return // 누구 것인지 모르면 쓰지 않는다 — 사이드바가 세션 id 로만 탭에 묶는다
    }
    fs.mkdirSync(META_DIR, { recursive: true })
    // 같은 파일을 사이드바가 400ms 마다 읽는다. 쓰다 만 파일을 읽히지 않도록 임시 파일 + rename
    const file = path.join(META_DIR, snap.sessionId + '.json')
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).ts >= snap.ts) return } catch {}
    const tmp = file + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(snap), 'utf8')
    fs.renameSync(tmp, file)
}

// Legacy refresh invocations are harmless; metadata writes never read tokens or call the network.
if (!process.argv.includes('--refresh-scoped')) {
    const raw = readStdin()
    try { writeSnapshot(raw) } catch { /* Metadata must never break the user's status line. */ }
}
