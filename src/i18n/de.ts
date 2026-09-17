/** Deutsch */
export default {
    'layout.title': 'AgentDeck-Layout verwenden',
    'layout.desc': 'Ausgeschaltet verschwinden Seitenleiste und feste Breite — Tabby sieht wieder aus wie im Original.',

    'reset.title': 'Layout zurücksetzen',
    'reset.desc': 'Setzt Position und Größe der Seitenleiste auf den Anfangszustand zurück — rechts angedockt, '
        + 'Breite aus dem Fensterverhältnis berechnet.',
    'reset.now': 'Aktuell: {dock} angedockt, {size}.',
    'reset.default': 'Aktuell ist alles auf Standard.',
    'reset.btn': 'Zurücksetzen',

    'dock.left': 'links',
    'dock.right': 'rechts',
    'dock.top': 'oben',
    'dock.bottom': 'unten',
    'size.width': '{px}px breit',
    'size.height': '{px}px hoch',
    'size.auto': 'Breite automatisch',

    'norecover.title': 'Tabs beim Start nicht wiederherstellen',
    'norecover.desc': 'Tabby startet leer, statt die alten Tabs zurückzuholen — zurück kommt ohnehin nur die Shell, '
        + 'und die Claude-Sitzung darin ist längst beendet. '
        + 'Ausgeschaltet gilt wieder das Originalverhalten (<code>recoverTabs</code>). Gilt ab dem nächsten Start.',

    'resume.title': 'Frühere Sitzungen fortsetzen',
    'resume.desc': 'Hängt an jede Gruppe eine Schublade <code>⟲ Frühere Sitzungen</code> an (standardmäßig zugeklappt). '
        + 'Aufgeklappt stehen dort <b>geschlossene Claude-Code- und Codex-Sitzungen</b> mit dem Prompt, '
        + 'den du damals wirklich getippt hast; ein Klick holt das Gespräch mit <code>claude --resume</code> '
        + 'bzw. <code>codex resume</code> im zugehörigen Arbeitsordner zurück. Das ist die andere Hälfte von '
        + '<b>Tabs nicht wiederherstellen</b> oben — die Originalwiederherstellung bringt die Shell zurück, '
        + 'das hier bringt das Gespräch zurück. '
        + '<b>Server und Hintergrundprozesse von damals kommen nicht zurück.</b>',

    'agents.head': 'Agent-Anbindung',
    'agents.intro': 'Lässt jeden Agenten seinen Zustand, sein Modell und seine Nutzungsgrenzen <b>selbst melden</b>. '
        + 'Das ist die genaueste Quelle, die die Seitenleiste hat — ohne sie raten wir anhand des Textes '
        + 'auf dem Bildschirm, und entsprechend wackelig ist das Ergebnis.',
    'agents.unsupported.title': 'Auf dieser Plattform nicht verfügbar',
    'agents.unsupported.desc': 'Das Benachrichtigungsskript ist PowerShell und läuft daher nur unter Windows. '
        + 'Der Zustand wird stattdessen aus der Ausgabe geraten.',

    'state.on': 'Verbunden',
    'state.off': 'Nicht verbunden',
    'state.half': 'Halb verbunden',
    'btn.install': 'Installieren',
    'btn.remove': 'Entfernen',

    'claude.title': 'Claude-Anbindung',
    'claude.desc': 'Claude-Code-Sitzungen erscheinen in der Seitenleiste mit ihrem <b>Zustand</b> '
        + '(arbeitet · wartet auf Freigabe · fertig) und <b>Modell, Konto und Nutzungsbalken</b>. '
        + 'Installiert die Hooks und die <code>statusLine</code> in <code>~/.claude/settings.json</code> gemeinsam '
        + 'und entfernt sie gemeinsam. Andere Hooks bleiben unangetastet, und eine bereits vorhandene '
        + '<code>statusLine</code> wird <b>unverändert ausgeführt</b> — was du dort siehst, ändert sich nicht. '
        + 'Vorher wird eine Sicherung neben der Datei abgelegt.',

    'codex.title': 'Codex-Anbindung',
    'codex.desc': 'Codex-Sitzungen erscheinen in der Seitenleiste mit ihrem <b>Zustand</b> '
        + '(arbeitet · wartet auf Freigabe · fertig · abgebrochen) und <b>Modell, Konto und Nutzungsbalken</b>. '
        + 'Öffne Codex nach der Installation neu und prüfe und bestätige die AgentDeck-Hooks unter <code>/hooks</code>.',

    'codex.disabled': 'Codex hat diese Hooks abgeschaltet — bis du sie einschaltest, kommt nichts an: {events}. Öffne Codex, führe <code>/hooks</code> aus und bestätige sie.',

    'root.head': 'Profil für den Arbeitsordner',
    'root.intro': 'Legt ein Profil an, damit neue Tabs immer im selben Ordner starten. '
        + 'Änderungen greifen nach einem Neustart von Tabby.',
    'root.use.title': 'Profil für den Arbeitsordner verwenden',
    'root.use.desc': 'Einschalten und den Ordner eintragen — das Profil wird angelegt und zum Standard.',
    'root.name.title': 'Profilname',
    'root.cwd.title': 'Arbeitsordner',
    'root.cwd.desc': 'Leer lassen und es wird kein Profil angelegt. Beim Tippen Schrägstriche verwenden '
        + '(z. B. D:/Project), um Escape-Fallen mit Backslashes zu vermeiden.',
    'root.browse': 'Durchsuchen',
    'root.command.title': 'Befehl',

    'diag.head': 'Problem melden',
    'diag.intro': 'Sammelt die Diagnoseprotokolle in <b>einer einzigen ZIP-Datei</b> und öffnet den Ordner, '
        + 'in dem sie landet. Enthalten sind: Plugin-/Tabby-Version und Betriebssystem, die Einstellungen oben '
        + 'sowie die zwei jüngsten Generationen von <code>{path}</code>. In den Protokollen stehen '
        + '<b>Tab-Titel und die Pfade, die du geöffnet hast</b> — du darfst die ZIP vor dem Senden ruhig prüfen.',
    'diag.screen.title': 'Rohen Bildschirminhalt mitschicken',
    'diag.screen.desc': 'Für Darstellungsfehler einschalten. Der Terminalinhalt geht wortwörtlich mit — '
        + 'deine Arbeit und dein Code sind darin lesbar — deshalb ist es standardmäßig aus.',
    'diag.collect.title': 'Protokolle sammeln',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Erstellt: ',
    'diag.btn': 'Sammeln',

    'dev.head': 'Entwickleroptionen',
    'dev.use.title': 'Entwickleroptionen aktivieren',
    'dev.use.desc': 'Schaltet <b>Live-Reload</b> ein — sobald <code>npm run build</code> '
        + '<code>dist/index.js</code> neu schreibt, lädt das Fenster das neue Plugin <b>mit erhaltenen Sitzungen</b> '
        + '(die Tabs hängen sich wieder an dieselbe pty). Der Hotkey <b>[dev] Plugin neu laden</b> folgt '
        + 'ebenfalls diesem Schalter. Ausgeschaltet passiert bei geändertem dist gar nichts. '
        + 'Nur bei Installationen aus dem Quellbaum sichtbar; im npm-Build gibt es das nicht.',
    'dev.now.title': 'Jetzt neu laden',
    'dev.now.desc': 'Lädt ohne Build das aktuelle dist neu.',
    'dev.btn': 'Neu laden',

    'footer': 'Der Rest — Fensterverhältnis, Breite der Seitenleiste, Deckkraft, Zustandserkennung, '
        + 'Eingabeverarbeitung — steht fest auf den Standardwerten. Bei Bedarf <code>agentDeck.*</code> '
        + 'direkt in der Konfigurationsdatei ändern. '
        + 'Tastenkürzel liegen im Reiter <b>Hotkeys</b> unter <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Tastenkürzel',
    'keys.intro': 'Die Tasten von der Startseite. <b>Ändern</b> drücken, dann die neue Taste. Ist sie schon belegt – von Tabby selbst oder von AgentDeck – wird gesagt, <b>womit sie kollidiert</b>, und man kann neu wählen oder die Taste übernehmen. Gilt sofort.',
    'keys.change': 'Ändern',
    'keys.default': 'Standard',
    'keys.cancel': 'Abbrechen',
    'keys.force': 'Trotzdem verwenden',
    'keys.press': 'Neue Taste drücken… (Esc bricht ab)',
    'keys.conflict': 'Kollidiert mit {names}. Bei „Trotzdem verwenden“ wird die Taste dort entfernt.',
    'keys.unbound': 'nicht belegt',
    'keys.stock': 'Tabby-eigen',
    'keys.digit': 'Dieser Eintrag muss auf eine Ziffer 1–9 enden – die Ziffer ist die Sitzungsnummer. Z. B. Alt+1 drücken, 2…9 folgen.',
    'keys.fixed': '<code>Strg+V</code>, <code>Strg+W</code>, Rechtsklick und <code>Strg+F</code> / <code>Strg+S</code> im Panel sind keine Hotkeys und werden hier nicht geändert.',
    'keys.item.newtab': 'Neuer Tab im Arbeitsordner',
    'keys.item.jump': 'Zur N-ten Sitzung springen',
    'keys.item.focus': 'Sitzungsliste fokussieren / zurück ins Terminal',
    'keys.item.view': 'Vorschau-Panel öffnen / schließen',
    'keys.item.repair': 'Bildschirm reparieren',
    'keys.item.splitright': 'Nebeneinander teilen (neue Ansicht rechts)',
    'keys.item.splitbottom': 'Übereinander teilen (neue Ansicht unten)',
    'keys.item.closepane': 'Fokussierte Teilansicht schließen',
    'keys.item.newline': 'Zeilenumbruch ohne Senden',
    'keys.item.toggle': 'Seitenleiste / 4:3 an-aus',
    'keys.item.viewmode': 'Panel: Dateien ↔ Änderungen',
}
