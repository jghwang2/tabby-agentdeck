// 릴리스 태그. 고정하는 것은 두 가지 —
//  ① 태그가 가리키는 커밋의 `package.json` 버전이 **태그 이름과 같다**
//  ② 커밋된 버전에는 태그가 **빠져 있지 않다** (지금 작업 중인 버전은 예외 — 아직 커밋 전일 수 있다)
//
// 왜 테스트로 두나 — 태그는 v0.2.1 에서 멈춘 채 버전 커밋만 20개 넘게 쌓여 있었다(2026-09-11 소급 등록).
// `tools/release.js` 가 앞으로는 자동으로 달지만, 손으로 버전을 올리는 길이 여전히 열려 있다.
// 그 길로 갔을 때 조용히 넘어가지 않게 여기서 막는다.
//
// git 이 없는 환경(배포본 압축 해제본 등)에서는 **건너뛴다** — 없는 것을 실패로 세지 않는다.
const { execFileSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name} -> ${JSON.stringify(got)}`)
        pass++
    } else {
        console.log(`  FAIL ${name} -> ${JSON.stringify(got)} (기대: ${JSON.stringify(want)})`)
        fail++
    }
}

// 셸을 거치지 않는다 — `^{commit}` 의 `^` 가 cmd 에서 이스케이프로 먹힌다 (2026-09-11 실측)
const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
}).trim()

let tags
try {
    git('rev-parse', '--git-dir')
    tags = git('tag', '-l').split('\n').filter(Boolean)
} catch {
    console.log('  skip 저장소가 아니다 (git 없음) — 태그 검사를 건너뛴다')
    console.log('\n0 ok, 0 fail')
    process.exit(0)
}

console.log('태그와 버전이 맞는가')
const mismatched = []
const tagged = new Set()
for (const t of tags) {
    if (!/^v\d+\.\d+\.\d+$/.test(t)) {
        continue // 릴리스 태그가 아닌 것은 이 규칙의 대상이 아니다
    }
    let v = null
    try {
        v = JSON.parse(git('show', `${t}^{commit}:package.json`)).version
    } catch {
        mismatched.push(`${t}: package.json 을 읽지 못했다`)
        continue
    }
    tagged.add(v)
    if (`v${v}` !== t) {
        mismatched.push(`${t} -> package.json ${v}`)
    }
}
check('태그 이름 = 그 커밋의 버전', mismatched.join(' / '), '')

console.log('커밋된 버전에 태그가 빠지지 않았는가')
// 각 버전을 **처음 들여온 커밋**이 릴리스 지점이다 (`tools/release.js` 와 같은 규칙)
const seen = new Set()
const untagged = []
for (const c of git('log', '--reverse', '--format=%H').split('\n').filter(Boolean)) {
    let v = null
    try {
        v = JSON.parse(git('show', `${c}:package.json`)).version
    } catch {
        continue
    }
    if (!v || seen.has(v)) {
        continue
    }
    seen.add(v)
    if (!tagged.has(v)) {
        untagged.push(`v${v} (${c.slice(0, 7)})`)
    }
}
check('태그 없는 릴리스 커밋', untagged.join(' / '), '')

console.log(`\n${pass} ok, ${fail} fail`)
process.exit(fail ? 1 : 0)
