// 서브에이전트 개수 세기(src/subagents.ts) 규칙. 고정하는 것은 여섯 가지 —
//  ① 도는 중 = 호출된 id 중 종료 알림에 안 나온 것 (id 대조)
//  ② 알림의 JSON 모양 세 가지(user content / queue-operation / attachment)를 다 잡는다
//  ③ `tool_result`(Async agent launched)는 종료가 아니다
//  ④ 순서가 뒤집혀도(완료 먼저), 두 번 와도, 나눠 먹여도 결과가 같다 (멱등)
//  ⑤ 깨진 줄·빈 줄에 죽지 않고, 개행 없는 꼬리는 다음 청크까지 들고 있는다
//  ⑥ 사용자 대화 내용(input.prompt)은 결과에 새지 않는다
const { createSubagentState, feedLines, feedChunk, summarizeSubagents,
    formatSubagentTooltip, matchesSessionTranscript, AGENT_TOOL_NAMES,
    summarizeLiveAgents, formatLiveAgentTooltip } = require('../.tmp/subagents.js')

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

// ---------- 픽스처 (실측 구조만 흉내낸 최소 JSON — 실제 대화 내용은 쓰지 않는다) ----------

const ID1 = 'toolu_01aaaaaaaaaaaaaaaaaa'
const ID2 = 'toolu_01bbbbbbbbbbbbbbbbbb'
const ID3 = 'toolu_01cccccccccccccccccc'

/** 호출 줄 = assistant 줄의 message.content[] 안 tool_use */
function callLine (id, description, opts) {
    const o = opts || {}
    const input = { description, prompt: 'SECRET-PROMPT-BODY' }
    if (o.type !== null) {
        input.subagent_type = o.type || 'fork'
    }
    return JSON.stringify({
        parentUuid: 'u-1',
        isSidechain: o.sidechain === true,
        type: 'assistant',
        timestamp: o.ts || '2026-09-09T01:02:03.000Z',
        message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id, name: o.name || 'Agent', input }],
        },
    })
}

/** 알림 블록 본문 — status 를 안 주면 태그 자체를 뺀다(실측에 그런 블록이 있다) */
function notifyBlock (id, status) {
    const parts = ['<task-notification>', '<task-id>t-' + id.slice(-4) + '</task-id>',
        '<tool-use-id>' + id + '</tool-use-id>', '<output-file>C:\\tmp\\out.md</output-file>']
    if (status) {
        parts.push('<status>' + status + '</status>')
    }
    parts.push('</task-notification>')
    return parts.join('\n')
}

/** 모양 ① user 줄의 message.content 가 문자열 */
function notifyUser (id, status) {
    return JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: notifyBlock(id, status) } })
}

/** 모양 ② queue-operation 줄의 최상위 content */
function notifyQueue (id, status) {
    return JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: notifyBlock(id, status) })
}

/** 모양 ③ attachment 줄의 attachment.prompt */
function notifyAttachment (id, status) {
    return JSON.stringify({ type: 'attachment', attachment: { type: 'queued_command', prompt: notifyBlock(id, status) } })
}

/** 백그라운드 Agent 의 tool_result — 호출 바로 다음 줄에 오는 "띄웠다" 통지 */
function launchAck (id) {
    return JSON.stringify({
        type: 'user',
        isSidechain: false,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Async agent launched successfully.' }] },
    })
}

function otherToolLine (id, name) {
    return JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: { command: 'ls' } }] },
    })
}

function sum (lines) {
    return summarizeSubagents(feedLines(createSubagentState(), lines))
}

function descs (s) {
    return s.items.map(i => i.description).join('|')
}

// ---------- 기본: 호출 3개 중 1개 완료 ----------
{
    const s = sum([
        callLine(ID1, '사이드바 키보드 내비게이션'),
        launchAck(ID1),
        callLine(ID2, '서브에이전트 개수 순수 모듈'),
        launchAck(ID2),
        callLine(ID3, '깃 커밋 패널'),
        launchAck(ID3),
        notifyUser(ID2, 'completed'),
    ])
    check('호출 3 · 완료 1 → 도는 중 2', s.running, 2)
    check('도는 중 설명 2개 (호출 순서)', descs(s), '사이드바 키보드 내비게이션|깃 커밋 패널')
    check('총 호출 수', s.calls, 3)
    check('완료 id 수', s.done, 1)
    check('subagent_type 도 같이 온다', s.items[0].subagentType, 'fork')
    check('startedAt = 호출 줄 timestamp', s.items[0].startedAt, '2026-09-09T01:02:03.000Z')
    check('input.prompt 는 결과에 없다', JSON.stringify(s.items).indexOf('SECRET') < 0, true)
    check('툴팁에도 prompt 가 없다', formatSubagentTooltip(s).indexOf('SECRET') < 0, true)
}

