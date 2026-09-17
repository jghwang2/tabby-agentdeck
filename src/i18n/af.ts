/** Afrikaans */
export default {
    'layout.title': 'Gebruik die AgentDeck-uitleg',
    'layout.desc': 'Skakel af om die sybalk en die vaste breedte te verwyder en na gewone Tabby terug te keer.',

    'reset.title': 'Stel die uitleg terug',
    'reset.desc': 'Sit die sybalk terug in sy aanvanklike toestand — regs vasgeheg, met die breedte '
        + 'bereken uit die vensterverhouding.',
    'reset.now': 'Nou: {dock} vasgeheg, {size}.',
    'reset.default': 'Op die oomblik is alles op die verstekwaardes.',
    'reset.btn': 'Stel terug',

    'dock.left': 'links',
    'dock.right': 'regs',
    'dock.top': 'bo',
    'dock.bottom': 'onder',
    'size.width': '{px} px breed',
    'size.height': '{px} px hoog',
    'size.auto': 'breedte outomaties',

    'norecover.title': 'Moenie oortjies met begin herstel nie',
    'norecover.desc': 'Tabby begin leeg in plaas daarvan om die ou oortjies terug te bring — al wat terugkom, '
        + 'is in elk geval net die dop, en die Claude-sessie daarbinne is lankal verby. '
        + 'Skakel af vir Tabby se oorspronklike gedrag (<code>recoverTabs</code>). Geld vanaf die volgende begin.',

    'resume.title': 'Hervat vorige sessies',
    'resume.desc': 'Voeg ’n laai <code>⟲ Vorige sessies</code> aan die einde van elke groep by (by verstek toegevou). '
        + 'Vou dit oop en <b>geslote Claude Code- en Codex-sessies</b> word gelys met die opdrag wat jy werklik '
        + 'getik het; een klik bring die gesprek terug met <code>claude --resume</code> of '
        + '<code>codex resume</code> in sy eie werkvouer. Dit is die ander helfte van '
        + '<b>Moenie oortjies herstel nie</b> hierbo — die gewone herstel bring die dop terug, dit bring '
        + 'die gesprek terug. '
        + '<b>Bedieners en agtergrondprosesse wat toe geloop het, kom nie terug nie.</b>',

    'agents.head': 'Agent-integrasie',
    'agents.intro': 'Laat elke agent sy eie toestand, model en gebruikslimiete <b>self aanmeld</b>. '
        + 'Dit is die akkuraatste bron wat die sybalk het — daarsonder raai ons uit die teks wat op die skerm '
        + 'geteken word, en die aflees wikkel navenant.',
    'agents.unsupported.title': 'Nie op hierdie platform beskikbaar nie',
    'agents.unsupported.desc': 'Die kennisgewingskrip is PowerShell en loop dus net op Windows. '
        + 'Die toestand word eerder uit die afvoer geraai.',

    'state.on': 'Gekoppel',
    'state.off': 'Nie gekoppel nie',
    'state.half': 'Half gekoppel',
    'btn.install': 'Installeer',
    'btn.remove': 'Verwyder',

    'claude.title': 'Claude-integrasie',
    'claude.desc': 'Claude Code-sessies verskyn in die sybalk met hul <b>toestand</b> '
        + '(besig · wag vir goedkeuring · klaar) en <b>stawe vir model, rekening en verbruik</b>. '
        + 'Installeer die hake en die <code>statusLine</code> in <code>~/.claude/settings.json</code> saam, '
        + 'en verwyder hulle saam. Ander hake word nie geraak nie, en ’n <code>statusLine</code> wat jy reeds '
        + 'gehad het, word <b>net so uitgevoer</b> — wat jy daar sien, verander nie. '
        + '’n Rugsteun word eers langs die lêer geskryf.',

    'codex.title': 'Codex-integrasie',
    'codex.desc': 'Codex-sessies verskyn in die sybalk met hul <b>toestand</b> '
        + '(besig · wag vir goedkeuring · klaar · onderbreek) en <b>stawe vir model, rekening en verbruik</b>. '
        + 'Maak Codex ná die installasie weer oop en gaan die AgentDeck-hake onder <code>/hooks</code> na '
        + 'en vertrou hulle.',

    'codex.disabled': 'Codex het hierdie hake afgeskakel — niks kom deur voordat jy hulle aanskakel nie: {events}. Maak Codex oop, voer <code>/hooks</code> uit en vertrou hulle.',

    'root.head': 'Profiel vir die werkvouer',
    'root.intro': 'Skep ’n profiel sodat nuwe oortjies altyd in dieselfde vouer oopmaak. '
        + 'Veranderinge geld ná Tabby herbegin word.',
    'root.use.title': 'Gebruik ’n profiel vir die werkvouer',
    'root.use.desc': 'Skakel aan en vul die vouer in — die profiel word geskep en word die verstek.',
    'root.name.title': 'Profielnaam',
    'root.cwd.title': 'Werkvouer',
    'root.cwd.desc': 'Laat dit leeg en geen profiel word geskep nie. Gebruik skuinsstrepe wanneer jy dit '
        + 'met die hand tik (bv. D:/Project) om die slaggate met terugskuinsstrepe te vermy.',
    'root.browse': 'Blaai',
    'root.command.title': 'Opdrag',

    'diag.head': 'Meld ’n probleem aan',
    'diag.intro': 'Versamel die diagnostiese logs in <b>een enkele zip</b> en maak die vouer oop waar dit beland. '
        + 'Dit bevat: die weergawes van die inprop en Tabby en die bedryfstelsel, die instellings hierbo, '
        + 'en die twee jongste geslagte van <code>{path}</code>. Die logs sluit <b>oortjietitels en die paaie '
        + 'wat jy oopgemaak het</b> in — maak die zip gerus oop en kyk voordat jy dit stuur.',
    'diag.screen.title': 'Sluit die rou skerm ook in',
    'diag.screen.desc': 'Skakel aan vir probleme met die teken van die skerm. Die terminaalskerm gaan woordeliks '
        + 'in — jou werk en jou kode is daarin leesbaar — daarom is dit by verstek af.',
    'diag.collect.title': 'Versamel die logs',
    'diag.collect.desc': 'Inprop v{version}.',
    'diag.made': 'Geskep: ',
    'diag.btn': 'Versamel',

    'dev.head': 'Ontwikkelaaropsies',
    'dev.use.title': 'Aktiveer ontwikkelaaropsies',
    'dev.use.desc': 'Skakel <b>lewendige herlaai</b> aan — sodra <code>npm run build</code> '
        + '<code>dist/index.js</code> oorskryf, herlaai die venster na die nuwe inprop <b>met jou sessies '
        + 'ongeskonde</b> (die oortjies koppel weer aan dieselfde pty). Die kortpad <b>[dev] Herlaai inprop</b> '
        + 'volg ook hierdie skakelaar. Is dit af, doen ’n veranderde dist niks nie. '
        + 'Wys net by installasies uit die bronboom; die npm-bou het dit nie.',
    'dev.now.title': 'Herlaai nou',
    'dev.now.desc': 'Herlaai die huidige dist sonder om te bou.',
    'dev.btn': 'Herlaai',

    'footer': 'Die res — vensterverhouding, breedte van die sybalk, ondeursigtigheid, toestandbespeuring, '
        + 'invoerhantering — is op die verstekwaardes vasgepen. Moet jy een verander, wysig '
        + '<code>agentDeck.*</code> direk in die konfigurasielêer. '
        + 'Kortpaaie is onder die <b>Kortpaaie</b>-oortjie as <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Kortpaaie',
    'keys.intro': 'Die sleutels van die voorblad. Druk <b>Verander</b>, dan die nuwe sleutel. As dit reeds gebruik word — deur Tabby self of deur AgentDeck — word gesê <b>waarmee dit bots</b>, en jy kan weer kies of die sleutel oorneem. Geld dadelik.',
    'keys.change': 'Verander',
    'keys.default': 'Verstek',
    'keys.cancel': 'Kanselleer',
    'keys.force': 'Gebruik dit in elk geval',
    'keys.press': 'Druk die nuwe sleutel… (Esc kanselleer)',
    'keys.conflict': 'Bots met {names}. Gebruik jy dit in elk geval, word die sleutel daar verwyder.',
    'keys.unbound': 'nie toegeken',
    'keys.stock': 'Tabby se eie',
    'keys.digit': 'Hierdie een moet op \'n syfer 1–9 eindig — die syfer is die sessienommer. Druk bv. Alt+1 en 2…9 volg.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, regsklik en die paneel se <code>Ctrl+F</code> / <code>Ctrl+S</code> is nie kortpaaie nie en word nie hier verander nie.',
    'keys.item.newtab': 'Nuwe oortjie in die werkwortel',
    'keys.item.jump': 'Spring na die N-de sessie',
    'keys.item.focus': 'Fokus op die sessielys / terug na die terminaal',
    'keys.item.view': 'Maak die voorskoupaneel oop / toe',
    'keys.item.repair': 'Herstel die skerm',
    'keys.item.splitright': 'Deel langs mekaar (nuwe paneel regs)',
    'keys.item.splitbottom': 'Deel bo / onder (nuwe paneel onder)',
    'keys.item.closepane': 'Maak die aktiewe verdeelde paneel toe',
    'keys.item.newline': 'Nuwe reël sonder om te stuur',
    'keys.item.toggle': 'Kantbalk / 4:3 aan-af',
    'keys.item.viewmode': 'Paneel: Lêers ↔ Veranderinge',
}
