/** 日本語 */
export default {
    'layout.title': 'AgentDeck のレイアウトを使う',
    'layout.desc': 'オフにするとサイドバーと固定幅レイアウトが消え、Tabby 標準の画面に戻る。',

    'reset.title': 'レイアウトを初期化',
    'reset.desc': 'マウスで変えたサイドバーの位置と大きさを初期状態に戻す — 右ドッキング + 画面比から自動計算した幅。',
    'reset.now': '現在: {dock}にドッキング、{size}。',
    'reset.default': '現在は初期状態。',
    'reset.btn': '初期化',

    'dock.left': '左',
    'dock.right': '右',
    'dock.top': '上',
    'dock.bottom': '下',
    'size.width': '幅 {px}px',
    'size.height': '高さ {px}px',
    'size.auto': '幅 自動',

    'norecover.title': '起動時にタブを復元しない',
    'norecover.desc': 'オンにすると Tabby は前回のタブを復元せず空の状態で起動する — '
        + '戻ってくるのはシェルだけで、その中の Claude セッションはとっくに終わっている。 '
        + 'オフにすると Tabby 標準の動作(<code>recoverTabs</code>)に戻る。次回の起動から有効。',

    'resume.title': '過去のセッションを再開',
    'resume.desc': '各グループの末尾に <code>⟲ 過去のセッション</code> の引き出しを置く(既定は折りたたみ)。 '
        + '開くと<b>終了した Claude Code・Codex のセッション</b>が、そのとき実際に入力したプロンプトで並ぶ。 '
        + 'クリックすると、そのセッションの作業フォルダで <code>claude --resume</code> または '
        + '<code>codex resume</code> により会話が復活する。上の<b>タブを復元しない</b>と対になる設定だ — '
        + '標準の復元はシェルだけ、こちらは会話を戻す。 '
        + '<b>ただし当時起動していたサーバーやバックグラウンドのプロセスは戻らない。</b>',

    'agents.head': 'エージェント連携',
    'agents.intro': 'エージェント自身に、状態・使用中のモデル・利用量を<b>直接報告させる</b>。 '
        + 'これがサイドバーにとって最も正確な情報源だ — 連携しないと画面に描かれた文字から'
        + '推測することになり、その分だけ判定がぶれる。',
    'agents.unsupported.title': 'この環境では使えない',
    'agents.unsupported.desc': '通知スクリプトが PowerShell なので Windows でのみ動作する。'
        + '状態は出力から推測する。',

    'state.on': '連携済み',
    'state.off': '未連携',
    'state.half': '連携なかば',
    'btn.install': 'インストール',
    'btn.remove': '削除',

    'claude.title': 'Claude 連携',
    'claude.desc': 'Claude Code のセッションがサイドバーに<b>状態</b>(作業中・承認待ち・完了)と'
        + '<b>モデル・アカウント・利用量バー</b>付きで表示される。 '
        + '<code>~/.claude/settings.json</code> のフックと <code>statusLine</code> をまとめて設定し、'
        + '削除もまとめて行う。他のフックには触れず、すでに使っていた <code>statusLine</code> は'
        + '<b>そのまま実行する</b>ので表示は変わらない。書き込む前に同じフォルダへバックアップを残す。',

    'codex.title': 'Codex 連携',
    'codex.desc': 'Codex のセッションがサイドバーに<b>状態</b>(作業中・承認待ち・完了・中断)と'
        + '<b>モデル・アカウント・利用量バー</b>付きで表示される。 '
        + 'インストール後に Codex を開き直し、<code>/hooks</code> で AgentDeck のフックを確認して信頼する必要がある。',

    'codex.disabled': 'Codex がこれらのフックを無効にしている — 有効にするまで何も届かない: {events}。 Codex で <code>/hooks</code> を開いて信頼すること。',

    'root.head': '作業フォルダのプロファイル',
    'root.intro': '新しいタブが常に同じ作業フォルダで開くよう専用プロファイルを作る。'
        + '変更は Tabby の再起動後に反映される。',
    'root.use.title': '作業フォルダのプロファイルを使う',
    'root.use.desc': 'オンにして作業フォルダを入れると、そのプロファイルを作成して既定にする。',
    'root.name.title': 'プロファイル名',
    'root.cwd.title': '作業フォルダ',
    'root.cwd.desc': '空にするとプロファイルは作らない。手で書くときはバックスラッシュの'
        + 'エスケープの罠を避けるためスラッシュで書く(例: D:/Project)。',
    'root.browse': '参照',
    'root.command.title': '実行コマンド',

    'diag.head': '問題を報告',
    'diag.intro': '診断ログを<b>ひとつの zip にまとめ</b>、そのファイルがあるフォルダを開く。 '
        + '入るもの: プラグイン/Tabby のバージョンと OS、上の設定値、そして <code>{path}</code> の直近 2 世代。 '
        + 'ログには<b>タブのタイトルと開いたファイルのパス</b>が含まれる — 送る前に開いて確認してかまわない。',
    'diag.screen.title': '画面の生テキストも入れる',
    'diag.screen.desc': '表示が崩れる問題ならオンにする。崩れた瞬間のターミナル画面がそのまま入り'
        + '(作業内容やコードが見える)、既定ではオフになっている。',
    'diag.collect.title': '診断ログを集める',
    'diag.collect.desc': 'プラグイン v{version}。',
    'diag.made': '作成しました: ',
    'diag.btn': '集める',

    'dev.head': '開発者オプション',
    'dev.use.title': '開発者オプションを使う',
    'dev.use.desc': 'オンにすると<b>ライブリロード</b>が動く — <code>npm run build</code> で '
        + '<code>dist/index.js</code> が変わると、<b>セッションを保ったまま</b>ウィンドウをリロードして'
        + '新しいプラグインへ差し替える(タブは同じ pty に付き直す)。'
        + 'ショートカットタブの <b>[dev] プラグインをリロード</b> もこのスイッチに従う。 '
        + 'オフにすると dist が変わっても何も起きない。 '
        + 'ソースツリーからのインストールでのみ表示され、npm 配布版にこの機能はない。',
    'dev.now.title': '今すぐリロード',
    'dev.now.desc': 'ビルドせずに現在の dist で開き直す。',
    'dev.btn': 'リロード',

    'footer': '画面比・サイドバーの幅・不透明度・状態検出・入力処理などの残りの値は既定値で固定されている。 '
        + '変えたい場合は設定ファイルの <code>agentDeck.*</code> を直接編集する。 '
        + 'ショートカットは<b>ホットキー</b>タブの <code>agentdeck-*</code> で変更する。',
}
