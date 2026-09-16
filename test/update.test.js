// 자동 업데이트 판단 규칙. 고정하는 것은 다섯 가지 —
//  ① semver 비교가 맞다 (10 > 9, 프리릴리스 < 정식)
//  ② 읽을 수 없는 버전은 **비교하지 않는다** — 모르면 업데이트를 강행하지 않는다
//  ③ 확인 간격을 지킨다 (시계가 뒤로 가도 멈추지 않는다)
//  ④ **개발 설치에는 설치하지 않는다** — npm 이 작업 중인 소스 트리를 덮어쓴다
//  ⑤ 레지스트리를 못 읽으면 `unknown` 이지 `up-to-date` 가 아니다
//  ⑥ **설치 성공은 디스크의 버전으로만 인정한다** — 그래야 안 바뀐 채 창을 리로드하지 않는다
const { parseVersion, compareVersions, isNewer, parseLatestVersion, latestUrl,
    shouldCheck, canSelfUpdate, decide, installSucceeded, DEFAULT_REGISTRY, PACKAGE_NAME } = require('../.tmp/update.js')

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

// ---------- ① semver ----------
console.log('버전 읽기')
check('평범한 버전', JSON.stringify(parseVersion('1.2.3')), JSON.stringify({ nums: [1, 2, 3], pre: null }))
check('v 접두 허용', parseVersion('v1.2.3') !== null, true)
check('프리릴리스', parseVersion('1.2.3-beta.1').pre, 'beta.1')
check('빌드 메타는 버린다', parseVersion('1.2.3+build.5').pre, null)
check('네 자리는 아니다', parseVersion('1.2.3.4'), null)
check('문자열이 아님', parseVersion(null), null)
check('빈 값', parseVersion(''), null)

console.log('버전 비교')
check('같다', compareVersions('1.1.0', '1.1.0'), 0)
// 문자열 비교로 짜면 "1.9.0" > "1.10.0" 이 된다 — 숫자로 봐야 한다
check('minor 두 자리', compareVersions('1.9.0', '1.10.0'), -1)
check('patch', compareVersions('1.1.1', '1.1.0'), 1)
check('major', compareVersions('2.0.0', '1.99.99'), 1)
check('프리릴리스 < 정식', compareVersions('1.1.0-beta', '1.1.0'), -1)
check('정식 > 프리릴리스', compareVersions('1.1.0', '1.1.0-beta'), 1)
check('프리릴리스끼리 숫자', compareVersions('1.1.0-beta.2', '1.1.0-beta.10'), -1)
check('프리릴리스끼리 문자', compareVersions('1.1.0-alpha', '1.1.0-beta'), -1)
check('짧은 쪽이 낮다', compareVersions('1.1.0-beta', '1.1.0-beta.1'), -1)

// ---------- ② 모르면 건드리지 않는다 ----------
console.log('읽을 수 없는 값')
check('비교 불가', compareVersions('1.1.0', 'latest'), null)
check('isNewer 는 false', isNewer('1.1.0', 'latest'), false)
check('현재 버전을 모를 때도 false', isNewer('unknown', '9.9.9'), false)
check('정상일 때만 true', isNewer('1.1.0', '1.1.1'), true)

console.log('레지스트리 응답 파싱')
check('정상', parseLatestVersion('{"name":"tabby-agentdeck","version":"1.2.0"}'), '1.2.0')
check('JSON 이 아님 (프록시 HTML)', parseLatestVersion('<html>403</html>'), null)
check('version 없음', parseLatestVersion('{"name":"x"}'), null)
check('버전 모양이 아님', parseLatestVersion('{"version":"latest"}'), null)

console.log('조회 주소')
check('기본 레지스트리', latestUrl(null), `${DEFAULT_REGISTRY}/${PACKAGE_NAME}/latest`)
check('끝 슬래시 정리', latestUrl('https://reg.example.com/'), `https://reg.example.com/${PACKAGE_NAME}/latest`)
check('사내 미러', latestUrl('http://npm.local:4873'), `http://npm.local:4873/${PACKAGE_NAME}/latest`)

