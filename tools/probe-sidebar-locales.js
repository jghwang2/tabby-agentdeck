(async () => {
    const ad = window.__agentdeck, wait = ms => new Promise(r => setTimeout(r, ms))
    require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false)
    if (!document.querySelector('select option[value="en-GB"]')) {
        document.querySelector('.ad-settings').click(); await wait(500)
    }
    const select = [...document.querySelectorAll('select')].filter(x => x.querySelector('option[value="en-GB"]')).pop()
    // Independent visible-copy expectations, rather than importing the product's translation tables.
    const expected = {
        af: ['Instellings','Onaktief'], bg: ['Настройки','Неактивно'], cs: ['Nastavení','Nečinné'],
        da: ['Indstillinger','Inaktiv'], de: ['Einstellungen','Inaktiv'], en: ['Settings','Idle'],
        es: ['Ajustes','Inactivo'], fr: ['Paramètres','Inactif'], hr: ['Postavke','Neaktivno'],
        id: ['Pengaturan','Siaga'], it: ['Impostazioni','Inattivo'], ja: ['設定','待機'], ko: ['설정','대기'],
        pl: ['Ustawienia','Bezczynne'], pt: ['Configurações','Inativo'], ru: ['Настройки','Ожидание'],
        sr: ['Подешавања','Неактивно'], sv: ['Inställningar','Inaktiv'], tr: ['Ayarlar','Boşta'],
        uk: ['Налаштування','Очікування'], 'zh-CN': ['设置','空闲'], 'zh-TW': ['設定','閒置'],
    }
    const root = document.getElementById('agentdeck-sidebar'), results = [], visited = new Set()
    const check = (name, pass) => results.push({ name, pass: !!pass })
    const tab = ad.app.tabs[0], old = tab.customTitle
    tab.customTitle = '한국어 사용자 세션 제목'
    ad.status.setManual(tab, 'idle', '내 작업 이름')
    try {
        for (const option of [...select.options]) {
            const lang = option.value.startsWith('zh') ? option.value : option.value.split('-')[0]
            if (!expected[lang] || visited.has(lang)) continue
            visited.add(lang)
            select.value = option.value
            select.dispatchEvent(new Event('change', { bubbles: true }))
            ad.status.setManual(tab, 'idle', '내 작업 이름')
            await wait(1500)
            check(lang + ' settings button', root.querySelector('.ad-settings').textContent === expected[lang][0])
            check(lang + ' idle status', [...root.querySelectorAll('.ad-badge')].some(x => x.textContent.includes(expected[lang][1])))
            check(lang + ' original title', root.innerText.includes('한국어 사용자 세션 제목'))
            check(lang + ' original task', root.innerText.includes('내 작업 이름'))
            check(lang + ' search', lang === 'ko' || !/[가-힣]/.test(root.querySelector('.ad-search-input').placeholder))
            check(lang + ' past sessions', lang === 'ko' || !/[가-힣]/.test(root.querySelector('.ad-resume-head').innerText))
            check(lang + ' elapsed', lang === 'ko' || [...root.querySelectorAll('.ad-elapsed')].every(x => !/[가-힣]/.test(x.textContent)))
            check(lang + ' tooltips', lang === 'ko' || [...root.querySelectorAll('.ad-close,.ad-new,.ad-settings,.ad-search-clear,.ad-repair,.ad-viewtoggle')].every(x => !/[가-힣]/.test(x.title)))
            ad.status.setManual(tab, 'waiting', '내 작업 이름', 'Bash 권한'); ad.render()
            check(lang + ' permission reason', [...root.querySelectorAll('.ad-badge')].some(x => x.textContent.includes('Bash') && (lang === 'ko' || !/[가-힣]/.test(x.textContent))))
        }
        check('all 22 languages exercised', visited.size === 22)
    } finally {
        tab.customTitle = old; ad.status.setManual(tab, 'idle', '')
        select.value = 'en-GB'; select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return JSON.stringify({ pass: results.every(x => x.pass), languages: [...visited], count: results.length, failures: results.filter(x => !x.pass) })
})()
