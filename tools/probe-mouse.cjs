// Real Chromium input: render between mouse down/up, then observe tab selection.
;(async () => {
    const port = process.argv[2] || 9237
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
    await new Promise(r => ws.addEventListener('open', r, { once: true }))
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
    const call = (method, params) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, m => m.error ? reject(m.error) : resolve(m.result)); ws.send(JSON.stringify({id:n, method, params})) })
    const run = async expression => { const r = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}); if(r.exceptionDetails) throw r.exceptionDetails; return r.result.value }
    if (!await run(`Boolean(process.env.TABBY_CONFIG_DIRECTORY && process.env.TABBY_CONFIG_DIRECTORY.includes('mouse-ui'))`)) throw new Error('Use the isolated mouse-ui instance only')
    await run(`(async()=>{for(let i=window.__agentdeck.app.tabs.length;i<3;i++){document.querySelector('.ad-new').click();await new Promise(r=>setTimeout(r,600))}window.__agentdeck.jump(1);window.__agentdeck.render()})()`)
    const results = []
    for (const forceRender of [false, true]) {
        await run(`window.__agentdeck.jump(1);window.__agentdeck.render()`)
        await new Promise(r=>setTimeout(r,150))
        const pos = await run(`(()=>{const row=document.querySelectorAll('.ad-tab')[1];window.__mouseRow=row;const r=row.getBoundingClientRect();return {x:r.x+40,y:r.y+20}})()`)
        await call('Input.dispatchMouseEvent', {type:'mousePressed', ...pos, button:'left', clickCount:1})
        if(forceRender) await run('window.__agentdeck.render()')
        const retained = await run('window.__mouseRow.isConnected')
        await call('Input.dispatchMouseEvent', {type:'mouseReleased', ...pos, button:'left', clickCount:1})
        await new Promise(r=>setTimeout(r,150))
        const selected = await run('window.__agentdeck.app.tabs.indexOf(window.__agentdeck.app.activeTab)')
        results.push({forceRender, retained, selected, pass:selected===1 && retained})
    }
    for (const ending of ['outside', 'cancel', 'blur']) {
        const pos = await run(`(()=>{const row=document.querySelectorAll('.ad-tab')[0];window.__mouseRow=row;const r=row.getBoundingClientRect();return {x:r.x+40,y:r.y+20}})()`)
        await call('Input.dispatchMouseEvent', {type:'mousePressed', ...pos, button:'left', clickCount:1})
        if(ending === 'cancel') await run(`document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}))`)
        if(ending === 'blur') await run(`window.dispatchEvent(new Event('blur'))`)
        await call('Input.dispatchMouseEvent', {type:'mouseReleased', x:1, y:1, button:'left', clickCount:1})
        await new Promise(r=>setTimeout(r,150))
        const resumed = await run(`window.__agentdeck.render();!window.__mouseRow.isConnected`)
        results.push({ending, pass:resumed})
    }
    const beforeClose = await run('window.__agentdeck.app.tabs.length')
    const hoverPos = await run(`(()=>{const r=document.querySelectorAll('.ad-tab')[2].getBoundingClientRect();return {x:r.x+40,y:r.y+20}})()`)
    await call('Input.dispatchMouseEvent', {type:'mouseMoved', ...hoverPos})
    await new Promise(r=>setTimeout(r,150))
    const closePos = await run(`(()=>{const r=document.querySelectorAll('.ad-tab .ad-close')[2].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await call('Input.dispatchMouseEvent', {type:'mouseMoved', ...closePos})
    await run(`window.__mouseEvents=[];window.__mouseListener=e=>window.__mouseEvents.push({type:e.type,target:e.target.className});for(const name of ['pointerdown','pointerup','mousedown','mouseup','click','blur'])document.addEventListener(name,window.__mouseListener,true)`)
    const closeHit = await run(`document.elementFromPoint(${closePos.x},${closePos.y})?.outerHTML`)
    await call('Input.dispatchMouseEvent', {type:'mousePressed', ...closePos, button:'left', clickCount:1})
    await run('window.__agentdeck.render()')
    await call('Input.dispatchMouseEvent', {type:'mouseReleased', ...closePos, button:'left', clickCount:1})
    for (let i=0;i<30;i++) {
        if(await run('window.__agentdeck.app.tabs.length')===beforeClose-1) break
        await new Promise(r=>setTimeout(r,100))
    }
    const afterClose = await run('window.__agentdeck.app.tabs.length')
    const events = await run(`(()=>{for(const name of ['pointerdown','pointerup','mousedown','mouseup','click','blur'])document.removeEventListener(name,window.__mouseListener,true);return window.__mouseEvents})()`)
    results.push({closeDuringRender:true, closeHit, events, beforeClose, afterClose, pass:afterClose===beforeClose-1})
    console.log(JSON.stringify(results,null,2))
    ws.close()
    process.exitCode = results.every(r=>r.pass) ? 0 : 1
})().catch(e=>{console.error(e);process.exit(1)})