// ---------- tool_result 는 완료가 아니다 (이걸 완료로 세면 항상 0개가 된다) ----------
check('launch ack 만 있으면 여전히 도는 중', sum([callLine(ID1, 'A'), launchAck(ID1)]).running, 1)

// ---------- 알림 모양 세 가지 ----------
check('알림 모양 ① user content 문자열', sum([callLine(ID1, 'A'), notifyUser(ID1, 'completed')]).running, 0)
check('알림 모양 ② queue-operation', sum([callLine(ID1, 'A'), notifyQueue(ID1, 'completed')]).running, 0)
check('알림 모양 ③ attachment.prompt', sum([callLine(ID1, 'A'), notifyAttachment(ID1, 'completed')]).running, 0)

// ---------- 상태 값 ----------
check('status 없는 알림도 종료', sum([callLine(ID1, 'A'), notifyUser(ID1, null)]).running, 0)
check('status=failed 도 종료', sum([callLine(ID1, 'A'), notifyUser(ID1, 'failed')]).running, 0)
check('모르는 종료 상태도 종료 (블랙리스트 판정)', sum([callLine(ID1, 'A'), notifyUser(ID1, 'cancelled')]).running, 0)
check('status=running 은 종료가 아니다', sum([callLine(ID1, 'A'), notifyUser(ID1, 'running')]).running, 1)
check('status 대소문자 무시', sum([callLine(ID1, 'A'), notifyUser(ID1, 'RUNNING')]).running, 1)

// ---------- 순서 뒤집힘 / 중복 ----------
check('완료가 호출보다 먼저 와도 (증분 경계)',
    sum([notifyUser(ID1, 'completed'), callLine(ID1, 'A')]).running, 0)
check('호출을 못 본 완료도 기록된다',
    sum([notifyUser(ID1, 'completed')]).done, 1)
check('같은 id 완료 두 번 (알림은 여러 번 온다)',
    sum([callLine(ID1, 'A'), notifyUser(ID1, 'completed'), notifyQueue(ID1, 'completed')]).running, 0)
check('같은 id 완료 두 번이어도 done 은 1',
    sum([callLine(ID1, 'A'), notifyUser(ID1, 'completed'), notifyQueue(ID1, 'completed')]).done, 1)
check('같은 호출 줄이 두 번 적혀도 호출 수 1',
    sum([callLine(ID1, 'A'), callLine(ID1, 'A')]).calls, 1)
check('중복 호출은 먼저 본 설명을 지킨다',
    descs(sum([callLine(ID1, '먼저'), callLine(ID1, '나중')])), '먼저')
{
    // 한 줄에 알림 블록이 두 개 실려 오는 경우
    const line = JSON.stringify({ type: 'queue-operation', content: notifyBlock(ID1, 'completed') + '\n' + notifyBlock(ID2, 'completed') })
    check('한 줄에 알림 두 블록', sum([callLine(ID1, 'A'), callLine(ID2, 'B'), line]).running, 0)
}

// ---------- Agent 가 아닌 도구는 세지 않는다 ----------
{
    const s = sum([
        otherToolLine('toolu_01dddddddddddddddddd', 'Bash'),
        otherToolLine('toolu_01eeeeeeeeeeeeeeeeee', 'Write'),
        otherToolLine('toolu_01ffffffffffffffffff', 'Read'),
        callLine(ID1, '유일한 서브에이전트'),
    ])
    check('Bash·Write·Read 는 서브에이전트가 아니다', s.calls, 1)
    check('도는 중은 Agent 뿐', descs(s), '유일한 서브에이전트')
}
check('옛 이름 Task 도 센다', sum([callLine(ID1, 'A', { name: 'Task' })]).running, 1)
check('AGENT_TOOL_NAMES 는 Agent·Task', AGENT_TOOL_NAMES.join(','), 'Agent,Task')

