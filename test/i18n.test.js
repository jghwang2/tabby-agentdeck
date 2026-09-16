// 설정 창 문구 — `npm test`
//
// 여기서 지키는 것은 셋이다.
//  ① 로케일 코드에서 언어를 고르는 규칙 (Tabby 는 `ko-KR` · `pt-BR` 처럼 지역까지 준다)
//  ② **템플릿이 부르는 키가 표에 다 있는가** — `t('...')` 는 문자열이라 tsc 가 못 잡고,
//     오타가 나면 화면에 키가 그대로 찍힌다. 설정 탭을 눈으로 열기 전에는 아무도 모른다.
//  ③ **언어마다 키가 다 채워져 있는가** — 새 문구를 더하다 한 언어를 빠뜨리면 그 언어만
//     영어로 떨어지는데, 섞여 나오는 화면은 번역이 아예 없는 것보다 나쁘다.
const fs = require('fs')
const path = require('path')
const { LANGUAGES, pickLang, translate } = require('../.tmp/i18n.js')

let pass = 0
let fail = 0

function check (name, got, want) {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    if (g === w) {
        console.log(`  ok   ${name}`)
        pass++
    } else {
        console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`)
        fail++
    }
}

// ── 언어 고르기 ──────────────────────────────────────────────────────────────
// 실제 코드 목록은 LocaleService.allLanguages (tabby-core) 에서 뜬 것이다.
const TABBY_LOCALES = [
    'af-ZA', 'id-ID', 'cs-CZ', 'da-DK', 'de-DE', 'en-GB', 'en-US', 'es-ES', 'fr-FR', 'hr-HR',
    'it-IT', 'pl-PL', 'pt-PT', 'pt-BR', 'sv-SE', 'tr-TR', 'bg-BG', 'ru-RU', 'sr-SP', 'uk-UA',
    'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW',
]
check('Tabby 의 24개 로케일이 전부 우리 표로 떨어진다 (영어 폴백 없이)',
    TABBY_LOCALES.filter(c => !LANGUAGES[pickLang(c)]), [])
check('영어로 떨어지는 것은 en-GB·en-US 뿐',
    TABBY_LOCALES.filter(c => pickLang(c) === 'en'), ['en-GB', 'en-US'])
check('ko-KR 은 한국어', pickLang('ko-KR'), 'ko')
check('대소문자·구분자가 섞여도 잡는다', pickLang('KO_kr'), 'ko')
check('지역만 다른 포르투갈어는 한 칸으로', [pickLang('pt-PT'), pickLang('pt-BR')], ['pt', 'pt'])
check('중국어는 간체·번체를 가른다', [pickLang('zh-CN'), pickLang('zh-TW')], ['zh-CN', 'zh-TW'])
check('홍콩·마카오는 번체', [pickLang('zh-HK'), pickLang('zh-MO')], ['zh-TW', 'zh-TW'])
check('지역 없는 zh 는 간체', pickLang('zh'), 'zh-CN')
check('모르는 언어는 영어', pickLang('is-IS'), 'en')
check('빈 값은 영어', pickLang(''), 'en')
check('null 은 영어 (아직 로케일을 못 읽은 순간)', pickLang(null), 'en')
check('undefined 도 영어', pickLang(undefined), 'en')

// ── 문구 꺼내기 ──────────────────────────────────────────────────────────────
check('한국어 설치 버튼', translate('btn.install', 'ko'), '설치')
check('영어 설치 버튼', translate('btn.install', 'en'), 'Install')
check('일본어 설치 버튼', translate('btn.install', 'ja'), 'インストール')
// 빈 문자열을 주면 그 줄이 화면에서 조용히 사라져 "설명이 없는 항목" 처럼 보인다
check('모르는 키는 키 그대로 (화면에서 눈에 띄어야 한다)', translate('nope.nope', 'ko'), 'nope.nope')
check('그 언어에 없는 키는 영어로 떨어진다', translate('btn.install', 'ko') !== undefined, true)
check('{자리} 치환', translate('size.width', 'ko', { px: 420 }), '폭 420px')
check('{자리} 치환 — 영어', translate('size.width', 'en', { px: 420 }), '420px wide')
check('두 자리 치환', translate('reset.now', 'en', { dock: 'right', size: '420px wide' }),
    'Now: docked right, 420px wide.')
check('params 를 안 주면 자리표시가 그대로 남는다', translate('size.width', 'ko'), '폭 {px}px')
check('모르는 이름의 자리는 건드리지 않는다', translate('size.width', 'ko', { nope: 1 }), '폭 {px}px')
check('0 도 값이다 (falsy 를 빼면 0% 가 사라진다)', translate('size.width', 'ko', { px: 0 }), '폭 0px')

// ── 표 자체가 성한가 ─────────────────────────────────────────────────────────
const langs = Object.keys(LANGUAGES)
const keys = Object.keys(LANGUAGES.en)
check('언어가 22개 (Tabby 24 로케일 - 지역만 다른 en·pt 중복 2)', langs.length, 22)
check('영어 표가 비어 있지 않다', keys.length > 40, true)
check('모든 언어가 영어와 같은 키를 갖고 있다',
    langs.filter(l => keys.some(k => !LANGUAGES[l][k])), [])
check('영어에 없는 키를 혼자 들고 있는 언어가 없다 (키 오타)',
    langs.filter(l => Object.keys(LANGUAGES[l]).some(k => !keys.includes(k))), [])
// 자리표시자를 옮기다 놓치면 화면에 `{px}` 대신 빈 자리가 남는다 — 눈으로는 안 보인다
const PLACEHOLDERS = { 'reset.now': ['dock', 'size'], 'size.width': ['px'], 'size.height': ['px'],
    'diag.intro': ['path'], 'diag.collect.desc': ['version'] }
check('자리표시자가 모든 언어에 그대로 살아 있다',
    langs.flatMap(l => Object.entries(PLACEHOLDERS)
        .filter(([k, names]) => names.some(n => !LANGUAGES[l][k].includes('{' + n + '}')))
        .map(([k]) => `${l}:${k}`)), [])
// `<b>`·`<code>` 는 [innerHTML] 로 그려진다 — 한쪽만 옮기면 태그가 글자로 보인다
check('태그가 열리고 닫힌 짝이 맞는다',
    langs.flatMap(l => keys
        .filter(k => {
            const v = LANGUAGES[l][k]
            return (v.match(/<b>/g) || []).length !== (v.match(/<\/b>/g) || []).length
                || (v.match(/<code>/g) || []).length !== (v.match(/<\/code>/g) || []).length
        })
        .map(k => `${l}:${k}`)), [])
check('번역을 안 한 채 영어를 복사만 한 항목이 없다',
    langs.filter(l => l !== 'en' && keys.every(k => LANGUAGES[l][k] === LANGUAGES.en[k])), [])

// ── 템플릿이 부르는 키가 표에 다 있나 ────────────────────────────────────────
// 소스를 글자로 읽는다. 컴포넌트를 띄우려면 Angular 가 필요한데, 확인하려는 것은
// "키 문자열이 맞나" 뿐이라 렌더까지 갈 이유가 없다.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.component.ts'), 'utf8')
// 주석 처리해 둔 절(<!-- ... -->)은 화면에 안 나가므로 대조에서 뺀다
const live = src.replace(/<!--[\s\S]*?-->/g, '')
const used = [...live.matchAll(/\bt\(\s*'([^']+)'/g)].map(m => m[1])
// 삼항으로 고르는 자리(`t(claudeOn ? 'state.on' : 'state.off')`)도 같은 정규식에 걸린다
check('템플릿이 키를 쓰고 있다 (정규식이 헛돌지 않았다)', used.length > 25, true)
check('템플릿이 부르는 키가 표에 다 있다', [...new Set(used)].filter(k => !LANGUAGES.en[k]), [])

console.log(`\ni18n: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
