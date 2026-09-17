/**
 * 설정 창 **단축키** 절의 계산부 — 키 이벤트를 Tabby 식 문자열로 바꾸고, 겹치는 핫키를 찾고,
 * 표에 써넣을 내용을 만든다.
 *
 * 왜 따로 있나 — README 첫 화면에 올린 키들은 사람이 바꾸고 싶어지는 것들이고, Tabby 순정
 * `단축키` 탭은 항목이 200개 가까워 `agentdeck-*` 를 찾는 것부터 일이다. 그리고 그 탭은
 * **겹침을 말해 주지 않는다** — 같은 키가 두 id 에 매이면 HotkeysService 가 하나만 고르는데
 * 어느 쪽인지 화면에는 안 보인다(2026-09-17 유저 지시: "겹치면 ~~랑 겹칩니다 하고 알려주고
 * 바꾸게").
 *
 * **Tabby 의 규칙을 그대로 따른다** (`tabby-core/src/services/hotkeys.util.ts`):
 * - 키 이름: 수식키는 `Ctrl` · 메타(`Win`/`⌘`/`Super`) · 알트(`Alt`/`⌥`) · `Shift`.
 *   라틴 글자는 `event.key` 대문자(드보락 대응), 나머지는 `event.code` 에서 `Key`·`Arrow`·`Digit`
 *   접두를 떼고 구두점만 표로 바꾼다.
 * - 한 번 누름(keystroke) = 수식키를 `Ctrl, 메타, 알트, Shift` 순으로 앞에 세우고 `-` 로 잇는다.
 * - 매칭은 문자열 **대소문자 무시 비교**다. 설정 파일에는 `Ctrl-Shift-Alt-1` 처럼 순서가 다른
 *   값도 있어서, 겹침 판정은 양쪽을 **정규 순서로 되돌린 뒤** 비교한다 — 그래야 사람이 보기에
 *   같은 키를 "다르다" 고 놓치지 않는다.
 *
 * **순수 모듈이다** — DOM·Angular·fs 를 건드리지 않는다(`i18n.ts`·`nav.ts` 와 같은 규칙).
 * 화면에 붙이는 일은 `settings.component.ts`, 검증은 `test/keybind.test.js`.
 */

import { JUMP_SLOTS } from './nav'

export type Platform = 'win32' | 'darwin' | 'linux'

/** 메타·알트 키의 표기 — Tabby 와 같다 (`hotkeys.util.ts` 의 `metaKeyName`·`altKeyName`) */
export const META_NAME: Record<Platform, string> = { darwin: '⌘', win32: 'Win', linux: 'Super' }
export const ALT_NAME: Record<Platform, string> = { darwin: '⌥', win32: 'Alt', linux: 'Alt' }

/** KeyboardEvent 에서 우리가 보는 것만 — 테스트가 진짜 이벤트 없이 만들 수 있게 */
export interface KeyEventLike {
    key: string
    code: string
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
    metaKey?: boolean
}

/** `event.code` → 표기. Tabby 의 표와 같다 */
const CODE_MAP: Record<string, string> = {
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', IntlBackslash: '`',
    Minus: '-', Equal: '=', Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']',
}
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])

/** 수식키가 아닌 키 하나의 이름 — Tabby `getKeyName` 의 비수식 갈래 */
export function keyNameOf (e: KeyEventLike): string {
    if (e.key === '`' || e.key === '~') {
        return e.key
    }
    if (/^[A-Za-z]$/.test(e.key)) {
        return e.key.toUpperCase()
    }
    let key = String(e.code || e.key || '')
    key = key.replace('Key', '').replace('Arrow', '').replace('Digit', '')
    return CODE_MAP[key] ?? key
}

/**
 * 키 이벤트 하나를 Tabby 식 keystroke 로. **수식키만 눌렸으면 `null`** — 그건 아직 입력 중이다.
 */
export function keystrokeFromEvent (e: KeyEventLike, platform: Platform): string | null {
    if (MODIFIER_KEYS.has(e.key)) {
        return null
    }
    const mods: string[] = []
    if (e.ctrlKey) { mods.push('Ctrl') }
    if (e.metaKey) { mods.push(META_NAME[platform]) }
    if (e.altKey) { mods.push(ALT_NAME[platform]) }
    if (e.shiftKey) { mods.push('Shift') }
    return [...mods, keyNameOf(e)].join('-')
}

/**
 * keystroke 문자열을 `{ mods, key }` 로 가른다.
 *
 * 함정 — 키 자체가 `-` 인 경우(`Ctrl--`). `-` 로 잇는 규칙이라 그냥 split 하면 빈 조각이 남는다.
 * 끝이 `--` 면 키는 `-` 다.
 */
export function parseStroke (stroke: string): { mods: string[], key: string } {
    const s = String(stroke ?? '')
    if (s.endsWith('--')) {
        const head = s.slice(0, -2)
        return { mods: head ? head.split('-') : [], key: '-' }
    }
    if (s === '-') {
        return { mods: [], key: '-' }
    }
    const parts = s.split('-')
    const key = parts.pop() ?? ''
    return { mods: parts, key }
}

