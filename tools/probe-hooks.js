/**
 * Claude Code 훅 **실발화** 회귀 프로브 (`HK1`~`HK9`) — `tools/run-all.ps1` 의 확장 프로브.
 *
 * **왜 이 파일이 생겼나.** 지금까지 회귀는 훅을 한 번도 실행하지 않았다. 러너의 R21 이
 * `StopFailure` 한 갈래를 재는 것이 전부였고, 나머지 여섯 이벤트·깨진 입력·인코딩·TCP 경로·
 * 그리고 **훅이 보낸 상태가 사이드바까지 오는지**는 아무도 안 봤다. 그래서 훅 스크립트가
 * 깨져도(경로·JSON 파싱·인코딩) 회귀가 초록으로 남는다. 이 저장소에는 **BOM 없는 한글 `.ps1`
 * 을 PS 5.1 이 CP949 로 읽어 조용히 오작동한 사고**가 있었고, 훅은 바로 그 종류의 파일이다.
 *
 * 재는 경로 (제품 문서·주석이 말하는 계약):
 *   stdin 훅 JSON → `$hook.session_id` / `$hook.hook_event_name` → `$env:AGENTDECK_TAB`
 *   → `%LOCALAPPDATA%\tabby-agentdeck\status\<session_id>.json` (`{sessionId,status,ts,tabId}`)
 *   → 플러그인(`notify.service.ts` 400ms 폴링 또는 TCP) → `status.service` → 사이드바 배지.
 *
 * ## 규칙을 베끼지 않는다
 *
 * **이벤트 → 상태 매핑의 사본을 이 파일에 두지 않는다.** 사본은 낡고, 낡은 사본은 제품이
 * 규칙을 바꿔도 계속 초록이 된다(이 저장소에서 `probe-all.js` 의 화면 판정 사본이 낡아
 * R2·R14 를 거짓 실패시킨 것이 그 교훈이다). 매핑은 **제품이 스스로 써 둔 파일**에게 묻는다 —
 * `~/.claude/settings.json` 에 설치된 우리 훅의 명령줄이 곧 `src/claudeHooks.ts` 의 `PLAN`
 * 이 낸 결과이고, Claude Code 가 실제로 실행하는 것도 그 줄이다. 상태 어휘(running/waiting/…)
 * 도 훅 파일의 `[ValidateSet(...)]` 을 읽어 쓴다. 둘 다 없으면 **판정 불가**로 남긴다.
 *
 * ## 경로를 프로브가 만들지 않는다 (tools/README.md 의 그 함정)
 *
 *  - 훅 파일 위치: ① 러너가 남긴 파라미터 파일(`<TEMP>/agentdeck-regression/hk-params.json`,
 *    러너만 쓴다 — 러너는 `$root` 를 알고 렌더러는 모른다) ② 없으면 설치된 settings.json 의
 *    `-File "…"` 경로. **`require.cache` 로는 못 찾는다** — Tabby 의 렌더러 require 는 캐시가
 *    비어 있다(실측 2026-09-10: `cacheTotal: 0`).
 *  - 상태파일 폴더: 제품과 **같은 식**(`process.env.LOCALAPPDATA` + `tabby-agentdeck\status`,
 *    `notify.service.ts:156-160`). 프로브는 제품과 같은 프로세스 안에서 도니 같은 env 를 읽으면
 *    같은 폴더다 — `os.homedir()` 로 추측하는 것과는 다른 이야기다(`probe-subagent.js` 와 같은 근거).
 *
 * ## 사용자 것을 건드리지 않는 장치 (중요)
 *
 *  ⓐ 훅은 **격리 `LOCALAPPDATA`** 로 실행한다(`<TEMP>/ad-hk-XXXX/localappdata`). 그래서 HK1~HK7
 *    은 사용자의 실제 상태 폴더에 아무것도 쓰지 않고, 포트 파일도 없으니 TCP 도 안 나간다.
 *  ⓑ HK8 만 예외 — "플러그인이 받아 화면이 바뀌는가" 는 **플러그인이 보는 폴더**에 파일이 있어야
 *    잴 수 있다(그 폴더 경로는 서비스가 기동 때 정한다). 그때도 새 내용을 만들지 않고 **훅이 만든
 *    파일의 바이트를 그대로** 옮기며, 파일명·`sessionId` 에 접두 `agentdeck-probe-hk-` 를 박고
 *    보고에 `tabId` 를 반드시 넣는다 — `tabId` 가 있고 표에 없으면 `resolveTab` 은 추측하지 않고
 *    null 이라(`notify.service.ts:790-797`) 실사용 Tabby 는 진단 한 줄만 남기고 어느 탭에도 안 묶는다.
 *  ⓒ 지우기는 **접두 검사를 통과할 때만** 한다. 실제 이름을 쓰는 삭제 코드는 이 파일에 없다.
 *
 * `pass: null` = **판정 불가**(환경이 조건을 못 만듦)이고 실패와 섞어 세지 않는다.
 */
