/**
 * 열려 있는 모든 pane 의 화면을 판정한다 — `node tools/cdp.js 9222 tools/verdict.js`
 *
 * 판정 규칙은 플러그인의 `src/screen.ts` 와 같아야 한다. 여기서 다시 쓰는 이유는
 * CDP 로 넣는 표현식이 번들과 별개로 평가되기 때문이다 — 규칙을 고치면 양쪽을 같이 고칠 것.
 * (규칙 자체의 회귀는 `test/screen.test.js` 가 잡는다)
 */
(() => {
  const flat = []
  const walk = t => { if (!t) { return } if (typeof t.getAllTabs === 'function') { t.getAllTabs().forEach(walk) } else { flat.push(t) } }
  window.__agentdeck.app.tabs.forEach(walk)

  const RULE_RE = /^[─━═]{2,}$/
  const HEAD_RE = /^[>❯›❭➜](\s|$)/
  const HEAD_ANYWHERE_RE = /[>❯›❭➜](\s|$)/
  const CHOICE_RE = /^[>❯›❭➜]\s*(\d+[.)]\s|(?:Yes|No)\b)/i
  const RULE_CHAR_RE = /[─━═]/

  const judge = p => {
    const x = p.frontend?.xterm
    if (!x || !(x.cols > 1)) { return { verdict: 'NO-XTERM' } }
    const host = x.element?.parentElement
    if (!host?.clientWidth) { return { verdict: 'HIDDEN' } }
    const buf = x.buffer.active
    const cols = x.cols
    const lines = []
    for (let y = buf.baseY; y <= buf.baseY + x.rows - 1; y++) {
      const l = buf.getLine(y)
      lines.push(l ? l.translateToString(false).replace(/\s+$/, '') : '')
    }
    const rules = [], heads = [], reasons = []
    lines.forEach((body, i) => {
      if (!body) { return }
      if (RULE_RE.test(body)) {
        rules.push(i)
        if (body.length !== cols) { reasons.push(`rule@${i} len=${body.length} != cols=${cols}`) }
        return
      }
      if (RULE_CHAR_RE.test(body) && HEAD_ANYWHERE_RE.test(body)) {
        reasons.push(`mixed@${i} ${JSON.stringify(body.slice(0, 40))}`)
      }
      if (HEAD_RE.test(body) && !CHOICE_RE.test(body)) { heads.push(i) }
    })
    if (rules.length > 1) {
      const lens = new Set(rules.map(i => lines[i].length))
      if (lens.size > 1) { reasons.push(`rule lens=${[...lens].join(',')} (섞임)`) }
    }
    // 입력창은 화면 맨 아래다 — 폭을 꿉 채운 마지막 두 테두리 사이만 본다 (screen.ts 와 같은 규칙)
    const fullRules = rules.filter(i => lines[i].length === cols)
    if (fullRules.length >= 2) {
      const bottom = fullRules[fullRules.length - 1]
      const top = fullRules[fullRules.length - 2]
      if (bottom - top < 2) {
        reasons.push(`입력창에 자리가 없다 (테두리 ${top}·${bottom} 이 맞붙었다)`)
      } else {
        const inside = heads.filter(i => i > top && i < bottom).length
        if (inside > 1) { reasons.push(`입력창 안 머리=${inside} (기대 1)`) }
      }
    }
    // 아래 테두리 소실 — 머리 바로 위는 테두리인데 그 아래엔 테두리가 없다 (screen.ts 와 같은 규칙)
    if (heads.length && fullRules.length) {
      const head = heads[heads.length - 1]
      if (fullRules.includes(head - 1) && !fullRules.some(i => i > head)) {
        reasons.push(`입력창 아래 테두리가 없다 (머리@${head}, 위 테두리@${head - 1})`)
      }
    }
    return {
      verdict: reasons.length ? 'BROKEN' : 'OK',
      cols, sent: p.size?.columns,
      ruleLens: rules.map(i => lines[i].length),
      reasons,
    }
  }

  return JSON.stringify({
    mainW: document.querySelector('.content.main')?.clientWidth,
    winW: document.querySelector('.window')?.clientWidth,
    sidebarW: document.getElementById('agentdeck-sidebar')?.clientWidth,
    footBtns: [...document.querySelectorAll('#agentdeck-sidebar .ad-foot .ad-btn')].map(b => b.textContent.trim()),
    panes: flat.map((p, i) => ({ pane: i, title: p.title, ...judge(p) })),
  }, null, 1)
})()