// ---------- 사이드체인(서브에이전트 자신의 줄)은 세지 않는다 ----------
check('사이드체인 호출은 제외', sum([callLine(ID1, 'A', { sidechain: true })]).calls, 0)

// ---------- 깨진 줄 / 빈 줄 / 잘린 꼬리 ----------
{
    const st = feedLines(createSubagentState(), ['', '   ', 'not json at all',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent"',
        callLine(ID1, 'A')])
    check('빈 줄·JSON 아닌 줄에 죽지 않는다', summarizeSubagents(st).running, 1)
    check('깨진 Agent 줄은 버린다 (skipped 로 남는다)', st.skipped, 1)
    check('Agent 와 무관한 쓰레기 줄은 파싱조차 안 한다 (skipped 로 안 센다)',
        feedLines(createSubagentState(), ['not json at all']).skipped, 0)
}
{
    // 청크가 줄 중간에서 끊긴 경우 — 꼬리는 들고 있다가 다음 청크에서 완성해 먹는다
    const line = callLine(ID1, '잘린 호출')
    const cut = Math.floor(line.length / 2)
    const s = createSubagentState()
    feedChunk(s, line.slice(0, cut))
    check('잘린 꼬리는 아직 호출이 아니다', summarizeSubagents(s).running, 0)
    check('꼬리를 들고 있다', s.pending.length > 0, true)
    feedChunk(s, line.slice(cut) + '\n')
    check('다음 청크에서 이어 붙여 읽는다', summarizeSubagents(s).running, 1)
    check('꼬리를 비웠다', s.pending, '')
    check('버린 줄 없음', s.skipped, 0)
}
{
    // 알림 줄이 잘린 경우도 같다 — 다음 청크에서 종료로 잡혀야 한다
    const notif = notifyUser(ID1, 'completed')
    const s = createSubagentState()
    feedChunk(s, callLine(ID1, 'A') + '\n' + notif.slice(0, 40))
    check('잘린 알림은 아직 완료가 아니다', summarizeSubagents(s).running, 1)
    feedChunk(s, notif.slice(40) + '\n')
    check('알림 꼬리도 이어 붙여 읽는다', summarizeSubagents(s).running, 0)
}
check('CRLF 로 적힌 줄도 읽는다', summarizeSubagents(feedChunk(createSubagentState(), callLine(ID1, 'A') + '\r\n')).running, 1)
check('빈 청크는 아무 일도 안 한다', summarizeSubagents(feedChunk(createSubagentState(), '')).calls, 0)

// ---------- 산문에 실린 알림 예시는 종료로 세지 않는다 ----------
{
    // 대화기록에는 알림 형식을 설명하는 산문도 들어 있다 (실측: `0-9]+)` 같은 정규식 조각이 긁혔다)
    const prose = JSON.stringify({ type: 'user', message: { role: 'user', content: '형식은 <tool-use-id>([0-9]+)</tool-use-id> 이고 <status>completed</status> 다' } })
    check('산문의 쓰레기 id 는 무시', sum([callLine(ID1, 'A'), prose]).done, 0)
    check('산문 때문에 도는 중이 줄지 않는다', sum([callLine(ID1, 'A'), prose]).running, 1)
}

// ---------- 증분 2회 = 1회 (멱등) ----------
{
    const all = [
        callLine(ID1, 'A'), launchAck(ID1),
        callLine(ID2, 'B'), launchAck(ID2),
        notifyUser(ID1, 'completed'),
        callLine(ID3, 'C'), launchAck(ID3),
        notifyQueue(ID3, 'completed'),
    ]
    const once = summarizeSubagents(feedChunk(createSubagentState(), all.join('\n') + '\n'))
    const split = createSubagentState()
    // 경계를 줄 중간에 둔다 — 실제 폴링도 파일이 쓰이는 도중에 끊긴다
    const text = all.join('\n') + '\n'
    const at = text.indexOf(ID3) - 20
    feedChunk(split, text.slice(0, at))
    feedChunk(split, text.slice(at))
    const twice = summarizeSubagents(split)
    check('한 번에 먹인 결과', once.running + ':' + descs(once), '1:B')
    check('나눠 먹인 결과가 같다', twice.running + ':' + descs(twice), once.running + ':' + descs(once))
    check('같은 줄을 또 먹여도 개수가 안 늘어난다',
        summarizeSubagents(feedLines(split, all)).calls, once.calls)
}

