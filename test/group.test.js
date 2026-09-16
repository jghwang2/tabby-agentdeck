// 사이드바 프로젝트 그룹 규칙. 고정하는 것은 다섯 가지 —
//  ① 같은 폴더가 두 그룹으로 갈리지 않는다(대소문자·구분자·끝슬래시 정규화)
//  ② 프로젝트 루트를 찾았으면 그게 키다(서브폴더에서 띄운 탭이 같은 그룹에 들어온다)
//  ③ cwd 를 모르는 탭은 맨 아래 한 그룹으로
//  ④ 그룹 안의 탭 순서는 넘어온 순서 그대로 (호출부가 sortByStatus 를 이미 적용한다)
//  ⑤ 라벨은 짧게, 겹치면 상위를 붙여 구분
const { groupKeyOf, groupLabelOf, groupTabs, normalizeCwd, foldGroupKey, parentPath, UNGROUPED_LABEL,
    collapseIdOf, isStoredCollapsed, resolveGroupCollapse, resolveGroupCollapseFor,
    UNGROUPED_COLLAPSE_KEY } = require('../.tmp/group.js')
const { walkUp, findProjectRoot, PROJECT_MARKERS } = require('../.tmp/project-root.js')

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

// ---------- 경로 정규화 ----------
check('백슬래시는 슬래시로', normalizeCwd('D:\\Project\\a'), 'D:/Project/a')
check('끝 슬래시 제거', normalizeCwd('D:/Project/a/'), 'D:/Project/a')
check('구분자 혼용 + 중복 슬래시', normalizeCwd('D:\\Project//a\\\\b'), 'D:/Project/a/b')
check('대소문자는 보존 (라벨에 원문을 쓴다)', normalizeCwd('d:/project/Root'), 'd:/project/Root')
check('드라이브 루트는 슬래시를 남긴다', normalizeCwd('C:\\'), 'C:/')
check('POSIX 경로', normalizeCwd('/home/me/work/'), '/home/me/work')
check('UNC 앞 두 슬래시 보존', normalizeCwd('\\\\srv\\share\\proj\\'), '//srv/share/proj')
check('빈 문자열은 null', normalizeCwd(''), null)
check('공백뿐이면 null', normalizeCwd('   '), null)
check('undefined 는 null', normalizeCwd(undefined), null)
check('null 은 null', normalizeCwd(null), null)
check('숫자 같은 이상값도 null', normalizeCwd(42), null)

check('폴딩은 소문자', foldGroupKey('D:/Project/A'), 'd:/project/a')
check('폴딩 null 은 빈 문자열', foldGroupKey(null), '')

// ---------- 한 단계 위 (project-root 가 훑을 때 쓴다) ----------
check('부모는 한 단계 위', parentPath('D:/Project/a/sub'), 'D:/Project/a')
check('드라이브 직하의 부모는 드라이브 루트', parentPath('D:/Project'), 'D:/')
check('드라이브 루트는 더 못 올라간다', parentPath('D:/'), null)
check('POSIX 루트도 더 못 올라간다', parentPath('/'), null)
check('UNC 공유 루트는 더 못 올라간다', parentPath('//srv/share'), null)
check('UNC 하위는 공유 루트까지', parentPath('//srv/share/proj'), '//srv/share')
check('구분자 혼용도 정규화 후 판정', parentPath('D:\\Project\\a\\'), 'D:/Project')
check('빈 값은 null', parentPath(''), null)

// ---------- 키: 프로젝트 루트를 못 찾은 경우 ----------
check('rootOf 가 없으면 cwd 자체', groupKeyOf('D:\\Project\\a\\sub'), 'D:/Project/a/sub')
check('rootOf 가 null 을 주면 cwd 자체', groupKeyOf('D:/Project/a/sub', () => null), 'D:/Project/a/sub')
check('탐지 전(undefined)에도 cwd 자체', groupKeyOf('D:/Project/a/sub', () => undefined), 'D:/Project/a/sub')
check('cwd 없으면 키도 null', groupKeyOf(null), null)
check('공백 cwd 는 null', groupKeyOf('  '), null)

