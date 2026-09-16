#!/usr/bin/env node
/**
 * 배포 번들에 개발 전용 코드가 섞였는지 본다 — `npm pack`(prepack)에서 `build:release` 직후 돈다.
 *
 * 개발용 라이브 리로드(src/devReload.service.ts)는 GitHub 에는 올리되 npm 에는 싣지 않는다.
 * webpack `--env release` 가 스텁으로 바꿔 끼우는데, 그 교체가 조용히 깨지면(파일명 변경,
 * import 경로 변경) 개발 코드가 그대로 배포된다. 그래서 결과물을 직접 뒤져 막는다.
 */
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'dist', 'index.js')
// 원본 서비스에만 있는 문자열들 (DEV_BUILD_MARKER · 감시 진단 줄).
// **리로드 자체는 배포본에도 있다** — 자동 업데이트가 그 길로 갈아끼운다(`reload.service.ts`).
// 여기서 막는 것은 "언제 리로드할까" 를 정하는 개발 전용 장치뿐이다.
//
// 옛 짐 키(`agentdeck.devReload`)는 **일부러 뺐다** — 배포본이 그 키를 읽어야 한다.
// 옛 판이 그 이름으로 써 둔 짐을 새 판이 못 읽으면 업데이트 한 번에 탭이 통째로 날아간다
// (`reload.service.ts` 의 `LEGACY_STASH_KEY`).
const FORBIDDEN = ['agentdeck-dev-reload', 'dev-reload watching']

// **소스맵이 남아 있으면 막는다.** 릴리스 빌드는 맵을 만들지 않지만(`webpack.config.js`
// `devtool: env.release ? false : 'source-map'`) **옛 맵을 지우지도 않는다** — 직전에 개발
// 빌드를 돌렸으면 그 산출물이 `dist/` 에 그대로 남아 있고, `npm pack` 은 디스크에 있는 것을
// 담으므로 그대로 실려 나간다. 맵에는 `sourcesContent` 로 원본 전문이 들어 있어서,
// 번들에서 주석을 지운 것이 무의미해진다
const map = file + '.map'
if (fs.existsSync(map)) {
    fs.rmSync(map)
    console.log('check-release: 남아 있던 소스맵을 지웠다 (개발 빌드 산출물)')
}

const text = fs.readFileSync(file, 'utf8')
const hits = FORBIDDEN.filter(s => text.includes(s))
if (hits.length) {
    console.error(`check-release: FAIL — 배포 번들에 개발 전용 코드가 들어 있다: ${hits.join(', ')}`)
    console.error('  webpack.config.js 의 NormalModuleReplacementPlugin 교체가 먹었는지 확인할 것')
    process.exit(1)
}
console.log(`check-release: OK (${Math.round(text.length / 1024)}KB, 개발 전용 코드 없음)`)
