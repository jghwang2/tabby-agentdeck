// profile.service.ts — "새 탭은 항상 작업 루트에서" 를 위해 Tabby 프로필을 하나 심는 규칙.
//
// 왜 여기 테스트가 붙나: 이 파일은 `@Injectable` 데코레이터만 Angular 것이고(tabby-core 는 타입
// 전용 import 라 컴파일 결과에 require 가 남지 않는다) 만지는 것은 넘겨받은 `config.store` 객체
// 뿐이다. 가짜 config 하나로 그대로 돈다. (TS private 은 컴파일된 JS 에 남지 않아 직접 부른다)
//
// 여기서 틀리면 사용자가 다치는 지점 —
//  ① 설정 UI 에서 손으로 고친 command/args/env 를 매 기동마다 덮어쓴다 (되돌릴 방법이 없다)
//  ② 경로를 안 정했는데 프로필을 심어 남의 홈 디렉토리에서 셸이 열린다
//  ③ 기본 프로필을 매 기동 다시 차지해, 사용자가 다른 프로필로 바꿔도 계속 되돌아온다
const { AgentDeckProfileService, ROOT_PROFILE_ID } = require('../.tmp/profile.service.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name} -> ${got}`)
        pass++
    } else {
        console.log(`  FAIL ${name} -> ${got} (기대: ${want})`)
        fail++
    }
}

/** config.store 흉내 — save() 횟수를 센다 (config.yaml 쓰기 = 사용자 파일 건드리기) */
function fakeConfig (agentDeck, profiles) {
    const cfg = {
        saves: 0,
        store: {
            agentDeck,
            profiles: profiles ?? [],
            terminal: {},
        },
        save () { cfg.saves++ },
    }
    return cfg
}

function run (cfg) {
    // app 은 init() 의 ready$ 구독에만 쓰이므로 ensureProfile 에는 필요 없다
    new AgentDeckProfileService({}, cfg).ensureProfile()
    return cfg
}

check('프로필 id 는 고정 (바뀌면 기존 사용자에게 두 번째 프로필이 생긴다)', ROOT_PROFILE_ID, 'agentdeck:root')

// 전수①: 심을 조건 — rootProfile(기능 on) x rootProfileCwd(경로 정함) 네 조합.
// 둘 다 갖춰야 심는다. 경로 없이 심으면 셸이 엉뚱한 폴더에서 열린다
{
    const bad = []
    let calls = 0
    for (const on of [false, true]) {
        for (const cwd of ['', 'D:/Project']) {
            const cfg = run(fakeConfig({ rootProfile: on, rootProfileCwd: cwd }))
            calls++
            const made = cfg.store.profiles.length
            const want = on && cwd ? 1 : 0
            if (made !== want) {
                bad.push(`on=${on} cwd=${JSON.stringify(cwd)}: ${made}개 (기대 ${want})`)
            }
            if (want === 0 && cfg.saves !== 0) {
                bad.push(`on=${on} cwd=${JSON.stringify(cwd)}: 안 심었는데 저장했다`)
            }
        }
    }
    check('전수①: 조건 조합 수 (기능 on/off x 경로 있음/없음)', calls, 4)
    check('전수①: 기능이 켜지고 경로가 있을 때만 심는다', bad.length ? bad[0] : 0, 0)
}

