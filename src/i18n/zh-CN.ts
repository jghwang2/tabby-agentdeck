/** 简体中文 */
export default {
    'layout.title': '使用 AgentDeck 布局',
    'layout.desc': '关闭后侧边栏和固定宽度布局会消失，回到 Tabby 原版界面。',

    'reset.title': '重置界面布局',
    'reset.desc': '把用鼠标改过的侧边栏位置和大小还原到初始状态 —— 停靠在右侧，宽度按窗口比例自动计算。',
    'reset.now': '当前：停靠在{dock}，{size}。',
    'reset.default': '当前就是默认状态。',
    'reset.btn': '重置',

    'dock.left': '左侧',
    'dock.right': '右侧',
    'dock.top': '顶部',
    'dock.bottom': '底部',
    'size.width': '宽 {px}px',
    'size.height': '高 {px}px',
    'size.auto': '宽度自动',

    'norecover.title': '启动时不恢复标签页',
    'norecover.desc': '开启后 Tabby 重新打开时不会恢复上次的标签页，而是从空白开始 —— '
        + '能恢复的只有 shell，里面的 Claude 会话早就结束了。 '
        + '关闭则回到 Tabby 原版行为（<code>recoverTabs</code>）。下次启动生效。',

    'resume.title': '继续过去的会话',
    'resume.desc': '在每个分组末尾放一个 <code>⟲ 过去的会话</code> 抽屉（默认折叠）。 '
        + '展开后会按你当时实际输入的提示词列出<b>已关闭的 Claude Code 与 Codex 会话</b>； '
        + '点击其中一条，就会在那个会话的工作目录里用 <code>claude --resume</code> 或 '
        + '<code>codex resume</code> 把对话接回来。它与上面的<b>不恢复标签页</b>是一对 —— '
        + '原版恢复只找回 shell，这个找回对话。 '
        + '<b>但当时开着的服务器和后台进程不会回来。</b>',

    'agents.head': '代理集成',
    'agents.intro': '让每个代理<b>自己上报</b>状态、所用模型和用量上限。 '
        + '这是侧边栏最准确的信息来源 —— 不接入就只能靠屏幕上画出来的文字去猜，判断自然会飘。',
    'agents.unsupported.title': '此平台不支持',
    'agents.unsupported.desc': '通知脚本是 PowerShell，只能在 Windows 上运行。状态改为从输出内容推测。',

    'state.on': '已连接',
    'state.off': '未连接',
    'state.half': '连接不完整',
    'btn.install': '安装',
    'btn.remove': '移除',

    'claude.title': 'Claude 集成',
    'claude.desc': 'Claude Code 会话会显示在侧边栏，带<b>状态</b>（进行中 · 等待批准 · 已完成）'
        + '和<b>模型、账号、用量条</b>。 '
        + '会一并写入 <code>~/.claude/settings.json</code> 里的钩子和 <code>statusLine</code>，移除时也一并移除。 '
        + '其他钩子不会被动到，你原有的 <code>statusLine</code> 会<b>原样执行</b>，所以显示不会变。 '
        + '写入前会在同一目录留一份备份。',

    'codex.title': 'Codex 集成',
    'codex.desc': 'Codex 会话会显示在侧边栏，带<b>状态</b>（进行中 · 等待批准 · 已完成 · 已中断）'
        + '和<b>模型、账号、用量条</b>。 '
        + '安装后请重新打开 Codex，在 <code>/hooks</code> 中查看并信任 AgentDeck 的钩子。',

    'codex.disabled': 'Codex 关闭了这些钩子 —— 不打开就什么都收不到：{events}。 请在 Codex 中执行 <code>/hooks</code> 并信任它们。',

    'root.head': '工作目录配置',
    'root.intro': '创建一个专用配置，让新标签页总是在同一个工作目录打开。修改在重启 Tabby 后生效。',
    'root.use.title': '使用工作目录配置',
    'root.use.desc': '开启并填好目录后，会创建该配置并设为默认。',
    'root.name.title': '配置名称',
    'root.cwd.title': '工作目录',
    'root.cwd.desc': '留空则不创建配置。手动输入时请用正斜杠（例如 D:/Project），以避开反斜杠转义的坑。',
    'root.browse': '浏览',
    'root.command.title': '启动命令',

    'diag.head': '报告问题',
    'diag.intro': '把诊断日志<b>打包成一个 zip</b>，并打开它所在的文件夹。 '
        + '里面包含：插件/Tabby 版本与操作系统、上面的设置值，以及 <code>{path}</code> 最近的两代日志。 '
        + '日志里有<b>标签页标题和你打开过的文件路径</b> —— 发送前可以先打开确认。',
    'diag.screen.title': '连屏幕原文一起打包',
    'diag.screen.desc': '如果是画面错乱的问题就开启。出问题那一刻的终端画面会原样写入'
        + '（工作内容和代码都能看到），所以默认是关闭的。',
    'diag.collect.title': '收集诊断日志',
    'diag.collect.desc': '插件 v{version}。',
    'diag.made': '已创建：',
    'diag.btn': '收集',

    'dev.head': '开发者选项',
    'dev.use.title': '启用开发者选项',
    'dev.use.desc': '开启后<b>实时重载</b>生效 —— 当 <code>npm run build</code> 改写了 '
        + '<code>dist/index.js</code>，窗口会<b>在保留会话的情况下</b>重载到新插件'
        + '（标签页重新接回同一个 pty）。快捷键页的 <b>[dev] 重载插件</b> 也跟随这个开关。 '
        + '关闭后即使 dist 变了也不会有任何动作。 '
        + '仅源码安装可见，npm 发布版没有这个功能。',
    'dev.now.title': '立即重载',
    'dev.now.desc': '不重新构建，直接用当前的 dist 重新加载。',
    'dev.btn': '重载',

    'footer': '其余项 —— 窗口比例、侧边栏宽度、不透明度、状态检测、输入处理 —— 都固定为默认值。 '
        + '确实需要改时请直接编辑配置文件里的 <code>agentDeck.*</code>。 '
        + '快捷键在<b>快捷键</b>页的 <code>agentdeck-*</code> 项中修改。',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': '快捷键',
    'keys.intro': '首页列出的那些键。点<b>更改</b>，再按新键。若这个键已被占用——无论是 Tabby 自身还是 AgentDeck——会告诉你<b>与什么冲突</b>，可以重选或直接接管。立即生效。',
    'keys.change': '更改',
    'keys.default': '默认值',
    'keys.cancel': '取消',
    'keys.force': '仍然使用',
    'keys.press': '请按新键… (Esc 取消)',
    'keys.conflict': '与 {names} 冲突。仍然使用的话，会从那里移除这个键。',
    'keys.unbound': '未绑定',
    'keys.stock': 'Tabby 自带',
    'keys.digit': '这一项必须以数字 1–9 结尾——数字就是会话序号。例如按 Alt+1，2…9 会随之设置。',
    'keys.fixed': '<code>Ctrl+V</code>、<code>Ctrl+W</code>、右键，以及面板内的 <code>Ctrl+F</code> / <code>Ctrl+S</code> 不是热键，这里不改。',
    'keys.item.newtab': '在工作根目录新建标签',
    'keys.item.jump': '跳到第 N 个会话',
    'keys.item.focus': '聚焦会话列表 / 回到终端',
    'keys.item.view': '打开 / 关闭预览面板',
    'keys.item.repair': '修复屏幕',
    'keys.item.splitright': '左右分割（新窗格在右）',
    'keys.item.splitbottom': '上下分割（新窗格在下）',
    'keys.item.closepane': '关闭当前分割窗格',
    'keys.item.newline': '换行而不发送',
    'keys.item.toggle': '侧栏 / 4:3 开关',
    'keys.item.viewmode': '面板：文件 ↔ 更改',
}
