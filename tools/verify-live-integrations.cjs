// Requires a real, idle Claude CLI with a persisted conversation and SessionStart
// hook in tools/test-instance.ps1. Does not submit a model request or fake hooks.
// Usage: node tools/verify-live-integrations.cjs PORT SESSION_ID TEST_ROOT
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const [port, sid, rootArg] = process.argv.slice(2)
assert.match(port || '', /^\d+$/)
assert.match(sid || '', /^[a-f0-9-]{36}$/i)
const root = path.resolve(rootArg)
const cdp = path.join(__dirname, 'cdp.js')
let sequence = 0, prepared = false
const run = (...args) => execFileSync(process.execPath, [cdp, port, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
})
const evaluate = code => {
    const file = path.join(root, `live-check-${++sequence}.js`)
    fs.writeFileSync(file, code)
    return JSON.parse(run(file))
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const result = { sessionId: sid, results: [] }
;(async () => {
    const setup = evaluate(`(() => {
        const path=require('path'), ad=window.__agentdeck;
        if(path.resolve(process.env.TABBY_CONFIG_DIRECTORY || '.') !== path.join(${JSON.stringify(root)},'cfg'))
            throw new Error('The target is not the requested isolated app');
        const hook=ad.hookInfo().find(r=>r.sessionId===${JSON.stringify(sid)});
        if(!hook || !path.resolve(hook.cwd).startsWith(${JSON.stringify(root)}+path.sep))
            throw new Error('An actual test CLI hook with an isolated cwd is required');
        const tab=ad.app.tabs[hook.index], pane=(tab.getAllTabs?.()||[tab]).find(p=>p.session?.open);
        if(!pane) throw new Error('Live terminal missing');
        const cb=require('electron').clipboard, formats=cb.availableFormats();
        if(formats.some(f=>!['text/plain','text/html'].includes(f)))
            throw new Error('Cannot losslessly restore these clipboard formats');
        if(window.__adLiveVerification) throw new Error('A prior clipboard verification is pending');
        const state=window.__adLiveVerification={tab,pane,clipboard:{text:cb.readText(),html:cb.readHTML()}};
        state.draft=()=>{
            const x=pane.frontend.xterm,b=x.buffer.active;
            const lines=Array.from({length:x.rows},(_,i)=>b.getLine(b.baseY+i)?.translateToString(true)||'');
            return lines.filter(line=>/^\\s*❯/.test(line)).at(-1)||'';
        };
        ad.app.selectTab(tab);pane.frontend.xterm.focus();pane.frontend.xterm.textarea.focus();
        return {draft:state.draft(), agent:ad.agentOf().effectiveId};
    })()`)
    prepared = true
    assert.equal(setup.agent, 'claude')
    assert.match(setup.draft, /^\s*❯\s*$/, 'Use an empty CLI draft')
    const image = evaluate(`(() => {
        const {clipboard:cb,nativeImage}=require('electron'), pixels=Buffer.alloc(64*64*4);
        for(let i=0;i<pixels.length;i+=4){pixels[i]=51;pixels[i+1]=119;pixels[i+2]=187;pixels[i+3]=255;}
        cb.write({image:nativeImage.createFromBitmap(pixels,{width:64,height:64})});
        return {present:!cb.readImage().isEmpty(),textEmpty:cb.readText()==='',size:cb.readImage().getSize()};
    })()`)
    assert.deepEqual(image, { present: true, textEmpty: true, size: { width: 64, height: 64 } })
    run('--keys', 'Ctrl-V')
    let attached = false
    for (let i = 0; i < 20; i++) {
        await wait(250)
        attached = evaluate(`(() => ({attached:window.__adLiveVerification.draft().includes('[Image #1]')}))()`).attached
        if (attached) break
    }
    assert.equal(attached, true, 'Actual Claude input must display the attached image')
    result.results.push({ id: 'R6', pass: true, detail: 'OS image → CDP Ctrl+V → real Claude [Image #1]' })
    evaluate(`(() => {
        const cb=require('electron').clipboard;
        cb.write({image:cb.readImage(),text:'AGENTDECK_MIXED_CLIPBOARD_TEST'});
        return {ready:true};
    })()`)
    run('--keys', 'Ctrl-V')
    await wait(500)
    const mixed = evaluate(`(() => {
        const draft=window.__adLiveVerification.draft();
        return {text:draft.includes('AGENTDECK_MIXED_CLIPBOARD_TEST'),secondImage:draft.includes('[Image #2]')};
    })()`)
    assert.deepEqual(mixed, { text: true, secondImage: false })
    result.results.push({ id: 'IN6', pass: true, detail: 'Image-only attaches; mixed image/text pastes text without another attachment' })
    const live = evaluate(`(async () => {
        const ad=window.__agentdeck, sid=${JSON.stringify(sid)}, state=window.__adLiveVerification;
        await ad.rescanSessions(); ad.render();
        if(!ad.sessions().expanded) document.querySelector('.ad-resume-head').click();
        ad.render();
        const rows=ad.sessions().rows,index=rows.findIndex(r=>r.sessionId===sid);
        const el=document.querySelectorAll('.ad-resume-rows .ad-resume')[index];
        const before=ad.app.tabs.length, other=ad.app.tabs.find(t=>t!==state.tab);
        if(other) ad.app.selectTab(other);
        const marked=!!el?.classList.contains('open'), liveBadge=!!el?.querySelector('.re-was.live');
        el?.click(); await new Promise(r=>setTimeout(r,300));
        return {record:rows[index]?.openTabId===sid,marked,liveBadge,
            focused:ad.app.activeTab===state.tab,noDuplicate:ad.app.tabs.length===before};
    })()`)
    assert.deepEqual(live, { record: true, marked: true, liveBadge: true, focused: true, noDuplicate: true })
    result.results.push({ id: 'RS8', pass: true, detail: 'Real Claude hook and transcript → open row/live badge; click focuses existing tab', evidence: live })
    run('--shot', path.join(root, 'live-integration.png'))
})().catch(error => {
    result.error = error.message
    process.exitCode = 1
}).finally(() => {
    if (prepared) {
        try {
            const restored = evaluate(`(() => {
                const state=window.__adLiveVerification, cb=require('electron').clipboard;
                cb.write(state.clipboard);
                const ok=cb.readText()===state.clipboard.text&&cb.readHTML()===state.clipboard.html;
                delete window.__adLiveVerification;
                return {restored:ok};
            })()`)
            result.clipboardRestored = restored.restored
            if (!restored.restored) process.exitCode = 1
        } catch (error) { result.restoreError = error.message; process.exitCode = 1 }
    }
    result.pass = result.results.length === 3 && result.clipboardRestored === true && !result.error
    fs.writeFileSync(path.join(root, 'live-integration.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
})
