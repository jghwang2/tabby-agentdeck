/**
 * 사이드바를 마우스로 조절하는 부분 — 경계선 드래그로 크기, 헤더 드래그로 붙는 방향.
 *
 * 설정 창에서 숫자를 넣게 하지 않고 Visual Studio 의 도킹처럼 직접 끌어서 맞추게 한다.
 * DOM 을 직접 만지는 코드라 deck.service 밖으로 빼 두고, 값을 읽고 쓰는 통로만
 * `DockHost` 로 받는다 (deck.service 가 config 와 relayout 을 쥐고 있으므로).
 */

export type DockSide = 'left' | 'right' | 'top' | 'bottom'

export const DOCK_SIDES: DockSide[] = ['left', 'right', 'top', 'bottom']

export function isDockSide (v: any): v is DockSide {
    return DOCK_SIDES.includes(v)
}

/** 좌/우 도킹이면 폭, 상/하 도킹이면 높이를 다룬다 */
export function isHorizontalDock (side: DockSide): boolean {
    return side === 'left' || side === 'right'
}

export interface DockHost {
    /** 사이드바 엘리먼트 */
    sidebar: HTMLElement
    /** 사이드바가 얹혀 있는 `.window` */
    windowEl: HTMLElement
    /**
     * 배치의 기준이 되는 **보이는** 창 영역 (viewport ∩ `.window`). 없으면 `.window` 박스를 쓴다.
     *
     * 이게 없으면 `.window` 가 화면보다 넓어져 있을 때 경계선을 끌 때마다 **화면 밖까지 센 폭**이
     * 저장된다 — 사용자는 200px 를 만들었는데 설정에는 500px 이 들어가고, 그 차이만큼 사이드바가
     * 잘려 보인다 (2026-09-14). 부르는 쪽(deck.service)이 같은 기준을 쥐고 있으므로 여기로 받는다.
     */
    getBox? (): { left: number, top: number, width: number, height: number }
    getDock (): DockSide
    setDock (side: DockSide): void
    /**
     * 그 방향으로 붙였을 때의 크기 — 좌/우면 폭, 상/하면 높이.
     * 방향마다 저장된 값이 다르므로 미리보기도 물어보는 방향 기준으로 그린다.
     */
    getSize (side: DockSide): number
    setSize (px: number): void
    /** 드래그가 끝났을 때 한 번 — config.save() 를 부르라는 뜻 */
    commit (): void
    /** 값이 바뀌었으니 다시 그리라는 뜻 */
    relayout (): void
}

/** 드래그로 오해하지 않을 최소 이동 거리 (px) */
const DRAG_THRESHOLD = 5
/** 존 버튼 밖에서 놓았을 때 가장자리로 인정하는 여백 비율 */
const EDGE_RATIO = 0.25

export class DockController {
    private handle: HTMLElement | null = null
    private overlay: HTMLElement | null = null
    private preview: HTMLElement | null = null
    private zones = new Map<DockSide, HTMLElement>()

    private resizing = false
    private dragging = false
    private dragArmed = false
    private dragFrom = { x: 0, y: 0 }
    private hoverSide: DockSide | null = null

    constructor (private host: DockHost) { }

    /** 창 영역 — `getBox` 가 있으면 그 값(보이는 범위), 없으면 `.window` 박스 */
    private box (): { left: number, top: number, right: number, bottom: number, width: number, height: number } {
        const b = this.host.getBox?.()
        if (b) {
            return { ...b, right: b.left + b.width, bottom: b.top + b.height }
        }
        const r = this.host.windowEl.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }

    /** 사이드바가 만들어진 뒤 한 번 부른다 */
    install (): void {
        this.installResizeHandle()
        this.installDockDrag()
    }

    /** 도킹 방향이 바뀌면 핸들 위치도 반대편으로 옮겨야 한다 */
    syncHandle (): void {
        if (!this.handle) {
            return
        }
        const side = this.host.getDock()
        this.handle.className = 'ad-resize ad-resize-' + side
    }

    // ---------- 경계선 드래그 (크기) ----------

    private installResizeHandle (): void {
        const handle = document.createElement('div')
        handle.className = 'ad-resize'
        this.host.sidebar.appendChild(handle)
        this.handle = handle
        this.syncHandle()

        handle.addEventListener('pointerdown', (ev: PointerEvent) => {
            // 왼쪽 버튼만
            if (ev.button !== 0) {
                return
            }
            ev.preventDefault()
            ev.stopPropagation()
            this.resizing = true
            handle.setPointerCapture(ev.pointerId)
            document.body.classList.add('ad-resizing')
        })

        handle.addEventListener('pointermove', (ev: PointerEvent) => {
            if (!this.resizing) {
                return
            }
            const side = this.host.getDock()
            const rect = this.box()
            // 커서와 창 가장자리 사이의 거리가 곧 사이드바 크기다
            let size: number
            if (side === 'right') {
                size = rect.right - ev.clientX
            } else if (side === 'left') {
                size = ev.clientX - rect.left
            } else if (side === 'bottom') {
                size = rect.bottom - ev.clientY
            } else {
                size = ev.clientY - rect.top
            }
            this.host.setSize(Math.round(size))
            this.host.relayout()
        })

        const end = (ev: PointerEvent) => {
            if (!this.resizing) {
                return
            }
            this.resizing = false
            try {
                handle.releasePointerCapture(ev.pointerId)
            } catch {
                // 이미 놓쳤다 — 무시해도 상태는 위에서 정리됐다
            }
            document.body.classList.remove('ad-resizing')
            this.host.commit()
        }
        handle.addEventListener('pointerup', end)
        handle.addEventListener('pointercancel', end)
    }

    // ---------- 헤더 드래그 (도킹 방향) ----------

