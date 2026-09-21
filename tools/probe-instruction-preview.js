(async () => {
    const remote = require('@electron/remote')
    if (!remote.app.getPath('userData').includes('tabby-agentdeck-test')) throw new Error('Isolated instance required')
    const fs = require('fs'), path = require('path'), os = require('os')
    const ad = window.__agentdeck, panel = ad.view(), tab = panel.activeTab
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-preview-'))
    const results = [], check = (name, pass) => results.push({ name, pass: !!pass })
    const chips = () => [...document.querySelectorAll('#agentdeck-view .ad-view-tab')].map(e => e.textContent)
    const read = async file => { panel.noteOutput(tab, file + '\r\n'); await new Promise(r => setTimeout(r, 650)) }
    try {
        const artifact = path.join(root, 'result.md'), instruction = path.join(root, 'CLAUDE.md'), skill = path.join(root, 'SKILL.md')
        for (const file of [artifact, instruction, skill]) fs.writeFileSync(file, '# Preview fixture ' + path.basename(file))
        ad.openFile(artifact)
        await read(instruction); await read(skill)
        check('passive reads create no instruction chips', !chips().includes('CLAUDE.md') && !chips().includes('SKILL.md'))
        check('artifact remains visible', document.querySelector('.ad-view-body').textContent.includes('result.md'))
        ad.openFile(instruction)
        check('explicit instruction open renders content', chips().includes('CLAUDE.md') && document.querySelector('.ad-view-body').textContent.includes('CLAUDE.md'))
        await read(instruction)
        check('explicit selection survives later reads', chips().includes('CLAUDE.md'))
        return JSON.stringify({ pass: results.every(r => r.pass), results, userData: remote.app.getPath('userData') })
    } finally { panel.setOpen(false); fs.rmSync(root, { recursive: true, force: true }) }
})()
