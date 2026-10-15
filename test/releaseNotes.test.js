const assert = require('node:assert/strict')
const { test } = require('node:test')
const { renderNotes } = require('../tools/release-notes')

const changelog = '# Changelog\r\n\r\n## 1.2.8 — 2026-10-15\r\n\r\n- New behavior.\r\n  Continued detail.\r\n\r\n## 1.2.7 — 2026-10-14\r\n\r\n- Older behavior.\r\n'

test('extracts only the requested version and preserves multiline notes', () => {
    const notes = renderNotes(changelog, '1.2.8')
    assert.ok(notes.includes('- New behavior.\r\n  Continued detail.'))
    assert.ok(!notes.includes('Older behavior'))
    assert.ok(notes.includes('/blob/v1.2.8/CHANGELOG.md'))
    assert.ok(notes.includes('/package/tabby-agentdeck/v/1.2.8'))
    assert.ok(notes.includes('/guide/ko.html'))
})

test('extracts the final section', () => {
    assert.ok(renderNotes(changelog, '1.2.7').startsWith('- Older behavior.\n'))
})

test('rejects missing, duplicated, malformed and empty entries', () => {
    assert.throws(() => renderNotes(changelog, '1.2.6'), /exactly one/)
    assert.throws(() => renderNotes(changelog + '\n## 1.2.8 — 2026-10-15\n\n- Duplicate.', '1.2.8'), /exactly one/)
    assert.throws(() => renderNotes(changelog, 'v1.2.8'), /Invalid/)
    assert.throws(() => renderNotes('## 1.2.8 — 2026-10-15\n', '1.2.8'), /bullet list/)
})
