/** Hrvatski */
export default {
    'layout.title': 'Koristi AgentDeck raspored',
    'layout.desc': 'Isključite pa nestaju bočna traka i fiksna širina — Tabby se vraća na izvorni izgled.',

    'reset.title': 'Vrati raspored na početno',
    'reset.desc': 'Vraća bočnu traku u početno stanje — usidrena desno, sa širinom izračunatom iz omjera prozora.',
    'reset.now': 'Sada: usidrena {dock}, {size}.',
    'reset.default': 'Trenutačno je sve na zadanim vrijednostima.',
    'reset.btn': 'Vrati na početno',

    'dock.left': 'lijevo',
    'dock.right': 'desno',
    'dock.top': 'gore',
    'dock.bottom': 'dolje',
    'size.width': 'širina {px} px',
    'size.height': 'visina {px} px',
    'size.auto': 'širina automatski',

    'norecover.title': 'Ne vraćaj kartice pri pokretanju',
    'norecover.desc': 'Tabby se pokreće prazan umjesto da vraća prijašnje kartice — ionako se vraća samo ljuska, '
        + 'a Claude sesija koja je bila u njoj odavno je gotova. '
        + 'Isključite za izvorno ponašanje (<code>recoverTabs</code>). Vrijedi od sljedećeg pokretanja.',

    'resume.title': 'Nastavi prijašnje sesije',
    'resume.desc': 'Dodaje ladicu <code>⟲ Prijašnje sesije</code> na kraj svake grupe (zadano sklopljenu). '
        + 'Kad je otvorite, u njoj su <b>zatvorene sesije Claude Codea i Codexa</b> označene promptom koji '
        + 'ste doista upisali; klikom se razgovor vraća naredbom <code>claude --resume</code> ili '
        + '<code>codex resume</code> u vlastitoj radnoj mapi. To je druga polovica opcije '
        + '<b>Ne vraćaj kartice</b> iznad — izvorno vraćanje vrati ljusku, ovo vrati razgovor. '
        + '<b>Poslužitelji i pozadinski procesi koje ste tada imali pokrenute ne vraćaju se.</b>',

    'agents.head': 'Povezivanje agenata',
    'agents.intro': 'Omogućuje da svaki agent <b>sam javlja</b> svoje stanje, model i ograničenja potrošnje. '
        + 'To je najtočniji izvor koji bočna traka ima — bez toga nagađamo iz teksta iscrtanog na zaslonu, '
        + 'pa očitanje odgovarajuće varira.',
    'agents.unsupported.title': 'Nije dostupno na ovoj platformi',
    'agents.unsupported.desc': 'Skripta za obavijesti pisana je u PowerShellu pa radi samo na Windowsima. '
        + 'Stanje se umjesto toga nagađa iz ispisa.',

    'state.on': 'Povezano',
    'state.off': 'Nije povezano',
    'state.half': 'Napola povezano',
    'btn.install': 'Instaliraj',
    'btn.remove': 'Ukloni',

    'claude.title': 'Povezivanje s Claudeom',
    'claude.desc': 'Sesije Claude Codea pojavljuju se u bočnoj traci sa svojim <b>stanjem</b> '
        + '(radi · čeka odobrenje · gotovo) i <b>trakama modela, računa i potrošnje</b>. '
        + 'Kuke i <code>statusLine</code> u <code>~/.claude/settings.json</code> postavljaju se zajedno '
        + 'i zajedno uklanjaju. Ostale kuke ne diramo, a <code>statusLine</code> koji ste već imali '
        + '<b>izvodi se nepromijenjen</b> — ono što ondje vidite ostaje isto. '
        + 'Prije zapisivanja uz datoteku se ostavlja sigurnosna kopija.',

    'codex.title': 'Povezivanje s Codexom',
    'codex.desc': 'Sesije Codexa pojavljuju se u bočnoj traci sa svojim <b>stanjem</b> '
        + '(radi · čeka odobrenje · gotovo · prekinuto) i <b>trakama modela, računa i potrošnje</b>. '
        + 'Nakon instalacije ponovno otvorite Codex te pregledajte i odobrite AgentDeck kuke '
        + 'pod <code>/hooks</code>.',

    'codex.disabled': 'Codex je isključio ove kuke — dok ih ne uključiš, ništa ne stiže: {events}. Otvori Codex, pokreni <code>/hooks</code> i odobri ih.',

    'root.head': 'Profil radne mape',
    'root.intro': 'Stvara profil kako bi se nove kartice uvijek otvarale u istoj mapi. '
        + 'Promjene vrijede nakon ponovnog pokretanja Tabbyja.',
    'root.use.title': 'Koristi profil radne mape',
    'root.use.desc': 'Uključite i upišite mapu — profil se stvara i postaje zadani.',
    'root.name.title': 'Naziv profila',
    'root.cwd.title': 'Radna mapa',
    'root.cwd.desc': 'Ostavite li prazno, profil se ne stvara. Kad upisujete ručno, koristite kose crte '
        + '(npr. D:/Project) da izbjegnete zamke s izbjegavanjem obrnutih kosih crta.',
    'root.browse': 'Pregledaj',
    'root.command.title': 'Naredba',

    'diag.head': 'Prijavi problem',
    'diag.intro': 'Skuplja dijagnostičke zapise u <b>jedan zip</b> i otvara mapu u kojoj završi. '
        + 'Sadrži: verzije dodatka i Tabbyja te operativni sustav, postavke iznad i dva najnovija naraštaja '
        + 'datoteke <code>{path}</code>. U zapisima su <b>naslovi kartica i putanje koje ste otvarali</b> — '
        + 'slobodno otvorite zip i provjerite prije slanja.',
    'diag.screen.title': 'Uključi i sirovi sadržaj zaslona',
    'diag.screen.desc': 'Uključite kod problema s iscrtavanjem. Zaslon terminala ulazi doslovno — '
        + 'u njemu se vide vaš rad i kod — pa je zadano isključeno.',
    'diag.collect.title': 'Skupi zapise',
    'diag.collect.desc': 'Dodatak v{version}.',
    'diag.made': 'Stvoreno: ',
    'diag.btn': 'Skupi',

    'dev.head': 'Razvojne mogućnosti',
    'dev.use.title': 'Uključi razvojne mogućnosti',
    'dev.use.desc': 'Uključuje <b>ponovno učitavanje uživo</b> — čim <code>npm run build</code> prepiše '
        + '<code>dist/index.js</code>, prozor se ponovno učita na novi dodatak <b>uz očuvane sesije</b> '
        + '(kartice se ponovno vežu na isti pty). Prečac <b>[dev] Ponovno učitaj dodatak</b> također slijedi '
        + 'ovaj prekidač. Kad je isključeno, promjena dist mape ne radi ništa. '
        + 'Vidljivo samo kod instalacije iz izvornog stabla; npm izdanje ovo nema.',
    'dev.now.title': 'Učitaj ponovno sada',
    'dev.now.desc': 'Ponovno učitava trenutačni dist bez izgradnje.',
    'dev.btn': 'Učitaj ponovno',

    'footer': 'Ostalo — omjer prozora, širina bočne trake, prozirnost, otkrivanje stanja, obrada unosa — '
        + 'fiksirano je na zadane vrijednosti. Treba li što promijeniti, uredite <code>agentDeck.*</code> '
        + 'izravno u konfiguracijskoj datoteci. '
        + 'Prečaci su na kartici <b>Prečaci</b> pod <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Prečaci',
    'keys.intro': 'Tipke s naslovne stranice. Pritisnite <b>Promijeni</b>, zatim novu tipku. Ako je već zauzeta — od samog Tabbyja ili AgentDecka — bit će vam rečeno <b>s čime se sudara</b> i možete birati ponovno ili je preuzeti. Vrijedi odmah.',
    'keys.change': 'Promijeni',
    'keys.default': 'Zadano',
    'keys.cancel': 'Odustani',
    'keys.force': 'Svejedno koristi',
    'keys.press': 'Pritisnite novu tipku… (Esc odustaje)',
    'keys.conflict': 'Sudara se s {names}. Ako je svejedno koristite, tipka se ondje uklanja.',
    'keys.unbound': 'nije dodijeljeno',
    'keys.stock': 'ugrađeno u Tabby',
    'keys.digit': 'Ovo mora završavati znamenkom 1–9 — znamenka je broj sesije. Pritisnite npr. Alt+1 i 2…9 slijede.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, desni klik i <code>Ctrl+F</code> / <code>Ctrl+S</code> u panelu nisu prečaci i ovdje se ne mijenjaju.',
    'keys.item.newtab': 'Nova kartica u radnom korijenu',
    'keys.item.jump': 'Skoči na N-tu sesiju',
    'keys.item.focus': 'Fokus na popis sesija / natrag u terminal',
    'keys.item.view': 'Otvori / zatvori ploču pretpregleda',
    'keys.item.repair': 'Popravi zaslon',
    'keys.item.splitright': 'Podijeli jedno uz drugo (novo okno desno)',
    'keys.item.splitbottom': 'Podijeli gore / dolje (novo okno dolje)',
    'keys.item.closepane': 'Zatvori aktivno podijeljeno okno',
    'keys.item.newline': 'Novi red bez slanja',
    'keys.item.toggle': 'Bočna traka / 4:3 uklj-isklj',
    'keys.item.viewmode': 'Ploča: Datoteke ↔ Promjene',
}
