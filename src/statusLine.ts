import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { claudeSettingsPath } from './claudeHooks'

/**
 * Claude Code 의 `statusLine` 을 한 겹 감싸 설치/해제한다.
 *
 * 왜 필요한가 — 사이드바 하단의 "지금 이 탭" 줄이 쓰는 값(모델·effort·컨텍스트%·5h/7d 한도%)은
 * **statusLine stdin 에만** 내려온다. 훅 JSON 에는 없고, 대화기록(jsonl)에는 모델까지만 있다.
 *
 * **남의 statusLine 을 지우지 않는다.** 이미 걸려 있던 설정은 통째로 `statusline-inner.json`
 * 으로 옮겨 두고, 우리 스크립트가 매 렌더마다 그것을 그대로 실행해 출력을 흘려보낸다
 * (`hooks/agentdeck-statusline.mjs`). 해제하면 옮겨 둔 것을 제자리에 돌려놓는다.
 *
 * 훅(claudeHooks.ts)과 같은 규칙을 따른다 — 판정은 순수 함수로 빼서 테스트에 묶고,
 * 파일을 쓰기 전에 `settings.json` 백업을 남긴다.
 */

/** 우리 래퍼인지 알아보는 표식 — 파일 이름이 그대로 명령줄에 들어간다 */
const MARK = 'agentdeck-statusline'

/** 원래 걸려 있던 statusLine 을 옮겨 두는 자리 (스크립트도 같은 경로를 읽는다) */
export function innerConfigPath (): string {
    return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'tabby-agentdeck',
        'statusline-inner.json',
    )
}

/** statusLine 스크립트의 실제 경로. dist/index.js 기준으로 한 단계 위가 패키지 뿌리다 */
export function statusLineScriptPath (): string {
    return path.join(__dirname, '..', 'hooks', 'agentdeck-statusline.mjs')
}

export function statusLineSupported (): boolean {
    return fs.existsSync(statusLineScriptPath())
}

/** 우리 래퍼가 걸려 있나 — 파일을 읽지 않는 순수 판정 */
export function isWrapped (settings: any): boolean {
    const sl = settings?.statusLine
    return !!sl && sl.type === 'command' && String(sl.command ?? '').includes(MARK)
}

/**
 * 설정 객체의 statusLine 을 우리 래퍼로 갈아 끼운 새 객체를 돌려준다 (원본은 건드리지 않는다).
 *
 * 이미 우리 것이면 명령줄만 지금 경로로 갱신한다 — 그때 안쪽 설정은 **그대로 둔다**
 * (다시 옮기면 안쪽에 우리 자신이 들어가 고리가 된다).
 */
export function wrapStatusLine (settings: any, script: string): { next: any, inner: any | null } {
    const next = { ...(settings ?? {}) }
    const current = next.statusLine
    const inner = isWrapped(next) ? null : (current ?? null)
    // 경로는 슬래시로 적는다 — Claude Code 명령줄은 셸을 거치며 백슬래시가 뭉개질 수 있다
    // (훅에서 `D:\Project\…` 가 `D:Project…` 로 사라져 조용히 실패한 적이 있다, 2026-08-28 실측)
    next.statusLine = { type: 'command', command: `node "${script.replace(/\\/g, '/')}"` }
    return { next, inner }
}

/**
 * 우리 래퍼를 걷어내고 안쪽 설정을 제자리에 돌려놓은 새 객체.
 * 안쪽이 없었으면(원래 statusLine 이 없던 사용자) 키 자체를 지운다.
 */
export function unwrapStatusLine (settings: any, inner: any | null): any {
    const next = { ...(settings ?? {}) }
    if (!isWrapped(next)) {
        return next // 우리 것이 아니다 — 남의 설정을 건드리지 않는다
    }
    if (inner) {
        next.statusLine = inner
    } else {
        delete next.statusLine
    }
    return next
}

function readSettings (): any {
    try {
        const raw = fs.readFileSync(claudeSettingsPath(), 'utf8')
        return raw.trim() ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

function writeSettings (settings: any): void {
    const file = claudeSettingsPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, file + '.agentdeck-backup')
    }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

function readInner (): any | null {
    try {
        return JSON.parse(fs.readFileSync(innerConfigPath(), 'utf8'))
    } catch {
        return null
    }
}

export function statusLineInstalled (): boolean {
    return isWrapped(readSettings())
}

/** 지금 안쪽에 무엇이 있는지 (설정 창이 사용자에게 보여 준다) */
export function innerCommand (): string {
    const inner = readInner()
    return inner?.type === 'command' ? String(inner.command ?? '') : ''
}

export function installStatusLine (): void {
    const script = statusLineScriptPath()
    if (!fs.existsSync(script)) {
        throw new Error(`statusLine 스크립트를 찾지 못했다: ${script}`)
    }
    const { next, inner } = wrapStatusLine(readSettings(), script)
    // 안쪽을 **먼저** 저장한다. 반대로 하면 그 사이에 statusLine 이 한 번 돌 때
    // 안쪽을 못 찾아 사용자의 statusLine 이 잠깐 비어 보인다
    if (inner !== null) {
        const file = innerConfigPath()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(inner, null, 2) + '\n', 'utf8')
    }
    writeSettings(next)
}

export function uninstallStatusLine (): void {
    writeSettings(unwrapStatusLine(readSettings(), readInner()))
    try {
        fs.unlinkSync(innerConfigPath())
    } catch {
        // 없으면 그만
    }
}