// ── 처음 심을 때의 모양 ─────────────────────────────────────────────────────
{
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass']
    const env = { FORCE_COLOR: '1' }
    const cfg = run(fakeConfig({
        rootProfile: true,
        rootProfileCwd: 'D:/Project',
        rootProfileName: '',
        rootProfileCommand: '',
        rootProfileArgs: args,
        rootProfileEnv: env,
    }))
    const p = cfg.store.profiles[0]
    check('id', p.id, ROOT_PROFILE_ID)
    check('type 은 local', p.type, 'local')
    check('이름이 비면 기본 이름', p.name, 'Agent Root')
    check('명령이 비면 powershell.exe', p.options.command, 'powershell.exe')
    check('cwd 는 설정한 경로', p.options.cwd, 'D:/Project')
    check('args 는 설정값 그대로', p.options.args.join(' '), '-NoProfile -ExecutionPolicy Bypass')
    // 복사해서 넣어야 한다 — 참조를 공유하면 프로필을 고치는 순간 agentDeck 설정까지 바뀐다
    check('args 는 복사본 (설정 원본과 참조 공유 금지)', p.options.args !== args, true)
    check('env 는 복사본', p.options.env !== env, true)
    check('env 값은 그대로', p.options.env.FORCE_COLOR, '1')
    check('심었으면 한 번 저장', cfg.saves, 1)
    // 최초 1회만 기본 프로필로 차지한다
    check('기본 프로필로 지정', cfg.store.terminal.profile, ROOT_PROFILE_ID)
    check('차지했음을 기록 (다시 차지하지 않기 위해)', cfg.store.agentDeck.rootProfileClaimed, true)
}

// 이미 사용자가 기본 프로필을 정한 적이 있으면(claimed) 건드리지 않는다
{
    const cfg = fakeConfig({ rootProfile: true, rootProfileCwd: 'D:/Project', rootProfileClaimed: true })
    cfg.store.terminal.profile = 'user-choice'
    run(cfg)
    check('이미 차지한 적 있으면 기본 프로필을 안 바꾼다', cfg.store.terminal.profile, 'user-choice')
    check('그래도 프로필 자체는 심는다', cfg.store.profiles.length, 1)
}

// ── 두 번째 기동: 사용자가 손댄 값은 그대로 둔다 ────────────────────────────
{
    const cfg = fakeConfig({
        rootProfile: true,
        rootProfileCwd: 'D:/Project',
        rootProfileCommand: 'powershell.exe',
        rootProfileArgs: ['-NoProfile'],
        rootProfileEnv: { FORCE_COLOR: '1' },
    })
    run(cfg)
    const p = cfg.store.profiles[0]
    // 사용자가 설정 UI 에서 고쳤다고 하자
    p.name = '내 루트'
    p.options.command = 'pwsh.exe'
    p.options.args = ['-NoLogo']
    p.options.env = { FORCE_COLOR: '0' }
    const savesBefore = cfg.saves
    run(cfg)
    check('사용자가 고친 명령은 유지', p.options.command, 'pwsh.exe')
    check('사용자가 고친 인자는 유지', p.options.args.join(' '), '-NoLogo')
    check('사용자가 고친 env 값은 유지', p.options.env.FORCE_COLOR, '0')
    check('사용자가 고친 이름은 유지', p.name, '내 루트')
    check('프로필이 하나 더 생기지 않는다', cfg.store.profiles.length, 1)
    check('바꾼 게 없으면 저장도 하지 않는다', cfg.saves, savesBefore)
}

// 전수②: 빈 값만 보정한다 — cwd/args 가 비었나 채워졌나 네 조합
{
    const bad = []
    let calls = 0
    for (const hasCwd of [false, true]) {
        for (const hasArgs of [false, true]) {
            const cfg = fakeConfig({
                rootProfile: true,
                rootProfileCwd: 'D:/Project',
                rootProfileArgs: ['-NoProfile'],
                rootProfileClaimed: true,
            }, [{
                id: ROOT_PROFILE_ID,
                type: 'local',
                name: 'keep',
                options: {
                    command: 'pwsh.exe',
                    cwd: hasCwd ? 'E:/Other' : '',
                    args: hasArgs ? ['-NoLogo'] : [],
                },
            }])
            run(cfg)
            calls++
            const o = cfg.store.profiles[0].options
            const wantCwd = hasCwd ? 'E:/Other' : 'D:/Project'
            const wantArgs = hasArgs ? '-NoLogo' : '-NoProfile'
            const dirty = !hasCwd || !hasArgs
            if (o.cwd !== wantCwd) {
                bad.push(`cwd=${hasCwd} args=${hasArgs}: cwd ${o.cwd} (기대 ${wantCwd})`)
            }
            if (o.args.join(' ') !== wantArgs) {
                bad.push(`cwd=${hasCwd} args=${hasArgs}: args ${o.args.join(' ')} (기대 ${wantArgs})`)
            }
            if (o.command !== 'pwsh.exe') {
                bad.push(`cwd=${hasCwd} args=${hasArgs}: 명령을 덮었다`)
            }
            if ((cfg.saves > 0) !== dirty) {
                bad.push(`cwd=${hasCwd} args=${hasArgs}: 저장 ${cfg.saves} (보정 필요 ${dirty})`)
            }
        }
    }
    check('전수②: 보정 조합 수 (cwd 있음/없음 x args 있음/없음)', calls, 4)
    check('전수②: 빈 값만 채우고, 채운 게 있을 때만 저장', bad.length ? bad[0] : 0, 0)
}