(async () => {
    const ad = window.__agentdeck
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const sb = () => document.getElementById('agentdeck-sidebar')
    const listEl = () => (sb() ? sb().querySelector('.ad-list') : null)
    /** 줄은 **오직** 이 방법으로 찾는다 ("n 번째 줄 = n 번째 탭" 가정이 R16·R19 를 거짓 실패시켰다) */
    const rowOf = i => (listEl() ? listEl().querySelector('.ad-tab[data-ad-index="' + i + '"]') : null)
    const badgeOf = i => {
        const r = rowOf(i)
        return r ? r.querySelector('.ad-badge') : null
    }

    const results = []
    const add = (id, name, pass, detail, evidence) => results.push({ id, name, pass, detail, evidence })

    /** 케이스 이름을 한 곳에만 둔다 — 판정할 때와 `판정 불가`로 채울 때 이름이 갈리지 않게 */
    const CASES = [
        ['HK1', '상태 파일이 생기고 규격대로다 (sessionId·status·ts·tabId)'],
        ['HK2', '이벤트별 상태 매핑 — 설치된 훅 명령줄이 말한 그대로'],
        ['HK3', '진행중 중복 보고는 건너뛰고, 라벨이 붙으면 쓴다'],
        ['HK4', '유휴 알림·완료 뒤의 승인 알림이 상태를 뒤집지 않는다'],
        ['HK5', '깨진 입력에 죽지 않는다 (JSON 아님 · 빈 stdin · 탭 env 없음)'],
        ['HK6', '인코딩 — 한글 값이 온전히 들어가고 훅 .ps1 은 UTF-8 BOM'],
        ['HK7', 'TCP 즉시 통보 — 파일과 같은 JSON 한 줄을 보낸다'],
        ['HK8', '플러그인이 받아 사이드바가 바뀐다 (배지·이유·pin)'],
        ['HK9', '정리 확인 — 내가 만든 격리폴더·상태파일 잔여 0'],
    ]
    const nameOf = id => (CASES.find(c => c[0] === id) || [id, id])[1]
    /** 아직 안 매긴 케이스를 `판정 불가`(pass:null)로 — 실패와 섞지 않는다 */
    const skipCases = (ids, reason, ev) => {
        for (const id of ids) {
            if (!results.some(r => r.id === id)) { add(id, nameOf(id), null, reason, ev || null) }
        }
    }
    const ALL_IDS = CASES.map(c => c[0])

    // ---------------------------------------------------------------- 공용 도구
    /** 조건이 참이 될 때까지 폴링 — 고정 대기로 400ms 폴링 주기를 맞추려 하지 않는다 */
    const waitFor = async (fn, ms, step) => {
        const t0 = Date.now()
        for (;;) {
            let v = null
            try { v = fn() } catch { v = null }
            if (v) { return v }
            if (Date.now() - t0 >= ms) { return null }
            await sleep(step || 200)
        }
    }
    const jsonOf = text => {
        try { return JSON.parse(text) } catch { return null }
    }

    // ---------------------------------------------------------------- 되돌릴 것들
    // finally 가 보려면 try **밖에서** 선언해야 한다 (probe-group.js·probe-subagent.js 의 그 함정)
    const cleanup = {}
    let nodeFs = null
    let nodePath = null
    let nodeOs = null
    let nodeCp = null
    let nodeNet = null
    let NodeBuffer = null
    /** 격리 LOCALAPPDATA 뿌리 (`ad-hk-` 접두) — 여기 아래로만 훅이 쓴다 */
    let isoRoot = null
    let isoLad = null
    let isoStatusDir = null
    /** 플러그인이 실제로 보는 상태 폴더 — HK8 만 이 안에 파일 하나를 놓는다 */
    let realStatusDir = null
    let realFile = null
    let tcpServer = null
    let hookPath = null
    let hooksDir = null
    let targetTab = null
    let targetIdx = -1
    let chosenId = null
    let savedState = null
    let cleanedUp = false
    /** 내가 만드는 모든 이름의 접두 — 지우기는 이 검사를 통과할 때만 */
    const PREFIX = 'agentdeck-probe-hk-'
    const rand = () => Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0')
    const sidFor = tag => PREFIX + tag + '-' + rand()

    /**
     * 훅을 실제로 실행한다. **동기로 돌리지 않는다** — `spawnSync` 는 렌더러를 세우고, 그러면
     * 400ms 폴링과 아래 `waitFor` 가 같이 멈춘다.
     *
     * `lad` 로 `LOCALAPPDATA` 를 갈아 끼우는 것이 격리의 전부다 — 훅은 상태 폴더와 포트 파일을
     * 그 값으로만 만든다(`agentdeck-notify.ps1:67,260`).
     */
    const runHook = (opt) => new Promise(resolve => {
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', hookPath].concat(opt.args || [])
        const env = Object.assign({}, process.env, { LOCALAPPDATA: opt.lad || isoLad })
        if (opt.tabId) { env.AGENTDECK_TAB = opt.tabId } else { delete env.AGENTDECK_TAB }
        let p = null
        try {
            p = nodeCp.spawn('powershell.exe', args, { env, windowsHide: true })
        } catch (e) {
            resolve({ ok: false, spawnError: String((e && e.message) || e) })
            return
        }
        let out = ''
        let err = ''
        let done = false
        const finish = extra => {
            if (done) { return }
            done = true
            clearTimeout(timer)
            resolve(Object.assign({ ok: true, out, err }, extra))
        }
        // 훅은 탭 env 가 없으면 `Win32_Process` 전체를 훑는다(~450ms) — 넉넉히 주되 무한정은 아니다.
        // 멈춘 훅을 그냥 기다리면 프로브가 러너 전체를 붙잡는다
        const timer = setTimeout(() => {
            try { p.kill() } catch { /* 이미 죽었다 */ }
            finish({ code: null, timedOut: true })
        }, 25000)
        p.stdout.on('data', d => { out += d.toString('utf8') })
        p.stderr.on('data', d => { err += d.toString('utf8') })
        p.on('error', e => finish({ code: null, spawnError: String((e && e.message) || e) }))
        p.on('close', code => finish({ code }))
        try {
            if (typeof opt.stdin === 'string') {
                p.stdin.end(NodeBuffer.from(opt.stdin, 'utf8'))
            } else {
                p.stdin.end()
            }
        } catch (e) {
            finish({ code: null, spawnError: 'stdin: ' + String((e && e.message) || e) })
        }
    })

    /** 격리 상태 폴더에서 그 세션의 파일을 읽는다 — 원문 바이트와 파싱 결과를 함께 준다 */
    const readIso = sid => {
        const file = nodePath.join(isoStatusDir, sid + '.json')
        try {
            const bytes = nodeFs.readFileSync(file)
            const text = bytes.toString('utf8')
            return { file, bytes, text, json: jsonOf(text), mtime: nodeFs.statSync(file).mtimeMs }
        } catch (e) {
            return { file, bytes: null, text: null, json: null, mtime: 0, error: String((e && e.message) || e) }
        }
    }

    /** 훅 한 번 + 그 결과 읽기 — 케이스마다 같은 두 줄을 되풀이하지 않게 */
    const fire = async (sid, opt) => {
        const run = await runHook(Object.assign({ tabId: chosenId }, opt))
        return { run, got: readIso(sid) }
    }

    /**
     * 정리 — **케이스가 스스로 판정하려면 finally 가 아니라 함수여야 한다.** 정상 흐름 끝에서
     * 한 번 부르고 HK9 를 매기며, finally 에서 한 번 더 불러 예외로 빠진 판도 치운다(멱등).
     */
    const doCleanup = async () => {
        if (cleanedUp) { return cleanup }
        cleanedUp = true

        // ① 플러그인이 보는 폴더에 놓은 파일 — **접두 검사를 통과할 때만** 지운다.
        //    먼저 지우고 상태를 되돌린다: 파일이 남은 채 되돌리면 다음 폴링이 다시 덮는다
        if (nodeFs && nodePath && realFile) {
            try {
                if (nodePath.basename(realFile).indexOf(PREFIX) === 0) {
                    nodeFs.rmSync(realFile, { force: true })
                }
                cleanup.realFileRemoved = !nodeFs.existsSync(realFile)
            } catch (e) {
                cleanup.realFileRemoved = String((e && e.message) || e)
            }
        }

        // ② 탭 상태 되돌리기 — `setManual` 이 걸어 둔 pin 을 먼저 풀지 않으면 자동 감지가
        //    영영 못 덮는다(tools/README.md: "화면 판정을 재려면 unpin 을 잊지 말 것")
        if (targetTab && savedState && ad.app.tabs.indexOf(targetTab) >= 0) {
            try {
                ad.status.unpin(targetTab)
                const st = ad.status.get(targetTab)
                st.status = savedState.status
                st.label = savedState.label
                st.reason = savedState.reason
                st.pinned = savedState.pinned
                st.since = savedState.since
                cleanup.stateRestored = st.status === savedState.status && st.pinned === savedState.pinned
                    && st.reason === savedState.reason && st.label === savedState.label
            } catch (e) {
                cleanup.stateRestored = String((e && e.message) || e)
            }
        }
        try { ad.render() } catch { /* 무시 */ }

        // ③ 내가 띄운 TCP 리스너
        if (tcpServer) {
            try {
                tcpServer.close()
                cleanup.tcpClosed = true
            } catch (e) {
                cleanup.tcpClosed = String((e && e.message) || e)
            }
        }

        // ④ 격리 폴더 — 접두를 다시 확인한다. 이 한 줄이 `%TEMP%` 를 지키는 마지막 문턱
        if (nodeFs && nodePath && isoRoot) {
            try {
                if (nodePath.basename(isoRoot).indexOf('ad-hk-') === 0) {
                    nodeFs.rmSync(isoRoot, { recursive: true, force: true })
                }
                cleanup.isoRemoved = !nodeFs.existsSync(isoRoot)
            } catch (e) {
                cleanup.isoRemoved = String((e && e.message) || e)
            }
        }

        // ⑤ 잔여 확인 — **접두로만** 훑는다
        const leftovers = (dir, prefix) => {
            try {
                return nodeFs.readdirSync(dir).filter(n => String(n).indexOf(prefix) === 0)
            } catch {
                return []
            }
        }
        cleanup.prefix = PREFIX
        cleanup.isoRoot = isoRoot
        cleanup.leftoverStatus = realStatusDir && nodeFs ? leftovers(realStatusDir, PREFIX) : []
        cleanup.leftoverTemp = nodeFs && nodeOs ? leftovers(nodeOs.tmpdir(), 'ad-hk-') : []

        const created = !!(isoRoot || realFile)
        if (!created) {
            add('HK9', nameOf('HK9'), null, '만든 폴더·파일이 없다 (앞 단계에서 조건을 못 만들었다)', { cleanup })
        } else {
            const isoOk = !isoRoot || cleanup.isoRemoved === true
            const realOk = !realFile || cleanup.realFileRemoved === true
            const none = cleanup.leftoverStatus.length === 0 && cleanup.leftoverTemp.length === 0
            const stOk = !savedState || cleanup.stateRestored === true
            const pass9 = isoOk && realOk && none && stOk
            add('HK9', nameOf('HK9'), pass9,
                pass9
                    ? `격리 폴더(${isoRoot})와 상태파일을 지웠고, 접두 "${PREFIX}" / "ad-hk-" 로 훑은`
                        + ' 잔여가 상태폴더·%TEMP% 모두 0 개다 (탭 상태도 원래대로)'
                    : `정리가 남았다 (격리폴더삭제=${cleanup.isoRemoved} 상태파일삭제=${cleanup.realFileRemoved}`
                        + ` 잔여상태=${JSON.stringify(cleanup.leftoverStatus)}`
                        + ` 잔여TEMP=${JSON.stringify(cleanup.leftoverTemp)} 상태복원=${cleanup.stateRestored})`,
                { cleanup })
        }
        return cleanup
    }

    try {
        // ---------------------------------------------------------- 전제 ① node 모듈
        try {
            nodeFs = require('fs')
            nodePath = require('path')
            nodeOs = require('os')
            nodeCp = require('child_process')
            nodeNet = require('net')
            NodeBuffer = require('buffer').Buffer
        } catch {
            nodeFs = null
        }
        if (!nodeFs || !nodePath || !nodeOs || !nodeCp || !nodeNet || !NodeBuffer) {
            skipCases(ALL_IDS, 'renderer 에서 require("fs"/"path"/"os"/"child_process"/"net"/"buffer") 를'
                + ' 못 잡았다 — 훅을 실행할 방법이 없다', null)
            throw new Error('ad-hk-prereq')
        }

        // ---------------------------------------------------------- 전제 ② 훅 파일 위치
        //
        // 렌더러는 저장소 경로를 모른다. 러너가 남긴 파라미터 파일이 1순위이고(러너만 쓴다),
        // 없으면 **제품이 설치한 명령줄**의 `-File` 경로를 쓴다. 둘 다 없으면 판정 불가.
        const paramsFile = nodePath.join(nodeOs.tmpdir(), 'agentdeck-regression', 'hk-params.json')
        let params = null
        try {
            const raw = nodeFs.readFileSync(paramsFile, 'utf8')
            const p = jsonOf(raw.replace(/^﻿/, ''))
            // 낡은 파라미터 파일을 그대로 믿으면 옛 저장소의 훅을 재게 된다 — 6시간이 지나면 무시한다
            if (p && p.writtenAt && Date.now() - Number(p.writtenAt) < 6 * 3600 * 1000) { params = p }
        } catch { /* 없으면 아래 폴백 */ }

        /** 설치된 우리 훅의 명령줄 — 매핑과 경로의 원천 (`src/claudeHooks.ts` 가 쓴 것) */
        const settingsPath = nodePath.join(nodeOs.homedir(), '.claude', 'settings.json')
        const installed = { path: settingsPath, script: null, events: [], error: null }
        try {
            const st = jsonOf(nodeFs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''))
            const hooks = (st && st.hooks) || {}
            for (const event of Object.keys(hooks)) {
                const entries = Array.isArray(hooks[event]) ? hooks[event] : []
                for (const entry of entries) {
                    for (const h of (entry && Array.isArray(entry.hooks) ? entry.hooks : [])) {
                        const cmd = String((h && h.command) || '')
                        if (cmd.indexOf('agentdeck-notify') < 0) { continue }
                        const mStatus = /-Status\s+([A-Za-z]+)/.exec(cmd)
                        const mFile = /-File\s+"([^"]+)"/.exec(cmd)
                        if (mFile && !installed.script) { installed.script = mFile[1] }
                        installed.events.push({ event, status: mStatus ? mStatus[1] : null, command: cmd })
                    }
                }
            }
        } catch (e) {
            installed.error = String((e && e.message) || e)
        }

        hookPath = (params && params.hookPath) || (params && params.root
            ? nodePath.join(params.root, 'hooks', 'agentdeck-notify.ps1')
            : installed.script)
        hooksDir = (params && params.hooksDir) || (params && params.root
            ? nodePath.join(params.root, 'hooks')
            : (hookPath ? nodePath.dirname(hookPath) : null))
        if (!hookPath || !nodeFs.existsSync(hookPath)) {
            skipCases(ALL_IDS, '훅 스크립트 경로를 알 수 없다 — 러너 파라미터 파일도 없고'
                + ` 설치된 settings.json 에도 우리 훅이 없다 (params=${!!params} 설치script=${installed.script}`
                + ` settings오류=${installed.error})`,
            { paramsFile, settingsPath, installed })
            throw new Error('ad-hk-prereq')
        }

        // ---------------------------------------------------------- 전제 ③ 격리 폴더
        isoRoot = nodeFs.mkdtempSync(nodePath.join(nodeFs.realpathSync(nodeOs.tmpdir()), 'ad-hk-'))
        isoLad = nodePath.join(isoRoot, 'localappdata')
        isoStatusDir = nodePath.join(isoLad, 'tabby-agentdeck', 'status')
        nodeFs.mkdirSync(isoStatusDir, { recursive: true })
        // 제품과 **같은 식**으로 실제 상태 폴더를 구한다 (모듈 주석의 근거). HK8 만 쓴다
        realStatusDir = nodePath.join(process.env.LOCALAPPDATA
            || nodePath.join(nodeOs.homedir(), 'AppData', 'Local'), 'tabby-agentdeck', 'status')

        /** 훅이 허용하는 상태 어휘 — 훅 파일의 `[ValidateSet(...)]` 을 그대로 읽는다 */
        let vocab = []
        let hookText = ''
        try {
            hookText = nodeFs.readFileSync(hookPath, 'utf8')
            // **`$Status` 에 붙은 것만** 읽는다. 훅에는 ValidateSet 이 여럿이고(`-Agent`·`-Subagent`) 첫 번째는
            // `-Agent`(claude/codex/gemini)라, 첫 매치를 쓰면 `limited` 가 어휘 밖으로 판정돼 HK2 가 거짓 실패했다(2026-09-14)
            const m = /\[ValidateSet\(([^)]*)\)\]\s*\[string\]\$Status\b/i.exec(hookText)
            if (m) { vocab = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) }
        } catch { /* 아래에서 vocab 비었음으로 처리 */ }

        // ---------------------------------------------------------- 전제 ④ 대상 탭
        //
        // HK8 은 보고를 **탭에 묶어야** 하므로 `AGENTDECK_TAB` 이 심긴 줄이 필요하다. 제품 표
        // (`ad.tabIds()`)에 실려 있는 id 만 쓴다 — 표에 없으면 보고가 어느 탭에도 안 묶인다.
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
        const known = new Set()
        try {
            for (const e of (typeof ad.tabIds === 'function' ? ad.tabIds() : [])) {
                for (const id of (e.ids || [])) { known.add(id) }
            }
        } catch { /* 진단구가 없으면 아래에서 판정 불가로 떨어진다 */ }
        // 남의 세션이 묶인 탭은 피한다. **단 다른 프로브가 남긴 세션은 예외다** — 세션↔탭 묶기를
        // 푸는 제품 경로가 없어서(`probe-subagent.js` 의 `cleanup.sessionBindingLeft`) 앞 프로브가
        // 유일한 터미널 탭을 이미 잡고 있으면 여기서 "쓸 탭이 없다" 로 전부 판정 불가가 된다.
        // 다시 묶으면 `bind()` 가 이전 주인을 풀어 준다(`notify.service.ts:820-834`).
        const ownedIdx = new Set()
        try {
            const s0 = typeof ad.subagents === 'function' ? ad.subagents() : null
            for (const t of ((s0 && s0.tabs) || [])) {
                if (String(t.sessionId || '').indexOf('agentdeck-probe-') !== 0) { ownedIdx.add(t.index) }
            }
        } catch { /* 진단구가 없으면 점유를 알 수 없다 — 아래에서 첫 후보를 쓴다 */ }
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
        // 탭이 없어도 HK1~HK7 은 잴 수 있다(훅만 돌린다) — HK8 만 그때 판정 불가가 된다

        // ============================================================ HK1 상태 파일 규격
        // 배선의 첫 문턱: 훅이 stdin JSON 을 읽고 그 세션 이름으로 파일을 만들었나, 내용이 규격인가.
        // `tabId` 가 있으면 계보 조회를 건너뛴다는 제품 주석(`agentdeck-notify.ps1:124`)까지 본다 —
        // `pids` 가 함께 실리면 훅이 매 이벤트마다 `Win32_Process` 전체를 훑고 있다는 뜻이다.
        const sid1 = sidFor('spec')
        const t0 = Date.now()
        const r1 = await fire(sid1, {
            args: ['-Status', 'running'],
            stdin: JSON.stringify({ session_id: sid1, hook_event_name: 'UserPromptSubmit' }),
            tabId: chosenId || 'hk-no-tab',
        })
        {
            const g = r1.got
            const j = g.json
            const bomFree = !!g.bytes && !(g.bytes.length >= 3 && g.bytes[0] === 0xEF && g.bytes[1] === 0xBB && g.bytes[2] === 0xBF)
            const tsOk = !!j && typeof j.ts === 'number' && Math.abs(j.ts - t0) < 120000
            const idOk = !!j && j.sessionId === sid1
            const stOk = !!j && j.status === 'running'
            const tabOk = !!j && j.tabId === (chosenId || 'hk-no-tab')
            const noPids = !!j && j.pids === undefined
            const quiet = r1.run.ok && String(r1.run.out || '').trim() === '' && String(r1.run.err || '').trim() === ''
            const exitOk = r1.run.ok && r1.run.code === 0
            const pass = !!j && idOk && stOk && tabOk && tsOk && bomFree && noPids && quiet && exitOk
            add('HK1', nameOf('HK1'), pass,
                pass
                    ? `훅을 격리 LOCALAPPDATA 로 실제 실행하니 ${g.file} 이 생기고`
                        + ` {sessionId,status,ts,tabId} 가 규격대로다 (BOM 없음 · tabId 가 있어 pids 미포함`
                        + ' · stdout/stderr 침묵 · exit 0)'
                    : `상태 파일이 규격과 다르다 (있나=${!!j} sessionId=${idOk} status=${j ? j.status : 'n/a'}`
                        + ` tabId=${j ? j.tabId : 'n/a'} ts타당=${tsOk} BOM없음=${bomFree} pids미포함=${noPids}`
                        + ` 조용함=${quiet} exit=${r1.run.code} 오류=${r1.run.spawnError || g.error || ''})`,
                { hookPath, file: g.file, text: g.text, run: { code: r1.run.code, out: r1.run.out, err: r1.run.err, timedOut: r1.run.timedOut } })
        }

        // ============================================================ HK2 이벤트별 상태 매핑
        //
        // **매핑의 사본을 여기 두지 않는다** — 제품이 설치한 명령줄(event + `-Status …`)을 그대로
        // 태우고, 훅이 쓴 status 가 그 값과 같은지만 본다. `StopFailure` 만 예외다: 훅이 `error` 를
        // 보고 갈라 쓴다고 자기 도움말에 적어 뒀으므로(rate_limit 이면 다른 상태), **다른 값이
        // 나와야** 통과이고 그 값이 훅의 `ValidateSet` 안에 있어야 한다.
        const measured = { limited: null, done: null }
        {
            const rows = []
            const uniq = []
            for (const e of installed.events) {
                if (!e.status || uniq.some(u => u.event === e.event)) { continue }
                uniq.push(e)
            }
            if (!uniq.length) {
                skipCases(['HK2'], '설치된 settings.json 에서 우리 훅의 이벤트→-Status 를 못 읽었다'
                    + ` — 매핑을 제품에게 물을 수 없다 (오류=${installed.error})`, { installed })
            } else {
                for (const e of uniq) {
                    const sid = sidFor('map')
                    const isFail = e.event === 'StopFailure'
                    const stdin = { session_id: sid, hook_event_name: e.event }
                    if (isFail) { stdin.error = 'overloaded' }
                    const r = await fire(sid, { args: ['-Status', e.status], stdin: JSON.stringify(stdin) })
                    const wrote = r.got.json ? String(r.got.json.status) : null
                    rows.push({ event: e.event, arg: e.status, wrote, reason: r.got.json ? r.got.json.reason : undefined,
                        code: r.run.code })
                    if (e.event === 'Stop') { measured.done = wrote }
                }
                // rate_limit 갈래 — 같은 이벤트를 새 세션으로 한 번 더
                const failArg = (uniq.find(e => e.event === 'StopFailure') || {}).status || null
                let lim = null
                if (failArg) {
                    const sid = sidFor('limit')
                    const msg = "You've hit your session limit · resets 12pm (Asia/Seoul)"
                    const r = await fire(sid, {
                        args: ['-Status', failArg],
                        stdin: JSON.stringify({ session_id: sid, hook_event_name: 'StopFailure',
                            error: 'rate_limit', last_assistant_message: msg }),
                    })
                    lim = { wrote: r.got.json ? String(r.got.json.status) : null,
                        reason: r.got.json ? String(r.got.json.reason || '') : null, want: msg }
                    measured.limited = lim.wrote
                }
                const plain = rows.filter(r => r.event !== 'StopFailure')
                const plainOk = plain.length > 0 && plain.every(r => r.wrote === r.arg)
                const failRow = rows.find(r => r.event === 'StopFailure') || null
                // 훅 도움말: rate_limit 이 아니면 `-Status` 그대로(error), 부연은 error 코드
                const failOk = !failRow || (failRow.wrote === failRow.arg && failRow.reason === 'overloaded')
                const limOk = !lim || (lim.wrote && lim.wrote !== failArg
                    && (!vocab.length || vocab.indexOf(lim.wrote) >= 0) && lim.reason === lim.want)
                const pass = plainOk && failOk && limOk && !!lim
                add('HK2', nameOf('HK2'), pass,
                    pass
                        ? `설치된 훅 명령줄 ${rows.length}개 이벤트를 그대로 태우니 status 가 전부 그 값이고,`
                            + ` StopFailure 는 error=overloaded 면 "${failRow ? failRow.wrote : ''}"(+코드),`
                            + ` error=rate_limit 이면 "${lim.wrote}"(+화면 문장)로 갈렸다`
                            + ` — 어휘는 훅의 ValidateSet(${vocab.join('/')}) 안이다`
                        : `매핑이 어긋난다 (평범한 이벤트=${JSON.stringify(plain)}`
                            + ` StopFailure=${JSON.stringify(failRow)} rate_limit=${JSON.stringify(lim)}`
                            + ` 어휘=${JSON.stringify(vocab)})`,
                    { rows, lim, vocab, installedScript: installed.script, hookPath,
                        sameScript: installed.script === hookPath })
            }
        }

        // ============================================================ HK3 진행중 중복 보고 생략
        // 훅이 자기 도움말에 적어 둔 절약 규칙(`agentdeck-notify.ps1:111-115`): 이미 running 인데
        // running 을 또 받으면 아무것도 쓰지 않는다(경과시간이 도구마다 0 으로 되돌아가는 것을 막는다).
        // 라벨이 붙은 보고는 그 규칙을 지나야 한다 — 사람이 셸에서 이름을 붙이는 유일한 경로다.
        {
            const sid = sidFor('dedupe')
            const stdin = JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse' })
            // This case tests deduplication without a mailbox; a tab ID enables mailbox heartbeats.
            const first = await fire(sid, { tabId: null, args: ['-Status', 'running'], stdin })
            const ts1 = first.got.json ? first.got.json.ts : null
            await sleep(1100)
            const second = await fire(sid, { tabId: null, args: ['-Status', 'running'], stdin })
            const ts2 = second.got.json ? second.got.json.ts : null
            await sleep(1100)
            const LABEL = 'HK 라벨 통과'
            const third = await fire(sid, { tabId: null, args: ['-Status', 'running', '-Label', LABEL], stdin })
            const ts3 = third.got.json ? third.got.json.ts : null
            const skipped = ts1 !== null && ts2 === ts1
            const wrote3 = ts3 !== null && ts3 !== ts1 && third.got.json.label === LABEL
            const pass = skipped && wrote3
            add('HK3', nameOf('HK3'), pass,
                pass
                    ? `running 을 두 번 보내니 두 번째는 파일을 다시 쓰지 않았고(ts ${ts1} 불변),`
                        + ` -Label 을 붙인 세 번째는 썼다(ts ${ts3}, label="${LABEL}")`
                    : `중복 생략/라벨 통과가 어긋난다 (ts ${ts1} -> ${ts2} -> ${ts3},`
                        + ` label=${third.got.json ? JSON.stringify(third.got.json.label) : 'n/a'})`,
                { ts1, ts2, ts3, label: third.got.json ? third.got.json.label : null })
        }

        // ============================================================ HK4 승인대기 오탐 차단
        // Notification 훅은 "도구 승인" 말고 "입력이 없다" 는 유휴 알림에도 발화한다. 훅은 두 가드를
        // 스스로 적어 뒀다(`agentdeck-notify.ps1:184-194`): ① 유휴 문구면 건드리지 않는다
        // ② 이미 done/idle/limited 면 건드리지 않는다. 둘 다 실제로 그러는지 본다.
        {
            const sid = sidFor('guard')
            const done = await fire(sid, {
                args: ['-Status', 'done'],
                stdin: JSON.stringify({ session_id: sid, hook_event_name: 'Stop' }),
            })
            const doneTs = done.got.json ? done.got.json.ts : null
            await sleep(1100)
            const idle = await fire(sid, {
                args: ['-Status', 'waiting'],
                stdin: JSON.stringify({ session_id: sid, hook_event_name: 'Notification',
                    message: 'Claude is waiting for your input' }),
            })
            const afterIdle = idle.got.json
            await sleep(1100)
            const perm = await fire(sid, {
                args: ['-Status', 'waiting'],
                stdin: JSON.stringify({ session_id: sid, hook_event_name: 'Notification',
                    message: 'Claude needs your permission to use Bash' }),
            })
            const afterPerm = perm.got.json
            // 진행중이던 세션에는 승인 알림이 실제로 먹어야 한다 — 안 먹으면 가드가 과하다
            const sid2 = sidFor('perm')
            await fire(sid2, {
                args: ['-Status', 'running'],
                stdin: JSON.stringify({ session_id: sid2, hook_event_name: 'UserPromptSubmit' }),
            })
            await sleep(1100)
            const MSG = 'Claude needs your permission to use Bash'
            const live = await fire(sid2, {
                args: ['-Status', 'waiting'],
                stdin: JSON.stringify({ session_id: sid2, hook_event_name: 'Notification', message: MSG }),
            })
            const j = live.got.json
            const keptIdle = !!afterIdle && afterIdle.status === 'done' && afterIdle.ts === doneTs
            const keptPerm = !!afterPerm && afterPerm.status === 'done' && afterPerm.ts === doneTs
            const tookLive = !!j && j.status === 'waiting' && j.reason === MSG
            const pass = keptIdle && keptPerm && tookLive
            add('HK4', nameOf('HK4'), pass,
                pass
                    ? '완료(done) 뒤에 온 유휴 알림과 승인 알림은 파일을 건드리지 않았고(ts 불변),'
                        + ' 진행중이던 다른 세션의 승인 알림은 waiting + 원문 이유로 들어갔다'
                    : `가드가 어긋난다 (유휴뒤=${afterIdle ? afterIdle.status + '/' + afterIdle.ts : 'n/a'}`
                        + ` 승인뒤=${afterPerm ? afterPerm.status + '/' + afterPerm.ts : 'n/a'} (기대 done/${doneTs})`
                        + ` 진행중세션=${j ? j.status + ' reason=' + JSON.stringify(j.reason) : 'n/a'})`,
                { doneTs, afterIdle, afterPerm, live: j })
        }

        // ============================================================ HK5 깨진 입력
        // 훅이 예외를 뱉고 죽으면 Claude Code 쪽에 오류가 보인다 — 사용자가 보는 것은 "훅이 깨졌다"
        // 뿐이고 원인은 안 보인다. 그래서 세 가지 어긋난 입력에서 **exit 0 · stdout 침묵**을 확인한다.
        {
            const sidA = sidFor('badjson')
            const a = await fire(sidA, {
                args: ['-Status', 'running', '-SessionId', sidA],
                stdin: 'this is not json {{{',
            })
            const sidB = sidFor('empty')
            const b = await fire(sidB, { args: ['-Status', 'done', '-SessionId', sidB], stdin: null })
            const sidC = sidFor('notab')
            const c = await fire(sidC, {
                args: ['-Status', 'waiting'],
                stdin: JSON.stringify({ session_id: sidC, hook_event_name: 'Notification',
                    message: 'Claude needs your permission to use Edit' }),
                tabId: null,
            })
            const okOf = r => r.run.ok && r.run.code === 0 && !r.run.timedOut
                && String(r.run.out || '').trim() === ''
            const ja = a.got.json
            const jb = b.got.json
            const jc = c.got.json
            // 훅 JSON 이 없으면 `-SessionId` 로 떨어진다(도움말의 그 폴백)
            const aOk = okOf(a) && !!ja && ja.sessionId === sidA && ja.status === 'running'
            const bOk = okOf(b) && !!jb && jb.sessionId === sidB && jb.status === 'done'
            // 탭 env 가 없으면 계보(pids)로 떨어진다. 이 프로브가 훅을 띄웠으므로 조상 첫 칸은
            // Tabby 자신이다 — 여기서 재는 것은 "그 갈래가 돌아 유효한 payload 를 낸다" 까지다
            const cOk = okOf(c) && !!jc && jc.tabId === undefined
                && Array.isArray(jc.pids) && jc.pids.length > 0 && Number.isInteger(jc.pids[0])
            const pass = aOk && bOk && cOk
            add('HK5', nameOf('HK5'), pass,
                pass
                    ? 'JSON 아닌 stdin · 빈 stdin · AGENTDECK_TAB 없음 셋 모두 exit 0 · stdout 침묵이고,'
                        + ` 앞 둘은 -SessionId 폴백으로, 마지막은 계보 폴백(pids=${JSON.stringify(jc.pids)},`
                        + ` claudeName=${JSON.stringify(jc.claudeName)})으로 떨어졌다`
                    : `깨진 입력 처리가 어긋난다 (JSON아님=${aOk} 빈stdin=${bOk} 탭env없음=${cOk})`
                        + ` / a=${JSON.stringify({ code: a.run.code, out: a.run.out, err: a.run.err, json: ja })}`
                        + ` / b=${JSON.stringify({ code: b.run.code, json: jb })}`
                        + ` / c=${JSON.stringify({ code: c.run.code, json: jc })}`,
                { a: { code: a.run.code, out: a.run.out, err: a.run.err, json: ja },
                    b: { code: b.run.code, json: jb }, c: { code: c.run.code, json: jc } })
        }

        // ============================================================ HK6 인코딩
        //
        // **이 일감의 주제.** PS 5.1 은 BOM 없는 `.ps1` 을 시스템 ANSI(CP949)로 읽어 한글이 든
        // 스크립트를 조용히 오작동시킨다 — 이 저장소에 그 사고가 있었다. 그래서 ⓐ 훅 폴더의
        // 모든 `.ps1` 이 UTF-8 BOM 으로 시작하는지 바이트로 보고, ⓑ 한글이 든 값(라벨·이유)이
        // 상태 파일에 온전히 들어가는지 왕복시킨다. 훅은 stdin 도 UTF-8 로 직접 열어 읽는다고
        // 적어 뒀으므로(`agentdeck-notify.ps1:57-60`) 한글이 든 stdin 도 같이 태운다.
        {
            const sid = sidFor('ko')
            const KO_LABEL = '한글 라벨 · 훅 검증'
            const KO_MSG = "사용량 한도에 걸렸습니다 · resets 12pm (Asia/Seoul)"
            const r = await fire(sid, {
                args: ['-Status', 'error', '-Label', KO_LABEL],
                stdin: JSON.stringify({ session_id: sid, hook_event_name: 'StopFailure',
                    error: 'rate_limit', last_assistant_message: KO_MSG }),
            })
            const j = r.got.json
            const roundTrip = !!j && j.label === KO_LABEL && j.reason === KO_MSG
            // 파일 자체가 BOM 없는 UTF-8 인가 — 바이트를 다시 인코딩해 같은지 본다
            const utf8Ok = !!r.got.bytes && !!r.got.text
                && NodeBuffer.from(r.got.text, 'utf8').equals(r.got.bytes)
                && !(r.got.bytes[0] === 0xEF && r.got.bytes[1] === 0xBB && r.got.bytes[2] === 0xBF)
            const boms = []
            try {
                for (const n of nodeFs.readdirSync(hooksDir)) {
                    if (!/\.ps1$/i.test(n)) { continue }
                    const fd = nodeFs.openSync(nodePath.join(hooksDir, n), 'r')
                    const head = NodeBuffer.alloc(3)
                    nodeFs.readSync(fd, head, 0, 3, 0)
                    nodeFs.closeSync(fd)
                    boms.push({ file: n, bom: head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF,
                        head: [head[0], head[1], head[2]] })
                }
            } catch (e) {
                boms.push({ error: String((e && e.message) || e) })
            }
            const allBom = boms.length > 0 && boms.every(b => b.bom === true)
            const pass = roundTrip && utf8Ok && allBom
            add('HK6', nameOf('HK6'), pass,
                pass
                    ? `한글 라벨·이유가 상태 파일에 그대로 왕복했고(파일은 BOM 없는 UTF-8),`
                        + ` 훅 폴더의 .ps1 ${boms.length}개가 전부 UTF-8 BOM 으로 시작한다`
                        + ` (${boms.map(b => b.file).join(', ')})`
                    : `인코딩이 어긋난다 (왕복=${roundTrip} label=${j ? JSON.stringify(j.label) : 'n/a'}`
                        + ` reason=${j ? JSON.stringify(j.reason) : 'n/a'} 파일UTF8=${utf8Ok}`
                        + ` ps1BOM=${JSON.stringify(boms)})`,
                { json: j, boms, hooksDir })
        }

        // ============================================================ HK7 TCP 즉시 통보
        //
        // 훅에는 전달 경로가 둘이다 — 파일(폴링)과 TCP(즉시). TCP 쪽은 지금까지 아무도 재지
        // 않았다. 여기서는 **프로브가 직접 리스너를 띄우고** 그 포트를 격리 LOCALAPPDATA 의
        // port 파일에 적어 훅이 그리로 보내게 한다. 실사용 Tabby 나 격리 인스턴스의 포트를
        // 쓰지 않는 이유 — 그 번호로 보내면 어느 Tabby 에 닿았는지 프로브가 확정할 수 없다.
        {
            const lines = []
            let listenErr = null
            const port = await new Promise(resolve => {
                const srv = nodeNet.createServer(sock => {
                    let buf = ''
                    sock.setEncoding('utf8')
                    sock.on('data', d => {
                        buf += d
                        let nl
                        while ((nl = buf.indexOf('\n')) >= 0) {
                            lines.push(buf.slice(0, nl))
                            buf = buf.slice(nl + 1)
                        }
                    })
                    sock.on('end', () => { if (buf) { lines.push(buf) } })
                    sock.on('error', () => { /* 훅이 먼저 끊어도 무해하다 */ })
                })
                srv.on('error', e => { listenErr = String((e && e.message) || e); resolve(0) })
                srv.listen(0, '127.0.0.1', () => { tcpServer = srv; resolve(srv.address().port) })
            })
            if (!port) {
                skipCases(['HK7'], `127.0.0.1 에 리스너를 띄울 수 없다 — TCP 경로를 잴 수 없다 (${listenErr})`,
                    { listenErr })
            } else {
                nodeFs.writeFileSync(nodePath.join(isoLad, 'tabby-agentdeck', 'port'), String(port), 'utf8')
                const sid = sidFor('tcp')
                const r = await fire(sid, {
                    args: ['-Status', 'waiting'],
                    stdin: JSON.stringify({ session_id: sid, hook_event_name: 'Notification',
                        message: 'Claude needs your permission to use Write' }),
                })
                const got = await waitFor(() => (lines.length ? lines.slice() : null), 6000, 150)
                const one = got && got.length === 1 ? jsonOf(got[0]) : null
                const fileJson = r.got.json
                const sameKeys = !!one && !!fileJson
                    && JSON.stringify(Object.keys(one).sort()) === JSON.stringify(Object.keys(fileJson).sort())
                const sameAll = sameKeys && Object.keys(one).every(k => JSON.stringify(one[k]) === JSON.stringify(fileJson[k]))
                const pass = !!one && sameAll
                add('HK7', nameOf('HK7'), pass,
                    pass
                        ? `port 파일에 프로브 리스너(${port})를 적어 두니 훅이 파일과 **같은 JSON 한 줄**을`
                            + ' 즉시 밀어 넣었다 (줄 하나 · 키·값 전부 일치)'
                        : `TCP 통보가 어긋난다 (받은줄=${got ? got.length : 0}`
                            + ` ${JSON.stringify(got || [])} / 파일=${JSON.stringify(fileJson)})`,
                    { port, lines: got, fileJson })
            }
        }

        // ============================================================ HK8 화면까지 오는가
        //
        // **이 경로의 진짜 계약.** 훅이 파일을 잘 써도 사이드바가 안 바뀌면 사용자에게는 아무 일도
        // 일어나지 않는다. 그래서 훅이 만든 파일의 **바이트를 그대로** 플러그인이 보는 폴더로
        // 옮기고(내용을 프로브가 만들지 않는다), 그 탭의 배지·이유·pin 이 바뀌는지 되읽는다.
        // 기대하는 상태 값은 HK2 에서 **실측한 것**을 쓴다 — 매핑 사본을 만들지 않기 위해서다.
        if (!targetTab || !chosenId) {
            skipCases(['HK8'], 'AGENTDECK_TAB 이 심긴 줄을 못 찾았다 — 보고를 탭에 묶을 수 없다'
                + ' (tabId 없이 보내면 실사용 Tabby 의 활성 탭에 박히므로 legacy 경로는 쓰지 않는다)',
            { tabs: ad.app.tabs.length, known: [...known], owned: [...ownedIdx] })
        } else if (!measured.limited || !measured.done) {
            skipCases(['HK8'], 'HK2 에서 상태 값을 실측하지 못해 기대값을 제품에게 물을 수 없다'
                + ` (limited=${measured.limited} done=${measured.done})`, { measured })
        } else {
            const g = typeof ad.groups === 'function' ? ad.groups() : null
            const drawn = g && g.tabsUsedByRender ? g.tabsUsedByRender.indexOf(targetIdx) >= 0 : !!rowOf(targetIdx)
            if (!drawn) {
                skipCases(['HK8'], `대상 줄(${targetIdx})이 지금 화면에 그려지지 않는다 (검색·상태 필터)`
                    + ' — 배지를 되읽을 수 없다', { targetIdx, filter: g ? g.filter : null })
            } else {
                const st0 = ad.status.get(targetTab)
                savedState = { status: st0.status, label: st0.label, reason: st0.reason,
                    pinned: st0.pinned, since: st0.since }
                const badge0 = badgeOf(targetIdx)
                const text0 = badge0 ? badge0.textContent : null
                const SID8 = sidFor('screen')
                realFile = nodePath.join(realStatusDir, SID8 + '.json')

                /** 훅을 돌려 그 **파일 바이트를 그대로** 플러그인 폴더로 옮긴다 */
                const deliver = async (args, stdin) => {
                    const r = await fire(SID8, { args, stdin: JSON.stringify(stdin) })
                    if (!r.got.bytes) { return { r, wrote: null } }
                    nodeFs.mkdirSync(realStatusDir, { recursive: true })
                    nodeFs.writeFileSync(realFile, r.got.bytes)
                    return { r, wrote: r.got.json }
                }

                const LIMIT_MSG = "You've hit your session limit · resets 12pm (Asia/Seoul)"
                const one = await deliver(['-Status', 'error'],
                    { session_id: SID8, hook_event_name: 'StopFailure', error: 'rate_limit',
                        last_assistant_message: LIMIT_MSG })
                const seen1 = await waitFor(() => {
                    const st = ad.status.get(targetTab)
                    const b = badgeOf(targetIdx)
                    if (!one.wrote || !b) { return null }
                    return st.status === one.wrote.status && st.pinned && st.reason
                        && b.textContent.indexOf(' · ' + st.reason) > 0 ? { st, b } : null
                }, 9000)
                // **값을 베껴 둔다** — `ad.status.get()` 은 살아 있는 객체라 아래 두 번째 보고가
                // 그 자리를 바꿔 버린다(첫 실행에서 detail 이 `이유 ""` 로 찍혔다). 배지 노드도
                // 다음 렌더에 새로 만들어지므로 글자를 지금 떠 둔다
                const live1 = ad.status.get(targetTab)
                const b1el = badgeOf(targetIdx)
                const st1 = { status: live1.status, reason: live1.reason, pinned: live1.pinned }
                const b1 = { textContent: b1el ? b1el.textContent : null, title: b1el ? b1el.title : null,
                    pinnedClass: b1el ? b1el.classList.contains('pinned') : null }
                let pass8 = false
                let detail8 = ''
                if (!one.wrote) {
                    detail8 = `훅이 파일을 만들지 못해 옮길 것이 없다 (${one.r.got.error || ''})`
                } else if (!seen1) {
                    detail8 = `훅이 쓴 "${one.wrote.status}" 가 9초 안에 화면에 오지 않았다`
                        + ` (지금 status=${st1.status} pinned=${st1.pinned} reason=${JSON.stringify(st1.reason)}`
                        + ` 배지=${b1 ? JSON.stringify(b1.textContent) : 'null'})`
                        + ' — notifyChannel · resolveTab(tabId) · 1초 렌더 tick 을 볼 것'
                } else {
                    // 이어서 done — 이유를 가질 수 없는 상태로 바뀌면 부연이 비어야 한다
                    // (`status.service.ts` 의 REASON_STATUSES)
                    const two = await deliver(['-Status', measured.done],
                        { session_id: SID8, hook_event_name: 'Stop' })
                    const seen2 = await waitFor(() => {
                        const st = ad.status.get(targetTab)
                        const b = badgeOf(targetIdx)
                        if (!two.wrote || !b) { return null }
                        return st.status === two.wrote.status && st.reason === ''
                            && b.textContent.indexOf(' · ') < 0 ? { st, b } : null
                    }, 9000)
                    const st2 = ad.status.get(targetTab)
                    const b2 = badgeOf(targetIdx)
                    const changed = text0 === null || (b2 && b2.textContent !== text0)
                    // 배지에 pin 표시까지 붙어야 한다 — `setManual` 이 걸어 둔 pin 이 화면에도 보이는가
                    pass8 = !!seen2 && changed && b1.pinnedClass === true
                    detail8 = pass8
                        ? `훅이 만든 파일을 그대로 옮기니 ${targetIdx} 번 줄이 tabId=${chosenId} 로 묶여`
                            + ` 배지가 "${b1.textContent}"(이유 "${st1.reason}" · pin 표시 ${b1.pinnedClass}) 로 바뀌고,`
                            + ` 이어 보낸 "${two.wrote.status}" 에서는 부연이 비워졌다("${b2.textContent}")`
                        : `두 번째 보고("${two.wrote ? two.wrote.status : 'n/a'}")가 화면에 안 왔다`
                            + ` (지금 status=${st2.status} reason=${JSON.stringify(st2.reason)}`
                            + ` 배지=${b2 ? JSON.stringify(b2.textContent) : 'null'} 처음배지=${JSON.stringify(text0)})`
                }
                add('HK8', nameOf('HK8'), pass8, detail8,
                    { targetIdx, chosenId, sid: SID8, measured, text0,
                        after1: { status: st1.status, reason: st1.reason, pinned: st1.pinned,
                            badge: b1 ? b1.textContent : null, title: b1 ? b1.title : null },
                        state: { status: ad.status.get(targetTab).status, reason: ad.status.get(targetTab).reason } })
            }
        }

        // 정상 흐름의 정리 — HK9 를 여기서 매긴다 (finally 는 예외 판을 위한 안전망)
        await doCleanup()
    } catch (e) {
        if (String((e && e.message) || e) !== 'ad-hk-prereq') {
            add('EXCEPTION', '프로브 실행 중 예외', false, String((e && e.message) || e), null)
        }
        // 예외가 났어도 **안 매긴 케이스는 판정 불가로 채운다** — 결과에서 통째로 빠지면
        // 요약만 조용히 짧아져 "그 케이스는 재지도 않았다" 를 아무도 모른다
        skipCases(ALL_IDS.filter(id => id !== 'HK9'),
            `프로브가 도중에 멈췄다: ${String((e && e.message) || e)}`, null)
    } finally {
        // 안전망 — 예외로 빠졌으면 여기서 치우고 HK9 를 매긴다 (멱등: 정상 흐름은 이미 돌았다)
        try {
            await doCleanup()
        } catch (e) {
            cleanup.error = String((e && e.message) || e)
            skipCases(['HK9'], `정리 중 예외: ${cleanup.error}`, { cleanup })
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
