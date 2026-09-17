/** 繁體中文 */
export default {
    'layout.title': '使用 AgentDeck 版面',
    'layout.desc': '關閉後側邊欄與固定寬度版面會消失，回到 Tabby 原生畫面。',

    'reset.title': '重設介面版面',
    'reset.desc': '把用滑鼠改過的側邊欄位置與大小還原成初始狀態 —— 靠右停駐，寬度依視窗比例自動計算。',
    'reset.now': '目前：停駐在{dock}，{size}。',
    'reset.default': '目前就是預設狀態。',
    'reset.btn': '重設',

    'dock.left': '左側',
    'dock.right': '右側',
    'dock.top': '頂端',
    'dock.bottom': '底部',
    'size.width': '寬 {px}px',
    'size.height': '高 {px}px',
    'size.auto': '寬度自動',

    'norecover.title': '啟動時不還原分頁',
    'norecover.desc': '開啟後 Tabby 重新開啟時不會還原上次的分頁，而是從空白開始 —— '
        + '能還原的只有 shell，裡面的 Claude 工作階段早就結束了。 '
        + '關閉則回到 Tabby 原生行為（<code>recoverTabs</code>）。下次啟動生效。',

    'resume.title': '接續過去的工作階段',
    'resume.desc': '在每個群組末端放一個 <code>⟲ 過去的工作階段</code> 抽屜（預設收合）。 '
        + '展開後會依你當時實際輸入的提示詞列出<b>已關閉的 Claude Code 與 Codex 工作階段</b>； '
        + '點其中一筆，就會在該工作階段的工作資料夾裡用 <code>claude --resume</code> 或 '
        + '<code>codex resume</code> 把對話接回來。它與上面的<b>不還原分頁</b>是一對 —— '
        + '原生還原只找回 shell，這個找回對話。 '
        + '<b>但當時開著的伺服器與背景程序不會回來。</b>',

    'agents.head': '代理整合',
    'agents.intro': '讓每個代理<b>自己回報</b>狀態、使用中的模型與用量上限。 '
        + '這是側邊欄最準確的來源 —— 不接上就只能從畫面上的文字去猜，判斷自然會飄。',
    'agents.unsupported.title': '此平台不支援',
    'agents.unsupported.desc': '通知指令碼是 PowerShell，只能在 Windows 上執行。狀態改為從輸出內容推測。',

    'state.on': '已連接',
    'state.off': '未連接',
    'state.half': '連接不完整',
    'btn.install': '安裝',
    'btn.remove': '移除',

    'claude.title': 'Claude 整合',
    'claude.desc': 'Claude Code 工作階段會顯示在側邊欄，附<b>狀態</b>（進行中 · 等待核准 · 已完成）'
        + '與<b>模型、帳號、用量長條</b>。 '
        + '會一併寫入 <code>~/.claude/settings.json</code> 裡的掛鉤與 <code>statusLine</code>，移除時也一併移除。 '
        + '其他掛鉤不會被動到，你原有的 <code>statusLine</code> 會<b>照原樣執行</b>，所以顯示不會變。 '
        + '寫入前會在同一資料夾留一份備份。',

    'codex.title': 'Codex 整合',
    'codex.desc': 'Codex 工作階段會顯示在側邊欄，附<b>狀態</b>（進行中 · 等待核准 · 已完成 · 已中斷）'
        + '與<b>模型、帳號、用量長條</b>。 '
        + '安裝後請重新開啟 Codex，在 <code>/hooks</code> 中檢視並信任 AgentDeck 的掛鉤。',

    'codex.disabled': 'Codex 關閉了這些掛鉤 —— 不開啟就什麼都收不到：{events}。 請在 Codex 中執行 <code>/hooks</code> 並信任它們。',

    'root.head': '工作資料夾設定檔',
    'root.intro': '建立專用設定檔，讓新分頁總是在同一個工作資料夾開啟。變更會在重新啟動 Tabby 後生效。',
    'root.use.title': '使用工作資料夾設定檔',
    'root.use.desc': '開啟並填好資料夾後，就會建立該設定檔並設為預設。',
    'root.name.title': '設定檔名稱',
    'root.cwd.title': '工作資料夾',
    'root.cwd.desc': '留空則不建立設定檔。手動輸入時請用斜線（例如 D:/Project），以避開反斜線跳脫的陷阱。',
    'root.browse': '瀏覽',
    'root.command.title': '執行指令',

    'diag.head': '回報問題',
    'diag.intro': '把診斷記錄<b>打包成一個 zip</b>，並開啟它所在的資料夾。 '
        + '內容包含：外掛/Tabby 版本與作業系統、上面的設定值，以及 <code>{path}</code> 最近的兩代記錄。 '
        + '記錄裡有<b>分頁標題與你開啟過的檔案路徑</b> —— 傳送前可以先打開確認。',
    'diag.screen.title': '連畫面原文一起打包',
    'diag.screen.desc': '若是畫面錯亂的問題就開啟。出問題當下的終端機畫面會原樣寫入'
        + '（工作內容與程式碼都看得到），所以預設是關閉的。',
    'diag.collect.title': '收集診斷記錄',
    'diag.collect.desc': '外掛 v{version}。',
    'diag.made': '已建立：',
    'diag.btn': '收集',

    'dev.head': '開發者選項',
    'dev.use.title': '啟用開發者選項',
    'dev.use.desc': '開啟後<b>即時重新載入</b>生效 —— 當 <code>npm run build</code> 改寫了 '
        + '<code>dist/index.js</code>，視窗會<b>在保留工作階段的情況下</b>重新載入新的外掛'
        + '（分頁會重新接回同一個 pty）。快速鍵頁的 <b>[dev] 重新載入外掛</b> 也跟隨這個開關。 '
        + '關閉後即使 dist 變了也不會有任何動作。 '
        + '僅原始碼安裝可見，npm 發行版沒有這個功能。',
    'dev.now.title': '立即重新載入',
    'dev.now.desc': '不重新建置，直接用目前的 dist 重新載入。',
    'dev.btn': '重新載入',

    'footer': '其餘項目 —— 視窗比例、側邊欄寬度、不透明度、狀態偵測、輸入處理 —— 都固定為預設值。 '
        + '確實需要更動時請直接編輯設定檔裡的 <code>agentDeck.*</code>。 '
        + '快速鍵請在<b>快速鍵</b>頁的 <code>agentdeck-*</code> 項目中修改。',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': '快速鍵',
    'keys.intro': '首頁列出的那些鍵。按<b>變更</b>，再按新鍵。若該鍵已被使用——不論是 Tabby 本身或 AgentDeck——會告訴你<b>與什麼衝突</b>，可以重選或直接接手。立即生效。',
    'keys.change': '變更',
    'keys.default': '預設值',
    'keys.cancel': '取消',
    'keys.force': '仍然使用',
    'keys.press': '請按新鍵… (Esc 取消)',
    'keys.conflict': '與 {names} 衝突。仍然使用的話，會從那裡移除這個鍵。',
    'keys.unbound': '未綁定',
    'keys.stock': 'Tabby 內建',
    'keys.digit': '這一項必須以數字 1–9 結尾——數字就是工作階段編號。例如按 Alt+1，2…9 會跟著設定。',
    'keys.fixed': '<code>Ctrl+V</code>、<code>Ctrl+W</code>、右鍵，以及面板內的 <code>Ctrl+F</code> / <code>Ctrl+S</code> 不是快速鍵，這裡不改。',
    'keys.item.newtab': '在工作根目錄開新分頁',
    'keys.item.jump': '跳到第 N 個工作階段',
    'keys.item.focus': '聚焦工作階段清單 / 回到終端機',
    'keys.item.view': '開啟 / 關閉預覽面板',
    'keys.item.repair': '修復畫面',
    'keys.item.splitright': '左右分割（新窗格在右）',
    'keys.item.splitbottom': '上下分割（新窗格在下）',
    'keys.item.closepane': '關閉目前的分割窗格',
    'keys.item.newline': '換行而不送出',
    'keys.item.toggle': '側欄 / 4:3 開關',
    'keys.item.viewmode': '面板：檔案 ↔ 變更',
}
