/**
 * 에이전트 **관측 채집** 프로브 — `docs/AGENT-OBSERVATION.md` 의 절차가 쓰는 도구.
 *
 *   powershell -File tools/test-instance.ps1        # 격리 인스턴스
 *   # 그 안의 탭에서 codex / gemini 를 직접 띄운 뒤
 *   node tools/cdp.js 9222 tools/probe-agent-observe.js
 *
 * **다른 프로브와 목적이 다르다.** `probe-all.js` 계열은 "규칙대로 도는가" 를 판정한다.
 * 이 파일은 **"지금 이 탭에서 도는 에이전트가 무엇을 찍는지" 를 채집**한다 — Codex 는
 * 이미지 키(`0x16`)와 프로세스 힌트만, Gemini 는 아무것도 실측이 없어서(`src/agents.ts:145`,
 * `src/agents.ts:172`) 두 프로필이 `patternsProven: false` 로 남아 있고, 그래서 상태 판정에
 * 합집합이 쓰인다(`src/agents.ts:273` `detectProfileFor`). 그 값을 채우려면 **실물 CLI 가
 * 무엇을 찍는지 원문으로 봐야** 한다.
 *
 * 그래서 대부분의 항목은 `pass` 를 내지 않고 채집값을 `evidence` 에 남긴다
 * (`pass: null` = 판정 불가/판정 대상 아님 — `tools/README.md` 의 규약과 같다).
 * **판정하는 항목은 둘뿐이다** — AO7(실측 없는 프로필의 안전장치)·AO8(판정 진단 줄).
 *
 * 결과 형식은 형제 프로브와 같다: `{ id, name, pass, detail, evidence }` + `summary`.
 * id 는 `AO1`~`AO8`. `docs/REGRESSION.md` 의 R 번호는 메인이 배리어에서 매긴다.
 *
 * **자기가 바꾼 것은 되돌린다** — AO8 이 제목을 잠깐 위조하므로 `finally` 에서 원복한다.
 * **화면·입력을 건드리지 않는다** — 채집은 읽기다. 에이전트가 도는 탭에 바이트를 쓰면
 * 그 탭의 대화가 오염되고, 그러면 다음 국면(작업중/승인대기) 채집이 못 쓰게 된다.
 *
 * 리터럴 제어문자·리터럴 스피너를 이 파일에 넣지 않는다 — NUL 사고(`docs/DEVELOPMENT.md:417`)
 * 와 같은 이유로 전부 유니코드 이스케이프로 적는다.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')

    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다 — 플러그인이 안 떴다' }) }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    /** 글자를 코드포인트로 — 사람이 프로필에 옮겨 적을 수 있어야 하므로 `\uXXXX` 표기까지 준다 */
    const cp = ch => {
        const n = ch.codePointAt(0)
        return { ch, cp: 'U+' + n.toString(16).toUpperCase().padStart(4, '0'), esc: '\\u' + n.toString(16).padStart(4, '0') }
    }
    /** 비ASCII 문자만 (중복 제거) — 제목 스피너·테두리 후보를 고를 때 쓴다 */
    const nonAscii = s => [...new Set([...String(s || '')].filter(c => c.codePointAt(0) > 0x7f))]
    const clip = (s, n) => {
        const t = String(s == null ? '' : s)
        return t.length > n ? t.slice(0, n) + '…' : t
    }

    const panes = () => {
        const out = []
        const walk = t => {
            if (!t) { return }
            if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { out.push(t) }
        }
        ad.app.tabs.forEach(walk)
        return out.filter(p => p.frontend && p.frontend.xterm)
    }
    /** 그 탭의 첫 pane — `deck.service.ts:1688` `firstPane` 과 같은 규칙(프로세스를 물어볼 대상) */
    const firstPaneOf = root => {
        if (!root) { return null }
        return typeof root.getAllTabs === 'function' ? (root.getAllTabs()[0] ?? null) : root
    }
    const activeRoot = () => ad.app.activeTab ?? ad.app.tabs[0] ?? null

    /**
     * 리포 루트 — `src/`·`.tmp/` 를 읽어 **제품 값**을 대조하기 위해 필요하다.
     * 찾는 방법은 `tools/probe-input.js:200` `rootCandidates` 와 같다 (거기 주석이 근거).
     * 못 찾으면 메인이 `window.__agentdeckProbeRoot = '<리포경로>'` 를 먼저 넣어주면 된다.
     */
    const findRepoRoot = () => {
        const cands = []
        const push = v => { if (v && cands.indexOf(v) < 0) { cands.push(v) } }
        push(window.__agentdeckProbeRoot)
        const la = (typeof process !== 'undefined' && process.env && process.env.LOCALAPPDATA) || ''
        if (la) { push(path.join(la, 'tabby-agentdeck-test', 'ud', 'plugins', 'node_modules', 'tabby-agentdeck')) }
        try {
            for (const k of Object.keys(require.cache || {})) {
                const m = /^(.*[\\/]tabby-agentdeck)[\\/]/.exec(k)
                if (m) { push(m[1]) }
            }
        } catch { /* require.cache 를 못 본다 */ }
        try {
            let d = process.cwd()
            for (let i = 0; i < 6 && d; i++) {
                push(d)
                const up = path.dirname(d)
                if (up === d) { break }
                d = up
            }
        } catch { /* 무시 */ }
        for (const c of cands) {
            try {
                if (fs.existsSync(path.join(c, 'src', 'agents.ts'))
                    && fs.existsSync(path.join(c, 'src', 'deck.service.ts'))) { return c }
            } catch { /* 다음 후보 */ }
        }
        return null
    }
    const root = findRepoRoot()

    /**
     * 프로필 규칙의 **출처**.
     *
     * 1순위는 `.tmp/agents.js` — `npm test` 가 `src/agents.ts` 를 그대로 컴파일해 두는 것이라
     * (package.json `test` 스크립트) 정규식 객체를 **제품과 동일하게** 받을 수 있다.
     * 규칙을 프로브에 복사해 두면 그 사본이 낡는다 — `probe-all.js:112` 가 실제로 그래서
     * 거짓 실패를 냈다(2026-09-08).
     *
     * 없거나 낡았을 때만 아래 `FALLBACK` 을 쓴다. 그건 `src/agents.ts:79`~`:126` 의 사본이고,
     * 사본을 쓴 사실을 `via`/`stale` 로 결과에 남긴다 — 채집 결과를 믿을지 사람이 정하게.
     */
    const FALLBACK = {
        via: 'fallback-copy',
        // agents.ts:105 (claude waitingPatterns) + 공통 조각 79~81
        waiting: [/Do you want to\b/i, /❯\s*1\.\s*Yes/, /\(y\/n\)/i, /\[y\/N\]/i, /Press Enter to continue/i],
        // agents.ts:117 (claude busyPatterns) + 공통 83
        busy: [/esc to interrupt/i, /ctrl\+c to (?:interrupt|cancel|stop)/i, /\btokens?\b.{0,20}\besc\b/i],
        // agents.ts:126 — 별·원형 스피너 9종 (2026-08-28 실측)
        marks: ['✳', '✻', '✽', '✶', '✢', '◐', '◓', '◑', '◒'],
        heads: ['>', '❯', '›', '❭', '➜'],
    }
    const loadAgents = () => {
        // **1순위는 실행 중인 플러그인의 진단구다** (`__agentdeck.profiles()`, `deck.service.ts`).
        // `.tmp/agents.js` 보다 이게 낫다 — 지금 화면을 돌리고 있는 그 코드의 값이라 낡을 수가 없다.
        // 정규식은 JSON 을 못 넘으므로 진단구가 `{source, flags}` 로 펼쳐 주고, 여기서 되살린다.
        // (2026-09-08: `.tmp` 는 `npm test` 산출물이라 없거나 src 보다 낡을 수 있다는 지적을 받아
        //  제품에 진단구를 열었다. 규칙 사본이 낡아 거짓 실패를 낸 사고가 이미 있었다 — probe-all.js:112)
        try {
            if (ad.profiles) {
                const dump = ad.profiles()
                const re = arr => (arr || []).map(r => new RegExp(r.source, r.flags))
                const mod = {
                    AGENT_PROFILES: dump.list.map(p => Object.assign({}, p, {
                        waitingPatterns: re(p.waitingPatterns),
                        busyPatterns: re(p.busyPatterns),
                    })),
                    unionProfile: () => Object.assign({}, dump.union, {
                        waitingPatterns: re(dump.union.waitingPatterns),
                        busyPatterns: re(dump.union.busyPatterns),
                    }),
                    // 판정에 실제로 쓰이는 형태 — 진단구가 이미 detectProfileFor 를 거쳐 준다
                    effective: dump.effective,
                    // 식별은 진단구가 제품 함수를 그대로 불러 준다 (판정 순서를 사본으로 갖지 않게)
                    identifyAgent: (procs, title) => (dump.identify
                        ? dump.identify(procs, title)
                        : (ad.profiles && typeof ad.profiles().identify === 'function'
                            ? ad.profiles().identify(procs, title)
                            : null)),
                    profileFor: id => {
                        const found = dump.list.find(p => p.id === id)
                        return found || dump.union
                    },
                    detectProfileFor: id => {
                        const found = dump.effective.find(p => p.id === id)
                        const base = found || dump.union
                        return Object.assign({}, base, {
                            waitingPatterns: re(base.waitingPatterns),
                            busyPatterns: re(base.busyPatterns),
                        })
                    },
                }
                return { mod, via: '__agentdeck.profiles()', stale: false }
            }
        } catch (e) {
            // 진단구가 없거나 모양이 바뀌었다 — 아래 폴백으로
        }
        if (!root) { return { mod: null, via: 'no-repo-root (진단구도 없다)' } }
        const js = path.join(root, '.tmp', 'agents.js')
        const ts = path.join(root, 'src', 'agents.ts')
        try {
            if (!fs.existsSync(js)) { return { mod: null, via: 'no-.tmp (npm test 를 한 번도 안 돌렸다)' } }
            const stale = fs.statSync(js).mtimeMs < fs.statSync(ts).mtimeMs
            // eslint-disable-next-line
            const mod = require(js)
            return { mod, via: '.tmp/agents.js', stale }
        } catch (e) {
            return { mod: null, via: 'require 실패: ' + String((e && e.message) || e) }
        }
    }
    const agents = loadAgents()
    /** 판정에 쓸 프로필 세 필드 — 제품 모듈이 있으면 그것, 없으면 사본 */
    const rules = (() => {
        if (agents.mod && Array.isArray(agents.mod.AGENT_PROFILES)) {
            const u = agents.mod.unionProfile()
            return {
                via: agents.via + (agents.stale ? ' (src 보다 낡았다)' : ''),
                waiting: u.waitingPatterns, busy: u.busyPatterns, marks: u.busyTitleMarks,
                heads: u.promptHeads,
                perProfile: agents.mod.AGENT_PROFILES.map(p => ({
                    id: p.id, patternsProven: p.patternsProven, imagePasteKey: p.imagePasteKey,
                    waiting: p.waitingPatterns.map(String), busy: p.busyPatterns.map(String),
                    marks: p.busyTitleMarks, promptHeads: p.promptHeads,
                })),
            }
        }
        return { via: FALLBACK.via + ' (' + agents.via + ')', ...FALLBACK, perProfile: null }
    })()

    /** 입력창 기본 모양 — 제품 값(`prompt.ts:55` / `screen.ts:84`)을 그대로 읽는다 */
    const shapes = (() => {
        const out = { via: 'none', promptHeads: FALLBACK.heads, promptRule: ['─', '━', '═', '-'], screenRule: ['─', '━', '═'], choiceWords: ['Yes', 'No'] }
        if (!root) { return out }
        try {
            // eslint-disable-next-line
            const p = require(path.join(root, '.tmp', 'prompt.js'))
            // eslint-disable-next-line
            const s = require(path.join(root, '.tmp', 'screen.js'))
            return {
                via: '.tmp/prompt.js + .tmp/screen.js',
                promptHeads: p.DEFAULT_PROMPT_SHAPE.heads,
                promptRule: p.DEFAULT_PROMPT_SHAPE.ruleChars,
                screenRule: s.DEFAULT_SCREEN_SHAPE.ruleChars,
                choiceWords: p.DEFAULT_PROMPT_SHAPE.choiceWords,
            }
        } catch { /* 사본으로 간다 */ }
        return out
    })()

    /**
     * xterm 버퍼를 줄 배열로 — **스크롤백까지** 본다.
     *
     * 화면(`baseY`~`baseY+rows`)만 읽으면 승인 프롬프트가 위로 밀린 순간을 놓친다.
     * 다만 스크롤백은 수천 줄이라 통째로 담으면 결과 JSON 이 못 읽을 크기가 된다 —
     * **뒤에서 `limit` 줄**만 가져온다 (기본 400).
     */
    const readBuffer = (pane, limit) => {
        const x = pane.frontend.xterm
        const b = x.buffer.active
        const end = b.baseY + x.rows
        const start = Math.max(0, end - (limit || 400))
        const lines = []
        for (let i = start; i < end; i++) {
            const l = b.getLine(i)
            lines.push(l ? l.translateToString(true) : '')
        }
        return { lines, cols: x.cols, rows: x.rows, total: b.length }
    }

    const DIAG_PATH = path.join(os.homedir(), '.agentdeck-diag.log')
    const readDiag = () => {
        try { return fs.readFileSync(DIAG_PATH, 'utf8').split('\n') } catch { return null }
    }

    // AO8 이 제목을 잠깐 위조하므로 되돌릴 것을 적어 둔다
    const restores = []

    try {
        const target = firstPaneOf(activeRoot())

        // ============================================================ AO1 식별 근거
        // `agentOf()` 의 판정과 **그 판정의 원재료**를 나란히 남긴다. unknown 일 때 "왜" 를
        // 못 보면(어느 힌트도 안 맞았는지, 프로세스 트리 조회가 실패했는지) 사용자가
        // processHints/titleHints 에 무엇을 넣어야 할지 알 수 없다.
        {
            const rows = []
            for (const p of panes()) {
                let procs = null
                let procErr = null
                try {
                    procs = await (p.session && p.session.getChildProcesses ? p.session.getChildProcesses() : null)
                } catch (e) { procErr = String((e && e.message) || e) }
                const names = (procs || []).map(x => `${(x && x.command) || ''} ${(x && x.name) || ''}`.trim())
                const title = `${p.title || ''} ${p.customTitle || ''}`
                // deck.service.ts:1641 `detectAgentApp` 과 같은 재료로 힌트를 대조한다
                const hay = names.join(' ').toLowerCase()
                const hints = ['codex', 'gemini', 'claude'].map(h => ({
                    hint: h, inProcs: hay.includes(h), inTitle: title.toLowerCase().includes(h),
                }))
                rows.push({
                    title: clip(p.title, 60), customTitle: clip(p.customTitle, 60),
                    procs: names, procErr,
                    // 프로세스 트리가 비면(SSH·ConPTY 등) 제목으로 떨어진다 — 그 사실을 남긴다
                    procSource: procErr ? 'error' : (names.length ? 'ok' : 'empty'),
                    hints,
                    identify: agents.mod ? agents.mod.identifyAgent(names.join(' '), title) : null,
                })
            }
            const of = ad.agentOf ? ad.agentOf() : null
            const why = (() => {
                if (!of) { return '활성 탭이 없다' }
                if (of.id && of.id !== 'unknown') { return `판정됨: ${of.id}` }
                const anyHit = rows.some(r => r.hints.some(h => h.inProcs || h.inTitle))
                return anyHit
                    ? '힌트는 보이는데 unknown 이다 — 조회 시점(TTL 10초·session-bind/제목변경/출력)을 의심해 probeAgent() 로 강제 조회할 것'
                    : '어느 힌트도 프로세스·제목에서 안 보인다 — 이 CLI 의 실행 파일 이름/제목 조각을 processHints·titleHints 에 추가해야 한다'
            })()
            add('AO1', '식별 근거 (프로세스·제목·힌트 대조)', null,
                `채집 항목 — 판정 대상이 아니다. ${why}`,
                { agentOf: of, panes: rows, rulesVia: rules.via, repoRoot: root })
        }

        // ============================================================ AO2 화면 문구 대조
        // 지금 프로필들이 가진 패턴 중 **무엇이 맞고 무엇이 안 맞는지**. 안 맞는 것이 곧
        // "이 에이전트는 다른 문구를 쓴다" 는 증거고, 맞는 것이 있으면 그 줄이 그대로 근거가 된다.
        {
            if (!target) {
                add('AO2', '화면 문구 대조 (프로필 패턴 hit/miss)', null, '터미널 pane 이 없다', null)
            } else {
                const buf = readBuffer(target, 400)
                const body = buf.lines.join('\n')
                const one = (kind, list) => list.map(re => {
                    const hit = buf.lines.filter(l => re.test(l))
                    return {
                        kind, pattern: String(re), hits: hit.length,
                        sample: hit.length ? clip(hit[hit.length - 1].trim(), 160) : null,
                    }
                })
                const markRows = rules.marks.map(m => ({
                    kind: 'busyTitleMark', ...cp(m), inScreen: body.indexOf(m) >= 0,
                }))
                add('AO2', '화면 문구 대조 (프로필 패턴 hit/miss)', null,
                    '채집 항목 — hit=0 이 곧 "이 에이전트는 그 문구를 안 쓴다" 는 증거다. '
                    + '단 국면을 봐야 한다: 유휴 화면에서 busy 패턴이 0 인 것은 정상이다.',
                    {
                        rulesVia: rules.via, cols: buf.cols, rows: buf.rows, scannedLines: buf.lines.length,
                        waiting: one('waiting', rules.waiting),
                        busy: one('busy', rules.busy),
                        marksInScreen: markRows,
                    })
            }
        }

        // ============================================================ AO3 대기/작업중 후보 줄
        // **판정하지 않는다** — 사람이 읽고 프로필에 넣을 값을 고른다. 그래서 원문을 그대로 남긴다.
        // 여기서 정규식을 만들어 버리면 관측 없이 좁히는 그 실수를 도구가 대신 저지르는 셈이다.
        {
            if (!target) {
                add('AO3', '대기·작업중처럼 보이는 줄 후보', null, '터미널 pane 이 없다', null)
            } else {
                const buf = readBuffer(target, 400)
                /**
                 * 후보를 고르는 눈. 넓게 잡는다 — 여기서 놓치면 사람이 볼 기회조차 없어진다.
                 * 스피너류 문자 구간: 브라유 점자(U+2800~28FF, 흔한 CLI 스피너)·원형(U+25CB~25D3)·
                 * 별표(U+2720~2740)·블록 커서(U+258C·U+2588).
                 */
                const triggers = [
                    ['y/n', /\by\s*\/\s*n\b/i],
                    ['yes/no', /\b(?:yes|no)\b/i],
                    ['enter', /\benter\b/i],
                    ['esc', /\besc(?:ape)?\b/i],
                    ['ctrl', /\bctrl[+-]/i],
                    ['interrupt', /interrupt|cancel|abort/i],
                    ['approve', /\b(?:allow|approve|permission|confirm|proceed|trust)\b/i],
                    ['question', /\bdo you\b|\?\s*$/i],
                    ['choice-cursor', /^\s*[❯›❭➜>]\s*\d+[.)]/],
                    ['working', /\b(?:working|thinking|running|generating|waiting)\b/i],
                    ['spinner-char', /[⠀-⣿○-◓✠-❀▌█]/],
                    ['elapsed', /\b\d+\s*(?:s|sec|secs|seconds|m|min)\b/i],
                    ['tokens', /\btokens?\b/i],
                ]
                const seen = new Set()
                const cand = []
                for (let i = buf.lines.length - 1; i >= 0 && cand.length < 40; i--) {
                    const raw = buf.lines[i]
                    const t = raw.trim()
                    if (t.length < 2 || seen.has(t)) { continue }
                    const hit = triggers.filter(([, re]) => re.test(t)).map(([name]) => name)
                    if (!hit.length) { continue }
                    seen.add(t)
                    cand.push({
                        // 화면 아래에서 위로 세어 몇 번째 줄인지 — 상태줄(맨 아래)과 대화 이력을 가른다
                        fromBottom: buf.lines.length - 1 - i,
                        triggers: hit,
                        // 원문 그대로. 비ASCII 는 코드포인트를 따로 붙인다 (프로필에 옮겨 적을 때 필요)
                        text: clip(t, 200),
                        nonAscii: nonAscii(t).slice(0, 12).map(cp),
                    })
                }
                add('AO3', '대기·작업중처럼 보이는 줄 후보 (원문)', null,
                    '채집 항목 — 판정하지 않는다. 국면①(유휴)에도 있는 줄은 busyPatterns 로 쓸 수 없다. '
                    + '국면②(작업중)·③(승인대기)에서 각각 돌려 **차집합**을 취할 것 (docs/AGENT-OBSERVATION.md 읽는 법)',
                    { scannedLines: buf.lines.length, candidates: cand })
            }
        }

        // ============================================================ AO4 제목 스피너 후보
        // **여러 번 표본을 뜬다.** 스피너는 애니메이션이라 한 번만 보면 그 순간의 한 글자만
        // 잡히고, 나머지 계열(claude 는 9종)은 영영 안 보인다. 300ms x 10 = 3초 창.
        {
            const rootTab = activeRoot()
            if (!rootTab) {
                add('AO4', '제목 스피너 후보 (시계열 표본)', null, '탭이 없다', null)
            } else {
                const samples = []
                const bag = new Map()
                for (let i = 0; i < 10; i++) {
                    const title = String(rootTab.title || '')
                    const custom = String(rootTab.customTitle || '')
                    const paneTitle = target ? String(target.title || '') : ''
                    samples.push({ at: i * 300, title: clip(title, 80), customTitle: clip(custom, 80), paneTitle: clip(paneTitle, 80) })
                    for (const c of nonAscii(title + custom + paneTitle)) {
                        const e = bag.get(c) || { ...cp(c), seen: 0 }
                        e.seen++
                        bag.set(c, e)
                    }
                    if (i < 9) { await sleep(300) }
                }
                const chars = [...bag.values()]
                // 표본 전부에 있는 글자는 고정 장식(아이콘·프로필 이름)일 확률이 높고,
                // 일부 표본에만 있는 글자가 스피너다. 그 갈래를 계산해 준다
                const varying = chars.filter(c => c.seen > 0 && c.seen < samples.length)
                const known = new Set(rules.marks)
                add('AO4', '제목 스피너 후보 (시계열 표본)', null,
                    '채집 항목 — `seen < 표본수` 인 글자가 스피너 후보다(변한다). 전 표본에 있는 글자는 '
                    + '고정 장식일 수 있으니 유휴 국면 표본과 대조할 것. 제목이 안 변하면 그 에이전트는 '
                    + '제목 스피너를 안 쓰는 것이고, 그때 busyTitleMarks 는 **비워 두는 것이 정답**이다',
                    {
                        samples,
                        nonAsciiChars: chars.map(c => ({ ...c, alreadyInProfile: known.has(c.ch) })),
                        varying: varying.map(c => c.ch),
                        titleChanged: new Set(samples.map(s => s.title)).size > 1,
                    })
            }
        }

        // ============================================================ AO5 입력창 모양
        // 머리글자·테두리 문자를 코드포인트로 뽑고 `DEFAULT_*`(= Claude 실측) 와 대조한다.
        {
            if (!target) {
                add('AO5', '입력창 모양 (머리글자·테두리 대조)', null, '터미널 pane 이 없다', null)
            } else {
                const buf = readBuffer(target, 120)
                const headSet = new Map()
                const ruleSet = new Map()
                const headLines = []
                for (let i = buf.lines.length - 1; i >= 0; i--) {
                    const t = buf.lines[i].replace(/\s+$/, '')
                    const body = t.trim()
                    if (!body) { continue }
                    // 테두리 후보 — 같은 글자가 3번 이상 반복돼 줄을 이루는 경우.
                    // 영숫자·공백은 제외한다(`====` 는 받고 `aaaa` 는 안 받는다)
                    const rep = /^(.)\1{2,}$/.exec(body)
                    if (rep && !/[\w\s]/.test(rep[1])) {
                        const e = ruleSet.get(rep[1]) || { ...cp(rep[1]), lines: 0, lens: [] }
                        e.lines++
                        if (e.lens.length < 4) { e.lens.push(t.length) }
                        ruleSet.set(rep[1], e)
                        continue
                    }
                    // 머리글자 후보 — 줄 첫 글자가 영숫자가 아니고, 뒤에 공백이나 줄끝이 오는 경우
                    const m = /^(\S)(?:\s|$)/.exec(body)
                    if (m && !/[\w"'`([{]/.test(m[1])) {
                        const e = headSet.get(m[1]) || { ...cp(m[1]), lines: 0, sample: null }
                        e.lines++
                        if (!e.sample) { e.sample = clip(body, 120) }
                        headSet.set(m[1], e)
                        if (headLines.length < 6) {
                            headLines.push({ fromBottom: buf.lines.length - 1 - i, len: t.length, text: clip(body, 140) })
                        }
                    }
                }
                const known = new Set(shapes.promptHeads)
                const knownRule = new Set([...shapes.promptRule, ...shapes.screenRule])
                add('AO5', '입력창 모양 (머리글자·테두리 대조)', null,
                    '채집 항목 — `inDefault:false` 인 글자가 곧 프로필의 promptShape/screenShape 에 들어갈 값이다. '
                    + '테두리 길이(`lens`)가 cols 와 같은지도 같이 본다 (screen.ts 는 "테두리는 cols 를 꽉 채운다" 를 판정에 쓴다)',
                    {
                        shapesVia: shapes.via, cols: buf.cols,
                        defaults: { promptHeads: shapes.promptHeads.map(cp), promptRule: shapes.promptRule.map(cp), screenRule: shapes.screenRule.map(cp), choiceWords: shapes.choiceWords },
                        heads: [...headSet.values()].map(h => ({ ...h, inDefault: known.has(h.ch) })),
                        rules: [...ruleSet.values()].map(r => ({ ...r, inDefault: knownRule.has(r.ch), fillsCols: r.lens.some(n => n === buf.cols) })),
                        headLines,
                    })
            }
        }

        // ============================================================ AO6 이미지 붙여넣기 키
        // **실행하지 않는다.** 프로필이 무엇을 쓰기로 되어 있는지와 근거 상태만 보여준다.
        {
            const of = ad.agentOf ? ad.agentOf() : null
            const cfgKey = ad.config.store.agentDeck.imagePasteKey
            const table = rules.perProfile
                ? rules.perProfile.map(p => ({
                    id: p.id, imagePasteKey: p.imagePasteKey, patternsProven: p.patternsProven,
                    // `config` = "무엇을 받는지 관측된 바 없다" → 사용자 설정값으로 떨어진다 (agents.ts:21)
                    effective: p.imagePasteKey === 'config' ? `config -> ${cfgKey}` : p.imagePasteKey,
                    bytes: p.imagePasteKey === 'ctrl-v' ? '0x16' : (p.imagePasteKey === 'alt-v' ? '0x1b 0x76 (ESC v)' : `설정값(${cfgKey})`),
                }))
                : null
            add('AO6', '이미지 붙여넣기 키 (프로필 값·근거 상태)', null,
                '채집 항목이자 **판정 불가 항목**이다. 실제 키 반응은 클립보드에 이미지가 들어 있어야 '
                + '관측되는데 격리 환경에서는 `clipboard.writeImage()` 뒤 `readImage().isEmpty()` 가 true 다 '
                + '(R6·IN6 선례, tools/README.md:82). **사용자 실사용으로만 판정된다** — 이미지를 복사해 '
                + '붙여넣고 `~/.agentdeck-diag.log` 의 `paste image app=… mode=… bytes=…` 줄과 실제 삽입 여부를 대조할 것',
                { agentOf: of, configured: cfgKey, profiles: table, rulesVia: rules.via })
        }

        // ============================================================ AO7 [판정] 실측 없는 프로필의 안전장치
        // 관측 없이 좁히지 않는다는 그 갈래가 **실제로 작동하는가**. 프로필을 붙였다는 이유로
        // 판정이 0.5.0 보다 나빠지면 이 라운드가 막으려는 퇴행이 그대로 일어난 것이다
        // (agents.ts:261 detectProfileFor 주석 · docs/DEVELOPMENT.md:231).
        {
            if (!agents.mod || typeof agents.mod.detectProfileFor !== 'function') {
                add('AO7', '실측 없는 프로필은 합집합으로 판정된다', null,
                    `agents 모듈을 못 읽었다 (${agents.via}) — 리포에서 \`npm test\` 를 한 번 돌리면 `
                    + '`.tmp/agents.js` 가 생기고 이 항목이 판정된다', { rulesVia: rules.via })
            } else {
                const { AGENT_PROFILES, unionProfile, detectProfileFor } = agents.mod
                const u = unionProfile()
                // **동일성(`===`) 판정은 제품 안에서만 가능하다.**
                //
                // 진단구(`__agentdeck.profiles()`)는 정규식을 JSON 으로 펼쳐 주므로, 그 값을 되살린
                // 배열은 내용이 같아도 **다른 객체**다. 여기서 `===` 로 재면 "합집합을 쓰는데도
                // 안 쓴다" 로 읽혀 거짓 실패가 난다(2026-09-08 실측: 배리어에서 진단구 경유로
                // 바꾼 직후 AO7 이 FAIL 로 뒤집혔다). 그래서 제품이 확인해 준 결과를 우선 쓰고,
                // 진단구가 없는 환경(`.tmp` 경유)에서만 직접 `===` 을 잰다.
                const proven = (ad.profiles && ad.profiles().fallback) || null
                const rows = AGENT_PROFILES.map(p => {
                    const d = detectProfileFor(p.id)
                    const said = proven ? proven.find(r => r.id === p.id) : null
                    const sameAsUnion = said
                        ? said.usesUnionPatterns
                        : (d.waitingPatterns === u.waitingPatterns
                            && d.busyPatterns === u.busyPatterns
                            && d.busyTitleMarks === u.busyTitleMarks)
                    const ownPatterns = said
                        ? said.usesOwnPatterns
                        : (d.waitingPatterns === p.waitingPatterns && d.busyPatterns === p.busyPatterns)
                    return {
                        id: p.id, patternsProven: p.patternsProven,
                        via: said ? '제품 확인(=== )' : '프로브 직접 비교',
                        판정패턴: sameAsUnion ? '합집합' : (ownPatterns ? '프로필 자기 것' : '섞였다'),
                        // 실측된 필드는 좁히지 않는다 — 이미지 키는 프로필 것을 그대로 써야 한다
                        imagePasteKeyKept: said ? said.imagePasteKeyKept : d.imagePasteKey === p.imagePasteKey,
                        shapeDropped: said ? said.shapesDropped : (d.promptShape === undefined && d.screenShape === undefined),
                        // 0.5.0 이 잡던 것을 계속 잡는가 (이 갈래의 존재 이유)
                        catchesEscInterrupt: said ? said.catchesClaudeBusy : d.busyPatterns.some(re => re.test('esc to interrupt')),
                    }
                })
                // 실측된 프로필에는 `esc to interrupt` 를 요구하지 않는다 — 그 문구를 안 쓰는
                // 에이전트가 실측으로 확정되면 그게 정답이고, 여기서 요구하면 거짓 실패가 된다.
                // 합집합으로 떨어지는 프로필에만 요구한다(그게 0.5.0 동작 보존의 의미다)
                const ok = rows.every(r => (r.patternsProven
                    ? r.판정패턴 === '프로필 자기 것'
                    : r.판정패턴 === '합집합' && r.shapeDropped && r.catchesEscInterrupt)
                    && r.imagePasteKeyKept)
                add('AO7', '실측 없는 프로필은 합집합으로 판정된다', ok,
                    ok ? 'patternsProven=false 인 프로필은 판정 세 필드가 합집합이고 shape 를 못 갖는다. '
                        + '실측된 이미지 키는 프로필 값 유지, `esc to interrupt` 도 계속 잡는다'
                        : '안전장치가 기대와 다르다 — patternsProven 을 켰다면 그 프로필의 관측 근거를 '
                        + 'src/agents.ts 주석에 남기고 test/agents.test.js 의 동일성 케이스를 함께 고쳤는지 확인할 것',
                    { via: agents.via, stale: !!agents.stale, profiles: rows })
            }
        }

        // ============================================================ AO8 [판정] 판정 진단 줄
        // `deck.service.ts:1682` 는 `agent tab=… id=… via=… (why)` 를 남긴다. 단 **값이 바뀔 때만**
        // 찍힌다(`:1681` `if (found.id !== prev)`) — 그래서 "줄이 없다" 는 곧바로 실패가 아니다
        // (tools/README.md:92 의 그 함정). 이미 있으면 그것으로, 없으면 **제목을 잠깐 위조해
        // 판정을 강제로 바꿔** 새 줄이 남는지 본다.
        {
            const rootTab = activeRoot()
            const before = readDiag()
            const of = ad.agentOf ? ad.agentOf() : null
            const lineOf = (arr, id) => (arr || []).filter(l => l.indexOf('agent tab=') >= 0
                && (!id || l.indexOf(`id=${id}`) >= 0))
            const already = of && of.id ? lineOf(before, of.id) : []
            if (before === null) {
                add('AO8', '판정 진단 줄 (`agent tab=… id=…`)', null,
                    `진단 로그를 못 읽었다 (${DIAG_PATH})`, null)
            } else if (already.length) {
                add('AO8', '판정 진단 줄 (`agent tab=… id=…`)', true,
                    `현재 판정(id=${of.id})이 진단 로그에 남아 있다`,
                    { agentOf: of, lines: already.slice(-3).map(l => clip(l, 200)), total: lineOf(before).length })
            } else if (!rootTab || !target || !ad.probeAgent) {
                add('AO8', '판정 진단 줄 (`agent tab=… id=…`)', null,
                    '강제 조회 대상이 없다 (탭·pane·probeAgent 진단구 중 하나가 없다)',
                    { agentOf: of, agentLines: lineOf(before).length })
            } else {
                // 지금 판정과 **다른** 아이디로 읽히게 만든다. 제목만 바꾸므로 프로세스 트리가
                // 이미 에이전트를 가리키는 탭에서는 아무 일도 안 일어난다(프로세스가 먼저다,
                // deck.service.ts:1645) — 그때는 아래에서 판정 불가로 떨어진다.
                const fake = (of && of.id === 'gemini') ? 'codex' : 'gemini'
                const had = Object.prototype.hasOwnProperty.call(target, 'customTitle')
                const prevTitle = target.customTitle
                restores.push(() => {
                    if (had) { target.customTitle = prevTitle } else { try { delete target.customTitle } catch { target.customTitle = prevTitle } }
                })
                target.customTitle = `agentdeck-observe ${fake}`
                ad.probeAgent(rootTab)
                await sleep(1200)
                const mid = ad.agentOf ? ad.agentOf(rootTab) : null
                const after = readDiag()
                const grew = lineOf(after, fake)
                const changed = !!(mid && mid.id === fake)
                if (changed && grew.length) {
                    add('AO8', '판정 진단 줄 (`agent tab=… id=…`)', true,
                        `제목을 위조해 판정을 ${fake} 로 바꿨더니 진단 줄이 남았다 (via=title 경로)`,
                        { agentOf: of, forced: mid, lines: grew.slice(-2).map(l => clip(l, 200)) })
                } else if (changed) {
                    add('AO8', '판정 진단 줄 (`agent tab=… id=…`)', false,
                        `판정은 ${fake} 로 바뀌었는데(agentOf 확인) 진단 줄이 안 남았다 — `
                        + 'deck.service.ts:1682 경로가 죽었다',
                        { agentOf: of, forced: mid, agentLines: lineOf(after).length })
                } else {
                    add('AO8', '판정 진단 줄 (`agent tab=… id=…`)', null,
                        '제목 위조로도 판정이 안 바뀌었다 — 프로세스 트리가 이미 아이디를 고정하고 있거나'
                        + '(프로세스가 제목보다 먼저다) 이전 판정을 유지하는 갈래에 걸렸다(deck.service.ts:1677). '
                        + '"줄이 없다"는 실패가 아니다: 진단은 값이 바뀔 때만 찍힌다',
                        { agentOf: of, forced: mid, agentLines: lineOf(after).length })
                }
                // 위조를 되돌리고 원래 판정으로 복귀시킨다 (다음 국면 채집이 오염되면 안 된다)
                restores.pop()()
                ad.probeAgent(rootTab)
                await sleep(600)
            }
        }
    } catch (e) {
        add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
    } finally {
        while (restores.length) {
            try { restores.pop()() } catch { /* 복원 실패는 치명적이지 않다 */ }
        }
        try { ad.render() } catch { /* 무시 */ }
    }

    const summary = {
        total: results.length,
        pass: results.filter(r => r.pass === true).length,
        fail: results.filter(r => r.pass === false).length,
        skipped: results.filter(r => r.pass === null).length,
        // 채집이 목적이라 skipped 가 많은 것이 정상이다 — 그 수를 실패로 읽지 않게 못 박는다
        note: 'AO1~AO6 은 채집 항목이라 pass=null 이 정상이다. 판정 항목은 AO7·AO8 둘뿐',
    }
    return JSON.stringify({ summary, results }, null, 1)
})()