    private installDockDrag (): void {
        const head = this.host.sidebar.querySelector('.ad-head') as HTMLElement | null
        if (!head) {
            return
        }

        head.addEventListener('pointerdown', (ev: PointerEvent) => {
            if (ev.button !== 0) {
                return
            }
            // 헤더 안의 버튼류를 누른 것이면 건드리지 않는다
            if ((ev.target as HTMLElement).closest('button, input')) {
                return
            }
            this.dragArmed = true
            this.dragFrom = { x: ev.clientX, y: ev.clientY }
            head.setPointerCapture(ev.pointerId)
        })

        head.addEventListener('pointermove', (ev: PointerEvent) => {
            if (!this.dragArmed) {
                return
            }
            if (!this.dragging) {
                const dx = ev.clientX - this.dragFrom.x
                const dy = ev.clientY - this.dragFrom.y
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                    return
                }
                // 여기서부터 도킹 드래그다 — 가이드를 띄운다
                this.dragging = true
                this.showOverlay()
            }
            this.updateHover(ev.clientX, ev.clientY)
        })

        const end = (ev: PointerEvent) => {
            if (!this.dragArmed) {
                return
            }
            this.dragArmed = false
            try {
                head.releasePointerCapture(ev.pointerId)
            } catch {
                // 무시
            }
            if (!this.dragging) {
                return
            }
            this.dragging = false
            const side = this.hoverSide
            this.hideOverlay()
            if (side && side !== this.host.getDock()) {
                this.host.setDock(side)
                this.host.relayout()
                this.syncHandle()
                this.host.commit()
            }
        }
        head.addEventListener('pointerup', end)
        head.addEventListener('pointercancel', end)
    }

    // ---------- 드롭 가이드 ----------

    private showOverlay (): void {
        if (this.overlay) {
            return
        }
        const overlay = document.createElement('div')
        overlay.className = 'ad-dock-overlay'

        const preview = document.createElement('div')
        preview.className = 'ad-dock-preview'
        overlay.appendChild(preview)

        for (const side of DOCK_SIDES) {
            const zone = document.createElement('div')
            zone.className = 'ad-dock-zone ad-dock-zone-' + side
            zone.innerHTML = '<span class="ad-dock-mark"></span>'
            overlay.appendChild(zone)
            this.zones.set(side, zone)
        }

        document.body.appendChild(overlay)
        this.overlay = overlay
        this.preview = preview
        this.positionZones()
    }

    /** 존 버튼을 `.window` 네 가장자리 안쪽에 놓는다 (창이 전체화면이 아닐 수도 있으므로 매번 잰다) */
    private positionZones (): void {
        const rect = this.box()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const inset = 56
        const place: Record<DockSide, [number, number]> = {
            left: [rect.left + inset, cy],
            right: [rect.right - inset, cy],
            top: [cx, rect.top + inset],
            bottom: [cx, rect.bottom - inset],
        }
        for (const side of DOCK_SIDES) {
            const zone = this.zones.get(side)
            if (!zone) {
                continue
            }
            const [x, y] = place[side]
            zone.style.left = x + 'px'
            zone.style.top = y + 'px'
        }
    }

    /** 커서 위치로 어느 쪽에 붙일지 정하고 미리보기를 그린다 */
    private updateHover (x: number, y: number): void {
        const side = this.hitTest(x, y)
        if (side !== this.hoverSide) {
            this.hoverSide = side
            for (const [s, zone] of this.zones) {
                zone.classList.toggle('active', s === side)
            }
        }
        this.drawPreview(side)
    }

    /**
     * 존 버튼 위에 있으면 그쪽, 아니면 커서가 창의 어느 가장자리 띠에 들어와 있는지로 정한다.
     * 가운데에 있으면 null — 놓아도 아무 일이 없다.
     */
    private hitTest (x: number, y: number): DockSide | null {
        for (const [side, zone] of this.zones) {
            const r = zone.getBoundingClientRect()
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return side
            }
        }
        const rect = this.box()
        const dx = (x - rect.left) / rect.width
        const dy = (y - rect.top) / rect.height
        if (dx < EDGE_RATIO && dx <= dy && dx <= 1 - dy) {
            return 'left'
        }
        if (dx > 1 - EDGE_RATIO && 1 - dx <= dy && 1 - dx <= 1 - dy) {
            return 'right'
        }
        if (dy < EDGE_RATIO) {
            return 'top'
        }
        if (dy > 1 - EDGE_RATIO) {
            return 'bottom'
        }
        return null
    }

    /** 놓으면 사이드바가 어디에 얼마만큼 자리잡는지 반투명 박스로 미리 보여준다 */
    private drawPreview (side: DockSide | null): void {
        if (!this.preview) {
            return
        }
        if (!side) {
            this.preview.style.display = 'none'
            return
        }
        const rect = this.box()
        const horizontal = isHorizontalDock(side)
        // 방향마다 기억된 크기가 다르다 — 지금 붙어 있는 쪽이 아니라 놓으려는 쪽 값을 물어본다
        const current = this.host.getSize(side)
        const size = horizontal
            ? Math.min(Math.max(current || 320, 180), rect.width * 0.6)
            : Math.min(Math.max(current || 200, 120), rect.height * 0.6)

        const s = this.preview.style
        s.display = 'block'
        s.left = (side === 'right' ? rect.right - size : rect.left) + 'px'
        s.top = (side === 'bottom' ? rect.bottom - size : rect.top) + 'px'
        s.width = (horizontal ? size : rect.width) + 'px'
        s.height = (horizontal ? rect.height : size) + 'px'
    }

    private hideOverlay (): void {
        this.overlay?.remove()
        this.overlay = null
        this.preview = null
        this.zones.clear()
        this.hoverSide = null
    }
}
