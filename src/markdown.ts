/**
 * 미리보기 패널이 쓰는 최소 마크다운 렌더러.
 *
 * 왜 라이브러리(marked 등)를 안 쓰나 — 이 플러그인은 런타임 의존성이 하나도 없다(package.json
 * 은 devDependencies 뿐이고 webpack 이 전부 번들한다). 그 성질을 지키는 값이 크고, 여기서 필요한
 * 것은 문서 미리보기 수준의 부분집합이다. 무엇보다 **HTML 을 우리가 전부 만들면 새니타이즈가
 * 필요 없다** — Electron 렌더러 안에서 남이 만든 문자열을 innerHTML 에 넣는 것이 이 기능의
 * 유일한 보안 위험인데, 원문을 먼저 이스케이프하고 태그는 이쪽에서만 붙이므로 원문에 들어 있는
 * `<script>` 나 `onerror=` 는 태그가 될 기회가 없다.
 *
 * 지원하는 것: 제목 · 문단 · 강조 · 코드(인라인/펜스) · 목록(중첩) · 표 · 인용 · 구분선 ·
 * 링크 · 이미지 · 체크박스. 지원하지 않는 것: 원문 HTML(그대로 글자로 보인다) · 참조 링크
 * (`[a][1]`) · 각주 · 정의목록.
 */

export interface MarkdownOptions {
    /**
     * 이미지 경로를 실제로 그릴 수 있는 URL 로 바꾼다.
     * 로컬 파일을 data URL 로 읽는 일은 fs 가 필요해 패널(viewPanel)이 맡고, 여기서는 호출만 한다.
     * null 을 돌려주면 이미지 대신 대체 텍스트를 보여준다.
     */
    resolveImage?: (src: string) => string | null
}

