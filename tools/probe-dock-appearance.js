/**
 * Real-browser regression for the dock footer at its supported narrow widths.
 * Run only against the disposable macOS instance created for dock-ui-isolated:
 *   node tools/cdp.js 9444 tools/probe-dock-appearance.js
 *
 * The production break this catches: allowing CJK footer labels to wrap inside
 * flexible buttons makes a narrow dock render vertical text and tall controls.
 */
(async () => {
    const ad = window.__agentdeck
    if (!ad || !process.env.TABBY_CONFIG_DIRECTORY?.includes('dock-ui-isolated')) {
        return JSON.stringify({ error: 'Run only in the dock-ui-isolated Tabby instance' })
    }
    const cfg = ad.config.store.agentDeck
    const saved = { sidebarDock: cfg.sidebarDock, sidebarWidth: cfg.sidebarWidth }
    const savedLanguage = ad.config.store.language
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const results = []

    function visibleTextLines (button) {
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
        const lines = new Set()
        let node
        while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) { continue }
            const range = document.createRange()
            range.selectNodeContents(node)
            for (const rect of range.getClientRects()) {
                if (rect.width > 0 && rect.height > 0) { lines.add(Math.round(rect.top)) }
            }
        }
        return lines.size
    }

    try {
        cfg.sidebarDock = 'right'
        for (const width of [140, 180, 213, 320]) {
            cfg.sidebarWidth = width
            ad.config.save()
            ad.relayout()
            ad.render()
            await sleep(250)
            const sidebar = document.getElementById('agentdeck-sidebar')
            const footer = sidebar.querySelector('.ad-foot')
            const buttons = [...footer.querySelectorAll('.ad-btn')]
            const footerRect = footer.getBoundingClientRect()
            const metrics = buttons.map(button => {
                const rect = button.getBoundingClientRect()
                const style = getComputedStyle(button)
                return {
                    action: button.className.replace('ad-btn', '').trim(),
                    width: Math.round(rect.width * 10) / 10,
                    height: Math.round(rect.height * 10) / 10,
                    top: Math.round(rect.top * 10) / 10,
                    whiteSpace: style.whiteSpace,
                    textLines: visibleTextLines(button),
                    horizontalOverflow: button.scrollWidth > button.clientWidth + 1,
                    title: button.getAttribute('title') || button.getAttribute('aria-label') || '',
                }
            })
            const oneRow = new Set(metrics.map(button => button.top)).size === 1
            const noVerticalText = metrics.every(button => button.textLines <= 1 && button.whiteSpace === 'nowrap')
            const compact = footerRect.height <= 48 && metrics.every(button => button.height <= 36)
            const noOverflow = metrics.every(button => !button.horizontalOverflow)
            const usableTargets = metrics.every(button => button.width >= 28 && button.height >= 30)
            const named = metrics.every(button => !!button.title)
            const actualWidth = Math.round(sidebar.getBoundingClientRect().width)
            const pass = buttons.length === 4 && actualWidth === width && oneRow && noVerticalText
                && compact && noOverflow && usableTargets && named
            results.push({
                id: `DOCK-FOOT-${width}`,
                pass,
                width: actualWidth,
                footerHeight: Math.round(footerRect.height * 10) / 10,
                checks: { oneRow, noVerticalText, compact, noOverflow, usableTargets, named },
                buttons: metrics,
            })
        }

        // Switching language must update the labels without deleting the SVG icons.
        ad.config.store.language = 'en-GB'
        ad.config.save()
        await sleep(350)
        const buttons = [...document.querySelectorAll('.ad-foot .ad-btn')]
        const languageMetrics = buttons.map(button => ({
            action: button.className.replace('ad-btn', '').trim(),
            text: button.textContent,
            icons: button.querySelectorAll('svg').length,
            accessibleName: button.getAttribute('aria-label') || '',
        }))
        const languagePass = languageMetrics.length === 4 && languageMetrics.every(button => button.icons === 1 && !!button.accessibleName)
            && document.querySelector('.ad-new')?.textContent === '+ New tab'
            && document.querySelector('.ad-settings')?.textContent === 'Settings'
        results.push({ id: 'DOCK-FOOT-LANGUAGE', pass: languagePass, buttons: languageMetrics })
    } finally {
        ad.config.store.language = savedLanguage
        Object.assign(cfg, saved)
        ad.config.save()
        ad.relayout()
        ad.render()
    }
    return JSON.stringify({
        summary: {
            total: results.length,
            pass: results.filter(result => result.pass).length,
            fail: results.filter(result => !result.pass).length,
        },
        results,
    }, null, 2)
})()
