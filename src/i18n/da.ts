/** Dansk */
export default {
    'layout.title': 'Brug AgentDeck-layoutet',
    'layout.desc': 'Slå fra, så forsvinder sidepanelet og den faste bredde — Tabby ser ud som normalt igen.',

    'reset.title': 'Nulstil layoutet',
    'reset.desc': 'Sætter sidepanelet tilbage til udgangspunktet — dokket til højre, med bredden beregnet '
        + 'ud fra vinduets forhold.',
    'reset.now': 'Nu: dokket {dock}, {size}.',
    'reset.default': 'Lige nu er alt på standardindstillingerne.',
    'reset.btn': 'Nulstil',

    'dock.left': 'til venstre',
    'dock.right': 'til højre',
    'dock.top': 'øverst',
    'dock.bottom': 'nederst',
    'size.width': '{px} px bred',
    'size.height': '{px} px høj',
    'size.auto': 'automatisk bredde',

    'norecover.title': 'Gendan ikke faner ved opstart',
    'norecover.desc': 'Tabby starter tomt i stedet for at hente de gamle faner tilbage — det, der kommer tilbage, '
        + 'er alligevel kun skallen, og Claude-sessionen indeni er for længst slut. '
        + 'Slå fra for Tabbys oprindelige opførsel (<code>recoverTabs</code>). Gælder fra næste opstart.',

    'resume.title': 'Genoptag tidligere sessioner',
    'resume.desc': 'Tilføjer en skuffe <code>⟲ Tidligere sessioner</code> sidst i hver gruppe (foldet sammen '
        + 'som standard). Fold den ud, og <b>lukkede Claude Code- og Codex-sessioner</b> står der med den prompt, '
        + 'du faktisk skrev; et klik åbner samtalen igen med <code>claude --resume</code> eller '
        + '<code>codex resume</code> i dens egen arbejdsmappe. Det er den anden halvdel af '
        + '<b>Gendan ikke faner</b> ovenfor — den almindelige gendannelse henter skallen, denne henter samtalen. '
        + '<b>Servere og baggrundsprocesser, du havde kørende, kommer ikke tilbage.</b>',

    'agents.head': 'Agentintegration',
    'agents.intro': 'Lader hver agent <b>selv melde</b> sin tilstand, sin model og sine forbrugsgrænser. '
        + 'Det er den mest præcise kilde, sidepanelet har — uden den gætter vi ud fra teksten, der tegnes '
        + 'på skærmen, og aflæsningen bliver tilsvarende usikker.',
    'agents.unsupported.title': 'Ikke tilgængelig på denne platform',
    'agents.unsupported.desc': 'Notifikationsscriptet er PowerShell og kører derfor kun på Windows. '
        + 'Tilstanden gættes i stedet ud fra output.',

    'state.on': 'Forbundet',
    'state.off': 'Ikke forbundet',
    'state.half': 'Halvt forbundet',
    'btn.install': 'Installér',
    'btn.remove': 'Fjern',

    'claude.title': 'Claude-integration',
    'claude.desc': 'Claude Code-sessioner vises i sidepanelet med deres <b>tilstand</b> '
        + '(arbejder · venter på godkendelse · færdig) og <b>bjælker for model, konto og forbrug</b>. '
        + 'Installerer hooks og <code>statusLine</code> i <code>~/.claude/settings.json</code> samlet '
        + 'og fjerner dem samlet. Andre hooks røres ikke, og en <code>statusLine</code>, du allerede havde, '
        + 'køres <b>præcis som den er</b> — det, du ser der, ændrer sig ikke. '
        + 'Der skrives en sikkerhedskopi ved siden af filen først.',

    'codex.title': 'Codex-integration',
    'codex.desc': 'Codex-sessioner vises i sidepanelet med deres <b>tilstand</b> '
        + '(arbejder · venter på godkendelse · færdig · afbrudt) og <b>bjælker for model, konto og forbrug</b>. '
        + 'Åbn Codex igen efter installationen, og gennemgå og godkend AgentDeck-hooks under <code>/hooks</code>.',

    'codex.disabled': 'Codex har slået disse hooks fra — der kommer intet, før du slår dem til: {events}. Åbn Codex, kør <code>/hooks</code>, og godkend dem.',

    'root.head': 'Profil til arbejdsmappe',
    'root.intro': 'Opretter en profil, så nye faner altid åbner i den samme mappe. '
        + 'Ændringer træder i kraft efter en genstart af Tabby.',
    'root.use.title': 'Brug en profil til arbejdsmappen',
    'root.use.desc': 'Slå til og udfyld mappen — profilen oprettes og bliver standard.',
    'root.name.title': 'Profilnavn',
    'root.cwd.title': 'Arbejdsmappe',
    'root.cwd.desc': 'Lader du feltet stå tomt, oprettes der ingen profil. Skriver du det i hånden, så brug '
        + 'skråstreger (f.eks. D:/Project) for at undgå fælderne med omvendte skråstreger.',
    'root.browse': 'Gennemse',
    'root.command.title': 'Kommando',

    'diag.head': 'Rapportér et problem',
    'diag.intro': 'Samler diagnostikloggene i <b>én enkelt zip</b> og åbner mappen, den havner i. '
        + 'Den indeholder: versioner af pluginnet og Tabby samt styresystem, indstillingerne ovenfor '
        + 'og de to nyeste generationer af <code>{path}</code>. Loggene indeholder <b>fanetitler og de stier, '
        + 'du har åbnet</b> — du må gerne åbne zipfilen og tjekke, før du sender den.',
    'diag.screen.title': 'Tag også den rå skærm med',
    'diag.screen.desc': 'Slå til ved problemer med optegningen. Terminalskærmen kommer med ordret — '
        + 'dit arbejde og din kode kan læses i den — derfor er det slået fra som standard.',
    'diag.collect.title': 'Saml loggene',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Oprettet: ',
    'diag.btn': 'Saml',

    'dev.head': 'Udviklerindstillinger',
    'dev.use.title': 'Aktivér udviklerindstillinger',
    'dev.use.desc': 'Slår <b>live-genindlæsning</b> til — når <code>npm run build</code> skriver '
        + '<code>dist/index.js</code> om, genindlæses vinduet til det nye plugin <b>med sessionerne i behold</b> '
        + '(fanerne kobles tilbage til den samme pty). Genvejen <b>[dev] Genindlæs plugin</b> følger også '
        + 'denne kontakt. Er den slået fra, sker der ingenting, selv om dist ændres. '
        + 'Vises kun ved installation fra kildetræet; npm-bygget har ikke dette.',
    'dev.now.title': 'Genindlæs nu',
    'dev.now.desc': 'Genindlæser den nuværende dist uden at bygge.',
    'dev.btn': 'Genindlæs',

    'footer': 'Resten — vinduesforhold, sidepanelets bredde, uigennemsigtighed, tilstandsregistrering, '
        + 'inputhåndtering — er låst til standardværdierne. Skal noget ændres, så redigér '
        + '<code>agentDeck.*</code> direkte i konfigurationsfilen. '
        + 'Genveje findes under fanen <b>Genveje</b> som <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Genveje',
    'keys.intro': 'Tasterne fra forsiden. Tryk <b>Skift</b> og derefter den nye tast. Er den allerede i brug — af Tabby selv eller af AgentDeck — får du at vide, <b>hvad den støder sammen med</b>, og kan vælge om eller overtage tasten. Gælder straks.',
    'keys.change': 'Skift',
    'keys.default': 'Standard',
    'keys.cancel': 'Annuller',
    'keys.force': 'Brug den alligevel',
    'keys.press': 'Tryk på den nye tast… (Esc annullerer)',
    'keys.conflict': 'Støder sammen med {names}. Bruger du den alligevel, fjernes tasten dér.',
    'keys.unbound': 'ikke tildelt',
    'keys.stock': 'Tabbys egen',
    'keys.digit': 'Denne skal ende på et tal 1–9 — tallet er sessionsnummeret. Tryk fx Alt+1, så følger 2…9 med.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, højreklik og panelets <code>Ctrl+F</code> / <code>Ctrl+S</code> er ikke genvejstaster og ændres ikke her.',
    'keys.item.newtab': 'Nyt faneblad i arbejdsroden',
    'keys.item.jump': 'Spring til session nr. N',
    'keys.item.focus': 'Fokus på sessionslisten / tilbage til terminalen',
    'keys.item.view': 'Åbn / luk forhåndsvisningspanelet',
    'keys.item.repair': 'Reparér skærmen',
    'keys.item.splitright': 'Del side om side (ny rude til højre)',
    'keys.item.splitbottom': 'Del over / under (ny rude nedenunder)',
    'keys.item.closepane': 'Luk den aktive delte rude',
    'keys.item.newline': 'Linjeskift uden at sende',
    'keys.item.toggle': 'Sidebjælke / 4:3 til-fra',
    'keys.item.viewmode': 'Panel: Filer ↔ Ændringer',
}
