// 버전의 단일 출처는 `package.json` 하나다. 고정하는 것은 두 가지 —
//  ① 파생되는 곳(package-lock, 사용설명서)이 그 값과 **어긋나 있지 않다**
//  ② 이력 표기("0.18.0 부터 …")는 갱신 대상이 **아니다** — 그건 지금 버전이 아니라 그 기능이 들어온 시점이다
//
// 왜 테스트까지 두나 — `prebuild` 가 매 빌드마다 맞춰 주지만, 빌드를 안 거친 채 손으로 고친 값이
// 그대로 커밋되는 길이 남아 있다. 2026-09-11 에 네 곳이 전부 다른 값이었던 것이 그렇게 생겼다
// (package.json 1.0.0 / package-lock 0.3.0 / 사용설명서 0.17.0 / 커밋된 값 0.17.0).
const fs = require('fs')
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

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const version = JSON.parse(read('package.json')).version

console.log('단일 출처')
check('package.json 의 version 이 semver 모양', /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version), true)

console.log('파생된 곳이 어긋나지 않았다')
const lock = JSON.parse(read('package-lock.json'))
check('package-lock 루트', lock.version, version)
check('package-lock packages[""]', lock.packages && lock.packages[''] && lock.packages[''].version, version)

// 웹 문서는 언어별로 갈려 있다. 한쪽만 갱신되고 다른 쪽이 옛 버전으로 남는 것이
// 이 테스트가 막아야 할 바로 그 드리프트이므로 **네 장을 전부** 잰다.
const WEB_DOCS = ['docs/index.html', 'docs/ko.html', 'docs/guide/index.html', 'docs/guide/ko.html']
for (const rel of WEB_DOCS) {
    const html = read(rel)
    const marks = [...html.matchAll(/<span class="ad-version">([^<]*)<\/span>/g)].map(m => m[1])
    // 마커가 사라지면 sync-version 이 아무것도 못 바꾸면서 조용히 성공한다 — 개수부터 본다
    check(`${rel} 에 버전 마커가 있다`, marks.length > 0, true)
    check(`${rel} 마커가 전부 일치`, marks.every(v => v === version), true)
}

console.log('이력 표기는 건드리지 않는다')
// 사용설명서 본문의 Tabby 버전은 우리 버전이 아니다 — sync 가 이것까지 바꾸면 거짓 정보가 된다
for (const rel of ['docs/guide/index.html', 'docs/guide/ko.html']) {
    check(`${rel} 의 Tabby 버전 표기는 그대로`, read(rel).includes('1.0.235'), true)
}

console.log(`\n${pass} ok, ${fail} fail`)
process.exit(fail ? 1 : 0)
