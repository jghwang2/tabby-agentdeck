/** Español */
export default {
    'layout.title': 'Usar la disposición de AgentDeck',
    'layout.desc': 'Desactívalo para quitar la barra lateral y el ancho fijo y volver a Tabby original.',

    'reset.title': 'Restablecer la disposición',
    'reset.desc': 'Devuelve la barra lateral a su estado inicial: acoplada a la derecha y con el ancho '
        + 'calculado a partir de la proporción de la ventana.',
    'reset.now': 'Ahora: acoplada a la {dock}, {size}.',
    'reset.default': 'Ahora mismo está en los valores por defecto.',
    'reset.btn': 'Restablecer',

    'dock.left': 'izquierda',
    'dock.right': 'derecha',
    'dock.top': 'parte superior',
    'dock.bottom': 'parte inferior',
    'size.width': '{px} px de ancho',
    'size.height': '{px} px de alto',
    'size.auto': 'ancho automático',

    'norecover.title': 'No restaurar las pestañas al iniciar',
    'norecover.desc': 'Tabby arranca vacío en lugar de recuperar las pestañas anteriores: lo único que vuelve '
        + 'es el shell, y la sesión de Claude que había dentro terminó hace rato. '
        + 'Desactívalo para el comportamiento original (<code>recoverTabs</code>). '
        + 'Se aplica a partir del próximo arranque.',

    'resume.title': 'Retomar sesiones anteriores',
    'resume.desc': 'Añade un cajón <code>⟲ Sesiones anteriores</code> al final de cada grupo (plegado por defecto). '
        + 'Al abrirlo aparecen las <b>sesiones cerradas de Claude Code y Codex</b> identificadas por el prompt '
        + 'que escribiste realmente; al pulsar una, la conversación vuelve con <code>claude --resume</code> o '
        + '<code>codex resume</code> en su propia carpeta de trabajo. Es la otra mitad de '
        + '<b>No restaurar las pestañas</b>: la recuperación original trae el shell, esto trae la conversación. '
        + '<b>Los servidores y procesos en segundo plano que tenías en marcha no vuelven.</b>',

    'agents.head': 'Integración de agentes',
    'agents.intro': 'Hace que cada agente <b>informe por sí mismo</b> de su estado, su modelo y sus límites de uso. '
        + 'Es la fuente más precisa que tiene la barra lateral: sin ella lo adivinamos a partir del texto '
        + 'dibujado en pantalla, y la lectura se vuelve igual de inestable.',
    'agents.unsupported.title': 'No disponible en esta plataforma',
    'agents.unsupported.desc': 'El script de notificación es de PowerShell, así que solo funciona en Windows. '
        + 'El estado se deduce de la salida.',

    'state.on': 'Conectado',
    'state.off': 'Sin conectar',
    'state.half': 'Conectado a medias',
    'btn.install': 'Instalar',
    'btn.remove': 'Quitar',

    'claude.title': 'Integración con Claude',
    'claude.desc': 'Las sesiones de Claude Code aparecen en la barra lateral con su <b>estado</b> '
        + '(trabajando · esperando aprobación · terminado) y las <b>barras de modelo, cuenta y uso</b>. '
        + 'Instala a la vez los hooks y la <code>statusLine</code> en <code>~/.claude/settings.json</code>, '
        + 'y los quita a la vez. No toca otros hooks, y una <code>statusLine</code> que ya tuvieras '
        + 'se <b>ejecuta tal cual</b>, así que lo que ves ahí no cambia. '
        + 'Antes se escribe una copia de seguridad junto al archivo.',

    'codex.title': 'Integración con Codex',
    'codex.desc': 'Las sesiones de Codex aparecen en la barra lateral con su <b>estado</b> '
        + '(trabajando · esperando aprobación · terminado · interrumpido) y las <b>barras de modelo, '
        + 'cuenta y uso</b>. Tras instalar, vuelve a abrir Codex y revisa y confía en los hooks de AgentDeck '
        + 'en <code>/hooks</code>.',

    'codex.disabled': 'Codex tiene estos hooks desactivados: hasta que los actives no llega nada: {events}. Abre Codex, ejecuta <code>/hooks</code> y confía en ellos.',

    'root.head': 'Perfil de carpeta de trabajo',
    'root.intro': 'Crea un perfil para que las pestañas nuevas se abran siempre en la misma carpeta. '
        + 'Los cambios se aplican tras reiniciar Tabby.',
    'root.use.title': 'Usar un perfil de carpeta de trabajo',
    'root.use.desc': 'Actívalo y rellena la carpeta: el perfil se crea y pasa a ser el predeterminado.',
    'root.name.title': 'Nombre del perfil',
    'root.cwd.title': 'Carpeta de trabajo',
    'root.cwd.desc': 'Si lo dejas vacío no se crea ningún perfil. Al escribirlo a mano usa barras normales '
        + '(por ejemplo D:/Project) para esquivar los problemas de escape de las barras invertidas.',
    'root.browse': 'Examinar',
    'root.command.title': 'Comando',

    'diag.head': 'Informar de un problema',
    'diag.intro': 'Reúne los registros de diagnóstico en <b>un único zip</b> y abre la carpeta donde queda. '
        + 'Contiene: versiones del plugin y de Tabby y el sistema operativo, los ajustes de arriba y las dos '
        + 'generaciones más recientes de <code>{path}</code>. Los registros incluyen <b>los títulos de las '
        + 'pestañas y las rutas que has abierto</b>: puedes abrir el zip y revisarlo antes de enviarlo.',
    'diag.screen.title': 'Incluir el contenido en bruto de la pantalla',
    'diag.screen.desc': 'Actívalo para problemas de dibujado. La pantalla del terminal entra literalmente '
        + '—tu trabajo y tu código se ven en ella—, por eso está desactivado por defecto.',
    'diag.collect.title': 'Reunir los registros',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Creado: ',
    'diag.btn': 'Reunir',

    'dev.head': 'Opciones de desarrollo',
    'dev.use.title': 'Activar las opciones de desarrollo',
    'dev.use.desc': 'Activa la <b>recarga en caliente</b>: cuando <code>npm run build</code> reescribe '
        + '<code>dist/index.js</code>, la ventana recarga el nuevo plugin <b>conservando tus sesiones</b> '
        + '(las pestañas vuelven a engancharse al mismo pty). El atajo <b>[dev] Recargar el plugin</b> '
        + 'también sigue este interruptor. Desactivado, cambiar dist no hace nada. '
        + 'Solo se ve en instalaciones desde el árbol de código; la versión de npm no lo incluye.',
    'dev.now.title': 'Recargar ahora',
    'dev.now.desc': 'Recarga el dist actual sin compilar.',
    'dev.btn': 'Recargar',

    'footer': 'El resto —proporción de la ventana, ancho de la barra lateral, opacidad, detección de estado, '
        + 'gestión de la entrada— está fijado en sus valores por defecto. Si necesitas cambiar alguno, '
        + 'edita <code>agentDeck.*</code> directamente en el archivo de configuración. '
        + 'Los atajos están en la pestaña <b>Atajos</b> como <code>agentdeck-*</code>.',
}