/** 수식키를 Tabby 의 고정 순서(Ctrl · 메타 · 알트 · Shift)로 세우고 나머지는 그대로 */
export function normalizeStroke (stroke: string, platform: Platform): string {
    const { mods, key } = parseStroke(stroke)
    const order = ['Ctrl', META_NAME[platform], ALT_NAME[platform], 'Shift']
    const lower = mods.map(m => m.toLowerCase())
    const ordered = order.filter(o => lower.includes(o.toLowerCase()))
    const rest = mods.filter(m => !order.some(o => o.toLowerCase() === m.toLowerCase()))
    return [...ordered, ...rest, key].join('-')
}

/** Tabby 와 같은 판정 — 정규 순서로 맞춘 뒤 대소문자 무시 */
export function strokesEqual (a: string, b: string, platform: Platform): boolean {
    return normalizeStroke(a, platform).toLowerCase() === normalizeStroke(b, platform).toLowerCase()
}

/** 사람이 읽는 표기 — `Ctrl-Shift-T` → `Ctrl+Shift+T` (키가 `-` 여도 안 깨진다) */
export function displayStroke (stroke: string, platform: Platform): string {
    const { mods, key } = parseStroke(normalizeStroke(stroke, platform))
    return [...mods, key].join('+')
}

/**
 * 설정값 하나를 **누름 열의 목록**으로. Tabby `getHotkeysConfigRecursive` 와 같다 —
 * 문자열 하나 = 한 번 누름 한 열, 배열 항목이 문자열이면 한 번 누름, 배열이면 연속 누름.
 */
export function sequencesOf (value: unknown): string[][] {
    if (typeof value === 'string') {
        return [[value]]
    }
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .map(item => typeof item === 'string' ? [item] : Array.isArray(item) ? item.map(String) : null)
        .filter((x): x is string[] => !!x && x.length > 0)
}

/**
 * 이 키를 **한 번 누름으로** 쓰는 다른 id 들. `exceptIds` 는 자기 자신(같은 항목의 형제 id 포함).
 *
 * 두 번 이상 누르는 열의 마지막이 같은 경우는 겹침으로 치지 않는다 — Tabby 는 더 긴 열을
 * 우선하므로 둘 다 살고, 그건 사용자가 의도한 조합이다.
 */
export function findConflicts (
    stroke: string, table: Record<string, unknown>, exceptIds: string[], platform: Platform,
): string[] {
    const out: string[] = []
    for (const id of Object.keys(table ?? {})) {
        if (exceptIds.includes(id)) {
            continue
        }
        if (sequencesOf(table[id]).some(seq => seq.length === 1 && strokesEqual(seq[0], stroke, platform))) {
            out.push(id)
        }
    }
    return out
}

/** 설정 창에 늘어놓는 항목 — README 첫 화면의 단축키 표와 같은 순서 */
export interface KeyItem {
    /** 핫키 id. `jump` 항목은 가상 id 라 실제로는 `agentdeck-jump-1…9` 에 쓴다 */
    id: string
    /** 문구 키 (`i18n`) */
    label: string
    /** Tabby 순정 id 인가 — 배지로 표시한다 (우리 처리자가 아니라 순정 처리자가 받는다) */
    stock?: boolean
    /** N 번째 세션 묶음 — 숫자 자리만 바꿔 아홉 개에 같이 쓴다 */
    jump?: boolean
}

export const JUMP_ITEM_ID = 'agentdeck-jump'

export const KEY_ITEMS: KeyItem[] = [
    { id: 'agentdeck-new-tab', label: 'keys.item.newtab' },
    { id: JUMP_ITEM_ID, label: 'keys.item.jump', jump: true },
    { id: 'agentdeck-focus-list', label: 'keys.item.focus' },
    { id: 'agentdeck-view', label: 'keys.item.view' },
    { id: 'agentdeck-repair', label: 'keys.item.repair' },
    { id: 'split-right', label: 'keys.item.splitright', stock: true },
    { id: 'split-bottom', label: 'keys.item.splitbottom', stock: true },
    { id: 'close-pane', label: 'keys.item.closepane', stock: true },
    { id: 'agentdeck-newline', label: 'keys.item.newline' },
    { id: 'agentdeck-toggle', label: 'keys.item.toggle' },
    { id: 'agentdeck-view-mode', label: 'keys.item.viewmode' },
]

/** `agentdeck-jump-1` … `agentdeck-jump-9` */
export function jumpIds (): string[] {
    return Array.from({ length: JUMP_SLOTS }, (_, i) => `agentdeck-jump-${i + 1}`)
}

/** 이 항목이 실제로 쓰는 id 들 */
export function targetIds (item: KeyItem): string[] {
    return item.jump ? jumpIds() : [item.id]
}

