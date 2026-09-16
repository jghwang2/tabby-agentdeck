// 지난 세션 목록 규칙. 고정하는 것은 여섯 가지 —
//  ① 훅 주입·한도 안내·알림은 라벨이 되지 않는다 (그러면 모든 줄이 같은 문장이 된다)
//  ② 기록 앞부분에서 cwd·첫 프롬프트를 읽는다 (폴더 이름 규칙을 흉내내지 않는다)
//  ③ 원장과 디스크를 합칠 때 **라벨은 원장이, 존재 여부는 디스크가** 이긴다
//  ④ 살아 있는 세션은 목록에서 빼지 않고 `openTabId` 를 단다
//  ⑤ 기간·개수 제한은 최신부터 자른다
//  ⑥ 이어받기 명령은 세션 id 모양을 통과한 것만 만든다
const { isHumanPrompt, promptFromRecord, clampLabel, readHead, mergeSessions, pruneLedger,
    resumeRowsFor, formatWhen, sessionIdFromFile, resumeCommand, LABEL_MAX } = require('../.tmp/sessionLedger.js')

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

// ---------- ① 사람이 친 프롬프트만 라벨로 ----------
console.log('사람 프롬프트 판정')
check('평범한 한 줄', isHumanPrompt('그룹으로 묶어놓으면 뭐가 달라지는데?'), true)
check('빈 줄', isHumanPrompt('   '), false)
// 실측(2026-09-11 `9e0c954f`): 마지막 user 줄 8개가 전부 이 문장이었다
check('한도 리셋 안내', isHumanPrompt('Your claude.ai usage limit has reset. Continue the task'), false)
check('서브에이전트 알림', isHumanPrompt('<task-notification><task-id>b5ru1foj1</task-id>'), false)
check('시스템 리마인더', isHumanPrompt('<system-reminder>note</system-reminder>'), false)
check('슬래시 명령 출력', isHumanPrompt('<local-command-stdout>ok</local-command-stdout>'), false)
check('요약 이어받기 안내', isHumanPrompt('Caveat: The messages below were generated'), false)
check('사람이 끊은 자리', isHumanPrompt('[Request interrupted by user]'), false)
check('문자열이 아님', isHumanPrompt(null), false)

console.log('기록 줄에서 프롬프트 꺼내기')
check('user 문자열', promptFromRecord({ type: 'user', message: { content: '태비 왜 꺼졌나' } }), '태비 왜 꺼졌나')
check('assistant 는 아님', promptFromRecord({ type: 'assistant', message: { content: '네' } }), null)
check('isMeta 는 아님', promptFromRecord({ type: 'user', isMeta: true, message: { content: '주입' } }), null)
check('블록 배열의 text 만',
    promptFromRecord({ type: 'user', message: { content: [
        { type: 'tool_result', content: '결과' },
        { type: 'text', text: '이거 고쳐줘' },
    ] } }),
    '이거 고쳐줘')
