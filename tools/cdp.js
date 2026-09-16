#!/usr/bin/env node
/**
 * Tabby(Electron) 안을 CDP 로 들여다보는 최소 클라이언트.
 *
 *   node tools/cdp.js <port> <표현식파일>          # Runtime.evaluate
 *   node tools/cdp.js <port> --keys "<키열>"       # 진짜 키 이벤트 (Input.dispatchKeyEvent)
 *   node tools/cdp.js <port> --shot <out.png> [선택자]   # Page.captureScreenshot (선택자가 있으면 그 요소만)
 *
 * `--shot` 은 문서용 스크린샷을 **재생성 가능하게** 만들려고 있다. 손으로 찍어 손으로 자르면
 * 화면 크기·창 상태에 결과가 묶여 같은 그림을 다시 만들 수 없다. 선택자를 주면 그 요소의
 * 경계상자를 `clip` 으로 넘겨 **자르는 일까지 도구가** 한다 — 같은 명령이 언제나 같은 그림을 낸다.
 *
 * `--keys` 가 따로 있는 이유 — `pane.sendInput()` 은 pty 에 바이트를 직접 쓰는 것이라
 * **키보드 이벤트 경로를 타지 않는다**. Enter 라벨(claimEnterLabel)이나 Shift+Enter 핫키처럼
 * keydown 을 가로채는 기능은 sendInput 으로는 검증되지 않는다 (2026-09-01: 라벨이 `—` 로 남아
 * "라벨이 깨졌다" 고 오판할 뻔했다). 키열은 쉼표로 끊어 적는다:
 *
 *   Enter | Shift-Enter | Escape | Ctrl-V | Ctrl-C | text:안녕
 *
 * `ws` 의존성 없이 쓰려고 WebSocket 핸드셰이크/프레임을 직접 만든다.
 * Tabby 를 `--remote-debugging-port=<port>` 로 띄워야 붙는다.
 */
const http = require('http'), net = require('net'), crypto = require('crypto'), fs = require('fs')
const port = process.argv[2] || '9222'
const keysMode = process.argv[3] === '--keys'
const shotMode = process.argv[3] === '--shot'
const expr = (keysMode || shotMode) ? null : fs.readFileSync(process.argv[3], 'utf8')
const keySpec = keysMode ? (process.argv[4] || '') : null
const shotOut = shotMode ? process.argv[4] : null
const shotSel = shotMode ? (process.argv[5] || '') : null

const get = p => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path: p }, r => {
        let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)))
    }).on('error', rej)
})

/** 여러 명령을 순차로 보내고 마지막 응답을 돌려준다 */
function session (url, commands) {
    return new Promise((res, rej) => {
        const u = new URL(url)
        const key = crypto.randomBytes(16).toString('base64')
        const sock = net.connect(+u.port, u.hostname, () => {
            sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\n`
                + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
                + `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
        })
        let handshook = false, buf = Buffer.alloc(0)
        let next = 0
        const results = []
        const frame = payload => {
            const data = Buffer.from(payload)
            const mask = crypto.randomBytes(4)
            const len = data.length
            let head
            if (len < 126) { head = Buffer.from([0x81, 0x80 | len]) }
            else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0xFE; head.writeUInt16BE(len, 2) }
            else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0xFF; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6) }
            sock.write(Buffer.concat([head, mask, Buffer.from(data.map((b, i) => b ^ mask[i % 4]))]))
        }
        sock.on('data', chunk => {
            buf = Buffer.concat([buf, chunk])
            if (!handshook) {
                const i = buf.indexOf('\r\n\r\n')
                if (i < 0) { return }
                handshook = true
                buf = buf.slice(i + 4)
                send()
            }
            while (buf.length >= 2) {
                let len = buf[1] & 0x7F, off = 2
                if (len === 126) { len = buf.readUInt16BE(2); off = 4 }
                else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10 }
                if (buf.length < off + len) { return }
                const payload = buf.slice(off, off + len).toString('utf8')
                buf = buf.slice(off + len)
                let msg
                try { msg = JSON.parse(payload) } catch { continue }
                if (msg.id !== next) { continue }
                results.push(msg)
                if (next >= commands.length) { sock.destroy(); return res(results) }
                setTimeout(send, commands[next - 1]?.delay ?? 0)
            }
        })
        function send () {
            const cmd = commands[next]
            next++
            frame(JSON.stringify({ id: next, method: cmd.method, params: cmd.params }))
        }
        sock.on('error', rej)
    })
}

