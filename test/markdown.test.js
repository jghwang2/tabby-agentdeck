// 미리보기 패널의 마크다운 렌더. 핵심은 두 가지 —
// ① 원문에 들어 있는 HTML 이 절대 태그가 되지 않는다 (innerHTML 로 들어가는 문자열이라서)
// ② 문서를 읽을 만큼의 블록 문법이 실제로 변환된다.
const { renderMarkdown, escapeHtml, safeUrl } = require('../.tmp/markdown.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    if (got === want) {
        console.log(`  ok   ${name} -> ${JSON.stringify(got)}`)
        pass++
    } else {
        console.log(`  FAIL ${name} -> ${JSON.stringify(got)} (기대: ${JSON.stringify(want)})`)
        fail++
    }
}

function has (name, html, needle) {
    check(name + ' 포함: ' + needle, html.includes(needle), true)
}

function hasNot (name, html, needle) {
    check(name + ' 없음: ' + needle, html.includes(needle), false)
}

// ---------- 안전 ----------
check('이스케이프', escapeHtml('<b>&"</b>'), '&lt;b&gt;&amp;&quot;&lt;/b&gt;')
hasNot('script 는 태그가 되지 않는다', renderMarkdown('<script>alert(1)</script>'), '<script>')
has('script 는 글자로 남는다', renderMarkdown('<script>alert(1)</script>'), '&lt;script&gt;')
hasNot('이미지 onerror 주입', renderMarkdown('<img src=x onerror=alert(1)>'), '<img src=x')
hasNot('javascript: 링크는 링크가 아니다', renderMarkdown('[x](javascript:alert(1))'), 'href')
has('javascript: 링크는 글자만 남는다', renderMarkdown('[클릭](javascript:alert(1))'), '클릭')
hasNot('data: 링크 차단', renderMarkdown('[x](data:text/html,<b>)'), 'href')
check('http 는 통과', safeUrl('https://x.io/a'), 'https://x.io/a')
check('상대경로는 통과', safeUrl('./a/b.md'), './a/b.md')
check('Windows 경로는 통과', safeUrl('D:/a/b.md'), 'D:/a/b.md')
check('javascript 는 차단', safeUrl('javascript:x'), null)
check('빈 값은 차단', safeUrl('   '), null)

// ---------- 블록 ----------
has('제목', renderMarkdown('## 제목'), '<h2>제목</h2>')
has('문단', renderMarkdown('그냥 줄'), '<p>그냥 줄</p>')
has('구분선', renderMarkdown('---'), '<hr>')
has('인용', renderMarkdown('> 인용문'), '<blockquote>인용문</blockquote>')

const list = renderMarkdown('- a\n- b\n  - c')
has('목록', list, '<ul>')
has('중첩 목록', list, '<li>c</li>')
check('목록 태그 짝이 맞는다',
    (list.match(/<ul>/g) || []).length, (list.match(/<\/ul>/g) || []).length)

const ol = renderMarkdown('1. 하나\n2. 둘')
has('번호 목록', ol, '<ol>')

const fence = renderMarkdown('```ts\nconst a = 1 < 2\n```')
has('펜스 코드', fence, '<pre class="ad-md-lang-ts"><code>')
has('코드 안의 < 는 이스케이프', fence, 'a = 1 &lt; 2')
hasNot('코드 안에서는 강조가 돌지 않는다', renderMarkdown('```\n**x**\n```'), '<strong>')

const table = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
has('표 헤더', table, '<th>a</th>')
has('표 본문', table, '<td>2</td>')

const task = renderMarkdown('- [x] 끝난 것\n- [ ] 남은 것')
has('완료 체크박스', task, '☑')
has('미완 체크박스', task, '☐')

// ---------- 인라인 ----------
has('굵게', renderMarkdown('**굵게**'), '<strong>굵게</strong>')
has('기울임', renderMarkdown('그리고 *기울임*'), '<em>기울임</em>')
has('취소선', renderMarkdown('~~취소~~'), '<del>취소</del>')
has('인라인 코드', renderMarkdown('`code`'), '<code>code</code>')
has('인라인 코드 안의 별표는 그대로', renderMarkdown('`a*b*c`'), '<code>a*b*c</code>')
has('링크', renderMarkdown('[t](https://x.io)'), 'data-ad-link="https://x.io"')
has('로컬 링크도 클릭 대상', renderMarkdown('[t](./a.md)'), 'data-ad-link="./a.md"')

// 이미지 — 실제 파일 읽기는 패널이 하고, 여기서는 콜백 결과만 쓴다
has('이미지 해석 성공', renderMarkdown('![a](x.png)', { resolveImage: () => 'data:image/png;base64,AA' }),
    '<img src="data:image/png;base64,AA" alt="a">')
has('이미지 해석 실패면 대체 표시', renderMarkdown('![대체](x.png)', { resolveImage: () => null }),
    'ad-md-noimg')

// ---------- 실제 문서 모양 ----------
const doc = renderMarkdown([
    '# 제목',
    '',
    '본문 **강조** 와 `코드`.',
    '',
    '- 항목 1',
    '- 항목 2',
    '',
    '| 키 | 값 |',
    '|---|---|',
    '| a | 1 |',
].join('\n'))
has('문서: 제목', doc, '<h1>제목</h1>')
has('문서: 목록', doc, '<li>항목 1</li>')
has('문서: 표', doc, '<td>1</td>')
check('문서: 목록이 표 앞에서 닫힌다', doc.indexOf('</ul>') < doc.indexOf('<table>'), true)
check('빈 입력은 빈 결과', renderMarkdown(''), '')
check('null 도 견딘다', renderMarkdown(null), '')

console.log(`\nmarkdown: ${pass} passed, ${fail} failed`)
if (fail) {
    process.exit(1)
}