// ---------- 키: 프로젝트 루트를 찾은 경우 ----------
const RO = () => 'D:\\Project\\a'
check('루트를 찾으면 그게 키', groupKeyOf('D:/Project/a/sub/deeper', RO), 'D:/Project/a')
check('cwd 가 루트 자체여도 같은 키', groupKeyOf('D:/Project/a', RO), 'D:/Project/a')
check('구분자·끝슬래시가 달라도 같은 키', groupKeyOf('D:\\Project\\a\\sub\\', RO), 'D:/Project/a')
check('루트 대소문자 무시', groupKeyOf('d:/project/a/sub', () => 'D:/PROJECT/A'), 'D:/PROJECT/A')
check('같은 루트면 두 경로가 같은 그룹',
    foldGroupKey(groupKeyOf('D:/Project/a/sub', RO)) === foldGroupKey(groupKeyOf('d:\\project\\A\\', RO)), true)
check('POSIX 도 같은 규칙', groupKeyOf('/home/me/work/repo/src', () => '/home/me/work/repo'), '/home/me/work/repo')
// 조상이 아닌 값은 버린다 — 엉뚱한 루트 하나가 상관없는 탭들을 한 그룹으로 빨아들이는 게 최악이다
check('조상이 아니면 무시하고 cwd', groupKeyOf('E:/Other/x/y', RO), 'E:/Other/x/y')
check('이름만 비슷한 형제 폴더도 무시', groupKeyOf('D:/ProjectX/a/b', RO), 'D:/ProjectX/a/b')
check('드라이브가 다르면 무시', groupKeyOf('E:/Project/a/sub', RO), 'E:/Project/a/sub')
check('cwd 보다 깊은 루트는 무시', groupKeyOf('D:/Project/a', () => 'D:/Project/a/sub'), 'D:/Project/a')

// ---------- 프로젝트 루트 탐지 (fs 없이 — 마커 판정만 주입) ----------
check('마커 목록에 .git 이 있다', PROJECT_MARKERS.includes('.git'), true)
check('cwd 부터 루트까지 훑는다', walkUp('D:/a/b/c').join('|'), 'D:/a/b/c|D:/a/b|D:/a|D:/')
// 홈 경계 — `~/.git`(dotfiles) 하나가 홈 아래 전부를 한 그룹으로 만드는 것을 막는다
const HOME = 'C:/Users/me'
check('홈에 닿으면 홈을 빼고 멈춘다', walkUp('C:/Users/me/a/b', HOME).join('|'), 'C:/Users/me/a/b|C:/Users/me/a')
check('홈 자신이 cwd 면 볼 것이 없다', walkUp(HOME, HOME).length, 0)
check('홈 대소문자 무시', walkUp('c:/users/ME/a', HOME).join('|'), 'c:/users/ME/a')
check('홈 밖이면 경계가 안 걸린다', walkUp('D:/a/b', HOME).join('|'), 'D:/a/b|D:/a|D:/')
check('홈의 마커는 루트로 안 친다',
    findProjectRoot('C:/Users/me/AppData/tmp', dir => foldGroupKey(dir) === foldGroupKey(HOME), HOME), null)
check('홈 아래 진짜 저장소는 잡는다',
    findProjectRoot('C:/Users/me/work/repo/src',
        dir => ['C:/Users/me', 'C:/Users/me/work/repo'].some(r => foldGroupKey(r) === foldGroupKey(dir)), HOME),
    'C:/Users/me/work/repo')
check('드라이브 루트는 자기 하나', walkUp('D:/').join('|'), 'D:/')
check('POSIX 도 루트까지', walkUp('/home/me/x').join('|'), '/home/me/x|/home/me|/home|/')
check('UNC 는 공유 루트에서 멈춘다', walkUp('//srv/share/a/b').join('|'), '//srv/share/a/b|//srv/share/a|//srv/share')
check('빈 cwd 는 빈 배열', walkUp(null).length, 0)

const repoAt = root => dir => foldGroupKey(dir) === foldGroupKey(root)
check('마커가 있는 조상이 루트', findProjectRoot('D:/Project/repo/src/deep', repoAt('D:/Project/repo')), 'D:/Project/repo')
check('cwd 자신에 마커가 있으면 자기 자신', findProjectRoot('D:/Project/repo', repoAt('D:/Project/repo')), 'D:/Project/repo')
check('아무 데도 없으면 null', findProjectRoot('D:/Project/plain/dir', () => false), null)
// 중첩 저장소(서브모듈)에서는 **가까운 쪽**이 그 탭의 프로젝트다
const nested = dir => ['D:/Project/outer', 'D:/Project/outer/inner'].some(r => foldGroupKey(r) === foldGroupKey(dir))
check('중첩이면 가까운 루트', findProjectRoot('D:/Project/outer/inner/src', nested), 'D:/Project/outer/inner')

