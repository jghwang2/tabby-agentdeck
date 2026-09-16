/**
 * 설정 창의 문구 — Tabby 가 고른 언어를 그대로 따라간다.
 *
 * 왜 있나 — 설정 탭은 한국어만 박혀 있었다. Tabby 자체는 24개 로케일을 갖고 사용자가
 * `설정 > 응용 프로그램 > 언어` 에서 고르는데, 우리 탭만 그 선택을 무시했다
 * (2026-09-14 유저 지시: "설정 언어를 현재 tabby 언어랑 연동되게 해놔").
 *
 * **이 파일은 기계다 — 문구는 `i18n/<언어>.ts` 에 있다.** 언어 하나가 파일 하나고,
 * 새 언어를 더할 때 고칠 곳은 아래 `TABLES` 한 줄뿐이다.
 * 표를 여기 인라인으로 두면 파일 하나가 수천 줄이 되고, 한 언어를 고칠 때마다 전부가 흔들린다.
 *
 * **번역은 기계번역이 아니라 직접 쓴 것이다** (2026-09-14 유저: "니가 그냥 새로 작성하는게
 * 낫지 않아? 22개 언어 다 너는 할 수 있는 언어들이잖아"). 여기 문구는 "무엇이 일어나는가" 를
 * 설명하는 긴 문장이라, 옮기다 뜻이 뒤집히면 설정을 잘못 건드리게 된다.
 *
 * **순수 모듈이다** — Angular·DOM·fs 를 건드리지 않으므로 노드에서 그대로 돌려볼 수 있다
 * (`meta.ts`·`agents.ts` 와 같은 규칙). 화면에 붙이는 일은 `settings.component.ts` 가 한다.
 *
 * ngx-translate 를 쓰지 않는 이유 — Tabby 의 번역은 `.po` 를 빌드에 컴파일해 넣는 구조라
 * 플러그인이 자기 문구를 끼워 넣으려면 그 빌드 사슬을 통째로 들여와야 한다. 표 하나가 더 싸고,
 * 무엇보다 **테스트에 묶인다** (`test/i18n.test.js`).
 */

import af from './i18n/af'
import bg from './i18n/bg'
import cs from './i18n/cs'
import da from './i18n/da'
import de from './i18n/de'
import en from './i18n/en'
import es from './i18n/es'
import fr from './i18n/fr'
import hr from './i18n/hr'
import id from './i18n/id'
import it from './i18n/it'
import ja from './i18n/ja'
import ko from './i18n/ko'
import pl from './i18n/pl'
import pt from './i18n/pt'
import ru from './i18n/ru'
import sr from './i18n/sr'
import sv from './i18n/sv'
import tr from './i18n/tr'
import uk from './i18n/uk'
import zhCN from './i18n/zh-CN'
import zhTW from './i18n/zh-TW'

/**
 * 우리가 문구를 갖고 있는 언어.
 *
 * Tabby 의 로케일 코드(`ko-KR` · `pt-BR` …)와 **일대일이 아니다** — 지역만 다르고 글이 같은
 * 것들은 한 칸으로 묶었다(`en-GB`/`en-US`, `pt-PT`/`pt-BR`). 중국어만 간체·번체가
 * 실제로 다른 글이라 둘로 나뉘어 있다.
 */
export type Lang = keyof typeof TABLES

const TABLES = {
    af, bg, cs, da, de, en, es, fr, hr, id, it, ja, ko, pl, pt, ru, sr, sv, tr, uk,
    'zh-CN': zhCN,
    'zh-TW': zhTW,
}

/**
 * Tabby 의 로케일 코드를 우리가 가진 언어로 좁힌다.
 *
 * 모르는 언어는 영어로 떨어진다 — 빈 화면을 내는 것보다 낫고, 우리가 가진 22개 밖은
 * Tabby 에도 없다. 중국어만 지역까지 봐야 한다(간체·번체는 다른 글이다).
 */
export function pickLang (locale: string | null | undefined): Lang {
    const code = String(locale ?? '').trim().toLowerCase()
    if (code.startsWith('zh')) {
        // 번체를 쓰는 곳 — 나머지 중국어권은 간체로 본다
        return /\b(tw|hk|mo|hant)\b/.test(code) ? 'zh-TW' : 'zh-CN'
    }
    const base = code.split(/[-_]/)[0]
    return (base in TABLES ? base : 'en') as Lang
}

/**
 * 문구 하나를 꺼낸다. `{이름}` 자리는 `params` 로 채운다.
 *
 * 그 언어에 문구가 없으면 **영어로 떨어진다** — 새 문구를 더하다 한 언어를 빠뜨려도
 * 화면이 비지 않는다(빠뜨린 것 자체는 테스트가 잡는다).
 * 아예 모르는 키는 **키 그대로** 돌려준다 — 빈 문자열을 주면 화면에서 조용히 사라져서,
 * 오타를 낸 줄이 "설명이 원래 없는 항목" 처럼 보인다.
 */
export function translate (key: string, lang: Lang, params?: Record<string, string | number>): string {
    const text = (TABLES[lang] as Record<string, string>)[key] ?? (en as Record<string, string>)[key]
    if (text === undefined) {
        return key
    }
    if (!params) {
        return text
    }
    return text.replace(/\{(\w+)\}/g, (whole, name) => {
        const v = params[name]
        return v === undefined || v === null ? whole : String(v)
    })
}

/** 회귀용 — 표 전체를 그대로 내준다 (테스트가 언어별 누락을 훑는다) */
export const LANGUAGES = TABLES