/** 키열 문자열을 Input.dispatchKeyEvent 명령들로 바꾼다 */
function keyCommands (spec) {
    const KEYS = {
        Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) },
        Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
        Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, text: String.fromCharCode(9) },
        Up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
        // TUI 선택지를 고르려면 방향키가 필요하다 — codex 의 업데이트·승인 프롬프트가 커서식이다.
        //
        // **없는 키 이름은 조용히 한 글자 키로 폴백된다**(아래 `if (!base)`). 2026-09-08 에
        // `Down` 이 없는 줄 모르고 `--keys "Down,Enter"` 를 보냈다가, 커서가 안 내려간 상태로
        // Enter 만 먹어 codex 의 `1. Update now` 가 실행돼 **전역 npm 패키지가 올라갔다**.
        // 폴백을 없애지는 않았다(Ctrl-V 같은 한 글자 키에 필요하다) — 대신 쓸 키를 여기 채운다.
        Down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
        Left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
        Right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
        Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
        End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
        Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    }
    const MOD = { Shift: 8, Ctrl: 2, Alt: 1 }
    const out = []
    for (const raw of spec.split(',').map(t => t.trim()).filter(Boolean)) {
        if (raw.startsWith('text:')) {
            out.push({ method: 'Input.insertText', params: { text: raw.slice(5) }, delay: 60 })
            continue
        }
        const parts = raw.split('-')
        const name = parts.pop()
        let modifiers = 0
        for (const m of parts) { modifiers |= MOD[m] ?? 0 }
        let base = KEYS[name]
        if (!base) {
            // 한 글자 키 (Ctrl-V 등)
            base = { key: name.toLowerCase(), code: 'Key' + name.toUpperCase(), windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) }
        }
        // 조합키가 붙으면 text 를 보내면 안 된다 (Shift+Enter 가 그냥 Enter 로 들어간다)
        const text = modifiers ? undefined : base.text
        out.push({ method: 'Input.dispatchKeyEvent', params: { type: text ? 'keyDown' : 'rawKeyDown', modifiers, ...base, text }, delay: 30 })
        out.push({ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', modifiers, key: base.key, code: base.code, windowsVirtualKeyCode: base.windowsVirtualKeyCode }, delay: 120 })
    }
    return out
}

;(async () => {
    const list = await get('/json/list')
    const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!page) { console.error('page 타깃이 없다. Tabby 창이 떠 있는지 확인할 것'); process.exit(2) }
    if (keysMode) {
        const cmds = keyCommands(keySpec)
        await session(page.webSocketDebuggerUrl, cmds)
        console.log(`keys sent: ${keySpec} (${cmds.length} events)`)
        return
    }
    if (shotMode) {
        // 선택자를 주면 **그 요소의 경계상자**를 먼저 물어보고 `clip` 으로 넘긴다.
        // 창 전체를 찍고 나중에 자르면 자른 좌표가 화면 크기에 묶여 재현이 안 된다
        const cmds = []
        if (shotSel) {
            cmds.push({
                method: 'Runtime.evaluate',
                params: {
                    expression: `(() => { const e = document.querySelector(${JSON.stringify(shotSel)});`
                        + ' if (!e) { return null } const r = e.getBoundingClientRect();'
                        + ' return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } })()',
                    returnByValue: true,
                },
            })
        }
        const pre = shotSel ? await session(page.webSocketDebuggerUrl, cmds) : []
        const clip = shotSel ? pre[0]?.result?.result?.value : null
        if (shotSel && !clip) { console.error(`선택자를 못 찾았다: ${shotSel}`); process.exit(4) }
        if (clip) {
            // 소수점 좌표를 그대로 넘기면 가장자리에 반 픽셀 띠가 남는다
            clip.x = Math.round(clip.x); clip.y = Math.round(clip.y)
            clip.width = Math.round(clip.width); clip.height = Math.round(clip.height)
        }
        const [shot] = await session(page.webSocketDebuggerUrl, [{
            method: 'Page.captureScreenshot',
            params: { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) },
        }])
        const data = shot.result?.result?.data ?? shot.result?.data
        if (!data) { console.error('스크린샷이 비었다', JSON.stringify(shot).slice(0, 200)); process.exit(5) }
        fs.writeFileSync(shotOut, Buffer.from(data, 'base64'))
        console.log(`shot: ${shotOut}${clip ? ` (${clip.width}x${clip.height} @ ${clip.x},${clip.y})` : ' (전체 창)'}`)
        return
    }
    const [r] = await session(page.webSocketDebuggerUrl, [{
        method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true },
    }])
    if (r.result?.exceptionDetails) {
        console.error('EXCEPTION:', r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails))
        process.exit(3)
    }
    const v = r.result?.result?.value
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1))
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
