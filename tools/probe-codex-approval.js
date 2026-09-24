/** Replay the observed MCP dialog through the isolated app's output/title
 * subscriptions, then assert both service state and the rendered sidebar badge.
 * Run only with tools/test-instance.ps1, never against a user's live session.
 */
(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('tabby-agentdeck-test')) {
        throw new Error('This probe requires the isolated test instance')
    }
    const ad = window.__agentdeck
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const results = []
    const originalTabs = [...ad.app.tabs]
    document.querySelector('#agentdeck-sidebar .ad-new').click()
    let tab, pane
    for (let i = 0; i < 40; i++) {
        tab = ad.app.tabs.find(t => !originalTabs.includes(t))
        pane = tab?.getAllTabs?.().find(p => p.session) ?? (tab?.session ? tab : null)
        if (pane?.session?.output) break
        await sleep(250)
    }
    if (!pane) throw new Error('No isolated terminal pane')
    const savedAuto = ad.config.store.agentDeck.autoDetect
    const badge = () => document.querySelector(`.ad-tab[data-ad-index="${ad.app.tabs.indexOf(tab)}"] .ad-badge`)?.textContent ?? ''
    const expect = async (name, expected) => {
        await sleep(500)
        const state = ad.status.get(tab)
        const text = badge()
        const wanted = expected === 'waiting' ? '승인대기' : '진행중'
        results.push({ name, pass: state.status === expected && text.includes(wanted), state: state.status, badge: text, pinned: state.pinned })
    }
    const feed = text => pane.session.output.next(text)
    // This is the native title event consumed by watchTab, not applyTitle directly.
    const title = text => tab.titleChange$.next(text)
    try {
        ad.config.store.agentDeck.autoDetect = true
        ad.pinAgent(tab, 'codex')
        ad.pinAgent(pane, 'codex')
        await sleep(800)
        ad.status.setManual(tab, 'running', 'Codex approval regression')
        feed('Allow the jira-search MCP server to run tool "jira_similar_issues"?\r\n')
        await expect('hook running -> MCP approval', 'waiting')
        feed('  1. Allow                 Run the tool and continue.\r\n')
        feed('enter to submit · esc to cancel\r\n')
        await expect('footer redraw preserves approval', 'waiting')
        title('\u280f Review | Root')
        await expect('native busy title resumes', 'running')
        title('[ ! ] Action Required | Review | Root')
        await expect('native action title interrupts hook state', 'waiting')
        feed('Working (esc to interrupt)\r\n')
        await expect('busy output resumes', 'running')
        ad.status.unpin(tab)
        feed('\x1b[36mAllow the jira-search MCP server ')
        feed('to run tool "jira_similar_issues"?\x1b[0m\r\n')
        await expect('split ANSI dialog without hooks', 'waiting')
        feed('enter to submit · esc to cancel\r\n')
        await expect('unhooked footer preserves approval', 'waiting')
        title('\u280b Review | Root')
        await expect('unhooked approval resumes', 'running')
        feed('Explain: Allow the jira-search MCP server to run tool "jira_similar_issues"?\r\n')
        await expect('ordinary prose does not interrupt', 'running')
        ad.config.store.agentDeck.autoDetect = false
        title('[ ! ] Action Required | Review | Root')
        feed('Allow the jira-search MCP server to run tool "jira_similar_issues"?\r\n')
        await expect('autoDetect disabled', 'running')
    } finally {
        ad.config.store.agentDeck.autoDetect = savedAuto
        ad.pinAgent(tab, null)
        ad.pinAgent(pane, null)
        await ad.app.closeTab(tab)
    }
    return JSON.stringify({ summary: { total: results.length, pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length }, results })
})()
