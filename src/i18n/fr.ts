/** Français */
export default {
    'layout.title': 'Utiliser la disposition AgentDeck',
    'layout.desc': 'Désactivez pour supprimer la barre latérale et la largeur fixe, et revenir à Tabby d’origine.',

    'reset.title': 'Réinitialiser la disposition',
    'reset.desc': 'Remet la barre latérale dans son état initial — ancrée à droite, largeur calculée '
        + 'à partir du rapport de la fenêtre.',
    'reset.now': 'Actuellement : ancrée à {dock}, {size}.',
    'reset.default': 'Tout est actuellement à la valeur par défaut.',
    'reset.btn': 'Réinitialiser',

    'dock.left': 'gauche',
    'dock.right': 'droite',
    'dock.top': 'en haut',
    'dock.bottom': 'en bas',
    'size.width': '{px} px de large',
    'size.height': '{px} px de haut',
    'size.auto': 'largeur automatique',

    'norecover.title': 'Ne pas restaurer les onglets au démarrage',
    'norecover.desc': 'Tabby démarre vide au lieu de rouvrir les anciens onglets — ce qui revient n’est que le shell, '
        + 'et la session Claude qu’il contenait est terminée depuis longtemps. '
        + 'Désactivez pour retrouver le comportement d’origine (<code>recoverTabs</code>). '
        + 'Effectif au prochain démarrage.',

    'resume.title': 'Reprendre les sessions passées',
    'resume.desc': 'Ajoute un tiroir <code>⟲ Sessions passées</code> à la fin de chaque groupe (replié par défaut). '
        + 'Une fois ouvert, les <b>sessions Claude Code et Codex fermées</b> y figurent avec l’invite que vous '
        + 'aviez réellement tapée ; un clic rouvre la conversation via <code>claude --resume</code> ou '
        + '<code>codex resume</code> dans son propre dossier de travail. C’est le pendant de '
        + '<b>Ne pas restaurer les onglets</b> ci-dessus — la restauration d’origine ramène le shell, '
        + 'celle-ci ramène la conversation. '
        + '<b>Les serveurs et processus d’arrière-plan alors lancés ne reviennent pas.</b>',

    'agents.head': 'Intégration des agents',
    'agents.intro': 'Permet à chaque agent de <b>signaler lui-même</b> son état, son modèle et ses quotas. '
        + 'C’est la source la plus fiable dont dispose la barre latérale — sans cela, nous devinons à partir '
        + 'du texte affiché à l’écran, et la lecture s’en trouve d’autant plus incertaine.',
    'agents.unsupported.title': 'Indisponible sur cette plateforme',
    'agents.unsupported.desc': 'Le script de notification est en PowerShell : il ne fonctionne que sous Windows. '
        + 'L’état est alors deviné à partir de la sortie.',

    'state.on': 'Connecté',
    'state.off': 'Non connecté',
    'state.half': 'Connecté à moitié',
    'btn.install': 'Installer',
    'btn.remove': 'Supprimer',

    'claude.title': 'Intégration Claude',
    'claude.desc': 'Les sessions Claude Code apparaissent dans la barre latérale avec leur <b>état</b> '
        + '(en cours · en attente d’approbation · terminé) et les <b>barres de modèle, de compte et de quota</b>. '
        + 'Installe ensemble les hooks et la <code>statusLine</code> dans <code>~/.claude/settings.json</code>, '
        + 'et les supprime ensemble. Les autres hooks ne sont pas touchés, et une <code>statusLine</code> '
        + 'déjà présente est <b>exécutée telle quelle</b> : ce que vous y voyez ne change pas. '
        + 'Une sauvegarde est écrite à côté du fichier au préalable.',

    'codex.title': 'Intégration Codex',
    'codex.desc': 'Les sessions Codex apparaissent dans la barre latérale avec leur <b>état</b> '
        + '(en cours · en attente d’approbation · terminé · interrompu) et les <b>barres de modèle, '
        + 'de compte et de quota</b>. Après l’installation, rouvrez Codex puis vérifiez et approuvez '
        + 'les hooks AgentDeck sous <code>/hooks</code>.',

    'codex.disabled': 'Codex a désactivé ces hooks — rien n’arrive tant que vous ne les activez pas : {events}. Ouvrez Codex, lancez <code>/hooks</code> et approuvez-les.',

    'root.head': 'Profil de dossier de travail',
    'root.intro': 'Crée un profil pour que les nouveaux onglets s’ouvrent toujours dans le même dossier. '
        + 'Les modifications prennent effet après un redémarrage de Tabby.',
    'root.use.title': 'Utiliser un profil de dossier de travail',
    'root.use.desc': 'Activez puis renseignez le dossier — le profil est créé et devient celui par défaut.',
    'root.name.title': 'Nom du profil',
    'root.cwd.title': 'Dossier de travail',
    'root.cwd.desc': 'Laissez vide et aucun profil n’est créé. En saisie manuelle, utilisez des barres obliques '
        + '(par ex. D:/Project) pour éviter les pièges d’échappement des antislashs.',
    'root.browse': 'Parcourir',
    'root.command.title': 'Commande',

    'diag.head': 'Signaler un problème',
    'diag.intro': 'Rassemble les journaux de diagnostic dans <b>une seule archive zip</b> et ouvre le dossier '
        + 'où elle est créée. On y trouve : les versions du plugin et de Tabby, le système, les réglages '
        + 'ci-dessus, et les deux générations les plus récentes de <code>{path}</code>. Les journaux contiennent '
        + '<b>les titres des onglets et les chemins que vous avez ouverts</b> — n’hésitez pas à ouvrir '
        + 'l’archive pour vérifier avant de l’envoyer.',
    'diag.screen.title': 'Inclure le contenu brut de l’écran',
    'diag.screen.desc': 'À activer pour les problèmes d’affichage. L’écran du terminal est inclus tel quel — '
        + 'votre travail et votre code y sont lisibles — c’est donc désactivé par défaut.',
    'diag.collect.title': 'Rassembler les journaux',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Créé : ',
    'diag.btn': 'Rassembler',

    'dev.head': 'Options développeur',
    'dev.use.title': 'Activer les options développeur',
    'dev.use.desc': 'Active le <b>rechargement à chaud</b> — dès que <code>npm run build</code> réécrit '
        + '<code>dist/index.js</code>, la fenêtre recharge le nouveau plugin <b>en conservant vos sessions</b> '
        + '(les onglets se rattachent au même pty). Le raccourci <b>[dev] Recharger le plugin</b> suit '
        + 'également cet interrupteur. Désactivé, un dist modifié ne déclenche rien. '
        + 'Visible uniquement pour les installations depuis les sources ; la version npm n’a pas cette fonction.',
    'dev.now.title': 'Recharger maintenant',
    'dev.now.desc': 'Recharge le dist actuel sans reconstruire.',
    'dev.btn': 'Recharger',

    'footer': 'Le reste — rapport de la fenêtre, largeur de la barre latérale, opacité, détection d’état, '
        + 'gestion de la saisie — est figé sur les valeurs par défaut. Modifiez <code>agentDeck.*</code> '
        + 'directement dans le fichier de configuration si nécessaire. '
        + 'Les raccourcis se trouvent dans l’onglet <b>Raccourcis</b> sous <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Raccourcis',
    'keys.intro': 'Les touches de la page d\'accueil. Appuyez sur <b>Modifier</b>, puis sur la nouvelle touche. Si elle est déjà prise — par Tabby lui-même ou par AgentDeck — on vous dit <b>avec quoi elle entre en conflit</b> et vous pouvez rechoisir ou la reprendre. S\'applique immédiatement.',
    'keys.change': 'Modifier',
    'keys.default': 'Par défaut',
    'keys.cancel': 'Annuler',
    'keys.force': 'Utiliser quand même',
    'keys.press': 'Appuyez sur la nouvelle touche… (Échap pour annuler)',
    'keys.conflict': 'En conflit avec {names}. En l\'utilisant quand même, la touche y est retirée.',
    'keys.unbound': 'non assigné',
    'keys.stock': 'natif Tabby',
    'keys.digit': 'Celui-ci doit finir par un chiffre 1–9 — le chiffre est le numéro de session. Appuyez par ex. sur Alt+1 et 2…9 suivent.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, le clic droit et <code>Ctrl+F</code> / <code>Ctrl+S</code> du panneau ne sont pas des raccourcis et ne se changent pas ici.',
    'keys.item.newtab': 'Nouvel onglet dans la racine de travail',
    'keys.item.jump': 'Aller à la N-ième session',
    'keys.item.focus': 'Focus sur la liste des sessions / retour au terminal',
    'keys.item.view': 'Ouvrir / fermer le panneau d\'aperçu',
    'keys.item.repair': 'Réparer l\'écran',
    'keys.item.splitright': 'Diviser côte à côte (nouveau volet à droite)',
    'keys.item.splitbottom': 'Diviser haut / bas (nouveau volet en bas)',
    'keys.item.closepane': 'Fermer le volet actif',
    'keys.item.newline': 'Nouvelle ligne sans envoyer',
    'keys.item.toggle': 'Barre latérale / 4:3 on-off',
    'keys.item.viewmode': 'Panneau : Fichiers ↔ Modifications',
}