// ---------- 호출 0개 ----------
{
    const s = sum([])
    check('빈 입력 → 0개', s.running, 0)
    check('빈 입력 → items 없음', s.items.length, 0)
    check('알림만 있어도 도는 중 0', sum([notifyUser(ID1, 'completed')]).running, 0)
    check('상태가 null 이어도 안 죽는다', summarizeSubagents(null).running, 0)
    check('빈 입력 툴팁은 빈 문자열', formatSubagentTooltip(s), '')
    check('null 툴팁도 빈 문자열', formatSubagentTooltip(null), '')
}

// ---------- 툴팁 ----------
{
    const s = sum([callLine(ID1, '첫째'), callLine(ID2, '둘째')])
    check('툴팁 머리에 개수', formatSubagentTooltip(s).split('\n')[0], '서브에이전트 2개 진행중')
    check('툴팁에 설명 줄', formatSubagentTooltip(s).split('\n').slice(1).join(' '), '· 첫째 · 둘째')
    check('max 로 줄이면 나머지는 수로', formatSubagentTooltip(s, 1).split('\n').slice(1).join(' '), '· 첫째 · … 외 1개')
}
{
    const noDesc = sum([callLine(ID1, '', { type: 'Explore' })])
    check('설명이 없으면 subagent_type', formatSubagentTooltip(noDesc).split('\n')[1], '· Explore')
    const bare = sum([callLine(ID2, '', { type: null })])
    check('둘 다 없으면 (설명 없음)', formatSubagentTooltip(bare).split('\n')[1], '· (설명 없음)')
}

// ---------- 대화기록 파일 판정 ----------
const SID = '0ddc688d-9b47-4e86-a324-c12d46216680'
check('세션 id + .jsonl', matchesSessionTranscript(SID + '.jsonl', SID), true)
check('대소문자 무시 (윈도우 파일명)', matchesSessionTranscript(SID.toUpperCase() + '.JSONL', SID), true)
check('다른 세션 파일은 아니다', matchesSessionTranscript('other.jsonl', SID), false)
check('확장자가 다르면 아니다', matchesSessionTranscript(SID + '.json', SID), false)
check('접두가 붙으면 아니다', matchesSessionTranscript('x-' + SID + '.jsonl', SID), false)
check('세션 id 가 없으면 false', matchesSessionTranscript(SID + '.jsonl', ''), false)
check('파일명이 없으면 false', matchesSessionTranscript(null, SID), false)

// ---------- 훅으로 받은 목록 (SubagentStart/Stop) ----------
// 이쪽은 대화기록을 안 본다 — 훅이 `agent_id` 로 켜고 끈 결과만 줄인다.
const LIVE = [
    { id: 'a1', type: 'general-purpose', at: 1000 },
    { id: 'a2', type: 'Explore', at: 500 },
    { id: 'a3', type: 'general-purpose', at: 2000 },
]
const liveSum = summarizeLiveAgents(LIVE)
check('훅 집계: 개수', liveSum.running, 3)
check('훅 집계: 많은 종류가 먼저', liveSum.byType.map(t => t.type + ':' + t.count).join(','),
    'general-purpose:2,Explore:1')
check('훅 집계: 가장 먼저 뜬 시각', liveSum.oldestAt, 500)
check('훅 집계: 빈 목록', summarizeLiveAgents([]).running, 0)
check('훅 집계: null 도 0', summarizeLiveAgents(null).running, 0)
check('훅 집계: id 없는 항목은 세지 않는다',
    summarizeLiveAgents([{ id: '', type: 'x', at: 1 }]).running, 0)
check('훅 집계: 종류가 없으면 이름을 지어내지 않는다',
    summarizeLiveAgents([{ id: 'a', type: '', at: 1 }]).byType[0].type, '이름 없음')
check('훅 툴팁: 대화기록 쪽과 같은 머리 문구',
    formatLiveAgentTooltip(liveSum).split('\n')[0], '서브에이전트 3개 진행중')
check('훅 툴팁: 종류별 줄', formatLiveAgentTooltip(liveSum).split('\n')[1], '· general-purpose 2개')
check('훅 툴팁: 0개면 빈 문자열', formatLiveAgentTooltip(summarizeLiveAgents([])), '')

console.log(`\n총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
process.exit(fail ? 1 : 0)