// ---------- 라벨 ----------
check('라벨은 마지막 조각', groupLabelOf('D:/Project/tabby-agentdeck', ['D:/Project/tabby-agentdeck']), 'tabby-agentdeck')
check('겹치면 상위 한 단계', groupLabelOf('D:/work/agent', ['D:/work/agent', 'D:/temp/agent']), 'work/agent')
check('겹치는 쪽도 각자 구분된다', groupLabelOf('D:/temp/agent', ['D:/work/agent', 'D:/temp/agent']), 'temp/agent')
check('안 겹치면 짧게 유지', groupLabelOf('D:/work/agent', ['D:/work/agent', 'D:/temp/other']), 'agent')
check('대소문자만 다른 이름은 겹친 것으로 본다', groupLabelOf('D:/work/Agent', ['D:/work/Agent', 'D:/temp/agent']), 'work/Agent')
check('두 단계까지 겹치면 세 단계', groupLabelOf('D:/x/a/b', ['D:/x/a/b', 'D:/y/a/b']), 'x/a/b')
check('상대가 더 짧으면 내 쪽만 늘린다', groupLabelOf('D:/x/agent', ['D:/x/agent', 'E:/agent']), 'x/agent')
check('드라이브 루트는 경로 그대로', groupLabelOf('C:\\', ['C:\\']), 'C:/')
check('구분자가 달라도 자기 자신은 겹침으로 안 본다', groupLabelOf('D:\\work\\agent', ['D:/work/agent']), 'agent')

// ---------- 묶기 ----------
const mk = (name, cwd) => ({ name, cwd })
const cwdOf = t => t.cwd
const tabs = [
    mk('z1', 'D:/Project/zeta'),
    mk('a1', 'D:/Project/alpha/sub'),
    mk('n1', null),
    mk('a2', 'd:\\project\\ALPHA\\'),
    mk('m1', 'D:/Project/mid'),
    mk('n2', '   '),
    mk('a3', 'D:/Project/alpha/other/deep'),
]
// `D:/Project` 직하 셋(alpha·mid·zeta)이 각자 저장소인 상황 — 실제로는 fs 가 알려주는 값이다
const repos = ['D:/Project/alpha', 'D:/Project/mid', 'D:/Project/zeta']
const rootOf = cwd => findProjectRoot(cwd, dir => repos.some(r => foldGroupKey(r) === foldGroupKey(dir)))
const groups = groupTabs(tabs, cwdOf, rootOf)

check('그룹 수 (alpha·mid·zeta·기타)', groups.length, 4)
check('그룹은 라벨 사전순', groups.map(g => g.label).join(','), `alpha,mid,zeta,${UNGROUPED_LABEL}`)
check('cwd 모르는 그룹은 맨 아래', groups[groups.length - 1].key, null)
check('기타 그룹에 cwd 미확인 탭만', groups[3].tabs.map(t => t.name).join(''), 'n1n2')
check('대소문자·서브폴더가 한 그룹으로', groups[0].tabs.map(t => t.name).join(''), 'a1a2a3')
check('그룹 안 순서는 넘어온 순서 그대로', groups[0].tabs.map(t => t.name).join(''), 'a1a2a3')
check('그룹 키 표기는 먼저 온 탭의 것', groups[0].key, 'D:/Project/alpha')
check('탭 총합이 보존된다', groups.reduce((n, g) => n + g.tabs.length, 0), tabs.length)

const singleRoot = groupTabs([mk('x', 'D:/Project/a'), mk('y', 'D:/Project/a/sub')], cwdOf, () => 'D:/Project/a')
check('한 프로젝트면 그룹 1개 (헤더 생략 근거)', singleRoot.length, 1)
check('그 그룹에 두 탭 모두', singleRoot[0].tabs.length, 2)

