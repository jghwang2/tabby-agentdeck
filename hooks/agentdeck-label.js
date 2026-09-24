#!/usr/bin/env node
/**
 * 작업 라벨만 바꾼다 (상태는 건드리지 않는다).
 *
 *   node agentdeck-label.js <sessionId> "결제 모듈 버그 수정"
 *   AGENTDECK_SESSION=<id> node agentdeck-label.js "빌드 중"
 *
 * 에이전트가 단계(분석→구현→빌드→검증)를 넘어갈 때마다 부르는 용도다.
 * PowerShell 훅(agentdeck-notify.ps1)은 프로세스 기동만 100ms 대라 자주 부르기엔 무겁고,
 * 그쪽은 status 파일을 읽어 직전 값과 합치는 read-modify-write 를 한다. 여기서는
 * 아는 것(라벨)만 보내고 병합은 플러그인이 한다 (notify.service.ts apply 주석 참고).
 *
 * TCP(127.0.0.1:47500)로 한 줄 밀어넣고, Tabby 가 안 떠 있으면 status 파일로 폴백한다.
 * 파일도 부분 갱신을 이해하므로 status 를 지어내지 않는다.
 */
const net = require('net')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const sessionId = args.length > 1 ? args[0] : process.env.AGENTDECK_SESSION
const label = (args.length > 1 ? args[1] : args[0] || '').trim()
const port = Number(process.env.AGENTDECK_PORT || 47500)

if (!sessionId || !label) {
    console.error('usage: agentdeck-label.js <sessionId> "<label>"  (or AGENTDECK_SESSION env)')
    process.exit(2)
}

const payload = JSON.stringify({ sessionId, label, ts: Date.now() }) + '\n'

const fallback = () => {
    const dir = path.join(require('./agentdeck-runtime.cjs').runtimeRoot(), 'status')
    try {
        fs.mkdirSync(dir, { recursive: true })
        // 직전 status 를 읽어 합치지 않는다 — 플러그인이 없는 필드를 지금 값으로 채운다
        fs.writeFileSync(path.join(dir, sessionId + '.json'), payload.trim(), 'utf8')
        console.log('label -> file')
    } catch (e) {
        console.error('label failed: ' + e.message)
        process.exit(1)
    }
}

const sock = net.connect({ port, host: '127.0.0.1' }, () => {
    sock.end(payload, () => {
        console.log('label -> tcp:' + port)
        process.exit(0)
    })
})
sock.setTimeout(700)
sock.on('timeout', () => { sock.destroy(); fallback() })
sock.on('error', () => fallback())
