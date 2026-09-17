/** English — the fallback every other language falls back to (`i18n.ts`). */
export default {
    'layout.title': 'Use the AgentDeck layout',
    'layout.desc': 'Turn this off to drop the sidebar and the fixed-width layout and go back to stock Tabby.',

    'reset.title': 'Reset the layout',
    'reset.desc': 'Puts the sidebar back where it started — docked right, with the width derived from the window ratio.',
    'reset.now': 'Now: docked {dock}, {size}.',
    'reset.default': 'It is at the default right now.',
    'reset.btn': 'Reset',

    'dock.left': 'left',
    'dock.right': 'right',
    'dock.top': 'top',
    'dock.bottom': 'bottom',
    'size.width': '{px}px wide',
    'size.height': '{px}px tall',
    'size.auto': 'width auto',

    'norecover.title': 'Do not restore tabs on start',
    'norecover.desc': 'Tabby starts empty instead of bringing the old tabs back — what comes back is only the shell, '
        + 'and the Claude session inside it is long gone. '
        + 'Turn it off for stock behaviour (<code>recoverTabs</code>). Applies from the next start.',

    'resume.title': 'Resume past sessions',
    'resume.desc': 'Adds a <code>⟲ Past sessions</code> drawer at the end of each group (collapsed by default). '
        + 'Open it and <b>closed Claude Code and Codex sessions</b> are listed by the prompt you actually typed; '
        + 'clicking one reopens the conversation with <code>claude --resume</code> or <code>codex resume</code> '
        + 'in its own working folder. This is the other half of <b>Do not restore tabs</b> above — '
        + 'stock recovery brings back the shell, this brings back the conversation. '
        + '<b>Servers and background processes you had running do not come back.</b>',

    'agents.head': 'Agent integration',
    'agents.intro': 'Lets each agent <b>report</b> its own state, model and usage limits. '
        + 'That is the most accurate source the sidebar has — without it we guess from the text drawn '
        + 'on screen, and the reading wobbles accordingly.',
    'agents.unsupported.title': 'Not available on this platform',
    'agents.unsupported.desc': 'The notification script is PowerShell, so it only runs on Windows. '
        + 'State is guessed from output instead.',

    'state.on': 'Connected',
    'state.off': 'Not connected',
    'state.half': 'Half-connected',
    'btn.install': 'Install',
    'btn.remove': 'Remove',

    'claude.title': 'Claude integration',
    'claude.desc': 'Claude Code sessions show up in the sidebar with their <b>state</b> '
        + '(working · waiting for approval · done) and <b>model, account and usage bars</b>. '
        + 'Installs the hooks and the <code>statusLine</code> in <code>~/.claude/settings.json</code> together, '
        + 'and removes them together. Other hooks are left alone, and a <code>statusLine</code> you already had '
        + 'is <b>run as-is</b>, so what you see there does not change. A backup is written next to the file first.',

    'codex.title': 'Codex integration',
    'codex.desc': 'Codex sessions show up in the sidebar with their <b>state</b> '
        + '(working · waiting for approval · done · interrupted) and <b>model, account and usage bars</b>. '
        + 'After installing, reopen Codex and review and trust the AgentDeck hooks under <code>/hooks</code>.',

    'codex.disabled': 'Codex has these hooks turned off — nothing arrives until you enable them: {events}. Open Codex, run <code>/hooks</code>, and trust them.',

    'root.head': 'Working-folder profile',
    'root.intro': 'Creates a profile so new tabs always open in the same folder. '
        + 'Changes apply after restarting Tabby.',
    'root.use.title': 'Use a working-folder profile',
    'root.use.desc': 'Turn it on and fill in the folder — the profile is created and becomes the default.',
    'root.name.title': 'Profile name',
    'root.cwd.title': 'Working folder',
    'root.cwd.desc': 'Leave it empty and no profile is made. When typing it by hand use forward slashes '
        + '(e.g. D:/Project) to dodge backslash-escaping traps.',
    'root.browse': 'Browse',
    'root.command.title': 'Command',

    'diag.head': 'Report a problem',
    'diag.intro': 'Collects the diagnostic logs into <b>a single zip</b> and opens the folder it lands in. '
        + 'It contains the plugin/Tabby versions and OS, the settings above, and the two most recent '
        + 'generations of <code>{path}</code>. The logs include <b>tab titles and the paths you opened</b> — '
        + 'feel free to open the zip and check before sending it.',
    'diag.screen.title': 'Include the raw screen',
    'diag.screen.desc': 'Turn this on for rendering problems. The terminal screen goes in verbatim — '
        + 'your work and code are visible in it — so it is off by default.',
    'diag.collect.title': 'Collect the logs',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Created: ',
    'diag.btn': 'Collect',

    'dev.head': 'Developer options',
    'dev.use.title': 'Enable developer options',
    'dev.use.desc': 'Turns on <b>live reload</b> — when <code>npm run build</code> rewrites '
        + '<code>dist/index.js</code>, the window reloads onto the new plugin <b>with your sessions intact</b> '
        + '(tabs reattach to the same pty). The <b>[dev] Reload plugin</b> hotkey follows this switch too. '
        + 'Turn it off and a changed dist does nothing. '
        + 'Only shown for source-tree installs; the npm build does not have this.',
    'dev.now.title': 'Reload now',
    'dev.now.desc': 'Reloads onto the current dist without building.',
    'dev.btn': 'Reload',

    'footer': 'The rest — window ratio, sidebar width, opacity, state detection, input handling — is pinned to '
        + 'its defaults. Edit <code>agentDeck.*</code> in the config file if you need to change one. '
        + 'Hotkeys live under the <b>Hotkeys</b> tab as <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Shortcuts',
    'keys.intro': 'The keys from the front page. Press <b>Change</b>, then the new key. If it is already taken — by Tabby itself or by AgentDeck — you are told <b>what it clashes with</b> and can pick again or take the key over. Applies immediately.',
    'keys.change': 'Change',
    'keys.default': 'Default',
    'keys.cancel': 'Cancel',
    'keys.force': 'Use it anyway',
    'keys.press': 'Press the new key… (Esc to cancel)',
    'keys.conflict': 'Clashes with {names}. Use it anyway and the key is removed there.',
    'keys.unbound': 'unbound',
    'keys.stock': 'Tabby\'s own',
    'keys.digit': 'This one has to end in a digit 1–9 — the digit is the session number. Press e.g. Alt+1 and 2…9 follow.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, right-click and the panel\'s <code>Ctrl+F</code> / <code>Ctrl+S</code> are not hotkeys and are not changed here.',
    'keys.item.newtab': 'New tab in the work root',
    'keys.item.jump': 'Jump to the Nth session',
    'keys.item.focus': 'Focus the session list / back to the terminal',
    'keys.item.view': 'Open / close the preview panel',
    'keys.item.repair': 'Screen repair',
    'keys.item.splitright': 'Split side by side (new pane on the right)',
    'keys.item.splitbottom': 'Split top / bottom (new pane below)',
    'keys.item.closepane': 'Close the focused split pane',
    'keys.item.newline': 'Newline without sending',
    'keys.item.toggle': 'Sidebar / 4:3 on-off',
    'keys.item.viewmode': 'Panel: Files ↔ Changes',
}