check('tool_result 뿐이면 없음',
    promptFromRecord({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), null)

console.log('라벨 다듬기')
check('여러 줄을 한 줄로', clampLabel('첫 줄\n  둘째 줄'), '첫 줄 둘째 줄')
check('빈 값', clampLabel(null), '')
const long = 'ㄱ'.repeat(LABEL_MAX + 40)
check('길이 제한', clampLabel(long).length, LABEL_MAX)
check('제한 시 말줄임', clampLabel(long).endsWith('…'), true)

// ---------- ② 기록 앞부분 읽기 ----------
console.log('기록 앞부분')
// 실측 배치 그대로: 메타 줄들이 앞에 오고 cwd 는 5번째쯤, 첫 프롬프트는 한참 뒤
const head = [
    JSON.stringify({ type: 'last-prompt', sessionId: 'f54b20b9' }),
    JSON.stringify({ type: 'mode', mode: 'default' }),
    '깨진 줄 {{{',
    JSON.stringify({ type: 'attachment', cwd: 'D:\\Project\\demo\\app', timestamp: '2026-09-11T01:38:02.209Z' }),
    JSON.stringify({ type: 'user', isMeta: true, message: { content: '<system-reminder>x</system-reminder>' } }),
    JSON.stringify({ type: 'user', message: { content: 'Your claude.ai usage limit has reset.' } }),
    JSON.stringify({ type: 'user', message: { content: '그룹으로 묶어놓으면 뭐가 달라지는데?' } }),
]
const info = readHead(head)
check('cwd 를 읽는다', info.cwd, 'D:\\Project\\demo\\app')
check('노이즈를 건너뛴 첫 프롬프트', info.label, '그룹으로 묶어놓으면 뭐가 달라지는데?')
check('시작 시각', info.startedAt, Date.parse('2026-09-11T01:38:02.209Z'))
check('빈 기록', readHead([]).label, '')

console.log('파일 이름 -> 세션 id')
check('정상', sessionIdFromFile('f54b20b9-f37a-44ba-9577-59eaa47827eb.jsonl'), 'f54b20b9-f37a-44ba-9577-59eaa47827eb')
check('다른 확장자', sessionIdFromFile('notes.md'), null)
check('요약 파일', sessionIdFromFile('summary.jsonl'), null)

// ---------- ③ 원장 + 디스크 합치기 ----------
console.log('원장과 디스크 합치기')
const ledger = [
    { sessionId: 'a', cwd: 'D:/p', label: '사람이 친 라벨', lastStatus: 'done', lastSeen: 100, from: 'live' },
    // 기록이 사라진 세션 — 이어받아도 복원할 게 없으니 목록에 넣지 않는다
    { sessionId: 'gone', cwd: 'D:/p', label: '옛날 것', lastStatus: 'done', lastSeen: 50, from: 'live' },
]
const disk = [
    { sessionId: 'a', cwd: 'D:/p', label: '기록에서 읽은 첫 줄', lastStatus: null, lastSeen: 300, from: 'head' },
    { sessionId: 'b', cwd: 'D:/q', label: '디스크만 있는 것', lastStatus: null, lastSeen: 200, from: 'head' },
]
const merged = mergeSessions(ledger, disk)
check('합친 개수 (사라진 것 제외)', merged.length, 2)
const a = merged.find(r => r.sessionId === 'a')
check('라벨은 원장이 이긴다', a.label, '사람이 친 라벨')
check('상태도 원장이', a.lastStatus, 'done')
// 원장은 탭이 닫힐 때 멈춘다 — 그 뒤 다른 터미널에서 이어받았으면 디스크가 맞다
check('lastSeen 은 큰 쪽', a.lastSeen, 300)
check('원장에 없는 것도 남는다', merged.find(r => r.sessionId === 'b').label, '디스크만 있는 것')
check('설치 이전 세션의 출처', merged.find(r => r.sessionId === 'b').from, 'head')

console.log('원장 청소')
check('기록 있는 것만 남는다',
    pruneLedger(ledger, new Set(['a'])).map(r => r.sessionId).join(','), 'a')

// ---------- ④⑤ 목록 만들기 ----------
console.log('그룹별 목록')
const NOW = Date.parse('2026-09-11T14:30:00+09:00')
const DAY = 86400000
const records = [
    { sessionId: 's1', cwd: 'D:/Project/Root/sub', label: '최근', lastStatus: 'done', lastSeen: NOW - 1000, from: 'live' },
    { sessionId: 's2', cwd: 'D:/project/root', label: '대소문자 달라도 같은 그룹', lastStatus: 'error', lastSeen: NOW - 2000, from: 'live' },
    { sessionId: 's3', cwd: 'D:/Other', label: '다른 그룹', lastStatus: 'done', lastSeen: NOW - 3000, from: 'live' },
    { sessionId: 's4', cwd: 'D:/Project/Root', label: '기간 밖', lastStatus: 'done', lastSeen: NOW - 30 * DAY, from: 'live' },
    { sessionId: 's5', cwd: 'D:/Project/Root', label: '숨긴 것', lastStatus: 'done', lastSeen: NOW - 500, from: 'live' },
    { sessionId: 's6', cwd: 'D:/Project/Root', label: '지금 열려 있는 것', lastStatus: 'running', lastSeen: NOW - 100, from: 'live' },
]
// 그룹 키 계산은 group.ts 의 일이라 여기서는 "루트를 찾았다" 는 상황만 흉내낸다
const keyOf = cwd => (cwd || '').toLowerCase().startsWith('d:/project/root') ? 'D:/Project/Root' : cwd
const fold = k => (k || '').toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
const base = {
    groupKeys: ['D:/Project/Root'],
    keyOf,
    fold,
    live: new Map([['s6', 'tab-9']]),
    days: 7,
    limit: 0,
    hidden: new Set(['s5']),
    now: NOW,
}
const rows = resumeRowsFor(records, base)
check('그룹 밖은 빠진다', rows.some(r => r.sessionId === 's3'), false)
check('기간 밖은 빠진다', rows.some(r => r.sessionId === 's4'), false)
check('숨긴 것은 빠진다', rows.some(r => r.sessionId === 's5'), false)
check('하위 폴더도 같은 그룹', rows.some(r => r.sessionId === 's1'), true)
check('대소문자 달라도 같은 그룹', rows.some(r => r.sessionId === 's2'), true)
// 지우면 "방금 보던 작업이 목록에 없다" 가 된다 — 남기고 표시만 다르게
check('살아 있는 세션도 남는다', rows.some(r => r.sessionId === 's6'), true)
check('살아 있는 세션에 탭이 달린다', rows.find(r => r.sessionId === 's6').openTabId, 'tab-9')
check('죽은 세션은 탭 없음', rows.find(r => r.sessionId === 's1').openTabId, null)
check('최신순', rows.map(r => r.sessionId).join(','), 's6,s1,s2')
check('개수 제한', resumeRowsFor(records, { ...base, limit: 2 }).map(r => r.sessionId).join(','), 's6,s1')
check('기간 제한 없음', resumeRowsFor(records, { ...base, days: 0 }).some(r => r.sessionId === 's4'), true)

// 사이드바는 그룹이 하나뿐이면 헤더를 안 그리고 목록을 **평면 한 덩이**로 만든다 —
// 그때 그 덩이의 key 는 null(기타)이다. 키 하나만 받으면 프로젝트를 하나만 열어 둔
// 가장 흔한 화면에서 목록이 영영 비어 있었다 (2026-09-11 실측, deck.service `resumeKeysOf`)
console.log('평면 화면 (그룹 헤더를 안 그리는 경우)')
check('null 하나면 아무것도 안 걸린다',
    resumeRowsFor(records, { ...base, groupKeys: [null] }).length, 0)
check('덩이에 든 탭들의 키를 넘기면 걸린다',
    resumeRowsFor(records, { ...base, groupKeys: [null, 'D:/Project/Root'] }).map(r => r.sessionId).join(','),
    's6,s1,s2')
check('빈 키 목록', resumeRowsFor(records, { ...base, groupKeys: [] }).length, 0)

// ---------- 시각 표기 ----------
console.log('시각 표기')
// formatWhen displays local time; fixtures must use the runner's local zone.
const localNow = new Date(2026, 8, 11, 14, 30).getTime()
check('오늘은 시각', formatWhen(new Date(2026, 8, 11, 14, 12).getTime(), localNow), '14:12')
check('한 자리 시각도 두 자리로', formatWhen(new Date(2026, 8, 11, 4, 5).getTime(), localNow), '04:05')
check('어제', formatWhen(new Date(2026, 8, 10, 23).getTime(), localNow), '어제')
check('그보다 오래', formatWhen(new Date(2026, 8, 1, 10).getTime(), localNow), '9/1')
check('값 없음', formatWhen(0, NOW), '')

// ---------- ⑥ 이어받기 명령 ----------
console.log('이어받기 명령')
check('평범한 세션', resumeCommand('f54b20b9-f37a-44ba-9577-59eaa47827eb', false),
    'claude --resume f54b20b9-f37a-44ba-9577-59eaa47827eb')
check('분기', resumeCommand('f54b20b9-f37a-44ba-9577-59eaa47827eb', true),
    'claude --resume f54b20b9-f37a-44ba-9577-59eaa47827eb --fork-session')
// 명령을 만드는 자리라 모양을 한 번 더 막는다 — 통과 못 하면 호출부가 아무것도 보내지 않는다
check('명령 주입 시도', resumeCommand('x; rm -rf /', false), '')
check('빈 값', resumeCommand('', false), '')

console.log(`\n${pass} ok, ${fail} fail`)
process.exit(fail ? 1 : 0)
