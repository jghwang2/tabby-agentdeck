#!/usr/bin/env node
/**
 * **버전의 단일 출처는 `package.json` 이다.** 이 스크립트가 나머지를 거기에 맞춘다.
 *
 *   node tools/sync-version.js          # 맞춘다 (빌드가 자동으로 부른다 — `prebuild`)
 *   node tools/sync-version.js --check  # 어긋난 곳만 알리고 고치지 않는다 (종료코드 1)
 *
 * 왜 필요한가 — 같은 버전을 네 곳이 각자 적고 있었고 그래서 전부 달랐다
 * (2026-09-11 실측: package.json `1.0.0` / package-lock `0.3.0` / 사용설명서 `0.17.0`,
 * 게다가 커밋된 값은 `0.17.0`). 사람이 릴리스 때 네 곳을 기억해서 고치는 방식은
 * 이미 실패한 것이 증명됐으므로, 적는 곳을 하나로 줄이고 나머지는 **파생**시킨다.
 *
 * 손대는 곳은 아래 `TARGETS` 가 전부다. 새로 버전을 박아야 할 파일이 생기면
 * 거기에 규칙을 한 줄 더하고, **문서·주석의 "0.18.0 부터 …" 같은 이력 표기는 건드리지 않는다** —
 * 그건 "지금 버전" 이 아니라 "그 기능이 언제 들어왔나" 라서 갱신 대상이 아니다.
 *
 * `src/diag.ts` 는 여기 없다. 그쪽은 런타임에 `package.json` 을 읽으므로(`pluginVersion`)
 * 이미 파생이고, 사본을 만들 이유가 없다.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const check = process.argv.includes('--check')

const pkgPath = path.join(root, 'package.json')
const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
if (!version) {
    console.error('package.json 에 version 이 없다')
    process.exit(2)
}

/** 버전이 유효한 모양인가 — 오타를 그대로 퍼뜨리지 않게 한 번 막는다 */
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`package.json 의 version 이 semver 모양이 아니다: ${version}`)
    process.exit(2)
}

/**
 * 고칠 곳. `apply(text, version)` 은 바뀐 텍스트를 돌려주고, 바꿀 것이 없으면 원본을 그대로 준다.
 * JSON 은 통째로 다시 쓰면 들여쓰기·키 순서가 흔들리므로 **필요한 값만** 바꾼다.
 */
const TARGETS = [
    {
        file: 'package-lock.json',
        apply: (text) => {
            const lock = JSON.parse(text)
            let dirty = false
            if (lock.version !== version) {
                lock.version = version
                dirty = true
            }
            // npm 7+ 는 루트 패키지를 `packages[""]` 에도 적는다 — 둘이 어긋나면 `npm ci` 가 경고한다
            if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) {
                lock.packages[''].version = version
                dirty = true
            }
            return dirty ? JSON.stringify(lock, null, 2) + '\n' : text
        },
    },
    // 웹 문서 4장. 마커로만 바꾼다 — 본문에 적힌 Tabby 버전(1.0.235)이나 이력 표기를 건드리면 안 된다.
    // 언어별로 파일이 갈려 있으므로 **한쪽만 갱신되는 일이 없게** 전부 여기 적는다.
    ...[
        'docs/index.html',      // 랜딩 (영문)
        'docs/ko.html',         // 랜딩 (한국어)
        'docs/guide/index.html', // 사용 설명서 (영문)
        'docs/guide/ko.html',    // 사용 설명서 (한국어)
    ].map(file => ({
        file,
        apply: (text) => text.replace(
            /(<span class="ad-version">)[^<]*(<\/span>)/g,
            `$1${version}$2`,
        ),
    })),
]

let changed = 0
let drifted = []
for (const t of TARGETS) {
    const full = path.join(root, t.file)
    let before
    try {
        before = fs.readFileSync(full, 'utf8')
    } catch {
        console.error(`건너뜀 (없는 파일): ${t.file}`)
        continue
    }
    const after = t.apply(before, version)
    if (after === before) {
        continue
    }
    drifted.push(t.file)
    if (!check) {
        fs.writeFileSync(full, after, 'utf8')
        changed++
    }
}

if (check) {
    if (drifted.length) {
        console.error(`버전이 어긋났다 (package.json = ${version}): ${drifted.join(', ')}`)
        console.error('고치려면: node tools/sync-version.js')
        process.exit(1)
    }
    console.log(`버전 일치 ${version}`)
} else {
    console.log(changed ? `버전 ${version} 로 맞춤: ${drifted.join(', ')}` : `버전 ${version} — 이미 일치`)
}
