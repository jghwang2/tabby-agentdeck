// Receiver-owned passive metadata. Usage requests run only in the app.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
function createMetaProcessor (root, env) {
const ROOT = root
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
    if (env.CLAUDE_CONFIG_DIR) {
        dirs.push(env.CLAUDE_CONFIG_DIR)
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
                    configDir: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
                }
            }
        } catch {
            // 없거나 아직 못 읽는다 — 다음 후보로
        }
    }
    return { account: '', org: '', configDir: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') }
}

function pct (v) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
}

// Usage API requests belong to the app refresh button, never to statusLine execution.
function snapshot (data, timestamp) {
    const model = data.model ?? {}
    const ctx = data.context_window ?? {}
    const lim = data.rate_limits ?? {}
    const { account, org, configDir } = readAccount()
    return {
        sessionId: String(data.session_id ?? ''),
        ts: Number(timestamp) || Date.now(),
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

function writeSnapshot (raw, timestamp) {
    const data = JSON.parse(raw.toString('utf8'))
    const snap = snapshot(data, timestamp)
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


return { writeSnapshot }
}
module.exports = { createMetaProcessor }
