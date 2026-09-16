#!/usr/bin/env node
/**
 * **릴리스 한 곳** — 버전을 올리고, 맞추고, 재고, 커밋하고, 태그를 단다.
 *
 *   npm run release -- 1.1.3          # 버전을 박는다
 *   npm run release -- patch|minor|major
 *   npm run release -- 1.1.3 --dry-run   # 무엇을 할지만 보여준다
 *   npm run release -- 1.1.3 -m "제목"   # 커밋/태그 제목을 직접 준다
 *
 * 왜 필요한가 — 버전을 올리는 일이 여러 손으로 흩어져 있으면 반드시 어긋난다.
 * 이 저장소는 이미 두 번 겪었다:
 *  ① 같은 버전을 네 곳이 각자 적어 전부 달랐다 (package.json 1.0.0 / lock 0.3.0 / 설명서 0.17.0
 *    / 커밋된 값 0.17.0) → `tools/sync-version.js` 로 파생시켜 정리
 *  ② 태그는 v0.2.1 에서 멈춰 있었다 — 버전 커밋은 20개가 넘는데 (2026-09-11 소급 등록)
 * 둘 다 "사람이 릴리스 때 여러 곳을 기억해서 고친다" 는 방식이 실패한 것이다. 그래서 한 명령으로 묶는다.
 *
 * `npm version` 을 쓰지 않는 이유: 그쪽은 자기 커밋/태그를 자기 방식으로 만들고
 * 우리 파생 파일(`docs/guide`)은 모른다. 순서를 우리가 쥐어야 한다 —
 * **맞추고 → 재고 → 커밋한다.** 테스트가 깨지면 커밋도 태그도 만들지 않는다.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const mi = argv.indexOf('-m')
const message = mi >= 0 ? argv[mi + 1] : null
const target = argv.find(a => !a.startsWith('-') && a !== message)

const run = (cmd, args, opts) => execFileSync(cmd, args, {
    cwd: root, encoding: 'utf8', stdio: opts?.quiet ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024, ...opts,
})
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

function die (msg) {
    console.error(`릴리스 중단: ${msg}`)
    process.exit(1)
}

if (!target) {
    die('올릴 버전을 달라 — `npm run release -- 1.1.3` 또는 patch|minor|major')
}

const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const current = pkg.version

/** `patch`/`minor`/`major` 를 실제 숫자로 (프리릴리스는 다루지 않는다 — 필요해지면 그때) */
function bump (from, kind) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(from)
    if (!m) {
        die(`지금 버전이 semver 가 아니다: ${from}`)
    }
    let [, a, b, c] = m.map(Number)
    if (kind === 'major') { return `${a + 1}.0.0` }
    if (kind === 'minor') { return `${a}.${b + 1}.0` }
    return `${a}.${b}.${c + 1}`
}

const next = ['patch', 'minor', 'major'].includes(target) ? bump(current, target) : target
if (!/^\d+\.\d+\.\d+$/.test(next)) {
    die(`버전 모양이 아니다: ${next}`)
}
if (next === current) {
    die(`지금과 같은 버전이다: ${next}`)
}

// ── 나가기 전 검사 ──────────────────────────────────────────────────────────
// 태그는 되돌리기 번거로우므로 막을 것은 미리 막는다.
const tags = out('git', ['tag', '-l']).split('\n').filter(Boolean)
if (tags.includes(`v${next}`)) {
    die(`태그 v${next} 가 이미 있다`)
}
// 커밋할 것이 이 릴리스뿐이어야 한다 — 남의 작업이 딸려 들어가면 태그가 무엇을 가리키는지 흐려진다
const dirty = out('git', ['status', '--porcelain'])
if (dirty) {
    console.error('작업트리에 커밋 안 된 변경이 있다:')
    console.error(dirty)
    die('먼저 커밋하거나 되돌릴 것 (릴리스 커밋은 버전 변경만 담는다)')
}

const subject = message || `${next} 릴리스`
console.log(`릴리스 ${current} -> ${next}${dryRun ? '  (dry-run)' : ''}`)
console.log(`  제목: ${subject}`)
if (dryRun) {
    console.log('  1) package.json 버전 변경')
    console.log('  2) tools/sync-version.js (package-lock · 사용설명서)')
    console.log('  3) npm test')
    console.log('  4) npm run build')
    console.log(`  5) git commit -am "${subject}"`)
    console.log(`  6) git tag -a v${next}`)
    process.exit(0)
}

// ── 1) 버전을 박는다 ────────────────────────────────────────────────────────
pkg.version = next
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

// ── 2) 파생시킨다 ───────────────────────────────────────────────────────────
run(process.execPath, [path.join(__dirname, 'sync-version.js')])

// ── 3~4) 재고 짓는다. 여기서 깨지면 커밋도 태그도 없다 ──────────────────────
try {
    run('npm.cmd', ['test'])
    run('npm.cmd', ['run', 'build'])
} catch {
    // 되돌린다 — 반쯤 올라간 버전이 작업트리에 남으면 다음 사람이 그걸 밟는다
    console.error('\n테스트/빌드 실패 — 버전 변경을 되돌린다')
    run('git', ['checkout', '--', 'package.json', 'package-lock.json', 'docs/guide/index.html'], { quiet: true })
    die('고치고 다시 실행할 것')
}

// ── 5~6) 커밋 + 태그 ────────────────────────────────────────────────────────
run('git', ['commit', '-am', subject])
run('git', ['tag', '-a', `v${next}`, '-m', subject])

console.log(`\n완료: ${out('git', ['log', '-1', '--format=%h %s'])}  /  태그 v${next}`)
console.log('다음: npm publish   (푸시는 원격이 붙어 있을 때 `git push --follow-tags`)')
