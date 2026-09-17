/** Svenska */
export default {
    'layout.title': 'Använd AgentDecks layout',
    'layout.desc': 'Stäng av så försvinner sidopanelen och den fasta bredden — Tabby ser ut som vanligt igen.',

    'reset.title': 'Återställ layouten',
    'reset.desc': 'Sätter tillbaka sidopanelen till utgångsläget — dockad till höger, med bredden uträknad '
        + 'ur fönstrets proportioner.',
    'reset.now': 'Nu: dockad {dock}, {size}.',
    'reset.default': 'Just nu är allt i standardläge.',
    'reset.btn': 'Återställ',

    'dock.left': 'till vänster',
    'dock.right': 'till höger',
    'dock.top': 'upptill',
    'dock.bottom': 'nedtill',
    'size.width': '{px} px bred',
    'size.height': '{px} px hög',
    'size.auto': 'automatisk bredd',

    'norecover.title': 'Återställ inte flikar vid start',
    'norecover.desc': 'Tabby startar tomt i stället för att ta tillbaka de gamla flikarna — det som kommer '
        + 'tillbaka är ändå bara skalet, och Claude-sessionen som fanns i det är sedan länge slut. '
        + 'Stäng av för Tabbys ursprungliga beteende (<code>recoverTabs</code>). Gäller från nästa start.',

    'resume.title': 'Återuppta tidigare sessioner',
    'resume.desc': 'Lägger till en låda <code>⟲ Tidigare sessioner</code> sist i varje grupp (hopfälld som standard). '
        + 'Fäll ut den så listas <b>stängda Claude Code- och Codex-sessioner</b> med den prompt du faktiskt skrev; '
        + 'ett klick öppnar samtalet igen med <code>claude --resume</code> eller <code>codex resume</code> '
        + 'i dess egen arbetsmapp. Det är andra halvan av <b>Återställ inte flikar</b> ovan — '
        + 'den vanliga återställningen tar tillbaka skalet, den här tar tillbaka samtalet. '
        + '<b>Servrar och bakgrundsprocesser du hade igång kommer inte tillbaka.</b>',

    'agents.head': 'Agentintegration',
    'agents.intro': 'Låter varje agent <b>själv rapportera</b> sitt tillstånd, sin modell och sina gränser. '
        + 'Det är den mest tillförlitliga källan sidopanelen har — utan den gissar vi utifrån texten '
        + 'som ritas på skärmen, och avläsningen blir därefter vinglig.',
    'agents.unsupported.title': 'Inte tillgängligt på den här plattformen',
    'agents.unsupported.desc': 'Aviseringsskriptet är PowerShell och körs därför bara i Windows. '
        + 'Tillståndet gissas i stället utifrån utdata.',

    'state.on': 'Ansluten',
    'state.off': 'Inte ansluten',
    'state.half': 'Halvt ansluten',
    'btn.install': 'Installera',
    'btn.remove': 'Ta bort',

    'claude.title': 'Claude-integration',
    'claude.desc': 'Claude Code-sessioner syns i sidopanelen med sitt <b>tillstånd</b> '
        + '(arbetar · väntar på godkännande · klart) och <b>staplar för modell, konto och förbrukning</b>. '
        + 'Installerar krokarna och <code>statusLine</code> i <code>~/.claude/settings.json</code> tillsammans, '
        + 'och tar bort dem tillsammans. Andra krokar rörs inte, och en <code>statusLine</code> du redan hade '
        + 'körs <b>precis som den är</b> — det du ser där ändras inte. '
        + 'En säkerhetskopia skrivs bredvid filen först.',

    'codex.title': 'Codex-integration',
    'codex.desc': 'Codex-sessioner syns i sidopanelen med sitt <b>tillstånd</b> '
        + '(arbetar · väntar på godkännande · klart · avbrutet) och <b>staplar för modell, konto '
        + 'och förbrukning</b>. Öppna Codex igen efter installationen och granska och godkänn '
        + 'AgentDecks krokar under <code>/hooks</code>.',

    'codex.disabled': 'Codex har stängt av dessa krokar — inget kommer fram förrän du slår på dem: {events}. Öppna Codex, kör <code>/hooks</code> och godkänn dem.',

    'root.head': 'Profil för arbetsmapp',
    'root.intro': 'Skapar en profil så att nya flikar alltid öppnas i samma mapp. '
        + 'Ändringar gäller efter omstart av Tabby.',
    'root.use.title': 'Använd en profil för arbetsmapp',
    'root.use.desc': 'Slå på och fyll i mappen — profilen skapas och blir standard.',
    'root.name.title': 'Profilnamn',
    'root.cwd.title': 'Arbetsmapp',
    'root.cwd.desc': 'Lämnar du det tomt skapas ingen profil. Skriver du för hand, använd snedstreck '
        + '(t.ex. D:/Project) för att undvika fällorna med omvända snedstreck.',
    'root.browse': 'Bläddra',
    'root.command.title': 'Kommando',

    'diag.head': 'Rapportera ett problem',
    'diag.intro': 'Samlar diagnostikloggarna i <b>en enda zip</b> och öppnar mappen där den hamnar. '
        + 'Den innehåller: versioner av insticksmodulen och Tabby samt operativsystem, inställningarna ovan '
        + 'och de två senaste generationerna av <code>{path}</code>. Loggarna innehåller <b>flikrubriker '
        + 'och de sökvägar du öppnat</b> — öppna gärna zipfilen och kontrollera innan du skickar den.',
    'diag.screen.title': 'Ta med råa skärminnehållet',
    'diag.screen.desc': 'Slå på vid ritproblem. Terminalskärmen följer med ordagrant — ditt arbete och '
        + 'din kod syns i den — därför är det avstängt som standard.',
    'diag.collect.title': 'Samla loggarna',
    'diag.collect.desc': 'Insticksmodul v{version}.',
    'diag.made': 'Skapad: ',
    'diag.btn': 'Samla',

    'dev.head': 'Utvecklaralternativ',
    'dev.use.title': 'Aktivera utvecklaralternativ',
    'dev.use.desc': 'Slår på <b>direktomladdning</b> — när <code>npm run build</code> skriver om '
        + '<code>dist/index.js</code> laddas fönstret om till den nya insticksmodulen <b>med sessionerna '
        + 'i behåll</b> (flikarna kopplas tillbaka till samma pty). Snabbtangenten <b>[dev] Ladda om '
        + 'insticksmodulen</b> följer också den här brytaren. Med den av händer ingenting när dist ändras. '
        + 'Visas bara vid installation från källträdet; npm-bygget har inte det här.',
    'dev.now.title': 'Ladda om nu',
    'dev.now.desc': 'Laddar om nuvarande dist utan att bygga.',
    'dev.btn': 'Ladda om',

    'footer': 'Resten — fönsterproportion, sidopanelens bredd, opacitet, tillståndsdetektering, '
        + 'indatahantering — är låst till standardvärdena. Behöver du ändra något, redigera '
        + '<code>agentDeck.*</code> direkt i konfigurationsfilen. '
        + 'Snabbtangenterna finns under fliken <b>Snabbtangenter</b> som <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Snabbtangenter',
    'keys.intro': 'Tangenterna från startsidan. Tryck <b>Ändra</b> och sedan den nya tangenten. Är den redan upptagen — av Tabby självt eller av AgentDeck — får du veta <b>vad den krockar med</b> och kan välja om eller ta över den. Gäller direkt.',
    'keys.change': 'Ändra',
    'keys.default': 'Standard',
    'keys.cancel': 'Avbryt',
    'keys.force': 'Använd ändå',
    'keys.press': 'Tryck på den nya tangenten… (Esc avbryter)',
    'keys.conflict': 'Krockar med {names}. Använder du den ändå tas tangenten bort där.',
    'keys.unbound': 'ej tilldelad',
    'keys.stock': 'Tabbys egen',
    'keys.digit': 'Den här måste sluta på en siffra 1–9 — siffran är sessionsnumret. Tryck t.ex. Alt+1 så följer 2…9 med.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, högerklick och panelens <code>Ctrl+F</code> / <code>Ctrl+S</code> är inte snabbtangenter och ändras inte här.',
    'keys.item.newtab': 'Ny flik i arbetsroten',
    'keys.item.jump': 'Hoppa till session N',
    'keys.item.focus': 'Fokus på sessionslistan / tillbaka till terminalen',
    'keys.item.view': 'Öppna / stäng förhandsvisningspanelen',
    'keys.item.repair': 'Reparera skärmen',
    'keys.item.splitright': 'Dela sida vid sida (ny ruta till höger)',
    'keys.item.splitbottom': 'Dela över / under (ny ruta nedanför)',
    'keys.item.closepane': 'Stäng den aktiva delade rutan',
    'keys.item.newline': 'Radbrytning utan att skicka',
    'keys.item.toggle': 'Sidopanel / 4:3 på-av',
    'keys.item.viewmode': 'Panel: Filer ↔ Ändringar',
}
