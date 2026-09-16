#!/usr/bin/env node
/**
 * 가이드 스크린샷을 다시 만든다.
 *
 *   powershell -ExecutionPolicy Bypass -File tools/test-instance.ps1
 *   node tools/shot-guide.js
 *   powershell -ExecutionPolicy Bypass -File tools/test-instance.ps1 -Kill
 *
 * 장면은 `tools/mock-guide.js` 가 세우고(샘플 세션·샘플 폴더·샘플 문서), 자르고 찍는 것은
 * `tools/cdp.js --shot <파일> <선택자>` 다. **손으로 찍고 손으로 자르지 않는다** —
 * 그러면 그림이 그 순간의 화면 상태에 묶여 다시 만들 수 없다. 여기서는 같은 명령이 언제나
 * 같은 그림을 낸다.
 *
 * 선택자가 곧 잘린 영역이다. 사이드바만 필요한 그림은 `#agentdeck-sidebar`, 패널까지 필요한
 * 그림은 `.content` 를 준다.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const root = path.join(__dirname, '..')
const PORT = process.argv[2] || '9222'
const OUT = path.join(root, 'docs', 'guide', 'img')
const SCENE_DIR = path.join(os.tmpdir(), 'agentdeck-guide')

/** `alt` 텍스트가 말하는 그림을 그대로 만든다 — 파일명과 장면과 자를 곳 */
const SHOTS = [
    { file: '01-overview.png', scene: 'overview', sel: '#agentdeck-sidebar' },
    { file: '02-search.png',   scene: 'search',   sel: '#agentdeck-sidebar' },
    { file: '03-keyboard.png', scene: 'keyboard', sel: '#agentdeck-sidebar' },
    { file: '04-viewer.png',   scene: 'viewer',   sel: '#agentdeck-view' },
    { file: '05-diff.png',     scene: 'diff',     sel: '#agentdeck-view' },
    { file: '07-context.png',  scene: 'context',  sel: '#agentdeck-sidebar' },
    { file: '08-collapse.png', scene: 'collapse', sel: '#agentdeck-sidebar' },
]

function cdp (args) {
    const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'cdp.js'), PORT, ...args],
        { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) {
        console.error(r.stdout || '', r.stderr || '')
        throw new Error('cdp 실패: ' + args.join(' '))
    }
    return (r.stdout || '').trim()
}

function scene (name) {
    fs.mkdirSync(SCENE_DIR, { recursive: true })
    fs.writeFileSync(path.join(SCENE_DIR, 'scene.txt'), name, 'utf8')
    return cdp([path.join(__dirname, 'mock-guide.js')])
}

fs.mkdirSync(OUT, { recursive: true })
for (const s of SHOTS) {
    const said = scene(s.scene)
    console.log(`${s.scene}: ${said}`)
    console.log('  ' + cdp(['--shot', path.join(OUT, s.file), s.sel]))
}
console.log(scene('cleanup'))
console.log('\n끝.')
