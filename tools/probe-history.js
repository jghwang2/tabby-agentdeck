// Run only in an isolated Tabby instance with the history-fixtures generated for this test.
(async () => {
    const ad=window.__agentdeck, results=[]
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
    const check=(name,ok,detail='')=>results.push({name,pass:!!ok,detail})
    if(!ad)return {error:'AgentDeck not loaded'}
    const drawer=document.querySelector('.ad-resume-drawer')
    if(!drawer.classList.contains('expanded'))drawer.querySelector('.ad-resume-head').click()
    const input=drawer.querySelector('.ad-history-query')
    check('native search available',input && input.getBoundingClientRect().height>0)
    const search=async q=>{
        input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}))
        for(let n=0;n<100;n++){
            await wait(100)
            const text=drawer.querySelector('.ad-history-status').textContent
            if(/sessions|세션|No matching|없습니다|failed|실패/.test(text))return text
        }
        return 'timeout: '+drawer.querySelector('.ad-history-status').textContent
    }
    const status=await search('CheckDetectAbusing')
    let hits=[...drawer.querySelectorAll('.ad-history-hit')]
    check('both providers and late transcript match',hits.length===2,status)
    check('normal rows hidden while searching',drawer.querySelector('.ad-resume-rows').hidden)
    const tabsBefore=ad.app.tabs.length
    const claude=hits.find(h=>h.dataset.sessionId==='11111111-1111-4111-8111-111111111111')
    if(claude){
        claude.click()
        for(let n=0;n<40 && !document.querySelector('.ad-history-conversation article');n++)await wait(100)
        const dialog=document.querySelector('.ad-history-dialog')
        check('matching conversation visible',dialog?.textContent.includes('rCode=-10001'))
        check('literal HTML inert',!dialog?.querySelector('img,[onerror],script') && dialog?.textContent.includes('<img'))
        check('match highlight',!!dialog?.querySelector('mark'))
        check('preview never launches a session',ad.app.tabs.length===tabsBefore)
        dialog?.querySelector('header button').click()
        check('close restores search focus',document.activeElement===input)
    }
    check('same label as active-session search; no filters',drawer.querySelectorAll('.ad-history-search input').length===1 && drawer.querySelectorAll('.ad-history-search select').length===0 && [...document.querySelectorAll('#agentdeck-sidebar input')].some(other=>other!==input && other.placeholder===input.placeholder))
    check('literal punctuation',(await search('a.b[0]')).includes('1'))
    check('Korean identifier',(await search('한국식별자')).includes('1'))
    await search('impossible_identifier_xyz')
    check('empty results clear old matches',drawer.querySelectorAll('.ad-history-hit').length===0)
    input.value='CheckDetectAbusing';input.dispatchEvent(new Event('input'))
    await search('a.b[0]')
    check('latest query wins',drawer.querySelectorAll('.ad-history-hit').length===1)
    input.value='';input.dispatchEvent(new Event('input'))
    check('clearing restores recent list',!drawer.querySelector('.ad-resume-rows').hidden)
    return {results,summary:{pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass).length}}
})()