// ---------- ③ 확인 간격 ----------
console.log('확인 간격')
const NOW = 1700000000000
const H = 3600000
check('한 번도 안 물어봤으면 확인', shouldCheck(0, NOW, 6), true)
check('간격 안이면 안 함', shouldCheck(NOW - 1 * H, NOW, 6), false)
check('간격을 넘었으면 확인', shouldCheck(NOW - 7 * H, NOW, 6), true)
check('정확히 간격이면 확인', shouldCheck(NOW - 6 * H, NOW, 6), true)
// 시계가 뒤로 가면(시간대 변경·NTP 보정) 기록이 미래가 된다 — 영영 안 묻는 상태로 굳지 않게
check('기록이 미래면 확인', shouldCheck(NOW + 100 * H, NOW, 6), true)
check('간격 0 이면 항상', shouldCheck(NOW, NOW, 0), true)
check('쓰레기 값은 0 취급', shouldCheck('어제', NOW, 6), true)

// ---------- ④ 개발 설치 보호 ----------
console.log('개발 설치 보호')
const clean = { hasSrc: false, hasGit: false, hasWebpackConfig: false, isLink: false }
check('배포본은 갈아끼울 수 있다', canSelfUpdate(clean), true)
// npm 이 소스 트리를 덮어쓰는 사고를 막는 가드다 — 하나라도 걸리면 손대지 않는다
check('src 가 있으면 안 된다', canSelfUpdate({ ...clean, hasSrc: true }), false)
check('.git 이 있으면 안 된다', canSelfUpdate({ ...clean, hasGit: true }), false)
check('webpack.config 가 있으면 안 된다', canSelfUpdate({ ...clean, hasWebpackConfig: true }), false)
check('링크(junction)면 안 된다', canSelfUpdate({ ...clean, isLink: true }), false)

// ---------- ⑤ 최종 판정 ----------
console.log('최종 판정')
const base = {
    enabled: true,
    lastCheckAt: 0,
    now: NOW,
    intervalHours: 6,
    devInstall: false,
    current: '1.1.0',
    latest: '1.1.1',
}
check('새 버전', decide(base), 'update-ready')
check('껐으면', decide({ ...base, enabled: false }), 'disabled')
check('아직 때가 아니면', decide({ ...base, lastCheckAt: NOW - 1 * H }), 'too-soon')
// 오프라인을 "최신" 으로 읽으면 영영 업데이트가 안 되는데 로그에는 정상으로 보인다
check('레지스트리를 못 읽었으면', decide({ ...base, latest: null }), 'unknown')
check('이미 최신', decide({ ...base, latest: '1.1.0' }), 'up-to-date')
check('레지스트리가 더 낮아도 건드리지 않는다', decide({ ...base, latest: '1.0.0' }), 'up-to-date')
check('개발 설치는 알리기만', decide({ ...base, devInstall: true }), 'dev-install')
check('개발 설치라도 최신이면 조용히', decide({ ...base, devInstall: true, latest: '1.1.0' }), 'up-to-date')
// 끈 것이 가장 먼저다 — 껐는데 네트워크를 건드리면 안 된다
check('껐으면 다른 조건보다 우선', decide({ ...base, enabled: false, latest: null }), 'disabled')

// ---------- ⑥ 설치 성공 판정 ----------
// npm 이 0 으로 끝나도 폴더가 안 바뀔 수 있다. 안 바뀐 채 창을 리로드하면 같은 버전이 다시 뜨면서
// "업데이트했다" 고 말하게 된다 — 그래서 판정 근거는 종료 코드가 아니라 **디스크의 버전**이다
console.log('설치 성공 판정')
check('디스크가 기대한 버전', installSucceeded('1.1.4', '1.1.4'), true)
check('디스크가 옛 버전이면 실패', installSucceeded('1.1.4', '1.1.3'), false)
check('디스크가 더 높아도 기대값과 다르면 실패', installSucceeded('1.1.4', '1.2.0'), false)
// package.json 을 못 읽었다(폴더가 반쯤 지워졌다·경로를 못 찾았다) — 리로드하면 안 된다
check('못 읽었으면 실패', installSucceeded('1.1.4', null), false)
check('쓰레기 값이면 실패', installSucceeded('1.1.4', 'latest'), false)
// 표기 흔들림(`v` 접두·공백)까지 실패로 보면 멀쩡한 설치를 버린다 — semver 비교에 맡긴다
check('v 접두는 같은 것으로 본다', installSucceeded('1.1.4', 'v1.1.4'), true)

console.log(`\n${pass} ok, ${fail} fail`)
process.exit(fail ? 1 : 0)
