/**
 * 사이드바 "서브에이전트 개수" **배선** 회귀 프로브 (`SA1`~`SA9`) — `tools/run-all.ps1` 의 확장 프로브.
 *
 * **왜 별도 파일인가.** 개수를 세는 규칙은 순수 모듈(`src/subagents.ts`)이 갖고 있고 유닛 64건이
 * 지킨다. 여기서 재는 것은 그 규칙이 **화면까지 오는 길**이다 —
 *   훅 상태파일(`status\<sid>.json`) → 세션↔탭 → `~/.claude/projects` 폴더 훑기 → `statSync` 크기
 *   비교 → 자란 만큼만 스트림 읽기 → `StringDecoder` → 사이드바 `.ad-subagents` 칩.
 * 이 길에는 회귀 항목이 하나도 없었다. 유닛은 **문자열을 직접 먹이므로** 파일이 자라는 경로·오프셋·
 * 리셋·인코딩 경계·표시 자리를 통째로 못 본다. 그 공백을 여기서 메운다.
 *
 * ## 규칙을 베끼지 않는다
 *
 * 개수의 정답을 프로브가 다시 계산하면 그것은 `subagents.ts` 의 사본이고 사본은 낡는다
 * (`probe-all.js` 의 화면 판정 사본이 낡아 R2·R14 가 거짓 실패한 사고가 이 저장소의 교훈이다).
 * 그래서 프로브는 **자기가 쓴 픽스처의 내용**만 근거로 삼는다: 호출 3건 · 종료 알림 1건을 넣었으니
 * 도는 것은 2 다. 나머지(툴팁 문장·그려질 줄 순서)는 전부 제품에게 묻는다
 * (`__agentdeck.subagents()`, `__agentdeck.groups().plan`).
 *
 * ## 경로를 프로브가 만들지 않는다 (tools/README.md 의 그 함정)
 *
 *  - 대화기록 폴더는 **`subagents().projectsDir` 로 물어본다.** `os.homedir()` 로 만들면 제품이
 *    다른 곳을 보고 있을 때 조용히 어긋난다 (IN9·PR4·PR5 가 로그 경로에서 그렇게 뒤집혔다).
 *  - 상태파일 폴더는 진단구가 없다. 그래서 제품과 **같은 식**(`process.env.LOCALAPPDATA` +
 *    `tabby-agentdeck\status`, `notify.service.ts:156-160`)을 쓴다 — 프로브는 제품과 **같은
 *    프로세스 안**에서 도니 같은 env 를 읽으면 같은 폴더가 된다(격리 인스턴스도 이 값은 안 바꾼다,
 *    `test-instance.ps1`). 홈 디렉토리를 추측하는 것과는 다른 이야기다.
 *
 * ## 실사용 Tabby 를 건드리지 않는 장치 (중요)
 *
 * 상태파일 폴더는 **격리 인스턴스와 실사용 Tabby 가 공유한다**(`%LOCALAPPDATA%`). 그래서 보고에
 * **`tabId` 를 반드시 넣는다.** `tabId` 가 있고 그 표에 없으면 `resolveTab` 은 **추측하지 않고
 * null** 로 끝나므로(`notify.service.ts:790-797`), 실사용 Tabby 는 진단 로그 한 줄만 남기고 아무
 * 탭에도 묶지 않는다. tabId 없는 보고를 쓰면 그쪽의 "처음 보는 세션은 활성 탭" 규칙이 발동해
 * **사용자의 실제 탭에 라벨이 박힌다** — 그래서 legacy 경로는 쓰지 않는다.
 * 같은 이유로 보고에 `status` 를 넣지 않고 **`label` 만** 보낸다: `status` 가 오면 `setManual` 이
 * **pin 을 걸어**(`status.service.ts`) 뒤 프로브의 배지 판정이 전부 흔들린다(README 의 그 함정).
 * `label` 만 오는 보고도 묶기(`bind`)는 똑같이 타므로 배선 검증에는 충분하다.
 *
 * ## 내가 만든 것 (전부 지운다)
 *
 *  ⓐ `%LOCALAPPDATA%\tabby-agentdeck\status\<sid>.json`
 *  ⓑ `<projectsDir>\<sid>\<sid>.jsonl` — **사용자의 실제 대화기록이 사는 폴더 안**이다.
 * 그래서 세션 id 자체에 뚜렷한 접두 `agentdeck-probe-sa-` 를 박고, 지우기는 **그 접두로만** 한다.
 * 실제 폴더·파일 이름을 쓰는 삭제 코드는 이 파일에 없다. 정리 결과는 `SA9` 가 판정하고
 * (`probe-group.js` GR15 방식) 잔여 목록을 `cleanup` 에 남긴다.
 *
 * `pass: null` = **판정 불가**(환경이 조건을 못 만듦)이고 실패와 섞어 세지 않는다.
 */
