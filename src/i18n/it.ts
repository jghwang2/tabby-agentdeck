/** Italiano */
export default {
    'layout.title': 'Usa il layout di AgentDeck',
    'layout.desc': 'Disattivandolo spariscono la barra laterale e la larghezza fissa: si torna a Tabby originale.',

    'reset.title': 'Reimposta il layout',
    'reset.desc': 'Riporta la barra laterale allo stato iniziale — agganciata a destra, con la larghezza '
        + 'calcolata dalle proporzioni della finestra.',
    'reset.now': 'Adesso: agganciata a {dock}, {size}.',
    'reset.default': 'Al momento è tutto ai valori predefiniti.',
    'reset.btn': 'Reimposta',

    'dock.left': 'sinistra',
    'dock.right': 'destra',
    'dock.top': 'in alto',
    'dock.bottom': 'in basso',
    'size.width': '{px} px di larghezza',
    'size.height': '{px} px di altezza',
    'size.auto': 'larghezza automatica',

    'norecover.title': 'Non ripristinare le schede all’avvio',
    'norecover.desc': 'Tabby parte vuoto invece di riportare indietro le vecchie schede: quello che torna '
        + 'è solo la shell, e la sessione di Claude che conteneva è finita da un pezzo. '
        + 'Disattiva per il comportamento originale (<code>recoverTabs</code>). Vale dal prossimo avvio.',

    'resume.title': 'Riprendi le sessioni passate',
    'resume.desc': 'Aggiunge un cassetto <code>⟲ Sessioni passate</code> in fondo a ogni gruppo (chiuso per '
        + 'impostazione predefinita). Aprendolo compaiono le <b>sessioni chiuse di Claude Code e Codex</b> '
        + 'elencate con il prompt che avevi davvero scritto; un clic riapre la conversazione con '
        + '<code>claude --resume</code> o <code>codex resume</code> nella sua cartella di lavoro. '
        + 'È l’altra metà di <b>Non ripristinare le schede</b> qui sopra: il ripristino originale riporta '
        + 'la shell, questo riporta la conversazione. '
        + '<b>I server e i processi in background che avevi avviato non tornano.</b>',

    'agents.head': 'Integrazione degli agenti',
    'agents.intro': 'Fa in modo che ogni agente <b>comunichi da sé</b> il proprio stato, il modello e i limiti d’uso. '
        + 'È la fonte più precisa di cui dispone la barra laterale: senza, si tira a indovinare dal testo '
        + 'disegnato a schermo, e la lettura traballa di conseguenza.',
    'agents.unsupported.title': 'Non disponibile su questa piattaforma',
    'agents.unsupported.desc': 'Lo script di notifica è in PowerShell, quindi gira solo su Windows. '
        + 'Lo stato viene dedotto dall’output.',

    'state.on': 'Collegato',
    'state.off': 'Non collegato',
    'state.half': 'Collegato a metà',
    'btn.install': 'Installa',
    'btn.remove': 'Rimuovi',

    'claude.title': 'Integrazione con Claude',
    'claude.desc': 'Le sessioni di Claude Code compaiono nella barra laterale con il loro <b>stato</b> '
        + '(al lavoro · in attesa di approvazione · finito) e le <b>barre di modello, account e consumo</b>. '
        + 'Installa insieme gli hook e la <code>statusLine</code> in <code>~/.claude/settings.json</code>, '
        + 'e li rimuove insieme. Gli altri hook non vengono toccati, e una <code>statusLine</code> che avevi già '
        + 'viene <b>eseguita così com’è</b>: quello che vedi lì non cambia. '
        + 'Prima di scrivere viene lasciato un backup nella stessa cartella.',

    'codex.title': 'Integrazione con Codex',
    'codex.desc': 'Le sessioni di Codex compaiono nella barra laterale con il loro <b>stato</b> '
        + '(al lavoro · in attesa di approvazione · finito · interrotto) e le <b>barre di modello, '
        + 'account e consumo</b>. Dopo l’installazione riapri Codex e rivedi e autorizza gli hook '
        + 'di AgentDeck in <code>/hooks</code>.',

    'codex.disabled': 'Codex ha questi hook disattivati: finché non li attivi non arriva nulla: {events}. Apri Codex, esegui <code>/hooks</code> e autorizzali.',

    'root.head': 'Profilo della cartella di lavoro',
    'root.intro': 'Crea un profilo perché le nuove schede si aprano sempre nella stessa cartella. '
        + 'Le modifiche valgono dopo il riavvio di Tabby.',
    'root.use.title': 'Usa un profilo per la cartella di lavoro',
    'root.use.desc': 'Attivalo e indica la cartella: il profilo viene creato e diventa quello predefinito.',
    'root.name.title': 'Nome del profilo',
    'root.cwd.title': 'Cartella di lavoro',
    'root.cwd.desc': 'Se lo lasci vuoto non viene creato alcun profilo. Scrivendolo a mano usa le barre normali '
        + '(per es. D:/Project) per evitare le trappole di escape dei backslash.',
    'root.browse': 'Sfoglia',
    'root.command.title': 'Comando',

    'diag.head': 'Segnala un problema',
    'diag.intro': 'Raccoglie i log diagnostici in <b>un unico zip</b> e apre la cartella in cui finisce. '
        + 'Contiene: versioni del plugin e di Tabby e sistema operativo, le impostazioni qui sopra e le due '
        + 'generazioni più recenti di <code>{path}</code>. Nei log ci sono <b>i titoli delle schede e i '
        + 'percorsi che hai aperto</b>: puoi aprire lo zip e controllare prima di inviarlo.',
    'diag.screen.title': 'Includi anche lo schermo grezzo',
    'diag.screen.desc': 'Attivalo per i problemi di disegno a schermo. La schermata del terminale entra '
        + 'testualmente — il tuo lavoro e il tuo codice sono leggibili — perciò è disattivato per impostazione '
        + 'predefinita.',
    'diag.collect.title': 'Raccogli i log',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Creato: ',
    'diag.btn': 'Raccogli',

    'dev.head': 'Opzioni sviluppatore',
    'dev.use.title': 'Attiva le opzioni sviluppatore',
    'dev.use.desc': 'Attiva il <b>ricaricamento a caldo</b>: quando <code>npm run build</code> riscrive '
        + '<code>dist/index.js</code>, la finestra ricarica il nuovo plugin <b>mantenendo le sessioni</b> '
        + '(le schede si riagganciano allo stesso pty). Anche la scorciatoia <b>[dev] Ricarica il plugin</b> '
        + 'segue questo interruttore. Disattivato, modificare dist non fa nulla. '
        + 'Visibile solo per le installazioni da sorgente; la build npm non ha questa funzione.',
    'dev.now.title': 'Ricarica adesso',
    'dev.now.desc': 'Ricarica il dist attuale senza compilare.',
    'dev.btn': 'Ricarica',

    'footer': 'Il resto — proporzioni della finestra, larghezza della barra laterale, opacità, rilevamento '
        + 'dello stato, gestione dell’input — è fissato sui valori predefiniti. Se devi cambiarne uno, '
        + 'modifica <code>agentDeck.*</code> direttamente nel file di configurazione. '
        + 'Le scorciatoie stanno nella scheda <b>Scorciatoie</b> come <code>agentdeck-*</code>.',
}
