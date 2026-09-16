// Codex 훅 — `config.toml` 의 신뢰/활성 상태 읽기 (`npm test`)
//
// **왜 파일을 만들어 재나** — `codexDisabledEvents` 는 `CODEX_HOME` 아래 `config.toml` 을 읽는다.
// 진짜 파일로 재면 그날 Codex 가 무엇을 켜 뒀느냐에 따라 결과가 바뀌어 회귀가 못 된다
// (2026-09-15 실측: 오전에는 셋이 꺼져 있었고 오후에는 전부 켜져 있었다).
// 그래서 임시 폴더에 원하는 상태를 적어 두고 그것을 읽힌다.
//
// 여기서 지키는 것은 셋이다.
//  ① **TOML 의 두 가지 문자열 표기를 다 읽는다** — 리터럴 `'C:\…'` 과 기본 `"C:\\…"`.
//     Codex 는 둘 다 쓰는데, 한쪽만 알던 정규식이 조용히 0건을 돌려줬다.
//  ② **우리 훅만 센다** — 남의 `hooks.json` 이나 우리가 설치하지 않은 이벤트를 집으면
//     설정 화면이 "AgentDeck 훅이 꺼져 있다" 고 거짓말한다.
//  ③ 경로에 `:` 가 들어 있어도(`C:\…`) 이벤트를 제대로 떼어낸다.
const fs = require('fs')
const os = require('os')
const path = require('path')

let pass = 0
let fail = 0

function check (name, got, want) {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    if (g === w) {
        console.log(`  ok   ${name}`)
        pass++
    } else {
        console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`)
        fail++
    }
}

/** 임시 CODEX_HOME 을 만들고 그 안에서 모듈을 새로 읽는다 (경로는 모듈 로드 때가 아니라 호출 때 정해진다) */
function withConfig (toml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-codexcfg-'))
    fs.writeFileSync(path.join(dir, 'config.toml'), toml, 'utf8')
    const saved = process.env.CODEX_HOME
    process.env.CODEX_HOME = dir
    try {
        const m = require('../.tmp/codexHooks.js')
        return m.codexDisabledEvents()
    } finally {
        if (saved === undefined) { delete process.env.CODEX_HOME } else { process.env.CODEX_HOME = saved }
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

/** 임시 폴더의 `hooks.json` 경로를 TOML 두 표기로 각각 적어 준다 */
function keyOf (dir, event, style) {
    const p = path.join(dir, 'hooks.json')
    return style === 'literal'
        ? `'${p}:${event}:0:0'`
        : `"${p.replace(/\\/g, '\\\\')}:${event}:0:0"`
}

// 임시 폴더 경로를 미리 알아야 키를 적을 수 있어, 만들고 → 적고 → 읽는 순서로 직접 돈다
function run (style, entries) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-codexcfg-'))
    const lines = ['[features]', 'hooks = true', '']
    for (const [event, enabled, other] of entries) {
        const p = other ? path.join(dir, 'other', 'hooks.json') : path.join(dir, 'hooks.json')
        const key = style === 'literal'
            ? `'${p}:${event}:0:0'`
            : `"${p.replace(/\\/g, '\\\\')}:${event}:0:0"`
        lines.push(`[hooks.state.${key}]`)
        lines.push('trusted_hash = "sha256:deadbeef"')
        if (!enabled) { lines.push('enabled = false') }
        lines.push('')
    }
    fs.writeFileSync(path.join(dir, 'config.toml'), lines.join('\r\n'), 'utf8')
    const saved = process.env.CODEX_HOME
    process.env.CODEX_HOME = dir
    try {
        delete require.cache[require.resolve('../.tmp/codexHooks.js')]
        return require('../.tmp/codexHooks.js').codexDisabledEvents()
    } finally {
        if (saved === undefined) { delete process.env.CODEX_HOME } else { process.env.CODEX_HOME = saved }
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

// ── ① 두 표기 모두 읽는다 ────────────────────────────────────────────────────
for (const style of ['literal', 'basic']) {
    check(`${style} 표기 — 꺼진 것만 골라낸다`,
        run(style, [['user_prompt_submit', false], ['pre_tool_use', true], ['stop', false]]),
        ['user_prompt_submit', 'stop'])
    check(`${style} 표기 — 전부 켜져 있으면 빈 목록`,
        run(style, [['user_prompt_submit', true], ['stop', true]]), [])
}

// ── ② 우리 것만 센다 ────────────────────────────────────────────────────────
check('남의 hooks.json 항목은 무시한다',
    run('basic', [['user_prompt_submit', false, true], ['stop', false]]), ['stop'])
// `session_start` 는 Codex 가 스스로 적지만 우리가 설치하는 이벤트가 아니다 (`CODEX_EVENTS`)
check('우리가 설치하지 않는 이벤트는 무시한다 (session_start)',
    run('basic', [['session_start', false], ['stop', false]]), ['stop'])

// ── ③ 경로의 콜론에 속지 않는다 ──────────────────────────────────────────────
// 키는 `C:\…\hooks.json:stop:0:0` 이라 앞에서 자르면 드라이브 문자에서 끊긴다
check('드라이브 문자의 콜론을 이벤트로 오인하지 않는다',
    run('literal', [['stop', false]]), ['stop'])

// ── 파일이 없으면 조용히 빈 목록 (모르는 것을 경고로 만들지 않는다) ──────────
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-codexcfg-'))
    const saved = process.env.CODEX_HOME
    process.env.CODEX_HOME = dir
    delete require.cache[require.resolve('../.tmp/codexHooks.js')]
    const got = require('../.tmp/codexHooks.js').codexDisabledEvents()
    if (saved === undefined) { delete process.env.CODEX_HOME } else { process.env.CODEX_HOME = saved }
    fs.rmSync(dir, { recursive: true, force: true })
    check('config.toml 이 없으면 빈 목록 (Codex 를 아직 안 띄웠다)', got, [])
}

console.log(`\ncodexHooks: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