(async () => {
    const ad = window.__agentdeck
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const sb = () => document.getElementById('agentdeck-sidebar')
    const listEl = () => (sb() ? sb().querySelector('.ad-list') : null)
    const rowEls = () => (sb() ? Array.from(sb().querySelectorAll('.ad-tab')) : [])
    /** 화면에 그려진 순서를 `app.tabs` 인덱스로 — 제품이 각 줄에 남기는 `data-ad-index` */
    const domSeq = () => rowEls().map(n => Number(n.dataset.adIndex))
    /** 줄은 **오직** 이 방법으로 찾는다 ("n 번째 줄 = n 번째 탭" 가정이 R16·R19 를 거짓 실패시켰다) */
    const rowOf = i => (listEl() ? listEl().querySelector('.ad-tab[data-ad-index="' + i + '"]') : null)
    const chipOf = i => {
        const r = rowOf(i)
        return r ? r.querySelector('.ad-subagents') : null
    }
    const chipCount = () => (sb() ? sb().querySelectorAll('.ad-subagents').length : 0)

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })

    /** 케이스 이름을 한 곳에만 둔다 — 판정할 때와 `판정 불가`로 채울 때 이름이 갈리지 않게 */
    const CASES = [
        ['SA1', '픽스처 기록 파일로 개수가 나온다 (상태파일 -> 탭 -> 대화기록)'],
        ['SA2', '증분 — 덧붙이면 개수가 따라 바뀐다 (+1 / -1)'],
        ['SA3', '화면 칩이 제품 상태와 일치 (자리·텍스트·툴팁)'],
        ['SA4', '0 이면 아무것도 그리지 않는다'],
        ['SA5', '끄면 읽기·표시 둘 다 멈추고 스캔 상태를 버린다'],
        ['SA6', '크기가 줄면 처음부터 다시 센다'],
        ['SA7', 'UTF-8 멀티바이트 경계에서 잘려도 설명이 안 깨진다'],
        ['SA8', 'data-ad-index 의 뜻·.ad-list 직계 자식 구성 불변'],
        ['SA9', '정리 확인 — 내가 만든 상태파일·대화기록 폴더 잔여 0'],
    ]
    const nameOf = id => (CASES.find(c => c[0] === id) || [id, id])[1]
    /** 아직 안 매긴 케이스를 `판정 불가`(pass:null)로 — 실패와 섞지 않는다 */
    const skipCases = (ids, reason, ev) => {
        for (const id of ids) {
            if (!results.some(r => r.id === id)) { add(id, nameOf(id), null, reason, ev || null) }
        }
    }
    const ALL_IDS = CASES.map(c => c[0])

    const NO_DIAG = '진단구 __agentdeck.subagents() 가 없다'
        + ' (낡은 dist 를 재고 있을 수 있다 — npm run build 후 재기동)'

    // ---------------------------------------------------------------- 공용 도구
    const sameArr = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])
    /** 조건이 참이 될 때까지 폴링 — 고정 대기로 2초 주기를 맞추려 하지 않는다 (README 의 그 함정) */
    const waitFor = async (fn, ms, step) => {
        const t0 = Date.now()
        for (;;) {
            let v = null
            try { v = fn() } catch { v = null }
            if (v) { return v }
            if (Date.now() - t0 >= ms) { return null }
            await sleep(step || 400)
        }
    }
    const safeGroups = () => {
        try {
            return typeof ad.groups === 'function' ? ad.groups() : null
        } catch {
            return null
        }
    }
    /** **제품이 말한 "그려져야 하는 줄과 그 순서"** — 펴진 plan 그룹의 `tabIndexes` 를 이어붙인 것 */
    const drawnExpect = g => (g && g.plan
        ? g.plan.filter(p => !p.collapsed).reduce((acc, p) => acc.concat(p.tabIndexes), [])
        : null)

    // ---------------------------------------------------------------- 픽스처 (직접 쓴다)
    //
    // **실제 대화기록을 복사하지 않는다** — 사용자 대화 내용이다. 모양은 `test/subagents.test.js` 의
    // 최소 JSON 을 그대로 쓴다(같은 실측 구조). 그 파일과 이 파일이 갈리면 유닛과 회귀가 다른 것을
    // 재게 되므로, 필드는 딱 그쪽에 있는 것만 둔다.
    const ID_A = 'toolu_probesa0000000001'
    const ID_B = 'toolu_probesa0000000002'
    const ID_C = 'toolu_probesa0000000003'
    const ID_D = 'toolu_probesa0000000004'
    const ID_E = 'toolu_probesa0000000005'
    const ID_F = 'toolu_probesa0000000006'
    /** 한글 설명 — UTF-8 3바이트 문자다. SA7 이 이 글자 **중간에서** 파일을 끊는다 */
    const DESC_KO = '서브에이전트 경계 시험'

    /** 호출 줄 = assistant 줄의 `message.content[]` 안 `tool_use` */
    const callLine = (id, desc, type) => JSON.stringify({
        parentUuid: 'u-probe',
        isSidechain: false,
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: {
            role: 'assistant',
            // `prompt` 를 일부러 넣는다 — 이것이 툴팁·라벨로 새면 사용자 대화 내용이 사이드바
            // title 로 새는 길이 열린다(제품 주석: description 이 정본). 새는지 SA3 이 본다
            content: [{ type: 'tool_use', id, name: 'Agent', input: { description: desc, subagent_type: type || 'fork', prompt: 'PROBE-PROMPT-BODY-SHOULD-NOT-LEAK' } }],
        },
    })
    /** 종료 알림 — 실측 세 모양 중 ① user 줄의 문자열 content */
    const notifyLine = (id, status) => JSON.stringify({
        type: 'user',
        isSidechain: false,
        message: {
            role: 'user',
            content: ['<task-notification>', '<task-id>t-' + id.slice(-4) + '</task-id>',
                '<tool-use-id>' + id + '</tool-use-id>',
                '<status>' + (status || 'completed') + '</status>', '</task-notification>'].join('\n'),
        },
    })
    /** 백그라운드 Agent 의 `tool_result` — 호출 바로 다음 줄에 오는 "띄웠다" 통지. **종료가 아니다** */
    const launchAck = id => JSON.stringify({
        type: 'user',
        isSidechain: false,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Async agent launched successfully.' }] },
    })

    // ---------------------------------------------------------------- 되돌릴 것들
    // finally 가 보려면 try **밖에서** 선언해야 한다 (probe-group.js·probe-reorder.js 의 그 함정)
    const cleanup = {}
    const cfg = ad.config.store.agentDeck
    const savedCount = cfg.subagentCount
    let nodeFs = null
    let nodePath = null
    let NodeBuffer = null
    let statusFile = null
    let fixtureDir = null
    let fixturePath = null
    let statusDir = null
    let projectsDir = null
    let targetTab = null
    let targetIdx = -1
    let savedLabel = null
    let cleanedUp = false
    /** 세션 id = 대화기록 파일명. 접두를 박아 두면 잔여를 **그 접두로만** 찾아 지울 수 있다 */
    const SID = 'agentdeck-probe-sa-' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0')
    const PREFIX = 'agentdeck-probe-sa-'

    const sub = () => {
        try {
            return typeof ad.subagents === 'function' ? ad.subagents() : null
        } catch {
            return null
        }
    }
    /** 내가 심은 세션의 지금 상태 — 없으면 null (아직 안 묶였다) */
    const mine = () => {
        const s = sub()
        return s && s.tabs ? (s.tabs.find(t => t.sessionId === SID) || null) : null
    }
    const sizeNow = () => {
        try {
            return nodeFs.statSync(fixturePath).size
        } catch {
            return -1
        }
    }
    const appendText = text => {
        nodeFs.appendFileSync(fixturePath, text, 'utf8')
        return sizeNow()
    }

    /**
     * 정리 — **케이스가 스스로 판정하려면 finally 가 아니라 함수여야 한다.** 정상 흐름 끝에서
     * 한 번 부르고 SA9 를 매기며, finally 에서 한 번 더 불러 예외로 빠진 판도 치운다(멱등).
     */
    const doCleanup = async () => {
        if (cleanedUp) { return cleanup }
        cleanedUp = true

        // ① 개수를 먼저 0 으로 내린다. **파일만 지우면 칩이 영영 남는다** — 파일이 사라지면
        //    `scanSubagents` 는 경로를 다시 찾을 뿐이고 마지막 `summary` 는 그대로라
        //    (`notify.service.ts:948-956`) 그 탭에 `❖N` 이 붙은 채 뒤 프로브가 그 화면을 잰다.
        //    빈 파일로 덮으면 크기가 줄어 리셋 경로를 타서 0 이 된다.
        if (nodeFs && fixturePath && cfg.subagentCount !== false) {
            try {
                nodeFs.writeFileSync(fixturePath, '', 'utf8')
                const drained = await waitFor(() => {
                    const m = mine()
                    return m && m.running === 0 ? m : null
                }, 12000)
                cleanup.countDrained = !!drained
                cleanup.chipGoneAt = await waitFor(() => (chipCount() === 0 ? 'yes' : null), 4000) || 'no'
            } catch (e) {
                cleanup.countDrained = String((e && e.message) || e)
            }
        }

        // ② 내가 만든 파일·폴더를 지운다 — **접두로만.** 실제 폴더 이름을 쓰는 코드는 두지 않는다
        if (nodeFs && nodePath) {
            if (statusFile) {
                try {
                    if (nodePath.basename(statusFile).indexOf(PREFIX) === 0) {
                        nodeFs.rmSync(statusFile, { force: true })
                    }
                    cleanup.statusRemoved = !nodeFs.existsSync(statusFile)
                } catch (e) {
                    cleanup.statusRemoved = String((e && e.message) || e)
                }
            }
            if (fixtureDir) {
                try {
                    // 접두를 다시 확인한다 — 이 한 줄이 사용자의 실제 대화기록 폴더를 지키는 마지막 문턱
                    if (nodePath.basename(fixtureDir).indexOf(PREFIX) === 0) {
                        nodeFs.rmSync(fixtureDir, { recursive: true, force: true })
                    }
                    cleanup.fixtureRemoved = !nodeFs.existsSync(fixtureDir)
                } catch (e) {
                    cleanup.fixtureRemoved = String((e && e.message) || e)
                }
            }
        }

        // ③ 설정·라벨 되돌리기
        cfg.subagentCount = savedCount
        try { await ad.config.save() } catch { /* 무시 */ }
        if (targetTab && savedLabel !== null && ad.app.tabs.indexOf(targetTab) >= 0) {
            try {
                // 라벨은 `setLabel` 로 들어갔다(pin 을 걸지 않는 경로) — 되돌리기도 값만 바꾼다
                ad.status.get(targetTab).label = savedLabel
                cleanup.labelRestored = ad.status.get(targetTab).label === savedLabel
            } catch (e) {
                cleanup.labelRestored = String((e && e.message) || e)
            }
        }
        try { ad.render() } catch { /* 무시 */ }

        // ④ 잔여 확인 — **접두로만** 훑는다
        const leftovers = (dir) => {
            try {
                return nodeFs.readdirSync(dir).filter(n => String(n).indexOf(PREFIX) === 0)
            } catch {
                return []
            }
        }
        cleanup.sid = SID
        cleanup.leftoverStatus = statusDir && nodeFs ? leftovers(statusDir) : []
        cleanup.leftoverProjects = projectsDir && nodeFs ? leftovers(projectsDir) : []
        cleanup.chips = chipCount()
        cleanup.subagentCount = cfg.subagentCount
        // 메모리에 남는 것 — 세션↔탭 묶기를 푸는 제품 경로가 없다(진단구도 읽기 전용).
        // 남아도 해가 없는 근거: 대화기록이 사라져 개수는 0 이고(위 ①), 다음 실제 보고가 오면
        // `bind()` 가 이전 주인을 조용히 풀며 가져간다(`notify.service.ts:820-834`).
        cleanup.sessionBindingLeft = !!mine()

        const created = !!(statusFile || fixtureDir)
        if (!created) {
            add('SA9', nameOf('SA9'), null, '만든 파일·폴더가 없다 (앞 단계에서 조건을 못 만들었다)',
                { cleanup })
        } else {
            const gone = cleanup.statusRemoved === true && cleanup.fixtureRemoved === true
            const none = cleanup.leftoverStatus.length === 0 && cleanup.leftoverProjects.length === 0
            const cfgOk = cfg.subagentCount === savedCount
            const pass9 = gone && none && cfgOk
            add('SA9', nameOf('SA9'), pass9,
                pass9
                    ? `내가 만든 상태파일·대화기록 폴더(${SID})를 지웠고, 접두 "${PREFIX}" 로 훑은`
                        + ' 잔여가 두 폴더 모두 0 개다 (설정도 원래대로)'
                    : `정리가 남았다 (상태파일삭제=${cleanup.statusRemoved} 폴더삭제=${cleanup.fixtureRemoved}`
                        + ` 잔여상태=${JSON.stringify(cleanup.leftoverStatus)}`
                        + ` 잔여기록=${JSON.stringify(cleanup.leftoverProjects)} 설정복원=${cfgOk})`,
                { cleanup })
        }
        return cleanup
    }

    try {
        if (typeof ad.subagents !== 'function') {
            skipCases(ALL_IDS, NO_DIAG, { hasSubagents: typeof ad.subagents })
            throw new Error('ad-sa-prereq')
        }
        if (!sb() || !listEl()) {
            skipCases(ALL_IDS, '사이드바/.ad-list 가 없다 (agentDeck.enabled 확인)',
                { sidebar: !!sb(), list: !!listEl() })
            throw new Error('ad-sa-prereq')
        }
        try {
            nodeFs = require('fs')
            nodePath = require('path')
            NodeBuffer = require('buffer').Buffer
        } catch {
            nodeFs = null
        }
        if (!nodeFs || !nodePath || !NodeBuffer) {
            skipCases(ALL_IDS, 'renderer 에서 require("fs"/"path"/"buffer") 를 못 잡았다'
                + ' — 픽스처 기록 파일을 만들 방법이 없다', null)
            throw new Error('ad-sa-prereq')
        }

        // 기능이 꺼진 채로 오면 배선을 잴 수 없다 — **켜고 잰 뒤 원래대로 되돌린다**(SA5 는 일부러 끈다)
        if (cfg.subagentCount === false) {
            cfg.subagentCount = true
            await ad.config.save()
        }

        const s0 = sub()
        projectsDir = s0 ? s0.projectsDir : null
        if (!projectsDir || !nodeFs.existsSync(projectsDir)) {
            // 여기서 폴더를 만들지 않는다 — 사용자의 `~/.claude` 아래에 없는 폴더를 프로브가
            // 세우는 것은 정리 범위를 넘는다(지울 때 실제 폴더를 지우게 된다)
            skipCases(ALL_IDS, `제품이 말한 대화기록 폴더가 없다: ${projectsDir}`
                + ' — 픽스처를 놓을 자리가 없다', { projectsDir })
            throw new Error('ad-sa-prereq')
        }
        // 제품과 **같은 식**으로 상태파일 폴더를 만든다 (모듈 주석의 근거)
        statusDir = ad.runtimePaths().status

        // ---------------------------------------------------------- 탭 고르기 (tabId 로 묶는다)
        /**
         * 그 탭의 `AGENTDECK_TAB` — 훅이 돌려보내는 값의 원천 그대로 읽는다
         * (`notify.service.ts:536` 이 같은 자리를 읽는다). 분할 탭은 패널마다 다르므로 여러 개다.
         */
        const tabIdsOf = tab => {
            const panes = typeof tab.getAllTabs === 'function' ? tab.getAllTabs() : [tab]
            const out = []
            for (const p of panes) {
                const v = p && p.profile && p.profile.options && p.profile.options.env
                    ? p.profile.options.env.AGENTDECK_TAB : null
                if (typeof v === 'string' && v && out.indexOf(v) < 0) { out.push(v) }
            }
            return out
        }
        // 제품 표에 실제로 실려 있는 id 인지 대조한다 — 표에 없으면 보고가 묶이지 않는다
        const known = new Set()
        try {
            for (const e of (typeof ad.tabIds === 'function' ? ad.tabIds() : [])) {
                for (const id of (e.ids || [])) { known.add(id) }
            }
        } catch { /* 진단구가 없으면 아래에서 판정 불가로 떨어진다 */ }
        // 이미 세션이 묶인 탭은 피한다 — 남의 세션을 빼앗으면 그 탭의 진짜 개수가 사라진다.
        // **단 지난 프로브가 남긴 세션(접두가 붙어 있다)은 예외다.** 세션↔탭 묶기를 푸는 제품
        // 경로가 없어서(`cleanup.sessionBindingLeft`) 같은 인스턴스에서 두 번째로 돌리면
        // "쓸 탭이 없다" 로 전부 판정 불가가 된다(실측: 2번째 실행이 SA1~SA9 전부 skip).
        // 다시 묶으면 `bind()` 가 이전 주인을 풀어 준다(`notify.service.ts:820-834`).
        const ownedIdx = new Set((s0.tabs || [])
            .filter(t => String(t.sessionId || '').indexOf(PREFIX) !== 0)
            .map(t => t.index))
        let chosenId = null
        for (let i = 0; i < ad.app.tabs.length; i++) {
            if (ownedIdx.has(i)) { continue }
            const ids = tabIdsOf(ad.app.tabs[i]).filter(id => known.has(id))
            if (ids.length && rowOf(i)) {
                targetTab = ad.app.tabs[i]
                targetIdx = i
                chosenId = ids[0]
                break
            }
        }
        if (!chosenId) {
            skipCases(ALL_IDS, '세션이 안 묶인 탭 중 AGENTDECK_TAB 이 심긴 줄을 못 찾았다'
                + ' — 상태파일 보고를 탭에 묶을 수 없다 (tabId 없이 보내면 실사용 Tabby 의 활성 탭에'
                + ' 라벨이 박히므로 legacy 경로는 쓰지 않는다)',
            { tabs: ad.app.tabs.length, known: [...known], owned: [...ownedIdx] })
            throw new Error('ad-sa-prereq')
        }

        // ---------------------------------------------------------- 픽스처와 상태파일 심기
        // **픽스처를 먼저** 쓴다 — 세션이 묶인 뒤 첫 폴더 훑기에서 파일이 이미 있어야 한다.
        // 없으면 `TRANSCRIPT_LOOKUP_RETRY_MS`(10초) 를 기다려야 한다
        fixtureDir = nodePath.join(projectsDir, SID)
        fixturePath = nodePath.join(fixtureDir, SID + '.jsonl')
        nodeFs.mkdirSync(fixtureDir, { recursive: true })
        // 호출 3건(A·B·C) · A 의 launch ack · C 의 종료 알림 => **도는 것은 2 (A·B)**
        const baseLines = [
            callLine(ID_A, 'probe A', 'fork'),
            launchAck(ID_A),
            callLine(ID_B, 'probe B', null),
            callLine(ID_C, 'probe C', 'fork'),
            notifyLine(ID_C, 'completed'),
        ]
        nodeFs.writeFileSync(fixturePath, baseLines.join('\n') + '\n', 'utf8')

        statusFile = nodePath.join(statusDir, SID + '.json')
        nodeFs.mkdirSync(statusDir, { recursive: true })
        savedLabel = ad.status.get(targetTab).label
        // `status` 를 넣지 않는 이유 = 모듈 주석 (setManual 이 pin 을 건다). `label` 만으로도 bind 를 탄다
        nodeFs.writeFileSync(statusFile, JSON.stringify({
            sessionId: SID, tabId: chosenId, label: 'ad-sa-probe', ts: Date.now(),
        }), 'utf8')

        // 묶기까지 — 폴링이 400ms 라 한두 바퀴면 온다
        const bound = await waitFor(() => mine(), 6000)
        if (!bound) {
            skipCases(ALL_IDS, '상태파일을 썼는데 6초 안에 세션이 탭에 묶이지 않았다'
                + ' (notifyChannel 이 꺼져 있거나 훅 채널이 안 뜬 판) — 조건 미충족',
            { statusFile, chosenId, targetIdx, subagents: sub() })
            throw new Error('ad-sa-prereq')
        }

        // ============================================================ SA1 픽스처 -> 개수
        // 배선 전체를 한 번에 본다: 상태파일이 그 **탭**에 묶였고, 폴더를 훑어 대화기록을 찾았고,
        // 크기만큼 읽어 개수가 나왔다. `launchAck` 를 일부러 끼웠으므로 `done` 이 2 로 세지면
        // "tool_result 를 종료로 봤다" 는 회귀가 여기서 잡힌다.
        const m1 = await waitFor(() => {
            const m = mine()
            return m && m.transcript && m.lastSize > 0 ? m : null
        }, 25000)
        const fixtureSize = sizeNow()
        if (!m1) {
            const m = mine()
            add('SA1', nameOf('SA1'), false,
                '25초를 기다려도 대화기록을 못 찾았거나 한 바이트도 읽지 않았다'
                    + ` (transcript=${m ? m.transcript : 'n/a'} lastSize=${m ? m.lastSize : 'n/a'},`
                    + ` 파일은 실제로 있다=${nodeFs.existsSync(fixturePath)} ${fixtureSize}B)`,
                { fixturePath, projectsDir, tab: m })
        } else {
            const idxOk = m1.index === targetIdx
            const pathOk = String(m1.transcript) === fixturePath
            const sizeOk = m1.lastSize === fixtureSize
            const countOk = m1.running === 2 && m1.calls === 3 && m1.done === 1
            const descOk = sameArr(m1.items.map(i => i.description), ['probe A', 'probe B'])
            const pass1 = idxOk && pathOk && sizeOk && countOk && descOk
            add('SA1', nameOf('SA1'), pass1,
                pass1
                    ? `상태파일(tabId=${chosenId}) 이 ${targetIdx} 번 탭에 묶이고, 폴더를 훑어`
                        + ` 대화기록(${fixtureSize}B)을 찾아 전부 읽었다 — 호출 3 · 종료 1 · 도는 중 2`
                        + ' (launch ack 를 종료로 세지 않았다), 목록 순서도 호출 순서다'
                    : `배선이 어긋난다 (탭일치=${idxOk} 경로일치=${pathOk} 다읽음=${sizeOk}`
                        + ` 개수=${m1.running}/${m1.calls}/${m1.done}(기대 2/3/1) 목록=${descOk})`,
                { tab: m1, fixtureSize, fixturePath, targetIdx, chosenId })
        }

        // ============================================================ SA2 증분
        // **배선의 핵심.** 유닛은 문자열을 먹이므로 "파일이 자란 만큼만 읽는" 경로는 여기서만
        // 검증된다. 호출 1건 추가 -> +1, 그 종료 알림 추가 -> -1.
        {
            const before = mine()
            const size1 = appendText(callLine(ID_D, 'probe D', 'fork') + '\n')
            const up = await waitFor(() => {
                const m = mine()
                return m && m.running === 3 && m.calls === 4 ? m : null
            }, 15000)
            const size2 = appendText(notifyLine(ID_D, 'completed') + '\n')
            const down = await waitFor(() => {
                const m = mine()
                return m && m.running === 2 && m.done === 2 ? m : null
            }, 15000)
            const now = mine()
            // "자란 만큼만" 의 증거 — 오프셋이 파일 끝까지 따라왔고 줄을 다시 세지 않았다
            const offsetOk = !!now && now.lastSize === size2 && now.lines === 7
            const pass2 = !!up && !!down && offsetOk
            add('SA2', nameOf('SA2'), pass2,
                pass2
                    ? `호출 1건을 덧붙이자 2 -> 3, 그 종료 알림을 덧붙이자 3 -> 2 로 따라왔다`
                        + ` (오프셋 ${before ? before.lastSize : '?'} -> ${size1} -> ${size2}B, 누적 줄 7)`
                    : `증분이 안 따라온다 (+1=${!!up} -1=${!!down} 오프셋일치=${offsetOk}`
                        + ` 지금=${now ? now.running + '/' + now.calls + '/' + now.done + ' ' + now.lastSize + 'B/' + now.lines + '줄' : 'null'}`
                        + ` 기대=2/4/2 ${size2}B/7줄)`,
                { before, afterUp: up, afterDown: down, now, size1, size2 })
        }

        // ============================================================ SA3 화면과 제품 상태
        // **`ad.render()` 를 부르지 않는다.** 개수는 2초 스캔이 갱신하고 그림은 1초 tick 이
        // 그리는데(`deck.service.ts:3649-3654`), 프로브가 손으로 그리면 그 tick 이 죽어도 초록이
        // 된다 — 사용자 화면에는 숫자가 영영 안 바뀌는 상태다. 그래서 **제품이 스스로 그리기를
        // 기다린다.**
        {
            const m0 = mine()
            if (!m0 || m0.running <= 0) {
                skipCases(['SA3'], `도는 중이 ${m0 ? m0.running : 'n/a'} 개다 — 칩이 그려질 화면이 아니다`, { tab: m0 })
            } else {
                /**
                 * **개수와 글자를 같은 순간에 읽어야 한다.** 개수는 2초 스캔이 올리고 글자는 1초
                 * tick 이 그리므로 그 사이에는 화면이 최대 한 tick 뒤처진다 — 따로 읽으면
                 * "❖3 인데 running 2" 같은 거짓 실패가 난다(2026-09-09 실측으로 이 프로브가 한 번
                 * 그렇게 뒤집혔다). 그래서 **한 바퀴 안에서 둘을 같이 읽어** 일치할 때까지 기다린다.
                 * 수렴하지 않으면 그것은 진짜 결함(숫자가 화면에 안 온다)이므로 실패로 적는다.
                 */
                let obs = null
                const seen = await waitFor(() => {
                    const m = mine()
                    const c = chipOf(targetIdx)
                    obs = { running: m ? m.running : null, text: c ? c.textContent : null }
                    if (!m || m.running <= 0 || !c) { return null }
                    return c.textContent === '❖' + m.running ? { m, chip: c } : null
                }, 8000)
                if (!seen) {
                    add('SA3', nameOf('SA3'), false,
                        `8초를 기다려도 화면 칩이 개수와 맞지 않았다 (running=${obs ? obs.running : 'n/a'}`
                            + ` 칩글자=${obs ? JSON.stringify(obs.text) : 'n/a'})`
                            + ' — 표시 배선 또는 1초 tick 의 렌더 조건(deck.service.ts:3652)을 볼 것',
                        { obs, tab: mine(), rows: rowEls().length, chips: chipCount() })
                } else {
                    const m = seen.m
                    const chip = seen.chip
                    const prev = chip.previousElementSibling
                    const next = chip.nextElementSibling
                    const inMeta = !!chip.parentElement && chip.parentElement.classList.contains('ad-meta')
                    const textOk = chip.textContent === '❖' + m.running
                    const orderOk = !!prev && prev.classList.contains('ad-badge')
                        && !!next && next.classList.contains('ad-elapsed')
                    const title = chip.title || ''
                    // 툴팁 첫 줄만 대조한다 — 뒷줄에 경과 시간이 붙어 매초 바뀐다(제품이 매번 새로 만든다)
                    const head = String(m.tooltip || '').split('\n')[0]
                    const tipOk = !!title && !!head && title.split('\n')[0] === head
                    // 지시문 전문이 title 로 새지 않는다 (제품 주석의 그 계약)
                    const noLeak = title.indexOf('PROBE-PROMPT-BODY') < 0
                    const pass3 = inMeta && textOk && orderOk && tipOk && noLeak
                    add('SA3', nameOf('SA3'), pass3,
                        pass3
                            ? `그 줄의 .ad-meta 안에서 칩이 **배지 다음 · 경과시간 앞**에 있고 글자가`
                                + ` "${chip.textContent}"(= running ${m.running}), 툴팁 첫 줄이 제품 문장과`
                                + ' 같으며 지시문 전문은 새지 않았다'
                            : `칩 표시가 어긋난다 (.ad-meta안=${inMeta} 글자="${chip.textContent}"`
                                + `(기대 ❖${m.running}) 형제순서=${orderOk}`
                                + `(앞=${prev ? prev.className : 'null'} 뒤=${next ? next.className : 'null'})`
                                + ` 툴팁=${tipOk} 지시문안샘=${noLeak})`,
                        { running: m.running, text: chip.textContent, title,
                            prevClass: prev ? prev.className : null, nextClass: next ? next.className : null,
                            productTooltip: m.tooltip })
                }
            }
        }

        // ============================================================ SA4 0 이면 안 그린다
        // 화면의 칩 개수 == running>0 인 탭 수. **0 인 탭이 화면에 하나는 있어야** 이 케이스가
        // 뜻을 갖는다 — 전부 도는 화면에서는 "0 이면 안 그린다" 를 아무것도 검증하지 못한다.
        {
            // 화면과 상태를 **한 바퀴 안에서 같이** 읽는다 (SA3 과 같은 이유 — 렌더가 한 tick
            // 뒤처지는 구간이 있다). 수렴하지 않으면 마지막 관측으로 실패를 적는다
            let look = null
            const agreed = await waitFor(() => {
                const s = sub()
                const hot = (s && s.tabs ? s.tabs : []).filter(t => t.running > 0)
                const drawn = domSeq()
                const hotDrawn = hot.filter(t => drawn.indexOf(t.index) >= 0)
                const zeroRows = drawn.filter(i => !hot.some(t => t.index === i))
                const chips = chipCount()
                look = { hot, drawn, hotDrawn, zeroRows, chips }
                return chips === hotDrawn.length ? look : null
            }, 6000)
            const { hot, drawn, hotDrawn, zeroRows, chips } = look
            if (!zeroRows.length) {
                skipCases(['SA4'], '화면의 모든 줄이 running>0 이다 — "0 이면 안 그린다" 를 가릴 수 없다',
                    { drawn, hot })
            } else {
                const pass4 = !!agreed && chips === hotDrawn.length
                    && zeroRows.every(i => chipOf(i) === null)
                add('SA4', nameOf('SA4'), pass4,
                    pass4
                        ? `화면 칩 ${chips}개 == running>0 인 줄 ${hotDrawn.length}개이고,`
                            + ` 0 인 줄 ${zeroRows.length}개에는 노드가 아예 없다`
                        : `0 인 줄에도 칩이 있거나 개수가 어긋난다 (칩=${chips}`
                            + ` running>0줄=${hotDrawn.length} 0인줄=${JSON.stringify(zeroRows)}`
                            + ` 그중칩있는줄=${JSON.stringify(zeroRows.filter(i => !!chipOf(i)))})`,
                    { chips, hot, zeroRows, drawn })
            }
        }

        // ============================================================ SA7 UTF-8 경계
        // 증분 읽기는 **바이트 오프셋**으로 끊으므로 한글(3바이트)이 경계에서 쪼개진다. 제품이
        // `StringDecoder` 를 들고 있는 이유가 이것이고(`SubagentScan` 주석), 그 처리를
        // `Buffer.toString()` 으로 되돌리면 대체문자가 박혀 그 줄이 JSON 이 아니게 된다
        // (= 개수가 안 늘고 `skipped` 만 오른다). 그래서 **한 글자 중간에서** 두 번에 나눠 쓴다.
        {
            const before = mine()
            const line = callLine(ID_E, DESC_KO, 'fork') + '\n'
            const buf = NodeBuffer.from(line, 'utf8')
            let cut = -1
            for (let i = 0; i < buf.length; i++) {
                // UTF-8 3바이트 문자의 선두 바이트(0xE0~0xEF) 바로 뒤에서 끊는다 = 이어지는
                // 바이트가 다음 청크로 넘어간다
                if (buf[i] >= 0xE0 && buf[i] <= 0xEF) { cut = i + 1; break }
            }
            if (cut <= 0 || !before) {
                skipCases(['SA7'], cut <= 0
                    ? '픽스처 줄에서 멀티바이트 문자를 못 찾았다 — 경계를 만들 수 없다'
                    : '내 세션 상태를 읽을 수 없다', { cut, before })
            } else {
                nodeFs.appendFileSync(fixturePath, buf.slice(0, cut))
                const half = sizeNow()
                // **첫 조각이 실제로 읽혀야** 경계가 스캔 사이에 걸린 것이다. 안 걸렸으면
                // 한 청크로 다 읽힌 것이므로 이 케이스는 아무것도 재지 못했다 = 판정 불가
                const read1 = await waitFor(() => {
                    const m = mine()
                    return m && m.lastSize === half ? m : null
                }, 9000)
                nodeFs.appendFileSync(fixturePath, buf.slice(cut))
                const full = sizeNow()
                const done = await waitFor(() => {
                    const m = mine()
                    return m && m.lastSize === full && m.calls === 5 ? m : null
                }, 15000)
                if (!read1) {
                    skipCases(['SA7'], '첫 조각(멀티바이트 중간까지)이 9초 안에 읽히지 않아'
                        + ' 경계가 스캔 사이에 걸리지 않았다 — 판정 불가',
                    { half, full, now: mine() })
                } else if (!done) {
                    const m = mine()
                    add('SA7', nameOf('SA7'), false,
                        '멀티바이트 중간에서 끊어 이어 쓴 호출 줄이 15초 안에 집계되지 않았다'
                            + ` (지금 calls=${m ? m.calls : 'n/a'} lastSize=${m ? m.lastSize : 'n/a'}/${full}`
                            + ` skipped=${m ? m.skipped : 'n/a'}) — 경계에서 줄이 깨졌을 가능성`,
                        { half, full, read1, now: m })
                } else {
                    const item = done.items.find(i => i.id === ID_E) || null
                    const descOk = !!item && item.description === DESC_KO
                    const skipOk = done.skipped === before.skipped
                    const tipOk = String(done.tooltip || '').indexOf(DESC_KO) >= 0
                    const pass7 = descOk && skipOk && tipOk
                    add('SA7', nameOf('SA7'), pass7,
                        pass7
                            ? `한글 설명이 든 호출 줄을 3바이트 문자 중간(${cut}B)에서 끊어 두 번에`
                                + ` 나눠 붙였는데(${half} -> ${full}B) 설명이 "${DESC_KO}" 그대로 들어오고`
                                + ' 툴팁에도 그대로 실렸다 (버린 줄도 늘지 않았다)'
                            : `경계에서 글자가 깨졌다 (설명="${item ? item.description : 'null'}"`
                                + ` 기대="${DESC_KO}" 버린줄=${before.skipped}->${done.skipped}`
                                + ` 툴팁에있나=${tipOk})`,
                        { cut, half, full, item, tooltip: done.tooltip, skipped: done.skipped })
                }
            }
        }

        // ============================================================ SA5 끄면 둘 다 멈춘다
        // 끈 기능이 2초마다 파일을 계속 읽고 있으면 안 되고(읽기), 칩도 사라져야 한다(표시).
        // 그리고 **들고 있던 스캔 상태를 버려야** 한다 — 안 버리면 꺼 둔 사이의 종료 알림을 못 본
        // 유령 개수가 그대로 되살아난다(`scanSubagents` 주석).
        {
            const before = mine()
            cfg.subagentCount = false
            await ad.config.save()
            // 스캔 주기(2초)를 한 번은 넘겨야 `scans.clear()` 가 돈다
            const off = await waitFor(() => {
                const s = sub()
                if (!s || s.enabled !== false) { return null }
                const dropped = (s.tabs || []).every(t => t.lastSize === 0 && t.running === 0)
                return dropped ? s : null
            }, 9000)
            const chipsGone = await waitFor(() => (chipCount() === 0 ? 'yes' : null), 5000)
            const s = sub()
            const pass5 = !!off && chipsGone === 'yes'
            add('SA5', nameOf('SA5'), pass5,
                pass5
                    ? 'subagentCount=false 로 두자 진단구 enabled=false · 화면 칩 0개 ·'
                        + ' 모든 탭의 lastSize 가 0 이 됐다 (스캔 상태를 버렸다)'
                    : `끈 뒤에도 남는다 (enabled=${s ? s.enabled : 'n/a'} 칩=${chipCount()}개`
                        + ` lastSize=${JSON.stringify((s && s.tabs ? s.tabs : []).map(t => t.lastSize))}`
                        + ` showElapsed=${cfg.showElapsed})`,
                { before, off: s, chipsGone })

            // 다시 켠다 — 파일 앞부터 새로 센다(그것이 제품이 말한 규칙이다). SA6 이 이 상태를 쓴다
            cfg.subagentCount = true
            await ad.config.save()
        }

        // ============================================================ SA6 크기가 줄면 리셋
        // 픽스처를 **작게 다시 써서** 옛 집계가 남지 않는지 본다. 리셋이 없으면 지운 호출이
        // 영영 도는 중으로 남는다(오프셋만 뒤로 가고 상태는 그대로).
        {
            const back = await waitFor(() => {
                const m = mine()
                return m && m.lastSize > 0 && m.calls >= 5 ? m : null
            }, 20000)
            if (!back) {
                skipCases(['SA6'], '다시 켠 뒤 20초 안에 재스캔이 끝나지 않아 "줄어들기 전" 상태를'
                    + ' 만들지 못했다 — 판정 불가', { now: mine() })
            } else {
                const bigSize = back.lastSize
                // 호출 1건만 남긴다 => 도는 중 1 · 호출 1 · 종료 0
                nodeFs.writeFileSync(fixturePath, callLine(ID_F, 'probe F', 'fork') + '\n', 'utf8')
                const small = sizeNow()
                if (small >= bigSize) {
                    skipCases(['SA6'], `새 파일(${small}B)이 옛 파일(${bigSize}B)보다 작지 않아`
                        + ' 리셋 조건을 만들지 못했다', { bigSize, small })
                } else {
                    const after = await waitFor(() => {
                        const m = mine()
                        return m && m.lastSize === small && m.calls === 1 ? m : null
                    }, 15000)
                    const now = mine()
                    const pass6 = !!after && after.running === 1 && after.done === 0 && after.lines === 1
                    add('SA6', nameOf('SA6'), pass6,
                        pass6
                            ? `${bigSize}B -> ${small}B 로 줄이자 오프셋·집계를 통째로 버리고 다시 셌다`
                                + ' (호출 1 · 종료 0 · 도는 중 1 · 누적 줄 1)'
                            : `크기가 줄었는데 옛 집계가 남았다 (지금=${now ? now.running + '/' + now.calls
                                + '/' + now.done + ' ' + now.lastSize + 'B/' + now.lines + '줄' : 'null'}`
                                + ` 기대=1/1/0 ${small}B/1줄) — 리셋 경로를 볼 것`,
                        { bigSize, small, after, now })
                }
            }
        }

        // ============================================================ SA8 줄 식별자·목록 구성
        // **칩이 생겼어도 다른 회귀가 줄을 찾는 방법은 그대로여야 한다.** `data-ad-index` 가
        // "보이는 순서" 로 바뀌거나 칩이 `.ad-list` 직계 자식으로 붙으면 R41·RO2·GR2 가 한꺼번에
        // 거짓 실패한다. 그려질 줄의 정답은 프로브가 계산하지 않고 제품(`groups().plan`)에게 묻는다.
        {
            const g = safeGroups()
            const want = drawnExpect(g)
            const seq = domSeq()
            const host = listEl()
            const kids = host ? Array.from(host.children) : []
            const kidClasses = kids.map(n => n.className)
            const onlyKnown = kids.every(n => n.classList.contains('ad-tab') || n.classList.contains('ad-group-head'))
            const chipDirect = kids.filter(n => n.classList.contains('ad-subagents')).length
            const chips = sb() ? Array.from(sb().querySelectorAll('.ad-subagents')) : []
            const chipsNested = chips.every(c => c.parentElement && c.parentElement.classList.contains('ad-meta'))
            const validInts = seq.length > 0 && seq.every(n => Number.isInteger(n) && n >= 0)
            const unique = new Set(seq).size === seq.length
            if (!want) {
                add('SA8', nameOf('SA8'), null, '진단구 __agentdeck.groups() 가 없어 "그려져야 하는 줄"을'
                    + ' 제품에게 물을 수 없다', { seq, kidClasses })
            } else {
                const match = sameArr(seq, want)
                const pass8 = validInts && unique && match && onlyKnown && chipDirect === 0 && chipsNested
                add('SA8', nameOf('SA8'), pass8,
                    pass8
                        ? `칩이 그려진 화면에서도 줄마다 유효한 app.tabs 인덱스가 중복 없이 붙고`
                            + ` 제품이 말한 순서(${JSON.stringify(want)})와 같으며, .ad-list 직계 자식은`
                            + ' 여전히 줄·헤더뿐이다 (칩은 전부 .ad-meta 안)'
                        : `줄 식별자·목록 구성이 어긋난다 (유효=${validInts} 중복없음=${unique}`
                            + ` 제품순서일치=${match}(화면=${JSON.stringify(seq)} 제품=${JSON.stringify(want)})`
                            + ` 직계자식이 줄·헤더뿐=${onlyKnown} 직계칩=${chipDirect}`
                            + ` 칩이.ad-meta안=${chipsNested})`,
                    { seq, want, kidClasses, chipDirect, chipsNested, chips: chips.length })
            }
        }

        // 정상 흐름의 정리 — SA9 를 여기서 매긴다 (finally 는 예외 판을 위한 안전망)
        await doCleanup()
    } catch (e) {
        if (String((e && e.message) || e) !== 'ad-sa-prereq') {
            add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
        }
        // 예외가 났어도 **안 매긴 케이스는 판정 불가로 채운다** — 결과에서 통째로 빠지면
        // 요약만 조용히 짧아져 "그 케이스는 재지도 않았다" 를 아무도 모른다
        skipCases(ALL_IDS.filter(id => id !== 'SA9'),
            `프로브가 도중에 멈췄다: ${String((e && e.message) || e)}`, null)
    } finally {
        // 안전망 — 예외로 빠졌으면 여기서 치우고 SA9 를 매긴다 (멱등: 정상 흐름은 이미 돌았다)
        try {
            await doCleanup()
        } catch (e) {
            cleanup.error = String((e && e.message) || e)
            skipCases(['SA9'], `정리 중 예외: ${cleanup.error}`, { cleanup })
        }
        skipCases(ALL_IDS, '프로브 흐름이 이 케이스에 닿지 못했다 (앞 단계의 사유를 볼 것)', null)
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
    }
    // `cleanup` 은 케이스가 아니다 — 러너는 `results` 만 집계하므로(run-all.ps1 의 foreach)
    // 여기 실린 정리 결과는 요약 수치를 흔들지 않고 사람이 사후에 볼 증거로만 남는다
    return JSON.stringify({ summary, results, cleanup }, null, 1)
})()
