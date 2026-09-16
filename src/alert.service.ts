import { Injectable, NgZone } from '@angular/core'
import { AppService, BaseTabComponent, ConfigService } from 'tabby-core'
import { WorkStatusService } from './status.service'
import { STATUS_STYLES, WorkStatus } from './api'
import { diag } from './diag'

/** 창 밖으로 알려야 하는 상태 — 사람이 손을 대야 진행되는 것들 */
/** 창이 뒤에 있을 때 알릴 상태 — 사람이 봐야 하는 것: 승인 / 오류 / 한도에 걸려 멈춤 */
const ALERT_STATUSES: WorkStatus[] = ['waiting', 'error', 'limited']

/**
 * 창이 뒤로 가 있을 때의 OS 알림.
 *
 * 사이드바는 창이 보일 때만 의미가 있다. 에이전트 탭을 여섯 개쯤 굴리면서 Slack·VS 를 보고
 * 있으면 어느 탭이 `승인대기` 로 멈춰 있어도 알 길이 없어서, 돌아와 보면 몇 분씩 놀고 있던
 * 일이 잦았다. 그래서 상태가 **`waiting` / `error` 로 넘어가는 순간** 창이 포커스를 잃은
 * 상태면 OS 쪽에 세 가지로 알린다.
 *
 * 1. **작업표시줄 깜빡임** (`flashFrame`) — 창이 포커스를 받으면 끈다. `alertFlash`
 * 2. **작업표시줄 뱃지** — 지금 `waiting`+`error` 인 탭 수를 아이콘 위에 얹는다. Windows 에는
 *    `setBadgeCount` 가 없어서 `setOverlayIcon` 에 캔버스로 그린 원+숫자를 넣는다.
 *    전이 순간만이 아니라 상태가 바뀔 때마다 갱신해 실제 개수를 따라간다. `alertBadge`
 * 3. **OS 토스트** (`Notification`) — 기본은 끔. 누르면 창을 앞으로 가져오고 그 탭을 고른다. `alertToast`
 *
 * 창이 앞에 있을 때는 아무것도 하지 않는다 — 사이드바가 이미 보이고 있다.
 * Electron 을 만지는 모든 곳은 try/catch 로 감싼다. 알림이 안 되는 것은 불편이지만
 * 예외가 새어 나가 다른 배선을 죽이는 것은 사고다.
 */
@Injectable({ providedIn: 'root' })
export class AgentDeckAlertService {
    /** 탭별로 마지막에 본 상태 — "전이" 를 판정하려고 들고 있는다 */
    private last = new WeakMap<BaseTabComponent, WorkStatus>()
    /** flashFrame(true) 를 걸어 둔 상태인가 — 포커스가 오면 끈다 */
    private flashing = false
    /** 마지막으로 그린 뱃지 숫자 (0 = 안 그림). 같은 숫자면 다시 그리지 않는다 */
    private badgeShown = 0
    /** 뱃지 그림 캐시 — key 는 `${count}:${color}` */
    private badgeCache = new Map<string, any>()

    /**
     * 진단/검증용 카운터 — CDP 에서 `__agentdeck.alert` 로 읽는다.
     * `forceUnfocused` 를 true 로 두면 포커스 판정을 건너뛰고 "창이 뒤에 있다" 로 친다
     * (테스트 인스턴스가 앞에 떠 있는 상태에서 알림 경로를 밟아 보려고)
     */
    debug = {
        flashes: 0,
        badgeCount: 0,
        badgeDraws: 0,
        toasts: 0,
        transitions: 0,
        lastFocused: null as boolean | null,
        forceUnfocused: false,
    }

    constructor (
        private app: AppService,
        private config: ConfigService,
        private zone: NgZone,
        private status: WorkStatusService,
    ) { }

    init (): void {
        this.app.ready$.subscribe(() => {
            try {
                this.setup()
            } catch (e: any) {
                this.diag(`alert setup ERROR ${e?.message ?? e}`)
            }
        })
    }

