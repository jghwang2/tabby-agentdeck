/** Polski */
export default {
    'layout.title': 'Używaj układu AgentDeck',
    'layout.desc': 'Po wyłączeniu znikają panel boczny i stała szerokość — wraca zwykły wygląd Tabby.',

    'reset.title': 'Zresetuj układ',
    'reset.desc': 'Przywraca panel boczny do stanu początkowego — zadokowany po prawej, szerokość wyliczona '
        + 'z proporcji okna.',
    'reset.now': 'Teraz: zadokowany {dock}, {size}.',
    'reset.default': 'Aktualnie wszystko jest domyślne.',
    'reset.btn': 'Resetuj',

    'dock.left': 'po lewej',
    'dock.right': 'po prawej',
    'dock.top': 'u góry',
    'dock.bottom': 'u dołu',
    'size.width': 'szerokość {px} px',
    'size.height': 'wysokość {px} px',
    'size.auto': 'szerokość automatyczna',

    'norecover.title': 'Nie przywracaj kart przy starcie',
    'norecover.desc': 'Tabby startuje pusty zamiast przywracać poprzednie karty — wraca i tak tylko powłoka, '
        + 'a sesja Claude, która w niej była, dawno się skończyła. '
        + 'Wyłącz, aby wrócić do zachowania oryginalnego (<code>recoverTabs</code>). Działa od następnego startu.',

    'resume.title': 'Wznów poprzednie sesje',
    'resume.desc': 'Dodaje na końcu każdej grupy szufladę <code>⟲ Poprzednie sesje</code> (domyślnie zwiniętą). '
        + 'Po rozwinięciu są tam <b>zamknięte sesje Claude Code i Codex</b> opisane promptem, który naprawdę '
        + 'wpisałeś; kliknięcie przywraca rozmowę poleceniem <code>claude --resume</code> lub '
        + '<code>codex resume</code> w jej własnym katalogu roboczym. To druga połowa opcji '
        + '<b>Nie przywracaj kart</b> powyżej — oryginalne przywracanie odtwarza powłokę, to odtwarza rozmowę. '
        + '<b>Uruchomione wtedy serwery i procesy w tle nie wracają.</b>',

    'agents.head': 'Integracja agentów',
    'agents.intro': 'Sprawia, że każdy agent <b>sam zgłasza</b> swój stan, model i limity zużycia. '
        + 'To najdokładniejsze źródło, jakie ma panel boczny — bez tego zgadujemy z tekstu narysowanego '
        + 'na ekranie, a ocena odpowiednio się chwieje.',
    'agents.unsupported.title': 'Niedostępne na tej platformie',
    'agents.unsupported.desc': 'Skrypt powiadomień jest w PowerShellu, więc działa tylko w Windows. '
        + 'Stan jest zgadywany na podstawie wyjścia.',

    'state.on': 'Połączono',
    'state.off': 'Nie połączono',
    'state.half': 'Połączone połowicznie',
    'btn.install': 'Zainstaluj',
    'btn.remove': 'Usuń',

    'claude.title': 'Integracja z Claude',
    'claude.desc': 'Sesje Claude Code pojawiają się w panelu bocznym ze swoim <b>stanem</b> '
        + '(pracuje · czeka na zatwierdzenie · gotowe) oraz <b>paskami modelu, konta i zużycia</b>. '
        + 'Instaluje razem haki i <code>statusLine</code> w <code>~/.claude/settings.json</code> '
        + 'i razem je usuwa. Innych haków nie rusza, a istniejącą już <code>statusLine</code> '
        + '<b>uruchamia bez zmian</b> — to, co tam widzisz, pozostaje takie samo. '
        + 'Przed zapisem obok pliku zostaje kopia zapasowa.',

    'codex.title': 'Integracja z Codex',
    'codex.desc': 'Sesje Codex pojawiają się w panelu bocznym ze swoim <b>stanem</b> '
        + '(pracuje · czeka na zatwierdzenie · gotowe · przerwane) oraz <b>paskami modelu, konta i zużycia</b>. '
        + 'Po instalacji otwórz Codex ponownie i przejrzyj oraz zatwierdź haki AgentDeck w <code>/hooks</code>.',

    'codex.disabled': 'Codex ma te haki wyłączone — dopóki ich nie włączysz, nic nie dociera: {events}. Otwórz Codex, uruchom <code>/hooks</code> i zatwierdź je.',

    'root.head': 'Profil katalogu roboczego',
    'root.intro': 'Tworzy profil, aby nowe karty zawsze otwierały się w tym samym katalogu. '
        + 'Zmiany działają po ponownym uruchomieniu Tabby.',
    'root.use.title': 'Używaj profilu katalogu roboczego',
    'root.use.desc': 'Włącz i podaj katalog — profil zostanie utworzony i stanie się domyślny.',
    'root.name.title': 'Nazwa profilu',
    'root.cwd.title': 'Katalog roboczy',
    'root.cwd.desc': 'Puste pole oznacza, że profil nie powstanie. Wpisując ręcznie, używaj ukośników '
        + '(np. D:/Project), aby ominąć pułapki z ucieczką odwrotnych ukośników.',
    'root.browse': 'Przeglądaj',
    'root.command.title': 'Polecenie',

    'diag.head': 'Zgłoś problem',
    'diag.intro': 'Zbiera dzienniki diagnostyczne <b>do jednego pliku zip</b> i otwiera katalog, w którym ląduje. '
        + 'Zawiera: wersje wtyczki i Tabby oraz system, ustawienia powyżej i dwie najnowsze generacje '
        + '<code>{path}</code>. W dziennikach są <b>tytuły kart i ścieżki, które otwierałeś</b> — '
        + 'przed wysłaniem możesz spokojnie otworzyć archiwum i sprawdzić.',
    'diag.screen.title': 'Dołącz surową zawartość ekranu',
    'diag.screen.desc': 'Włącz przy problemach z rysowaniem. Ekran terminala trafia tam dosłownie — '
        + 'widać w nim twoją pracę i kod — dlatego domyślnie jest wyłączone.',
    'diag.collect.title': 'Zbierz dzienniki',
    'diag.collect.desc': 'Wtyczka v{version}.',
    'diag.made': 'Utworzono: ',
    'diag.btn': 'Zbierz',

    'dev.head': 'Opcje dewelopera',
    'dev.use.title': 'Włącz opcje dewelopera',
    'dev.use.desc': 'Włącza <b>przeładowanie na żywo</b> — gdy <code>npm run build</code> nadpisze '
        + '<code>dist/index.js</code>, okno przeładuje się na nową wtyczkę <b>z zachowaniem sesji</b> '
        + '(karty podłączą się z powrotem do tego samego pty). Skrót <b>[dev] Przeładuj wtyczkę</b> '
        + 'również podlega temu przełącznikowi. Po wyłączeniu zmiana dist nic nie robi. '
        + 'Widoczne tylko przy instalacji z drzewa źródeł; wersja z npm tego nie ma.',
    'dev.now.title': 'Przeładuj teraz',
    'dev.now.desc': 'Przeładowuje bieżący dist bez budowania.',
    'dev.btn': 'Przeładuj',

    'footer': 'Reszta — proporcje okna, szerokość panelu bocznego, krycie, wykrywanie stanu, obsługa wejścia — '
        + 'jest przypięta do wartości domyślnych. Jeśli musisz coś zmienić, edytuj <code>agentDeck.*</code> '
        + 'bezpośrednio w pliku konfiguracyjnym. '
        + 'Skróty znajdziesz w zakładce <b>Skróty</b> jako <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Skróty',
    'keys.intro': 'Klawisze ze strony głównej. Naciśnij <b>Zmień</b>, a potem nowy klawisz. Jeśli jest już zajęty — przez samego Tabby albo AgentDeck — dowiesz się, <b>z czym koliduje</b>, i możesz wybrać inny albo go przejąć. Działa od razu.',
    'keys.change': 'Zmień',
    'keys.default': 'Domyślne',
    'keys.cancel': 'Anuluj',
    'keys.force': 'Użyj mimo to',
    'keys.press': 'Naciśnij nowy klawisz… (Esc anuluje)',
    'keys.conflict': 'Koliduje z {names}. Jeśli użyjesz mimo to, klawisz zostanie tam usunięty.',
    'keys.unbound': 'nieprzypisany',
    'keys.stock': 'wbudowany w Tabby',
    'keys.digit': 'Ten musi kończyć się cyfrą 1–9 — cyfra to numer sesji. Naciśnij np. Alt+1, a 2…9 pójdą za nim.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, prawy przycisk myszy oraz <code>Ctrl+F</code> / <code>Ctrl+S</code> w panelu nie są skrótami i tu się ich nie zmienia.',
    'keys.item.newtab': 'Nowa karta w katalogu roboczym',
    'keys.item.jump': 'Skocz do N-tej sesji',
    'keys.item.focus': 'Fokus na listę sesji / powrót do terminala',
    'keys.item.view': 'Otwórz / zamknij panel podglądu',
    'keys.item.repair': 'Napraw ekran',
    'keys.item.splitright': 'Podziel obok siebie (nowy panel po prawej)',
    'keys.item.splitbottom': 'Podziel góra / dół (nowy panel na dole)',
    'keys.item.closepane': 'Zamknij aktywny podzielony panel',
    'keys.item.newline': 'Nowa linia bez wysyłania',
    'keys.item.toggle': 'Pasek boczny / 4:3 wł-wył',
    'keys.item.viewmode': 'Panel: Pliki ↔ Zmiany',
}