check('빈 입력은 빈 배열', groupTabs([], cwdOf).length, 0)

const allBlind = groupTabs([mk('w1', null), mk('w2', undefined)], cwdOf)
check('cwd 를 아무도 모르면 기타 하나', allBlind.length, 1)
check('그 하나는 null 그룹', allBlind[0].key, null)
check('기타 라벨', allBlind[0].label, UNGROUPED_LABEL)

// 루트를 못 찾으면(저장소가 아닌 폴더) 서브폴더가 갈린다 — 자동 탐지가 필요한 이유
const noRoot = groupTabs([mk('x', 'D:/Project/a'), mk('y', 'D:/Project/a/sub')], cwdOf)
check('루트를 모르면 서브폴더가 다른 그룹', noRoot.length, 2)
// 탐지가 끝나기 전(undefined)에도 죽지 않고 cwd 로 떨어진다 — 화면이 잠깐 갈렸다가 합쳐진다
const pendingRoot = groupTabs([mk('x', 'D:/Project/a'), mk('y', 'D:/Project/a/sub')], cwdOf, () => undefined)
check('탐지 전에도 안 죽는다', pendingRoot.length, 2)

// 원본 배열·객체는 건드리지 않는다
check('원본 탭 순서 불변', tabs.map(t => t.name).join(','), 'z1,a1,n1,a2,m1,n2,a3')

// ---------- 접힘 최종 판정 (저장된 접힘 + 검색·상태 필터) ----------
// 고정하는 것 —
//  ⑥ 필터가 없으면 저장된 접힘 그대로
//  ⑦ 매칭이 있는 접힌 그룹만 **임시로** 펴진다 (저장값은 안 바뀐다 = 필터를 지우면 정확히 복귀)
//  ⑧ 매칭이 없는 접힌 그룹은 접힌 채
//  ⑨ 기타 그룹(key === null)도 `(ungrouped)` id 로 저장·판정된다
const st = s => `${s.collapsed}/${s.reason}`
const resolve = (stored, filtering, matches) => st(resolveGroupCollapse({ stored, filtering, matches }))

// 저장 id — 쓸 때도 읽을 때도 이 값으로
check('접힘 id 는 폴딩된 키', collapseIdOf('D:/Project/A'), 'd:/project/a')
check('기타 그룹의 접힘 id', collapseIdOf(null), UNGROUPED_COLLAPSE_KEY)
check('undefined 도 기타 그룹', collapseIdOf(undefined), UNGROUPED_COLLAPSE_KEY)
check('deck.service 의 UNGROUPED_KEY 와 같은 값', UNGROUPED_COLLAPSE_KEY, '(ungrouped)')

check('저장 목록에 있으면 접힘', isStoredCollapsed('D:/Project/a', ['d:/project/a']), true)
check('대소문자만 달라도 접힘 유지 (GR9 의 유닛판)', isStoredCollapsed('D:/PROJECT/A', ['d:/project/a']), true)
check('저장 쪽 대소문자도 폴딩한다', isStoredCollapsed('D:/Project/a', ['D:/Project/A']), true)
check('구분자는 폴딩 대상이 아니다', isStoredCollapsed('D:/Project/a', ['d:\\project\\a']), false)
check('없으면 안 접힘', isStoredCollapsed('D:/Project/b', ['d:/project/a']), false)
check('빈 목록은 안 접힘', isStoredCollapsed('D:/Project/a', []), false)
check('배열이 아니면 안 접힘', isStoredCollapsed('D:/Project/a', null), false)
check('문자열 아닌 원소도 견딘다', isStoredCollapsed('D:/Project/a', [42, null, undefined, 'd:/project/a']), true)
check('기타 그룹도 저장된다', isStoredCollapsed(null, [UNGROUPED_COLLAPSE_KEY]), true)
check('기타 그룹은 경로 키로는 안 걸린다', isStoredCollapsed(null, ['d:/project/a']), false)

// 필터 없음 — 저장된 접힘 그대로
check('필터 없고 저장 접힘 → 접힘', resolve(true, false, 0), 'true/stored')
check('필터 없고 저장 접힘, 탭이 있어도 접힘', resolve(true, false, 3), 'true/stored')
check('필터 없고 저장 안 접힘 → 펴짐', resolve(false, false, 3), 'false/open')

