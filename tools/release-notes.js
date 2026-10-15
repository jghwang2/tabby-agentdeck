#!/usr/bin/env node
// Render GitHub release notes from the canonical changelog; never publish here.
const fs = require('fs')
const path = require('path')

function renderNotes (changelog, version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Invalid release version: ${version}`)
    }
    const entries = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\s*$/gm)]
    const matches = entries.filter(entry => entry[1] === version)
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one CHANGELOG entry for ${version}; got ${matches.length}`)
    }
    const entry = matches[0]
    const index = entries.indexOf(entry)
    const body = changelog.slice(entry.index + entry[0].length, entries[index + 1]?.index).trim()
    if (!body.startsWith('- ')) {
        throw new Error(`CHANGELOG entry for ${version} has no bullet list`)
    }
    const repo = 'https://github.com/jghwang2/tabby-agentdeck'
    return `${body}\n\n---\n\n` +
        `[npm ${version}](https://www.npmjs.com/package/tabby-agentdeck/v/${version}) · ` +
        `[All changes](${repo}/blob/v${version}/CHANGELOG.md)\n\n` +
        `[Detailed user guide](https://jghwang2.github.io/tabby-agentdeck/guide/) · ` +
        `[상세 사용 설명서](https://jghwang2.github.io/tabby-agentdeck/guide/ko.html)\n`
}

if (require.main === module) {
    try {
        const root = path.join(__dirname, '..')
        const args = process.argv.slice(2)
        const version = args[0] || require('../package.json').version
        const notes = renderNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version)
        if (args[1]) {
            fs.mkdirSync(path.dirname(path.resolve(args[1])), { recursive: true })
            fs.writeFileSync(args[1], notes, 'utf8')
        } else {
            process.stdout.write(notes)
        }
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { renderNotes }