export function escapeHtml (s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * 링크로 써도 되는 주소인지 본다.
 *
 * 스킴이 붙어 있으면 http/https/mailto/file 만 통과시킨다 — `javascript:` 와 `data:` 를 막는
 * 것이 목적이다. 스킴이 없는 것(상대경로 `./a.md`, 절대경로 `/tmp/a`, 앵커 `#절`)은 그대로 둔다.
 * Windows 드라이브 문자(`D:/x`)는 스킴처럼 보이므로 따로 통과시킨다.
 */
export function safeUrl (raw: string): string | null {
    const url = (raw ?? '').trim()
    if (!url) {
        return null
    }
    if (/^[A-Za-z]:[\\/]/.test(url)) {
        return url
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !/^(?:https?|mailto|file):/i.test(url)) {
        return null
    }
    return url
}

/** 인라인 문법 — 블록을 다 가른 뒤 각 줄 안에서 돈다 */
function inline (src: string, opts: MarkdownOptions): string {
    // 코드 스팬을 먼저 떼어 자리표시자로 바꾼다. 그 안에서는 강조·링크 규칙이 돌면 안 된다
    const codes: string[] = []
    let text = src.replace(/(`+)([\s\S]+?)\1(?!`)/g, (_m, _ticks, body) => {
        codes.push('<code>' + escapeHtml(String(body).replace(/^ | $/g, '')) + '</code>')
        return '\u0000' + (codes.length - 1) + '\u0000'
    })

    // 여기서 한 번 이스케이프해 두면 아래 규칙이 붙이는 태그만 태그로 남는다
    text = escapeHtml(text)

    // 이미지가 링크 문법을 품고 있으므로 이미지를 먼저 본다
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, alt, target) => {
        const resolved = opts.resolveImage ? opts.resolveImage(String(target)) : safeUrl(String(target))
        if (!resolved) {
            return '<span class="ad-md-noimg">🖼 ' + (alt || target) + '</span>'
        }
        return '<img src="' + resolved + '" alt="' + alt + '">'
    })
    text = text.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, target) => {
        const url = safeUrl(String(target))
        if (!url) {
            return String(label)
        }
        return '<a href="' + url + '" data-ad-link="' + url + '">' + label + '</a>'
    })

    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
    text = text.replace(/(^|[\s(\[])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    text = text.replace(/(^|[\s(\[])_([^_\n]+)_/g, '$1<em>$2</em>')
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>')

    return text.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)] ?? '')
}

/** 표 구분선인가 — `|---|:--:|` 형태 */
function isTableRule (line: string): boolean {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
}

function splitRow (line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

interface ListFrame {
    ordered: boolean
    indent: number
}

/**
 * 마크다운 원문을 HTML 로 바꾼다.
 *
 * 한 번 훑으면서 블록을 가른다 — 상태는 "지금 펜스 안인가 / 목록 몇 겹인가" 두 개뿐이다.
 */
export function renderMarkdown (src: string, opts: MarkdownOptions = {}): string {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
    const out: string[] = []
    const stack: ListFrame[] = []
    let para: string[] = []
    let fence: { mark: string, lang: string, body: string[] } | null = null

    const closeLists = (toIndent = -1) => {
        while (stack.length && stack[stack.length - 1].indent > toIndent) {
            out.push(stack.pop()!.ordered ? '</ol>' : '</ul>')
        }
    }
    const flushPara = () => {
        if (para.length) {
            out.push('<p>' + inline(para.join('\n'), opts).replace(/\n/g, '<br>') + '</p>')
            para = []
        }
    }
    const breakBlocks = () => {
        flushPara()
        closeLists()
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // ---------- 코드 펜스 ----------
        if (fence) {
            if (new RegExp('^\\s*' + fence.mark + '\\s*$').test(line)) {
                const cls = fence.lang ? ' class="ad-md-lang-' + fence.lang.replace(/[^\w-]/g, '') + '"' : ''
                out.push('<pre' + cls + '><code>' + escapeHtml(fence.body.join('\n')) + '</code></pre>')
                fence = null
            } else {
                fence.body.push(line)
            }
            continue
        }
        const fenceOpen = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line)
        if (fenceOpen) {
            breakBlocks()
            fence = { mark: fenceOpen[1].slice(0, 3), lang: fenceOpen[2] || '', body: [] }
            continue
        }

        // ---------- 빈 줄 ----------
        if (!line.trim()) {
            flushPara()
            continue
        }

        // ---------- 제목 ----------
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
            breakBlocks()
            const level = heading[1].length
            out.push('<h' + level + '>' + inline(heading[2].replace(/\s+#+\s*$/, ''), opts) + '</h' + level + '>')
            continue
        }

        // ---------- 구분선 ----------
        if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
            breakBlocks()
            out.push('<hr>')
            continue
        }

        // ---------- 표 ----------
        if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
            breakBlocks()
            const head = splitRow(line)
            const rows: string[][] = []
            let j = i + 2
            for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) {
                rows.push(splitRow(lines[j]))
            }
            i = j - 1
            out.push('<table><thead><tr>'
                + head.map(c => '<th>' + inline(c, opts) + '</th>').join('')
                + '</tr></thead><tbody>'
                + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c, opts) + '</td>').join('') + '</tr>').join('')
                + '</tbody></table>')
            continue
        }

        // ---------- 인용 ----------
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote) {
            breakBlocks()
            const body = [quote[1]]
            let j = i + 1
            for (; j < lines.length; j++) {
                const more = /^\s*>\s?(.*)$/.exec(lines[j])
                if (!more) {
                    break
                }
                body.push(more[1])
            }
            i = j - 1
            out.push('<blockquote>' + inline(body.join('\n'), opts).replace(/\n/g, '<br>') + '</blockquote>')
            continue
        }

        // ---------- 목록 ----------
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
        if (item) {
            flushPara()
            const indent = item[1].replace(/\t/g, '  ').length
            const ordered = /\d/.test(item[2])
            // 들여쓰기가 줄었으면 그만큼 닫고, 늘었으면 새로 연다
            while (stack.length && stack[stack.length - 1].indent > indent) {
                out.push(stack.pop()!.ordered ? '</ol>' : '</ul>')
            }
            const top = stack[stack.length - 1]
            if (!top || top.indent < indent) {
                stack.push({ ordered, indent })
                out.push(ordered ? '<ol>' : '<ul>')
            } else if (top.ordered !== ordered) {
                out.push(stack.pop()!.ordered ? '</ol>' : '</ul>')
                stack.push({ ordered, indent })
                out.push(ordered ? '<ol>' : '<ul>')
            }
            // 체크박스는 읽기 전용으로 그린다 (누를 수 있으면 파일과 어긋난다)
            const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3])
            if (task) {
                const checked = task[1].toLowerCase() === 'x'
                out.push('<li class="ad-md-task"><span class="ad-md-check">'
                    + (checked ? '☑' : '☐') + '</span> ' + inline(task[2], opts) + '</li>')
            } else {
                out.push('<li>' + inline(item[3], opts) + '</li>')
            }
            continue
        }

        // ---------- 그 밖 = 문단 ----------
        // 목록 항목 아래에 들여쓴 줄은 그 항목의 이어짐으로 본다
        if (stack.length && /^\s{2,}/.test(line) && out[out.length - 1]?.startsWith('<li')) {
            out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, '<br>' + inline(line.trim(), opts) + '</li>')
            continue
        }
        closeLists()
        para.push(line)
    }

    if (fence) {
        out.push('<pre><code>' + escapeHtml(fence.body.join('\n')) + '</code></pre>')
    }
    breakBlocks()
    return out.join('\n')
}