// env 는 키 단위로 — 사용자가 지정한 키는 덮지 않고 빠진 키만 채운다
{
    const cfg = fakeConfig({
        rootProfile: true,
        rootProfileCwd: 'D:/Project',
        rootProfileEnv: { FORCE_COLOR: '1', TERM: 'xterm-256color' },
        rootProfileClaimed: true,
    }, [{
        id: ROOT_PROFILE_ID,
        type: 'local',
        options: { command: 'pwsh.exe', cwd: 'D:/Project', args: ['-NoLogo'], env: { FORCE_COLOR: '0' } },
    }])
    run(cfg)
    const env = cfg.store.profiles[0].options.env
    check('사용자가 지정한 env 키는 그대로', env.FORCE_COLOR, '0')
    check('빠진 env 키만 채운다', env.TERM, 'xterm-256color')
    check('env 를 채웠으면 저장', cfg.saves, 1)
}

// options 자체가 없는 프로필(낡은 config 나 손편집)도 살려낸다 — 없으면 셸 기동이 실패한다
{
    const cfg = fakeConfig({
        rootProfile: true,
        rootProfileCwd: 'D:/Project',
        rootProfileClaimed: true,
    }, [{ id: ROOT_PROFILE_ID, type: 'local' }])
    run(cfg)
    check('options 가 없으면 통째로 채운다', cfg.store.profiles[0].options.cwd, 'D:/Project')
    check('options 를 채웠으면 저장', cfg.saves, 1)
}

// 남의 프로필은 건드리지 않는다 — id 로만 자기 것을 찾는다
{
    const mine = { id: 'user-ssh', type: 'ssh', options: { host: 'box' } }
    const cfg = fakeConfig({ rootProfile: true, rootProfileCwd: 'D:/Project' }, [mine])
    run(cfg)
    check('남의 프로필은 그대로', JSON.stringify(cfg.store.profiles[0]), JSON.stringify(mine))
    check('내 프로필은 뒤에 추가', cfg.store.profiles[1].id, ROOT_PROFILE_ID)
    check('총 두 개', cfg.store.profiles.length, 2)
}

// profiles 키가 아직 없는 config (첫 기동)
{
    const cfg = fakeConfig({ rootProfile: true, rootProfileCwd: 'D:/Project' })
    cfg.store.profiles = undefined
    run(cfg)
    check('profiles 가 없으면 만들어 넣는다', cfg.store.profiles.length, 1)
}

{
    const cfg = fakeConfig({ rootProfile: true, rootProfileCwd: 'D:/Old', rootProfileName: 'Work' })
    run(cfg)
    const profile = cfg.store.profiles[0]
    profile.options.env = { KEEP: 'yes' }
    profile.options.args = ['-NoLogo']
    cfg.store.agentDeck.rootProfileCwd = 'E:/New'
    new AgentDeckProfileService({}, cfg).applySettings()
    check('Explicit settings edit updates an existing working folder', profile.options.cwd, 'E:/New')
    check('Explicit folder edit preserves shell arguments', profile.options.args[0], '-NoLogo')
    check('Explicit folder edit preserves environment', profile.options.env.KEEP, 'yes')
    check('Explicit folder edit does not duplicate profiles', cfg.store.profiles.length, 1)
}

console.log(`\nprofile.service: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
