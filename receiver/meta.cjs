// Receiver-owned metadata. Usage refresh is asynchronous in this process.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), https = require('node:https')
function createMetaProcessor (root, env) {
const ROOT = root
/** 사이드바가 읽는 곳. 상태 보고(`status/`)와 폴더를 나눈다 — 그쪽 폴링은 자기 형식만 알아본다 */
const META_DIR = path.join(ROOT, 'meta')
const INNER_FILE = path.join(ROOT, 'statusline-inner.json')
/** 모델별 주간 한도(Fable 등) 캐시 — stdin 에 없는 값이라 따로 물어본 것을 여기 둔다 */
const SCOPED_FILE = path.join(ROOT, 'scoped-limit.json')
/** 캐시를 낡았다고 보는 기준. statusLine 은 초 단위로 불리므로 매번 물어보면 안 된다 */
const SCOPED_TTL_MS = 60_000
/**
 * **못 받았을 때는 더 오래 쉰다.**
 *
 * 실패는 대개 곧 풀리지 않는다 — 토큰이 없거나(API 키·게이트웨이), 그 요금제에 모델별 한도가
 * 없거나, 레지스트리가 우리를 막은 경우다. 1분마다 두드리면 마지막 것은 **더 오래 막힌다**:
 * 2026-09-15 실측으로 이 API 가 실제로 429 를 돌려줬다(앞서 캐시 도장이 없어 렌더마다
 * 요청이 나가던 판의 결과다).
 */
const SCOPED_FAIL_TTL_MS = 10 * 60_000

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
                    configDir: dir,
                }
            }
        } catch {
            // 없거나 아직 못 읽는다 — 다음 후보로
        }
    }
    return { account: '', org: '', configDir: '' }
}

function pct (v) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
}

// ---------- 모델별 주간 한도 (Fable 등) ----------
//
// statusLine stdin 의 `rate_limits` 는 `five_hour` / `seven_day` 만 조립한다. 모델별 주간 한도
// (내부명 `seven_day_overage_included`, 화면 이름 `Fable`)는 **거기 없다** — 진본은
// `GET /api/oauth/usage` 의 `limits[]` 중 `kind=weekly_scoped` 다.
//
// 렌더를 막으면 안 되므로 **읽기는 캐시에서만** 한다. 캐시가 낡았으면 자기 자신을
// `--refresh-scoped` 로 떼어 내 띄우고(detached), 이번 렌더는 낡은 값 그대로 쓴다.
// 다음 렌더에 새 값이 들어온다 — statusLine 은 몇 초에 한 번씩 다시 불린다.

/** OAuth 토큰 — 계정 파일과 같은 후보 폴더를 본다 (탭마다 계정을 갈라 써도 맞는다) */
function readOauthToken () {
    const dirs = []
    if (env.CLAUDE_CONFIG_DIR) {
        dirs.push(env.CLAUDE_CONFIG_DIR)
    }
    dirs.push(path.join(os.homedir(), '.claude'), os.homedir())
    for (const dir of dirs) {
        try {
            const raw = fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8')
            const token = JSON.parse(raw)?.claudeAiOauth?.accessToken
            if (token) {
                return String(token)
            }
        } catch {
            // 없거나 못 읽는다 — 다음 후보로
        }
    }
    return ''
}

function readScopedCache () {
    try {
        return JSON.parse(fs.readFileSync(SCOPED_FILE, 'utf8'))
    } catch {
        return null
    }
}

/** 캐시가 낡았으면 갱신을 떼어 낸다 — 부모(이 렌더)는 기다리지 않는다 */
let refreshing = false
function armScopedRefresh (cache) {
    const ttl = cache && cache.ok === false ? SCOPED_FAIL_TTL_MS : SCOPED_TTL_MS
    if (refreshing || (cache && Date.now() - Number(cache.ts || 0) < ttl)) return
    refreshing = true
    refreshScoped().catch(() => {
        try { writeScoped(null, readScopedCache(), 'unhandled') } catch {}
    }).finally(() => { refreshing = false })
}

/**
 * 실제로 물어보고 캐시에 남긴다 (`--refresh-scoped` 로 따로 뜬 프로세스에서만 돈다).
 *
 * `fetch` 가 아니라 `node:https` 를 쓴다 — undici 는 응답을 다 읽은 뒤에도 소켓을 쥐고 있어서,
 * 다 쓰고 `process.exit` 하면 Windows 에서 libuv 가 죽는다 (실측: `Assertion failed:
 * !(handle->flags & UV_HANDLE_CLOSING)`, rc 127). 여기서는 응답이 끝나면 이벤트 루프가
 * 저절로 비어 프로세스가 정상 종료된다.
 */
