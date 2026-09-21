// Run only in the isolated Tabby instance. Changes its language through the real settings UI.
(async () => {
    const ad = window.__agentdeck, wait = ms => new Promise(r => setTimeout(r, ms))
    require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false)
    const results = [], check = (name, pass) => results.push({ name, pass: !!pass })
    if (!document.querySelector('select option[value="en-GB"]')) {
        document.querySelector('.ad-settings').click(); await wait(500)
    }
    const select = [...document.querySelectorAll('select')].filter(x => x.querySelector('option[value="en-GB"]')).pop()
    const language = async value => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await wait(1500) }
    const root = document.getElementById('agentdeck-sidebar'), tab = ad.app.tabs[0]
    const oldTitle = tab.customTitle
    tab.customTitle = '한국어 세션 제목 — Settings 대기'
    ad.status.setLabel(tab, '사용자가 입력한 작업 이름')
    try {
        for (const [locale, words] of [
            ['en-GB', ['Search sessions', '+ New tab', 'Settings', 'Past sessions']],
            ['ko-KR', ['세션 검색', '+ 새 탭', '설정', '지난 세션']],
            ['en-US', ['Search sessions', '+ New tab', 'Settings', 'Past sessions']],
        ]) {
            await language(locale)
            check(locale + ' search', root.querySelector('.ad-search-input').placeholder.startsWith(words[0]))
            check(locale + ' new tab', root.querySelector('.ad-new').textContent === words[1])
            check(locale + ' settings', root.querySelector('.ad-settings').textContent === words[2])
            check(locale + ' past sessions', root.querySelector('.ad-resume-head .ad-group-label').textContent === words[3])
            check(locale + ' user title preserved', [...root.querySelectorAll('.ad-title')].some(x => x.textContent === tab.customTitle))
            check(locale + ' task name preserved', root.innerText.includes('사용자가 입력한 작업 이름'))
            for (const [state, en, ko] of [['idle','Idle','대기'],['running','Working','진행중'],['waiting','Awaiting approval','승인대기'],['limited','Usage limit reached','한도 도달'],['done','Done','완료'],['error','Error','오류']]) {
                ad.status.setManual(tab, state); ad.render()
                check(locale + ' ' + state, [...root.querySelectorAll('.ad-badge')].some(x => x.textContent.includes(locale === 'ko-KR' ? ko : en)))
            }
            check(locale + ' elapsed', [...root.querySelectorAll('.ad-elapsed')].every(x => locale === 'ko-KR' || !/[가-힣]/.test(x.textContent)))
            check(locale + ' close tooltip', [...root.querySelectorAll('.ad-close')].every(x => x.title === (locale === 'ko-KR' ? '탭 닫기' : 'Close tab')))
        }
    } finally { tab.customTitle = oldTitle; ad.status.setManual(tab, 'idle', ''); ad.render() }
    return JSON.stringify({ pass: results.every(x => x.pass), count: results.length, failures: results.filter(x => !x.pass) })
})()
