/**
 * 스크린샷용 — "지금 이 탭" 줄을 실제로 띄워 둔다 (`tools/shot.ps1 -Test` 로 찍는다).
 *
 *   node tools/cdp.js 9222 tools/probe-meta-shot.js   # 띄운다 (앞서 띄운 것은 먼저 치운다)
 *   powershell -File tools/shot.ps1 -Test -Out shot.png
 *
 * `cdp.js` 는 표현식 파일 뒤의 인자를 넘기지 않으므로 끄는 모드를 따로 두지 않는다 — 대신
 * 매 실행 첫머리에 같은 접두 파일을 치우고, 남은 것은 다음 기동 때 제품이 스스로 지운다
 * (`notify.service` 의 `ts < startedAt` 규칙).
 *
 * 회귀 판정은 `probe-meta.js` 가 한다. 이건 **사람이 눈으로 볼 화면**을 만드는 것뿐이다 —
 * 레이아웃(200px 폭에서 잘리는지·버튼 줄을 밀어내는지)은 DOM 값으로는 안 보인다.
 */
(async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const ad = window.__agentdeck
    if (!ad) { return JSON.stringify({ error: '__agentdeck 이 없다' }) }

    const ROOT = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'tabby-agentdeck')
    const PREFIX = 'adprobe-shot-'

    const clear = () => {
        const removed = []
        for (const dir of ['status', 'meta']) {
            const d = path.join(ROOT, dir)
            let names = []
            try { names = fs.readdirSync(d) } catch (e) { continue }
            for (const n of names) {
                if (n.indexOf(PREFIX) !== 0) { continue }
                try { fs.unlinkSync(path.join(d, n)); removed.push(dir + '/' + n) } catch (e) { /* 이미 없다 */ }
            }
        }
        return removed
    }

    const cleared = clear()

    const withIds = () => (ad.tabIds() || []).map((r, i) => ({ i, id: ((r.ids || [])[0] || null) })).filter(r => r.id)
    // 격리 인스턴스는 `Welcome` 탭만 달고 뜰 수 있다 — 제품 경로(`+ 새 탭`)로 터미널을 하나 연다
    if (!withIds().length) {
        const btn = document.querySelector('#agentdeck-sidebar .ad-new')
        if (btn) { btn.click() }
        for (let i = 0; i < 40 && !withIds().length; i++) { await new Promise(r => setTimeout(r, 300)) }
    }
    const rows = withIds()
    if (!rows.length) { return JSON.stringify({ error: 'AGENTDECK_TAB 이 심긴 탭이 없다' }) }
    const sid = PREFIX + Date.now().toString(36)
    ad.app.selectTab(ad.app.tabs[rows[0].i])

    fs.mkdirSync(path.join(ROOT, 'status'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, 'status', sid + '.json'), JSON.stringify({
        sessionId: sid, status: 'running', ts: Date.now(), tabId: rows[0].id, agent: 'claude',
        label: '사이드바 status 줄',
    }), 'utf8')
    fs.mkdirSync(path.join(ROOT, 'meta'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, 'meta', sid + '.json'), JSON.stringify({
        sessionId: sid, ts: Date.now(), agent: 'claude',
        model: 'Opus 5', modelId: 'claude-opus-5', effort: 'high', version: '2.1.270', fastMode: false,
        account: 'someone@example.com', org: 'example-org', configDir: '', cwd: 'D:\\Project\\tabby-agentdeck',
        contextPct: 13,
        limits: { fiveHourPct: 91, fiveHourResetsAt: Math.floor(Date.now() / 1000) + 4020,
            sevenDayPct: 15, sevenDayResetsAt: Math.floor(Date.now() / 1000) + 86400 },
    }), 'utf8')

    for (let i = 0; i < 20; i++) {
        const el = document.querySelector('#agentdeck-sidebar .ad-now')
        if (el && !el.hidden) {
            const r = el.getBoundingClientRect()
            return JSON.stringify({
                shown: true, sid, cleared,
                rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
                text: el.textContent.replace(/\s+/g, ' ').trim(),
            })
        }
        await new Promise(r => setTimeout(r, 250))
    }
    return JSON.stringify({ shown: false, sid })
})()