function requestUsage (token) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            host: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers: {
                'authorization': `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'accept': 'application/json',
            },
            timeout: 10_000,
        }, res => {
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error('http ' + res.statusCode))
                    return
                }
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
                } catch (e) {
                    reject(e)
                }
            })
        })
        req.on('timeout', () => req.destroy(new Error('timeout')))
        req.on('error', reject)
        req.end()
    })
}

/**
 * 갱신 결과를 캐시에 남긴다.
 *
 * **못 받았을 때도 반드시 부른다.** `armScopedRefresh` 는 "캐시가 있고 TTL 안" 일 때만 건너뛰는데,
 * 실패했다고 아무것도 안 쓰면 캐시가 영원히 없어서 **statusLine 이 불릴 때마다**(초 단위)
 * 새 프로세스가 뜬다 — 토큰이 없는 계정(API 키·게이트웨이)에서는 영영 성공하지 못하므로
 * 그 상태가 계속된다 (2026-09-15 코드리뷰 지적).
 */
/**
 * **실패해도 마지막 정상값은 지운다 — 가 아니라 지킨다.** 예전에는 실패하면 이름·퍼센트를 빈 값으로
 * 덮어써서, 일시적 오류 한 번에 `Fable` 칸이 사라지고 실패 TTL(10분) 동안 빈 채로 있다가
 * 다음 성공에서야 돌아왔다 (2026-09-16 실측: 10:28 실패 → 10:38 복귀, 사용자 "왜 안 나오다 또
 * 나오나"). 몇 분 전 값이라도 빈 칸보다 낫다 — 한도는 분 단위로 크게 안 움직인다.
 * 그래서 `scoped` 가 없으면 `prev` 의 이름·퍼센트·리셋 시각을 그대로 옮기고, 도장(`ts`)과
 * 판정(`ok`)만 새로 찍는다. `ok:false` 는 여전히 재시도 간격을 가르는 데만 쓰인다.
 *
 * `err` 는 왜 비었는지 남기는 자리다 — 상태코드·타임아웃을 삼키면 이런 문제를 영영 못 찾는다.
 */
function writeScoped (scoped, prev, err) {
    const name = scoped ? (scoped.scope?.model?.display_name ?? scoped.scope?.model?.id ?? '') : ''
    // `resets_at` 은 여기서만 ISO 문자열이다 (stdin 쪽은 epoch 초) — 초로 맞춰 둔다
    const resetsAt = scoped ? Math.round(Date.parse(scoped.resets_at ?? '') / 1000) || 0 : 0
    const keep = !scoped && prev && prev.name ? prev : null
    fs.mkdirSync(ROOT, { recursive: true })
    const tmp = SCOPED_FILE + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({
        ts: Date.now(),
        // 다음 갱신 간격을 가르는 값 — 못 받았으면 오래 쉰다 (`armScopedRefresh`)
        ok: !!scoped,
        name: keep ? String(keep.name) : String(name),
        pct: keep ? keep.pct : (scoped ? pct(scoped.percent) : null),
        resetsAt: keep ? Number(keep.resetsAt) || 0 : resetsAt,
        // 실패 사유 (성공이면 비운다). 값을 지킨 경우 `stale: true` 로 표시만 해 둔다
        ...(scoped ? {} : { err: String(err ?? 'unknown'), stale: !!keep }),
    }), 'utf8')
    fs.renameSync(tmp, SCOPED_FILE)
}

async function refreshScoped () {
    const prev = readScopedCache()
    const token = readOauthToken()
    if (!token) {
        // 토큰이 없다 (로그인 안 함·API 키 사용) — 칸이 안 생길 뿐이지만 **도장은 찍는다**
        writeScoped(null, prev, 'no-token')
        return
    }
    let body
    try {
        body = await requestUsage(token)
    } catch (e) {
        // 네트워크·상태코드·타임아웃 — 마지막 정상값을 지키고 사유만 남긴다 (writeScoped 주석)
        writeScoped(null, prev, e?.message || 'request-failed')
        return
    }
    // 모델별 주간 한도는 여러 개일 수 있다 — 가장 많이 쓴 칸 하나만 보인다 (줄이 하나뿐이다)
    const scoped = (Array.isArray(body?.limits) ? body.limits : [])
        .filter(l => l?.kind === 'weekly_scoped')
        .sort((a, b) => Number(b?.percent ?? 0) - Number(a?.percent ?? 0))[0]
    // 모델별 한도가 없는 요금제도 있다 — 그때도 도장을 찍어야 다시 묻지 않는다.
    // 이 경우는 실패가 아니라 "없다" 가 답이므로 옛 값을 지키지 않는다 (prev 를 안 넘긴다)
    writeScoped(scoped ?? null, null, scoped ? undefined : 'no-scoped-limit')
}

/** stdin JSON 에서 사이드바가 쓸 것만 뽑는다 — 원문을 통째로 두면 대화 비용·경로까지 남는다 */
function snapshot (data, timestamp) {
    const model = data.model ?? {}
    const ctx = data.context_window ?? {}
    const lim = data.rate_limits ?? {}
    const { account, org, configDir } = readAccount()
    const scoped = readScopedCache()
    armScopedRefresh(scoped)
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
            scopedName: scoped?.name ?? '',
            scopedPct: scoped?.pct ?? null,
            scopedResetsAt: Number(scoped?.resetsAt) || 0,
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
