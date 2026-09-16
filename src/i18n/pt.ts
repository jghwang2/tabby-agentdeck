/** Português (pt-PT e pt-BR partilham este ficheiro) */
export default {
    'layout.title': 'Usar o layout do AgentDeck',
    'layout.desc': 'Desligue para remover a barra lateral e a largura fixa e voltar ao Tabby original.',

    'reset.title': 'Repor o layout',
    'reset.desc': 'Devolve a barra lateral ao estado inicial — encostada à direita, com a largura calculada '
        + 'a partir da proporção da janela.',
    'reset.now': 'Agora: encostada à {dock}, {size}.',
    'reset.default': 'Neste momento está tudo nos valores predefinidos.',
    'reset.btn': 'Repor',

    'dock.left': 'esquerda',
    'dock.right': 'direita',
    'dock.top': 'parte superior',
    'dock.bottom': 'parte inferior',
    'size.width': '{px} px de largura',
    'size.height': '{px} px de altura',
    'size.auto': 'largura automática',

    'norecover.title': 'Não restaurar separadores ao iniciar',
    'norecover.desc': 'O Tabby arranca vazio em vez de trazer de volta os separadores anteriores — o que volta '
        + 'é apenas a shell, e a sessão do Claude que estava lá dentro já terminou há muito. '
        + 'Desligue para o comportamento original (<code>recoverTabs</code>). Aplica-se a partir do próximo arranque.',

    'resume.title': 'Retomar sessões anteriores',
    'resume.desc': 'Acrescenta uma gaveta <code>⟲ Sessões anteriores</code> no fim de cada grupo (recolhida por '
        + 'predefinição). Ao abrir, aparecem as <b>sessões fechadas do Claude Code e do Codex</b> identificadas '
        + 'pelo prompt que escreveu de facto; ao clicar numa delas, a conversa volta com '
        + '<code>claude --resume</code> ou <code>codex resume</code> na respetiva pasta de trabalho. '
        + 'É a outra metade de <b>Não restaurar separadores</b> acima — a recuperação original traz a shell, '
        + 'esta traz a conversa. '
        + '<b>Os servidores e processos em segundo plano que tinha a correr não voltam.</b>',

    'agents.head': 'Integração dos agentes',
    'agents.intro': 'Faz com que cada agente <b>comunique ele próprio</b> o seu estado, o modelo e os limites de uso. '
        + 'É a fonte mais fiável que a barra lateral tem — sem ela adivinhamos a partir do texto desenhado '
        + 'no ecrã, e a leitura fica igualmente instável.',
    'agents.unsupported.title': 'Indisponível nesta plataforma',
    'agents.unsupported.desc': 'O script de notificação é em PowerShell, por isso só corre no Windows. '
        + 'O estado passa a ser deduzido a partir do output.',

    'state.on': 'Ligado',
    'state.off': 'Não ligado',
    'state.half': 'Ligado pela metade',
    'btn.install': 'Instalar',
    'btn.remove': 'Remover',

    'claude.title': 'Integração com o Claude',
    'claude.desc': 'As sessões do Claude Code aparecem na barra lateral com o seu <b>estado</b> '
        + '(a trabalhar · à espera de aprovação · concluído) e as <b>barras de modelo, conta e utilização</b>. '
        + 'Instala em conjunto os hooks e a <code>statusLine</code> em <code>~/.claude/settings.json</code>, '
        + 'e remove-os em conjunto. Não mexe nos outros hooks, e uma <code>statusLine</code> que já tivesse '
        + 'é <b>executada tal como está</b>, pelo que o que vê aí não muda. '
        + 'Antes de escrever, é deixada uma cópia de segurança na mesma pasta.',

    'codex.title': 'Integração com o Codex',
    'codex.desc': 'As sessões do Codex aparecem na barra lateral com o seu <b>estado</b> '
        + '(a trabalhar · à espera de aprovação · concluído · interrompido) e as <b>barras de modelo, '
        + 'conta e utilização</b>. Depois de instalar, volte a abrir o Codex e reveja e confie nos hooks '
        + 'do AgentDeck em <code>/hooks</code>.',

    'codex.disabled': 'O Codex tem estes hooks desligados — até os ligar não chega nada: {events}. Abra o Codex, execute <code>/hooks</code> e confie neles.',

    'root.head': 'Perfil da pasta de trabalho',
    'root.intro': 'Cria um perfil para que os separadores novos abram sempre na mesma pasta. '
        + 'As alterações aplicam-se depois de reiniciar o Tabby.',
    'root.use.title': 'Usar um perfil de pasta de trabalho',
    'root.use.desc': 'Ligue e preencha a pasta — o perfil é criado e passa a ser o predefinido.',
    'root.name.title': 'Nome do perfil',
    'root.cwd.title': 'Pasta de trabalho',
    'root.cwd.desc': 'Se deixar vazio não é criado nenhum perfil. Ao escrever à mão use barras normais '
        + '(por exemplo D:/Project) para evitar as armadilhas de escape das barras invertidas.',
    'root.browse': 'Procurar',
    'root.command.title': 'Comando',

    'diag.head': 'Comunicar um problema',
    'diag.intro': 'Junta os registos de diagnóstico <b>num único zip</b> e abre a pasta onde ele fica. '
        + 'Contém: versões do plugin e do Tabby e o sistema operativo, as definições acima, e as duas gerações '
        + 'mais recentes de <code>{path}</code>. Os registos incluem <b>os títulos dos separadores e os '
        + 'caminhos que abriu</b> — pode abrir o zip e verificar antes de o enviar.',
    'diag.screen.title': 'Incluir também o ecrã em bruto',
    'diag.screen.desc': 'Ligue para problemas de desenho no ecrã. O ecrã do terminal entra tal e qual '
        + '— o seu trabalho e o seu código ficam visíveis — por isso está desligado por predefinição.',
    'diag.collect.title': 'Juntar os registos',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Criado: ',
    'diag.btn': 'Juntar',

    'dev.head': 'Opções de programador',
    'dev.use.title': 'Ativar as opções de programador',
    'dev.use.desc': 'Liga o <b>recarregamento em direto</b> — quando o <code>npm run build</code> reescreve '
        + 'o <code>dist/index.js</code>, a janela recarrega para o novo plugin <b>mantendo as suas sessões</b> '
        + '(os separadores voltam a ligar-se ao mesmo pty). O atalho <b>[dev] Recarregar o plugin</b> '
        + 'também segue este interruptor. Desligado, alterar o dist não faz nada. '
        + 'Só aparece em instalações a partir do código-fonte; a versão do npm não tem esta funcionalidade.',
    'dev.now.title': 'Recarregar agora',
    'dev.now.desc': 'Recarrega o dist atual sem compilar.',
    'dev.btn': 'Recarregar',

    'footer': 'O resto — proporção da janela, largura da barra lateral, opacidade, deteção de estado, '
        + 'tratamento da entrada — está fixado nos valores predefinidos. Se precisar de mudar algum, '
        + 'edite <code>agentDeck.*</code> diretamente no ficheiro de configuração. '
        + 'Os atalhos estão no separador <b>Atalhos</b> como <code>agentdeck-*</code>.',
}