    private setup (): void {
        // 기동 시점의 상태를 기준선으로 삼는다 — 이미 waiting 인 탭은 "전이" 가 아니다
        for (const tab of this.app.tabs) {
            this.last.set(tab, this.status.get(tab).status)
        }
        this.status.changed$.subscribe(() => {
            try {
                this.onChanged()
            } catch (e: any) {
                this.diag(`alert onChanged ERROR ${e?.message ?? e}`)
            }
        })
        // 닫힌 탭은 개수에서 빠져야 한다 — status.changed$ 는 탭 닫힘에 안 울린다
        this.app.tabClosed$.subscribe(tab => {
            this.last.delete(tab)
            try {
                this.updateBadge(this.countAlerting())
            } catch (e: any) {
                this.diag(`alert tabClosed ERROR ${e?.message ?? e}`)
            }
        })
        // 사람이 돌아왔다 — 깜빡임은 여기서 끝난다. 뱃지는 상태가 풀릴 때 따로 지워진다
        window.addEventListener('focus', () => this.stopFlash())

        // 개발/진단용 — deck.service 가 만든 __agentdeck 에 붙는다 (없으면 만든다)
        const g = window as any
        g.__agentdeck = g.__agentdeck ?? {}
        g.__agentdeck.alert = this.debug
        this.diag(`alert ready tabs=${this.app.tabs.length}`)
    }

    /**
     * 상태가 바뀔 때마다 — 뱃지는 항상 실제 개수로 맞추고,
     * 알림 상태로 **새로 들어온** 탭이 있고 창이 뒤에 있으면 깜빡임/토스트를 낸다
     */
    private onChanged (): void {
        const entered: BaseTabComponent[] = []
        let count = 0
        for (const tab of this.app.tabs) {
            const now = this.status.get(tab).status
            const prev = this.last.get(tab)
            this.last.set(tab, now)
            if (!ALERT_STATUSES.includes(now)) {
                continue
            }
            count++
            // waiting -> error 도 전이로 친다 — 성격이 다른 일이 새로 생긴 것이다
            if (prev !== now) {
                entered.push(tab)
            }
        }
        this.updateBadge(count)
        if (entered.length === 0) {
            return
        }
        this.debug.transitions += entered.length
        const focused = this.isFocused()
        this.debug.lastFocused = focused
        if (focused) {
            return
        }
        this.diag(`alert enter=${entered.length} count=${count} focused=${focused}`)
        if (this.config.store.agentDeck.alertFlash) {
            this.flash()
        }
        if (this.config.store.agentDeck.alertToast) {
            for (const tab of entered) {
                this.toast(tab)
            }
        }
    }

    private countAlerting (): number {
        let n = 0
        for (const tab of this.app.tabs) {
            if (ALERT_STATUSES.includes(this.status.get(tab).status)) {
                n++
            }
        }
        return n
    }

    // ---------- Electron 접근 ----------

    /** `@electron/remote` 의 현재 창. 못 잡으면 null — 호출부는 전부 null 을 감안한다 */
    private win (): any {
        try {
            const req = (window as any).require ?? (globalThis as any).require
            return req?.('@electron/remote')?.getCurrentWindow?.() ?? null
        } catch {
            return null
        }
    }

    private nativeImage (): any {
        try {
            const req = (window as any).require ?? (globalThis as any).require
            return req?.('electron')?.nativeImage ?? null
        } catch {
            return null
        }
    }

    /**
     * 창이 앞에 있나. Electron 의 판정을 우선하고(devtools 를 따로 띄워도 본창 기준으로 본다),
     * remote 를 못 잡으면 DOM 의 `document.hasFocus()` 로 대신한다
     */
    private isFocused (): boolean {
        if (this.debug.forceUnfocused) {
            return false
        }
        try {
            const win = this.win()
            if (win?.isFocused) {
                return !!win.isFocused()
            }
        } catch {
            // 아래 DOM 판정으로
        }
        return document.hasFocus()
    }

    // ---------- 깜빡임 ----------

    private flash (): void {
        try {
            const win = this.win()
            if (!win?.flashFrame) {
                return
            }
            win.flashFrame(true)
            this.flashing = true
            this.debug.flashes++
        } catch (e: any) {
            this.diag(`alert flash ERROR ${e?.message ?? e}`)
        }
    }

    private stopFlash (): void {
        if (!this.flashing) {
            return
        }
        this.flashing = false
        try {
            this.win()?.flashFrame?.(false)
        } catch {
            // 포커스가 오면 Windows 가 알아서 멈추므로 실패해도 남는 건 없다
        }
    }

    // ---------- 뱃지 ----------

