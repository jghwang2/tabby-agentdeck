(async () => {
    if (!process.env.TABBY_CONFIG_DIRECTORY?.includes('ime-202610')) throw Error('isolated IME test instance required')
    const ad = window.__agentdeck, wait = ms => new Promise(r => setTimeout(r, ms))
    const results = []
    const check = (name, pass, detail) => results.push({name, pass:!!pass, detail})
    document.querySelector('.ad-new').click()
    await wait(2000)
    const tab = ad.app.activeTab, pane = (tab.getAllTabs?.() || [tab])[0], x = pane.frontend.xterm
    const ta = x.textarea, helper = x._core._compositionHelper
    const lines = () => {
        const b = x.buffer.active
        return Array.from({length:b.length}, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\n')
    }
    const until = async pred => { for (let i=0; i<80 && !pred(); i++) await wait(100); return pred() }
    pane.sendInput('node D:/Project/tabby-agentdeck/tools/fake-ime-input.cjs\r')
    if (!await until(() => lines().includes('IME_READY'))) throw Error('PTY fixture did not start')
    let received = ''
    const comp = (type, data='') => ta.dispatchEvent(new CompositionEvent(type, {data,bubbles:true}))
    const key = (key, keyCode, shiftKey=false) => ta.dispatchEvent(new KeyboardEvent('keydown', {
        key,code:key === ' ' ? 'Space' : key,keyCode,which:keyCode,shiftKey,bubbles:true,cancelable:true,
    }))
    const commit = text => {
        comp('compositionstart'); comp('compositionupdate', text); ta.value += text; comp('compositionend', text)
    }
    try {
        // Test an unclassified shell before assigning known profiles; the product
        // intentionally remembers the last known agent for a living PTY.
        for (const agent of ['unknown','claude','codex']) {
            ad.pinAgent(pane, agent === 'unknown' ? null : agent)
            await wait(500)
            for (const scenario of ['fast-enter','fast-space','fast-arrow','slow-enter','consecutive','consecutive-enter','shift-enter',
                'active-space','active-late-end','initial-process','cancelled-timer','sentence']) {
                await wait(30)
                ta.value = ''; helper._compositionPosition.start = 0; helper._compositionPosition.end = 0
                const data = [], sub = x.onData(s => data.push(s))
                let expected = ''
                if (scenario === 'sentence') {
                    expected = '옛날에 에이전트 덱 한글씹힘 관련 작업을 한 적이 있어 지금 얼마나 라고 쳤더니 한글씹힘이 또 일어나네'
                    for (const ch of expected) {
                        key('Process',229)
                        commit(ch)
                    }
                    key('Enter',13); expected += '\r'
                } else if (scenario === 'cancelled-timer') {
                    commit('관'); key('Enter',13); commit('련')
                    expected = '관\r련'
                } else if (['active-space','active-late-end','initial-process'].includes(scenario)) {
                    key('Process',229)
                    comp('compositionstart'); comp('compositionupdate','한'); ta.value='한'
                    if (scenario === 'initial-process') comp('compositionend','한')
                    key(' ',32)
                    ta.dispatchEvent(new KeyboardEvent('keypress',{key:' ',charCode:32,which:32,bubbles:true,cancelable:true}))
                    if (scenario === 'active-late-end') comp('compositionend','한')
                    expected = '한 '
                } else if (scenario === 'consecutive' || scenario === 'consecutive-enter') {
                    commit('한'); commit('글'); expected = '한글'
                    if (scenario === 'consecutive-enter') { key('Enter',13); expected += '\r' }
                } else {
                    commit('한')
                    if (scenario === 'slow-enter') await wait(30)
                    if (scenario === 'fast-space') {
                        key(' ',32)
                        ta.dispatchEvent(new KeyboardEvent('keypress',{key:' ',charCode:32,which:32,bubbles:true,cancelable:true}))
                        expected = '한 '
                    } else if (scenario === 'fast-arrow') { key('ArrowLeft',37); expected = '한\x1b[D' }
                    else if (scenario === 'shift-enter') { key('Enter',13,true); expected = '한' + (agent === 'codex' ? '\x1b\r' : '\n') }
                    else { key('Enter',13); expected = '한\r' }
                }
                await wait(80); sub.dispose()
                // Shift+Enter uses AgentDeck's direct PTY route, not xterm.onData.
                if (scenario !== 'shift-enter') check(agent + ' ' + scenario + ' exact data', data.join('') === expected, data)
                received += expected
                const marker = 'IME_HEX:' + Buffer.from(received,'utf8').toString('hex')
                check(agent + ' ' + scenario + ' PTY received', await until(() => lines().replace(/\n/g,'').includes(marker)), marker)
            }
            ta.value = ''
            const burst = [], subscription = x.onData(s => burst.push(s))
            for (let i = 0; i < 50; i++) { commit('한'); key('Enter', 13) }
            await wait(80); subscription.dispose()
            const expected = '한\r'.repeat(50)
            check(agent + ' 50 rapid commits exact data', burst.join('') === expected, {length:burst.join('').length})
            received += expected
            const marker = 'IME_HEX:' + Buffer.from(received,'utf8').toString('hex')
            check(agent + ' 50 rapid commits PTY received', await until(() => lines().replace(/\n/g,'').includes(marker)), {bytes:Buffer.byteLength(received)})
        }
    } finally {
        ad.pinAgent(pane,null); pane.sendInput('\x03')
    }
    return {pass:results.every(r=>r.pass), results}
})()