// 필터 있음
check('접힌 그룹에 매칭 있으면 임시로 펴진다', resolve(true, true, 1), 'false/filter-open')
check('매칭이 여럿이어도 같다', resolve(true, true, 5), 'false/filter-open')
check('접힌 그룹에 매칭이 없으면 접힌 채', resolve(true, true, 0), 'true/stored')
check('매칭 수를 안 주면 0 취급', st(resolveGroupCollapse({ stored: true, filtering: true })), 'true/stored')
check('음수 매칭도 0 취급', resolve(true, true, -2), 'true/stored')
check('NaN 매칭도 0 취급', resolve(true, true, NaN), 'true/stored')
check('안 접힌 그룹은 필터 중에도 펴짐', resolve(false, true, 2), 'false/open')
check('안 접힌 그룹은 매칭 0 이어도 접지 않는다 (필터가 접는 일은 없다)', resolve(false, true, 0), 'false/open')

// 상태 필터만 걸린 경우 — 검색어는 비었지만 filtering 은 true 로 온다(renderPlan().filtering)
check('상태 필터만 걸려도 같은 규칙 (매칭 있음)', resolve(true, true, 2), 'false/filter-open')
check('상태 필터만 걸리고 매칭 없으면 접힌 채', resolve(true, true, 0), 'true/stored')

// 검색어를 지우면 **정확히** 원래 접힘으로 — 임시 상태를 어디에도 남기지 않는다
const stored0 = ['d:/project/alpha']
const seq = [
    resolveGroupCollapseFor({ key: 'D:/Project/alpha', label: 'alpha', tabs: [1, 2] }, stored0, false),
    resolveGroupCollapseFor({ key: 'D:/Project/alpha', label: 'alpha', tabs: [1] }, stored0, true),
    resolveGroupCollapseFor({ key: 'D:/Project/alpha', label: 'alpha', tabs: [1, 2] }, stored0, false),
]
check('접힘 → 검색으로 임시 펴짐 → 검색 해제 후 원래 접힘', seq.map(st).join(' → '),
    'true/stored → false/filter-open → true/stored')
check('판정이 저장 목록을 건드리지 않는다', JSON.stringify(stored0), JSON.stringify(['d:/project/alpha']))

// 그룹을 그대로 먹이는 창구 — 필터 중 group.tabs 는 이미 매칭된 탭들이다
check('그룹의 tabs 수가 매칭 수 (필터 중 매칭 있음)',
    st(resolveGroupCollapseFor({ key: 'D:/Project/a', label: 'a', tabs: [1] }, ['d:/project/a'], true)), 'false/filter-open')
check('그룹의 tabs 가 비면 접힌 채',
    st(resolveGroupCollapseFor({ key: 'D:/Project/a', label: 'a', tabs: [] }, ['d:/project/a'], true)), 'true/stored')
check('저장 목록에 없는 그룹은 펴짐',
    st(resolveGroupCollapseFor({ key: 'D:/Project/b', label: 'b', tabs: [1] }, ['d:/project/a'], true)), 'false/open')

// 기타 그룹(key === null) — 경로 키가 없어도 `(ungrouped)` 로 저장되므로 같은 규칙이 그대로 산다
check('기타 그룹도 필터 없으면 저장 접힘 그대로',
    st(resolveGroupCollapseFor({ key: null, label: UNGROUPED_LABEL, tabs: [1, 2] }, [UNGROUPED_COLLAPSE_KEY], false)),
    'true/stored')
check('기타 그룹도 매칭이 있으면 임시로 펴진다',
    st(resolveGroupCollapseFor({ key: null, label: UNGROUPED_LABEL, tabs: [1] }, [UNGROUPED_COLLAPSE_KEY], true)),
    'false/filter-open')
check('기타 그룹에 매칭이 없으면 접힌 채',
    st(resolveGroupCollapseFor({ key: null, label: UNGROUPED_LABEL, tabs: [] }, [UNGROUPED_COLLAPSE_KEY], true)),
    'true/stored')
check('저장된 접힘이 없으면 기타 그룹도 펴짐',
    st(resolveGroupCollapseFor({ key: null, label: UNGROUPED_LABEL, tabs: [1] }, [], true)), 'false/open')

console.log(`\ngroup: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