    /**
     * 작업표시줄 아이콘 위의 숫자를 지금 개수로 맞춘다. 0 이면 지운다.
     * `alertBadge` 가 꺼져 있으면 그려 둔 것이 있을 때만 지우고 끝낸다
     */
    private updateBadge (count: number): void {
        this.debug.badgeCount = count
        const enabled = !!this.config.store.agentDeck.alertBadge
        const want = enabled ? count : 0
        if (want === this.badgeShown) {
            return
        }
        try {
            const win = this.win()
            if (!win?.setOverlayIcon) {
                return
            }
            if (want === 0) {
                win.setOverlayIcon(null, '')
                this.badgeShown = 0
                // 개수가 0 으로 내려왔으면 깜빡일 이유도 사라졌다
                this.stopFlash()
                return
            }
            const img = this.badgeImage(want)
            if (!img) {
                return
            }
            win.setOverlayIcon(img, `승인대기/오류 ${want}개`)
            this.badgeShown = want
            this.debug.badgeDraws++
        } catch (e: any) {
            this.diag(`alert badge ERROR ${e?.message ?? e}`)
        }
    }

    /**
     * 원 위에 숫자를 얹은 오버레이 이미지. 오류 탭이 하나라도 있으면 오류색, 아니면 승인대기색.
     * Windows 오버레이는 16px 기준이라 16@1x + 32@2x 두 표현을 넣는다 (고배율에서 흐려지지 않게).
     * `addRepresentation` 을 못 쓰는 빌드면 32px 하나로 물러난다
     */
    private badgeImage (count: number): any {
        const hasError = this.app.tabs.some(t => this.status.get(t).status === 'error')
        const color = hasError ? STATUS_STYLES.error.color : STATUS_STYLES.waiting.color
        const key = `${count}:${color}`
        const cached = this.badgeCache.get(key)
        if (cached) {
            return cached
        }
        const nativeImage = this.nativeImage()
        if (!nativeImage) {
            return null
        }
        const text = count > 9 ? '9+' : String(count)
        let img: any
        try {
            img = nativeImage.createEmpty()
            img.addRepresentation({ scaleFactor: 1, width: 16, height: 16, dataURL: this.drawBadge(16, text, color) })
            img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, dataURL: this.drawBadge(32, text, color) })
            if (img.isEmpty?.()) {
                throw new Error('empty after addRepresentation')
            }
        } catch {
            img = nativeImage.createFromDataURL(this.drawBadge(32, text, color))
        }
        this.badgeCache.set(key, img)
        return img
    }

    /** 오프스크린 canvas 에 원+숫자를 그려 data URL 로 돌려준다 */
    private drawBadge (size: number, text: string, color: string): string {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            throw new Error('canvas 2d 미지원')
        }
        const r = size / 2
        ctx.clearRect(0, 0, size, size)
        ctx.beginPath()
        ctx.arc(r, r, r - 0.5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        // 어두운 작업표시줄 위에서 원 테두리가 살게 얇은 흰 선
        ctx.lineWidth = Math.max(1, size / 16)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.round(size * (text.length > 1 ? 0.55 : 0.7))}px "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        // 글리프의 시각적 중심이 살짝 위로 치우쳐서 조금 내린다
        ctx.fillText(text, r, r + size * 0.04)
        return canvas.toDataURL('image/png')
    }

    // ---------- 토스트 ----------

    /** OS 토스트. 누르면 창을 앞으로 가져오고 그 탭을 고른다 */
    private toast (tab: BaseTabComponent): void {
        try {
            if (typeof Notification === 'undefined') {
                return
            }
            const s = this.status.get(tab)
            const name = s.label || tab.title || '(제목 없음)'
            const style = STATUS_STYLES[s.status]
            const n = new Notification('AgentDeck', {
                body: `${name} — ${style.label}`,
                // 같은 탭의 토스트는 하나로 겹친다 (waiting -> error 가 잇달아 와도 두 장이 쌓이지 않게)
                tag: `agentdeck-${this.tabKey(tab)}`,
            })
            this.debug.toasts++
            n.onclick = () => {
                try {
                    const win = this.win()
                    win?.show?.()
                    win?.focus?.()
                } catch {
                    // 창을 못 올려도 탭 선택은 해 둔다
                }
                this.zone.run(() => {
                    if (this.app.tabs.includes(tab)) {
                        this.app.selectTab(tab)
                    }
                })
                n.close()
            }
        } catch (e: any) {
            this.diag(`alert toast ERROR ${e?.message ?? e}`)
        }
    }

    /** 토스트 tag 용 탭 식별자 — 객체 자체는 문자열이 안 되니 인덱스로 대신한다 */
    private tabKey (tab: BaseTabComponent): string {
        const i = this.app.tabs.indexOf(tab)
        return i >= 0 ? String(i) : 'x'
    }

    // ---------- 진단 ----------

    /** deck.service 와 같은 파일(`~/.agentdeck-diag.log`)에 남긴다 — 회전·시각 표기는 `diag.ts` 가 한다 */
    private diag (line: string): void {
        diag(line)
    }
}
