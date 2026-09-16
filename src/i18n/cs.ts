/** Čeština */
export default {
    'layout.title': 'Používat rozvržení AgentDeck',
    'layout.desc': 'Po vypnutí zmizí postranní panel i pevná šířka a vrátí se původní vzhled Tabby.',

    'reset.title': 'Obnovit rozvržení',
    'reset.desc': 'Vrátí postranní panel do výchozího stavu — ukotvený vpravo, se šířkou spočítanou '
        + 'z poměru okna.',
    'reset.now': 'Nyní: ukotven {dock}, {size}.',
    'reset.default': 'Právě teď je vše ve výchozím stavu.',
    'reset.btn': 'Obnovit',

    'dock.left': 'vlevo',
    'dock.right': 'vpravo',
    'dock.top': 'nahoře',
    'dock.bottom': 'dole',
    'size.width': 'šířka {px} px',
    'size.height': 'výška {px} px',
    'size.auto': 'šířka automaticky',

    'norecover.title': 'Neobnovovat karty při spuštění',
    'norecover.desc': 'Tabby se spustí prázdný místo obnovení předchozích karet — vrátí se stejně jen shell '
        + 'a relace Claude uvnitř už dávno skončila. '
        + 'Vypnutím se vrátíte k původnímu chování (<code>recoverTabs</code>). Platí od příštího spuštění.',

    'resume.title': 'Navázat na minulé relace',
    'resume.desc': 'Přidá na konec každé skupiny zásuvku <code>⟲ Minulé relace</code> (ve výchozím stavu sbalenou). '
        + 'Po rozbalení jsou v ní <b>zavřené relace Claude Code a Codex</b> popsané promptem, který jste '
        + 'skutečně napsali; kliknutím se rozhovor vrátí příkazem <code>claude --resume</code> nebo '
        + '<code>codex resume</code> v jeho vlastní pracovní složce. Je to druhá polovina volby '
        + '<b>Neobnovovat karty</b> výše — původní obnova vrátí shell, tohle vrátí rozhovor. '
        + '<b>Servery a procesy na pozadí, které jste tehdy měli spuštěné, se nevrátí.</b>',

    'agents.head': 'Napojení agentů',
    'agents.intro': 'Nechá každého agenta, aby <b>sám hlásil</b> svůj stav, model a limity využití. '
        + 'To je nejpřesnější zdroj, který postranní panel má — bez toho hádáme z textu vykresleného '
        + 'na obrazovce a odhad podle toho kolísá.',
    'agents.unsupported.title': 'Na této platformě nedostupné',
    'agents.unsupported.desc': 'Oznamovací skript je v PowerShellu, takže běží jen ve Windows. '
        + 'Stav se odhaduje z výstupu.',

    'state.on': 'Připojeno',
    'state.off': 'Nepřipojeno',
    'state.half': 'Napojeno zpola',
    'btn.install': 'Nainstalovat',
    'btn.remove': 'Odebrat',

    'claude.title': 'Napojení na Claude',
    'claude.desc': 'Relace Claude Code se v postranním panelu zobrazí se svým <b>stavem</b> '
        + '(pracuje · čeká na schválení · hotovo) a <b>ukazateli modelu, účtu a využití</b>. '
        + 'Háky a <code>statusLine</code> v <code>~/.claude/settings.json</code> se instalují společně '
        + 'a společně se i odebírají. Ostatních háků se to nedotkne a <code>statusLine</code>, kterou jste '
        + 'už měli, se <b>spustí beze změny</b> — co tam vidíte, zůstane stejné. '
        + 'Před zápisem se vedle souboru uloží záloha.',

    'codex.title': 'Napojení na Codex',
    'codex.desc': 'Relace Codex se v postranním panelu zobrazí se svým <b>stavem</b> '
        + '(pracuje · čeká na schválení · hotovo · přerušeno) a <b>ukazateli modelu, účtu a využití</b>. '
        + 'Po instalaci otevřete Codex znovu a v <code>/hooks</code> zkontrolujte a schvalte háky AgentDeck.',

    'codex.disabled': 'Codex má tyto háky vypnuté — dokud je nezapneš, nic nedorazí: {events}. Otevři Codex, spusť <code>/hooks</code> a schval je.',

    'root.head': 'Profil pracovní složky',
    'root.intro': 'Vytvoří profil, aby se nové karty vždy otevíraly ve stejné složce. '
        + 'Změny se projeví po restartu Tabby.',
    'root.use.title': 'Používat profil pracovní složky',
    'root.use.desc': 'Zapněte a vyplňte složku — profil se vytvoří a stane se výchozím.',
    'root.name.title': 'Název profilu',
    'root.cwd.title': 'Pracovní složka',
    'root.cwd.desc': 'Necháte-li prázdné, žádný profil nevznikne. Při ručním psaní používejte lomítka '
        + '(např. D:/Project), vyhnete se tak pastem s escapováním zpětných lomítek.',
    'root.browse': 'Procházet',
    'root.command.title': 'Příkaz',

    'diag.head': 'Nahlásit problém',
    'diag.intro': 'Posbírá diagnostické logy <b>do jednoho zipu</b> a otevře složku, kde skončí. '
        + 'Obsahuje: verze pluginu a Tabby a operační systém, nastavení výše a dvě nejnovější generace '
        + '<code>{path}</code>. V logách jsou <b>názvy karet a cesty, které jste otevřeli</b> — '
        + 'před odesláním klidně zip otevřete a zkontrolujte.',
    'diag.screen.title': 'Přiložit i syrovou obrazovku',
    'diag.screen.desc': 'Zapněte u problémů s vykreslováním. Obrazovka terminálu se přiloží doslova — '
        + 'je v ní vidět vaše práce i kód — proto je to ve výchozím stavu vypnuté.',
    'diag.collect.title': 'Posbírat logy',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Vytvořeno: ',
    'diag.btn': 'Posbírat',

    'dev.head': 'Možnosti pro vývojáře',
    'dev.use.title': 'Zapnout možnosti pro vývojáře',
    'dev.use.desc': 'Zapne <b>živé načítání</b> — jakmile <code>npm run build</code> přepíše '
        + '<code>dist/index.js</code>, okno se načte na nový plugin <b>se zachovanými relacemi</b> '
        + '(karty se znovu připojí ke stejnému pty). Klávesová zkratka <b>[dev] Znovu načíst plugin</b> '
        + 'se řídí stejným přepínačem. Když je vypnuto, změna dist neudělá nic. '
        + 'Zobrazuje se jen u instalace ze zdrojů; sestavení z npm tohle nemá.',
    'dev.now.title': 'Načíst znovu',
    'dev.now.desc': 'Načte aktuální dist bez sestavení.',
    'dev.btn': 'Načíst znovu',

    'footer': 'Zbytek — poměr okna, šířka postranního panelu, průhlednost, detekce stavu, zpracování vstupu — '
        + 'je napevno na výchozích hodnotách. Pokud potřebujete něco změnit, upravte <code>agentDeck.*</code> '
        + 'přímo v konfiguračním souboru. '
        + 'Klávesové zkratky najdete na kartě <b>Zkratky</b> pod <code>agentdeck-*</code>.',
}