/**
 * 누름이 숫자(1~9)로 끝나면 `{ prefix, digit }`. `Ctrl-3` → `Ctrl-`·3, 맨 `3` → ``·3.
 * 숫자로 안 끝나면 `null` — N 번째 세션 키는 숫자가 곧 번호라 다른 키는 받을 수 없다.
 */
export function splitDigit (stroke: string): { prefix: string, digit: number } | null {
    const { mods, key } = parseStroke(stroke)
    if (!/^[1-9]$/.test(key)) {
        return null
    }
    return { prefix: mods.length ? mods.join('-') + '-' : '', digit: Number(key) }
}

/** 지금 설정된 키를 사람이 읽는 표기로. `jump` 는 `Ctrl+1 … Ctrl+9` 한 줄로 접는다 */
export function displayStrokes (table: Record<string, unknown>, item: KeyItem, platform: Platform): string[] {
    if (item.jump) {
        const first = sequencesOf(table?.['agentdeck-jump-1']).find(s => s.length === 1)?.[0]
        const d = first ? splitDigit(first) : null
        if (!d) {
            return first ? [displayStroke(first, platform)] : []
        }
        const p = d.prefix ? displayStroke(d.prefix + '1', platform).slice(0, -1) : ''
        return [`${p}1 … ${p}${JUMP_SLOTS}`]
    }
    return sequencesOf(table?.[item.id]).map(seq => seq.map(s => displayStroke(s, platform)).join(' , '))
}

/** 바꾸기 계획 — 무엇을 어디에 쓰고, 누구와 겹치는가 */
export interface BindingPlan {
    item: KeyItem
    /** id → 새로 쓸 누름 (jump 는 아홉 개) */
    writes: Record<string, string>
    /** 겹치는 다른 id (중복 없이) */
    conflicts: string[]
    /** 사용자가 누른 것의 표기 */
    display: string
    /** jump 항목에 숫자로 안 끝나는 키를 눌렀다 */
    error?: 'digit'
}

export function planBinding (
    table: Record<string, unknown>, item: KeyItem, stroke: string, platform: Platform,
): BindingPlan {
    const display = displayStroke(stroke, platform)
    const writes: Record<string, string> = {}
    if (item.jump) {
        const d = splitDigit(stroke)
        if (!d) {
            return { item, writes, conflicts: [], display, error: 'digit' }
        }
        jumpIds().forEach((id, i) => { writes[id] = normalizeStroke(`${d.prefix}${i + 1}`, platform) })
    } else {
        writes[item.id] = normalizeStroke(stroke, platform)
    }
    const except = targetIds(item)
    const conflicts: string[] = []
    for (const s of Object.values(writes)) {
        for (const id of findConflicts(s, table, except, platform)) {
            if (!conflicts.includes(id)) {
                conflicts.push(id)
            }
        }
    }
    return { item, writes, conflicts, display }
}

/**
 * 계획을 표에 쓴다. `force` 면 겹치는 id 에서 **그 누름만** 뗀다(다른 바인딩은 남긴다) —
 * 기동 때 순정 `new-tab`·`rename-tab` 에서 키를 떼는 것과 같은 방식이고, 그래야 한 번 눌러
 * 둘이 도는 상태가 생기지 않는다. `force` 가 아니면 겹침이 있어도 겹치는 쪽은 건드리지 않는다.
 *
 * 반환 = 실제로 바뀐 id 목록 (진단 로그용).
 */
export function applyBinding (
    table: Record<string, unknown>, plan: BindingPlan, force: boolean, platform: Platform,
): string[] {
    const changed: string[] = []
    for (const [id, stroke] of Object.entries(plan.writes)) {
        table[id] = [stroke]
        changed.push(id)
    }
    if (force) {
        const strokes = Object.values(plan.writes)
        for (const cid of plan.conflicts) {
            const kept = sequencesOf(table[cid])
                .filter(seq => !(seq.length === 1 && strokes.some(s => strokesEqual(seq[0], s, platform))))
            table[cid] = kept.map(seq => seq.length === 1 ? seq[0] : seq)
            changed.push(cid)
        }
    }
    return changed
}

/** 항목을 기본값으로 — `defaults` 는 id → 기본 바인딩 표 (없는 id 는 비운다) */
export function resetBinding (
    table: Record<string, unknown>, item: KeyItem, defaults: Record<string, unknown>,
): void {
    for (const id of targetIds(item)) {
        const d = defaults[id]
        table[id] = Array.isArray(d) ? [...d] : typeof d === 'string' ? [d] : []
    }
}

/** 지금 값이 기본값과 같은가 (버튼 잠금용) */
export function isDefaultBinding (
    table: Record<string, unknown>, item: KeyItem, defaults: Record<string, unknown>, platform: Platform,
): boolean {
    return targetIds(item).every(id => {
        const cur = sequencesOf(table?.[id]).map(seq => seq.map(s => normalizeStroke(s, platform).toLowerCase()).join(' '))
        const def = sequencesOf(defaults[id]).map(seq => seq.map(s => normalizeStroke(s, platform).toLowerCase()).join(' '))
        return cur.length === def.length && cur.every((s, i) => s === def[i])
    })
}
